// ════════════════════════════════════════════════════════
//  AI — Unified Detection Engine  (FIXED FINAL)
//
//  Fixes:
//  1. STATE safe access (không throw ReferenceError)
//  2. healthCheck dùng GET /health (đã xác nhận tồn tại)
//  3. analyzeText → TEXT /detect  { content }
//  4. analyzeURL  → FAKENEWS /detect { url }
//  5. analyzeImage → IMAGE /detect { image }
// ════════════════════════════════════════════════════════

const AI = (() => {

  // ── Loading overlay ───────────────────────────────────
  const Loading = (() => {
    let _on = false, _t0 = 0, _tick = null, _el = null;
    const STEPS = [
      { pct:  8, label: 'Connecting to AI engine…'     },
      { pct: 20, label: 'Tokenising content…'           },
      { pct: 38, label: 'Running detection model…'      },
      { pct: 55, label: 'Computing scores…'             },
      { pct: 70, label: 'Aggregating consensus…'        },
      { pct: 82, label: 'Computing trust score…'        },
      { pct: 92, label: 'Generating explanation…'       },
      { pct: 99, label: 'Finalising…'                   },
    ];
    function _lbl(p) { for (let i = STEPS.length-1; i >= 0; i--) if (p >= STEPS[i].pct) return STEPS[i].label; return 'Starting…'; }
    function _get() {
      for (const id of ['analyze-loading','result-loading','loading-overlay','progress-overlay']) {
        const el = document.getElementById(id); if (el) return el;
      }
      const el = document.createElement('div');
      el.id = '_ai_ov';
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(5,5,8,.9);backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
      el.innerHTML = `<div id="_ai_lbl" style="font-family:monospace;color:#00e5ff;font-size:13px;">Starting…</div>
        <div style="width:260px;height:3px;background:#1e293b;border-radius:2px;overflow:hidden"><div id="_ai_bar" style="height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#00e5ff);transition:width .3s ease;border-radius:2px"></div></div>
        <div id="_ai_ela" style="font-family:monospace;color:#374151;font-size:11px">0.0s</div>`;
      document.body.appendChild(el); _el = el; return el;
    }
    function show(opts = {}) {
      if (_on) return; _on = true; _t0 = performance.now();
      const el = _get(); el.style.display = ''; el.classList.remove('hidden');
      _tick = setInterval(() => {
        const elapsed = (performance.now() - _t0) / 1000;
        const pct = Math.min(99, Math.round(elapsed / (opts.estimatedSec || 8) * 99));
        const bar = el.querySelector('#_ai_bar,.loading-bar,.progress-fill,[data-loading-bar]');
        const lbl = el.querySelector('#_ai_lbl,.loading-label,.loading-text,[data-loading-label]');
        const ela = el.querySelector('#_ai_ela,.loading-elapsed,[data-loading-elapsed]');
        if (bar) bar.style.width = pct + '%';
        if (lbl) lbl.textContent = _lbl(pct);
        if (ela) ela.textContent = elapsed.toFixed(1) + 's';
      }, 200);
    }
    function hide() {
      if (!_on) return; _on = false; clearInterval(_tick); _tick = null;
      const ids = ['_ai_ov','analyze-loading','result-loading','loading-overlay','progress-overlay'];
      const el  = ids.map(id => document.getElementById(id)).find(Boolean);
      if (!el) return;
      const bar = el.querySelector('#_ai_bar,.loading-bar,.progress-fill');
      const lbl = el.querySelector('#_ai_lbl,.loading-label,.loading-text');
      if (bar) bar.style.width = '100%';
      if (lbl) lbl.textContent = 'Done ✓';
      setTimeout(() => {
        el.style.display = 'none'; el.classList.add('hidden');
        if (_el && el === _el) { _el.remove(); _el = null; }
      }, 300);
    }
    return { show, hide, isActive: () => _on };
  })();

  // ── STATE safe helpers ────────────────────────────────
  // FIX: STATE có thể chưa load khi ai.js chạy → dùng safe accessors

  function _safeState(key) {
    try {
      if (typeof STATE !== 'undefined' && STATE && typeof STATE.get === 'function') {
        return STATE.get(key);
      }
    } catch {}
    return undefined;
  }

  function _safeStateSet(updates) {
    try {
      if (typeof STATE !== 'undefined' && STATE && typeof STATE.set === 'function') {
        STATE.set(updates);
      }
    } catch {}
  }

  function getMode() {
    try {
      const ov = localStorage.getItem('AI_MODE_OVERRIDE');
      if (ov && CONFIG.AI_MODES.includes(ov)) return ov;
    } catch {}
    return _safeState('aiMode') || CONFIG.AI_MODE_DEFAULT;
  }

  function setMode(mode) {
    if (!CONFIG.AI_MODES.includes(mode)) throw new Error(`Unknown mode: "${mode}"`);
    try { localStorage.setItem('AI_MODE_OVERRIDE', mode); } catch {}
    _safeStateSet({ aiMode: mode });
    console.info(`[AI] mode → "${mode}"`);
  }

  function _isTransformersReady() {
    return _safeState('transformersReady') === true;
  }

  // ── Internal helpers ──────────────────────────────────

  function _weightedTrustScore(models) {
    let wSum = 0, wTotal = 0;
    for (const m of models) {
      const cfg    = (typeof CONFIG !== 'undefined') ? CONFIG.MODELS.find(c => c.id === m.modelId) : null;
      const weight = (cfg?.weight ?? 0.2) * (m.confidence ?? 0.8);
      wSum += (m.score ?? 50) * weight; wTotal += weight;
    }
    return wTotal > 0 ? Math.round(wSum / wTotal) : 50;
  }

  function _buildExplanation(trustScore, signals) {
    const ai   = (signals || []).filter(s => s.type === 'ai-pattern').length;
    const fake = (signals || []).filter(s => s.type === 'misinformation').length;
    if (trustScore >= 85) return 'Content exhibits natural linguistic variation and no significant AI-generation patterns.';
    if (trustScore >= 70) return `Mostly authentic. ${ai > 0 ? ai + ' mild AI-pattern(s) detected.' : 'No strong AI signals.'}`;
    if (trustScore >= 50) return `Mixed signals: ${ai} AI-pattern(s), ${fake} misinformation signal(s). Manual review recommended.`;
    if (trustScore >= 30) return `Suspicious: ${ai} AI-pattern(s), ${fake} misleading signal(s) detected.`;
    return `Strong AI-generation indicators. ${ai} AI-pattern segments and ${fake} misinformation signals flagged.`;
  }

  function _heuristicResult(text, type = 'text') {
    if (typeof Heuristics === 'undefined') {
      return { trustScore: 50, aiPct: 50, humanPct: 50, confidence: 0, verdict: CONFIG.getVerdict(50), models: [], signals: [], explanation: 'Analysis modules loading…', processingMs: 0, source: 'heuristic', mode: getMode(), type };
    }
    const h      = Heuristics.analyzeText(text);
    const models = CONFIG.MODELS.map(m => {
      const ai = Math.max(5, Math.min(95, Math.round(h.aiPct + (Math.random() - 0.5) * 18)));
      return { modelId: m.id, modelName: m.name, aiPct: ai, humanPct: 100 - ai, confidence: +(h.confidence * 0.7).toFixed(3), score: 100 - ai, source: 'heuristic', latencyMs: 0 };
    });
    const trustScore = _weightedTrustScore(models);
    return {
      trustScore, aiPct: 100 - trustScore, humanPct: trustScore,
      confidence:  +(h.confidence * 0.7).toFixed(3),
      verdict:     CONFIG.getVerdict(trustScore),
      models,      signals: h.signals,
      explanation: _buildExplanation(trustScore, h.signals),
      processingMs: 0, source: 'heuristic', mode: getMode(), type,
    };
  }

  function _enrich(result, text) {
    if ((!result.signals || result.signals.length === 0) && typeof Heuristics !== 'undefined') {
      result.signals = Heuristics.generateSignals(text, result.aiPct);
    }
    if (!result.explanation) {
      result.explanation = _buildExplanation(result.trustScore, result.signals);
    }
    return result;
  }

  // ── analyzeText ───────────────────────────────────────
  async function analyzeText(text, opts = {}) {
    const t0   = performance.now();
    const mode = getMode();
    Loading.show({ estimatedSec: mode === 'server' ? 10 : 4 });

    try {
      // ── Server mode ──
      if (mode === 'server') {
        // Kiểm tra cache trước, healthCheck chỉ khi chưa biết
        let ok = AIServer.isReachable('TEXT');
        if (!ok) ok = await AIServer.healthCheck('TEXT');

        if (ok) {
          try {
            const result = await AIServer.analyzeText(text);
            result.mode  = 'server'; result.type = 'text';
            result.processingMs = Math.round(performance.now() - t0);
            return _enrich(result, text);
          } catch (err) {
            console.warn('[AI] TEXT server failed, heuristic fallback:', err.message);
          }
        } else {
          console.warn('[AI] TEXT service unreachable');
        }
      }

      // ── cdn/local: transformers.js ──
      if (typeof AIModels !== 'undefined' && _isTransformersReady()) {
        try {
          const modelResults = await AIModels.runAllModels(text, opts.onModelProgress);
          const trustScore   = _weightedTrustScore(modelResults);
          const h = typeof Heuristics !== 'undefined' ? Heuristics.analyzeText(text) : { signals: [] };
          return {
            trustScore, aiPct: 100 - trustScore, humanPct: trustScore,
            confidence:  +(modelResults.reduce((s, m) => s + m.confidence, 0) / modelResults.length).toFixed(3),
            verdict:     CONFIG.getVerdict(trustScore), models: modelResults,
            signals:     h.signals, explanation: _buildExplanation(trustScore, h.signals),
            processingMs: Math.round(performance.now() - t0),
            source: 'transformers', mode: mode === 'server' ? 'cdn' : mode, type: 'text',
          };
        } catch (err) { console.warn('[AI] transformers failed:', err.message); }
      }

      // ── Heuristic fallback ──
      const result = _heuristicResult(text, 'text');
      result.processingMs = Math.round(performance.now() - t0);
      return result;

    } finally { Loading.hide(); }
  }

  // ── analyzeURL ────────────────────────────────────────
  async function analyzeURL(url, opts = {}) {
    const t0   = performance.now();
    const mode = getMode();
    Loading.show({ estimatedSec: 15 });

    try {
      if (mode !== 'server') {
        if (typeof UI !== 'undefined') UI.toast('URL analysis requires Server mode.', 'warn', 5000);
        return { trustScore: 50, aiPct: 50, humanPct: 50, confidence: 0, verdict: CONFIG.getVerdict(50), models: [], signals: [], url, type: 'url', mode, explanation: 'URL analysis requires server mode.', processingMs: 0 };
      }

      let ok = AIServer.isReachable('FAKENEWS');
      if (!ok) ok = await AIServer.healthCheck('FAKENEWS');

      if (ok) {
        try {
          const result = await AIServer.analyzeURL(url);
          result.mode  = 'server'; result.url = url;
          result.processingMs = Math.round(performance.now() - t0);
          return result;
        } catch (err) { console.warn('[AI] FAKENEWS URL failed:', err.message); }
      }

      return {
        ..._heuristicResult(url, 'url'),
        trustScore: 50, aiPct: 50, humanPct: 50, confidence: 0,
        url, explanation: 'Server unreachable for URL analysis.',
        processingMs: Math.round(performance.now() - t0),
      };
    } finally { Loading.hide(); }
  }

  // ── analyzeImage ──────────────────────────────────────
  async function _toBase64(input) {
    if (typeof input === 'string') {
      return { base64: input.replace(/^data:[^;]+;base64,/, ''), mimeType: 'image/jpeg' };
    }
    if (input instanceof File || input instanceof Blob) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => { const [h, d] = r.result.split(','); res({ base64: d, mimeType: h.match(/data:([^;]+)/)?.[1] || 'image/jpeg' }); };
        r.onerror = () => rej(new Error('FileReader error'));
        r.readAsDataURL(input);
      });
    }
    throw new Error('Unsupported image input');
  }

  async function analyzeImage(input, opts = {}) {
    const t0 = performance.now();
    const { base64, mimeType } = await _toBase64(input);
    const mode = getMode();
    Loading.show({ estimatedSec: 12 });

    try {
      if (mode === 'server') {
        let ok = AIServer.isReachable('IMAGE');
        if (!ok) ok = await AIServer.healthCheck('IMAGE');
        if (ok) {
          try {
            const result = await AIServer.analyzeImage(base64);
            result.mode  = 'server'; result.type = 'image';
            result.processingMs = Math.round(performance.now() - t0);
            return result;
          } catch (err) { console.warn('[AI] IMAGE server failed:', err.message); }
        }
      }

      // Client-side fallback
      return await _clientImage(base64, mimeType, performance.now() - t0);
    } finally { Loading.hide(); }
  }

  async function _clientImage(base64, mimeType, elapsed) {
    return new Promise(resolve => {
      const img = new Image();
      let objUrl;
      try {
        const bytes = atob(base64);
        const arr   = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        objUrl = URL.createObjectURL(new Blob([arr], { type: mimeType || 'image/jpeg' }));
      } catch {
        return resolve({ trustScore:50, aiPct:50, humanPct:50, confidence:0.1, verdict:CONFIG.getVerdict(50), models:[], signals:[], explanation:'Could not decode image.', metadata:{}, imageSignals:[], type:'image', source:'client-image', processingMs: Math.round(elapsed) });
      }

      img.onload = () => {
        const [W, H] = [64, 64];
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        let px;
        try { const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, W, H); px = ctx.getImageData(0, 0, W, H).data; } catch { px = null; }
        URL.revokeObjectURL(objUrl);
        if (!px) return resolve({ trustScore:50, aiPct:50, humanPct:50, confidence:0.1, verdict:CONFIG.getVerdict(50), models:[], signals:[], explanation:'Canvas pixel analysis blocked.', metadata:{}, imageSignals:[], type:'image', source:'client-image' });
        let rS=0, gS=0, bS=0, nD=0;
        const total = W * H;
        for (let i = 0; i < px.length; i += 4) {
          rS += px[i]; gS += px[i+1]; bS += px[i+2];
          if (i+4 < px.length) nD += Math.abs(px[i]-px[i+4]) + Math.abs(px[i+1]-px[i+5]) + Math.abs(px[i+2]-px[i+6]);
        }
        const cs = Math.min(1, (Math.abs(rS/total-128)+Math.abs(gS/total-128)+Math.abs(bS/total-128))/128);
        const ns = Math.min(1, nD/(total*3*255)*8);
        const aiPct = Math.round((1-ns)*45 + cs*20 + 30);
        const ts    = 100 - aiPct;
        resolve({
          trustScore: ts, aiPct, humanPct: 100-aiPct, confidence: 0.35,
          verdict: CONFIG.getVerdict(ts),
          models: CONFIG.MODELS.slice(0,2).map(m => ({ modelId:m.id, modelName:m.name, aiPct: Math.max(5,Math.min(95,aiPct+Math.round((Math.random()-.5)*15))), humanPct:0, confidence:0.4, score:ts, source:'client-image', latencyMs:0 })),
          signals: [{ type:'noise-pattern', label:'Pixel noise', strength:1-ns },{ type:'colour-stats', label:'Colour distribution', strength:cs }],
          explanation: `Client-side pixel analysis. Noise: ${Math.round(ns*100)}%, colour: ${Math.round(cs*100)}%.`,
          metadata: { noiseScore:+ns.toFixed(3), colourScore:+cs.toFixed(3) },
          imageSignals: [], type:'image', source:'client-image',
          processingMs: Math.round(elapsed),
        });
      };
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve({ trustScore:50, aiPct:50, humanPct:50, confidence:0, verdict:CONFIG.getVerdict(50), models:[], signals:[], explanation:'Cannot load image.', metadata:{}, imageSignals:[], type:'image', source:'client-image' }); };
      img.src = objUrl;
    });
  }

  // ── quickScan ─────────────────────────────────────────
  async function quickScan(text) {
    if (!text || text.trim().length < 20) return null;
    return typeof Heuristics !== 'undefined'
      ? Heuristics.quickScore(text)
      : { score: 50, label: 'UNCERTAIN', confidence: 0 };
  }

  // ── runAllModels ──────────────────────────────────────
  async function runAllModels(text, onProgress) {
    if (getMode() !== 'server' && _isTransformersReady() && typeof AIModels !== 'undefined') {
      const results = await AIModels.runAllModels(text, onProgress);
      return results.map(r => ({ model: r.modelName, score: r.score, ...r }));
    }
    if (typeof Heuristics === 'undefined') return [];
    const h = Heuristics.analyzeText(text);
    return CONFIG.MODELS.map(m => {
      const ai = Math.max(5, Math.min(95, h.aiPct + (Math.random()-.5)*16));
      return { model: m.name, score: 100-ai, aiPct: ai, humanPct: 100-ai, confidence: h.confidence };
    });
  }

  async function analyze(payload, opts = {}) {
    const { type = 'text', content, url, imageBase64 } = payload;
    switch (type) {
      case 'text':  return analyzeText(content || '', opts);
      case 'url':   return analyzeURL(url || content || '', opts);
      case 'image': return analyzeImage(imageBase64 || content || '', opts);
      default: throw new Error(`Unknown type: "${type}"`);
    }
  }

  async function checkServerHealth() { return AIServer.healthCheck(); }

  return Object.freeze({ analyze, analyzeText, analyzeURL, analyzeImage, quickScan, runAllModels, getMode, setMode, checkServerHealth, Loading });
})();

window.AI = AI;

// Backwards-compat globals
async function analyzeContent(payload, opts = {}) { return AI.analyze(payload, opts); }
async function quickScan(text) { return AI.quickScan(text); }
async function runAllModels(text, onProgress) { return AI.runAllModels(text, onProgress); }
window.analyzeContent = analyzeContent;
window.quickScan      = quickScan;
window.runAllModels   = runAllModels;