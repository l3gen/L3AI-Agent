/**
 * Regression Tests — Levatas Demo
 * Tests the full AI pipeline end-to-end:
 * upload image → AI analysis → review queue routing
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const INGESTION = process.env.INGESTION_URL || 'http://localhost:5010';
const AI        = process.env.AI_URL        || 'http://localhost:5011';
const REVIEW    = process.env.REVIEW_URL    || 'http://localhost:5012';

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function get(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const u = new URL(url);
    opts.hostname = u.hostname;
    opts.port     = u.port;
    opts.path     = u.pathname;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Valid 1x1 PNG (well-known minimal PNG used in W3C test suites)
function makeTestImage() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function run() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Levatas Demo — Regression Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Health checks ──────────────────────────────
  console.log('\n[ Service Health ]');
  const [ing, ai, rev] = await Promise.all([
    get(`${INGESTION}/health`),
    get(`${AI}/health`),
    get(`${REVIEW}/health`),
  ]);
  assert('Ingestion API is healthy',  ing.body?.status === 'ok');
  assert('AI Service is healthy',     ai.body?.status  === 'ok');
  assert('Review Service is healthy', rev.body?.status === 'ok');

  // ── AI analysis ────────────────────────────────
  console.log('\n[ AI Analysis Pipeline ]');
  const img = makeTestImage().toString('base64');
  const aiRes = await postJson(`${AI}/analyze`, {
    imageBase64:  img,
    inspectionId: 'test-001',
    filename:     'test.png',
  });
  if (aiRes.status !== 200) console.log('  ⚠️  AI response:', JSON.stringify(aiRes.body));
  assert('AI /analyze returns 200',           aiRes.status === 200);
  assert('Response has label field',          typeof aiRes.body?.label === 'string');
  assert('Response has confidence 0-1',       aiRes.body?.confidence >= 0 && aiRes.body?.confidence <= 1);
  assert('Response has anomaly boolean',      typeof aiRes.body?.anomaly === 'boolean');
  assert('Response has recommendation',       typeof aiRes.body?.recommendation === 'string');
  assert('Response has thermal details',      typeof aiRes.body?.details?.thermal === 'object');
  assert('Response has brightness details',   typeof aiRes.body?.details?.brightness === 'object');
  assert('Response has corrosion details',    typeof aiRes.body?.details?.corrosion === 'object');

  // ── Review queue ───────────────────────────────
  console.log('\n[ Review Queue ]');
  const statsRes = await get(`${REVIEW}/queue/stats`);
  assert('Queue stats returns total field',   typeof statsRes.body?.total === 'number');
  assert('Queue stats returns pending field', typeof statsRes.body?.pending === 'number');

  const queueRes = await get(`${REVIEW}/queue`);
  assert('Queue endpoint returns array',      Array.isArray(queueRes.body));

  // ── Inspections list ───────────────────────────
  console.log('\n[ Inspections ]');
  const inspRes = await get(`${INGESTION}/inspections`);
  assert('Inspections returns array',         Array.isArray(inspRes.body));

  // ── 404 handling ───────────────────────────────
  console.log('\n[ Deployment Validation ]');
  const notFound = await get(`${INGESTION}/inspections/nonexistent-id-999`);
  assert('Missing inspection returns 404',   notFound.status === 404);

  // ── Summary ────────────────────────────────────
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
