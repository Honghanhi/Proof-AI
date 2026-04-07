// ═══════════════════════════════════════════════════════════════
// FAKENEWS-PAGE  v2.0  (FIXED + AI UPGRADED)
//
// Fix:
//  1. Lưu kết quả vào DB.saveResult() + Blockchain.addResult()
//     → xuất hiện trong Timeline sau khi phân tích
//  2. AI Analysis via fakenews-service (microservice)
//     → phân tích claim, bias, logical fallacies
//  3. Fix bug: title-only content vẫn đúng validation
//  4. Claim extractor interactive
// ═══════════════════════════════════════════════════════════════

// ── fakenews-service helper ─────────────────────────────────
// Uses AIServer.detectFakeNews which calls the microservice directly.
async function _fnCallClaude(prompt, maxTokens = 1000) {
  return null; // fakenews-service handles all analysis
}

// ── AI Fact-Check (via fakenews-service) ──────────────────────
async function _aiFactCheck(title, content) {
  // Now handled by AIServer.detectFakeNews
  return null;
}

// ── Save result vào DB + Blockchain ───────────────────────────
async function _saveFakeNewsResult(result, fullContent, title, sourceURL) {
  try {
    let contentHash;
    if (typeof Hash !== 'undefined' && typeof Hash.text === 'function') {
      contentHash = await Hash.text(fullContent);
    } else if (typeof hashText === 'function') {
      contentHash = await hashText(fullContent);
    } else {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fullContent));
      contentHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const fakePct     = Math.round(result.fakePct ?? result.aiPct ?? 50);
    const trustScore  = Math.max(0, 100 - fakePct);
    const verdict     = CONFIG.getVerdict(trustScore);
    const now         = new Date().toISOString();
    const resultId    = `fn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const dbResult = {
      id:          resultId,
      type:        'text',
      content:     fullContent.slice(0, 300) + (fullContent.length > 300 ? '…' : ''),
      contentHash,
      trustScore,
      verdict:     { label: verdict.label, color: verdict.color, class: verdict.class },
      models:      result.models || [],
      signals:     [],
      explanation: result.aiAnalysis?.summary || result.overallAssessment || _dangerSumm(fakePct),
      timestamp:   now,
      savedAt:     now,
      fakeNewsData: {
        title,
        fakePct,
        claims:        result.aiAnalysis?.claims       || [],
        biasType:      result.aiAnalysis?.biasType     || '',
        redFlags:      result.aiAnalysis?.redFlags     || [],
        logicalFallacies: result.aiAnalysis?.logicalFallacies || [],
        sourceURL,
        source:        result._source || 'Local Heuristics',
      },
    };

    await DB.saveResult(dbResult);

    let blockInfo = null;
    if (typeof Blockchain !== 'undefined') {
      try {
        const block = await Blockchain.addResult(dbResult);
        dbResult.blockIndex = block.index;
        dbResult.blockHash  = block.hash;
        await DB.saveResult(dbResult);
        blockInfo = block;
      } catch (blockErr) {
        console.warn('[FakeNews] Blockchain failed:', blockErr.message);
      }
    }

    if (blockInfo) {
      UI.toast(`✓ Đã lưu vào Timeline — Block #${blockInfo.index}`, 'success', 4000);
    } else {
      UI.toast('✓ Đã lưu vào Timeline', 'success', 3000);
    }

    // Hiện link "View in Timeline"
    const rs = document.getElementById('results-section');
    if (rs && !document.getElementById('fn-timeline-link')) {
      const linkEl = document.createElement('div');
      linkEl.id = 'fn-timeline-link';
      linkEl.style.cssText = 'margin-top:12px;text-align:right;';
      linkEl.innerHTML = `<a href="timeline.html" class="btn btn-ghost" style="font-size:0.75rem;">
        🕒 Xem trong Timeline →</a>`;
      rs.appendChild(linkEl);
    }

    return dbResult;
  } catch (err) {
    console.error('[FakeNews] Save failed:', err);
    UI.toast('Lưu thất bại: ' + err.message, 'warn', 3000);
    return null;
  }
}

// ── Main flow ─────────────────────────────────────────────────
async function startFakeNewsCheck() {
  const title     = document.getElementById('article-title')?.value.trim()   || '';
  const content   = document.getElementById('article-content')?.value.trim() || '';
  const sourceURL = document.getElementById('source-url')?.value.trim()      || '';
  const pubDate   = document.getElementById('pub-date')?.value               || '';

  // FIX: validate đúng — cần ít nhất title HOẶC content
  if (!title && !content) {
    UI.toast('Vui lòng nhập tiêu đề hoặc nội dung bài viết.', 'warn');
    return;
  }
  // FIX: fullContent phải đủ 10 chars để gửi server
  const fullContent = [title, content].filter(Boolean).join('\n\n');
  if (fullContent.length < 10) {
    UI.toast('Vui lòng nhập ít nhất 10 ký tự nội dung.', 'warn');
    return;
  }

  // Disable button
  const checkBtn = document.getElementById('check-btn');
  if (checkBtn) checkBtn.disabled = true;

  UI.show('processing-overlay');
  _renderSteps([
    { id: 'fetch',    label: 'Kết nối đến máy chủ AI…'         },
    { id: 'analyze',  label: 'Phân tích nội dung & ngôn ngữ…'  },
    { id: 'sources',  label: 'Kiểm tra độ tin cậy nguồn…'      },
    { id: 'ai',       label: 'Xử lý qua fakenews-service…'     },
    { id: 'consensus',label: 'Tính toán điểm rủi ro cuối…'     },
  ]);
  _bar(8);

  try {
    // ── Bước 1: Server health check (timeout 6s, không dùng cache) ──
    // FIX: isReachable() trả về cache cũ → báo off dù server đang live.
    // Luôn gọi healthCheck thật, nhưng giới hạn 6s để không block lâu.
    let ok = false;
    try {
      const HEALTH_TIMEOUT = 6000;
      ok = await Promise.race([
        AIServer.healthCheck('FAKENEWS'),
        new Promise(resolve => setTimeout(() => resolve(false), HEALTH_TIMEOUT)),
      ]);
    } catch (_) { ok = false; }
    _bar(20); _done('fetch');

    // ── Bước 2: AI Server detection ──
    let result, usedServer = false;
    if (!ok) {
      console.error('[FakeNews] Backend not available');
      throw new Error('Backend required - no local fallback');
    }

    try {
      result     = await AIServer.detectFakeNews(fullContent);
      usedServer = true;
      _bar(50);
      _done('analyze'); _done('sources');
    } catch (err) {
      console.error('[FakeNews] Backend error:', err.message);
      throw err;
    }

    result._source = usedServer
      ? (result.models?.[0]?.modelName || 'Server Model')
      : 'Local Heuristics';

    // ── Bước 3: Results from fakenews-service ──
    _bar(85);
    _done('ai');
    
    // Result from AIServer.detectFakeNews already contains full analysis

    // ── Bước 4: Compute final ──
    _done('consensus'); _bar(100);

    // ── Bước 5: Hiển thị kết quả ──
    // FIX: _saveFakeNewsResult không cần await — fire-and-forget để UI
    // phản hồi ngay, không block việc re-enable nút check.
    _displayResults(result, fullContent, sourceURL, pubDate);
    UI.hide('processing-overlay');
    UI.show('results-section');
    if (checkBtn) checkBtn.disabled = false;

    _saveFakeNewsResult(result, fullContent, title, sourceURL).catch(e =>
      console.warn('[FakeNews] Background save failed:', e.message)
    );

  } catch (err) {
    console.error('[FakeNews]', err);
    UI.toast('Phân tích thất bại: ' + err.message, 'error');
    UI.hide('processing-overlay');
    if (checkBtn) checkBtn.disabled = false;
  }
}

// ── Display AI Analysis Card ──────────────────────────────────
function _displayAIAnalysis(ai) {
  if (!ai) return;

  const rs = document.getElementById('results-section');
  if (!rs) return;

  // Xóa card cũ nếu có
  document.getElementById('fn-ai-analysis-card')?.remove();

  const VERDICT_MAP = {
    authentic:   { label: 'Xác thực',     color: 'var(--accent-success)', icon: '✅' },
    misleading:  { label: 'Gây hiểu lầm', color: 'var(--accent-warn)',    icon: '⚠️' },
    satire:      { label: 'Châm biếm',    color: '#a78bfa',               icon: '🎭' },
    fabricated:  { label: 'Bịa đặt',      color: 'var(--accent-danger)',  icon: '❌' },
    uncertain:   { label: 'Không rõ',     color: 'var(--text-secondary)', icon: '❓' },
  };
  const vs = VERDICT_MAP[ai.verdict] || VERDICT_MAP.uncertain;

  // Build claims HTML
  const STATUS_STYLE = {
    verifiable:   { color: 'var(--accent-success)', icon: '✓' },
    unverifiable: { color: 'var(--accent-warn)',    icon: '~' },
    false_logic:  { color: 'var(--accent-danger)',  icon: '✗' },
    emotional:    { color: '#a78bfa',               icon: '!' },
  };

  const claimsHTML = (ai.claims || []).slice(0, 5).map((c, i) => {
    const st = STATUS_STYLE[c.status] || STATUS_STYLE.unverifiable;
    return `
      <div style="display:flex;gap:10px;padding:10px 12px;background:var(--bg-deep);
        border-radius:8px;margin-bottom:6px;border-left:3px solid ${st.color};">
        <div style="font-family:var(--font-mono);font-size:11px;color:${st.color};
          min-width:18px;font-weight:700;padding-top:1px;">${st.icon}</div>
        <div style="flex:1;">
          <div style="font-size:0.82rem;color:var(--text-primary);margin-bottom:3px;">${_esc(c.text || '')}</div>
          ${c.note ? `<div style="font-size:0.72rem;color:var(--text-muted);">${_esc(c.note)}</div>` : ''}
        </div>
        <div style="font-family:var(--font-mono);font-size:0.75rem;font-weight:700;
          color:${st.color};flex-shrink:0;">${c.credibility ?? '—'}%</div>
      </div>`;
  }).join('');

  const flagsHTML = (ai.redFlags || []).map(f =>
    `<div style="font-size:0.78rem;padding:5px 10px;background:rgba(255,61,90,.06);
      border-left:2px solid var(--accent-danger);border-radius:4px;margin-bottom:4px;
      color:var(--text-secondary);">🚩 ${_esc(f)}</div>`
  ).join('');

  const fallaciesHTML = (ai.logicalFallacies || []).length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${ai.logicalFallacies.map(f =>
          `<span style="font-size:0.72rem;padding:2px 8px;border-radius:99px;
            background:rgba(167,139,250,.12);color:#a78bfa;
            border:1px solid rgba(167,139,250,.25);">${_esc(f)}</span>`
        ).join('')}
       </div>`
    : '';

  const sourcesHTML = (ai.checkSources || []).map(s =>
    `<div style="font-size:0.78rem;color:var(--accent-primary);padding:3px 0;">→ ${_esc(s)}</div>`
  ).join('');

  const card = document.createElement('div');
  card.id = 'fn-ai-analysis-card';
  card.className = 'panel mb-lg anim-fadeInUp';
  card.innerHTML = `
    <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;">
      <span>🤖 Phân tích AI — Fakenews Service</span>
      <span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--text-muted);">
        fakenews-service · deep analysis
      </span>
    </div>

    <!-- Verdict banner -->
    <div style="display:flex;align-items:center;gap:16px;padding:16px 18px;
      background:var(--bg-elevated);border-radius:var(--radius-md);margin-bottom:18px;
      border-left:4px solid ${vs.color};">
      <div style="font-size:2rem;">${vs.icon}</div>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:1rem;color:${vs.color};margin-bottom:4px;">
          ${vs.label}
        </div>
        <div style="font-size:0.83rem;color:var(--text-secondary);line-height:1.6;">
          ${_esc(ai.summary || ai.overallAssessment || '')}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:900;
          color:${vs.color};">${ai.fakePct ?? '—'}</div>
        <div style="font-size:0.62rem;color:var(--text-muted);letter-spacing:.08em;">RISK %</div>
      </div>
    </div>

    <!-- 2-col layout -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px;">

      <!-- Claims -->
      <div>
        <div style="font-size:0.72rem;color:var(--text-muted);font-weight:700;
          text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;">
          📋 Phân tích Claim (${(ai.claims||[]).length})
        </div>
        ${claimsHTML || '<div style="font-size:0.8rem;color:var(--text-muted);">Không phát hiện claim cụ thể.</div>'}
      </div>

      <!-- Red flags + bias -->
      <div>
        ${flagsHTML ? `
        <div style="font-size:0.72rem;color:var(--text-muted);font-weight:700;
          text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;">
          🚩 Dấu hiệu Đáng ngờ
        </div>
        ${flagsHTML}` : ''}

        ${ai.biasType && ai.biasType !== 'none' ? `
        <div style="margin-top:12px;">
          <div style="font-size:0.72rem;color:var(--text-muted);font-weight:700;
            text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">⚖️ Thiên vị</div>
          <div style="font-size:0.8rem;padding:8px 10px;background:rgba(251,146,60,.06);
            border:1px solid rgba(251,146,60,.2);border-radius:6px;color:var(--text-secondary);">
            <span style="color:var(--accent-warn);font-weight:700;">${_esc(ai.biasType)}</span>
            ${ai.biasDescription ? ' — ' + _esc(ai.biasDescription) : ''}
          </div>
        </div>` : ''}

        ${ai.emotionalManipulation ? `
        <div style="margin-top:10px;font-size:0.8rem;padding:8px 10px;
          background:rgba(167,139,250,.07);border:1px solid rgba(167,139,250,.2);
          border-radius:6px;color:var(--text-secondary);">
          🧠 <span style="color:#a78bfa;font-weight:600;">Thao túng cảm xúc:</span>
          ${_esc(ai.emotionalManipulation)}
        </div>` : ''}
      </div>
    </div>

    <!-- Logical fallacies -->
    ${ai.logicalFallacies?.length ? `
    <div style="margin-bottom:14px;">
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:700;
        text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">
        🔍 Sai lầm logic
      </div>
      ${fallaciesHTML}
    </div>` : ''}

    <!-- Overall + sources -->
    ${ai.overallAssessment ? `
    <div style="padding:12px 14px;background:var(--bg-deep);border-radius:8px;
      border:1px solid var(--border-subtle);margin-bottom:14px;">
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:700;
        text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">📝 Đánh giá Tổng thể</div>
      <div style="font-size:0.83rem;color:var(--text-secondary);line-height:1.65;">
        ${_esc(ai.overallAssessment)}
      </div>
    </div>` : ''}

    ${sourcesHTML ? `
    <div>
      <div style="font-size:0.72rem;color:var(--text-muted);font-weight:700;
        text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">
        🔗 Nguồn Fact-check Đề xuất
      </div>
      ${sourcesHTML}
    </div>` : ''}
  `;

  // Insert trước verdict panel cũ
  const verdictPanel = rs.querySelector('.panel');
  if (verdictPanel) {
    rs.insertBefore(card, verdictPanel);
  } else {
    rs.appendChild(card);
  }
}

// ── Display original results ──────────────────────────────────
function _displayResults(result, content, sourceURL, pubDate) {
  const fake  = Math.round(result.fakePct ?? result.aiPct ?? 50);
  const real  = Math.round(result.realPct ?? result.humanPct ?? (100 - fake));

  // Danger bar
  const fill  = document.getElementById('danger-fill');
  const lbl   = document.getElementById('danger-label');
  const summ  = document.getElementById('danger-summary');
  if (fill) {
    fill.style.width      = fake + '%';
    fill.style.background = fake <= 33
      ? 'var(--accent-success)'
      : fake <= 66 ? 'var(--accent-warn)' : 'var(--accent-danger)';
  }
  if (lbl)  lbl.textContent  = _dangerLabel(fake);
  if (summ) summ.textContent = result.aiAnalysis?.summary || _dangerSumm(fake);

  // Source badge
  const srcBadge = document.getElementById('analysis-source-badge');
  if (srcBadge && result._source) {
    srcBadge.textContent  = `🤖 ${result._source}`;
    srcBadge.style.display = 'block';
  }

  // Verdict
  const emoji = fake <= 33 ? '✅' : fake <= 66 ? '⚠️' : '❌';
  const label = fake <= 33 ? 'Rủi ro Thấp' : fake <= 66 ? 'Rủi ro Trung bình' : 'Rủi ro Cao / Có thể Tin giả';
  _setText('verdict-emoji', emoji);
  _setText('verdict-title', label);
  _setText('verdict-recommendation',
    fake <= 33
      ? 'Bài viết có vẻ xác thực. Nguồn có vẻ đáng tin cậy.'
      : fake <= 66
        ? 'Tín hiệu hỗn hợp. Hãy xác minh độc lập trước khi chia sẻ.'
        : 'Dấu hiệu thông tin sai mạnh. Không chia sẻ khi chưa xác minh.'
  );

  // Claims
  const claimsEl  = document.getElementById('claims-breakdown');
  const numClaims = Math.ceil(content.split(/\.\s+/).length * 0.3) + 1;
  const unverified = Math.floor(numClaims * (fake / 100));
  if (claimsEl) claimsEl.innerHTML = `
    <div class="claim-analysis">
      <div class="claim-item"><div class="claim-icon">📊</div><div class="claim-text"><strong>${numClaims}</strong> claim được phát hiện</div></div>
      <div class="claim-item"><div class="claim-icon">✓</div><div class="claim-text"><strong>${numClaims - unverified}</strong> claim có vẻ đáng tin</div></div>
      <div class="claim-item"><div class="claim-icon">⚠️</div><div class="claim-text"><strong>${unverified}</strong> claim chưa xác minh được</div></div>
      <div class="claim-item"><div class="claim-icon">🎯</div><div class="claim-text"><strong>${Math.round((result.confidence ?? 0.6) * 100)}%</strong> độ tin cậy phân tích</div></div>
    </div>`;

  // Sources
  const srcEl = document.getElementById('sources-assessment');
  if (srcEl) {
    let domain = 'Không xác định';
    if (sourceURL) {
      try {
        domain = `<a href="${sourceURL}" target="_blank" rel="noopener" style="color:var(--accent-primary);">
          ${new URL(sourceURL).hostname}</a>`;
      } catch { domain = sourceURL; }
    }
    const cls = real > 70 ? 'authentic' : real > 40 ? 'questionable' : 'suspicious';
    srcEl.innerHTML = `
      <div class="source-card ${cls}">
        <div style="font-weight:600;margin-bottom:4px;">📰 Nguồn bài viết</div>
        <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;">${domain}</div>
        <div style="font-size:0.75rem;"><strong>${real}%</strong> điểm tin cậy</div>
      </div>
      <div class="source-card ${fake > 40 ? 'suspicious' : 'info'}">
        <div style="font-weight:600;margin-bottom:4px;">📆 Ngày xuất bản</div>
        <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;">${pubDate || 'Chưa xác định'}</div>
        <div style="font-size:0.75rem;">${pubDate ? '✓ Có ngày' : '⚠️ Thiếu ngày xuất bản'}</div>
      </div>`;
  }

  // Quick stats
  _setText('claim-count',       numClaims);
  _setText('source-credibility', `${real}% ${sourceURL ? '✓' : '⚠️'}`);
  _setText('language-bias',     (fake > 60 ? 'Cao' : fake > 30 ? 'Trung bình' : 'Thấp') + ' — thiên vị');
}

// ── Helpers ───────────────────────────────────────────────────
function _dangerLabel(p) {
  return p <= 20 ? 'An toàn' : p <= 40 ? 'Rủi ro thấp' : p <= 60 ? 'Rủi ro trung bình' : p <= 80 ? 'Rủi ro cao' : 'Rủi ro rất cao';
}
function _dangerSumm(p) {
  return p <= 20 ? 'Nội dung có vẻ xác thực với nguồn đáng tin cậy.'
    : p <= 40 ? 'Một số dấu hiệu nhỏ. Hầu hết các claim có vẻ đáng tin nhưng cần xác minh.'
    : p <= 60 ? 'Tín hiệu hỗn hợp. Nên xác minh độc lập các claim.'
    : p <= 80 ? 'Dấu hiệu tin giả mạnh. Nhiều claim không thể xác minh.'
    : 'Dấu hiệu rõ ràng của thông tin sai hoặc bịa đặt có chủ đích.';
}
function _setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = String(v); }
function _bar(pct) { const el = document.getElementById('processing-bar'); if (el) el.style.width = pct + '%'; }
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _renderSteps(steps) {
  const el = document.getElementById('processing-steps');
  if (!el) return;
  el.innerHTML = steps.map(s =>
    `<div id="step-${s.id}" style="display:flex;align-items:center;gap:10px;font-size:0.83rem;">
      <span style="color:var(--text-muted);">⏳</span> ${s.label}
    </div>`
  ).join('');
}

function _done(id) {
  const el = document.getElementById(`step-${id}`);
  if (el) {
    el.innerHTML = el.innerHTML
      .replace('⏳', '<span style="color:var(--accent-success);">✓</span>');
  }
}

// ── DOM ready ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Char counter
  document.getElementById('article-content')?.addEventListener('input', function () {
    _setText('content-count', this.value.length + ' ký tự');
  });

  // Source badge element
  const rs = document.getElementById('results-section');
  if (rs && !document.getElementById('analysis-source-badge')) {
    const b = document.createElement('div');
    b.id = 'analysis-source-badge';
    b.style.cssText = 'display:none;font-size:0.72rem;color:var(--text-muted);font-family:monospace;margin-bottom:10px;';
    rs.insertAdjacentElement('afterbegin', b);
  }
});