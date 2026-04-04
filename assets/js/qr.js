// ═══════════════════════════════════════
// QR — QR Code Generator (canvas-based)
// ═══════════════════════════════════════

/**
 * Render a minimal QR-like placeholder on a canvas.
 * For production, swap this with a real QR library (e.g. qrcode.js).
 * This placeholder draws a visually coherent "QR-style" pattern
 * with the URL encoded as a data-attribute so a real implementation
 * can read it.
 *
 * @param {string} canvasId
 * @param {string} text
 */
function renderQR(canvasId, text) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  canvas.dataset.qrText = text;
  const ctx  = canvas.getContext('2d');
  const size = canvas.width;
  const cells = 21; // QR version 1 grid size
  const cell  = Math.floor(size / cells);

  // Seed a deterministic "random" pattern from text hash
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;

  function seededRand() {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0xFFFFFFFF;
  }

  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, size, size);

  // Draw modules
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const isFinderPattern = isInFinder(row, col, cells);
      const filled = isFinderPattern ? finderValue(row, col, cells) : seededRand() > 0.5;

      if (filled) {
        ctx.fillStyle = '#00e5ff';
        ctx.fillRect(col * cell + 1, row * cell + 1, cell - 1, cell - 1);
      }
    }
  }

  // Border
  ctx.strokeStyle = 'rgba(0,229,255,0.3)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(0, 0, size, size);
}

function isInFinder(row, col, cells) {
  // Top-left, top-right, bottom-left finder patterns (7x7)
  const inTL = row < 8 && col < 8;
  const inTR = row < 8 && col >= cells - 8;
  const inBL = row >= cells - 8 && col < 8;
  return inTL || inTR || inBL;
}

function finderValue(row, col, cells) {
  function inFinder(r, c) {
    if (r < 0 || r > 6 || c < 0 || c > 6) return false;
    if (r === 0 || r === 6 || c === 0 || c === 6) return true; // border
    if (r >= 2 && r <= 4 && c >= 2 && c <= 4) return true; // center
    return false;
  }

  // Top-left
  if (row <= 7 && col <= 7) return inFinder(row, col);
  // Top-right
  if (row <= 7 && col >= cells - 8) return inFinder(row, col - (cells - 7));
  // Bottom-left
  if (row >= cells - 8 && col <= 7) return inFinder(row - (cells - 7), col);
  return false;
}

window.renderQR = renderQR;