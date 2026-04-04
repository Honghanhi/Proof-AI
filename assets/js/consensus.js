// ═══════════════════════════════════════
// CONSENSUS — Multi-model Vote Aggregator
// ═══════════════════════════════════════

/**
 * Compute weighted consensus from model scores
 * @param {Array<{modelId, score, confidence}>} modelResults
 * @returns {{ trustScore, agreement, weights }}
 */
function computeConsensus(modelResults) {
  let weightedSum  = 0;
  let totalWeight  = 0;

  const weights = modelResults.map((r) => {
    const model  = CONFIG.MODELS.find(m => m.id === r.modelId);
    const weight = (model?.weight || 0.2) * (r.confidence || 0.8);
    weightedSum += r.score * weight;
    totalWeight += weight;
    return { ...r, effectiveWeight: weight };
  });

  const trustScore = totalWeight > 0
    ? Math.round(weightedSum / totalWeight)
    : 50;

  // Agreement: std dev of scores (lower = more agreement)
  const mean = modelResults.reduce((s, r) => s + r.score, 0) / modelResults.length;
  const variance = modelResults.reduce((s, r) => s + Math.pow(r.score - mean, 2), 0) / modelResults.length;
  const stdDev = Math.sqrt(variance);
  const agreement = Math.max(0, Math.min(100, Math.round(100 - stdDev)));

  return { trustScore, agreement, weights };
}

/**
 * Format consensus for display
 */
function formatConsensus(modelResults) {
  return modelResults.map(r => {
    const label = CONFIG.getVerdict(r.score).label;
    return {
      ...r,
      label,
      color: r.score >= 70 ? 'var(--accent-success)'
           : r.score >= 50 ? 'var(--accent-warn)'
           : 'var(--accent-danger)',
    };
  });
}

window.computeConsensus = computeConsensus;
window.formatConsensus  = formatConsensus;