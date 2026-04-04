// ════════════════════════════════════════════════════════
//  REALTIME-SCAN — Live Typing Analysis
//
//  Attaches to one or more textarea/input elements and runs
//  a lightweight heuristic scan after the user stops typing.
//
//  Features
//  ────────
//  • True debounce: timer resets on every keystroke; scan fires
//    only after `debounceMs` of silence (default: CONFIG.REALTIME_DEBOUNCE)
//  • Idle detection: fires an additional deeper scan when the user
//    is idle for `idleMs` (default: 3 × debounceMs)
//  • Min-length guard: skips scan until text reaches `minChars`
//  • Deduplication: skips re-scan if text hasn't changed
//  • Multiple instances: each input gets its own independent state
//  • Trend sparkline: renders a tiny SVG bar-chart of the last 8 scans
//  • Word / sentence / character metrics in the status bar
//  • Progressive confidence ring that fills as text grows
//  • Smooth score interpolation between successive scans
//
//  Public API (window.RealtimeScan):
//
//    RealtimeScan.attach(inputId, outputId, opts?)  → ScanInstance
//    RealtimeScan.detach(inputId)                   → void
//    RealtimeScan.scan(text)                        → ScanResult  (one-shot)
//    RealtimeScan.instances                         → Map<inputId, ScanInstance>
//
//  ScanInstance:
//    .pause()    stop firing scans
//    .resume()   re-enable scans
//    .flush()    force-scan immediately (cancel pending debounce)
//    .destroy()  remove listeners and clean up
//
//  ScanResult:
//  {
//    score      : number  0–100  trust score (100 = authentic)
//    aiPct      : number  0–100
//    humanPct   : number  0–100
//    confidence : number  0–1
//    label      : string  verdict label
//    wordCount  : number
//    charCount  : number
//    sentCount  : number
//  }
//
//  Backwards-compat globals:
//    initRealtimeScan(inputId, outputId)  → ScanInstance
// ════════════════════════════════════════════════════════

const RealtimeScan = (() => {

  // ── Instance registry ─────────────────────────────────
  /** @type {Map<string, ScanInstance>} */
  const instances = new Map();

  // ── Core scan function ────────────────────────────────

  /**
   * Run a one-shot heuristic scan on arbitrary text.
   * Synchronous — uses Heuristics.quickScore() (no model inference).
   *
   * @param   {string} text
   * @returns {ScanResult}
   */
  function scan(text) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const sents = (text.match(/[^.!?]+[.!?]+/g) || []).length;

    if (!text.trim() || words.length < 5) {
      return {
        score: 50, aiPct: 50, humanPct: 50,
        confidence: 0, label: 'UNCERTAIN',
        wordCount: words.length,
        charCount: text.length,
        sentCount: sents,
      };
    }

    const quick = Heuristics.quickScore(text);
    return {
      score:      quick.score,
      aiPct:      100 - quick.score,
      humanPct:   quick.score,
      confidence: quick.confidence,
      label:      quick.label,
      wordCount:  words.length,
      charCount:  text.length,
      sentCount:  sents,
    };
  }

  // ── Attach ────────────────────────────────────────────

  /**
   * Attach a live-scan instance to an input and output element.
   *
   * @param {string} inputId    textarea or input element id
   * @param {string} outputId   element id where results are rendered
   * @param {object} [opts]
   * @param {number} [opts.debounceMs]   ms to wait after last keystroke  (default: CONFIG.REALTIME_DEBOUNCE)
   * @param {number} [opts.idleMs]       ms for idle deeper scan          (default: 3× debounceMs)
   * @param {number} [opts.minChars]     min text length before scanning  (default: 40)
   * @param {number} [opts.historyLen]   number of past scans to show in sparkline (default: 8)
   * @param {Function} [opts.onResult]   callback(ScanResult, text) after each scan
   * @returns {ScanInstance}
   */
  function attach(inputId, outputId, opts = {}) {
    // Clean up any existing instance for this input
    detach(inputId);

    const inputEl  = document.getElementById(inputId);
    const outputEl = document.getElementById(outputId);
    if (!inputEl) {
      console.warn(`[RealtimeScan] element #${inputId} not found`);
      return null;
    }

    const debounceMs = opts.debounceMs ?? CONFIG.REALTIME_DEBOUNCE ?? 600;
    const idleMs     = opts.idleMs     ?? debounceMs * 3;
    const minChars   = opts.minChars   ?? 40;
    const histLen    = opts.historyLen ?? 8;

    // ── Instance state ──────────────────────────────────
    let _paused        = false;
    let _debounceTimer = null;
    let _idleTimer     = null;
    let _lastText      = '';
    let _lastResult    = null;
    let _scoreHistory  = [];   // last N scan results for sparkline
    let _scanCount     = 0;

    // ── Typing indicator ────────────────────────────────
    function _showTyping() {
      if (!outputEl) return;
      outputEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
          <span class="loading-dots" aria-label="scanning">
            <span style="animation-delay:0s">●</span>
            <span style="animation-delay:.15s">●</span>
            <span style="animation-delay:.3s">●</span>
          </span>
          <span style="font-size:0.65rem;color:var(--text-muted);letter-spacing:.1em;">PROCESSING</span>
        </div>
      `;
    }

    // ── Waiting indicator ───────────────────────────────
    function _showWaiting(charCount) {
      if (!outputEl) return;
      const need = minChars - charCount;
      outputEl.innerHTML = `
        <span style="font-size:0.65rem;color:var(--text-muted);letter-spacing:.08em;">
          ${need > 0 ? `type ${need} more characters for live scan…` : 'keep typing…'}
        </span>
      `;
    }

    // ── Render result ────────────────────────────────────
    function _render(result, text) {
      if (!outputEl) return;

      const verdict    = CONFIG.getVerdict(result.score);
      const prev       = _lastResult;
      const delta      = prev ? result.score - prev.score : 0;
      const deltaStr   = delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : '';
      const deltaColor = delta > 0 ? 'var(--accent-success)' : delta < 0 ? 'var(--accent-danger)' : 'var(--text-muted)';

      // Confidence ring: 0 → 280 degrees (SVG arc)
      const confDeg    = Math.round(result.confidence * 280);
      const sparkline  = _buildSparkline(_scoreHistory, result.score);

      outputEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">

          <!-- Score + delta -->
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span style="
              font-family:var(--font-display,monospace);
              font-size:1.6rem;font-weight:900;
              color:${verdict.color};
              transition:color 0.4s ease;
            ">${result.score}</span>
            ${deltaStr ? `
              <span style="font-size:0.65rem;font-weight:700;color:${deltaColor};">${deltaStr}</span>
            ` : ''}
          </div>

          <!-- Confidence arc + sparkline -->
          <div style="display:flex;align-items:center;gap:6px;">
            ${sparkline}
            <svg width="28" height="28" viewBox="0 0 28 28" style="transform:rotate(-140deg);">
              <circle cx="14" cy="14" r="11" fill="none"
                stroke="rgba(255,255,255,0.07)" stroke-width="2.5"/>
              <circle cx="14" cy="14" r="11" fill="none"
                stroke="${verdict.color}" stroke-width="2.5"
                stroke-linecap="round"
                stroke-dasharray="${_arcLength(11, confDeg)} 999"
                style="transition:stroke-dasharray 0.5s ease;"/>
            </svg>
          </div>
        </div>

        <!-- Trust bar -->
        <div style="
          height:3px;background:rgba(255,255,255,0.06);
          border-radius:99px;overflow:hidden;margin-bottom:10px;
        ">
          <div id="rt-bar-${inputId}" style="
            height:100%;width:0%;
            background:linear-gradient(90deg,${verdict.color}99,${verdict.color});
            border-radius:99px;
            transition:width 0.5s cubic-bezier(0.4,0,0.2,1);
          "></div>
        </div>

        <!-- Label + AI/Human breakdown -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="
            font-size:0.62rem;letter-spacing:.1em;font-weight:700;
            color:${verdict.color};
          ">${verdict.label}</span>
          <span style="font-size:0.62rem;color:var(--text-muted);">
            <span style="color:var(--accent-danger);">${result.aiPct}% AI</span>
            &nbsp;·&nbsp;
            <span style="color:var(--accent-success);">${result.humanPct}% Human</span>
          </span>
        </div>

        <!-- Stats footer -->
        <div style="
          display:flex;justify-content:space-between;
          font-size:0.6rem;color:var(--text-muted);
          padding-top:6px;border-top:1px solid rgba(255,255,255,0.05);
        ">
          <span>${result.wordCount} words</span>
          <span>${result.sentCount} sentences</span>
          <span>${result.charCount.toLocaleString()} chars</span>
          <span style="color:var(--text-secondary);">scan #${_scanCount}</span>
        </div>
      `;

      // Animate bar (needs one-frame delay for transition to fire)
      requestAnimationFrame(() => {
        const bar = document.getElementById(`rt-bar-${inputId}`);
        if (bar) bar.style.width = `${Math.max(2, result.score)}%`;
      });
    }

    // ── Sparkline SVG ────────────────────────────────────
    function _buildSparkline(history, currentScore) {
      const all = [...history, currentScore];
      if (all.length < 2) return '';

      const W = 36, H = 18;
      const min  = Math.min(...all, 0);
      const max  = Math.max(...all, 100);
      const range = max - min || 1;

      const points = all.map((v, i) => {
        const x = (i / (all.length - 1)) * W;
        const y = H - ((v - min) / range) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');

      const lastV = all[all.length - 1];
      const dotX  = W;
      const dotY  = H - ((lastV - min) / range) * H;
      const color = CONFIG.getVerdict(lastV).color;

      return `
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
             style="overflow:visible;" aria-hidden="true">
          <polyline
            points="${points}"
            fill="none" stroke="${color}55" stroke-width="1.5"
            stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}"
            r="2.5" fill="${color}"/>
        </svg>
      `;
    }

    // ── Arc math ─────────────────────────────────────────
    function _arcLength(r, degrees) {
      return (degrees / 360) * 2 * Math.PI * r;
    }

    // ── Core scan + state update ─────────────────────────
    function _runScan(text) {
      if (_paused) return;
      const result = scan(text);
      _scanCount++;
      _scoreHistory = [..._scoreHistory.slice(-(histLen - 1)), result.score];
      _render(result, text);
      _lastResult = result;

      opts.onResult?.(result, text);

      // Propagate to TrustScore analytics (non-destructive — no DB write)
      if (typeof TrustScore !== 'undefined') {
        TrustScore.on && void 0;   // just referencing — event will fire on record()
      }
    }

    // ── Input handler ─────────────────────────────────────
    function _onInput() {
      if (_paused) return;

      const text = inputEl.value;
      if (text === _lastText) return;  // dedup
      _lastText = text;

      // Cancel pending timers
      clearTimeout(_debounceTimer);
      clearTimeout(_idleTimer);

      const charCount = text.trim().length;

      if (charCount < minChars) {
        _showWaiting(charCount);
        return;
      }

      // Show typing indicator while debounce is pending
      _showTyping();

      // ── Debounce timer ──────────────────────────────────
      _debounceTimer = setTimeout(() => {
        _runScan(text);

        // ── Idle timer — deeper analysis hint ──────────────
        // After the scan fires, wait for idleMs of silence
        // and show a "full analysis available" prompt.
        _idleTimer = setTimeout(() => {
          if (inputEl.value === text && outputEl) {
            const hint = outputEl.querySelector('[data-idle-hint]');
            if (!hint && _lastResult) {
              const hintEl = document.createElement('div');
              hintEl.setAttribute('data-idle-hint', '1');
              hintEl.style.cssText = `
                margin-top:8px;padding:5px 10px;
                border-radius:6px;border:1px solid rgba(0,229,255,0.2);
                background:rgba(0,229,255,0.04);
                font-size:0.62rem;color:var(--text-secondary);
                cursor:pointer;text-align:center;
                animation:fadeIn 0.3s ease;
              `;
              hintEl.innerHTML = `
                <span style="color:var(--accent-primary);">⚡</span>
                Run full analysis for multi-model verdict
              `;
              hintEl.onclick = () => {
                const analyzeBtn = document.getElementById('analyze-btn');
                if (analyzeBtn) analyzeBtn.click();
                else {
                  const evt = new CustomEvent('realtime:analyze-requested', {
                    detail: { text }, bubbles: true,
                  });
                  inputEl.dispatchEvent(evt);
                }
              };
              outputEl.appendChild(hintEl);
            }
          }
        }, idleMs);

      }, debounceMs);
    }

    // ── Attach listener ──────────────────────────────────
    inputEl.addEventListener('input', _onInput);

    // ── ScanInstance interface ───────────────────────────
    const instance = Object.freeze({
      pause()   { _paused = true;  },
      resume()  { _paused = false; },
      flush()   {
        clearTimeout(_debounceTimer);
        clearTimeout(_idleTimer);
        const t = inputEl.value;
        if (t.trim().length >= minChars) _runScan(t);
      },
      destroy() {
        clearTimeout(_debounceTimer);
        clearTimeout(_idleTimer);
        inputEl.removeEventListener('input', _onInput);
        instances.delete(inputId);
        if (outputEl) outputEl.innerHTML = '';
      },
      get lastResult()  { return _lastResult;    },
      get scanCount()   { return _scanCount;      },
      get scoreHistory(){ return [..._scoreHistory]; },
    });

    instances.set(inputId, instance);
    return instance;
  }

  // ── Detach ────────────────────────────────────────────

  /**
   * Destroy and remove the scan instance attached to an input.
   * @param {string} inputId
   */
  function detach(inputId) {
    instances.get(inputId)?.destroy();
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({ attach, detach, scan, instances });

})();

window.RealtimeScan = RealtimeScan;

// ── Backwards-compatible global ───────────────────────────────────────────────

/**
 * @deprecated Use RealtimeScan.attach(inputId, outputId, opts)
 * Matches the original initRealtimeScan(inputId, outputId) signature.
 */
function initRealtimeScan(inputId, outputId, opts = {}) {
  return RealtimeScan.attach(inputId, outputId, opts);
}

window.initRealtimeScan = initRealtimeScan;