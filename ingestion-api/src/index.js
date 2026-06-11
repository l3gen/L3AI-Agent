const express = require('express');
const multer  = require('multer');
const axios   = require('axios');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const fs      = require('fs');
const { promisify } = require('util');

const readFileAsync = promisify(fs.readFile);

const app = express();

// ── CORS: restrict to known origins ─────────────────────────────────────────
// BEFORE: app.use(cors()) — wildcard, any origin can call this API.
// AFTER:  explicit allowlist. Unknown origins get a 500 from the CORS middleware.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3009').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (curl, server-to-server, same-origin).
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// ── Rate limiting ────────────────────────────────────────────────────────────
// Without rate limiting, one client can flood /upload, exhaust /tmp disk,
// hammer the AI service, and fill the inspections array until Node OOMs.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1-minute window
  max: 20,               // 20 uploads per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Try again in a minute.' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// ── Config ───────────────────────────────────────────────────────────────────
const UPLOAD_DIR  = '/tmp/uploads';
const AI_SERVICE  = process.env.AI_SERVICE_URL  || 'http://ai-service:5001';
const REVIEW_URL  = process.env.REVIEW_SERVICE_URL || 'http://review-service:5002';
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.70');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── File upload validation ───────────────────────────────────────────────────
// Allowed MIME types and their magic byte signatures.
// BEFORE: multer only checked Content-Type header — trivially spoofed.
// AFTER:  fileFilter checks the declared type; after save we verify magic bytes.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Magic byte signatures (first bytes of file content)
const MAGIC_BYTES = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png':  [[0x89, 0x50, 0x4E, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],  // RIFF....WEBP
  'image/gif':  [[0x47, 0x49, 0x46, 0x38]],  // GIF8
};

function checkMagicBytes(buffer, mimeType) {
  const sigs = MAGIC_BYTES[mimeType];
  if (!sigs) return false;
  return sigs.some(sig => sig.every((byte, i) => buffer[i] === byte));
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  // Strip the original filename entirely — use a UUID.
  // Keeping originalname risks path traversal (../../etc/passwd) and
  // content-type confusion if the filename has a double extension (evil.jpg.js).
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

// In-memory store
const inspections = [];

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ingestion-api' }));

app.get('/inspections', (req, res) => res.json(inspections));

app.get('/inspections/:id', (req, res) => {
  const item = inspections.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// Apply the upload rate limiter only to the expensive endpoint
app.post('/upload', uploadLimiter, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  // ── Magic byte validation ──────────────────────────────────────────────────
  // A user could set Content-Type: image/jpeg but upload a PHP/JS/SVG file.
  // Read the first 12 bytes and verify it matches known image signatures.
  try {
    const header = await readFileAsync(req.file.path);
    if (!checkMagicBytes(header, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);   // delete the suspicious file immediately
      return res.status(400).json({ error: 'File content does not match declared type' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Could not validate file' });
  }

  const id = uuidv4();
  const inspection = {
    id,
    filename:     req.file.filename,
    originalName: req.file.originalname,
    location:     req.body.location || 'Unknown',
    assetId:      req.body.assetId  || 'ASSET-001',
    uploadedAt:   new Date().toISOString(),
    status:       'processing',
    aiResult:     null,
    needsReview:  false,
  };

  inspections.push(inspection);

  // ── Async read: don't block the event loop ─────────────────────────────────
  // BEFORE: fs.readFileSync blocks Node's event loop — during a large image
  // read, no other requests can be served (DoS risk under load).
  // AFTER:  promisified readFile yields control back to the event loop.
  try {
    const imageData = await readFileAsync(req.file.path);
    const base64    = imageData.toString('base64');

    const aiResponse = await axios.post(`${AI_SERVICE}/analyze`, {
      imageBase64: base64,
      inspectionId: id,
      filename:    req.file.originalname,
    }, { timeout: 30000 });

    const result = aiResponse.data;
    inspection.aiResult    = result;
    inspection.status      = 'complete';
    inspection.needsReview = result.confidence < CONFIDENCE_THRESHOLD;

    if (inspection.needsReview) {
      await axios.post(`${REVIEW_URL}/queue`, {
        inspectionId: id,
        filename:     req.file.originalname,
        location:     inspection.location,
        assetId:      inspection.assetId,
        aiResult:     result,
        uploadedAt:   inspection.uploadedAt,
      }).catch(() => {});
    }
  } catch (err) {
    inspection.status = 'ai_error';
    inspection.error  = err.message;
  } finally {
    // Clean up the uploaded file — we've already sent it to AI, no reason
    // to keep it on disk and accumulate data we don't need.
    fs.unlink(req.file.path, () => {});
  }

  res.json(inspection);
});

// ── Multer error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('File type not allowed')) {
    return res.status(415).json({ error: err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 20 MB)' });
  }
  next(err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Ingestion API running on port ${PORT}`));
