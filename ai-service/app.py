from flask import Flask, request, jsonify
from flask_cors import CORS
from analyzer import analyze_image
import traceback
import logging
import json
import time
import os

# ── Structured JSON logging (observability) ──────────────────────────────────
class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            'time':    self.formatTime(record),
            'level':   record.levelname,
            'service': 'ai-service',
            'message': record.getMessage(),
        })

handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
logging.basicConfig(handlers=[handler], level=logging.INFO)
log = logging.getLogger(__name__)

# ── GPU detection (runtime dependency management) ────────────────────────────
def detect_runtime():
    try:
        import torch
        if torch.cuda.is_available():
            return f"GPU: {torch.cuda.get_device_name(0)}"
    except ImportError:
        pass
    return "CPU (no GPU runtime detected)"

RUNTIME = detect_runtime()
log.info(f"AI service starting — runtime: {RUNTIME}")

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

@app.get('/health')
def health():
    return jsonify({
        'status':  'ok',
        'service': 'ai-service',
        'runtime': RUNTIME,
    })

@app.post('/analyze')
def analyze():
    data = request.get_json()
    if not data or 'imageBase64' not in data:
        return jsonify({'error': 'imageBase64 required'}), 400
    try:
        start = time.time()
        result = analyze_image(data['imageBase64'])
        elapsed = round((time.time() - start) * 1000, 1)

        result['inspectionId'] = data.get('inspectionId')
        result['filename']     = data.get('filename')
        result['runtime']      = RUNTIME
        result['inference_ms'] = elapsed

        log.info(json.dumps({
            'event':        'analysis_complete',
            'inspectionId': result['inspectionId'],
            'anomaly':      result['anomaly'],
            'confidence':   result['confidence'],
            'inference_ms': elapsed,
        }))

        return jsonify(result)
    except Exception as e:
        log.error(f"Analysis failed: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Development only. In production this file is served by Gunicorn (see Dockerfile).
# app.run() is intentionally not called here to avoid exposing a dev server publicly.
