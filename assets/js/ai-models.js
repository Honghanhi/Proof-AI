// ════════════════════════════════════════════════════════
//  AI-MODELS — Transformers.js Pipeline Manager
//
//  Manages the lifecycle of @xenova/transformers inference
//  pipelines for 'cdn' and 'local' AI modes.
//
//  Each model is loaded lazily on first use and kept in a
//  module-level cache so subsequent calls reuse the same
//  pipeline instance across multiple analyses in a session.
//
//  Public API (window.AIModels):
//
//    AIModels.runModel(modelCfg, text)
//      → Promise<ModelResult>
//
//    AIModels.runAllModels(text, onProgress?)
//      → Promise<ModelResult[]>
//
//    AIModels.warmup(modelId?)
//      → Promise<void>   preload without analysing
//
//    AIModels.getLoadStatus()
//      → Map<modelId, 'idle'|'loading'|'ready'|'error'>
//
//    AIModels.clearCache()
//      → void
//
//  ModelResult:
//  {
//    modelId   : string
//    modelName : string
//    aiPct     : number   0–100
//    humanPct  : number   0–100
//    confidence: number   0–1
//    score     : number   0–100  (trust scale: 100=human)
//    rawLabel  : string   original classifier label
//    rawScore  : number   original classifier score
//    source    : 'transformers'|'heuristic'
//    latencyMs : number
//  }
// ════════════════════════════════════════════════════════

const AIModels = (() => {

  // ── Pipeline cache ────────────────────────────────────
  /** @type {Map<string, any>}  modelId → transformers pipeline instance */
  const _pipelines   = new Map();

  /** @type {Map<string, string>}  modelId → load status */
  const _loadStatus  = new Map();

  /** @type {Map<string, Promise>}  modelId → in-flight load promise */
  const _loadingPromises = new Map();

  // ── Transformers.js accessor ──────────────────────────

  /**
   * Get the @xenova/transformers module.
   * app.js loads it as a script tag; it exposes itself via
   * window.transformers (UMD build) or window.Transformers.
   *
   * Returns null if not yet loaded.
   */
  function _getTransformers() {
    return window.transformers || window.Transformers || null;
  }

  /**
   * Wait for transformers to be ready, up to `timeoutMs`.
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<object>}  the transformers module
   */
  function _waitForTransformers(timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const t = _getTransformers();
      if (t) { resolve(t); return; }

      const deadline = Date.now() + timeoutMs;
      const poll = setInterval(() => {
        const mod = _getTransformers();
        if (mod) { clearInterval(poll); resolve(mod); return; }
        if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('AIModels: @xenova/transformers not available after ' + timeoutMs + 'ms'));
        }
      }, 200);

      // Also listen for STATE.transformersReady
      if (typeof STATE !== 'undefined') {
        STATE.on('transformersReady', (ready) => {
          if (ready) {
            clearInterval(poll);
            resolve(_getTransformers() || {});
          }
        });
      }
    });
  }

  // ── Pipeline loader ───────────────────────────────────

  /**
   * Load (or return cached) pipeline for a model config.
   *
   * @param   {object} modelCfg  — entry from CONFIG.MODELS
   * @returns {Promise<Function>}  a transformers.js pipeline fn
   */
  async function _loadPipeline(modelCfg) {
    const id = modelCfg.id;

    // Already cached
    if (_pipelines.has(id)) return _pipelines.get(id);

    // Deduplicate concurrent load requests
    if (_loadingPromises.has(id)) return _loadingPromises.get(id);

    const loadPromise = (async () => {
      _loadStatus.set(id, 'loading');

      try {
        const transformers = await _waitForTransformers();
        const { pipeline, env } = transformers;

        if (!pipeline) throw new Error('transformers.pipeline() not found');

        // Configure path resolution for current mode
        const mode = typeof STATE !== 'undefined'
          ? STATE.get('aiMode')
          : CONFIG.AI_MODE_DEFAULT;

        const modelPath = CONFIG.resolveModelPath(modelCfg, mode);

        if (mode === 'local') {
          env.localModelPath    = CONFIG.MODEL_PATH_LOCAL;
          env.allowRemoteModels = false;
        } else {
          env.allowRemoteModels = true;
        }

        console.info(`[AIModels] loading ${id} from ${modelPath} …`);

        const pipe = await pipeline(modelCfg.task, modelPath, {
          quantized: true,         // use quantized ONNX where available
          progress_callback: (prog) => {
            if (prog.status === 'progress') {
              console.debug(`[AIModels] ${id}: ${Math.round(prog.progress || 0)}%`);
            }
          },
        });

        _pipelines.set(id, pipe);
        _loadStatus.set(id, 'ready');
        _loadingPromises.delete(id);
        return pipe;

      } catch (err) {
        _loadStatus.set(id, 'error');
        _loadingPromises.delete(id);
        console.warn(`[AIModels] failed to load ${id}:`, err.message);
        throw err;
      }
    })();

    _loadingPromises.set(id, loadPromise);
    return loadPromise;
  }

  // ── Label normalisation ───────────────────────────────

  /**
   * Normalise whatever label/score a transformers classifier returns
   * into a standard { aiPct, humanPct } pair.
   *
   * Different models use different label conventions:
   *   RoBERTa OpenAI detector → LABEL_0 = human, LABEL_1 = AI
   *   Some models             → "FAKE" / "REAL"
   *   Some models             → "AI" / "HUMAN"
   *   Some models             → "generated" / "written"
   *
   * @param   {string} label    raw classifier label
   * @param   {number} rawScore classifier confidence (0–1)
   * @returns {{ aiPct:number, humanPct:number }}
   */
  function _normaliseLabel(label, rawScore) {
    const l = (label || '').toUpperCase();
    const s = rawScore ?? 0.5;

    // Positive (AI) labels
    const isAI = [
      'LABEL_1', 'AI', 'FAKE', 'GENERATED', 'MACHINE',
      'AI-GENERATED', 'NOT_HUMAN', 'SYNTHETIC',
    ].some(k => l.includes(k));

    // Negative (human) labels
    const isHuman = [
      'LABEL_0', 'HUMAN', 'REAL', 'WRITTEN', 'AUTHENTIC',
      'HUMAN_WRITTEN', 'NOT_AI',
    ].some(k => l.includes(k));

    if (isAI)    return { aiPct: Math.round(s * 100), humanPct: Math.round((1 - s) * 100) };
    if (isHuman) return { aiPct: Math.round((1 - s) * 100), humanPct: Math.round(s * 100) };

    // Unknown label — treat score as neutral confidence
    return { aiPct: 50, humanPct: 50 };
  }

  // ── Text truncation ───────────────────────────────────

  /**
   * Truncate text to fit within a model's maxTokens budget.
   * Uses a conservative 3-char/token estimate (models tokenise differently).
   *
   * @param   {string} text
   * @param   {number} maxTokens
   * @returns {string}
   */
  function _truncate(text, maxTokens) {
    const budget = maxTokens * 3;
    if (text.length <= budget) return text;
    return text.slice(0, budget).trim();
  }

  // ── Run single model ──────────────────────────────────

  /**
   * Run one model against a text input.
   * Falls back to heuristics if the pipeline can't load.
   *
   * @param   {object} modelCfg  — entry from CONFIG.MODELS
   * @param   {string} text
   * @returns {Promise<ModelResult>}
   */
  async function runModel(modelCfg, text) {
    const t0 = performance.now();

    try {
      const pipe      = await _loadPipeline(modelCfg);
      const truncated = _truncate(text, modelCfg.maxTokens || 512);

      // Run inference — result is [{label, score}, ...]
      const output = await pipe(truncated, { topk: 1 });
      const top    = Array.isArray(output) ? output[0] : output;

      const { aiPct, humanPct } = _normaliseLabel(top.label, top.score);
      const trustScore          = 100 - aiPct;   // trust = human probability

      return {
        modelId:    modelCfg.id,
        modelName:  modelCfg.name,
        aiPct,
        humanPct,
        confidence: +top.score.toFixed(3),
        score:      trustScore,
        rawLabel:   top.label,
        rawScore:   top.score,
        source:     'transformers',
        latencyMs:  Math.round(performance.now() - t0),
      };

    } catch (err) {
      // Graceful fallback to heuristics for this model slot
      console.warn(`[AIModels] ${modelCfg.id} inference failed, using heuristics:`, err.message);
      const h = Heuristics.analyzeText(text);
      return {
        modelId:    modelCfg.id,
        modelName:  modelCfg.name,
        aiPct:      h.aiPct,
        humanPct:   h.humanPct,
        confidence: h.confidence * 0.6,   // lower confidence for fallback
        score:      100 - h.aiPct,
        rawLabel:   'heuristic-fallback',
        rawScore:   h.confidence,
        source:     'heuristic',
        latencyMs:  Math.round(performance.now() - t0),
      };
    }
  }

  // ── Run all models ────────────────────────────────────

  /**
   * Run all models in CONFIG.MODELS concurrently against a text.
   * Models that fail individually fall back to heuristics.
   *
   * @param   {string}   text
   * @param   {Function} [onProgress]  called after each model completes
   *                                    onProgress(modelResult, completedCount, total)
   * @returns {Promise<ModelResult[]>}
   */
  async function runAllModels(text, onProgress) {
    const models  = CONFIG.MODELS;
    const results = new Array(models.length);
    let completed = 0;

    await Promise.all(
      models.map(async (modelCfg, i) => {
        const result = await runModel(modelCfg, text);
        results[i]   = result;
        completed++;
        if (typeof onProgress === 'function') {
          onProgress(result, completed, models.length);
        }
      })
    );

    return results;
  }

  // ── Warmup ────────────────────────────────────────────

  /**
   * Preload one or all model pipelines in the background.
   * Does not run inference — just downloads and caches.
   *
   * @param   {string} [modelId]  specific model id, or all if omitted
   * @returns {Promise<void>}
   */
  async function warmup(modelId) {
    const targets = modelId
      ? CONFIG.MODELS.filter(m => m.id === modelId)
      : CONFIG.MODELS;

    await Promise.allSettled(targets.map(m => _loadPipeline(m)));
  }

  // ── Status ────────────────────────────────────────────

  function getLoadStatus() {
    return new Map(_loadStatus);
  }

  function clearCache() {
    _pipelines.clear();
    _loadStatus.clear();
    _loadingPromises.clear();
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    runModel,
    runAllModels,
    warmup,
    getLoadStatus,
    clearCache,
  });

})();

window.AIModels = AIModels;