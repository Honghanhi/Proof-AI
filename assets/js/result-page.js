// ═══════════════════════════════════════
// RESULT-PAGE — Result Display Controller
// ═══════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');

  if (!id) {
    renderNoResult();
    return;
  }

  const result = await DB.getResultById(id);
  if (!result) {
    renderNoResult();
    return;
  }

  renderResult(result);
});

async function renderResult(result) {
  // ── Verdict ring ──
  const ring  = document.getElementById('verdict-ring');
  const score = document.getElementById('verdict-score');
  const badge = document.getElementById('verdict-badge');
  const summary = document.getElementById('verdict-summary');

  if (score) animateTrustScore(score, result.trustScore, 1200);
  if (ring && badge) applyVerdictStyle(ring, badge, result.trustScore);
  if (summary) summary.textContent = result.explanation || '';

  // ── Highlighted content ──
  const contentEl = document.getElementById('highlighted-content');
  if (contentEl && result.content) {
    const html = buildHighlightedHTML(result.content, result.signals || []);
    contentEl.innerHTML = html;
  }

  // ── Model votes ──
  const votesEl = document.getElementById('model-votes');
  if (votesEl && result.models) {
    const formatted = formatConsensus(result.models);
    votesEl.innerHTML = formatted.map(m => UI.modelVoteRow(m)).join('');
    // Animate bars after render
    setTimeout(() => {
      votesEl.querySelectorAll('.vote-fill').forEach(fill => {
        const w = fill.style.width;
        fill.style.width = '0%';
        setTimeout(() => { fill.style.width = w; }, 50);
      });
    }, 200);
  }

  // ── Blockchain proof ──
  if (result.contentHash) {
    UI.setText('content-hash', result.contentHash);
  }

  // Get block from chain
  const chain = await Blockchain.getChain();
  const block = chain.find(b => b.data?.resultId === result.id);
  if (block) {
    UI.setText('block-id',        `#${block.index} — ${block.hash?.slice(0, 32)}…`);
    UI.setText('block-timestamp', new Date(block.timestamp).toLocaleString());
  }

  // ── QR code ──
  const shareUrl = window.location.href;
  renderQR('qr-canvas', shareUrl);

  // ── Page title ──
  const verdict = CONFIG.getVerdict(result.trustScore);
  document.title = `${verdict.label} (${result.trustScore}) — AI-PROOF`;
}

function renderNoResult() {
  const score = document.getElementById('verdict-score');
  if (score) score.textContent = '?';
  const summary = document.getElementById('verdict-summary');
  if (summary) summary.textContent = 'No result found. Run a new analysis.';
  UI.setText('content-hash', 'N/A');
  UI.setText('block-id',     'N/A');
}

function verifyChain() {
  UI.toast('Validating blockchain integrity…', 'info');
  Blockchain.validate().then(({ valid, length, errors }) => {
    if (valid) {
      UI.toast(`✓ Chain valid — ${length} blocks verified`, 'success');
    } else {
      UI.toast(`✗ Chain invalid — ${errors.length} error(s)`, 'error');
    }
  });
}

function copyLink() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => UI.toast('Link copied!', 'success'))
    .catch(() => UI.toast('Copy failed', 'error'));
}

window.verifyChain = verifyChain;
window.copyLink    = copyLink;