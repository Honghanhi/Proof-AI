// ═══════════════════════════════════════
// EFFECTS — Visual Effect Utilities
// ═══════════════════════════════════════

/**
 * Create a ripple burst at a click position
 */
function createRipple(e, color = 'var(--accent-primary)') {
  const el   = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x    = e.clientX - rect.left;
  const y    = e.clientY - rect.top;

  const ripple = document.createElement('span');
  ripple.style.cssText = `
    position:absolute; left:${x}px; top:${y}px;
    width:10px; height:10px;
    background:${color}; border-radius:50%;
    transform:translate(-50%,-50%) scale(0);
    animation:ripple 0.6s ease both;
    pointer-events:none; opacity:0.4;
  `;

  el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
}

/**
 * Typewriter effect for an element
 */
function typewriter(el, text, speed = 30) {
  el.textContent = '';
  let i = 0;
  const interval = setInterval(() => {
    el.textContent += text[i++];
    if (i >= text.length) clearInterval(interval);
  }, speed);
  return interval;
}

/**
 * Add ripple to all .btn elements
 */
function initRipples() {
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', (e) => createRipple(e));
  });
}

document.addEventListener('DOMContentLoaded', initRipples);

window.createRipple = createRipple;
window.typewriter   = typewriter;
window.initRipples  = initRipples;