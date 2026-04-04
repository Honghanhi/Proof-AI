// ════════════════════════════════════════════════════════
//  TRUST-SCORE — Score Engine, History & Display
//
//  Two responsibilities kept cleanly separate:
//
//  1. ANALYTICS — track scores across analyses, compute
//     rolling averages, trends, and session aggregates.
//
//  2. DISPLAY — animate the verdict ring, score counter,
//     and bar elements with configurable easing.
//
//  Public API (window.TrustScore):
//
//  Analytics
//    TrustScore.record(result)             → void
//    TrustScore.getHistory(limit?)         → HistoryEntry[]
//    TrustScore.getStats()                 → StatsSnapshot
//    TrustScore.getTrend(window?)          → TrendResult
//    TrustScore.getSessionScore()          → number|null
//    TrustScore.clearHistory()             → void
//    TrustScore.on(event, fn)              → unsubscribe
//
//  Display
//    TrustScore.animateCounter(el, target, opts?)  → void
//    TrustScore.animateRing(ringEl, badgeEl, score, opts?) → void
//    TrustScore.animateBar(barEl, fillEl, score, opts?)    → void
//    TrustScore.renderScorePill(score)             → string (HTML)
//    TrustScore.update(result, elementIds)         → void   one-call render
//
//  Backwards-compat globals (used by result-page.js etc.):
//    animateTrustScore(el, target, duration?)
//    applyVerdictStyle(ringEl, badgeEl, score)
//    renderScoreBar(barEl, fillEl, score)
// ════════════════════════════════════════════════════════

const TrustScore = (() => {

  // ── In-memory history ─────────────────────────────────
  // Persisted to IDB via DB.saveResult() by the caller —
  // TrustScore only manages the in-memory session buffer
  // and aggregates loaded from storage on first access.

  /** @type {HistoryEntry[]} */
  let _history      = [];
  let _historyLoaded = false;

  /** @type {Map<string, Function[]>} */
  const _listeners = {};

  // ── Event emitter ─────────────────────────────────────

  function _emit(event, detail) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(detail); } catch (e) { console.error('[TrustScore] listener error:', e); }
    });
  }

  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
    return () => { _listeners[event] = _listeners[event].filter(f => f !== fn); };
  }

  // ── History loading ───────────────────────────────────

  /**
   * Lazy-load history from DB on first call.
   * Subsequent calls use the in-memory buffer.
   */
  async function _ensureHistory() {
    if (_historyLoaded) return;
    try {
      if (typeof DB !== 'undefined') {
        const stored = await DB.getResults({ limit: 200 });
        // Merge: stored entries that aren't already in session buffer
        const sessionIds = new Set(_history.map(h => h.id));
        const fromDB = stored
          .filter(r => !sessionIds.has(r.id))
          .map(_resultToEntry);
        // Prepend DB results (older), session results are newer
        _history = [...fromDB, ..._history];
      }
    } catch (err) {
      console.warn('[TrustScore] _ensureHistory failed:', err.message);
    }
    _historyLoaded = true;
  }

  function _resultToEntry(result) {
    return {
      id:         result.id,
      trustScore: result.trustScore,
      aiPct:      result.aiPct      ?? (100 - result.trustScore),
      humanPct:   result.humanPct   ?? result.trustScore,
      confidence: result.confidence ?? 0.7,
      verdict:    result.verdict?.label ?? CONFIG.getVerdict(result.trustScore).label,
      type:       result.type        ?? 'text',
      timestamp:  result.savedAt     ?? result.timestamp ?? new Date().toISOString(),
    };
  }

  // ── Record a new analysis ─────────────────────────────

  /**
   * Add an analysis result to the in-memory history buffer.
   * Call this immediately after every analysis completes so
   * getTrend() and getStats() reflect the latest state.
   *
   * Does NOT write to storage — that's the caller's job via DB.saveResult().
   *
   * @param {object} result  AnalysisResult (must have id, trustScore)
   */
  function record(result) {
    if (!result || result.trustScore === undefined) return;

    const entry = _resultToEntry(result);

    // Upsert: replace if id already exists (re-analysis of same content)
    const idx = _history.findIndex(h => h.id === entry.id);
    if (idx >= 0) {
      _history[idx] = entry;
    } else {
      _history.push(entry);
    }

    // Keep buffer bounded — keep newest 500 entries
    if (_history.length > 500) {
      _history = _history.slice(_history.length - 500);
    }

    _emit('score:recorded', { entry, total: _history.length });
    _emit('stats:changed',  getStats());
  }

  // ── History accessor ──────────────────────────────────

  /**
   * Return the history buffer, newest-first.
   * Triggers a lazy DB load on first call.
   *
   * @param   {number} [limit]  max entries to return (default: all)
   * @returns {Promise<HistoryEntry[]>}
   */
  async function getHistory(limit) {
    await _ensureHistory();
    const sorted = _history.slice().sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  // ── Statistics ────────────────────────────────────────

  /**
   * Compute summary statistics over the full history buffer.
   * Synchronous — uses whatever is currently in memory.
   *
   * @returns {StatsSnapshot}
   * {
   *   count         : number   total analyses
   *   mean          : number   average trust score
   *   median        : number
   *   min           : number
   *   max           : number
   *   stdDev        : number
   *   verdictCounts : { [label]: number }
   *   typeCounts    : { text:n, url:n, image:n }
   *   aiGeneratedPct: number   % that scored below 50
   *   avgAiPct      : number   average AI probability
   *   avgConfidence : number   average model confidence
   * }
   */
  function getStats() {
    if (_history.length === 0) {
      return {
        count: 0, mean: null, median: null, min: null, max: null,
        stdDev: null, verdictCounts: {}, typeCounts: {},
        aiGeneratedPct: null, avgAiPct: null, avgConfidence: null,
      };
    }

    const scores     = _history.map(h => h.trustScore);
    const sorted     = scores.slice().sort((a, b) => a - b);
    const n          = scores.length;
    const mean       = scores.reduce((s, v) => s + v, 0) / n;
    const median     = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const variance   = scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
    const stdDev     = Math.sqrt(variance);

    const verdictCounts = {};
    const typeCounts    = { text: 0, url: 0, image: 0 };
    let aiCount = 0, aiPctSum = 0, confSum = 0;

    for (const h of _history) {
      verdictCounts[h.verdict] = (verdictCounts[h.verdict] || 0) + 1;
      if (h.type && typeCounts[h.type] !== undefined) typeCounts[h.type]++;
      if (h.trustScore < 50) aiCount++;
      aiPctSum += h.aiPct ?? (100 - h.trustScore);
      confSum  += h.confidence ?? 0.7;
    }

    return {
      count:          n,
      mean:           +mean.toFixed(1),
      median:         +median.toFixed(1),
      min:            sorted[0],
      max:            sorted[n - 1],
      stdDev:         +stdDev.toFixed(2),
      verdictCounts,
      typeCounts,
      aiGeneratedPct: +((aiCount / n) * 100).toFixed(1),
      avgAiPct:       +(aiPctSum / n).toFixed(1),
      avgConfidence:  +(confSum / n).toFixed(3),
    };
  }

  // ── Trend analysis ────────────────────────────────────

  /**
   * Compute a trend over the most recent `window` analyses.
   *
   * Uses a simple linear regression on (index, trustScore) pairs.
   * slope > 0 = improving over time; slope < 0 = degrading.
   *
   * @param   {number} [windowSize=10]  how many recent entries to use
   * @returns {TrendResult}
   * {
   *   direction  : 'up'|'down'|'flat'
   *   slope      : number    score change per analysis
   *   delta      : number    first → last score difference in window
   *   windowSize : number    actual entries used
   *   recent     : number[]  trust scores in window (newest-last)
   *   movingAvg  : number    average over window
   *   lastScore  : number|null
   * }
   */
  function getTrend(windowSize = 10) {
    if (_history.length === 0) {
      return { direction: 'flat', slope: 0, delta: 0, windowSize: 0,
               recent: [], movingAvg: null, lastScore: null };
    }

    // Use the most recent N entries, oldest first
    const window = _history
      .slice()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .slice(-windowSize);

    const scores    = window.map(h => h.trustScore);
    const n         = scores.length;
    const movingAvg = +(scores.reduce((s, v) => s + v, 0) / n).toFixed(1);
    const lastScore = scores[scores.length - 1] ?? null;

    // Linear regression
    let slope = 0;
    if (n >= 2) {
      const meanX = (n - 1) / 2;
      const meanY = movingAvg;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - meanX) * (scores[i] - meanY);
        den += (i - meanX) * (i - meanX);
      }
      slope = den !== 0 ? num / den : 0;
    }

    const delta = n >= 2 ? scores[n - 1] - scores[0] : 0;
    const direction = Math.abs(slope) < 0.5 ? 'flat'
                    : slope > 0             ? 'up'
                    :                         'down';

    return {
      direction,
      slope:      +slope.toFixed(3),
      delta:      +delta.toFixed(1),
      windowSize: n,
      recent:     scores,
      movingAvg,
      lastScore,
    };
  }

  // ── Session score ─────────────────────────────────────

  /**
   * Return the weighted average trust score for this page session only.
   * Only includes entries added via record() since page load.
   * Returns null if no analyses have been run this session.
   *
   * @returns {number|null}
   */
  function getSessionScore() {
    // Session entries: those added after page load (approximated by
    // entries whose timestamp is within the last hour — we don't track
    // session start precisely without a flag)
    const cutoff = Date.now() - 3_600_000;
    const session = _history.filter(h => new Date(h.timestamp).getTime() >= cutoff);
    if (session.length === 0) return null;
    return +(session.reduce((s, h) => s + h.trustScore, 0) / session.length).toFixed(1);
  }

  function clearHistory() {
    _history       = [];
    _historyLoaded = false;
    _emit('history:cleared', {});
  }

  // ═══════════════════════════════════════════════════════
  //  DISPLAY
  // ═══════════════════════════════════════════════════════

  // ── Easing functions ──────────────────────────────────

  const EASINGS = {
    'ease-out-cubic':  t => 1 - Math.pow(1 - t, 3),
    'ease-out-quart':  t => 1 - Math.pow(1 - t, 4),
    'ease-out-expo':   t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    'ease-in-out':     t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    'spring':          t => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    'linear':          t => t,
  };

  function _ease(name, t) {
    return (EASINGS[name] || EASINGS['ease-out-cubic'])(Math.max(0, Math.min(1, t)));
  }

  // ── Counter animation ─────────────────────────────────

  /**
   * Animate a numeric counter element from startVal → target.
   *
   * @param {HTMLElement} el
   * @param {number}      target    destination value
   * @param {object}      [opts]
   * @param {number}      [opts.duration=1200]   ms
   * @param {number}      [opts.from=0]          start value
   * @param {string}      [opts.easing='ease-out-cubic']
   * @param {Function}    [opts.onComplete]       called when animation ends
   */
  function animateCounter(el, target, opts = {}) {
    if (!el) return;

    const duration  = opts.duration ?? 1200;
    const startVal  = opts.from     ?? 0;
    const easing    = opts.easing   ?? 'ease-out-cubic';
    const start     = performance.now();

    // Cancel any ongoing animation on this element
    if (el._animFrame) cancelAnimationFrame(el._animFrame);

    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased    = _ease(easing, progress);
      const current  = Math.round(startVal + (target - startVal) * eased);
      el.textContent = current;
      if (progress < 1) {
        el._animFrame = requestAnimationFrame(step);
      } else {
        el._animFrame = null;
        el.textContent = target;
        opts.onComplete?.();
      }
    }

    el._animFrame = requestAnimationFrame(step);
  }

  // ── Ring animation ────────────────────────────────────

  /**
   * Apply verdict colours + glow to a ring element and badge.
   * Optionally pulses the ring once with a keyframe.
   *
   * @param {HTMLElement} ringEl
   * @param {HTMLElement} badgeEl   optional
   * @param {number}      score
   * @param {object}      [opts]
   * @param {boolean}     [opts.pulse=true]  add a brief pulse animation
   * @param {boolean}     [opts.animate=true] transition the colour
   */
  function animateRing(ringEl, badgeEl, score, opts = {}) {
    if (!ringEl) return;

    const verdict    = CONFIG.getVerdict(score);
    const pulse      = opts.pulse   !== false;
    const doAnimate  = opts.animate !== false;

    // Colour transition
    const transition = doAnimate ? 'border-color 0.6s ease, box-shadow 0.6s ease' : 'none';
    ringEl.style.transition  = transition;
    ringEl.style.borderColor = verdict.color;
    ringEl.style.boxShadow   =
      `0 0 30px ${verdict.color}50, ` +
      `0 0 60px ${verdict.color}28, ` +
      `inset 0 0 30px ${verdict.color}10`;

    // Badge
    if (badgeEl) {
      badgeEl.style.transition     = doAnimate ? 'all 0.4s ease' : 'none';
      badgeEl.textContent          = verdict.label;
      badgeEl.style.color          = verdict.color;
      badgeEl.style.borderColor    = verdict.color + '60';
      badgeEl.style.background     = verdict.color + '15';
    }

    // One-shot pulse keyframe
    if (pulse) {
      ringEl.style.animation = 'none';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ringEl.style.animation = 'glowPulse 0.6s ease-out';
        });
      });
    }
  }

  // ── Bar animation ─────────────────────────────────────

  /**
   * Animate a horizontal score bar fill.
   *
   * @param {HTMLElement} barEl    wrapper element (optional, for height/border)
   * @param {HTMLElement} fillEl   the fill strip inside the bar
   * @param {number}      score    0–100
   * @param {object}      [opts]
   * @param {number}      [opts.delay=80]    ms before animation starts
   * @param {number}      [opts.duration=700] ms for the fill transition
   */
  function animateBar(barEl, fillEl, score, opts = {}) {
    if (!fillEl) return;

    const verdict  = CONFIG.getVerdict(score);
    const delay    = opts.delay    ?? 80;
    const duration = opts.duration ?? 700;

    fillEl.style.transition = 'none';
    fillEl.style.width      = '0%';
    fillEl.style.background = `linear-gradient(90deg, ${verdict.color}99, ${verdict.color})`;

    setTimeout(() => {
      fillEl.style.transition = `width ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      fillEl.style.width      = `${Math.max(2, score)}%`;
    }, delay);
  }

  // ── Score pill ────────────────────────────────────────

  /**
   * Render a self-contained HTML pill badge for a trust score.
   * Useful for injecting scores into arbitrary DOM positions.
   *
   * @param   {number} score
   * @returns {string} HTML string
   */
  function renderScorePill(score) {
    const verdict = CONFIG.getVerdict(score);
    return `<span style="
      display:inline-flex;align-items:center;gap:6px;
      padding:3px 10px;border-radius:99px;
      border:1px solid ${verdict.color}60;
      background:${verdict.color}15;
      color:${verdict.color};
      font-family:var(--font-display,monospace);
      font-size:0.72rem;font-weight:700;
      letter-spacing:0.06em;
    ">${score} · ${verdict.label}</span>`;
  }

  // ── One-call render helper ────────────────────────────

  /**
   * Update all standard result page elements in one call.
   *
   * elementIds — optional overrides for element IDs. Defaults to the
   * IDs used by result.html:
   *   scoreEl     → 'verdict-score'
   *   ringEl      → 'verdict-ring'
   *   badgeEl     → 'verdict-badge'
   *   summaryEl   → 'verdict-summary'
   *   aiPctEl     → 'ai-pct'
   *   humanPctEl  → 'human-pct'
   *   confidenceEl→ 'confidence-val'
   *   barFillEl   → 'trust-bar-fill'
   *
   * @param {object} result      AnalysisResult
   * @param {object} [elementIds]  override default element IDs
   */
  function update(result, elementIds = {}) {
    const ids = {
      scoreEl:      elementIds.scoreEl      ?? 'verdict-score',
      ringEl:       elementIds.ringEl       ?? 'verdict-ring',
      badgeEl:      elementIds.badgeEl      ?? 'verdict-badge',
      summaryEl:    elementIds.summaryEl    ?? 'verdict-summary',
      aiPctEl:      elementIds.aiPctEl      ?? 'ai-pct',
      humanPctEl:   elementIds.humanPctEl   ?? 'human-pct',
      confidenceEl: elementIds.confidenceEl ?? 'confidence-val',
      barFillEl:    elementIds.barFillEl    ?? 'trust-bar-fill',
    };

    const score    = result.trustScore ?? 50;
    const aiPct    = result.aiPct      ?? (100 - score);
    const humanPct = result.humanPct   ?? score;
    const conf     = result.confidence ?? 0.7;

    const scoreEl   = document.getElementById(ids.scoreEl);
    const ringEl    = document.getElementById(ids.ringEl);
    const badgeEl   = document.getElementById(ids.badgeEl);
    const summaryEl = document.getElementById(ids.summaryEl);
    const aiPctEl   = document.getElementById(ids.aiPctEl);
    const humanPctEl = document.getElementById(ids.humanPctEl);
    const confEl    = document.getElementById(ids.confidenceEl);
    const fillEl    = document.getElementById(ids.barFillEl);

    if (scoreEl)   animateCounter(scoreEl, score, { duration: 1200 });
    if (ringEl)    animateRing(ringEl, badgeEl, score);
    if (summaryEl) summaryEl.textContent = result.explanation || '';

    if (aiPctEl)    animateCounter(aiPctEl,    Math.round(aiPct),              { duration: 900 });
    if (humanPctEl) animateCounter(humanPctEl, Math.round(humanPct),           { duration: 900 });
    if (confEl)     animateCounter(confEl,     Math.round(conf * 100),         { duration: 700 });
    if (fillEl)     animateBar(null, fillEl, score);

    // Record in history
    record(result);
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    // Analytics
    record,
    getHistory,
    getStats,
    getTrend,
    getSessionScore,
    clearHistory,
    on,

    // Display
    animateCounter,
    animateRing,
    animateBar,
    renderScorePill,
    update,
  });

})();

window.TrustScore = TrustScore;

// ── Backwards-compatible globals ──────────────────────────────────────────────

/**
 * @deprecated  Use TrustScore.animateCounter(el, target, { duration })
 */
function animateTrustScore(el, target, duration = 1200) {
  TrustScore.animateCounter(el, target, { duration });
}

/**
 * @deprecated  Use TrustScore.animateRing(ringEl, badgeEl, score)
 */
function applyVerdictStyle(ringEl, badgeEl, score) {
  TrustScore.animateRing(ringEl, badgeEl, score, { pulse: false, animate: false });
}

/**
 * @deprecated  Use TrustScore.animateBar(barEl, fillEl, score)
 */
function renderScoreBar(barEl, fillEl, score) {
  TrustScore.animateBar(barEl, fillEl, score);
}

window.animateTrustScore = animateTrustScore;
window.applyVerdictStyle = applyVerdictStyle;
window.renderScoreBar    = renderScoreBar;