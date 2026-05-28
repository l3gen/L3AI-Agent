import React, { useState, useEffect, useCallback } from 'react';

const INGESTION = import.meta.env.VITE_INGESTION_URL || 'http://localhost:5000';
const REVIEW    = import.meta.env.VITE_REVIEW_URL    || 'http://localhost:5002';

const badge = (text, color) => (
  <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
    {text}
  </span>
);

const severityColor = (s) => ({ critical: '#da3633', high: '#d29922', medium: '#e3b341', none: '#3fb950' }[s] || '#8b949e');
const confColor = (c) => c >= 0.80 ? '#3fb950' : c >= 0.65 ? '#d29922' : '#da3633';

export default function App() {
  const [tab, setTab]               = useState('upload');
  const [inspections, setInspections] = useState([]);
  const [queue, setQueue]           = useState([]);
  const [stats, setStats]           = useState({});
  const [uploading, setUploading]   = useState(false);
  const [file, setFile]             = useState(null);
  const [location, setLocation]     = useState('');
  const [assetId, setAssetId]       = useState('');
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState('');

  const fetchInspections = useCallback(async () => {
    try {
      const r = await fetch(`${INGESTION}/inspections`);
      setInspections(await r.json());
    } catch {}
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([
        fetch(`${REVIEW}/queue`).then(r => r.json()),
        fetch(`${REVIEW}/queue/stats`).then(r => r.json()),
      ]);
      setQueue(q);
      setStats(s);
    } catch {}
  }, []);

  useEffect(() => {
    fetchInspections();
    fetchQueue();
    const t = setInterval(() => { fetchInspections(); fetchQueue(); }, 5000);
    return () => clearInterval(t);
  }, [fetchInspections, fetchQueue]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true); setError(''); setResult(null);
    const fd = new FormData();
    fd.append('image', file);
    fd.append('location', location || 'Field Site A');
    fd.append('assetId', assetId || 'ASSET-001');
    try {
      const r = await fetch(`${INGESTION}/upload`, { method: 'POST', body: fd });
      const data = await r.json();
      setResult(data);
      fetchInspections(); fetchQueue();
    } catch (err) {
      setError('Upload failed — is the ingestion API running?');
    } finally {
      setUploading(false);
    }
  };

  const handleReview = async (id, action, note = '') => {
    await fetch(`${REVIEW}/queue/${id}/${action}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    fetchQueue();
  };

  const s = { container: { maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }, card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, marginBottom: 16 }, input: { width: '100%', padding: '8px 12px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', fontSize: 14, marginTop: 6 }, btn: { padding: '8px 20px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: 14 }, tab: (active) => ({ padding: '8px 20px', border: 'none', borderRadius: '6px 6px 0 0', fontWeight: 600, cursor: 'pointer', background: active ? '#161b22' : 'transparent', color: active ? '#58a6ff' : '#8b949e', borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent' }) };

  return (
    <div style={s.container}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#58a6ff' }}>🚁 Levatas Demo</h1>
        <p style={{ color: '#8b949e', marginTop: 4 }}>Drone Inspection AI Platform</p>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Inspections', value: inspections.length, color: '#58a6ff' },
          { label: 'Review Queue',      value: stats.pending || 0,  color: '#d29922' },
          { label: 'Approved',          value: stats.approved || 0, color: '#3fb950' },
          { label: 'Overridden',        value: stats.rejected || 0, color: '#da3633' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ ...s.card, flex: 1, minWidth: 140, padding: '16px 20px', marginBottom: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #30363d', marginBottom: 24, display: 'flex', gap: 4 }}>
        {['upload', 'inspections', 'review'].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'upload' ? '📤 Upload' : t === 'inspections' ? '📋 Inspections' : `👁 Review (${stats.pending || 0})`}
          </button>
        ))}
      </div>

      {/* Upload Tab */}
      {tab === 'upload' && (
        <div style={s.card}>
          <h2 style={{ marginBottom: 16, fontSize: 18 }}>Upload Drone Image for Inspection</h2>
          <form onSubmit={handleUpload}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <label style={{ fontSize: 13, color: '#8b949e' }}>
                Asset ID
                <input style={s.input} value={assetId} onChange={e => setAssetId(e.target.value)} placeholder="ASSET-001" />
              </label>
              <label style={{ fontSize: 13, color: '#8b949e' }}>
                Location
                <input style={s.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="Field Site A, Tower 3" />
              </label>
            </div>
            <label style={{ fontSize: 13, color: '#8b949e', display: 'block', marginBottom: 16 }}>
              Image (JPG, PNG)
              <input type="file" accept="image/*" style={s.input} onChange={e => setFile(e.target.files[0])} required />
            </label>
            <button type="submit" disabled={uploading} style={{ ...s.btn, background: uploading ? '#30363d' : '#238636', color: '#fff' }}>
              {uploading ? 'Analyzing...' : 'Upload & Analyze'}
            </button>
          </form>

          {error && <p style={{ color: '#da3633', marginTop: 16 }}>{error}</p>}

          {result && (
            <div style={{ marginTop: 24, padding: 16, background: '#0d1117', borderRadius: 8, border: '1px solid #30363d' }}>
              <h3 style={{ marginBottom: 12, color: '#e6edf3' }}>Analysis Result</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {badge(result.aiResult?.anomaly ? '⚠ Anomaly Detected' : '✓ Normal', result.aiResult?.anomaly ? '#da3633' : '#238636')}
                {result.needsReview && badge('👁 Sent to Human Review', '#9e6a03')}
              </div>
              <p style={{ color: '#8b949e', fontSize: 14, marginBottom: 8 }}><strong style={{ color: '#e6edf3' }}>Finding:</strong> {result.aiResult?.label}</p>
              <p style={{ color: '#8b949e', fontSize: 14, marginBottom: 8 }}>
                <strong style={{ color: '#e6edf3' }}>Confidence:</strong>{' '}
                <span style={{ color: confColor(result.aiResult?.confidence) }}>{((result.aiResult?.confidence || 0) * 100).toFixed(0)}%</span>
              </p>
              <p style={{ color: '#8b949e', fontSize: 14 }}><strong style={{ color: '#e6edf3' }}>Recommendation:</strong> {result.aiResult?.recommendation}</p>
              {result.aiResult?.details && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {[
                    { label: 'Thermal Score', value: result.aiResult.details.thermal?.thermal_score },
                    { label: 'Hot Pixels',    value: `${result.aiResult.details.thermal?.hot_pixel_pct}%` },
                    { label: 'Corrosion',     value: `${result.aiResult.details.corrosion?.corrosion_pct}%` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: '#161b22', padding: '10px 14px', borderRadius: 6, border: '1px solid #30363d' }}>
                      <div style={{ fontSize: 11, color: '#8b949e' }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3', marginTop: 2 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inspections Tab */}
      {tab === 'inspections' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 18 }}>All Inspections</h2>
          {inspections.length === 0 ? (
            <div style={{ ...s.card, color: '#8b949e', textAlign: 'center', padding: 40 }}>No inspections yet — upload an image to get started.</div>
          ) : (
            inspections.slice().reverse().map(ins => (
              <div key={ins.id} style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{ins.originalName}</div>
                    <div style={{ fontSize: 13, color: '#8b949e', marginTop: 4 }}>{ins.assetId} · {ins.location} · {new Date(ins.uploadedAt).toLocaleString()}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {badge(ins.status, ins.status === 'complete' ? '#238636' : ins.status === 'processing' ? '#1f6feb' : '#da3633')}
                    {ins.needsReview && badge('Needs Review', '#9e6a03')}
                  </div>
                </div>
                {ins.aiResult && (
                  <div style={{ marginTop: 12, fontSize: 13, color: '#8b949e' }}>
                    <span style={{ marginRight: 16 }}><strong style={{ color: '#e6edf3' }}>Finding:</strong> {ins.aiResult.label}</span>
                    <span style={{ marginRight: 16 }}><strong style={{ color: '#e6edf3' }}>Confidence:</strong> <span style={{ color: confColor(ins.aiResult.confidence) }}>{((ins.aiResult.confidence || 0) * 100).toFixed(0)}%</span></span>
                    {ins.aiResult.details?.thermal && (
                      <span><strong style={{ color: '#e6edf3' }}>Thermal:</strong> <span style={{ color: severityColor(ins.aiResult.details.thermal.severity) }}>{ins.aiResult.details.thermal.severity}</span></span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Review Tab */}
      {tab === 'review' && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 18 }}>Human Review Queue</h2>
          <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>Items below had AI confidence below 70% — a human expert should verify before acting.</p>
          {queue.length === 0 ? (
            <div style={{ ...s.card, color: '#8b949e', textAlign: 'center', padding: 40 }}>Queue is empty — all results were high-confidence.</div>
          ) : (
            queue.slice().reverse().map(item => (
              <div key={item.id} style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.filename}</div>
                    <div style={{ fontSize: 13, color: '#8b949e', marginTop: 4 }}>{item.assetId} · {item.location}</div>
                    <div style={{ fontSize: 13, color: '#8b949e' }}>AI: {item.aiResult?.label}</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      Confidence: <span style={{ color: confColor(item.aiResult?.confidence), fontWeight: 600 }}>{((item.aiResult?.confidence || 0) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  {badge(item.status, item.status === 'pending' ? '#9e6a03' : item.status === 'approved' ? '#238636' : '#da3633')}
                </div>
                {item.status === 'pending' && (
                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    <button onClick={() => handleReview(item.id, 'approve', 'Verified by human inspector')} style={{ ...s.btn, background: '#238636', color: '#fff' }}>
                      ✓ Approve AI Result
                    </button>
                    <button onClick={() => handleReview(item.id, 'reject', 'AI result overridden — false positive')} style={{ ...s.btn, background: '#da3633', color: '#fff' }}>
                      ✕ Override (False Positive)
                    </button>
                  </div>
                )}
                {item.reviewNote && (
                  <p style={{ marginTop: 8, fontSize: 13, color: '#8b949e' }}>Note: {item.reviewNote}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
