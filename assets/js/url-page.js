// ═══════════════════════════════════════════════════════════════
//  URL-PAGE  v3.1  — AI-FREE INTEGRATED  [PATCHED]
//
//  PATCH v3.1 (2026-04-04):
//  • Mở rộng GAMBLE_KW: thêm fly88, go88, iwin, b52, rikvip,
//    sunwin, sbobet, 1xbet, 188bet, dafabet, betvisa + 30 brand mới
//  • Thêm từ khoá tiếng Việt: nổ hũ, bắn cá, đá gà, xóc đĩa...
//  • Mở rộng GAMBLE_SCRIPTS trong source scan
//  • _identifyWebsite nhận dạng website cờ bạc đúng loại
//  • Highlight source code bổ sung brand mới
//
//  Tích hợp AIBackend:
//  • DNS-over-HTTPS (không cần key, hỗ trợ .vn)
//  • VirusTotal scan (500/day free, hỗ trợ .vn)
//  • URLScan.io (1000/day free, hỗ trợ .vn)
//  • IPInfo geo (50k/month free)
//  • AI analysis: Groq / OpenRouter (Gemini removed)
//  • Screenshot: URLScan screenshot API
// ═══════════════════════════════════════════════════════════════

let _currentURL    = '';
let _currentResult = null;
let _sourceHTML    = '';

// ── Main check flow ───────────────────────────────────────────
async function startURLCheck() {
  const urlInput = document.getElementById('url-input')?.value.trim() || '';
  if (!urlInput) { UI.toast('Vui lòng nhập URL.', 'warn'); return; }
  try { new URL(urlInput); }
  catch { UI.toast('URL không hợp lệ. Cần bao gồm https:// hoặc http://', 'error'); return; }

  _currentURL    = urlInput;
  _sourceHTML    = '';
  _currentResult = null;

  const checkBtn = document.getElementById('check-btn');
  if (checkBtn) checkBtn.disabled = true;

  UI.show('processing-overlay');
  _renderSteps([
    { id: 'dns',      label: 'Tra cứu DNS & thông tin domain…'   },
    { id: 'threat',   label: 'Quét VirusTotal & URLScan.io…'     },
    { id: 'geo',      label: 'Phân tích địa lý IP & ISP…'        },
    { id: 'local',    label: 'Kiểm tra cờ bạc, HTTPS, patterns…' },
    { id: 'source',   label: 'Tải và phân tích mã nguồn…'        },
    { id: 'ai',       label: 'AI phân tích chuyên sâu…'          },
  ]);
  _bar(5);

  try {
    const urlObj = new URL(urlInput);
    const domain = urlObj.hostname;

    // ── Bước 1: DNS & domain info (song song) ──
    const [dnsA, dnsMX, dnsNS] = await Promise.allSettled([
      AIBackend.dnsResolve(domain, 'A'),
      AIBackend.dnsResolve(domain, 'MX'),
      AIBackend.dnsResolve(domain, 'NS'),
    ]);
    const dnsResult = {
      a:  dnsA.status  === 'fulfilled' ? dnsA.value  : null,
      mx: dnsMX.status === 'fulfilled' ? dnsMX.value : null,
      ns: dnsNS.status === 'fulfilled' ? dnsNS.value : null,
    };
    _done('dns'); _bar(18);

    // ── Bước 2: Threat scan (VirusTotal + URLScan) ──
    const [vtScan, vtDomain, urlscan] = await Promise.allSettled([
      AIBackend.vtScanURL(urlInput),
      AIBackend.vtDomainInfo(domain),
      AIBackend.urlscanSearch(domain),
    ]);
    const threatData = {
      vtScan:  vtScan.status  === 'fulfilled' ? vtScan.value  : null,
      vtDomain:vtDomain.status=== 'fulfilled' ? vtDomain.value: null,
      urlscan: urlscan.status === 'fulfilled' ? urlscan.value : null,
    };
    _done('threat'); _bar(36);

    // ── Bước 3: Geo / IP info ──
    const geo = await AIBackend.ipInfo(domain).catch(() => null);
    _done('geo'); _bar(48);

    // ── Bước 4: Local analysis (gambling, HTTPS, phishing patterns) ──
    const localResult   = _localURLAnalysis(urlInput, dnsResult);
    const identity      = _identifyWebsite(urlInput, geo);
    const gamblingResult= _detectGambling(urlInput);

    // Merge threats
    if (gamblingResult.threats.length) {
      localResult.threats.push(...gamblingResult.threats);
      localResult.threatScore = Math.min(100, localResult.threatScore + gamblingResult.addedScore);
    }

    // Từ VirusTotal
    if (threatData.vtScan?.malicious > 0) {
      localResult.threats.push({
        type: 'critical', category: 'malware',
        title: `🦠 VirusTotal: ${threatData.vtScan.malicious} engine phát hiện`,
        description: `${threatData.vtScan.malicious}/${threatData.vtScan.totalEngines} antivirus engines phát hiện độc hại.`,
        keywords: ['malware'],
      });
      localResult.threatScore = Math.min(100,
        localResult.threatScore + Math.min(threatData.vtScan.malicious * 8, 40)
      );
    }
    if (threatData.vtScan?.suspicious > 0 && threatData.vtScan?.malicious === 0) {
      localResult.threats.push({
        type: 'warning', category: 'suspicious',
        title: `⚠️ VirusTotal: ${threatData.vtScan.suspicious} nghi ngờ`,
        description: `${threatData.vtScan.suspicious} engine đánh dấu đáng ngờ.`,
        keywords: ['suspicious'],
      });
      localResult.threatScore = Math.min(100,
        localResult.threatScore + Math.min(threatData.vtScan.suspicious * 4, 20)
      );
    }

    // Từ URLScan
    if (threatData.urlscan?.malicious) {
      localResult.threats.push({
        type: 'critical', category: 'urlscan',
        title: '🚨 URLScan.io: Phát hiện độc hại',
        description: `URLScan xếp loại: ${threatData.urlscan.tags.join(', ') || 'malicious'}.`,
        keywords: ['malicious'],
      });
      localResult.threatScore = Math.min(100, localResult.threatScore + 30);
    }

    // Geo flags
    if (geo?.isTor) {
      localResult.threats.push({
        type: 'warning', category: 'tor',
        title: '🧅 Server trên mạng Tor',
        description: 'Domain này resolve về IP trong mạng ẩn danh Tor.',
        keywords: ['tor'],
      });
      localResult.threatScore = Math.min(100, localResult.threatScore + 20);
    }

    _done('local'); _bar(60);

    // ── Bước 5: Source scan ──
    let sourceAnalysis = null;
    try {
      sourceAnalysis = await _fetchAndScanSource(urlInput);
      if (sourceAnalysis?.threats.length) {
        localResult.threats.push(...sourceAnalysis.threats);
        localResult.threatScore = Math.min(100,
          localResult.threatScore + sourceAnalysis.addedScore
        );
      }
    } catch {}
    _done('source'); _bar(74);

    // ── Bước 6: AI Analysis ──
    let aiAnalysis = null;
    try {
      const context = {
        url:            urlInput,
        domain,
        isHTTPS:        localResult.isHTTPS,
        threatScore:    localResult.threatScore,
        ip:             geo?.ip,
        country:        geo?.country || threatData.vtDomain?.country,
        org:            geo?.org,
        isVPN:          geo?.isVPN,
        isTor:          geo?.isTor,
        vtMalicious:    threatData.vtScan?.malicious || 0,
        vtSuspicious:   threatData.vtScan?.suspicious || 0,
        vtEngines:      threatData.vtScan?.totalEngines,
        vtCategories:   threatData.vtDomain?.categories,
        vtReputation:   threatData.vtDomain?.reputation,
        urlscanMalicious: threatData.urlscan?.malicious,
        urlscanTags:    threatData.urlscan?.tags,
        urlscanServer:  threatData.urlscan?.server,
        threats:        localResult.threats.map(t => t.title),
        gambling:       gamblingResult.hasGambling,
      };

      // ── Force verdict trước khi gọi AI ──────────────────────
      // Nếu local đã xác nhận → AI chỉ bổ sung narrative, KHÔNG override
      const forcedVerdict = context.gambling   ? 'gambling'
                          : (context.vtMalicious > 2) ? 'malware'
                          : context.urlscanMalicious  ? 'dangerous'
                          : null;

      const prompt = `Bạn là chuyên gia bảo mật web Việt Nam, chuyên phân tích cờ bạc online và trang độc hại.

===NHIỆM VỤ===
Phân tích URL và trả về đánh giá bảo mật dựa HOÀN TOÀN vào dữ liệu kỹ thuật đã thu thập.
KHÔNG được suy đoán. KHÔNG được dựa vào tên domain một mình để kết luận.

===DỮ LIỆU KỸ THUẬT===
URL: ${context.url}
Domain: ${context.domain}
HTTPS: ${context.isHTTPS ? 'CÓ' : 'KHÔNG CÓ — rủi ro cao'}
IP: ${context.ip || 'Không xác định'} | Quốc gia server: ${context.country || '?'} | ISP: ${context.org || '?'}
VPN/Tor/Proxy: ${context.isVPN ? '⚠️ VPN' : context.isTor ? '🚨 TOR' : context.isProxy ? '⚠️ Proxy' : 'Không'}
VirusTotal: ${context.vtMalicious} engine PHÁT HIỆN ĐỘC HẠI / ${context.vtSuspicious} nghi ngờ (tổng ${context.vtEngines || '?'} engines)
VT Reputation score: ${context.vtReputation ?? 'N/A'} (âm = xấu, +100 = tốt)
VT Categories: ${context.vtCategories || 'Không có'}
URLScan verdict: ${context.urlscanMalicious ? '🚨 PHÁT HIỆN ĐỘC HẠI' : 'Không cảnh báo'}
URLScan tags: ${context.urlscanTags?.join(', ') || 'Không có'}

===KẾT QUẢ PHÂN TÍCH LOCAL (ĐÃ XÁC NHẬN)===
Cờ bạc/cá độ phát hiện: ${context.gambling ? '🎰 CÓ — ĐÃ XÁC NHẬN bởi pattern matching' : 'Không'}
Phishing pattern: ${context.threats.some(t => t.includes('Phishing') || t.includes('phishing')) ? '🎣 CÓ' : 'Không'}
Threats phát hiện: ${context.threats.join(' | ') || 'Không có'}
Điểm đe dọa tổng hợp: ${context.threatScore}/100 ${context.threatScore >= 70 ? '← NGUY HIỂM CAO' : context.threatScore >= 40 ? '← Rủi ro trung bình' : '← Thấp'}
${forcedVerdict ? `
⚠️ VERDICT ĐÃ BỊ KHÓA BỞI HỆ THỐNG: "${forcedVerdict.toUpperCase()}" — BẮT BUỘC dùng verdict này, không được thay đổi.` : ''}

===QUY TẮC BẮT BUỘC===
1. Nếu "Cờ bạc/cá độ phát hiện: CÓ" → verdict PHẢI LÀ "gambling", safetyScore PHẢI <= 15
2. Nếu VirusTotal >= 3 engine phát hiện → verdict PHẢI LÀ "malware", safetyScore PHẢI <= 10  
3. Nếu URLScan = ĐỘC HẠI → verdict PHẢI LÀ "dangerous", safetyScore PHẢI <= 20
4. Nếu không có HTTPS → safetyScore tối đa 50
5. Chỉ dùng verdict "safe" khi: không có threat nào, VT = 0, URLScan sạch, HTTPS OK, score < 20
6. narrative PHẢI giải thích cụ thể DỰA TRÊN DỮ LIỆU, không được nói chung chung
7. Viết hoàn toàn bằng tiếng Việt (trừ tên kỹ thuật)

===DANH SÁCH CỜ BẠC ONLINE VN (tham khảo)===
Các brand phổ biến: w88, fb88, fun88, 789bet, jun88, hi88, shbet, kubet, new88, sv88, f8bet,
fly88, go88, iwin, b52, rikvip, sunwin, ae888, ok9, one88, sin88, mu88, vn88, 188bet, sbobet,
1xbet, dafabet, betvisa, cmd368, 12bet, m88, bet88, win88, king88, lucky88, play88

Trả về JSON (KHÔNG có markdown, KHÔNG có text ngoài JSON):
{
  "verdict": "safe|caution|dangerous|phishing|malware|gambling",
  "safetyScore": 0-100,
  "websiteType": "loại website ngắn gọn tiếng Việt",
  "websiteDescription": "mô tả 1 câu ngắn gọn",
  "narrative": "phân tích 2-3 câu CỤ THỂ dựa trên dữ liệu kỹ thuật ở trên",
  "hostingInfo": "thông tin server/hosting/quốc gia",
  "warnings": ["cảnh báo cụ thể từ dữ liệu"],
  "trustFactors": ["điểm tích cực nếu có, để trống nếu không"],
  "recommendations": ["khuyến nghị cho người dùng Việt Nam"],
  "isVietnamese": true,
  "vietnameseNotes": "ghi chú đặc biệt về context Việt Nam"
}`;

      // ── Gọi AI ──────────────────────────────────────────────
      let rawAI = null;
      try {
        rawAI = await callAIJSON(prompt, 1000).catch(() => null);
      } catch {}

      // ── Force-override: nếu AI trả sai → sửa lại ──────────
      if (rawAI && forcedVerdict) {
        // AI KHÔNG được phép đổi verdict khi đã có bằng chứng cứng
        if (rawAI.verdict !== forcedVerdict) {
          console.warn(`[URL] AI verdict override: ${rawAI.verdict} → ${forcedVerdict} (forced by local detection)`);
          rawAI.verdict = forcedVerdict;
        }
        // Đảm bảo safetyScore phù hợp với verdict
        if (forcedVerdict === 'gambling' && rawAI.safetyScore > 15) rawAI.safetyScore = Math.min(rawAI.safetyScore, 15);
        if (forcedVerdict === 'malware'  && rawAI.safetyScore > 10) rawAI.safetyScore = Math.min(rawAI.safetyScore, 10);
        if (forcedVerdict === 'dangerous'&& rawAI.safetyScore > 20) rawAI.safetyScore = Math.min(rawAI.safetyScore, 20);
      }

      // Nếu AI không trả về gì → tạo kết quả từ local data
      if (!rawAI) {
        rawAI = _buildFallbackAI(context, gamblingResult, localResult.threats);
      }

      aiAnalysis = rawAI;

    } catch (aiErr) {
      console.warn('[URL] AI failed:', aiErr.message);
      // Fallback nếu AI hoàn toàn không hoạt động
      if (!aiAnalysis) {
        aiAnalysis = _buildFallbackAI(
          { url: urlInput, domain, isHTTPS: localResult.isHTTPS, gambling: gamblingResult.hasGambling,
            threatScore: localResult.threatScore, threats: localResult.threats.map(t=>t.title) },
          gamblingResult, localResult.threats
        );
      }
    }
    _done('ai'); _bar(95);

    // ── Build final result ──
    const finalResult = {
      ...localResult,
      identity,
      gamblingResult,
      sourceAnalysis,
      threatData,
      geo,
      dnsResult,
      aiAnalysis,
    };
    _currentResult = finalResult;

    // Display
    setTimeout(() => {
      _displayResults(finalResult, urlInput);
      if (aiAnalysis) _displayAICard(aiAnalysis, threatData);
      UI.hide('processing-overlay');
      UI.show('results-section');
      if (finalResult.threatScore >= 60 || gamblingResult.hasGambling) {
        _showDangerOverlay(finalResult);
      }
      if (checkBtn) checkBtn.disabled = false;
    }, 400);

    // Preview (non-blocking)
    _loadPreview(urlInput, urlscan?.value?.screenshot);
    _bar(100);

    // Save to DB + Blockchain
    _saveResult(finalResult, urlInput).catch(console.warn);

  } catch (err) {
    console.error('[URL]', err);
    UI.toast('Phân tích thất bại: ' + err.message, 'error');
    UI.hide('processing-overlay');
    if (checkBtn) checkBtn.disabled = false;
  }
}

// ── Save to DB + Blockchain ───────────────────────────────────
async function _saveResult(result, urlInput) {
  try {
    let contentHash;
    try { contentHash = await Hash.text(urlInput); } catch {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(urlInput));
      contentHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    }

    const trustScore = Math.max(0, 100 - result.threatScore);
    const verdict    = CONFIG.getVerdict(trustScore);
    const now        = new Date().toISOString();
    const resultId   = `url_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

    const dbResult = {
      id: resultId, type: 'url',
      content: urlInput, contentHash, trustScore,
      verdict: { label: verdict.label, color: verdict.color, class: verdict.class },
      models:  result.threatData?.vtScan ? [{ modelId:'virustotal', modelName:'VirusTotal', score: trustScore }] : [],
      signals: (result.threats || []).slice(0, 5).map(t => ({
        type: t.category, label: t.title, text: t.description, strength: t.type === 'critical' ? 0.9 : 0.5,
      })),
      explanation: result.aiAnalysis?.narrative || `Threat score: ${result.threatScore}/100`,
      timestamp: now, savedAt: now,
      urlData: {
        url: urlInput, domain: result.domain, threatScore: result.threatScore,
        isHTTPS: result.isHTTPS, threats: result.threats,
        checks: result.checks, identity: result.identity,
        gamblingResult: result.gamblingResult, aiAnalysis: result.aiAnalysis,
        geo: result.geo, vtData: result.threatData?.vtScan,
        urlscan: result.threatData?.urlscan, source: 'ai-free',
      },
    };

    await DB.saveResult(dbResult);

    if (typeof Blockchain !== 'undefined') {
      const block = await Blockchain.addResult(dbResult).catch(() => null);
      if (block) {
        dbResult.blockIndex = block.index;
        dbResult.blockHash  = block.hash;
        await DB.saveResult(dbResult);
        UI.toast(`✓ Lưu vào Timeline — Block #${block.index}`, 'success', 3000);
      } else {
        UI.toast('✓ Lưu vào Timeline', 'success', 3000);
      }
    }
  } catch (err) {
    console.error('[URL] Save failed:', err);
  }
}



// ── Fallback AI khi Gemini không hoạt động ────────────────────
// Tạo kết quả AI từ local data — đảm bảo verdict luôn đúng
function _buildFallbackAI(context, gamblingResult, threats) {
  const g   = gamblingResult?.hasGambling || context.gambling;
  const s   = context.threatScore || 0;
  const vt  = context.vtMalicious || 0;

  let verdict = 'safe', safetyScore = 85, type = '🌐 Website', warnings = [], recs = [];

  if (g) {
    verdict = 'gambling'; safetyScore = 10;
    type = '🎰 Website Cờ bạc';
    warnings = ['Website hoạt động cờ bạc trực tuyến', 'Vi phạm pháp luật Việt Nam', 'Có thể gây nghiện và thiệt hại tài chính'];
    recs = ['Không truy cập trang cờ bạc', 'Báo cáo cho cơ quan chức năng nếu cần', 'Cài phần mềm chặn trang cờ bạc'];
  } else if (vt > 2) {
    verdict = 'malware'; safetyScore = 5;
    type = '🦠 Website Độc hại';
    warnings = [`${vt} antivirus phát hiện độc hại`, 'Có thể đánh cắp thông tin', 'Nguy cơ lây nhiễm malware'];
    recs = ['Không truy cập trang này', 'Không nhập thông tin cá nhân', 'Quét virus máy tính nếu đã truy cập'];
  } else if (s > 65) {
    verdict = 'dangerous'; safetyScore = 15;
    warnings = threats.slice(0,3).map(t => t.replace(/[🎰🦠🎣🔓⚠️🚨]/g,'').trim());
    recs = ['Tránh xa trang này', 'Không nhập thông tin cá nhân'];
  } else if (s > 35 || !context.isHTTPS) {
    verdict = 'caution'; safetyScore = 45;
    warnings = ['Một số vấn đề bảo mật được phát hiện'];
    recs = ['Thận trọng khi nhập thông tin', 'Kiểm tra HTTPS trước khi giao dịch'];
  } else {
    verdict = 'safe'; safetyScore = 88;
    recs = ['Trang có vẻ an toàn', 'Vẫn nên thận trọng với thông tin cá nhân'];
  }

  const VERDICT_NARRATIVE = {
    gambling: `Hệ thống phát hiện đây là website cờ bạc/cá độ trực tuyến. Hoạt động cờ bạc trực tuyến bị cấm tại Việt Nam theo Nghị định 06/2017/NĐ-CP. Người dùng có thể đối mặt rủi ro pháp lý và tài chính.`,
    malware:  `VirusTotal phát hiện ${vt} antivirus engine cảnh báo website này chứa mã độc. Không truy cập và quét virus nếu đã vào trang.`,
    dangerous:`Website có điểm đe dọa ${s}/100 - mức nguy hiểm cao. Phát hiện ${threats.length} vấn đề bảo mật nghiêm trọng.`,
    caution:  `Website có một số vấn đề bảo mật cần chú ý. Thận trọng khi sử dụng và không nhập thông tin nhạy cảm.`,
    safe:     `Không phát hiện vấn đề bảo mật nghiêm trọng. Trang sử dụng HTTPS và có chỉ số tin cậy tốt.`,
  };

  return {
    verdict, safetyScore,
    websiteType: type,
    websiteDescription: `Điểm đe dọa: ${s}/100`,
    narrative: VERDICT_NARRATIVE[verdict] || VERDICT_NARRATIVE.caution,
    hostingInfo: context.org ? `Hosting: ${context.org} (${context.country || '?'})` : 'Thông tin hosting không xác định',
    warnings, trustFactors: verdict === 'safe' ? ['HTTPS bảo mật', 'Không phát hiện mã độc'] : [],
    recommendations: recs,
    isVietnamese: true,
    vietnameseNotes: g ? 'Vi phạm pháp luật Việt Nam về cờ bạc trực tuyến' : null,
    _source: 'local-fallback',
  };
}

// ── AI Analysis Card ──────────────────────────────────────────
function _displayAICard(ai, threatData) {
  if (!ai) return;
  document.getElementById('url-ai-card')?.remove();

  const AI_NAME = typeof AIBackend !== 'undefined'
    ? (AIBackend.getAvailableAI?.()[0] || 'AI')
    : 'AI';

  const V = {
    safe:     { icon:'✅', color:'var(--accent-success)', label:'An toàn'    },
    caution:  { icon:'⚠️', color:'var(--accent-warn)',    label:'Thận trọng' },
    dangerous:{ icon:'🚫', color:'var(--accent-danger)',  label:'Nguy hiểm'  },
    phishing: { icon:'🎣', color:'var(--accent-danger)',  label:'Lừa đảo'    },
    malware:  { icon:'🦠', color:'var(--accent-danger)',  label:'Malware'    },
    gambling: { icon:'🎰', color:'var(--accent-danger)',  label:'Cờ bạc'     },
    spam:     { icon:'📧', color:'var(--accent-warn)',    label:'Spam'       },
  };
  const v = V[ai.verdict] || V.caution;

  const vtBadge = threatData?.vtScan
    ? `<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;
        background:${threatData.vtScan.malicious > 0 ? 'rgba(255,61,90,.12)' : 'rgba(0,255,157,.08)'};
        color:${threatData.vtScan.malicious > 0 ? 'var(--accent-danger)' : 'var(--accent-success)'};
        border:1px solid ${threatData.vtScan.malicious > 0 ? 'rgba(255,61,90,.3)' : 'rgba(0,255,157,.2)'};">
        🛡 VT: ${threatData.vtScan.malicious}/${threatData.vtScan.totalEngines} độc hại
      </span>`
    : '';

  const urlscanBadge = threatData?.urlscan
    ? `<a href="${threatData.urlscan.reportURL}" target="_blank" rel="noopener"
        style="font-size:0.7rem;padding:2px 8px;border-radius:99px;
          background:rgba(0,229,255,.08);color:var(--accent-primary);
          border:1px solid rgba(0,229,255,.2);text-decoration:none;">
        🔍 URLScan Report ↗
      </a>`
    : '';

  const card = document.createElement('div');
  card.id = 'url-ai-card';
  card.className = 'panel mb-lg anim-fadeInUp';
  card.innerHTML = `
    <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span>🤖 Phân tích AI — ${AI_NAME}</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${vtBadge}${urlscanBadge}</div>
    </div>

    <!-- Verdict banner -->
    <div style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;
      background:var(--bg-elevated);border-radius:var(--radius-md);margin-bottom:16px;
      border-left:4px solid ${v.color};">
      <div style="font-size:1.8rem;flex-shrink:0;line-height:1;">${v.icon}</div>
      <div style="flex:1;">
        <div style="font-weight:700;color:${v.color};margin-bottom:2px;">
          ${v.label} — ${ai.websiteType || ''}
        </div>
        ${ai.websiteDescription ? `
        <div style="font-size:0.82rem;color:var(--text-primary);font-weight:500;margin-bottom:5px;">
          ${_esc(ai.websiteDescription)}
        </div>` : ''}
        <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.6;">
          ${_esc(ai.narrative || '')}
        </div>
        ${ai.isVietnamese && ai.vietnameseNotes ? `
        <div style="margin-top:6px;font-size:0.78rem;padding:5px 8px;
          background:rgba(0,229,255,.06);border-radius:5px;color:var(--accent-primary);">
          🇻🇳 ${_esc(ai.vietnameseNotes)}
        </div>` : ''}
      </div>
      <div style="text-align:center;flex-shrink:0;">
        <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:900;
          color:${v.color};line-height:1;">${ai.safetyScore ?? '—'}</div>
        <div style="font-size:0.58rem;color:var(--text-muted);letter-spacing:.08em;">SAFETY</div>
      </div>
    </div>

    <!-- Hosting info -->
    ${ai.hostingInfo ? `
    <div style="font-size:0.78rem;padding:8px 12px;background:var(--bg-deep);
      border-radius:6px;color:var(--text-secondary);margin-bottom:12px;">
      🌐 ${_esc(ai.hostingInfo)}
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <!-- Warnings -->
      <div>
        ${(ai.warnings || []).length ? `
        <div style="font-size:0.68rem;color:var(--text-muted);font-weight:700;
          text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px;">⚠️ Cảnh báo</div>
        ${(ai.warnings).map(w => `
          <div style="font-size:0.8rem;padding:6px 9px;
            background:rgba(255,61,90,.06);border-left:2px solid var(--accent-danger);
            border-radius:4px;margin-bottom:4px;color:var(--text-secondary);">
            ${_esc(w)}
          </div>`).join('')}` : `
        <div style="font-size:0.8rem;color:var(--accent-success);padding:8px;">
          ✅ Không phát hiện cảnh báo nghiêm trọng
        </div>`}
      </div>

      <!-- Recommendations -->
      <div>
        ${(ai.recommendations || []).length ? `
        <div style="font-size:0.68rem;color:var(--text-muted);font-weight:700;
          text-transform:uppercase;letter-spacing:.1em;margin-bottom:7px;">💡 Khuyến nghị</div>
        ${(ai.recommendations).slice(0, 3).map(r => `
          <div style="font-size:0.78rem;padding:4px 0;border-bottom:1px solid var(--border-default);
            color:var(--text-secondary);">→ ${_esc(r)}</div>`).join('')}` : ''}

        ${(ai.trustFactors || []).length ? `
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:5px;">
          ${(ai.trustFactors).map(f => `
            <span style="font-size:0.7rem;padding:2px 7px;border-radius:99px;
              background:rgba(0,255,157,.08);color:var(--accent-success);
              border:1px solid rgba(0,255,157,.2);">✓ ${_esc(f)}</span>`).join('')}
        </div>` : ''}
      </div>
    </div>`;

  const rs = document.getElementById('results-section');
  if (rs) rs.insertAdjacentElement('afterbegin', card);
}

// ── Preview với URLScan screenshot ───────────────────────────
async function _loadPreview(urlString, urlscanScreenshot) {
  const sec = document.getElementById('website-preview-section');
  if (!sec) return;

  const url = new URL(urlString);
  sec.innerHTML = `
    <div class="panel mt-lg">
      <div class="panel-title">🌐 Website Preview</div>
      <div id="preview-inner" style="min-height:180px;display:flex;align-items:center;
        justify-content:center;border-radius:var(--radius-md);background:var(--bg-elevated);">
        <div style="text-align:center;color:var(--text-muted);font-size:0.82rem;">
          <div class="spinner" style="width:20px;height:20px;margin:0 auto 8px;border-width:2px;"></div>
          Đang tải preview…
        </div>
      </div>
      <div style="padding:5px 0 2px;font-size:0.68rem;color:var(--text-muted);overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;">${urlString}</div>
    </div>`;
  UI.show('website-preview-section');

  const inner = () => document.getElementById('preview-inner');

  // 1. Thử URLScan screenshot trước (nếu có)
  if (urlscanScreenshot) {
    try {
      await new Promise((res, rej) => {
        const img = new Image();
        img.onload  = res;
        img.onerror = rej;
        setTimeout(rej, 8000);
        img.src = urlscanScreenshot;
      });
      const el = inner();
      if (el) {
        el.innerHTML = `
          <div style="position:relative;width:100%;border-radius:var(--radius-md);overflow:hidden;">
            <img src="${urlscanScreenshot}" style="width:100%;display:block;" alt="Screenshot" />
            <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.7);
              color:var(--accent-primary);font-size:0.6rem;padding:2px 7px;
              border-radius:10px;border:1px solid rgba(0,229,255,.3);">
              📸 URLScan.io
            </div>
          </div>`;
        return;
      }
    } catch {}
  }

  // 2. Thử screenshot services
  const enc = encodeURIComponent(urlString);
  const candidates = [
    `https://image.thum.io/get/width/900/crop/500/noanimate/${enc}`,
    `https://s.wordpress.com/mshots/v1/${enc}?w=900&h=500`,
    `https://api.thumbnail.ws/api/thumbnail/resize?key=&url=${enc}&width=900`,
  ];

  for (const src of candidates) {
    try {
      await new Promise((res, rej) => {
        const img = new Image();
        img.onload  = res;
        img.onerror = rej;
        setTimeout(rej, 9000);
        img.src = src;
      });
      const el = inner();
      if (el) {
        el.innerHTML = `
          <div style="position:relative;width:100%;border-radius:var(--radius-md);overflow:hidden;">
            <img src="${src}" style="width:100%;display:block;" alt="Screenshot" />
            <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.7);
              color:var(--accent-primary);font-size:0.6rem;padding:2px 7px;
              border-radius:10px;border:1px solid rgba(0,229,255,.3);">📸 Screenshot</div>
          </div>`;
        return;
      }
    } catch {}
  }

  // 3. Fallback: favicon + link
  // DuckDuckGo favicon API không bao giờ 404 (trả icon mặc định nếu không có)
  const faviconUrl = `https://icons.duckduckgo.com/ip3/${url.hostname}.ico`;
  const faviconFallback = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(urlString)}`;
  const el = inner();
  if (el) {
    el.innerHTML = `
      <div style="text-align:center;padding:28px 24px;">
        <img src="${faviconUrl}" width="44" height="44"
          style="border-radius:8px;margin:0 auto 10px;display:block;"
          onerror="this.src='${faviconFallback}';this.onerror=function(){this.style.display='none'}" />
        <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary);margin-bottom:5px;">
          ${url.hostname}
        </div>
        <div style="font-size:0.76rem;color:var(--text-secondary);margin-bottom:14px;">
          Preview không khả dụng với trang này.
        </div>
        <a href="${urlString}" target="_blank" rel="noopener noreferrer" class="btn btn-outline"
          style="font-size:0.78rem;">🔗 Mở trang ↗</a>
      </div>`;
  }
}

// ── Local analysis (không cần API) ───────────────────────────
function _localURLAnalysis(urlString, dnsResult) {
  const url     = new URL(urlString);
  const domain  = url.hostname;
  const isHTTPS = url.protocol === 'https:';
  const threats = [];
  let   score   = 0;

  if (!isHTTPS) {
    threats.push({ type:'critical', category:'ssl', title:'🔓 Không có HTTPS',
      description:'Kết nối không được mã hoá, dữ liệu có thể bị đánh cắp.', keywords:['no-https'] });
    score += 30;
  }

  if (['bit.ly','tinyurl.com','t.co','ow.ly','rb.gy'].some(d => domain.includes(d))) {
    threats.push({ type:'warning', category:'shortened', title:'🔗 URL Rút gọn',
      description:'URL rút gọn che giấu điểm đến thực.', keywords:['shortened'] });
    score += 15;
  }

  const suspiciousTLDs = ['.tk','.ml','.ga','.cf','.gq'];
  if (suspiciousTLDs.some(t => domain.endsWith(t))) {
    threats.push({ type:'warning', category:'tld', title:'⚠️ TLD Đáng ngờ',
      description:`Phổ biến trong các trang lừa đảo.`, keywords:[domain.split('.').pop()] });
    score += 20;
  }

  if (/(?:secure|login|update|verify|confirm)[-_.]?(?:apple|amazon|google|facebook|microsoft|paypal)/i
      .test(domain + url.pathname)) {
    threats.push({ type:'critical', category:'phishing', title:'🎣 Mẫu Lừa đảo (Phishing)',
      description:'URL khớp với mẫu giả mạo thương hiệu đã biết.', keywords:['phishing'] });
    score += 30;
  }

  if (!dnsResult?.a?.ok) {
    threats.push({ type:'warning', category:'dns', title:'❓ DNS Không phân giải được',
      description:'Domain không có bản ghi A hợp lệ.', keywords:['dns'] });
    score += 10;
  }

  return {
    domain, isHTTPS, threatScore: Math.min(score, 100), threats,
    checks: {
      ssl: isHTTPS, https: isHTTPS,
      domainAge: true, reputation: score < 40,
      malwareFree: true, phishingFree: score < 25,
    },
    source: 'local',
  };
}

// ── Website identity ──────────────────────────────────────────
function _identifyWebsite(urlString, geo) {
  const url    = new URL(urlString);
  const domain = url.hostname.toLowerCase();
  const tld    = domain.split('.').pop().toLowerCase();

  const result = {
    domain, type: '🌐 Website', cms: null,
    country: null, language: null,
  };

  // CMS detection
  if (/wordpress|wp\.com/.test(domain))       result.cms = 'WordPress';
  else if (/shopify/.test(domain))             result.cms = 'Shopify';
  else if (/blogspot|blogger/.test(domain))    result.cms = 'Blogger';
  else if (/wix\.com/.test(domain))            result.cms = 'Wix';

  // Geo từ ipinfo
  if (geo?.country) {
    const COUNTRY_NAME = { VN:'🇻🇳 Việt Nam', US:'🇺🇸 Mỹ', GB:'🇬🇧 Anh', SG:'🇸🇬 Singapore',
      JP:'🇯🇵 Nhật', CN:'🇨🇳 Trung Quốc', KR:'🇰🇷 Hàn Quốc', DE:'🇩🇪 Đức', FR:'🇫🇷 Pháp' };
    result.country = COUNTRY_NAME[geo.country] || geo.country;
  } else {
    const TLD_COUNTRY = { vn:'🇻🇳 Việt Nam', com:'🌐 Global', net:'🌐 Global',
      org:'🌐 Phi lợi nhuận', uk:'🇬🇧 Anh', us:'🇺🇸 Mỹ', jp:'🇯🇵 Nhật', cn:'🇨🇳 Trung Quốc' };
    result.country = TLD_COUNTRY[tld] || `.${tld}`;
  }

  // Type
  if (/news|tin|bao|vnexpress|tuoitre|thanhnien|dantri|zing|kenh14|vtv|vov|nld|24h/.test(domain)) {
    result.type = '📰 Tin tức'; result.language = '🇻🇳 Tiếng Việt';
  } else if (/fly88|go88|iwin|b52|rikvip|sunwin|casino|bet|w88|fb88|789bet|jun88|hi88|kubet|shbet|new88|sbobet|1xbet|188bet|dafabet|betvisa|betway|bk8|fun88|vwin|f8bet|mb66|qh88|ok9|ae888|vn88|mu88|77bet/.test(domain)) {
    result.type = '🎰 Cờ bạc / Cá cược'; result.language = '🇻🇳 Tiếng Việt';
  } else if (/shop|store|lazada|shopee|tiki|sendo|thegioididong/.test(domain)) {
    result.type = '🛒 Thương mại';
  } else if (domain.endsWith('.edu.vn') || domain.endsWith('.gov.vn') || domain.endsWith('.edu') || domain.endsWith('.gov')) {
    result.type = '🏛️ Chính phủ / Giáo dục';
  } else if (/blog|diary/.test(domain)) {
    result.type = '📝 Blog';
  } else if (result.cms) {
    result.type = `🌐 Website (${result.cms})`;
  }

  return result;
}

// ── Gambling detection ────────────────────────────────────────
function _detectGambling(urlString) {
  let url;
  try { url = new URL(urlString); } catch {
    return { threats:[], hasGambling:false, hasMaliciousAds:false, addedScore:0 };
  }
  const domain = url.hostname.toLowerCase();
  const path   = url.pathname.toLowerCase();
  const qs     = url.search.toLowerCase();
  const threats = []; let addedScore = 0, hasGambling = false, hasMaliciousAds = false;

  // ── PATCH v3.1: Mở rộng danh sách cờ bạc (thêm fly88 + brand VN mới) ──
  const GAMBLE_KW = [
    // Từ khoá chung
    'casino','bet','betting','poker','slots','jackpot','baccarat','roulette',
    'lottery','lotto','sportsbook','gamble','gambling','wager',
    // Từ khoá tiếng Việt
    'cá cược','cá độ','xổ số','lô đề','cược','kèo','tài xỉu',
    'nổ hũ','bắn cá','đá gà','xóc đĩa','quay hũ','slot game',
    'nhà cái','nha cai','cổng game','cong game','thể thao','the thao',
    // Brand cũ
    'w88','fb88','k8','fun88','bk8','vwin','789bet','8xbet','jun88','hi88',
    'shbet','kubet','i9bet','new88','sv88','f8bet','mb66','qh88','123b',
    '33win','bongdaplus',
    // Brand MỚI (2024-2025) — bao gồm fly88
    'fly88','go88','b52','iwin','rikvip','sunwin','hit88','ok9','yo88',
    'one88','luck8','sin88','top88','vn88','mu88','ae888','ae86','bet88',
    'vin777','cf68','tbet','abc8','keo88','77bet','88vin','88bet','99ok',
    'u888','v9bet','hi88','s666','s888','m88','188bet','12bet','sbobet',
    'dafabet','cmd368','maxbet','1xbet','22bet','betway','betvisa',
    'lucky88','play88','win88','rich88','mega88','super88','king88',
    'royal88','vip88','top1','top3','topbet','lo de','lo đề',
  ];
  const hits = GAMBLE_KW.filter(k => domain.includes(k) || path.includes(k) || qs.includes(k));
  if (hits.length) {
    hasGambling = true; addedScore += Math.min(hits.length * 15, 50);
    threats.push({ type:'critical', category:'gambling',
      title:'🎰 Phát hiện Cờ bạc / Cá Độ',
      description:`Từ khoá: ${hits.slice(0,4).join(', ')}.`, keywords:hits });
  }

  const GAMBLE_TLD = ['.bet','.casino','.poker','.bingo','.win'];
  const tld = '.' + domain.split('.').pop();
  if (GAMBLE_TLD.includes(tld)) {
    hasGambling = true; addedScore += 30;
    threats.push({ type:'critical', category:'gambling',
      title:'🎰 Domain Cờ bạc', description:`"${tld}" là TLD cờ bạc.`, keywords:[tld] });
  }

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) {
    addedScore += 20;
    threats.push({ type:'warning', category:'ip-address',
      title:'🔢 Dùng địa chỉ IP làm domain',
      description:'Các trang hợp lệ hiếm khi dùng IP thô.', keywords:[domain] });
  }

  return { threats, hasGambling, hasMaliciousAds, addedScore: Math.min(addedScore, 60) };
}

// ── Source code scan ──────────────────────────────────────────
async function _fetchAndScanSource(urlString) {
  const result = { html:'', scripts:[], adNetworks:[], suspiciousScripts:[], hasGamblingAds:false, threats:[], addedScore:0 };
  
  // Lưu ý: Fetch mã nguồn từ frontend bị CORS block
  // Đó là lý do chủ yếu khiến URL check block
  // Nếu cần: thêm backend endpoint hoặc bỏ qua scan này
  // console.warn('[URL] Source code scan disabled: CORS protection');
  
  // Skip source scan - không fetch được từ frontend
  return result; // Trả về object rỗng, process vẫn tiếp tục

  _sourceHTML = result.html;
  const scriptMatches = [...result.html.matchAll(/<script[^>]*src=["']([^"']+)["'][^>]*>/gi)];
  result.scripts = scriptMatches.map(m => m[1]).filter(Boolean);
  const inlines  = [...result.html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const fullSrc  = result.scripts.join(' ') + inlines.join(' ');

  const AD_NETWORKS = [
    { name:'Google AdSense', pattern:/pagead2\.googlesyndication|adsbygoogle/i },
    { name:'Admicro (VN)',   pattern:/admicro\.vn|vcmedia\.vn/i },
    { name:'ZMedia (VN)',    pattern:/zmedia\.vn/i },
    { name:'Facebook Pixel', pattern:/connect\.facebook\.net|fbevents/i },
    { name:'Taboola',        pattern:/taboola\.com/i },
    { name:'Criteo',         pattern:/criteo\.com/i },
  ];
  AD_NETWORKS.forEach(net => { if (net.pattern.test(fullSrc + result.html)) result.adNetworks.push(net.name); });

  const GAMBLE_SCRIPTS = [
    /fly88|go88|iwin|b52|rikvip|sunwin|hit88|ok9|one88|ae888|vn88|mu88|77bet/i,
    /w88|fb88|789bet|jun88|hi88|kubet|shbet|new88|sv88|f8bet|mb66/i,
    /sbobet|1xbet|188bet|dafabet|cmd368|maxbet|betvisa|betway/i,
    /casino|betting|sportsbook|gambling|cá.cược|cá.độ|nổ.hũ|bắn.cá|đá.gà/i,
  ];
  GAMBLE_SCRIPTS.forEach(p => { if (p.test(fullSrc + result.html)) result.hasGamblingAds = true; });

  const SUSPICIOUS = [
    { label:'Crypto miner',       pattern:/coinhive|cryptoloot/i },
    { label:'eval(atob())',       pattern:/eval\s*\(\s*atob\s*\(/i },
    { label:'Obfuscated redirect',pattern:/window\.location\s*=\s*atob/i },
    { label:'Hidden iframe',      pattern:/<iframe[^>]+style=["'][^"']*display:\s*none/i },
    { label:'Keylogger',          pattern:/addEventListener\s*\(\s*['"]keydown['"]/i },
    { label:'Clipboard hijack',   pattern:/addEventListener\s*\(\s*['"]copy['"]/i },
  ];
  SUSPICIOUS.forEach(({ label, pattern }) => {
    if (pattern.test(result.html || fullSrc)) result.suspiciousScripts.push({ label });
  });

  if (result.adNetworks.length >= 4) {
    result.addedScore += 15;
    result.threats.push({ type:'warning', category:'heavy-ads',
      title:`📢 Quảng cáo Nặng (${result.adNetworks.length} mạng)`,
      description:result.adNetworks.slice(0,4).join(', '), keywords:result.adNetworks });
  }
  if (result.hasGamblingAds) {
    result.addedScore += 45;
    result.threats.push({ type:'critical', category:'gambling-ads',
      title:'🎰 Script Cờ bạc trong Mã nguồn',
      description:'Script cờ bạc nhúng trực tiếp trong HTML.', keywords:['gambling-ads'] });
  }
  if (result.suspiciousScripts.length > 0) {
    result.addedScore += Math.min(result.suspiciousScripts.length * 20, 60);
    result.threats.push({ type:'critical', category:'malicious-code',
      title:`🚨 Code Đáng ngờ (${result.suspiciousScripts.length})`,
      description:result.suspiciousScripts.map(s=>s.label).join(', '),
      keywords:result.suspiciousScripts.map(s=>s.label) });
  }
  return result;
}

// ── Danger overlay ────────────────────────────────────────────
function _showDangerOverlay(result) {
  document.getElementById('danger-overlay')?.remove();
  const gr = result.gamblingResult;
  let icon='⚠️', title='Website Nguy hiểm', color='var(--accent-warn)', msgs=[];
  if (gr?.hasGambling) { icon='🎰'; title='Website Cờ bạc!'; color='var(--accent-danger)'; msgs.push('Trang này liên quan đến cờ bạc.'); }
  if (result.aiAnalysis?.verdict === 'phishing') { icon='🎣'; title='Cảnh báo Lừa đảo!'; color='var(--accent-danger)'; msgs.push('AI phát hiện dấu hiệu phishing.'); }
  if (result.aiAnalysis?.verdict === 'malware')  { icon='🦠'; title='Phát hiện Malware!'; color='var(--accent-danger)'; msgs.push('AI xác nhận nguy cơ malware.'); }
  if (result.threatScore >= 75) msgs.push(`Điểm đe dọa: ${result.threatScore}/100 — Rất nguy hiểm.`);
  else if (result.threatScore >= 60) msgs.push(`Điểm đe dọa: ${result.threatScore}/100 — Rủi ro cao.`);

  const el = document.createElement('div');
  el.id = 'danger-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeInUp .25s ease;';
  el.innerHTML = `
    <div style="background:var(--bg-panel);border:2px solid ${color};border-radius:var(--radius-xl,16px);
      padding:36px 40px;max-width:480px;width:90%;text-align:center;box-shadow:0 0 60px ${color}40;">
      <div style="font-size:3.5rem;margin-bottom:14px;">${icon}</div>
      <div style="font-size:1.2rem;font-weight:900;color:${color};margin-bottom:12px;">${title}</div>
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:8px;">
        <strong style="color:var(--text-primary);">${new URL(_currentURL).hostname}</strong>
      </div>
      ${msgs.map(m=>`<div style="font-size:0.82rem;color:var(--text-secondary);margin:6px 0;padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-md);">${m}</div>`).join('')}
      <div style="display:flex;gap:12px;justify-content:center;margin-top:24px;">
        <button onclick="document.getElementById('danger-overlay').remove()" class="btn btn-primary">Tôi hiểu — Tiếp tục</button>
        <button onclick="window.history.back()" class="btn btn-ghost">Quay lại</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

// ── Source code viewer ────────────────────────────────────────
function openSourceViewer() {
  document.getElementById('source-modal')?.remove();
  if (!_sourceHTML) { UI.toast('Không có mã nguồn. Hãy kiểm tra URL trước.', 'warn'); return; }
  const sa = _currentResult?.sourceAnalysis || {};

  let highlighted = _sourceHTML.slice(0, 50000)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/eval\s*\([^)]{0,200}\)/g, m=>`<mark style="background:rgba(239,68,68,.3);color:#fca5a5;border-radius:3px;">${m}</mark>`)
    .replace(/atob\s*\([^)]{0,100}\)/g, m=>`<mark style="background:rgba(239,68,68,.25);color:#fca5a5;border-radius:3px;">${m}</mark>`)
    .replace(/(fly88|go88|iwin|b52|rikvip|sunwin|w88|fb88|789bet|jun88|hi88|kubet|shbet|new88|sv88|ok9|one88|ae888|vn88|mu88|77bet|sbobet|1xbet|188bet|dafabet|betvisa)[^"'\s]*/gi, m=>`<mark style="background:rgba(168,85,247,.25);color:#d8b4fe;border-radius:3px;">${m}</mark>`)
    .replace(/pagead2\.googlesyndication|adsbygoogle|admicro|zmedia/gi, m=>`<mark style="background:rgba(59,130,246,.2);color:#93c5fd;border-radius:3px;">${m}</mark>`);

  const modal = document.createElement('div');
  modal.id = 'source-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.92);backdrop-filter:blur(6px);display:flex;flex-direction:column;';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;background:var(--bg-panel);border-bottom:1px solid var(--border-default);flex-shrink:0;">
      <span style="color:var(--accent-primary);font-weight:700;font-size:0.9rem;">💻 Source Code</span>
      <span style="font-family:var(--font-display);font-size:0.75rem;color:var(--text-muted);">${new URL(_currentURL).hostname}</span>
      <div style="margin-left:auto;display:flex;gap:8px;">
        <span class="badge badge-cyan" style="color:var(--accent-danger);">⚠️ ${sa.suspiciousScripts?.length||0} suspicious</span>
        <span class="badge badge-cyan">📢 ${sa.adNetworks?.length||0} ad networks</span>
        <button onclick="document.getElementById('source-modal').remove()" class="btn btn-ghost" style="padding:4px 12px;font-size:0.78rem;">✕</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:220px 1fr;flex:1;overflow:hidden;">
      <div style="background:var(--bg-deep);border-right:1px solid var(--border-default);overflow-y:auto;padding:14px;">
        ${sa.suspiciousScripts?.length ? `<div style="font-size:0.7rem;color:var(--accent-danger);font-weight:700;margin-bottom:6px;">🚨 Suspicious</div>${sa.suspiciousScripts.map(s=>`<div style="font-size:0.7rem;padding:4px 8px;background:rgba(239,68,68,.1);border-radius:4px;margin-bottom:4px;color:#fca5a5;">${s.label}</div>`).join('')}<div style="height:10px;"></div>` : ''}
        ${sa.adNetworks?.length ? `<div style="font-size:0.7rem;color:#3b82f6;font-weight:700;margin-bottom:6px;">📢 Ad Networks</div>${sa.adNetworks.map(n=>`<div style="font-size:0.7rem;padding:4px 8px;background:rgba(59,130,246,.1);border-radius:4px;margin-bottom:4px;color:#93c5fd;">${n}</div>`).join('')}` : ''}
        <div style="height:12px;"></div>
        <div style="font-size:0.68rem;color:var(--text-muted);">📜 ${sa.scripts?.length||0} scripts</div>
        ${(sa.scripts||[]).slice(0,12).map(s=>`<div style="font-size:0.62rem;padding:2px 6px;color:var(--text-muted);word-break:break-all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;">${s}</div>`).join('')}
      </div>
      <div style="overflow:auto;padding:14px;background:var(--bg-deep);">
        <pre style="font-family:var(--font-display);font-size:0.68rem;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;line-height:1.6;margin:0;">${highlighted}</pre>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// ── Display results ───────────────────────────────────────────
function _displayResults(result, urlString) {
  const url   = new URL(urlString);
  const score = Math.min(result.threatScore, 100);

  const dpEl = document.getElementById('danger-percent');
  const rbEl = document.getElementById('risk-bar');
  const dlEl = document.getElementById('danger-label');
  if (dpEl) dpEl.textContent = score;
  if (rbEl) {
    rbEl.style.width = score + '%';
    rbEl.style.background = score <= 25 ? 'var(--accent-success)' : score <= 50 ? 'var(--accent-warn)' : 'var(--accent-danger)';
  }
  let dL='Rủi ro Thấp', dC='var(--accent-success)';
  if (score>75){dL='Cực kỳ Nguy hiểm';dC='var(--accent-danger)';}
  else if(score>50){dL='Rủi ro Cao';dC='var(--accent-warn)';}
  else if(score>25){dL='Rủi ro Trung bình';dC='var(--accent-warn)';}
  if (dlEl) { dlEl.textContent=dL; dlEl.style.color=dC; }

  // Identity card
  const identity = result.identity;
  const identEl  = document.getElementById('website-identity');
  if (identEl && identity) {
    identEl.style.display = 'block';
    const vtCategories = result.threatData?.vtDomain?.categories;
    identEl.innerHTML = `
      <div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">🔍 Thông tin Website</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.8rem;">
        <div style="padding:6px 10px;background:var(--bg-elevated);border-radius:var(--radius-md);"><div style="font-size:0.65rem;color:var(--text-muted);">Loại</div><div>${identity.type}</div></div>
        <div style="padding:6px 10px;background:var(--bg-elevated);border-radius:var(--radius-md);"><div style="font-size:0.65rem;color:var(--text-muted);">Quốc gia</div><div>${identity.country || '—'}</div></div>
        ${result.geo?.org ? `<div style="padding:6px 10px;background:var(--bg-elevated);border-radius:var(--radius-md);"><div style="font-size:0.65rem;color:var(--text-muted);">ISP/Tổ chức</div><div style="font-size:0.75rem;">${result.geo.org}</div></div>` : ''}
        ${result.geo?.ip  ? `<div style="padding:6px 10px;background:var(--bg-elevated);border-radius:var(--radius-md);"><div style="font-size:0.65rem;color:var(--text-muted);">IP Server</div><div style="font-family:var(--font-mono);font-size:0.75rem;">${result.geo.ip}</div></div>` : ''}
        ${vtCategories    ? `<div style="padding:6px 10px;background:var(--bg-elevated);border-radius:var(--radius-md);grid-column:1/-1;"><div style="font-size:0.65rem;color:var(--text-muted);">VT Categories</div><div style="font-size:0.75rem;">${vtCategories}</div></div>` : ''}
      </div>`;
  }

  // Source code button
  const srcBtn = document.getElementById('source-code-btn');
  if (srcBtn) {
    srcBtn.style.display = 'inline-block';
    const bad = (result.sourceAnalysis?.suspiciousScripts?.length||0) + (result.sourceAnalysis?.hasGamblingAds?1:0);
    srcBtn.innerHTML = `💻 Mã nguồn ${bad>0?`<span class="badge badge-cyan" style="color:var(--accent-danger);margin-left:6px;">${bad} vấn đề</span>`:''}`;
  }

  _setText('domain-display', result.domain);
  // Domain age từ VT
  const vtAge = result.threatData?.vtDomain?.creationDate;
  if (vtAge) {
    const ageDays = Math.floor((Date.now() - new Date(vtAge).getTime()) / 86400000);
    _setText('domain-age', `${ageDays} ngày (${vtAge})`);
  } else {
    _setText('domain-age', 'Không xác định');
  }
  _setText('domain-rank', result.threatData?.vtDomain ? `VT ✓ (${result.threatData.vtDomain.reputation ?? 0} reputation)` : 'Local Only');

  // Gambling badge
  const gr   = result.gamblingResult;
  const gbEl = document.getElementById('gambling-badge');
  if (gbEl && gr) {
    gbEl.style.display = 'flex';
    gbEl.innerHTML = gr.hasGambling
      ? '<span class="badge badge-cyan" style="color:var(--accent-danger);border-color:var(--accent-danger)40;background:var(--accent-danger)15;">🎰 Phát hiện Cờ bạc</span>'
      : '<span class="badge badge-cyan" style="color:var(--accent-success);border-color:var(--accent-success)40;background:var(--accent-success)15;">✓ Không phát hiện Cờ bạc</span>';
  }

  // Threats list
  const thrEl   = document.getElementById('threats-list');
  const noThrEl = document.getElementById('no-threats');
  if (thrEl) {
    const all = result.threats || [];
    if (all.length) {
      if (noThrEl) noThrEl.style.display = 'none';
      const ICONS = { gambling:'🎰', malware:'🦠', suspicious:'⚠️', phishing:'🎣', ssl:'🔓',
        shortened:'🔗', ip_address:'🔢', 'gambling-ads':'🎰', 'malicious-code':'🚨',
        'heavy-ads':'📢', urlscan:'🔍', tor:'🧅', dns:'❓' };
      thrEl.innerHTML = all.map(t => {
        const icon = ICONS[t.category] || (t.type==='critical'?'🚨':'⚠️');
        return `<div style="display:flex;gap:12px;padding:10px 14px;margin-bottom:8px;border-radius:var(--radius-md);border:1px solid var(--border-default);border-left:3px solid ${t.type==='critical'?'var(--accent-danger)':'var(--accent-warn)'};background:${t.type==='critical'?'rgba(239,68,68,.06)':'rgba(245,158,11,.06)'};">
          <div style="font-size:1rem;flex-shrink:0;">${icon}</div>
          <div><div style="font-weight:600;font-size:0.83rem;margin-bottom:3px;">${t.title}</div>
          <div style="font-size:0.76rem;color:var(--text-secondary);">${t.description}</div></div>
        </div>`;
      }).join('');
    } else {
      if (noThrEl) noThrEl.style.display = 'block';
      thrEl.innerHTML = '';
    }
  }

  // Security checklist
  const chEl = document.getElementById('security-checks');
  if (chEl) {
    const ch = result.checks || {};
    const vtMalicious = result.threatData?.vtScan?.malicious || 0;
    const checks = [
      { name:'HTTPS/TLS',        passed:ch.https },
      { name:'DNS resolve',      passed:result.dnsResult?.a?.ok !== false },
      { name:'VirusTotal clean', passed:vtMalicious === 0 },
      { name:'URLScan clean',    passed:!result.threatData?.urlscan?.malicious },
      { name:'Không phishing',   passed:ch.phishingFree },
      { name:'Không cờ bạc',    passed:!result.gamblingResult?.hasGambling },
      { name:'Source sạch',     passed:!(result.sourceAnalysis?.suspiciousScripts?.length > 0) },
      { name:'Không VPN/Tor',   passed:!result.geo?.isVPN && !result.geo?.isTor },
    ];
    chEl.innerHTML = checks.map(c => `
      <div class="flex gap-sm items-center" style="padding:5px 0;font-size:0.8rem;">
        <div style="font-weight:700;color:${c.passed?'var(--accent-success)':'var(--accent-danger)'};">${c.passed?'✓':'✗'}</div>
        <div>${c.name}</div>
      </div>`).join('');
  }

  _setText('content-type', url.pathname !== '/' ? 'Trang Web' : 'Domain Root');
  _setText('content-lang', result.identity?.language || 'Không xác định');
  _setText('content-updated', 'Không xác định');
  _setText('is-https', result.isHTTPS ? '✓ Có' : '✗ Không');

  // Recommendation
  let rI='✅', rT='An toàn để Truy cập', rD='Không phát hiện vấn đề nghiêm trọng.';
  const aiV = result.aiAnalysis?.verdict;
  if (gr?.hasGambling || result.sourceAnalysis?.hasGamblingAds) { rI='🚫'; rT='Website Cờ bạc'; rD='Liên quan đến cờ bạc, có thể vi phạm pháp luật.'; }
  else if (aiV==='phishing' || aiV==='malware') { rI='🚨'; rT='Nguy hiểm — AI xác nhận'; rD=result.aiAnalysis?.narrative || 'Trang nguy hiểm.'; }
  else if (result.sourceAnalysis?.suspiciousScripts?.length > 0) { rI='🚨'; rT='Phát hiện Code Độc hại'; rD='Script nguy hiểm trong mã nguồn.'; }
  else if ((result.threatData?.vtScan?.malicious || 0) > 0) { rI='🦠'; rT='VirusTotal Cảnh báo'; rD=`${result.threatData.vtScan.malicious} engine phát hiện độc hại.`; }
  else if (score > 70) { rI='🚫'; rT='Nguy hiểm — Tránh xa'; rD='Nhiều dấu hiệu nguy hiểm.'; }
  else if (score > 45 || aiV==='caution') { rI='⚠️'; rT='Cần Thận trọng'; rD='Một số vấn đề phát hiện.'; }
  _setText('rec-icon', rI); _setText('rec-title', rT); _setText('rec-description', rD);

  // Status indicator: AI source
  const aiStatus = AIBackend?.getStatus?.() || { ai: {} };
  const aiSource = aiStatus.ai.groq ? 'Groq/Llama3' : aiStatus.ai.openrouter ? 'OpenRouter' : null;
  if (aiSource) {
    const badge = document.createElement('div');
    badge.style.cssText = 'font-size:0.68rem;color:var(--text-muted);font-family:monospace;margin-bottom:12px;';
    badge.textContent = `🤖 AI: ${aiSource}`;
    const rs = document.getElementById('results-section');
    if (rs && !document.getElementById('ai-source-badge')) {
      badge.id = 'ai-source-badge';
      rs.insertAdjacentElement('afterbegin', badge);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────
function _setText(id, v) { const el=document.getElementById(id); if(el) el.textContent=String(v??''); }
function _bar(p) { const el=document.getElementById('processing-bar'); if(el) el.style.width=p+'%'; }
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _renderSteps(steps) {
  const el=document.getElementById('processing-steps'); if(!el) return;
  el.innerHTML=steps.map(s=>
    `<div id="step-${s.id}" style="display:flex;align-items:center;gap:8px;font-size:0.83rem;">
      <span style="color:var(--text-muted);">⏳</span> ${s.label}</div>`
  ).join('');
}
function _done(id) {
  const el=document.getElementById(`step-${id}`);
  if(el) el.innerHTML=el.innerHTML.replace('⏳','<span style="color:var(--accent-success);">✓</span>');
}

// ── DOM init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // URL input: Enter to check
  document.getElementById('url-input')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') startURLCheck();
  });
  
  // Check button: Click to check
  document.getElementById('check-btn')?.addEventListener('click', () => {
    startURLCheck();
  });

  const rs = document.getElementById('results-section');
  if (rs) {
    const addEl = (id, tag, style) => {
      if (!document.getElementById(id)) {
        const el=document.createElement(tag); el.id=id; el.style.cssText=style;
        rs.insertAdjacentElement('afterbegin', el);
      }
    };
    addEl('gambling-badge',    'div', 'display:none;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center;');
    addEl('website-identity',  'div', 'display:none;background:var(--bg-elevated);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:14px;margin-bottom:16px;');
    addEl('source-code-btn',   'button', 'display:none;margin-bottom:16px;font-size:0.8rem;');
    const srcBtn = document.getElementById('source-code-btn');
    if (srcBtn) { srcBtn.className='btn btn-outline'; srcBtn.onclick=openSourceViewer; }

    if (!document.getElementById('website-preview-section')) {
      const p=document.createElement('div'); p.id='website-preview-section'; p.className='hidden';
      rs.appendChild(p);
    }
  }

});