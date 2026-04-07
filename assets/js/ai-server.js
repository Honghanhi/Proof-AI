// ════════════════════════════════════════════════════════
//  AI-SERVER — Backend API Bridge  (FIXED FINAL)
//
//  Endpoints xác nhận từ API Explorer:
//  ┌─────────────┬──────────────────────────────────────────────────┐
//  │ TEXT        │ POST /detect   body: { content: string }         │
//  │             │   → content phải >= 10 chars, có 'content' field │
//  │ FAKENEWS    │ POST /detect   body: { content } or { url }      │
//  │             │   → error nếu content < 10 chars                 │
//  │ IMAGE       │ POST /detect   body: { image: base64_string }    │
//  │             │   → image field bắt buộc                         │
//  │ UTILITY     │ GET  /health   (chỉ status check)                │
//  │ GATEWAY     │ TIMEOUT — bỏ qua hoàn toàn                      │
//  └─────────────┴──────────────────────────────────────────────────┘
//
//  Public API (window.AIServer):
//    AIServer.analyzeText(text)      → Promise<AnalysisResponse>
//    AIServer.analyzeURL(url)        → Promise<AnalysisResponse>
//    AIServer.analyzeImage(base64)   → Promise<ImageAnalysisResponse>
//    AIServer.detectFakeNews(text)   → Promise<FakeNewsResponse>
//    AIServer.healthCheck(svc?)      → Promise<boolean>
//    AIServer.isReachable(svc?)      → boolean
// ════════════════════════════════════════════════════════

const AIServer = (() => {

  // ── Service URLs ──────────────────────────────────────
  // Không dùng GATEWAY (timeout) — gọi thẳng từng service
  const SVC = {
    TEXT:     'https://text-service-glgj.onrender.com',
    FAKENEWS: 'https://fakenews-service.onrender.com',
    IMAGE:    'https://image-lchq.onrender.com',
    UTILITY:  'https://utility-service-m2n3.onrender.com',
  };

  // ── Confirmed correct endpoints ───────────────────────
  const EP = {
    TEXT_DETECT:     '/detect',   // POST { content: string (>=10 chars) }
    FAKENEWS_DETECT: '/detect',   // POST { content: string } or { url: string }
    IMAGE_DETECT:    '/detect',   // POST { image: base64_string }
    HEALTH:          '/health',   // GET  → { status: "ok", ... }
  };

  // ── Cache reachability per service ────────────────────
  const _reach = { TEXT: null, FAKENEWS: null, IMAGE: null, UTILITY: null };
  let _lastCheck = 0;
  const CACHE_TTL      = 60_000;   // 1 phút
  const REQ_TIMEOUT    = 90_000;   // 90s — Render cold-start
  const HEALTH_TIMEOUT = 65_000;   // 65s health probe
  const RETRY_MAX      = 2;
  const RETRY_BASE_MS  = 1000;

  class APIError extends Error {
    constructor(msg, status) { super(msg); this.name = 'APIError'; this.status = status; }
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Core POST ─────────────────────────────────────────
  async function _post(serviceKey, endpoint, body, timeoutMs = REQ_TIMEOUT) {
    const url = SVC[serviceKey] + endpoint;
    let lastErr;

    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      const ctrl  = new AbortController();
      let completed = false;
      const timer = setTimeout(() => {
        if (!completed) ctrl.abort();
      }, timeoutMs);

      try {
        const res = await fetch(url, {
          method:      'POST',
          mode:        'cors',
          credentials: 'omit',
          headers:     { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body:        JSON.stringify(body),
          signal:      ctrl.signal,
        });
        completed = true;
        clearTimeout(timer);

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { const j = await res.json(); detail = j.detail || j.message || j.error || detail; } catch {}
          throw new APIError(detail, res.status);
        }

        _reach[serviceKey] = true;
        return await res.json();

      } catch (err) {
        completed = true;
        clearTimeout(timer);
        lastErr = err;

        const retry = err.name === 'AbortError'
          || err instanceof TypeError
          || (err instanceof APIError && err.status >= 500);

        if (!retry || attempt === RETRY_MAX) break;
        console.warn(`[AIServer] ${serviceKey}${endpoint} retry ${attempt + 1}…`);
        await _sleep(RETRY_BASE_MS * Math.pow(2, attempt));
      }
    }

    _reach[serviceKey] = false;
    throw lastErr;
  }

  // ── Health check (GET /health) ────────────────────────
  async function _pingHealth(serviceKey) {
    const ctrl  = new AbortController();
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) ctrl.abort();
    }, HEALTH_TIMEOUT);
    try {
      const res = await fetch(SVC[serviceKey] + EP.HEALTH, {
        method: 'GET', mode: 'cors', credentials: 'omit', signal: ctrl.signal,
      });
      completed = true;
      clearTimeout(timer);
      _reach[serviceKey] = res.ok;
      return res.ok;
    } catch (err) {
      completed = true;
      clearTimeout(timer);
      _reach[serviceKey] = false;
      if (err.name !== 'AbortError') {
        console.warn(`[AIServer] ${serviceKey} health failed:`, err.message);
      } else {
        console.warn(`[AIServer] ${serviceKey} health timeout`);
      }
      return false;
    }
  }

  /**
   * Kiểm tra một hoặc tất cả services.
   * Dùng GET /health (endpoint đã xác nhận tồn tại ở tất cả services).
   * @param {string} [svc]  'TEXT'|'FAKENEWS'|'IMAGE'|'UTILITY'
   */
  async function healthCheck(svc) {
    const now = Date.now();
    if (!svc && _reach.TEXT !== null && now - _lastCheck < CACHE_TTL) {
      return Object.values(_reach).some(v => v === true);
    }
    _lastCheck = now;

    const targets = svc ? [svc] : Object.keys(SVC);
    const results = await Promise.allSettled(targets.map(k => _pingHealth(k)));
    const anyOk   = results.some(r => r.status === 'fulfilled' && r.value === true);

    if (anyOk) console.info('[AIServer] Services reachable:', targets.filter(k => _reach[k]));
    else       console.warn('[AIServer] All services unreachable — Render may be cold-starting');

    return anyOk;
  }

  function isReachable(svc) {
    return _reach[svc || 'TEXT'] === true;
  }

  // ── Input validation helpers ──────────────────────────

  function _isValidURL(str) {
    try { const u = new URL(str); return ['http:','https:'].includes(u.protocol); }
    catch { return false; }
  }

  /** Đảm bảo text >= 10 chars (yêu cầu của TEXT & FAKENEWS service) */
  function _padContent(text) {
    const t = String(text || '').trim();
    return t.length >= 10 ? t : t.padEnd(10, ' ');
  }

  // ── Response normalisers ──────────────────────────────

  /**
   * TEXT /detect response:
   * { ai_percent, human_percent, confidence, verdict, model, processing_ms, source }
   */
  function _normText(raw) {
    // Support cả snake_case lẫn camelCase
    const aiPct      = raw.ai_percent    ?? raw.aiPct      ?? raw.ai_pct      ?? 50;
    const humanPct   = raw.human_percent ?? raw.humanPct   ?? raw.human_pct   ?? (100 - aiPct);
    const trustScore = Math.round(humanPct);
    return {
      trustScore,
      aiPct:      Math.round(aiPct),
      humanPct:   Math.round(humanPct),
      confidence: +(raw.confidence ?? 0.75).toFixed(3),
      verdict:    raw.verdict || CONFIG.getVerdict(trustScore),
      models: [{
        modelId:    raw.model ?? 'text-detector',
        modelName:  raw.model ?? 'Text Detection Model',
        aiPct:      Math.round(aiPct),
        humanPct:   Math.round(humanPct),
        confidence: raw.confidence ?? 0.75,
        score:      trustScore,
        source:     'server',
      }],
      signals:      raw.signals     || [],
      explanation:  raw.explanation || raw.reasoning || '',
      processingMs: raw.processing_ms ?? raw.processingMs ?? 0,
      source:       'server',
      endpoint:     `TEXT${EP.TEXT_DETECT}`,
    };
  }

  /**
   * FAKENEWS /detect response:
   * { fake_percent, real_percent, confidence, verdict, signals, processing_ms, source }
   * hoặc { detail: "Provide 'content'..." } nếu body sai
   */
  function _normFakeNews(raw) {
    const fakePct    = raw.fake_percent ?? raw.fakePct ?? raw.ai_percent    ?? 50;
    const realPct    = raw.real_percent ?? raw.realPct ?? raw.human_percent ?? (100 - fakePct);
    const trustScore = Math.round(realPct);
    return {
      trustScore,
      aiPct:       Math.round(fakePct),
      humanPct:    Math.round(realPct),
      fakePct:     Math.round(fakePct),
      realPct:     Math.round(realPct),
      confidence:  +(raw.confidence ?? 0.6).toFixed(3),
      verdict:     raw.verdict || CONFIG.getVerdict(trustScore),
      models: [{
        modelId:    raw.model ?? 'fakenews-detector',
        modelName:  raw.model ?? 'Fake News Detection Model',
        aiPct:      Math.round(fakePct),
        humanPct:   Math.round(realPct),
        confidence: raw.confidence ?? 0.6,
        score:      trustScore,
        source:     'server',
      }],
      signals:      raw.signals     || [],
      explanation:  raw.explanation || raw.reasoning || '',
      processingMs: raw.processing_ms ?? raw.processingMs ?? 0,
      source:       'server',
      endpoint:     `FAKENEWS${EP.FAKENEWS_DETECT}`,
    };
  }

  /**
   * IMAGE /detect response:
   * { ai_percent, real_percent, confidence, verdict, signals, metadata, processing_ms }
   */
  function _normImage(raw) {
    const aiPct      = raw.ai_percent   ?? raw.aiPct    ?? 50;
    const realPct    = raw.real_percent ?? raw.realPct  ?? (100 - aiPct);
    const trustScore = Math.round(realPct);
    return {
      trustScore,
      aiPct:        Math.round(aiPct),
      humanPct:     Math.round(realPct),
      confidence:   +(raw.confidence ?? 0.5).toFixed(3),
      verdict:      raw.verdict || CONFIG.getVerdict(trustScore),
      models: [{
        modelId:    raw.model ?? 'image-detector',
        modelName:  raw.model ?? 'Image Detection Model',
        aiPct:      Math.round(aiPct),
        humanPct:   Math.round(realPct),
        confidence: raw.confidence ?? 0.5,
        score:      trustScore,
        source:     'server',
      }],
      signals:      raw.signals    || [],
      explanation:  raw.explanation || '',
      processingMs: raw.processing_ms ?? raw.processingMs ?? 0,
      metadata:     raw.metadata   || {},
      imageSignals: raw.signals    || [],
      source:       'server',
      endpoint:     `IMAGE${EP.IMAGE_DETECT}`,
    };
  }

  // ── Public API ────────────────────────────────────────

  /**
   * Phân tích text AI detection.
   * Endpoint: TEXT POST /detect  body: { content: string }
   */
  async function analyzeText(text) {
    const content = _padContent(text);
    const raw = await _post('TEXT', EP.TEXT_DETECT, { content });
    return _normText(raw);
  }

  /**
   * Phân tích URL — dùng FAKENEWS service.
   * Endpoint: FAKENEWS POST /detect  body: { url: string }
   */
  async function analyzeURL(url) {
    if (!_isValidURL(url)) throw new APIError('Invalid URL format', 400);
    const raw = await _post('FAKENEWS', EP.FAKENEWS_DETECT, { url }, REQ_TIMEOUT + 15_000);
    const result = _normFakeNews(raw);
    result.url  = url;
    result.type = 'url';
    return result;
  }

  /**
   * Phân tích image AI detection.
   * Endpoint: IMAGE POST /detect  body: { image: base64_string }
   */
  async function analyzeImage(base64) {
    const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
    if (!clean) throw new APIError('Empty image data', 400);
    const raw = await _post('IMAGE', EP.IMAGE_DETECT, { image: clean }, REQ_TIMEOUT + 10_000);
    return _normImage(raw);
  }

  /**
   * Fake news detection cho text hoặc URL.
   * Endpoint: FAKENEWS POST /detect  body: { content } or { url }
   */
  async function detectFakeNews(textOrUrl) {
    const isURL = _isValidURL(textOrUrl);
    const body  = isURL
      ? { url: textOrUrl }
      : { content: _padContent(textOrUrl) };
    const raw = await _post('FAKENEWS', EP.FAKENEWS_DETECT, body, REQ_TIMEOUT + (isURL ? 15_000 : 0));
    return _normFakeNews(raw);
  }

  // Backwards-compat aliases
  const detectText     = analyzeText;
  const detectAIImage  = analyzeImage;

  return Object.freeze({
    analyzeText,
    analyzeURL,
    analyzeImage,
    detectFakeNews,
    detectText,
    detectAIImage,
    healthCheck,
    isReachable,
    APIError,
  });

})();

window.AIServer = AIServer;