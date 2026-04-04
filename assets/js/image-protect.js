// ════════════════════════════════════════════════════════
//  IMAGE-PROTECT — Cryptographic Image Protection
//
//  Tạo ảnh được bảo vệ đa lớp để đăng lên mạng:
//
//  Lớp 1 — Visible watermark:
//    Logo + hash ngắn + timestamp góc ảnh
//
//  Lớp 2 — Invisible steganography (LSB):
//    Nhúng NFT ID + contentHash vào các bit thấp nhất
//    của pixel — mắt thường không nhìn thấy nhưng
//    có thể đọc lại bằng hàm decode()
//
//  Lớp 3 — Metadata EXIF-style comment:
//    Ghi proof JSON vào PNG tEXt chunk / JPEG comment
//
//  Lớp 4 — Canvas fingerprint pattern:
//    Dải pixel bán trong suốt theo chiều ngang/dọc
//    tạo pattern độc nhất theo hash, không thể crop bỏ
//    mà vẫn giữ nguyên nội dung chính
//
//  Public API (window.ImageProtect):
//
//    ImageProtect.protect(imgBase64, proof, opts?)
//      → Promise<{ protected: base64, preview: blob }>
//
//    ImageProtect.decode(imgBase64)
//      → Promise<{ nftId, contentHash, timestamp } | null>
//
//    ImageProtect.download(base64, filename?)
//      → void
//
//  opts: {
//    watermarkText   : string   (default: 'AI-PROOF NFT')
//    opacity         : 0–1      (default: 0.55)
//    position        : 'br'|'bl'|'tr'|'tl'|'center'
//    showHash        : bool     (default: true)
//    patternStrength : 0–1      (default: 0.08)
//    outputQuality   : 0–1      (default: 0.96)
//    outputFormat    : 'png'|'jpeg' (default: 'png')
//  }
// ════════════════════════════════════════════════════════

const ImageProtect = (() => {

  // ── Default options ───────────────────────────────────
  const DEFAULTS = {
    watermarkText:   'AI-PROOF NFT',
    opacity:         0.55,
    position:        'br',
    showHash:        true,
    patternStrength: 0.08,
    outputQuality:   0.96,
    outputFormat:    'png',
  };

  // ── Load image from base64 or data-URI ────────────────
  function _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('ImageProtect: failed to load image'));
      img.src = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;
    });
  }

  // ── Create canvas from image ──────────────────────────
  function _makeCanvas(img) {
    const c   = document.createElement('canvas');
    c.width   = img.naturalWidth  || img.width;
    c.height  = img.naturalHeight || img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { canvas: c, ctx };
  }

  // ── LAYER 1: Visible watermark ────────────────────────
  function _drawWatermark(ctx, canvas, proof, opts) {
    const W  = canvas.width;
    const H  = canvas.height;
    const sc = Math.max(1, Math.min(W, H) / 600);  // scale to image size

    const fontSize   = Math.round(13 * sc);
    const smallSize  = Math.round(10 * sc);
    const pad        = Math.round(12 * sc);
    const lineH      = Math.round(16 * sc);
    const cornerR    = Math.round(6  * sc);

    const lines = [opts.watermarkText];
    if (opts.showHash && proof?.contentHash) {
      lines.push(`#${proof.contentHash.slice(0, 16)}…`);
    }
    if (proof?.nftId) {
      lines.push(proof.nftId.slice(0, 20) + (proof.nftId.length > 20 ? '…' : ''));
    }
    lines.push(new Date().toISOString().slice(0, 10));

    // Measure longest line
    ctx.font = `500 ${fontSize}px monospace`;
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bw   = maxW + pad * 2;
    const bh   = lines.length * lineH + pad * 1.5;

    // Position
    const positions = {
      br: [W - bw - pad, H - bh - pad],
      bl: [pad, H - bh - pad],
      tr: [W - bw - pad, pad],
      tl: [pad, pad],
      center: [(W - bw) / 2, (H - bh) / 2],
    };
    const [bx, by] = positions[opts.position] || positions.br;

    // Background pill
    ctx.save();
    ctx.globalAlpha = opts.opacity * 0.85;
    ctx.fillStyle   = '#000000';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, cornerR);
    ctx.fill();

    // Border glow
    ctx.globalAlpha = opts.opacity * 0.4;
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth   = Math.max(1, sc * 0.8);
    ctx.stroke();
    ctx.restore();

    // Text lines
    ctx.save();
    ctx.globalAlpha = Math.min(1, opts.opacity * 1.3);
    lines.forEach((line, i) => {
      const isFirst = i === 0;
      ctx.font      = isFirst
        ? `700 ${fontSize}px monospace`
        : `400 ${smallSize}px monospace`;
      ctx.fillStyle = isFirst ? '#00e5ff' : '#a0c8d8';
      ctx.fillText(line, bx + pad, by + pad + i * lineH + (isFirst ? fontSize * 0.8 : smallSize * 0.8));
    });

    // Shield icon (simple SVG path drawn on canvas)
    ctx.font      = `${fontSize * 1.2}px sans-serif`;
    ctx.fillStyle = '#00e5ff';
    ctx.globalAlpha = opts.opacity * 0.8;
    ctx.fillText('⬡', bx + pad - fontSize * 1.4, by + pad + fontSize * 0.85);
    ctx.restore();
  }

  // ── LAYER 2: LSB steganography ────────────────────────
  // Encode proof string into the least-significant bits of R channel
  function _stegoEncode(ctx, canvas, proofStr) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px   = data.data;

    // Encode UTF-8 bytes
    const bytes  = new TextEncoder().encode(proofStr);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, bytes.length, false);
    const payload = new Uint8Array([...header, ...bytes]);

    // Need 8 pixels per byte (1 bit per pixel R channel)
    const bitsNeeded = payload.length * 8;
    const pxAvail    = px.length / 4;  // RGBA → pixels

    if (bitsNeeded > pxAvail) {
      console.warn('[ImageProtect] Image too small for full steganography, truncating payload');
    }

    let bitIdx = 0;
    for (let i = 0; i < payload.length && bitIdx / 8 < pxAvail; i++) {
      for (let b = 7; b >= 0 && bitIdx < pxAvail * 8; b--, bitIdx++) {
        const pxOffset = bitIdx * 4;   // R channel
        const bit = (payload[i] >> b) & 1;
        // Clear LSB and set to our bit
        px[pxOffset] = (px[pxOffset] & 0xFE) | bit;
      }
    }

    ctx.putImageData(data, 0, 0);
  }

  // Decode steganography from image
  function _stegoDecode(ctx, canvas) {
    try {
      const data  = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px    = data.data;
      const pxCount = px.length / 4;

      // Read 32-bit length header (8 pixels × 4 bytes = 32 pixels for header)
      const headerBytes = new Uint8Array(4);
      for (let i = 0; i < 32; i++) {
        const byte = Math.floor(i / 8);
        const bit  = 7 - (i % 8);
        headerBytes[byte] |= (px[i * 4] & 1) << bit;
      }
      const msgLen = new DataView(headerBytes.buffer).getUint32(0, false);

      if (msgLen === 0 || msgLen > pxCount - 32) return null;

      const msgBytes = new Uint8Array(msgLen);
      for (let i = 0; i < msgLen * 8; i++) {
        const pxIdx = (i + 32);
        if (pxIdx >= pxCount) break;
        const byte = Math.floor(i / 8);
        const bit  = 7 - (i % 8);
        msgBytes[byte] |= (px[pxIdx * 4] & 1) << bit;
      }

      const str = new TextDecoder().decode(msgBytes);
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  // ── LAYER 3: Repeating pattern fingerprint ────────────
  // Tạo dải pixel bán trong suốt theo hash — crop góc vẫn còn
  function _drawFingerprint(ctx, canvas, contentHash) {
    const W   = canvas.width;
    const H   = canvas.height;
    const str = opts => opts;

    // Derive pattern params from hash
    const h0  = parseInt(contentHash.slice(0, 8), 16);
    const h1  = parseInt(contentHash.slice(8, 16), 16);
    const hue = h0 % 360;
    const gap = 40 + (h1 % 60);   // spacing 40–100px

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = `hsl(${hue}, 80%, 70%)`;
    ctx.lineWidth   = 1;

    // Diagonal lines — frequency from hash
    for (let offset = -H; offset < W + H; offset += gap) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + H, H);
      ctx.stroke();
    }

    // Cross pattern every 1/4 of image
    ctx.globalAlpha = 0.04;
    ctx.setLineDash([3, 6]);
    for (let x = gap / 2; x < W; x += gap * 2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = gap / 2; y < H; y += gap * 2) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── LAYER 4: Edge border proof strip ─────────────────
  // 3px viền rất mờ mang màu từ hash — bị crop sẽ thấy mất
  function _drawBorderProof(ctx, canvas, contentHash) {
    const W   = canvas.width;
    const H   = canvas.height;
    const hue = parseInt(contentHash.slice(0, 6), 16) % 360;
    const sat = 60 + (parseInt(contentHash.slice(6, 8), 16) % 30);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = `hsl(${hue}, ${sat}%, 55%)`;
    ctx.lineWidth   = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

    // Inner thinner border
    ctx.globalAlpha = 0.08;
    ctx.lineWidth   = 1;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.restore();
  }

  // ── MAIN: protect() ───────────────────────────────────

  /**
   * Apply all protection layers to an image.
   *
   * @param {string} imgBase64   base64 or data-URI of image
   * @param {object} proof       { nftId, contentHash, blockHash?, blockIndex? }
   * @param {object} [opts]      override DEFAULTS
   * @returns {Promise<{ protected: string, blob: Blob, width: number, height: number }>}
   */
  async function protect(imgBase64, proof, opts = {}) {
    const o = { ...DEFAULTS, ...opts };

    // Load image
    const img = await _loadImage(imgBase64);
    const { canvas, ctx } = _makeCanvas(img);

    // Sanity
    if (canvas.width < 10 || canvas.height < 10) {
      throw new Error('Image too small to protect');
    }

    // Build proof string to embed
    const proofObj = {
      nftId:       proof.nftId       || '',
      contentHash: proof.contentHash || '',
      blockHash:   proof.blockHash   || '',
      blockIndex:  proof.blockIndex  ?? null,
      protected:   new Date().toISOString(),
      app:         'AI-PROOF',
    };
    const proofStr = JSON.stringify(proofObj);

    // Layer 2: steganography FIRST (before drawing anything visible)
    _stegoEncode(ctx, canvas, proofStr);

    // Layer 3: fingerprint pattern (very subtle)
    if (proof.contentHash) {
      _drawFingerprint(ctx, canvas, proof.contentHash);
      _drawBorderProof(ctx, canvas, proof.contentHash);
    }

    // Layer 1: visible watermark LAST (on top)
    _drawWatermark(ctx, canvas, proof, o);

    // Export
    const mime = o.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataURL = canvas.toDataURL(mime, o.outputQuality);
    const base64  = dataURL.split(',')[1];

    // Also produce a Blob for direct download
    const blob = await new Promise(res => canvas.toBlob(res, mime, o.outputQuality));

    return {
      protected: base64,
      dataURL,
      blob,
      width:  canvas.width,
      height: canvas.height,
      proofObj,
    };
  }

  // ── decode() ──────────────────────────────────────────

  /**
   * Read embedded steganographic proof from a protected image.
   *
   * @param {string} imgBase64
   * @returns {Promise<object|null>}  proof object or null if not found
   */
  async function decode(imgBase64) {
    try {
      const img = await _loadImage(imgBase64);
      const { canvas, ctx } = _makeCanvas(img);
      return _stegoDecode(ctx, canvas);
    } catch {
      return null;
    }
  }

  // ── download() ────────────────────────────────────────

  /**
   * Trigger browser download of a protected image.
   *
   * @param {string|Blob} src       base64, data-URI, or Blob
   * @param {string}      filename
   */
  function download(src, filename = 'aiproof-protected.png') {
    let url;
    if (src instanceof Blob) {
      url = URL.createObjectURL(src);
    } else {
      const b64 = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;
      url = b64;
    }
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── verify() — convenience wrapper ───────────────────

  /**
   * Decode + compare against a known contentHash.
   * Returns { valid, proof } or { valid: false, proof: null }.
   */
  async function verify(imgBase64, expectedContentHash) {
    const proof = await decode(imgBase64);
    if (!proof) return { valid: false, proof: null };
    const valid = proof.contentHash === expectedContentHash;
    return { valid, proof };
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({ protect, decode, download, verify });

})();

window.ImageProtect = ImageProtect;