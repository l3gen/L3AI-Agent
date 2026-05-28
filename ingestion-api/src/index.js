const express = require('express');
const multer  = require('multer');
const axios   = require('axios');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const UPLOAD_DIR  = '/tmp/uploads';
const AI_SERVICE  = process.env.AI_SERVICE_URL  || 'http://ai-service:5001';
const REVIEW_URL  = process.env.REVIEW_SERVICE_URL || 'http://review-service:5002';
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.70');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// In-memory store
const inspections = [];

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ingestion-api' }));

app.get('/inspections', (req, res) => res.json(inspections));

app.get('/inspections/:id', (req, res) => {
  const item = inspections.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const id = uuidv4();
  const inspection = {
    id,
    filename:    req.file.filename,
    originalName: req.file.originalname,
    location:    req.body.location || 'Unknown',
    assetId:     req.body.assetId  || 'ASSET-001',
    uploadedAt:  new Date().toISOString(),
    status:      'processing',
    aiResult:    null,
    needsReview: false,
  };

  inspections.push(inspection);

  // Read image and send to AI service
  try {
    const imageData = fs.readFileSync(req.file.path);
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

    // If low confidence — send to review queue
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
  }

  res.json(inspection);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Ingestion API running on port ${PORT}`));
