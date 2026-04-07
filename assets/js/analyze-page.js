// ═══════════════════════════════════════
// ANALYZE-PAGE — Page Controller
// URL mode đã được chuyển sang url-check.html
// Chỉ còn: text | image
// ═══════════════════════════════════════

// ── Consensus helpers ──────────────────────────────────

function computeConsensus(modelResults) {
  let weightedSum = 0;
  let totalWeight = 0;

  const weights = modelResults.map((r) => {
    const model  = CONFIG.MODELS.find(m => m.id === r.modelId);
    const weight = (model?.weight || 0.2) * (r.confidence || 0.8);
    weightedSum += r.score * weight;
    totalWeight += weight;
    return { ...r, effectiveWeight: weight };
  });

  const trustScore = totalWeight > 0
    ? Math.round(weightedSum / totalWeight)
    : 50;

  const mean     = modelResults.reduce((s, r) => s + r.score, 0) / modelResults.length;
  const variance = modelResults.reduce((s, r) => s + Math.pow(r.score - mean, 2), 0) / modelResults.length;
  const stdDev   = Math.sqrt(variance);
  const agreement = Math.max(0, Math.min(100, Math.round(100 - stdDev)));

  return { trustScore, agreement, weights };
}

function formatConsensus(modelResults) {
  return modelResults.map(r => {
    const label = CONFIG.getVerdict(r.score).label;
    return {
      ...r,
      label,
      color: r.score >= 70 ? 'var(--accent-success)'
           : r.score >= 50 ? 'var(--accent-warn)'
           : 'var(--accent-danger)',
    };
  });
}

// ─────────────────────────────────────────────────────

// Chỉ còn 2 mode: text | image  (url đã chuyển sang url-check.html)
let _currentMode = 'text';

// ── Mode switching ────────────────────────────────────

function setMode(mode) {
  // Chỉ cho phép text và image
  if (!['text', 'image'].includes(mode)) return;
  _currentMode = mode;

  ['text', 'image'].forEach(m => {
    const el = document.getElementById(`mode-${m}`);
    if (el) el.classList.toggle('hidden', m !== mode);
  });

  document.querySelectorAll('#mode-tabs .btn').forEach(btn => {
    const isActive = btn.dataset.mode === mode;
    btn.className  = isActive ? 'btn btn-primary' : 'btn btn-ghost';
  });
}

// ── Character counter ──────────────────────────────────

const textInput = document.getElementById('text-input');
const charCount = document.getElementById('char-count');
if (textInput && charCount) {
  textInput.addEventListener('input', () => {
    charCount.textContent = `${textInput.value.length.toLocaleString()} characters`;
  });
}

// ── Model status panel ─────────────────────────────────

function renderModelStatus(statuses = null) {
  const list = document.getElementById('model-list');
  if (!list) return;

  list.innerHTML = CONFIG.MODELS.map(m => {
    const st    = statuses?.[m.id] || 'idle';
    const color = st === 'done'    ? 'var(--accent-success)'
                : st === 'running' ? 'var(--accent-primary)'
                : st === 'error'   ? 'var(--accent-danger)'
                : 'var(--text-muted)';
    const icon  = st === 'done'    ? '✓'
                : st === 'running' ? '◌'
                : st === 'error'   ? '✗'
                : '○';
    return `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="color:${color};font-size:0.8rem;width:16px;text-align:center;">${icon}</span>
        <span style="font-size:0.78rem;color:var(--text-secondary);">${m.name}</span>
        ${st === 'running' ? '<div class="spinner" style="width:12px;height:12px;border-width:1px;margin-left:auto;"></div>' : ''}
      </div>
    `;
  }).join('');
}

renderModelStatus();

// ── Realtime scan (text only) ──────────────────────────

initRealtimeScan('text-input', 'realtime-output');

// ── Progress steps ─────────────────────────────────────

const STEPS = [
  { id: 'hash',      label: 'Computing content hash'        },
  { id: 'models',    label: 'Running AI models'             },
  { id: 'consensus', label: 'Aggregating consensus'         },
  { id: 'explain',   label: 'Building explainability report'},
  { id: 'chain',     label: 'Writing blockchain proof'      },
];

function renderProgress(completedIds = []) {
  const container = document.getElementById('progress-steps');
  if (!container) return;
  container.innerHTML = STEPS.map(s => {
    const done    = completedIds.includes(s.id);
    const current = !done && completedIds.length === STEPS.findIndex(x => x.id === s.id);
    const color   = done ? 'var(--accent-success)' : current ? 'var(--accent-primary)' : 'var(--text-muted)';
    return `
      <div style="display:flex;align-items:center;gap:12px;font-size:0.82rem;">
        <span style="color:${color};">${done ? '✓' : current ? '▶' : '○'}</span>
        <span style="color:${done ? 'var(--text-primary)' : 'var(--text-muted)'};">${s.label}</span>
      </div>
    `;
  }).join('');

  const pct = (completedIds.length / STEPS.length) * 100;
  const bar = document.getElementById('progress-bar');
  if (bar) bar.style.width = `${pct}%`;
}

// ── Text Service (https://text-service-glgj.onrender.com) ────────────

const TEXT_SERVICE_URL = 'https://text-service-glgj.onrender.com';

async function _analyzeTextViaService(text) {
  const ctrl  = new AbortController();
  let completed = false;
  
  // Timeout 60s để tránh Render cold-start (thường 20-40s)
  const timer = setTimeout(() => {
    if (!completed) ctrl.abort();
  }, 60000);
  
  try {
    console.log('[TextService] Calling:', TEXT_SERVICE_URL + '/detect');
    const res = await fetch(`${TEXT_SERVICE_URL}/detect`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: text }),
      signal:  ctrl.signal,
    });
    
    completed = true;
    clearTimeout(timer);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log('[TextService] Response:', JSON.stringify(data).slice(0, 300));

    // Chap nhan moi response, khong ep buoc data.ok
    const score = data.trustScore
      ?? (data.fakePct != null ? 100 - data.fakePct : null)
      ?? data.score
      ?? 50;

    return {
      trustScore:  score,
      verdict:     score >= 75
        ? { label: 'AUTHENTIC',  color: '#22c55e', class: 'success' }
        : score >= 50
        ? { label: 'SUSPICIOUS', color: '#f59e0b', class: 'warn'    }
        : { label: 'MISLEADING', color: '#ef4444', class: 'danger'  },
      models: [{
        modelId:    'text-service',
        name:       'Text Service',
        score,
        confidence: (data.confidence ?? 70) / 100,
        label:      data.verdict || data.label || '',
      }],
      signals:     [{ type: 'neutral', text: data.summary || data.detail || '', weight: 0.8 }],
      explanation: data.overallAssessment || data.assessment || data.summary || data.detail || '',
      _raw: data,
    };
  } catch (err) {
    // Kiểm tra xem có phải AbortError không
    if (err.name === 'AbortError') {
      console.error('[TextService] Timeout after 60s - service may be unresponsive');
      throw new Error('Text service timeout (60s). Please try again.');
    }
    
    completed = true;
    clearTimeout(timer);
    console.error('[TextService] Error:', err.message);
    throw err;
  }
}

// ── Main analysis flow ─────────────────────────────────

async function startAnalysis() {
  const btn = document.getElementById('analyze-btn');
  btn.disabled = true;

  let content     = '';
  let imageBase64 = null;
  let imageMime   = null;

  if (_currentMode === 'text') {
    content = document.getElementById('text-input')?.value?.trim();
    if (!content || content.length < 10) {
      UI.toast('Please enter at least 10 characters of text.', 'warn');
      btn.disabled = false;
      return;
    }

  } else if (_currentMode === 'image') {
    const fileInput = document.getElementById('img-input');
    const file      = fileInput?.files?.[0];

    if (!file) {
      UI.toast('Please select an image file first.', 'warn');
      btn.disabled = false;
      return;
    }

    const ACCEPTED = [
      'image/jpeg','image/jpg','image/png','image/webp',
      'image/gif','image/bmp','image/tiff','image/avif',
      'image/heic','image/heif','image/svg+xml',
    ];
    if (!ACCEPTED.includes(file.type) && !file.type.startsWith('image/')) {
      UI.toast(`Unsupported format: ${file.type || 'unknown'}. Use JPG, PNG, WebP, GIF, BMP, TIFF.`, 'warn');
      btn.disabled = false;
      return;
    }

    try {
      const dataURI        = await _readFileAsDataURL(file);
      const [header, data] = dataURI.split(',');
      imageBase64          = data;
      imageMime            = header.match(/data:([^;]+)/)?.[1] || file.type || 'image/jpeg';
      content              = dataURI;
    } catch (err) {
      UI.toast('Could not read image file: ' + err.message, 'error');
      btn.disabled = false;
      return;
    }
  }

  UI.show('progress-overlay');
  const done = [];

  try {
    // Step 1: Hash + AI Models chạy song song
    // FIX: hash và chuẩn bị payload không cần tuần tự, chạy cùng lúc.
    // Bỏ toàn bộ delay() nhân tạo (tổng 1.5s không cần thiết).
    const hashInput        = imageBase64 || content;
    const analysisPayload  = _currentMode === 'image'
      ? { type: 'image', content: imageBase64, imageBase64, mimeType: imageMime }
      : { type: 'text',  content };

    const [contentHash, analysis] = await Promise.all([
      hashText(hashInput.slice(0, 10000)),
      (async () => {
        renderModelStatus(Object.fromEntries(CONFIG.MODELS.map(m => [m.id, 'running'])));

        // TEXT: gọi text-service trực tiếp — không fallback cục bộ
        if (_currentMode === 'text') {
          return await _analyzeTextViaService(content);
        }

        // IMAGE: dùng AIBackend.analyzeContent
        const _fn = window.AIBackend?.analyzeContent;
        if (!_fn) {
          console.error('[Analyze] AIBackend.analyzeContent không tồn tại!');
          throw new Error('Backend chưa load xong. Thử reload trang.');
        }
        return _fn(analysisPayload);
      })(),
    ]);

    done.push('hash', 'models');
    renderProgress(done);
    renderModelStatus(Object.fromEntries(CONFIG.MODELS.map(m => [m.id, 'done'])));

    // Step 3: Consensus
    computeConsensus(analysis.models);
    done.push('consensus');
    renderProgress(done);

    // Step 4: Explainability
    done.push('explain');
    renderProgress(done);

    // Step 5: Blockchain — DB + Blockchain song song, fire-and-forget
    // FIX: không await để không block redirect.
    const resultId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result   = {
      id:          resultId,
      type:        _currentMode,
      content:     _currentMode === 'image' ? `[image:${imageMime}]` : content,
      contentHash,
      trustScore:  analysis.trustScore,
      verdict:     analysis.verdict,
      models:      analysis.models,
      signals:     analysis.signals,
      explanation: analysis.explanation,
      timestamp:   new Date().toISOString(),
    };

    // PHẢI await DB.saveResult trước khi redirect
    // nếu không result-page.js đọc DB sẽ không thấy gì
    try {
      await DB.saveResult(result);
      Blockchain.addResult(result).catch(e =>
        console.warn('[Analyze] Blockchain save failed (non-critical):', e.message)
      );
    } catch (e) {
      console.warn('[Analyze] DB save failed:', e.message);
    }

    done.push('chain');
    renderProgress(done);

    window.location.href = `result.html?id=${resultId}`;

  } catch (err) {
    console.error(err);
    UI.toast('Analysis failed: ' + err.message, 'error');
    UI.hide('progress-overlay');
    btn.disabled = false;
    renderModelStatus();
  }
}

function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader error: ' + reader.error?.message));
    reader.readAsDataURL(file);
  });
}


window.setMode       = setMode;
window.startAnalysis = startAnalysis;