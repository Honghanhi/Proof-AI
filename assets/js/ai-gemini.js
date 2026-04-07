// ════════════════════════════════════════════════════════════════════
//  AI-GEMINI.JS  v5.0  — Microservices Bridge (NO Gemini Proxy)
//
//  ✓ Gọi trực tiếp từ microservices:
//    - https://text-service-glgj.onrender.com
//    - https://fakenews-service.onrender.com
//    - https://image-lchq.onrender.com
//  ✓ Wrapper compatibility layer để dùng AIServer
//  ✓ Health check từ tất cả services
// ════════════════════════════════════════════════════════════════════

(function (window) {
  'use strict';

  const TIMEOUT_MS  = 90000;  // 90s để tránh Render cold-start timeout
  let _online       = null;
  let _lastCheck    = 0;
  let _healthPromise = null;

  // ── Health check: kiểm tra tất cả microservices ──────────────
  async function checkHealth() {
    const now = Date.now();
    if (_online !== null && now - _lastCheck < 60000) return _online;
    if (_healthPromise) return _healthPromise;

    _healthPromise = (async () => {
      try {
        // Kiểm tra nếu AIServer có sẵn từ ai-server.js
        if (typeof window.AIServer !== 'undefined' && typeof window.AIServer.healthCheck === 'function') {
          _online = await window.AIServer.healthCheck().catch(() => false);
          console.log('[AIBackend] Microservices health check:', _online ? 'OK' : 'FAILED');
        } else {
          console.warn('[AIBackend] AIServer không tồn tại — chắc chắn ai-server.js đã load trước');
          _online = false;
        }
        _lastCheck = Date.now();
      } catch (e) {
        _online = false;
        _lastCheck = Date.now();
        console.warn('[AIBackend] health check failed:', e.message);
      }
      _healthPromise = null;
      return _online;
    })();

    return _healthPromise;
  }

  async function _ensureOnline() {
    if (_online === null) await checkHealth();
    return _online;
  }

  function isOnline() { return _online === true; }

  // ══════════════════════════════════════════════════════════
  //  AI CALLS — Wrapper qua AIServer (từ ai-server.js)
  // ══════════════════════════════════════════════════════════

  async function callAI(prompt, maxTokens = 1000) {
    try {
      // Fallback chain: AIBackendConfig → AIServer → null
      // 1. AIBackendConfig (Gemini/Groq/OpenRouter) — tốt cho arbitrary prompts
      // 2. AIServer (microservices) — chỉ fake news, trả về explanation
      
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.callAI === 'function') {
        const result = await window.AIBackendConfig.callAI(prompt, maxTokens).catch(() => null);
        if (result) return result;
      }

      if (typeof window.AIServer !== 'undefined' && typeof window.AIServer.detectFakeNews === 'function') {
        const result = await window.AIServer.detectFakeNews(prompt).catch(() => null);
        // AIServer.detectFakeNews() trả về: { explanation, reasoning, ...}
        // KHÔNG phải overallAssessment hay summary
        return result?.explanation || result?.reasoning || null;
      }

      console.warn('[AIBackend] No AI providers available (AIBackendConfig + AIServer)');
      return null;
    } catch (err) {
      console.warn('[AIBackend] callAI failed:', err.message);
      return null;
    }
  }

  async function callAIJSON(prompt, maxTokens = 1000) {
    // Try AIBackendConfig first (better JSON parsing)
    if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.callAIJSON === 'function') {
      const result = await window.AIBackendConfig.callAIJSON(prompt, maxTokens).catch(() => null);
      if (result) return result;
    }

    // Fallback: parse callAI response manually
    const raw = await callAI(prompt, maxTokens);
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch {} }
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  DOMAIN APIs — Direct calls via AIBackendConfig
  // ══════════════════════════════════════════════════════════

  async function dnsResolve(domain, type = 'A') {
    try {
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.dnsResolve === 'function') {
        return await window.AIBackendConfig.dnsResolve(domain, type);
      }
      console.warn('[AIBackend] AIBackendConfig.dnsResolve không khả dụng');
      return { ok: false, records: [], answers: [], domain, type };
    } catch (err) {
      console.warn('[AIBackend] DNS failed:', err.message);
      return { ok: false, records: [], answers: [], domain, type };
    }
  }

  async function ipInfo(domain) {
    try {
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.ipInfo === 'function') {
        return await window.AIBackendConfig.ipInfo(domain);
      }
      console.warn('[AIBackend] AIBackendConfig.ipInfo không khả dụng');
      return null;
    } catch (err) {
      console.warn('[AIBackend] ipInfo failed:', err.message);
      return null;
    }
  }

  async function vtScanURL(url) {
    try {
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.vtScanURL === 'function') {
        return await window.AIBackendConfig.vtScanURL(url);
      }
      console.warn('[AIBackend] AIBackendConfig.vtScanURL không khả dụng');
      return null;
    } catch (err) {
      console.warn('[AIBackend] VT URL failed:', err.message);
      return null;
    }
  }

  async function vtDomainInfo(domain) {
    try {
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.vtDomainInfo === 'function') {
        return await window.AIBackendConfig.vtDomainInfo(domain);
      }
      console.warn('[AIBackend] AIBackendConfig.vtDomainInfo không khả dụng');
      return null;
    } catch (err) {
      console.warn('[AIBackend] VT domain failed:', err.message);
      return null;
    }
  }

  async function urlscanSearch(domain) {
    try {
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.urlscanSearch === 'function') {
        return await window.AIBackendConfig.urlscanSearch(domain);
      }
      console.warn('[AIBackend] AIBackendConfig.urlscanSearch không khả dụng');
      return null;
    } catch (err) {
      console.warn('[AIBackend] URLScan failed:', err.message);
      return null;
    }
  }

  async function fetchSource(url) {
    try {
      if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.fetchSource === 'function') {
        return await window.AIBackendConfig.fetchSource(url);
      }
      console.warn('[AIBackend] AIBackendConfig.fetchSource không khả dụng');
      return '';
    } catch (err) {
      console.warn('[AIBackend] fetchSource failed:', err.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════
  //  ANALYZE — Via AIServer microservices
  // ══════════════════════════════════════════════════════════

  async function analyzeURL(context) {
    const online = await _ensureOnline();
    if (!online) return null;
    try {
      // Nếu cần phân tích URL chuyên sâu, gọi detectFakeNews với context URL
      if (typeof window.AIServer !== 'undefined' && typeof window.AIServer.analyzeURL === 'function') {
        return await window.AIServer.analyzeURL(context);
      }
      console.warn('[AIBackend] AIServer.analyzeURL không khả dụng');
      return null;
    } catch (err) {
      console.warn('[AIBackend] analyzeURL failed:', err.message);
      return null;
    }
  }

  async function analyzeContent(payload) {
    const { type = 'text', content, imageBase64, mimeType } = payload;

    const online = await _ensureOnline();
    console.log('[AIBackend] analyzeContent — type:', type, 'online:', online);

    if (!online) {
      console.error('[AIBackend] Backend not available');
      throw new Error('Backend required - no local fallback');
    }

    try {
      // ── IMAGE: gửi base64 lên IMAGE service ──
      if (type === 'image') {
        if (typeof window.AIServer !== 'undefined' && typeof window.AIServer.analyzeImage === 'function') {
          const b64 = imageBase64 || (typeof content === 'string' && content.includes(',')
            ? content.split(',')[1]
            : content);

          const data = await window.AIServer.analyzeImage(b64);

          if (data?.trustScore !== undefined) {
            const score = data.trustScore ?? 50;
            return {
              trustScore:  score,
              verdict:     _mapVerdict(score),
              models: [{
                modelId:    'image-service',
                name:       'Image Detection (Microservice)',
                score,
                confidence: (data.confidence ?? 70) / 100,
                label:      data.verdict,
              }],
              signals:     [{ type: 'neutral', text: data.summary || '', weight: 0.8 }],
              explanation: data.overallAssessment || data.summary || '',
              _raw: data,
            };
          }
        }
        console.error('[AIBackend] image-service failed');
        throw new Error('Image service required');
      }

      // ── TEXT ──
      if (typeof window.AIServer !== 'undefined' && typeof window.AIServer.analyzeText === 'function') {
        const data = await window.AIServer.analyzeText(content || '');

        console.log('[AIBackend] analyzeText response:', data);

        if (data?.trustScore !== undefined) {
          const score = data.trustScore ?? 50;
          return {
            trustScore:  score,
            verdict:     _mapVerdict(score),
            models: [{
              modelId:    'text-service',
              name:       'Text Detection (Microservice)',
              score,
              confidence: (data.confidence ?? 70) / 100,
              label:      data.verdict || 'UNCERTAIN',
            }],
            signals:     [{ type: 'neutral', text: data.explanation || '', weight: 0.8 }],
            explanation: data.explanation || data.summary || '',
            _raw: data,
          };
        }
      }

      console.error('[AIBackend] analyzeText failed');
      throw new Error('Text service required');

    } catch (err) {
      console.error('[AIBackend] analyzeContent failed:', err.message);
      throw err;
    }
  }

  function _mapVerdict(score) {
    if (score >= 75) return { label: 'AUTHENTIC',  color: '#22c55e', class: 'success' };
    if (score >= 50) return { label: 'SUSPICIOUS', color: '#f59e0b', class: 'warn'    };
    return              { label: 'MISLEADING',  color: '#ef4444', class: 'danger'  };
  }

  // ══════════════════════════════════════════════════════════
  //  STATUS
  // ══════════════════════════════════════════════════════════

  function getStatus() {
    return {
      ai:     { microservices: _online === true, anyAvailable: _online === true },
      domain: { virustotal: true, urlscan: true, ipinfo: true, dns: true },
      services: {
        text: 'https://text-service-glgj.onrender.com',
        fakenews: 'https://fakenews-service.onrender.com',
        image: 'https://image-lchq.onrender.com',
      },
      isOnline: _online,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  EXPORT
  // ══════════════════════════════════════════════════════════
  const AIBackend = Object.freeze({
    callAI, callAIJSON,
    dnsResolve, ipInfo,
    vtScanURL, vtDomainInfo,
    urlscanSearch, fetchSource,
    analyzeURL, analyzeContent,
    checkHealth, isOnline, getStatus,
    services: {
      TEXT: 'https://text-service-glgj.onrender.com',
      FAKENEWS: 'https://fakenews-service.onrender.com',
      IMAGE: 'https://image-lchq.onrender.com',
    },
  });

  window.AIBackend = AIBackend;

  window.callAI         = callAI;
  window.callAIJSON     = callAIJSON;
  window.callClaude     = callAI;
  window.callClaudeJSON = callAIJSON;
  window.analyzeContent = analyzeContent;

  if (!window.hashText) {
    window.hashText = async (text) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    };
  }

  window.initRealtimeScan = function (inputId, outputId) {
    const input  = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (!input || !output) return;
    let _timer = null;
    input.addEventListener('input', () => {
      clearTimeout(_timer);
      const text = input.value.trim();
      if (text.length < 30) { output.innerHTML = ''; return; }
      output.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;">⏳ Đang phân tích…</span>';
      _timer = setTimeout(async () => {
        try {
          const result = await analyzeContent({ type: 'text', content: text });
          const score  = result.trustScore;
          const color  = score >= 70 ? 'var(--accent-success)' : score >= 50 ? 'var(--accent-warn)' : 'var(--accent-danger)';
          output.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:0.75rem;">
            <div style="width:36px;height:36px;border-radius:50%;border:2.5px solid ${color};
              display:flex;align-items:center;justify-content:center;font-weight:700;
              font-size:0.8rem;color:${color};">${score}</div>
            <div><div style="font-weight:600;color:${color};">${result.verdict?.label || ''}</div>
              <div style="color:var(--text-muted);font-size:0.7rem;">Realtime scan</div></div></div>`;
        } catch {
          output.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;">Backend không khả dụng</span>';
        }
      }, 1200);
    });
  };

  checkHealth().then(ok =>
    console.log(`[AIBackend] ${ok ? '✓ Microservices Online' : '✗ Microservices Required'}`)
  );

  console.log('[AI-Gemini] v5.0 Loaded — Microservices bridge mode');

})(window);