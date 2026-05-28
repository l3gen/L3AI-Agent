const express = require('express');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory review queue
const queue = [];

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'review-service' }));

// Get all items in queue, optionally filtered by status
app.get('/queue', (req, res) => {
  const { status } = req.query;
  const items = status ? queue.filter(i => i.status === status) : queue;
  res.json(items);
});

// Get queue stats
app.get('/queue/stats', (req, res) => {
  res.json({
    total:    queue.length,
    pending:  queue.filter(i => i.status === 'pending').length,
    approved: queue.filter(i => i.status === 'approved').length,
    rejected: queue.filter(i => i.status === 'rejected').length,
  });
});

// Add item to review queue (called by ingestion API)
app.post('/queue', (req, res) => {
  const item = {
    id:           uuidv4(),
    inspectionId: req.body.inspectionId,
    filename:     req.body.filename,
    location:     req.body.location,
    assetId:      req.body.assetId,
    aiResult:     req.body.aiResult,
    uploadedAt:   req.body.uploadedAt,
    queuedAt:     new Date().toISOString(),
    status:       'pending',
    reviewedAt:   null,
    reviewNote:   null,
  };
  queue.push(item);
  console.log(`Queued for review: ${item.id} (inspection ${item.inspectionId})`);
  res.status(201).json(item);
});

// Human approves the AI result
app.put('/queue/:id/approve', (req, res) => {
  const item = queue.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.status     = 'approved';
  item.reviewedAt = new Date().toISOString();
  item.reviewNote = req.body.note || null;
  res.json(item);
});

// Human overrides / rejects the AI result
app.put('/queue/:id/reject', (req, res) => {
  const item = queue.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  item.status     = 'rejected';
  item.reviewedAt = new Date().toISOString();
  item.reviewNote = req.body.note || null;
  res.json(item);
});

const PORT = process.env.PORT || 5002;
app.listen(PORT, () => console.log(`Review Service running on port ${PORT}`));
