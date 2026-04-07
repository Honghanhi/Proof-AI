// ═══════════════════════════════════════════════════════════════
//  AI-FREE-CONFIG  v1.0
//  Tích hợp AI + Domain APIs hoàn toàn MIỄN PHÍ
//  Hỗ trợ đầy đủ domain .vn
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  AI MODELS (gọi trực tiếp từ browser, không cần proxy) │
//  ├──────────────────┬──────────────────────────────────────┤
//  │ Gemini Flash     │ FREE · 1M tokens/min · CORS OK       │
//  │                  │ aistudio.google.com → Get API key    │
//  ├──────────────────┼──────────────────────────────────────┤
//  │ Groq (Llama 3)   │ FREE · 6000 tok/min · CORS OK        │
//  │                  │ console.groq.com → Get API key       │
//  ├──────────────────┼──────────────────────────────────────┤
//  │ OpenRouter       │ FREE models · No CORS block          │
//  │                  │ openrouter.ai → Get API key          │
//  ├─────────────────────────────────────────────────────────┤
//  │  DOMAIN/URL APIs (hỗ trợ .vn, không cần AI key)        │
//  ├──────────────────┬──────────────────────────────────────┤
//  │ VirusTotal       │ FREE · 500 scan/day · hỗ trợ .vn    │
//  │                  │ virustotal.com → API key             │
//  ├──────────────────┼──────────────────────────────────────┤
//  │ URLScan.io       │ FREE · 1000 scan/day · hỗ trợ .vn   │
//  │                  │ urlscan.io → API key (optional)      │
//  ├──────────────────┼──────────────────────────────────────┤
//  │ IPInfo           │ FREE · 50k/month · geo .vn           │
//  │                  │ ipinfo.io → token                    │
//  ├──────────────────┼──────────────────────────────────────┤
//  │ Cloudflare WHOIS │ FREE · không cần key · hỗ trợ .vn   │
//  └──────────────────┴──────────────────────────────────────┘
//
//  CẤU HÌNH: Chỉ cần điền API keys bên dưới.
//  Hệ thống tự fallback nếu key trống hoặc lỗi.
// ═══════════════════════════════════════════════════════════════

const AIFreeConfig = (() => {

  // ══════════════════════════════════════════════════════════
  //  ⚙️  CẤU HÌNH — ĐIỀN API KEYS VÀO ĐÂY
  // ══════════════════════════════════════════════════════════
  const KEYS = {
    // AI Models
    GEMINI:      '',   // aistudio.google.com → Create API key (FREE)
    GROQ:        '',   // console.groq.com → Create API key (FREE)
    OPENROUTER:  '',   // openrouter.ai/keys (FREE credits)

    // Domain / URL APIs
    VIRUSTOTAL:  '',   // virustotal.com/gui/my-apikey (FREE 500/day)
    URLSCAN:     '',   // urlscan.io/user/profile (FREE, optional)
    IPINFO:      '',   // ipinfo.io/account/token (FREE 50k/month)
  };
  // ══════════════════════════════════════════════════════════

  // ── Endpoints ─────────────────────────────────────────────
  const EP = {
    GEMINI:     'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    GROQ:       'https://api.groq.com/openai/v1/chat/completions',
    OPENROUTER: 'https://openrouter.ai/api/v1/chat/completions',
    VT_URL:     'https://www.virustotal.com/api/v3/urls',
    VT_DOMAIN:  'https://www.virustotal.com/api/v3/domains/',
    URLSCAN_SUBMIT: 'https://urlscan.io/api/v1/scan/',
    URLSCAN_SEARCH: 'https://urlscan.io/api/v1/search/',
    IPINFO:     'https://ipinfo.io/',
    CF_WHOIS:   'https://cloudflare-dns.com/dns-query',
    DOH_GOOGLE: 'https://dns.google/resolve',
  };

  // ── Utility ───────────────────────────────────────────────
  function _hasKey(name) { return !!(KEYS[name] && KEYS[name].trim().length > 10); }

  async function _fetchJSON(url, opts = {}, timeoutMs = 12000) {
    const ctrl  = new AbortController();
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) ctrl.abort();
    }, timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      completed = true;
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      completed = true;
      clearTimeout(timer);
      // Ignore AbortError so callers can handle gracefully
      if (err.name === 'AbortError') {
        console.warn(`[Fetch] Timeout after ${timeoutMs}ms for ${url}`);
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  AI MODELS
  // ═══════════════════════════════════════════════════════════

  // ── Groq (Llama 3.1 8B — ultrafast) ──────────────────────
  // Gọi trực tiếp từ browser — CORS OK
  async function _groq(prompt, maxTokens = 1000) {
    if (!_hasKey('GROQ')) return null;
    const data = await _fetchJSON(EP.GROQ, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${KEYS.GROQ}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:      'llama-3.1-8b-instant',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });
    return data?.choices?.[0]?.message?.content || null;
  }

  // ── OpenRouter (nhiều model free) ─────────────────────────
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

  /**
   * Gọi AI theo thứ tự ưu tiên: Groq → OpenRouter
   * Tự động fallback nếu key trống hoặc API lỗi
   * @param {string} prompt
   * @param {number} maxTokens
   * @returns {Promise<string|null>}
   */
  async function callAI(prompt, maxTokens = 1000) {
    const providers = [
      { name: 'Groq',   fn: () => _groq(prompt, maxTokens)   },
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

  /**
   * Gọi AI và parse JSON response
   */
  async function callAIJSON(prompt, maxTokens = 1000) {
    const raw = await callAI(prompt, maxTokens);
    if (!raw) return null;
    try {
      return JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      // Thử tìm JSON trong text
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
      return null;
    }
  }

  /**
   * Kiểm tra AI nào đang available
   */
  function getAvailableAI() {
    return {
      gemini:     _hasKey('GEMINI'),
      groq:       _hasKey('GROQ'),
      openrouter: _hasKey('OPENROUTER'),
      anyAvailable: _hasKey('GEMINI') || _hasKey('GROQ') || _hasKey('OPENROUTER'),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  DOMAIN / URL APIS — Hỗ trợ .vn
  // ═══════════════════════════════════════════════════════════

  // ── DNS over HTTPS (không cần key, hỗ trợ .vn) ───────────
  /**
   * Resolve DNS qua Cloudflare/Google DoH — hỗ trợ mọi TLD kể cả .vn
   * @param {string} domain
   * @param {string} type  'A' | 'MX' | 'NS' | 'TXT'
   */
  async function dnsResolve(domain, type = 'A') {
    // Thử Cloudflare DoH trước (nhanh hơn)
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
          return {
            ok:      true,
            records: data.Answer.map(r => r.data),
            type,
          };
        }
      } catch {}
    }
    return { ok: false, records: [], type };
  }

  // ── Cloudflare WHOIS (không cần key, hỗ trợ .vn) ─────────
  /**
   * Lấy WHOIS qua Cloudflare API — hỗ trợ nhiều TLD kể cả .vn
   */
  async function cfWhois(domain) {
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const data = await _fetchJSON(
        `https://cloudflare-dns.com/dns-query?name=${registrable}&type=SOA`,
        { headers: { 'Accept': 'application/dns-json' } },
        7000
      );
      // SOA record chứa thông tin về nameserver
      if (data?.Answer?.length > 0) {
        const soa = data.Answer[0];
        return {
          ok:     true,
          domain: registrable,
          nameserver: soa.data?.split(' ')[0] || '',
          raw: soa.data,
        };
      }
    } catch {}
    return { ok: false, domain };
  }

  // ── VirusTotal (500 scan/day, hỗ trợ .vn) ────────────────
  /**
   * Scan URL qua VirusTotal
   * Trả về: malicious count, harmless count, suspicious, undetected
   */
  async function vtScanURL(url) {
    if (!_hasKey('VIRUSTOTAL')) return null;
    try {
      // Submit URL
      const submitData = await _fetchJSON(EP.VT_URL, {
        method:  'POST',
        headers: {
          'x-apikey':     KEYS.VIRUSTOTAL,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `url=${encodeURIComponent(url)}`,
      }, 15000);

      const analysisId = submitData?.data?.id;
      if (!analysisId) return null;

      // Lấy kết quả (polling)
      await new Promise(r => setTimeout(r, 3000));
      const result = await _fetchJSON(
        `https://www.virustotal.com/api/v3/analyses/${analysisId}`,
        { headers: { 'x-apikey': KEYS.VIRUSTOTAL } },
        15000
      );

      const stats = result?.data?.attributes?.stats || {};
      return {
        ok:          true,
        malicious:   stats.malicious   || 0,
        suspicious:  stats.suspicious  || 0,
        harmless:    stats.harmless    || 0,
        undetected:  stats.undetected  || 0,
        totalEngines: Object.values(stats).reduce((a, b) => a + b, 0),
        threatScore:  Math.round(
          ((stats.malicious || 0) + (stats.suspicious || 0) * 0.5) /
          Math.max(1, Object.values(stats).reduce((a, b) => a + b, 0)) * 100
        ),
        source: 'VirusTotal',
      };
    } catch (err) {
      console.warn('[VT] Scan failed:', err.message);
      return null;
    }
  }

  /**
   * Lấy thông tin domain từ VirusTotal (reputation, categories)
   * Hỗ trợ .vn
   */
  async function vtDomainInfo(domain) {
    if (!_hasKey('VIRUSTOTAL')) return null;
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const data = await _fetchJSON(
        `${EP.VT_DOMAIN}${registrable}`,
        { headers: { 'x-apikey': KEYS.VIRUSTOTAL } },
        10000
      );
      const attrs = data?.data?.attributes || {};
      return {
        ok:           true,
        domain:       registrable,
        reputation:   attrs.reputation          || 0,   // -100 to +100
        categories:   Object.values(attrs.categories || {}).join(', '),
        malicious:    attrs.last_analysis_stats?.malicious  || 0,
        harmless:     attrs.last_analysis_stats?.harmless   || 0,
        suspicious:   attrs.last_analysis_stats?.suspicious || 0,
        creationDate: attrs.creation_date
          ? new Date(attrs.creation_date * 1000).toISOString().slice(0, 10)
          : null,
        registrar:    attrs.registrar || '',
        country:      attrs.country   || '',
        source:       'VirusTotal',
      };
    } catch (err) {
      console.warn('[VT] Domain info failed:', err.message);
      return null;
    }
  }

  // ── URLScan.io (1000 scan/day, hỗ trợ .vn) ───────────────
  /**
   * Tìm scan gần nhất của URL trên URLScan.io
   * Không cần API key để search (chỉ cần key để submit)
   */
  async function urlscanSearch(domain) {
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const data = await _fetchJSON(
        `${EP.URLSCAN_SEARCH}?q=domain:${registrable}&size=3&sort=date`,
        _hasKey('URLSCAN') ? { headers: { 'API-Key': KEYS.URLSCAN } } : {},
        10000
      );

      if (!data?.results?.length) return null;

      const latest = data.results[0];
      return {
        ok:          true,
        domain:      registrable,
        lastScanned: latest.task?.time,
        score:       latest.verdicts?.overall?.score || 0,
        malicious:   latest.verdicts?.overall?.malicious || false,
        tags:        latest.verdicts?.overall?.tags || [],
        screenshot:  latest.screenshot || null,
        reportURL:   `https://urlscan.io/result/${latest.task?.uuid}/`,
        country:     latest.page?.country || '',
        server:      latest.page?.server  || '',
        ip:          latest.page?.ip      || '',
        source:      'URLScan.io',
      };
    } catch (err) {
      console.warn('[URLScan] Search failed:', err.message);
      return null;
    }
  }

  /**
   * Submit URL mới để scan (cần API key)
   */
  async function urlscanSubmit(url) {
    if (!_hasKey('URLSCAN')) return null;
    try {
      const data = await _fetchJSON(EP.URLSCAN_SUBMIT, {
        method:  'POST',
        headers: {
          'API-Key':      KEYS.URLSCAN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, visibility: 'public' }),
      }, 15000);

      if (!data?.uuid) return null;

      // Đợi scan xong (15-30s)
      await new Promise(r => setTimeout(r, 20000));

      const result = await _fetchJSON(
        `https://urlscan.io/api/v1/result/${data.uuid}/`,
        { headers: { 'API-Key': KEYS.URLSCAN } },
        15000
      );

      return {
        ok:         true,
        uuid:       data.uuid,
        reportURL:  `https://urlscan.io/result/${data.uuid}/`,
        screenshot: result?.task?.screenshotURL || null,
        malicious:  result?.verdicts?.overall?.malicious || false,
        score:      result?.verdicts?.overall?.score     || 0,
        tags:       result?.verdicts?.overall?.tags      || [],
        source:     'URLScan.io',
      };
    } catch (err) {
      console.warn('[URLScan] Submit failed:', err.message);
      return null;
    }
  }

  // ── IPInfo (50k/month, geo .vn) ───────────────────────────
  /**
   * Lấy thông tin IP/geo của domain
   * Hỗ trợ .vn và mọi domain
   */
  async function ipInfo(domain) {
    try {
      // Resolve IP trước
      const dns = await dnsResolve(domain, 'A');
      if (!dns.ok || !dns.records.length) return null;

      const ip  = dns.records[0];
      const url = _hasKey('IPINFO')
        ? `${EP.IPINFO}${ip}/json?token=${KEYS.IPINFO}`
        : `${EP.IPINFO}${ip}/json`;

      const data = await _fetchJSON(url, {}, 8000);

      return {
        ok:       true,
        ip,
        hostname: data.hostname || domain,
        city:     data.city     || '',
        region:   data.region   || '',
        country:  data.country  || '',
        org:      data.org      || '',      // ASN + tên tổ chức
        timezone: data.timezone || '',
        isVPN:    data.privacy?.vpn    || false,
        isProxy:  data.privacy?.proxy  || false,
        isTor:    data.privacy?.tor    || false,
        source:   'IPInfo',
      };
    } catch (err) {
      console.warn('[IPInfo] Failed:', err.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  COMBINED ANALYSIS — Phân tích toàn diện URL/Domain
  // ═══════════════════════════════════════════════════════════

  /**
   * Phân tích toàn diện một URL — hỗ trợ .vn
   * Thu thập dữ liệu từ tất cả sources có sẵn, sau đó gọi AI
   *
   * @param {string} urlString
   * @returns {Promise<DomainAnalysis>}
   */
  async function analyzeURL(urlString) {
    let urlObj;
    try { urlObj = new URL(urlString); }
    catch { return { ok: false, error: 'Invalid URL' }; }

    const domain = urlObj.hostname;
    const t0     = Date.now();

    // Thu thập dữ liệu song song (tất cả không blocking)
    const [dnsA, dnsMX, dnsNS, dnsTXT, geo, vtDomain, vtScan, urlscan] = await Promise.allSettled([
      dnsResolve(domain, 'A'),
      dnsResolve(domain, 'MX'),
      dnsResolve(domain, 'NS'),
      dnsResolve(domain, 'TXT'),
      ipInfo(domain),
      vtDomainInfo(domain),
      vtScanURL(urlString),
      urlscanSearch(domain),
    ]);

    const get = r => r.status === 'fulfilled' ? r.value : null;

    const gathered = {
      domain,
      url: urlString,
      isHTTPS: urlObj.protocol === 'https:',
      dns: {
        a:   get(dnsA),
        mx:  get(dnsMX),
        ns:  get(dnsNS),
        txt: get(dnsTXT),
      },
      geo:      get(geo),
      vt:       get(vtDomain),
      vtScan:   get(vtScan),
      urlscan:  get(urlscan),
    };

    // Tính threat score từ data thu thập được
    const threatScore = _computeThreatScore(gathered);

    // Xây dựng context cho AI
    const aiResult = await _aiAnalyzeGathered(gathered, threatScore);

    return {
      ok: true,
      domain,
      url:        urlString,
      isHTTPS:    urlObj.protocol === 'https:',
      threatScore,
      gathered,
      aiAnalysis: aiResult,
      processingMs: Date.now() - t0,
    };
  }

  /**
   * Tính threat score từ dữ liệu đã thu thập
   */
  function _computeThreatScore(g) {
    let score = 0;

    if (!g.isHTTPS)              score += 25;
    if (!g.dns.a?.ok)            score += 10;

    // VirusTotal
    if (g.vtScan?.malicious > 0)  score += Math.min(g.vtScan.malicious * 8, 40);
    if (g.vtScan?.suspicious > 0) score += Math.min(g.vtScan.suspicious * 4, 20);
    if (g.vt?.reputation < -10)   score += 15;
    if (g.vt?.malicious > 0)      score += Math.min(g.vt.malicious * 5, 25);

    // URLScan
    if (g.urlscan?.malicious)     score += 30;
    if (g.urlscan?.score > 50)    score += Math.min(g.urlscan.score / 3, 20);

    // Geo/IP
    if (g.geo?.isVPN)             score += 10;
    if (g.geo?.isTor)             score += 25;
    if (g.geo?.isProxy)           score += 15;

    return Math.min(100, Math.round(score));
  }

  /**
   * Gọi AI để phân tích dữ liệu đã thu thập
   */
  async function _aiAnalyzeGathered(g, threatScore) {
    const context = {
      url:        g.url,
      domain:     g.domain,
      isHTTPS:    g.isHTTPS,
      threatScore,
      ip:         g.geo?.ip,
      country:    g.geo?.country || g.vt?.country,
      org:        g.geo?.org,
      isVPN:      g.geo?.isVPN,
      isTor:      g.geo?.isTor,
      vtMalicious: g.vtScan?.malicious || g.vt?.malicious || 0,
      vtSuspicious: g.vtScan?.suspicious || 0,
      vtEngines:  g.vtScan?.totalEngines,
      vtCategories: g.vt?.categories,
      vtReputation: g.vt?.reputation,
      urlscanMalicious: g.urlscan?.malicious,
      urlscanTags: g.urlscan?.tags,
      urlscanCountry: g.urlscan?.country,
      urlscanServer: g.urlscan?.server,
      hasHTTPS: g.isHTTPS,
      hasMX:    g.dns.mx?.ok && g.dns.mx?.records.length > 0,
    };

    const prompt = `Bạn là chuyên gia an ninh mạng tại Việt Nam. Phân tích URL này dựa trên dữ liệu thực:

URL: ${context.url}
Domain: ${context.domain}
HTTPS: ${context.isHTTPS ? 'Có' : 'KHÔNG'}
IP: ${context.ip || 'Không xác định'}
Quốc gia: ${context.country || 'Không rõ'}
Tổ chức/ISP: ${context.org || 'Không rõ'}
VPN/Proxy/Tor: ${context.isVPN ? 'VPN' : context.isTor ? 'TOR' : context.isProxy ? 'Proxy' : 'Không'}
VirusTotal: ${context.vtMalicious} engine phát hiện độc hại, ${context.vtSuspicious} nghi ngờ (/${context.vtEngines || '?'} engines)
VT Reputation: ${context.vtReputation ?? 'N/A'} (-100 đến +100)
VT Categories: ${context.vtCategories || 'Không rõ'}
URLScan.io: ${context.urlscanMalicious ? 'PHÁT HIỆN ĐỘC HẠI' : 'Không nguy hiểm'} | Tags: ${context.urlscanTags?.join(', ') || 'none'}
Server: ${context.urlscanServer || 'Không rõ'}
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
        gemini:     _hasKey('AIzaSyB4QDHHMr4NO-TRehkHRC27LLQc3Cr0l1c'),
        groq:       _hasKey('GROQ'),
        openrouter: _hasKey('OPENROUTER'),
      },
      domain: {
        virustotal: _hasKey('VIRUSTOTAL'),
        urlscan:    _hasKey('URLSCAN'),
        ipinfo:     _hasKey('IPINFO'),
        doh:        true,   // Luôn available
        cfWhois:    true,   // Luôn available
      },
    };
  }

  // ── Public API ─────────────────────────────────────────────
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

    getStatus,
    KEYS,
  });

})();

window.AIFreeConfig = AIFreeConfig;

// Shortcut globals tương thích với ai-proxy-config.js
window.callAI     = AIFreeConfig.callAI;
window.callAIJSON = AIFreeConfig.callAIJSON;
// callClaude → callAI alias
window.callClaude       = AIFreeConfig.callAI;
window.callClaudeJSON   = AIFreeConfig.callAIJSON;
window.callClaudeVision = async (base64, mime, prompt, max) => AIFreeConfig.callAI(prompt, max);