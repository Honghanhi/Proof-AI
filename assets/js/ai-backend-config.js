// ═══════════════════════════════════════════════════════════════
//  AI-BACKEND-CONFIG  v3.0  [CORS FIX — Tất cả API qua backend]
//
//  PATCH v3.0 (2026-04-08):
//  • BẢO MẬT: Xóa toàn bộ API key khỏi file JS (không để key trong code)
//  • CORS FIX: vtScanURL, vtDomainInfo, urlscanSearch, ipInfo
//    → Tất cả đều gọi qua BACKEND_URL thay vì trực tiếp từ browser
//  • Các hàm DNS (Cloudflare DoH, Google DoH) vẫn gọi trực tiếp — OK vì không cần key
//  • Groq / OpenRouter vẫn gọi trực tiếp — OK vì có CORS header
//  • fetchSource() → gọi backend /api/fetch-source (không còn disable)
//  • Fallback local vẫn giữ khi backend offline (tự động)
//
//  PATCH v2.1 (2026-04-07):
//  • FIX BUG #1: vtDomainInfo() — KHÔNG gửi x-apikey lên allorigins.win
//  • FIX BUG #2: vtScanURL() — polling thực thay wait cứng 3000ms
//  • FIX BUG #3: _hasKey() — nâng threshold lên 32 chars
//
//  ┌────────────────────────────────────────────────────────────┐
//  │  AI MODELS (gọi trực tiếp — CORS OK)                      │
//  ├──────────────────┬─────────────────────────────────────────┤
//  │ Groq (Llama 3)   │ FREE · console.groq.com                 │
//  │ OpenRouter       │ FREE · openrouter.ai/keys               │
//  ├────────────────────────────────────────────────────────────┤
//  │  DOMAIN/URL APIs — Gọi qua backend (không bị CORS)        │
//  ├──────────────────┬─────────────────────────────────────────┤
//  │ VirusTotal       │ Key đặt trong Render env vars           │
//  │ URLScan.io       │ Key đặt trong Render env vars           │
//  │ IPInfo           │ Token đặt trong Render env vars         │
//  ├──────────────────┼─────────────────────────────────────────┤
//  │ DNS-over-HTTPS   │ Cloudflare / Google — gọi trực tiếp OK │
//  └──────────────────┴─────────────────────────────────────────┘
//
//  ⚙️  CẤU HÌNH:
//  1. Điền GROQ / OPENROUTER key bên dưới (gọi từ browser, CORS OK)
//  2. Đặt VIRUSTOTAL_API_KEY, URLSCAN_API_KEY, IPINFO_TOKEN
//     vào Render Dashboard → Environment Variables
//  3. KHÔNG đặt VT/URLScan/IPInfo key vào đây — ai cũng xem được!
// ═══════════════════════════════════════════════════════════════

const AIBackendConfig = (() => {

  // ══════════════════════════════════════════════════════════
  //  ⚙️  CẤU HÌNH — CHỈ ĐIỀN AI KEY VÀO ĐÂY
  //  VirusTotal / URLScan / IPInfo key → đặt trên Render env vars
  // ══════════════════════════════════════════════════════════
  const KEYS = {
    // AI models — gọi trực tiếp từ browser (CORS OK)
    // Groq: https://console.groq.com → Create API key → FREE
    GROQ:        '',
    // OpenRouter: https://openrouter.ai/keys → FREE credits
    OPENROUTER:  '',

    // ⚠️  KHÔNG điền các key này vào đây!
    // Đặt chúng vào Render Dashboard → Settings → Environment Variables:
    //   VIRUSTOTAL_API_KEY = <key của bạn>
    //   URLSCAN_API_KEY    = <key của bạn>  (optional)
    //   IPINFO_TOKEN       = <token của bạn> (optional)
    VIRUSTOTAL:  '',
    URLSCAN:     '',
    IPINFO:      '',
  };
  // ══════════════════════════════════════════════════════════

  // ── Endpoints ─────────────────────────────────────────────
  const BACKEND_URL = 'https://code-backend-s41d.onrender.com';

  const EP = {
    BACKEND_URL,
    // Các endpoint backend — VT/URLScan/IPInfo gọi qua đây
    BACKEND_VT_SCAN:    `${BACKEND_URL}/api/vt-scan`,
    BACKEND_VT_DOMAIN:  `${BACKEND_URL}/api/vt-domain`,
    BACKEND_URLSCAN:    `${BACKEND_URL}/api/urlscan`,
    BACKEND_IPINFO:     `${BACKEND_URL}/api/ipinfo`,
    BACKEND_URL_SCAN:   `${BACKEND_URL}/api/url-scan`,
    BACKEND_FETCH_SRC:  `${BACKEND_URL}/api/fetch-source`,

    // AI models — gọi trực tiếp (CORS OK)
    GROQ:       'https://api.groq.com/openai/v1/chat/completions',
    OPENROUTER: 'https://openrouter.ai/api/v1/chat/completions',

    // DNS — gọi trực tiếp (không cần key, CORS OK)
    CF_WHOIS:   'https://cloudflare-dns.com/dns-query',
    DOH_GOOGLE: 'https://dns.google/resolve',
  };

  // ── Utility ───────────────────────────────────────────────
  function _hasKey(name) { return !!(KEYS[name] && KEYS[name].trim().length >= 32); }

  async function _fetchJSON(url, opts = {}, timeoutMs = 12000) {
    const ctrl = new AbortController();
    let completed = false;
    const timer = setTimeout(() => { if (!completed) ctrl.abort(); }, timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      completed = true;
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      completed = true;
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        console.warn(`[Fetch] Timeout after ${timeoutMs}ms for ${url}`);
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  AI MODELS — gọi trực tiếp từ browser (CORS OK)
  // ═══════════════════════════════════════════════════════════

  async function _groq(prompt, maxTokens = 1000) {
    if (!_hasKey('GROQ')) return null;
    const data = await _fetchJSON(EP.GROQ, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${KEYS.GROQ}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       'llama-3.1-8b-instant',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  maxTokens,
        temperature: 0.2,
      }),
    });
    return data?.choices?.[0]?.message?.content || null;
  }

  async function _openrouter(prompt, maxTokens = 1000) {
    if (!_hasKey('OPENROUTER')) return null;
    const data = await _fetchJSON(EP.OPENROUTER, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${KEYS.OPENROUTER}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  window.location.origin,
        'X-Title':       'AI-PROOF',
      },
      body: JSON.stringify({
        model:      'meta-llama/llama-3.1-8b-instruct:free',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
    });
    return data?.choices?.[0]?.message?.content || null;
  }

  async function callAI(prompt, maxTokens = 1000) {
    const providers = [
      { name: 'Groq',       fn: () => _groq(prompt, maxTokens)       },
      { name: 'OpenRouter', fn: () => _openrouter(prompt, maxTokens) },
    ];
    for (const { name, fn } of providers) {
      try {
        const result = await fn();
        if (result) {
          console.info(`[AIFree] Using ${name}`);
          return result;
        }
      } catch (err) {
        console.warn(`[AIFree] ${name} failed:`, err.message);
      }
    }
    console.warn('[AIFree] All AI providers unavailable');
    return null;
  }

  async function callAIJSON(prompt, maxTokens = 1000) {
    const raw = await callAI(prompt, maxTokens);
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  DNS — Cloudflare / Google DoH (gọi trực tiếp, CORS OK)
  // ═══════════════════════════════════════════════════════════

  async function dnsResolve(domain, type = 'A') {
    const providers = [
      `https://cloudflare-dns.com/dns-query?name=${domain}&type=${type}`,
      `https://dns.google/resolve?name=${domain}&type=${type}`,
    ];
    for (const url of providers) {
      try {
        const data = await _fetchJSON(url, {
          headers: { 'Accept': 'application/dns-json' },
        }, 6000);
        if (data?.Status === 0 && data?.Answer?.length > 0) {
          return { ok: true, records: data.Answer.map(r => r.data), type };
        }
      } catch {}
    }
    return { ok: false, records: [], type };
  }

  async function cfWhois(domain) {
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const data = await _fetchJSON(
        `https://cloudflare-dns.com/dns-query?name=${registrable}&type=SOA`,
        { headers: { 'Accept': 'application/dns-json' } },
        7000
      );
      if (data?.Answer?.length > 0) {
        const soa = data.Answer[0];
        return {
          ok:         true,
          domain:     registrable,
          nameserver: soa.data?.split(' ')[0] || '',
          raw:        soa.data,
        };
      }
    } catch {}
    return { ok: false, domain };
  }

  // ═══════════════════════════════════════════════════════════
  //  VIRUSTOTAL — Gọi qua backend (tránh CORS, bảo mật key)
  // ═══════════════════════════════════════════════════════════

  async function vtScanURL(url) {
    try {
      const data = await _fetchJSON(EP.BACKEND_VT_SCAN, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      }, 60000); // VT polling mất ~30s

      if (!data?.ok) return null;
      return {
        ok:           true,
        malicious:    data.malicious    || 0,
        suspicious:   data.suspicious   || 0,
        harmless:     data.harmless     || 0,
        undetected:   data.undetected   || 0,
        totalEngines: data.totalEngines || 0,
        threatScore:  data.threatScore  || 0,
        source:       'VirusTotal',
      };
    } catch (err) {
      console.warn('[VT] vtScanURL via backend failed:', err.message);
      return null;
    }
  }

  async function vtDomainInfo(domain) {
    try {
      const data = await _fetchJSON(EP.BACKEND_VT_DOMAIN, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ domain }),
      }, 15000);

      if (!data?.ok) return null;
      return {
        ok:           true,
        domain:       data.domain,
        reputation:   data.reputation   || 0,
        categories:   data.categories   || '',
        malicious:    data.malicious    || 0,
        harmless:     data.harmless     || 0,
        suspicious:   data.suspicious   || 0,
        creationDate: data.creationDate || null,
        registrar:    data.registrar    || '',
        country:      data.country      || '',
        source:       'VirusTotal',
      };
    } catch (err) {
      console.warn('[VT] vtDomainInfo via backend failed:', err.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  URLSCAN.IO — Gọi qua backend
  // ═══════════════════════════════════════════════════════════

  async function urlscanSearch(domain) {
    try {
      const data = await _fetchJSON(EP.BACKEND_URLSCAN, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ domain }),
      }, 15000);

      if (!data?.ok) return null;
      return {
        ok:          true,
        domain:      data.domain,
        lastScanned: data.lastScanned,
        score:       data.score       || 0,
        malicious:   data.malicious   || false,
        tags:        data.tags        || [],
        screenshot:  data.screenshot  || null,
        reportURL:   data.reportURL   || '',
        country:     data.country     || '',
        server:      data.server      || '',
        ip:          data.ip          || '',
        source:      'URLScan.io',
      };
    } catch (err) {
      console.warn('[URLScan] urlscanSearch via backend failed:', err.message);
      return null;
    }
  }

  async function urlscanSubmit(url) {
    try {
      const data = await _fetchJSON(`${BACKEND_URL}/api/urlscan-submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      }, 35000);

      if (!data?.ok) return null;
      return {
        ok:         true,
        uuid:       data.uuid,
        reportURL:  data.reportURL,
        screenshot: data.screenshot || null,
        malicious:  data.malicious  || false,
        score:      data.score      || 0,
        tags:       data.tags       || [],
        source:     'URLScan.io',
      };
    } catch (err) {
      console.warn('[URLScan] urlscanSubmit via backend failed:', err.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  IPINFO — Gọi qua backend
  // ═══════════════════════════════════════════════════════════

  async function ipInfo(domain) {
    try {
      const data = await _fetchJSON(EP.BACKEND_IPINFO, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ domain }),
      }, 12000);

      if (!data?.ok) return null;
      return {
        ok:       true,
        ip:       data.ip,
        hostname: data.hostname || domain,
        city:     data.city     || '',
        region:   data.region   || '',
        country:  data.country  || '',
        org:      data.org      || '',
        timezone: data.timezone || '',
        isVPN:    data.isVPN    || false,
        isProxy:  data.isProxy  || false,
        isTor:    data.isTor    || false,
        source:   'IPInfo',
      };
    } catch (err) {
      console.warn('[IPInfo] ipInfo via backend failed:', err.message);
      // Fallback: gọi trực tiếp ipinfo.io (không cần key, CORS OK cho IP public)
      return await _ipInfoDirect(domain);
    }
  }

  async function _ipInfoDirect(domain) {
    try {
      const dns = await dnsResolve(domain, 'A');
      if (!dns.ok || !dns.records.length) return null;
      const ip = dns.records[0];
      const data = await _fetchJSON(`https://ipinfo.io/${ip}/json`, {}, 8000);
      return {
        ok:       true,
        ip,
        hostname: data.hostname || domain,
        city:     data.city     || '',
        region:   data.region   || '',
        country:  data.country  || '',
        org:      data.org      || '',
        timezone: data.timezone || '',
        isVPN:    data.privacy?.vpn   || false,
        isProxy:  data.privacy?.proxy || false,
        isTor:    data.privacy?.tor   || false,
        source:   'IPInfo-direct',
      };
    } catch (err) {
      console.warn('[IPInfo] Direct fallback failed:', err.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  FETCH SOURCE — Qua backend (không bị CORS)
  // ═══════════════════════════════════════════════════════════

  async function fetchSource(urlString) {
    try {
      const data = await _fetchJSON(EP.BACKEND_FETCH_SRC, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: urlString }),
      }, 15000);
      if (!data?.success) return null;
      return data.html || null;
    } catch (err) {
      console.warn('[fetchSource] Backend call failed:', err.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  COMBINED ANALYSIS
  // ═══════════════════════════════════════════════════════════

  async function analyzeURL(urlString) {
    let urlObj;
    try { urlObj = new URL(urlString); }
    catch { return { ok: false, error: 'Invalid URL' }; }

    const t0 = Date.now();

    try {
      console.log(`[AIBackend] Calling ${EP.BACKEND_URL_SCAN}`);

      let scanRes = null;
      try {
        scanRes = await _fetchJSON(EP.BACKEND_URL_SCAN, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ url: urlString, options: {} }),
        }, 60000);
        console.log('[AIBackend] Backend response:', scanRes);
      } catch (backendErr) {
        console.warn('[AIBackend] Backend failed, using local fallback:', backendErr.message);
        scanRes = await _localAnalyzeURL(urlString);
      }

      if (!scanRes?.ok) {
        return { ok: false, error: scanRes?.error || 'Unknown error in URL analysis' };
      }

      const gathered = {
        domain:  scanRes.domain,
        url:     urlString,
        isHTTPS: scanRes.isHTTPS,
        dns:     scanRes.dns,
        geo:     scanRes.geo,
        vt:      scanRes.vt,
        vtScan:  scanRes.vt,
        urlscan: scanRes.urlscan,
      };

      const threatScore = scanRes.threatScore || 0;
      console.log('[AIBackend] Running AI analysis, threat score:', threatScore);
      const aiResult = await _aiAnalyzeGathered(gathered, threatScore);

      return {
        ok:           true,
        domain:       scanRes.domain,
        url:          urlString,
        isHTTPS:      scanRes.isHTTPS,
        threatScore,
        gathered,
        aiAnalysis:   aiResult,
        processingMs: Date.now() - t0,
      };
    } catch (err) {
      console.error('[AIBackend] analyzeURL failed:', err);
      return { ok: false, error: `Error: ${err.message}` };
    }
  }

  // Fallback: gọi trực tiếp khi backend offline
  async function _localAnalyzeURL(urlString) {
    let urlObj;
    try { urlObj = new URL(urlString); }
    catch { return { ok: false, error: 'Invalid URL' }; }

    const domain = urlObj.hostname;
    console.log(`[AIBackend] Local fallback for ${domain}`);

    try {
      const [dnsA, dnsMX, dnsNS, geo, vt, urlscan] = await Promise.all([
        dnsResolve(domain, 'A').catch(() => ({ ok: false, records: [], type: 'A'  })),
        dnsResolve(domain, 'MX').catch(() => ({ ok: false, records: [], type: 'MX' })),
        dnsResolve(domain, 'NS').catch(() => ({ ok: false, records: [], type: 'NS' })),
        ipInfo(domain).catch(() => null),
        vtScanURL(urlString).catch(() => null),
        urlscanSearch(domain).catch(() => null),
      ]);

      let threatScore = 0;
      if (urlObj.protocol !== 'https:') threatScore += 25;
      if (!dnsA?.ok) threatScore += 10;
      if (vt?.malicious  > 0) threatScore += Math.min(vt.malicious  * 8, 40);
      if (vt?.suspicious > 0) threatScore += Math.min(vt.suspicious * 4, 20);
      if (urlscan?.malicious) threatScore += 30;
      if (geo?.isTor)  threatScore += 25;
      if (geo?.isVPN)  threatScore += 10;

      return {
        ok:          true,
        domain,
        url:         urlString,
        isHTTPS:     urlObj.protocol === 'https:',
        dns:         { a: dnsA, mx: dnsMX, ns: dnsNS },
        geo,
        vt,
        urlscan,
        threatScore: Math.min(100, threatScore),
      };
    } catch (err) {
      return { ok: false, error: `Local fallback failed: ${err.message}` };
    }
  }

  function _computeThreatScore(g) {
    let score = 0;
    if (!g.isHTTPS)               score += 25;
    if (!g.dns.a?.ok)             score += 10;
    if (g.vtScan?.malicious > 0)  score += Math.min(g.vtScan.malicious  * 8, 40);
    if (g.vtScan?.suspicious > 0) score += Math.min(g.vtScan.suspicious * 4, 20);
    if (g.vt?.reputation < -10)   score += 15;
    if (g.vt?.malicious > 0)      score += Math.min(g.vt.malicious * 5, 25);
    if (g.urlscan?.malicious)     score += 30;
    if (g.urlscan?.score > 50)    score += Math.min(g.urlscan.score / 3, 20);
    if (g.geo?.isVPN)             score += 10;
    if (g.geo?.isTor)             score += 25;
    if (g.geo?.isProxy)           score += 15;
    return Math.min(100, Math.round(score));
  }

  async function _aiAnalyzeGathered(g, threatScore) {
    const ctx = {
      url:              g.url,
      domain:           g.domain,
      isHTTPS:          g.isHTTPS,
      threatScore,
      ip:               g.geo?.ip,
      country:          g.geo?.country      || g.vt?.country,
      org:              g.geo?.org,
      isVPN:            g.geo?.isVPN,
      isTor:            g.geo?.isTor,
      vtMalicious:      g.vtScan?.malicious  || g.vt?.malicious  || 0,
      vtSuspicious:     g.vtScan?.suspicious || 0,
      vtEngines:        g.vtScan?.totalEngines,
      vtCategories:     g.vt?.categories,
      vtReputation:     g.vt?.reputation,
      urlscanMalicious: g.urlscan?.malicious,
      urlscanTags:      g.urlscan?.tags,
      urlscanCountry:   g.urlscan?.country,
      urlscanServer:    g.urlscan?.server,
      hasHTTPS:         g.isHTTPS,
      hasMX:            g.dns?.mx?.ok && g.dns?.mx?.records.length > 0,
    };

    const prompt = `Bạn là chuyên gia an ninh mạng tại Việt Nam. Phân tích URL này dựa trên dữ liệu thực:

URL: ${ctx.url}
Domain: ${ctx.domain}
HTTPS: ${ctx.isHTTPS ? 'Có' : 'KHÔNG'}
IP: ${ctx.ip || 'Không xác định'}
Quốc gia: ${ctx.country || 'Không rõ'}
Tổ chức/ISP: ${ctx.org || 'Không rõ'}
VPN/Proxy/Tor: ${ctx.isVPN ? 'VPN' : ctx.isTor ? 'TOR' : 'Không'}
VirusTotal: ${ctx.vtMalicious} engine phát hiện độc hại, ${ctx.vtSuspicious} nghi ngờ (/${ctx.vtEngines || '?'} engines)
VT Reputation: ${ctx.vtReputation ?? 'N/A'} (-100 đến +100)
VT Categories: ${ctx.vtCategories || 'Không rõ'}
URLScan.io: ${ctx.urlscanMalicious ? 'PHÁT HIỆN ĐỘC HẠI' : 'Không nguy hiểm'} | Tags: ${ctx.urlscanTags?.join(', ') || 'none'}
Server: ${ctx.urlscanServer || 'Không rõ'}
Điểm đe dọa tổng hợp: ${threatScore}/100

Trả về JSON (không markdown, không text khác):
{
  "verdict": "safe|caution|dangerous|phishing|malware|spam",
  "confidence": 0-100,
  "safetyScore": 0-100,
  "websiteType": "loại website 1-2 từ tiếng Việt",
  "websiteDescription": "mô tả 1 câu tiếng Việt về trang web",
  "narrative": "nhận xét 2-3 câu tiếng Việt về mức độ an toàn, dựa trên dữ liệu thực",
  "hostingInfo": "mô tả ngắn về hosting/ISP/vị trí server",
  "warnings": ["cảnh báo cụ thể từ dữ liệu thực"],
  "trustFactors": ["yếu tố tích cực nếu có"],
  "recommendations": ["khuyến nghị cho người dùng Việt Nam"],
  "isVietnamese": true/false,
  "vietnameseNotes": "ghi chú đặc biệt nếu là website Việt Nam"
}`;

    return await callAIJSON(prompt, 900);
  }

  // ═══════════════════════════════════════════════════════════
  //  STATUS
  // ═══════════════════════════════════════════════════════════

  function getStatus() {
    return {
      ai: {
        groq:       _hasKey('GROQ'),
        openrouter: _hasKey('OPENROUTER'),
      },
      domain: {
        virustotal: true, // key ở backend — luôn available nếu backend online
        urlscan:    true,
        ipinfo:     true,
        doh:        true,
        cfWhois:    true,
      },
    };
  }

  function isOnline() {
    return _hasKey('GROQ') || _hasKey('OPENROUTER');
  }

  function getAvailableAI() {
    const available = [];
    if (_hasKey('GROQ'))       available.push('Groq');
    if (_hasKey('OPENROUTER')) available.push('OpenRouter');
    return available;
  }

  return Object.freeze({
    callAI,
    callAIJSON,
    getAvailableAI,

    dnsResolve,
    cfWhois,
    vtScanURL,
    vtDomainInfo,
    urlscanSearch,
    urlscanSubmit,
    ipInfo,
    analyzeURL,
    fetchSource,

    getStatus,
    isOnline,
    KEYS,
    _hasKey,
    _computeThreatScore,
  });

})();

window.AIBackendConfig = AIBackendConfig;
window.AIFreeConfig    = AIBackendConfig;
window.AIBackend       = AIBackendConfig;

window.callAI           = AIBackendConfig.callAI;
window.callAIJSON       = AIBackendConfig.callAIJSON;
window.callClaude       = AIBackendConfig.callAI;
window.callClaudeJSON   = AIBackendConfig.callAIJSON;
window.callClaudeVision = async (base64, mime, prompt, max) => AIBackendConfig.callAI(prompt, max);

console.info('[AIBackend] v3.0 — CORS Fix + Security:');
console.info('  ✓ VT key đã xóa khỏi JS — đặt trong Render env vars');
console.info('  ✓ vtScanURL()    → backend /api/vt-scan');
console.info('  ✓ vtDomainInfo() → backend /api/vt-domain');
console.info('  ✓ urlscanSearch()→ backend /api/urlscan');
console.info('  ✓ ipInfo()       → backend /api/ipinfo');
console.info('  ✓ fetchSource()  → backend /api/fetch-source');
