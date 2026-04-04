// ═══════════════════════════════════════════════════════════════
//  AI-BACKEND-CONFIG  v2.0  [PATCHED — thay thế proxy Render.com]
//  Gọi trực tiếp từ browser, KHÔNG cần server proxy
//  Hỗ trợ đầy đủ domain .vn
//
//  PATCH v2.0 (2026-04-04):
//  • Bỏ hoàn toàn proxy utility-service Render.com (hay bị 503)
//  • Gọi Gemini / Groq / OpenRouter trực tiếp từ browser (CORS OK)
//  • Sửa bug getStatus() hardcode key -> dùng KEYS.GEMINI
//  • Export window.AIBackend tương thích url-page.js
//  • fetchSource() dùng allorigins.win (CORS proxy miễn phí)
//  • isOnline() trả true khi có ít nhất 1 AI key
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

const AIBackendConfig = (() => {

  // ══════════════════════════════════════════════════════════
  //  ⚙️  CẤU HÌNH — ĐIỀN API KEYS VÀO ĐÂY
  // ══════════════════════════════════════════════════════════
  const KEYS = {
    // ══════════════════════════════════════════════════════════
    //  ⚡ ĐIỀN KEY VÀO ĐÂY — CHỈ CẦN 1 KEY GEMINI LÀ ĐỦ CHẠY
    // ══════════════════════════════════════════════════════════

    // [BẮT BUỘC - chọn 1] AI phân tích
    // Gemini: vào https://aistudio.google.com → Get API key → FREE
    GEMINI:      'AIzaSyB4QDHHMr4NO-TRehkHRC27LLQc3Cr0l1c',

    // [Tuỳ chọn] AI dự phòng
    // Groq: vào https://console.groq.com → Create API key → FREE
    GROQ:        '',
    // OpenRouter: vào https://openrouter.ai/keys → FREE credits
    OPENROUTER:  '',

    // [Tuỳ chọn] Domain / URL scan APIs
    // URLScan & VT: để trống = bỏ qua, hệ thống vẫn chạy bình thường
    // VirusTotal: https://virustotal.com/gui/my-apikey (FREE 500/day)
    VIRUSTOTAL:  '',
    // URLScan.io: https://urlscan.io/user/profile (FREE, optional)
    URLSCAN:     '',
    // IPInfo: https://ipinfo.io/account/token (FREE 50k/month)
    IPINFO:      '',
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
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  AI MODELS
  // ═══════════════════════════════════════════════════════════

  // ── Gemini Flash (Google) ──────────────────────────────────
  // Gọi trực tiếp từ browser — CORS OK
  async function _gemini(prompt, maxTokens = 1000) {
    if (!_hasKey('GEMINI')) return null;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    });
    // Retry tối đa 3 lần khi gặp 429 (rate limit)
    const delays = [0, 3000, 8000];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        console.info(`[Gemini] Rate limited, thử lại sau ${delays[i]/1000}s...`);
        await new Promise(r => setTimeout(r, delays[i]));
      }
      try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const res   = await fetch(`${EP.GEMINI}?key=${KEYS.GEMINI}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 429) {
          // Lấy retry-after nếu có
          const retryAfter = parseInt(res.headers.get('Retry-After') || '0') * 1000;
          if (i < delays.length - 1) {
            delays[i + 1] = Math.max(delays[i + 1], retryAfter || delays[i + 1]);
            continue;
          }
          throw new Error('HTTP 429 — rate limit, thử lại sau');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      } catch (err) {
        if (i === delays.length - 1) throw err;
        if (!err.message?.includes('429')) throw err; // Lỗi khác thì không retry
      }
    }
    return null;
  }

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
   * Gọi AI theo thứ tự ưu tiên: Gemini → Groq → OpenRouter
   * Tự động fallback nếu key trống hoặc API lỗi
   * @param {string} prompt
   * @param {number} maxTokens
   * @returns {Promise<string|null>}
   */
  async function callAI(prompt, maxTokens = 1000) {
    const providers = [
      { name: 'Gemini', fn: () => _gemini(prompt, maxTokens) },
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
    if (!_hasKey('VIRUSTOTAL')) {
      console.warn('[AIBackend] VT URL scan failed: VIRUSTOTAL_API_KEY not configured');
      return null;
    }
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
    if (!_hasKey('VIRUSTOTAL')) {
      console.warn('[AIBackend] VT domain failed: VIRUSTOTAL_API_KEY not configured');
      return null;
    }
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      // VT API bị CORS từ browser => dùng proxy
      const apiUrl   = `${EP.VT_DOMAIN}${registrable}`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;
      let data = null;
      try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const res   = await fetch(proxyUrl, {
          signal: ctrl.signal,
          headers: { 'x-apikey': KEYS.VIRUSTOTAL },
        });
        clearTimeout(timer);
        if (res.ok) {
          const wrapper = await res.json();
          data = JSON.parse(wrapper.contents || 'null');
        }
      } catch {}
      if (!data) data = await _fetchJSON(
        apiUrl,
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
    // URLScan.io chặn CORS khi gọi thẳng từ browser
    // => dùng allorigins.win làm CORS proxy (miễn phí)
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const apiUrl = `${EP.URLSCAN_SEARCH}?q=domain:${registrable}&size=3&sort=date`;
      // URLScan chặn CORS — dùng proxy với nhiều fallback
      let data = null;
      try {
        const raw = await _fetchViaCORSProxy(apiUrl, 12000);
        if (raw) data = JSON.parse(raw);
      } catch {}

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
        gemini:     _hasKey('GEMINI'),
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


  // ── fetchSource: tải HTML qua CORS proxy (miễn phí) ─────────
  /**
   * Tải HTML source của URL qua allorigins.win
   * Dùng khi cần scan mã nguồn mà không bị CORS block
   */
  // CORS proxy helpers — tự động fallback nếu 1 proxy bị lỗi
  function _corsProxyUrls(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    return [
      { url: `https://corsproxy.io/?${enc}`,                    json: false },
      { url: `https://api.allorigins.win/get?url=${enc}`,        json: true  },
      { url: `https://api.codetabs.com/v1/proxy?quest=${enc}`,   json: false },
      { url: `https://thingproxy.freeboard.io/fetch/${enc}`,     json: false },
    ];
  }

  async function _fetchViaCORSProxy(targetUrl, timeoutMs = 12000) {
    for (const { url, json } of _corsProxyUrls(targetUrl)) {
      try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res   = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        if (json) {
          const wrapper = await res.json();
          const text = wrapper?.contents;
          if (text && text.length > 50) return text;
        } else {
          const text = await res.text();
          if (text && text.length > 50) return text;
        }
      } catch {}
    }
    return null;
  }

  async function fetchSource(urlString) {
    const html = await _fetchViaCORSProxy(urlString, 12000);
    return html || null;
  }

  // ── isOnline: kiểm tra có AI nào available không ────────────
  function isOnline() {
    return _hasKey('GEMINI') || _hasKey('GROQ') || _hasKey('OPENROUTER');
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
    fetchSource,
    isOnline,
    KEYS,
  });

})();

window.AIFreeConfig  = AIBackendConfig;
window.AIBackend     = AIBackendConfig;  // alias cho url-page.js

// Shortcut globals tương thích với ai-proxy-config.js
window.callAI           = AIBackendConfig.callAI;
window.callAIJSON       = AIBackendConfig.callAIJSON;
window.callClaude       = AIBackendConfig.callAI;
window.callClaudeJSON   = AIBackendConfig.callAIJSON;
window.callClaudeVision = async (base64, mime, prompt, max) => AIBackendConfig.callAI(prompt, max);

// ── Tương thích với các hàm AIBackend.xxx trong url-page.js ──
// url-page.js gọi: AIBackend.dnsResolve, AIBackend.vtScanURL, v.v.
// => đã export qua window.AIBackend = AIBackendConfig ở trên

console.info('[AIBackend] v2.0 loaded — direct browser calls, no proxy needed');