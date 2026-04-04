// ═══════════════════════════════════════
// UI — Shared Interface Utilities
// ═══════════════════════════════════════

const UI = {

  toast(message, type = 'info', duration = 3000) {
    const colors = {
      info:    'var(--accent-primary)',
      success: 'var(--accent-success)',
      warn:    'var(--accent-warn)',
      error:   'var(--accent-danger)',
    };
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:9999;
      background:var(--bg-panel); border:1px solid ${colors[type]}40;
      border-left:3px solid ${colors[type]};
      padding:12px 20px; border-radius:var(--radius-md);
      font-size:0.85rem; color:var(--text-primary);
      box-shadow:0 4px 24px rgba(0,0,0,0.4);
      animation:fadeInUp 0.3s ease both;
      max-width:340px;
    `;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'fadeIn 0.3s ease reverse both';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  show(id)   { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); },
  hide(id)   { const el = document.getElementById(id); if (el) el.classList.add('hidden');    },
  toggle(id) { const el = document.getElementById(id); if (el) el.classList.toggle('hidden'); },

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  },

  modelVoteRow(model) {
    const color = model.color || 'var(--accent-primary)';
    return `
      <div class="model-vote">
        <div style="width:90px;font-size:0.7rem;color:var(--text-secondary);flex-shrink:0;">${model.modelName}</div>
        <div class="vote-bar">
          <div class="vote-fill" style="width:${model.score}%;background:${color};"></div>
        </div>
        <div style="width:36px;text-align:right;font-family:var(--font-display);font-size:0.75rem;font-weight:700;color:${color};">${Math.round(model.score)}</div>
      </div>
    `;
  },

  /**
   * Timeline card — dùng chung cho tất cả loại result:
   *   text  → result.html  (AI analysis)
   *   image → result.html  (AI analysis)
   *   url   → url-check.html?url=...  (URL Safety Check)
   *   nft   → nft.html (mở collection tab, highlight NFT đó)
   */
  timelineCard(result) {
    const verdict = CONFIG.getVerdict(result.trustScore);
    const date    = new Date(result.savedAt || result.timestamp).toLocaleString();

    // ── Icon theo type ──
    const TYPE_ICON = { text:'📝', image:'🖼️', url:'🔗', nft:'🎨' };
    const typeIcon  = TYPE_ICON[result.type] || '📄';

    // ── Preview text ──
    let preview = '';
    if (result.type === 'nft' && result.nft) {
      const nft = result.nft;
      preview   = `${nft.name || 'Unnamed NFT'} · ${nft.rarity || 'Common'} · ${nft.creator || 'Unknown'}`;
    } else if (result.type === 'url') {
      // Ưu tiên urlData.url → content → fallback
      const rawUrl = result.urlData?.url || result.content || '';
      try {
        const u = new URL(rawUrl);
        const threat = result.urlData?.threatScore ?? (100 - result.trustScore);
        const safeLabel = threat <= 25 ? '✅ Safe' : threat <= 50 ? '⚠️ Medium' : threat <= 75 ? '🔶 High' : '🚨 Critical';
        preview = `${u.hostname}  —  ${safeLabel} (threat: ${threat})`;
      } catch {
        preview = rawUrl.slice(0, 80) || '[url]';
      }
    } else {
      preview = result.content
        ? result.content.slice(0, 80) + (result.content.length > 80 ? '…' : '')
        : `[${result.type || 'content'}]`;
    }

    // ── Verdict badge ──
    let verdictLabel, verdictColor, scoreDisplay;
    if (result.type === 'nft') {
      verdictLabel  = '🎨 NFT';
      verdictColor  = 'var(--accent-success)';
      scoreDisplay  = `<span style="font-size:0.75rem;font-weight:700;color:var(--accent-success);">${result.nft?.rarity || 'NFT'}</span>`;
    } else if (result.type === 'url') {
      const threat      = result.urlData?.threatScore ?? (100 - result.trustScore);
      const tColor      = threat <= 25 ? 'var(--accent-success)' : threat <= 50 ? 'var(--accent-warn)' : 'var(--accent-danger)';
      verdictLabel  = verdict.label;
      verdictColor  = tColor;
      scoreDisplay  = `<span style="font-family:var(--font-display);font-size:1.1rem;font-weight:900;color:${tColor};">${threat}<span style="font-size:0.6rem;opacity:.7"> risk</span></span>`;
    } else {
      verdictLabel  = verdict.label;
      verdictColor  = verdict.color;
      scoreDisplay  = `<span style="font-family:var(--font-display);font-size:1.2rem;font-weight:900;color:${verdict.color};">${result.trustScore}</span>`;
    }

    // ── Link ──
    let viewLink = '';
    if (result.type === 'url') {
      const urlParam = encodeURIComponent(result.urlData?.url || result.content || '');
      viewLink = `<a href="url-check.html?url=${urlParam}" class="btn btn-ghost" style="padding:4px 10px;font-size:0.6rem;">View →</a>`;
    } else if (result.type === 'nft') {
      viewLink = `<a href="nft.html" class="btn btn-ghost" style="padding:4px 10px;font-size:0.6rem;">View →</a>`;
    } else {
      viewLink = `<a href="result.html?id=${result.id}" class="btn btn-ghost" style="padding:4px 10px;font-size:0.6rem;">View →</a>`;
    }

    const safePreview = typeof escapeHTML === 'function' ? escapeHTML(preview) : preview;

    return `
      <div class="timeline-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <span class="badge badge-cyan"
                style="color:${verdictColor};border-color:${verdictColor}40;background:${verdictColor}15;display:flex;align-items:center;gap:4px;">
            <span>${typeIcon}</span>
            <span>${verdictLabel}</span>
          </span>
          ${scoreDisplay}
        </div>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:8px;
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">
          ${safePreview}
        </p>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.65rem;color:var(--text-muted);">${date}</span>
          ${viewLink}
        </div>
      </div>
    `;
  },
};

window.UI = UI;