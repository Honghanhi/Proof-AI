// ═══════════════════════════════════════
// AI-EXPLAIN — Explainable AI Highlights
// ═══════════════════════════════════════

/**
 * Inject highlight spans into plain text based on signals
 * @param {string} text
 * @param {Array<{text, type, strength}>} signals
 * @returns {string} HTML with highlight spans
 */
function buildHighlightedHTML(text, signals) {
  if (!signals || signals.length === 0) {
    return escapeHTML(text);
  }

  // Sort signals by position (use simple string matching)
  let html = escapeHTML(text);

  // Apply highlights for each signal
  signals.forEach(signal => {
    if (!signal.text || signal.type === 'neutral') return;

    const escaped   = escapeHTML(signal.text);
    const cls       = signal.type === 'ai-pattern' ? 'evidence-span' : 'evidence-span red';
    const title     = signal.type === 'ai-pattern'
      ? `AI pattern (strength: ${Math.round(signal.strength * 100)}%)`
      : `Misinformation signal (strength: ${Math.round(signal.strength * 100)}%)`;

    const replacement = `<span class="${cls}" title="${title}">${escaped}</span>`;
    // Replace first occurrence only
    html = html.replace(escaped, replacement);
  });

  return html;
}

/**
 * Generate a plain-English explanation from signals
 */
function generateNarrativeExplanation(trustScore, signals, models) {
  const verdict = CONFIG.getVerdict(trustScore);
  const aiSignals  = signals.filter(s => s.type === 'ai-pattern');
  const fakeSignals = signals.filter(s => s.type === 'misinformation');

  let narrative = `<strong>Verdict: ${verdict.label}</strong> (Trust Score: ${trustScore}/100). `;

  if (trustScore >= 70) {
    narrative += `This content appears authentic. `;
  } else if (trustScore >= 50) {
    narrative += `This content shows mixed authenticity signals. `;
  } else {
    narrative += `This content shows strong synthetic generation indicators. `;
  }

  if (aiSignals.length > 0) {
    narrative += `${aiSignals.length} AI-pattern segment(s) were detected, highlighted in <span class="evidence-span" style="padding:0 4px;">blue</span>. `;
  }

  if (fakeSignals.length > 0) {
    narrative += `${fakeSignals.length} potential misinformation signal(s) were flagged, highlighted in <span class="evidence-span red" style="padding:0 4px;">red</span>. `;
  }

  if (models?.length) {
    const agreeing = models.filter(m =>
      (trustScore >= 50 && m.score >= 50) || (trustScore < 50 && m.score < 50)
    ).length;
    narrative += `${agreeing} of ${models.length} models agree on this verdict.`;
  }

  return narrative;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.buildHighlightedHTML         = buildHighlightedHTML;
window.generateNarrativeExplanation = generateNarrativeExplanation;
window.escapeHTML                   = escapeHTML;