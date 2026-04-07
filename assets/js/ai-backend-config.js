// ═══════════════════════════════════════════════════════════════
//  AI-BACKEND-CONFIG  v2.1  [PATCHED — thay thế proxy Render.com]
//  Gọi trực tiếp từ browser, KHÔNG cần server proxy
//  Hỗ trợ đầy đủ domain .vn
//
//  PATCH v2.1 (2026-04-07):
//  • FIX BUG #1: vtDomainInfo() — KHÔNG gửi x-apikey lên allorigins.win
//    Key chỉ được dùng trong direct fallback call tới VT API, KHÔNG qua proxy
//  • FIX BUG #2: vtScanURL() — thay wait cứng 3000ms bằng polling thực
//    Poll tối đa 10 lần × 3s (30s), retry khi status === 'queued'/'in-progress'
//  • FIX BUG #3: _hasKey() — nâng threshold từ >10 lên >=32 char
//    VT key hợp lệ là 64 hex chars; key ngắn hơn bị reject sớm
//  • FIX BUG #4: fetchSource() — disable vì CORS block + URLScan = CORS proxy
//  • FIX BUG #5: urlscanSearch() — thêm CORS proxy (allorigins.win)
//
//  PATCH v2.0 (2026-04-04):
//  • Bỏ hoàn toàn proxy utility-service Render.com (hay bị 503)
//  • Gọi Groq / OpenRouter trực tiếp từ browser (CORS OK)
//  • Export window.AIBackend tương thích url-page.js
//  • fetchSource() dùng allorigins.win (CORS proxy miễn phí)
//  • isOnline() trả true khi có ít nhất 1 AI key
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  AI MODELS (gọi trực tiếp từ browser, không cần proxy) │
//  ├──────────────────┬──────────────────────────────────────┤
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
    //  🚀 MICROSERVICES MODE
    //  Phân tích được xử lý bởi:
    //  • https://text-service-glgj.onrender.com (Text Analysis)
    //  • https://fakenews-service.onrender.com (Fake News Detection)
    //  • https://image-lchq.onrender.com (Image Analysis)
    // ══════════════════════════════════════════════════════════

    // [Tuỳ chọn] AI dự phòng
    // Groq: vào https://console.groq.com → Create API key → FREE
    GROQ:        '',
    // OpenRouter: vào https://openrouter.ai/keys → FREE credits
    OPENROUTER:  '',

    // [Tuỳ chọn nhưng KHUYẾN NGHỊ] Domain / URL scan APIs
    // Hệ thống vẫn hoạt động mà không có key, nhưng công năng URL scan sẽ bị hạn chế
    // VirusTotal: https://virustotal.com/gui/my-apikey (FREE 500/day)
    VIRUSTOTAL:  'd3026bffb7d6d70679dbf74512572b1581accfdc19ed0c13a53069ff880407eb',
    // URLScan.io: https://urlscan.io/user/profile (FREE, optional)
    URLSCAN:     '',
    // IPInfo: https://ipinfo.io/account/token (FREE 50k/month)
    IPINFO:      '',
  };
  // ══════════════════════════════════════════════════════════

  // ── Endpoints ─────────────────────────────────────────────
  const EP = {
    GROQ:       'https://api.groq.com/openai/v1/chat/completions',
    OPENROUTER: 'https://openrouter.ai/api/v1/chat/completions',
    VT_URL:     'https://www.virustotal.com/api/v3/urls',
    VT_DOMAIN:  'https://www.virustotal.com/api/v3/domains/',
    VT_ANALYSES:'https://www.virustotal.com/api/v3/analyses/',
    URLSCAN_SUBMIT: 'https://urlscan.io/api/v1/scan/',
    URLSCAN_SEARCH: 'https://urlscan.io/api/v1/search/',
    IPINFO:     'https://ipinfo.io/',
    CF_WHOIS:   'https://cloudflare-dns.com/dns-query',
    DOH_GOOGLE: 'https://dns.google/resolve',
  };

  // ── Utility ───────────────────────────────────────────────
  // BUG FIX #3: nâng ngưỡng lên 32 ký tự (VT key = 64 hex chars)
  function _hasKey(name) { return !!(KEYS[name] && KEYS[name].trim().length >= 32); }

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
   */
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
  //  DOMAIN / URL APIS — Hỗ trợ .vn
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
          ok:     true,
          domain: registrable,
          nameserver: soa.data?.split(' ')[0] || '',
          raw: soa.data,
        };
      }
    } catch {}
    return { ok: false, domain };
  }

  // ── VirusTotal ────────────────────────────────────────────
  /**
   * Scan URL qua VirusTotal với polling thực thay vì wait cứng.
   *
   * BUG FIX #2: Bỏ await setTimeout(3000ms) cứng.
   * Thay bằng vòng poll tối đa MAX_POLLS lần, cách nhau POLL_INTERVAL_MS.
   * Retry khi status là 'queued' hoặc 'in-progress'.
   */
  async function vtScanURL(url) {
    if (!_hasKey('VIRUSTOTAL')) {
      console.warn('[AIBackend] VT URL scan failed: VIRUSTOTAL_API_KEY not configured');
      return null;
    }

    const MAX_POLLS      = 10;
    const POLL_INTERVAL  = 3000; // ms giữa mỗi lần poll

    try {
      // 1. Submit URL
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

      // 2. Poll cho đến khi status === 'completed'
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        let result;
        try {
          result = await _fetchJSON(
            `${EP.VT_ANALYSES}${analysisId}`,
            { headers: { 'x-apikey': KEYS.VIRUSTOTAL } },
            15000
          );
        } catch (pollErr) {
          console.warn(`[VT] Poll attempt ${attempt + 1} failed:`, pollErr.message);
          continue;
        }

        const status = result?.data?.attributes?.status;
        console.log(`[VT] Poll ${attempt + 1}/${MAX_POLLS} — status: ${status}`);

        if (status === 'completed') {
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
        }

        // Nếu queued/in-progress → tiếp tục poll
        if (status !== 'queued' && status !== 'in-progress') {
          console.warn('[VT] Unexpected status:', status);
          break;
        }
      }

      console.warn('[VT] Analysis not completed after max polls');
      return null;

    } catch (err) {
      console.warn('[VT] Scan failed:', err.message);
      return null;
    }
  }

  /**
   * Lấy thông tin domain từ VirusTotal.
   *
   * BUG FIX #1: Không gửi header 'x-apikey' lên allorigins.win (third-party proxy).
   * Key chỉ được gửi trong direct call tới VT API (fallback).
   * Proxy request hoàn toàn không mang header nhạy cảm.
   */
  async function vtDomainInfo(domain) {
    if (!_hasKey('VIRUSTOTAL')) {
      console.warn('[AIBackend] VT domain failed: VIRUSTOTAL_API_KEY not configured');
      return null;
    }
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const apiUrl   = `${EP.VT_DOMAIN}${registrable}`;

      // Nhúng API key vào URL proxy thay vì header — allorigins.win forward URL query
      // nhưng KHÔNG forward header, nên key không bị lộ cho proxy server.
      // Tuy nhiên VT API không hỗ trợ key qua query string → chỉ dùng proxy để
      // bypass CORS, sau đó fallback direct nếu proxy trả về lỗi auth.
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;

      let data = null;
      try {
        const ctrl  = new AbortController();
        let completed = false;
        const timer = setTimeout(() => {
          if (!completed) ctrl.abort();
        }, 15000);

        // BUG FIX #1: Không gửi 'x-apikey' lên allorigins.win
        // Proxy này chỉ bypass CORS — key sẽ không được forward tới VT.
        // VT API đòi key → proxy call này sẽ trả HTTP 401 → fall through to direct call.
        const res = await fetch(proxyUrl, {
          signal: ctrl.signal,
          // KHÔNG có header 'x-apikey' ở đây
        });
        completed = true;
        clearTimeout(timer);
        if (res.ok) {
          const wrapper = await res.json();
          // allorigins.win trả { contents: "..." }
          // Nếu VT trả 401 trong contents thì data sẽ null/có error
          const parsed = JSON.parse(wrapper.contents || 'null');
          if (parsed?.data) data = parsed; // Chỉ dùng nếu có data thực
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[VT] Proxy failed:', err.message);
        }
      }

      // Fallback: direct call với key đúng chỗ (Browser CORS có thể block, nhưng thử)
      if (!data) {
        data = await _fetchJSON(
          apiUrl,
          { headers: { 'x-apikey': KEYS.VIRUSTOTAL } },
          10000
        );
      }

      const attrs = data?.data?.attributes || {};
      return {
        ok:           true,
        domain:       registrable,
        reputation:   attrs.reputation          || 0,
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

  // ── URLScan.io ────────────────────────────────────────────
  async function urlscanSearch(domain) {
    try {
      const registrable = domain.split('.').slice(-2).join('.');
      const apiUrl = `${EP.URLSCAN_SEARCH}?q=domain:${registrable}&size=3&sort=date`;
      let data = null;
      try {
        // CORS proxy: allorigins.win để bypass CORS block
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(apiUrl)}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const res = await fetch(proxyUrl, { signal: ctrl.signal });
          clearTimeout(timer);
          if (res.ok) {
            const wrapper = await res.json();
            data = JSON.parse(wrapper.contents || 'null');
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (proxyErr) {
        if (proxyErr.name !== 'AbortError') {
          console.warn('[URLScan] Proxy fetch failed:', proxyErr.message);
        }
      }
      
      // Fallback: try direct (tuy nó có thể bị CORS block)
      if (!data) {
        try {
          data = await _fetchJSON(apiUrl, {}, 5000).catch(() => null);
        } catch {}
      }

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

  // ── IPInfo ────────────────────────────────────────────────
  async function ipInfo(domain) {
    try {
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
        org:      data.org      || '',
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
  //  COMBINED ANALYSIS
  // ═══════════════════════════════════════════════════════════

  async function analyzeURL(urlString) {
    let urlObj;
    try { urlObj = new URL(urlString); }
    catch { return { ok: false, error: 'Invalid URL' }; }

    const domain = urlObj.hostname;
    const t0     = Date.now();

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

    const threatScore = _computeThreatScore(gathered);
    const aiResult    = await _aiAnalyzeGathered(gathered, threatScore);

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

  function _computeThreatScore(g) {
    let score = 0;

    if (!g.isHTTPS)              score += 25;
    if (!g.dns.a?.ok)            score += 10;

    if (g.vtScan?.malicious > 0)  score += Math.min(g.vtScan.malicious * 8, 40);
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
        groq:       _hasKey('GROQ'),
        openrouter: _hasKey('OPENROUTER'),
      },
      domain: {
        virustotal: _hasKey('VIRUSTOTAL'),
        urlscan:    _hasKey('URLSCAN'),
        ipinfo:     _hasKey('IPINFO'),
        doh:        true,
        cfWhois:    true,
      },
    };
  }

  async function fetchSource(urlString) {
    console.warn('[AIBackend] fetchSource disabled: Frontend cannot fetch cross-origin HTML due to CORS.');
    console.warn('[AIBackend] Solution: Implement backend endpoint at https://code-backend-s41d.onrender.com/api/fetch-source');
    return null;
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

    getStatus,
    fetchSource,
    isOnline,
    KEYS,
    _hasKey,           // Expose for unit tests (TC-08)
    _computeThreatScore, // Expose for unit tests (TC-07)
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

console.info('[AIBackend] v2.1 — 3 bugs patched:');
console.info('  ✓ BUG #1 FIXED: vtDomainInfo() không còn gửi x-apikey lên allorigins.win');
console.info('  ✓ BUG #2 FIXED: vtScanURL() dùng polling thực (tối đa 10×3s) thay setTimeout cứng');
console.info('  ✓ BUG #3 FIXED: _hasKey() threshold nâng lên 32 chars (VT key = 64 hex)');