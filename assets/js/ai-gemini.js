// ════════════════════════════════════════════════════════════════════
//  AI-GEMINI.JS  v4.0  — Dùng Backend Python thay vì gọi Gemini trực tiếp
//
//  Lý do: Gemini free tier bị 429 rất nhanh khi gọi từ browser.
//  Backend Python trên Render xử lý retry / fallback model đúng cách.
//
//  Backend URL: đổi BACKEND_URL bên dưới sau khi deploy lên Render
// ════════════════════════════════════════════════════════════════════

(function (window) {
  'use strict';

  // ══════════════════════════════════════════════════════════
  //  ⚙️  CẤU HÌNH — SỬA 1 DÒNG sau khi deploy Render
  // ══════════════════════════════════════════════════════════
  const BACKEND_URL = 'https://gemini-6qkf.onrender.com';  // ← đổi URL này
  const VT_KEY      = '';   // nếu muốn gọi VT trực tiếp từ browser (tuỳ chọn)
  const TIMEOUT_MS  = 35000;
  // ══════════════════════════════════════════════════════════

  let _online    = null;   // null = chưa check, true/false = đã check
  let _lastCheck = 0;

  // ── Core fetch với timeout ────────────────────────────────
  async function _post(path, body, ms = TIMEOUT_MS) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ── Health check (cache 60s) ──────────────────────────────
  async function checkHealth() {
    const now = Date.now();
    if (_online !== null && now - _lastCheck < 60000) return _online;
    try {
      const res = await fetch(`${BACKEND_URL}/health`, {
        signal: AbortSignal.timeout(8000),
      });
      _online    = res.ok;
      _lastCheck = now;
    } catch {
      _online    = false;
      _lastCheck = now;
    }
    return _online;
  }

  function isOnline() { return _online === true; }

  // ══════════════════════════════════════════════════════════
  //  AI CALLS — qua backend (không bị 429, không bị CORS)
  // ══════════════════════════════════════════════════════════

  async function callAI(prompt, maxTokens = 1000) {
    try {
      const data = await _post('/proxy/ai', {
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: Math.min(maxTokens, 1500),
      });
      return data?.text || null;
    } catch (err) {
      console.warn('[AIBackend] callAI failed:', err.message);
      return null;
    }
  }

  async function callAIJSON(prompt, maxTokens = 1000) {
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

  // ── Alias cho code cũ dùng callGemini ────────────────────
  async function callGemini(prompt, maxTokens = 1000) {
    return await callAI(prompt, maxTokens);
  }
  async function callGeminiJSON(prompt, maxTokens = 1000) {
    return await callAIJSON(prompt, maxTokens);
  }

  // ══════════════════════════════════════════════════════════
  //  DOMAIN APIs — qua backend (không CORS, không 403)
  // ══════════════════════════════════════════════════════════

  async function dnsResolve(domain, type = 'A') {
    try {
      return await _post('/proxy/dns', { domain, type }, 8000);
    } catch (err) {
      console.warn('[AIBackend] DNS failed:', err.message);
      return { ok: false, records: [], answers: [], domain, type };
    }
  }

  async function ipInfo(domain) {
    try {
      const data = await _post('/proxy/ipinfo', { domain }, 10000);
      return data?.ok ? data : null;
    } catch (err) {
      console.warn('[AIBackend] ipInfo failed:', err.message);
      return null;
    }
  }

  async function vtScanURL(url) {
    try {
      const data = await _post('/proxy/virustotal/url', { url }, 20000);
      return data?.ok ? data : null;
    } catch (err) {
      console.warn('[AIBackend] VT URL failed:', err.message);
      return null;
    }
  }

  async function vtDomainInfo(domain) {
    try {
      const data = await _post('/proxy/virustotal/domain', { domain }, 12000);
      return data?.ok ? data : null;
    } catch (err) {
      console.warn('[AIBackend] VT domain failed:', err.message);
      return null;
    }
  }

  async function urlscanSearch(domain) {
    try {
      const data = await _post('/proxy/urlscan', { domain }, 12000);
      return data?.ok ? data : null;
    } catch (err) {
      console.warn('[AIBackend] URLScan failed:', err.message);
      return null;
    }
  }

  async function fetchSource(url) {
    try {
      const data = await _post('/proxy/allorigins', { url }, 14000);
      return data?.ok ? data.html : '';
    } catch (err) {
      console.warn('[AIBackend] fetchSource failed:', err.message);
      return '';
    }
  }

  // ══════════════════════════════════════════════════════════
  //  ANALYZE — shortcut gọi backend analyze
  // ══════════════════════════════════════════════════════════

  async function analyzeURL(context) {
    try {
      const data = await _post('/analyze/url', context, 30000);
      return data?.ok ? data : null;
    } catch (err) {
      console.warn('[AIBackend] analyzeURL failed:', err.message);
      return null;
    }
  }

  async function analyzeContent(payload) {
    const { type, content } = payload;
    try {
      const data = await _post('/analyze/text', {
        text:  content || '',
        title: payload.title || '',
      }, 30000);
      if (!data?.ok) return _localFallback(content);
      // Map về format mà analyze-page.js expect
      return {
        trustScore:  data.trustScore  || (100 - (data.fakePct || 50)),
        verdict:     _mapVerdict(data.trustScore || 50),
        models: [{
          modelId: 'gemini-backend', name: 'Gemini (Backend)',
          score: data.trustScore || 50, confidence: (data.confidence || 70) / 100,
          label: data.verdict,
        }],
        signals: [
          { type: 'neutral', text: data.summary || '', weight: 0.8 },
        ],
        explanation: data.overallAssessment || data.summary || '',
        _raw: data,
      };
    } catch (err) {
      console.warn('[AIBackend] analyzeContent failed:', err.message);
      return _localFallback(content);
    }
  }

  function _mapVerdict(score) {
    if (score >= 75) return { label: 'AUTHENTIC',  color: '#22c55e', class: 'success' };
    if (score >= 50) return { label: 'SUSPICIOUS', color: '#f59e0b', class: 'warn'    };
    return              { label: 'MISLEADING',  color: '#ef4444', class: 'danger'  };
  }

  function _localFallback(content) {
    const text  = (content || '').toLowerCase();
    let score   = 65;
    ['fake','hoax','scam','giả mạo','lừa đảo','cờ bạc','casino','18+','urgent','breaking']
      .forEach(w => { if (text.includes(w)) score -= 8; });
    ['official','verified','chính thức','xác nhận','nghiên cứu']
      .forEach(w => { if (text.includes(w)) score += 5; });
    score = Math.max(10, Math.min(95, score));
    return {
      trustScore:  score,
      verdict:     _mapVerdict(score),
      models:      [{ modelId: 'local', name: 'Local Heuristic', score, confidence: 0.4 }],
      signals:     [{ type: 'neutral', text: 'Backend không khả dụng — phân tích cục bộ', weight: 0.3 }],
      explanation: `Phân tích cục bộ (backend offline). Điểm: ${score}/100.`,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  STATUS
  // ══════════════════════════════════════════════════════════

  function getStatus() {
    return {
      ai:     { gemini: _online === true, groq: false, openrouter: false, anyAvailable: _online === true },
      domain: { virustotal: true, urlscan: true, ipinfo: true, dns: true },
      baseURL: BACKEND_URL,
      isOnline: _online,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  AIServer compat (fakenews-page.js legacy)
  // ══════════════════════════════════════════════════════════
  const AIServer = {
    isReachable:   () => _online === true,
    healthCheck:   checkHealth,
    detectFakeNews: async (text) => {
      const data = await _post('/analyze/text', { text: text.slice(0, 2500) }, 30000);
      return {
        fakePct:    data.fakePct  ?? 50,
        realPct:    data.realPct  ?? 50,
        aiPct:      data.fakePct  ?? 50,
        humanPct:   data.realPct  ?? 50,
        confidence: (data.confidence ?? 70) / 100,
        verdict:    data.verdict,
        overallAssessment: data.overallAssessment,
        aiAnalysis: data,
        _source:    'Gemini via Backend',
      };
    },
  };

  // ══════════════════════════════════════════════════════════
  //  EXPORT
  // ══════════════════════════════════════════════════════════
  const AIBackend = Object.freeze({
    callAI, callAIJSON,
    callGemini, callGeminiJSON,
    dnsResolve, ipInfo,
    vtScanURL, vtDomainInfo,
    urlscanSearch, fetchSource,
    analyzeURL, analyzeContent,
    checkHealth, isOnline, getStatus,
    BASE: BACKEND_URL,
  });

  window.AIBackend  = AIBackend;
  window.AIServer   = AIServer;

  // Global aliases
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

  // Warm-up (non-blocking)
  checkHealth().then(ok =>
    console.log(`[AIBackend] ${ok ? '✓ Online' : '✗ Offline (fallback mode)'} — ${BACKEND_URL}`)
  );

  console.log('[AI-Gemini] v4.0 Loaded — Backend mode');

})(window);