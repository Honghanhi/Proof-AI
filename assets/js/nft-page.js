// ════════════════════════════════════════════════════════════════
//  NFT-PAGE  v2.0  (FIXED + AI UPGRADED)
//
//  Fixes:
//  1. Thumbnail: lưu đúng data-URI (với prefix data:image/...;base64,)
//     thay vì raw base64 → <img> hiển thị đúng
//  2. Tag chip class: dùng 'nft-tag-chip' đúng với CSS trong nft.html
//  3. Reset form: text chuẩn tiếng Việt
//  4. nft-dz-icon / nft-dz-text → querySelector('.dz-icon') đúng DOM
//
//  Upgrades (AI via Claude API):
//  5. AI image authenticity check khi upload ảnh
//  6. AI auto-generate description
//  7. AI badge hiển thị kết quả check trên preview
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
let _nftFile        = null;
let _nftRarity      = 'Rare';
let _nftTags        = [];
let _nftCurrentView = 'mint';  // 'mint' | 'collection' | 'verify'
let _nftAICheck     = null;    // kết quả AI check ảnh

// ── Claude API helper — dùng ai-proxy-config.js ──────────────
async function _nftCallClaude(messages, maxTokens = 800) {
  if (typeof AIBackend === 'undefined') return null;
  // messages là array [{role,content}] hoặc với image
  const hasImage = Array.isArray(messages[0]?.content);
  if (hasImage) {
    // Vision: lấy text prompt
    const textPart = messages[0]?.content?.find?.(p => p.type === 'text');
    const prompt = textPart?.text || '';
    return await AIBackend.callAI(prompt, maxTokens);
  }
  const prompt = messages[0]?.content || '';
  return await AIBackend.callAI(prompt, maxTokens);
}

// ── Tab switching ─────────────────────────────────────────────
function nftSwitchTab(tab) {
  _nftCurrentView = tab;
  ['mint', 'collection', 'verify'].forEach(t => {
    const el  = document.getElementById(`nft-tab-${t}`);
    const btn = document.getElementById(`nft-btn-${t}`);
    if (el)  el.style.display  = t === tab ? '' : 'none';
    if (btn) {
      btn.className = t === tab
        ? 'btn btn-primary'
        : (t === 'verify' ? 'btn btn-ghost' : 'btn btn-outline');
    }
  });
  if (tab === 'collection') nftRenderCollection();
}

// ── File handling ─────────────────────────────────────────────
function nftHandleDragOver(e)   { e.preventDefault(); document.getElementById('nft-drop-zone')?.classList.add('drag-over'); }
function nftHandleDragLeave()   { document.getElementById('nft-drop-zone')?.classList.remove('drag-over'); }
function nftHandleDrop(e)       { e.preventDefault(); nftHandleDragLeave(); const f = e.dataTransfer.files[0]; if (f) nftProcessFile(f); }
function nftHandleFileSelect(e) { const f = e.target.files[0]; if (f) nftProcessFile(f); }

async function nftProcessFile(file) {
  if (file.size > 52_428_800) { UI.toast('Tệp quá lớn (tối đa 50MB).', 'warn'); return; }

  _nftFile    = file;
  _nftAICheck = null;

  // Cập nhật drop zone UI
  const dz = document.getElementById('nft-drop-zone');
  if (dz) {
    const icon = dz.querySelector('.dz-icon');
    const text = dz.querySelector('.dz-text');
    if (icon) icon.textContent     = _nftFileIcon(file.type);
    if (text) text.textContent     = file.name;
    dz.style.borderColor           = 'rgba(0,229,255,.6)';
  }

  // File info bar
  const info = document.getElementById('nft-file-info');
  if (info) {
    info.style.display = 'block';
    info.textContent   = `${file.name}  •  ${_nftFmtSize(file.size)}  •  ${file.type || 'unknown'}`;
  }

  // Preview + đọc base64
  if (file.type.startsWith('image/')) {
    const dataURI = await _nftReadDataURI(file);  // FIX: đọc full data-URI

    const prev = document.getElementById('nft-preview-canvas');
    if (prev) {
      prev.innerHTML = `
        <img src="${dataURI}" alt="preview"
          style="width:100%;height:100%;object-fit:cover;border-radius:12px;" />
        <div class="nft-watermark" id="nft-wm">AI-PROOF NFT</div>
        <div id="nft-ai-badge-overlay" style="position:absolute;bottom:40px;left:8px;right:8px;
          display:flex;justify-content:center;"></div>`;
    }

    // Auto-fill name
    const nameEl = document.getElementById('nft-name');
    if (nameEl && !nameEl.value) {
      nameEl.value = file.name.replace(/\.[^.]+$/, '');
    }

    document.getElementById('nft-mint-btn').disabled = false;

    // AI check (non-blocking)
    _nftRunAICheck(file, dataURI);

  } else {
    const prev = document.getElementById('nft-preview-canvas');
    if (prev) {
      prev.innerHTML = `
        <span style="font-size:4rem;">${_nftFileIcon(file.type)}</span>
        <div class="nft-watermark">AI-PROOF NFT</div>`;
    }
    const nameEl = document.getElementById('nft-name');
    if (nameEl && !nameEl.value) nameEl.value = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('nft-mint-btn').disabled = false;
  }
}

// ── AI Image Authenticity Check ───────────────────────────────
async function _nftRunAICheck(file, dataURI) {
  _nftStatus('🔍 AI đang phân tích hình ảnh…', 'var(--accent-primary)');

  // Hiện spinner badge
  const badge = document.getElementById('nft-ai-badge-overlay');
  if (badge) {
    badge.innerHTML = `<div style="background:rgba(0,0,0,.75);border:1px solid rgba(0,229,255,.3);
      border-radius:8px;padding:5px 10px;font-size:0.7rem;color:var(--accent-primary);
      display:flex;align-items:center;gap:6px;">
      <div class="spinner" style="width:10px;height:10px;border-width:1.5px;"></div>
      Đang phân tích AI…
    </div>`;
  }

  const base64 = dataURI.split(',')[1];
  const prompt = `Phân tích ảnh này và trả về JSON (không markdown):
{
  "isAIGenerated": true/false,
  "aiConfidence": 0-100,
  "artStyle": "photo|illustration|digital_art|3d|pixel_art|painting|other",
  "hasCopyrightRisk": true/false,
  "copyrightNotes": "ghi chú hoặc null",
  "contentAppropriate": true/false,
  "description": "mô tả ngắn 1 câu tiếng Việt về ảnh",
  "uniquenessScore": 0-100,
  "recommendation": "mint_safe|mint_with_warning|do_not_mint"
}`;

  const raw = await _nftCallClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
      { type: 'text',  text: prompt },
    ],
  }], 600);

  let aiResult = null;
  if (raw) {
    try { aiResult = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch {}
  }

  _nftAICheck = aiResult;

  if (!aiResult) {
    _nftStatus('', '');
    if (badge) badge.innerHTML = '';
    return;
  }

  // Render badge trên preview
  const REC_MAP = {
    mint_safe:          { color: '#00ff9d', icon: '✅', text: 'An toàn để Mint' },
    mint_with_warning:  { color: '#f59e0b', icon: '⚠️', text: 'Cẩn thận khi Mint' },
    do_not_mint:        { color: '#ef4444', icon: '🚫', text: 'Không nên Mint'   },
  };
  const rec = REC_MAP[aiResult.recommendation] || REC_MAP.mint_with_warning;

  if (badge) {
    badge.innerHTML = `
      <div style="background:rgba(0,0,0,.82);border:1px solid ${rec.color}44;
        border-radius:8px;padding:5px 12px;font-size:0.7rem;color:${rec.color};
        display:flex;align-items:center;gap:6px;">
        ${rec.icon} ${rec.text}
        ${aiResult.isAIGenerated ? `<span style="color:var(--accent-warn);margin-left:4px;">
          · AI-gen ${aiResult.aiConfidence}%</span>` : ''}
      </div>`;
  }

  // Render panel bên dưới mint button
  _nftRenderAIPanel(aiResult);

  // Status update
  if (aiResult.recommendation === 'do_not_mint') {
    _nftStatus('🚫 AI cảnh báo: Không nên mint ảnh này', '#ef4444');
  } else if (aiResult.isAIGenerated && aiResult.aiConfidence > 65) {
    _nftStatus(`⚠️ Phát hiện ảnh AI (${aiResult.aiConfidence}% tin cậy) — hãy cân nhắc`, '#f59e0b');
    UI.toast(`⚠️ Ảnh có thể do AI tạo ra (${aiResult.aiConfidence}% tin cậy)`, 'warn', 6000);
  } else {
    _nftStatus('✅ AI đã xác minh — An toàn để mint', '#00ff9d');
  }
}

function _nftRenderAIPanel(ai) {
  const container = document.getElementById('nft-ai-check-panel');
  if (!container) return;

  const REC_MAP = {
    mint_safe:          { color: '#00ff9d', bg: 'rgba(0,255,157,.06)',  label: 'An toàn để Mint' },
    mint_with_warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,.06)', label: 'Cẩn thận'        },
    do_not_mint:        { color: '#ef4444', bg: 'rgba(239,68,68,.06)',   label: 'Không nên Mint'  },
  };
  const r = REC_MAP[ai.recommendation] || REC_MAP.mint_with_warning;

  container.style.display = 'block';
  container.innerHTML = `
    <div style="background:${r.bg};border:1px solid ${r.color}33;border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:0.72rem;font-weight:700;color:${r.color};
          text-transform:uppercase;letter-spacing:.08em;">🤖 AI Xác minh Ảnh</div>
        <span style="font-size:0.68rem;color:var(--text-muted);font-family:var(--font-mono);">claude-sonnet</span>
      </div>
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:10px;line-height:1.5;">
        ${ai.description || ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.78rem;">
        <div style="padding:7px 9px;background:var(--bg-elevated);border-radius:6px;">
          <div style="color:var(--text-muted);font-size:0.65rem;margin-bottom:2px;">Phong cách</div>
          <div style="color:var(--text-primary);">${ai.artStyle || '—'}</div>
        </div>
        <div style="padding:7px 9px;background:var(--bg-elevated);border-radius:6px;">
          <div style="color:var(--text-muted);font-size:0.65rem;margin-bottom:2px;">Độc đáo</div>
          <div style="color:var(--text-primary);">${ai.uniquenessScore ?? '—'}%</div>
        </div>
        <div style="padding:7px 9px;background:var(--bg-elevated);border-radius:6px;">
          <div style="color:var(--text-muted);font-size:0.65rem;margin-bottom:2px;">AI-generated</div>
          <div style="color:${ai.isAIGenerated ? '#f59e0b' : '#00ff9d'};">
            ${ai.isAIGenerated ? `⚠️ Có thể (${ai.aiConfidence}%)` : '✅ Không phát hiện'}
          </div>
        </div>
        <div style="padding:7px 9px;background:var(--bg-elevated);border-radius:6px;">
          <div style="color:var(--text-muted);font-size:0.65rem;margin-bottom:2px;">Bản quyền</div>
          <div style="color:${ai.hasCopyrightRisk ? '#ef4444' : '#00ff9d'};">
            ${ai.hasCopyrightRisk ? '⚠️ Có rủi ro' : '✅ Ổn'}
          </div>
        </div>
      </div>
      ${ai.copyrightNotes ? `
      <div style="margin-top:8px;font-size:0.75rem;color:var(--accent-warn);padding:5px 8px;
        background:rgba(245,158,11,.07);border-radius:5px;">⚠️ ${ai.copyrightNotes}</div>` : ''}
      ${!ai.contentAppropriate ? `
      <div style="margin-top:8px;font-size:0.75rem;color:#ef4444;padding:5px 8px;
        background:rgba(239,68,68,.07);border-radius:5px;">🚫 Nội dung không phù hợp</div>` : ''}
    </div>`;
}

// ── AI Generate Description ───────────────────────────────────
async function nftGenerateDescription() {
  if (!_nftFile || !_nftFile.type.startsWith('image/')) {
    UI.toast('Cần tải ảnh lên trước.', 'warn');
    return;
  }

  const btn = document.getElementById('nft-gen-desc-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo…'; }

  const dataURI = await _nftReadDataURI(_nftFile);
  const base64  = dataURI.split(',')[1];

  const raw = await _nftCallClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: _nftFile.type, data: base64 } },
      { type: 'text',  text: 'Viết mô tả nghệ thuật chuyên nghiệp cho NFT này bằng tiếng Việt (2-3 câu). Không dùng markdown. Bắt đầu thẳng vào mô tả.' },
    ],
  }], 300);

  if (raw) {
    const desc = document.getElementById('nft-desc');
    if (desc) desc.value = raw.trim();
    UI.toast('✨ Đã tạo mô tả AI!', 'success');
  } else {
    UI.toast('Không thể tạo mô tả. Thử lại sau.', 'warn');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '✨ Tạo mô tả AI'; }
}

// ── Rarity ────────────────────────────────────────────────────
function nftSelectRarity(btn) {
  document.querySelectorAll('.nft-rarity-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _nftRarity = btn.dataset.rarity;
}

// ── Tags ──────────────────────────────────────────────────────
function nftHandleTagInput(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(',', '');
    if (val && !_nftTags.includes(val) && _nftTags.length < 10) {
      _nftTags.push(val);
      _nftRenderTags();
    }
    e.target.value = '';
  }
}

function nftRemoveTag(tag) { _nftTags = _nftTags.filter(t => t !== tag); _nftRenderTags(); }

function _nftRenderTags() {
  const container = document.getElementById('nft-tag-container');
  const field     = document.getElementById('nft-tag-field');
  if (!container || !field) return;

  // Remove old chips (keep the input field)
  container.querySelectorAll('.nft-tag-chip').forEach(el => el.remove());

  _nftTags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'nft-tag-chip';  // FIX: dùng đúng class CSS từ nft.html
    chip.innerHTML = `${_escTag(tag)} <button type="button" onclick="nftRemoveTag('${_escTag(tag)}')" aria-label="Remove">×</button>`;
    container.insertBefore(chip, field);
  });
}

function _escTag(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
}

// ── MINT ─────────────────────────────────────────────────────
async function nftMint() {
  const name       = document.getElementById('nft-name')?.value.trim()       || '';
  const desc       = document.getElementById('nft-desc')?.value.trim()       || '';
  const creator    = document.getElementById('nft-creator')?.value.trim()    || '';
  const collection = document.getElementById('nft-collection')?.value.trim() || '';
  const royalty    = parseInt(document.getElementById('nft-royalty')?.value) || 0;

  if (!name)     { UI.toast('Vui lòng nhập tên NFT.', 'warn'); return; }
  if (!_nftFile) { UI.toast('Vui lòng tải lên một tệp.', 'warn'); return; }

  // Cảnh báo AI nếu có
  if (_nftAICheck?.recommendation === 'do_not_mint') {
    const confirmed = confirm('⚠️ AI cảnh báo không nên mint ảnh này. Bạn vẫn muốn tiếp tục?');
    if (!confirmed) return;
  }

  const btn = document.getElementById('nft-mint-btn');
  btn.disabled = true;
  btn.classList.add('minting');
  _nftStatus('🔄 Đang đọc tệp…', 'var(--accent-primary)');

  try {
    // ── Step 1: Đọc file → data-URI đầy đủ ──
    _nftStatus('🔐 Đang tính SHA-256…', 'var(--accent-primary)');
    const dataURI     = await _nftReadDataURI(_nftFile);  // FIX: full data-URI
    const base64Only  = dataURI.split(',')[1];            // chỉ phần base64

    // Hash từ base64 (nhất quán với việc verify)
    const contentHash = await Hash.text(base64Only);

    // FIX: Thumbnail lưu đầy đủ data-URI để <img src="..."> hiển thị đúng
    const thumbData = _nftFile.type.startsWith('image/')
      ? (dataURI.length > 300_000
          ? await _nftResizeThumbnail(dataURI)   // resize nếu quá lớn
          : dataURI)
      : null;

    // ── Step 2: Build result object ──
    _nftStatus('⛓️ Đang ghi vào blockchain…', 'var(--accent-primary)');

    const nftId      = `nft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const verdictObj = CONFIG.getVerdict(100);
    const now        = new Date().toISOString();

    const nftMeta = {
      name, description: desc,
      creator:    creator || 'Anonymous',
      collection, royalty,
      rarity:     _nftRarity,
      tags:       [..._nftTags],
      fileName:   _nftFile.name,
      fileSize:   _nftFile.size,
      fileType:   _nftFile.type,
      thumbnail:  thumbData,    // FIX: full data-URI
      aiAnalysis: _nftAICheck || null,
      usageLog:   [{ time: now, action: 'Minted', by: creator || 'Owner' }],
      transfers:  [],
    };

    const result = {
      id:          nftId,
      type:        'nft',
      nftType:     _nftTypeFromMime(_nftFile.type),
      content:     `[nft:${_nftFile.name}]`,
      contentHash,
      trustScore:  100,
      verdict:     verdictObj,
      models:      [],
      signals:     [],
      explanation: `NFT đã mint và niêm phong mã hoá. Tệp: ${_nftFile.name} (${_nftFmtSize(_nftFile.size)}).`,
      timestamp:   now,
      savedAt:     now,
      nft:         nftMeta,
    };

    // ── Step 3: Lưu vào DB ──
    await DB.saveResult(result);

    // ── Step 4: Ghi blockchain ──
    const block = await Blockchain.addResult(result);
    result.blockIndex = block.index;
    result.blockHash  = block.hash;
    await DB.saveResult(result);  // update với block info

    if (creator) localStorage.setItem('nft_creator_name', creator);

    _nftStatus('✅ NFT đã được mint!', '#00ff9d');
    btn.classList.remove('minting');

    UI.toast(`✨ NFT "${name}" đã mint — Block #${block.index}`, 'success', 5000);

    setTimeout(() => {
      _nftShowSuccess(result, block);
      _nftResetForm();
    }, 600);

  } catch (err) {
    btn.disabled = false;
    btn.classList.remove('minting');
    _nftStatus('❌ ' + err.message, '#ef4444');
    console.error('[NFT]', err);
    UI.toast('Mint thất bại: ' + err.message, 'error');
  }
}

// ── Resize thumbnail ──────────────────────────────────────────
function _nftResizeThumbnail(dataURI, maxW = 800, maxH = 800) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const cv  = document.createElement('canvas');
      cv.width  = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataURI);
    img.src = dataURI;
  });
}

// ── Success modal ─────────────────────────────────────────────
function _nftShowSuccess(result, block) {
  document.getElementById('nft-success-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'nft-success-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeInUp .25s ease;';
  modal.innerHTML = `
    <div style="background:var(--bg-panel);border:2px solid #00ff9d;border-radius:16px;
      padding:34px 38px;max-width:440px;width:90%;text-align:center;
      box-shadow:0 0 60px rgba(0,255,157,.15);">
      <div style="font-size:3rem;margin-bottom:10px;">🎉</div>
      <div style="font-size:1.15rem;font-weight:900;color:#00ff9d;margin-bottom:6px;">NFT Đã Mint!</div>
      <div style="font-size:0.86rem;color:var(--text-secondary);margin-bottom:16px;">"${result.nft.name}"</div>

      ${result.nft.thumbnail ? `
      <div style="width:120px;height:120px;border-radius:10px;overflow:hidden;
        margin:0 auto 16px;border:2px solid rgba(0,255,157,.3);">
        <img src="${result.nft.thumbnail}" style="width:100%;height:100%;object-fit:cover;" />
      </div>` : ''}

      <div style="background:rgba(0,0,0,.4);border:1px solid rgba(0,255,157,.12);
        border-radius:8px;padding:12px 14px;margin-bottom:20px;text-align:left;
        display:flex;flex-direction:column;gap:8px;">
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:2px;">NFT ID</div>
          <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--accent-primary);
            word-break:break-all;">${result.id}</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:2px;">Block #${block.index}</div>
          <div style="font-family:var(--font-mono);font-size:0.68rem;color:#a5b4fc;
            word-break:break-all;">${block.hash}</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-bottom:2px;">Content Hash</div>
          <div style="font-family:var(--font-mono);font-size:0.68rem;color:#7aff6e;
            word-break:break-all;">${result.contentHash}</div>
        </div>
        ${result.nft.aiAnalysis ? `
        <div style="padding:6px 8px;background:rgba(0,229,255,.06);border-radius:5px;">
          <div style="font-size:0.68rem;color:var(--accent-primary);">
            🤖 AI: ${result.nft.aiAnalysis.isAIGenerated ? '⚠️ AI-generated detected' : '✅ Human art'} ·
            Uniqueness ${result.nft.aiAnalysis.uniquenessScore ?? '—'}%
          </div>
        </div>` : ''}
      </div>

      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button onclick="document.getElementById('nft-success-modal').remove();nftSwitchTab('collection')"
          style="background:linear-gradient(135deg,#7c3aed,var(--accent-primary));color:#fff;
            border:none;padding:10px 20px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.83rem;">
          Xem Bộ sưu tập
        </button>
        <a href="timeline.html"
          style="background:rgba(255,255,255,.06);color:var(--text-secondary);
            border:1px solid rgba(255,255,255,.12);padding:10px 20px;border-radius:8px;
            font-size:0.83rem;text-decoration:none;display:flex;align-items:center;">
          🕒 Timeline →
        </a>
        <button onclick="document.getElementById('nft-success-modal').remove()"
          style="background:rgba(255,255,255,.06);color:var(--text-muted);
            border:1px solid rgba(255,255,255,.1);padding:10px 14px;
            border-radius:8px;cursor:pointer;font-size:0.83rem;">✕</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── Reset form ────────────────────────────────────────────────
function _nftResetForm() {
  _nftFile    = null;
  _nftTags    = [];
  _nftAICheck = null;

  ['nft-name', 'nft-desc', 'nft-collection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const royalty = document.getElementById('nft-royalty');
  if (royalty) royalty.value = '10';

  // Reset drop zone
  const dz = document.getElementById('nft-drop-zone');
  if (dz) {
    const icon = dz.querySelector('.dz-icon');
    const text = dz.querySelector('.dz-text');
    if (icon) icon.textContent = '📂';
    if (text) text.textContent = 'Thả tệp của bạn tại đây hoặc nhấp để duyệt';  // FIX: tiếng Việt
    dz.style.borderColor = '';
    dz.classList.remove('drag-over');
  }

  // Reset preview
  const prev = document.getElementById('nft-preview-canvas');
  if (prev) prev.innerHTML = '<span style="font-size:4rem;">🖼️</span>';

  const info = document.getElementById('nft-file-info');
  if (info) info.style.display = 'none';

  const fileInput = document.getElementById('nft-file-input');
  if (fileInput) fileInput.value = '';

  document.getElementById('nft-mint-btn').disabled = true;

  // Reset AI panel
  const aiPanel = document.getElementById('nft-ai-check-panel');
  if (aiPanel) { aiPanel.style.display = 'none'; aiPanel.innerHTML = ''; }

  _nftTags = [];
  _nftRenderTags();
  _nftStatus('', '');
}

// ── COLLECTION ───────────────────────────────────────────────
async function nftRenderCollection() {
  const cards  = document.getElementById('nft-cards');
  const count  = document.getElementById('nft-collection-count');
  if (!cards) return;

  cards.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">
      <div class="spinner" style="width:24px;height:24px;margin:0 auto 12px;border-width:2px;"></div>
      <div style="font-size:0.82rem;">Đang tải…</div>
    </div>`;

  const filter  = document.getElementById('nft-rarity-filter')?.value || '';
  let   results = await DB.getResults({ type: 'nft' });
  if (filter) results = results.filter(r => r.nft?.rarity === filter);

  if (count) count.textContent = `${results.length} mục`;

  if (results.length === 0) {
    cards.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--text-muted);">
        <div style="font-size:3rem;margin-bottom:12px;">🗂️</div>
        <div style="font-size:0.88rem;color:var(--text-secondary);">
          ${filter ? 'Không có NFT ' + filter : 'Chưa có NFT nào'}
        </div>
        <div style="font-size:0.78rem;margin-top:6px;">Mint NFT đầu tiên của bạn trong tab Tạo NFT</div>
      </div>`;
    return;
  }

  const RARITY_COLORS = {
    Common:'#9ca3af', Uncommon:'#22c55e', Rare:'#3b82f6',
    Epic:'#a855f7', Legendary:'#fbbf24', Unique:'#ef4444',
  };

  cards.innerHTML = results.map(r => {
    const nft   = r.nft || {};
    const color = RARITY_COLORS[nft.rarity] || '#9ca3af';
    // FIX: thumbnail đã là data-URI đầy đủ → dùng trực tiếp
    const thumbSrc = nft.thumbnail || null;
    return `
      <div class="nft-card" onclick="nftOpenDetail('${r.id}')">
        <div class="nft-card-thumb">
          ${thumbSrc
            ? `<img src="${thumbSrc}" alt="${nft.name}" />`
            : `<span style="font-size:2.5rem;">${_nftFileIcon(nft.fileType)}</span>`}
        </div>
        <span class="nft-card-badge"
          style="background:${color}22;color:${color};border:1px solid ${color}44;">
          ${nft.rarity || 'Common'}
        </span>
        <div class="nft-card-body">
          <div class="nft-card-name">${nft.name || r.id}</div>
          <div class="nft-card-sub">#${r.blockIndex ?? '?'} · ${r.id.slice(-8)}</div>
        </div>
      </div>`;
  }).join('');
}

// ── NFT Detail Modal ─────────────────────────────────────────
async function nftOpenDetail(id) {
  const result = await DB.getResultById(id);
  if (!result) { UI.toast('Không tìm thấy NFT.', 'warn'); return; }

  const nft = result.nft || {};

  // Log usage
  if (!nft.usageLog) nft.usageLog = [];
  nft.usageLog.push({ time: new Date().toISOString(), action: 'Viewed', by: nft.creator || 'Owner' });
  await DB.saveResult(result);

  const chain = await Blockchain.getChain();
  const block = chain.find(b => b.data?.resultId === id);

  document.getElementById('nft-detail-modal')?.remove();

  const RARITY_COLORS = {
    Common:'#9ca3af', Uncommon:'#22c55e', Rare:'#3b82f6',
    Epic:'#a855f7', Legendary:'#fbbf24', Unique:'#ef4444',
  };
  const color = RARITY_COLORS[nft.rarity] || '#9ca3af';

  const modal = document.createElement('div');
  modal.id = 'nft-detail-modal';
  modal.className = 'nft-modal-backdrop';
  modal.innerHTML = `
    <div class="nft-modal-box">
      <!-- Header -->
      <div class="nft-modal-header">
        <div style="font-size:1rem;font-weight:800;color:var(--accent-primary);flex:1;">
          ${nft.name || 'NFT'}
        </div>
        <span style="font-size:0.68rem;padding:3px 9px;border-radius:12px;
          background:${color}22;color:${color};border:1px solid ${color}44;font-weight:700;">
          ${nft.rarity || 'Common'}
        </span>
        <button onclick="document.getElementById('nft-detail-modal').remove()"
          class="btn btn-ghost" style="padding:4px 12px;font-size:0.75rem;margin-left:8px;">✕</button>
      </div>

      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;">

        <!-- Preview -->
        <div style="border-radius:10px;overflow:hidden;background:var(--bg-deep);
          max-height:280px;display:flex;align-items:center;justify-content:center;">
          ${nft.thumbnail
            ? `<img src="${nft.thumbnail}" style="max-width:100%;max-height:280px;object-fit:contain;" />`
            : `<div style="padding:40px;font-size:4rem;">${_nftFileIcon(nft.fileType)}</div>`}
        </div>

        ${nft.description ? `<p style="font-size:0.82rem;color:var(--text-secondary);line-height:1.6;">${nft.description}</p>` : ''}

        <!-- AI Analysis (nếu có) -->
        ${nft.aiAnalysis ? `
        <div style="padding:10px 12px;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.15);
          border-radius:8px;">
          <div style="font-size:0.68rem;color:var(--accent-primary);font-weight:700;margin-bottom:6px;">
            🤖 AI Analysis khi Mint
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:0.75rem;">
            <span style="color:${nft.aiAnalysis.isAIGenerated ? '#f59e0b' : '#00ff9d'};">
              ${nft.aiAnalysis.isAIGenerated ? '⚠️ AI-generated' : '✅ Human art'}
            </span>
            <span style="color:var(--text-muted);">Style: ${nft.aiAnalysis.artStyle || '—'}</span>
            <span style="color:var(--text-muted);">Uniqueness: ${nft.aiAnalysis.uniquenessScore ?? '—'}%</span>
            <span style="color:${nft.aiAnalysis.hasCopyrightRisk ? '#ef4444' : '#00ff9d'};">
              ${nft.aiAnalysis.hasCopyrightRisk ? '⚠️ Copyright risk' : '✅ No copyright risk'}
            </span>
          </div>
          ${nft.aiAnalysis.description ? `<div style="margin-top:6px;font-size:0.75rem;color:var(--text-muted);">${nft.aiAnalysis.description}</div>` : ''}
        </div>` : ''}

        <!-- Meta grid -->
        <div class="nft-meta-grid">
          ${[
            ['Creator',    nft.creator || 'Anonymous'],
            ['Collection', nft.collection || '—'],
            ['Royalty',    nft.royalty + '%'],
            ['File',       nft.fileName || '—'],
            ['Size',       _nftFmtSize(nft.fileSize || 0)],
            ['Minted',     new Date(result.timestamp).toLocaleString('vi-VN')],
            ['Block',      block ? `#${block.index}` : '—'],
            ['Transfers',  (nft.transfers?.length || 0) + ' lần'],
          ].map(([l, v]) => `
            <div class="nft-meta-cell">
              <label>${l}</label>
              <span>${v}</span>
            </div>`).join('')}
        </div>

        <!-- Tags -->
        ${nft.tags?.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${nft.tags.map(t => `
            <span style="background:rgba(0,229,255,.1);color:var(--accent-primary);
              border:1px solid rgba(0,229,255,.22);padding:2px 8px;
              border-radius:12px;font-size:0.7rem;">${t}</span>`).join('')}
        </div>` : ''}

        <!-- Hashes -->
        <div>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:4px;">🔐 Content Hash</div>
          <div class="nft-hash"
            onclick="navigator.clipboard.writeText('${result.contentHash}').then(()=>UI.toast('Đã sao chép!','success'))"
            title="Nhấp để sao chép">
            ${result.contentHash}
          </div>
        </div>

        ${block ? `
        <div>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:4px;">⛓️ Block Hash #${block.index}</div>
          <div class="nft-hash" style="color:#a5b4fc;"
            onclick="navigator.clipboard.writeText('${block.hash}').then(()=>UI.toast('Đã sao chép!','success'))">
            ${block.hash}
          </div>
        </div>` : ''}

        <!-- Usage log -->
        <div>
          <div style="font-size:0.68rem;color:var(--text-muted);font-weight:700;
            text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">
            📋 Nhật ký (${nft.usageLog?.length || 0})
          </div>
          <div class="nft-log">
            ${(nft.usageLog || []).slice().reverse().map(u => `
              <div class="nft-log-row">
                <span style="color:var(--text-muted);font-family:var(--font-mono);flex-shrink:0;">
                  ${new Date(u.time).toLocaleTimeString('vi-VN')}
                </span>
                <span style="flex:1;">${u.action}</span>
                <span style="color:var(--text-muted);font-size:0.68rem;">${u.by}</span>
              </div>`).join('')}
          </div>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button onclick="nftTransfer('${id}')"
            class="btn btn-outline" style="flex:1;font-size:0.77rem;">🔄 Chuyển</button>
          <button onclick="nftExportCard('${id}')"
            class="btn btn-ghost" style="flex:1;font-size:0.77rem;">⬇ JSON</button>
          <button onclick="nftDownloadProtected('${id}')"
            class="btn btn-ghost" style="flex:1;font-size:0.77rem;color:#00ff9d;border-color:rgba(0,255,157,.3);">
            🛡️ Protected
          </button>
          <a href="result.html?id=${id}"
            class="btn btn-ghost" style="flex:1;font-size:0.77rem;text-align:center;text-decoration:none;">
            🔗 Proof
          </a>
          <button onclick="nftBurn('${id}')"
            style="padding:9px 12px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);
              border-radius:var(--radius-md);color:#ef4444;cursor:pointer;font-size:0.77rem;font-family:inherit;">
            🔥
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ── NFT Actions ───────────────────────────────────────────────
async function nftTransfer(id) {
  const to = prompt('Chuyển đến (tên/địa chỉ người nhận):');
  if (!to) return;
  const result = await DB.getResultById(id);
  if (!result) return;
  const nft = result.nft;
  if (!nft.usageLog) nft.usageLog = [];
  if (!nft.transfers) nft.transfers = [];
  nft.usageLog.push({ time: new Date().toISOString(), action: `Chuyển đến: ${to}`, by: nft.creator || 'Owner' });
  nft.transfers.push({ to, from: nft.creator || 'Owner', time: new Date().toISOString() });
  await DB.saveResult(result);
  UI.toast(`NFT đã chuyển đến ${to}`, 'success');
  document.getElementById('nft-detail-modal')?.remove();
  nftRenderCollection();
}

async function nftBurn(id) {
  if (!confirm('⚠️ Hủy NFT này? Không thể hoàn tác.')) return;
  const result = await DB.getResultById(id);
  if (result?.nft?.usageLog) {
    result.nft.usageLog.push({ time: new Date().toISOString(), action: 'Burned', by: result.nft.creator || 'Owner' });
  }
  await DB.deleteResult(id);
  document.getElementById('nft-detail-modal')?.remove();
  nftRenderCollection();
  UI.toast('NFT đã hủy.', 'info');
}

async function nftExportCard(id) {
  const result = await DB.getResultById(id);
  if (!result) return;
  const exportData = { ...result, nft: { ...result.nft, thumbnail: result.nft?.thumbnail ? '[omitted]' : null } };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `nft-${id.slice(-10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  UI.toast('Đã xuất NFT card!', 'success');
}

async function nftExportAll() {
  const all  = await DB.getResults({ type: 'nft' });
  const data = all.map(r => ({ ...r, nft: { ...r.nft, thumbnail: null } }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `nft-collection-${Date.now()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  UI.toast(`Đã xuất ${all.length} NFT`, 'success');
}

// ── VERIFY ────────────────────────────────────────────────────
async function nftVerify() {
  const q     = document.getElementById('nft-verify-input')?.value.trim();
  const resEl = document.getElementById('nft-verify-result');
  if (!q || !resEl) return;

  resEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:0.82rem;">
    <div class="spinner" style="width:14px;height:14px;border-width:1.5px;"></div>Đang tìm kiếm…
  </div>`;

  let found = await DB.getResultById(q);
  if (!found) {
    const all = await DB.getResults({ type: 'nft' });
    found = all.find(r => r.contentHash === q || r.blockHash === q);
  }

  if (found) {
    const nft   = found.nft || {};
    const chain = await Blockchain.getChain();
    const block = chain.find(b => b.data?.resultId === found.id);
    resEl.innerHTML = `
      <div style="background:rgba(0,255,157,.07);border:1px solid rgba(0,255,157,.22);
        border-radius:10px;padding:14px 16px;">
        <div style="color:#00ff9d;font-weight:700;margin-bottom:10px;">
          ✅ NFT Đã Xác minh — ${block ? 'On-chain' : 'Tìm thấy trong DB'}
        </div>
        ${[['Tên',nft.name||'—'],['Creator',nft.creator||'—'],['Độ hiếm',nft.rarity||'—'],
           ['Mint',new Date(found.timestamp).toLocaleString('vi-VN')],
           ['Block',block?`#${block.index}`:'—']].map(([l,v])=>
          `<div style="font-size:0.8rem;color:var(--text-primary);margin-bottom:3px;">
            <strong style="color:var(--text-muted);">${l}:</strong> ${v}
          </div>`).join('')}
        <button onclick="nftOpenDetail('${found.id}')"
          class="btn btn-outline" style="margin-top:12px;font-size:0.77rem;">
          Xem Chi tiết →
        </button>
      </div>`;
  } else {
    resEl.innerHTML = `
      <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);
        border-radius:10px;padding:14px 16px;">
        <div style="color:#ef4444;font-weight:700;margin-bottom:5px;">❌ Không tìm thấy NFT</div>
        <div style="font-size:0.8rem;color:var(--text-muted);">
          Không có NFT nào khớp với ID hoặc hash này trong sổ cái cục bộ.
        </div>
      </div>`;
  }
}

// ── Protected Image ───────────────────────────────────────────
async function nftDownloadProtected(id) {
  if (typeof ImageProtect === 'undefined') {
    UI.toast('Module ImageProtect chưa được tải. Kiểm tra script tag trong nft.html.', 'error');
    return;
  }
  const result = await DB.getResultById(id);
  if (!result) { UI.toast('Không tìm thấy NFT.', 'warn'); return; }
  const nft = result.nft || {};

  if (!nft.fileType?.startsWith('image/')) {
    UI.toast('Tải ảnh được bảo vệ chỉ khả dụng cho NFT dạng ảnh.', 'warn');
    return;
  }
  if (!nft.thumbnail) {
    UI.toast('Không có dữ liệu ảnh. Hãy mint lại với file ảnh.', 'warn');
    return;
  }

  UI.toast('🛡️ Đang áp dụng các lớp bảo vệ…', 'info', 8000);

  try {
    const proof = {
      nftId:       result.id,
      contentHash: result.contentHash,
      blockHash:   result.blockHash   || '',
      blockIndex:  result.blockIndex  ?? null,
    };

    const protected_ = await ImageProtect.protect(
      nft.thumbnail,   // FIX: đây là full data-URI → ImageProtect.protect() nhận đúng
      proof,
      {
        watermarkText: `AI-PROOF · ${nft.name || 'NFT'}`,
        opacity:       0.6,
        position:      'br',
        showHash:      true,
        outputFormat:  'png',
        outputQuality: 0.97,
      }
    );

    const safeName = (nft.name || id).replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    ImageProtect.download(protected_.blob, `aiproof-protected-${safeName}.png`);

    UI.toast(`✅ Ảnh được bảo vệ đã tải — ${protected_.width}×${protected_.height}px`, 'success', 5000);

    if (!nft.usageLog) nft.usageLog = [];
    nft.usageLog.push({ time: new Date().toISOString(), action: 'Downloaded protected image', by: nft.creator || 'Owner' });
    await DB.saveResult(result);

  } catch (err) {
    console.error('[NFT] Protected download failed:', err);
    UI.toast('Bảo vệ thất bại: ' + err.message, 'error');
  }
}

async function nftVerifyProtectedImage(file) {
  if (typeof ImageProtect === 'undefined') {
    UI.toast('Module ImageProtect chưa được tải.', 'error');
    return;
  }
  const resEl = document.getElementById('nft-verify-image-result');
  if (resEl) {
    resEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:0.82rem;">
      <div class="spinner" style="width:14px;height:14px;border-width:1.5px;"></div>Đang đọc chữ ký ẩn…
    </div>`;
  }

  try {
    const dataURI = await _nftReadDataURI(file);
    const proof   = await ImageProtect.decode(dataURI);

    if (!proof || !proof.nftId) {
      if (resEl) resEl.innerHTML = `
        <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:14px 16px;">
          <div style="color:#ef4444;font-weight:700;margin-bottom:5px;">❌ Không tìm thấy chữ ký AI-PROOF</div>
          <div style="font-size:0.8rem;color:var(--text-muted);">Ảnh này chưa được bảo vệ bởi AI-PROOF hoặc dữ liệu đã bị hỏng.</div>
        </div>`;
      return;
    }

    let found = await DB.getResultById(proof.nftId);
    if (!found) {
      const all = await DB.getResults({ type: 'nft' });
      found = all.find(r => r.contentHash === proof.contentHash);
    }

    const isOnChain  = !!found;
    const hashMatch  = found ? (found.contentHash === proof.contentHash) : false;

    if (resEl) resEl.innerHTML = `
      <div style="background:rgba(0,255,157,.07);border:1px solid rgba(0,255,157,.22);border-radius:10px;padding:14px 16px;">
        <div style="color:#00ff9d;font-weight:700;margin-bottom:10px;">
          🛡️ Chữ ký AI-PROOF — ${isOnChain ? 'Đã xác minh on-chain' : 'Tìm thấy chữ ký'}
        </div>
        ${[['NFT ID',proof.nftId],['Content Hash',(proof.contentHash||'').slice(0,32)+'…'],
           ['Bảo vệ lúc',new Date(proof.protected||Date.now()).toLocaleString('vi-VN')],
           ['On-chain',isOnChain?'✅ Tìm thấy':'⚠️ Chưa có trong ledger cục bộ'],
           ['Hash',hashMatch?'✅ Xác thực':'❌ Không khớp']
          ].map(([l,v])=>`<div style="font-size:0.8rem;color:var(--text-primary);margin-bottom:3px;">
            <strong style="color:var(--text-muted);">${l}:</strong> ${v}</div>`).join('')}
        ${isOnChain ? `<button onclick="nftOpenDetail('${proof.nftId}')"
          class="btn btn-outline" style="margin-top:10px;font-size:0.77rem;">
          Xem NFT →</button>` : ''}
      </div>`;

  } catch (err) {
    if (resEl) resEl.innerHTML = `<div style="color:#ef4444;font-size:0.8rem;">Lỗi: ${err.message}</div>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function _nftFileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.includes('pdf'))      return '📄';
  if (mime.includes('gltf') || mime.includes('glb')) return '🧊';
  return '📁';
}

function _nftFmtSize(bytes) {
  if (bytes < 1024)      return bytes + ' B';
  if (bytes < 1_048_576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1_048_576).toFixed(2) + ' MB';
}

function _nftTypeFromMime(mime) {
  if (!mime) return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('pdf'))      return 'document';
  if (mime.includes('gltf') || mime.includes('glb')) return '3d';
  return 'other';
}

// FIX: Đọc full data-URI (bao gồm prefix data:image/...;base64,)
function _nftReadDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = e => resolve(e.target.result || '');
    reader.onerror = () => reject(new Error('FileReader error: ' + reader.error?.message));
    reader.readAsDataURL(file);
  });
}

function _nftStatus(msg, color) {
  const el = document.getElementById('nft-mint-status');
  if (el) { el.textContent = msg; el.style.color = color || 'var(--text-muted)'; }
}

// ── Drop handler cho verify image tab ─────────────────────────
window._nftVerifyDrop = function (e) {
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith('image/')) nftVerifyProtectedImage(f);
};

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Pre-fill creator
  const c = document.getElementById('nft-creator');
  if (c && !c.value) c.value = localStorage.getItem('nft_creator_name') || '';

  // Default tab
  nftSwitchTab('mint');
});

// ── Expose globals ────────────────────────────────────────────
window.nftSwitchTab           = nftSwitchTab;
window.nftHandleDragOver      = nftHandleDragOver;
window.nftHandleDragLeave     = nftHandleDragLeave;
window.nftHandleDrop          = nftHandleDrop;
window.nftHandleFileSelect    = nftHandleFileSelect;
window.nftProcessFile         = nftProcessFile;
window.nftSelectRarity        = nftSelectRarity;
window.nftHandleTagInput      = nftHandleTagInput;
window.nftRemoveTag           = nftRemoveTag;
window.nftMint                = nftMint;
window.nftRenderCollection    = nftRenderCollection;
window.nftOpenDetail          = nftOpenDetail;
window.nftTransfer            = nftTransfer;
window.nftBurn                = nftBurn;
window.nftExportCard          = nftExportCard;
window.nftExportAll           = nftExportAll;
window.nftDownloadProtected   = nftDownloadProtected;
window.nftVerifyProtectedImage= nftVerifyProtectedImage;
window.nftVerify              = nftVerify;
window.nftGenerateDescription = nftGenerateDescription;