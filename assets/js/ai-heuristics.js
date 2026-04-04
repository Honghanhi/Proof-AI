// ════════════════════════════════════════════════════════
//  AI-HEURISTICS — Statistical Text Analysis Engine
//
//  Pure JavaScript, zero dependencies. Used as:
//    • The realtime-scan signal (instant feedback while typing)
//    • Fallback when transformers.js hasn't loaded yet
//    • Fallback when backend is unreachable
//    • Weighted tie-breaker in the consensus pipeline
//
//  All functions are synchronous unless noted.
//
//  Public API (window.Heuristics):
//
//    Heuristics.analyzeText(text)
//      → { aiPct, humanPct, confidence, signals, features }
//
//    Heuristics.quickScore(text)
//      → { score:0–100, label, confidence }   (trust-score scale)
//
//    Heuristics.extractFeatures(text)
//      → FeatureVector
//
//    Heuristics.generateSignals(text, aiPct)
//      → Signal[]
// ════════════════════════════════════════════════════════

const Heuristics = (() => {

  // ── Feature extraction ────────────────────────────────

  /**
   * Extract a rich feature vector from raw text.
   * Every feature is a normalised value in [0, 1] or a raw count.
   *
   * @param   {string} text
   * @returns {object} FeatureVector
   */
  function extractFeatures(text) {
    const raw    = text.trim();
    const words  = raw.split(/\s+/).filter(Boolean);
    const sents  = raw.match(/[^.!?]+[.!?]+/g) || [raw];
    const chars  = raw.length;

    if (words.length < 5) {
      return { tooShort: true, wordCount: words.length };
    }

    // ── Lexical diversity ──
    const unique  = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
    const ttr     = unique.size / words.length;                    // type-token ratio

    // ── Sentence length stats ──
    const sentLens     = sents.map(s => s.trim().split(/\s+/).length);
    const avgSentLen   = sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
    const sentVariance = sentLens.reduce((a, l) => a + Math.pow(l - avgSentLen, 2), 0) / sentLens.length;
    const sentStdDev   = Math.sqrt(sentVariance);

    // ── Punctuation patterns ──
    const commas      = (raw.match(/,/g)  || []).length;
    const semicolons  = (raw.match(/;/g)  || []).length;
    const colons      = (raw.match(/:/g)  || []).length;
    const dashes      = (raw.match(/—|-{2}/g) || []).length;
    const parens      = (raw.match(/[()]/g)   || []).length;
    const punctDensity = (commas + semicolons + colons) / words.length;

    // ── Transition / discourse markers (strong AI signals) ──
    const transitions = [
      'furthermore', 'moreover', 'in addition', 'additionally',
      'consequently', 'therefore', 'thus', 'hence',
      'in conclusion', 'to summarize', 'in summary', 'overall',
      'it is worth noting', 'it should be noted', 'notably',
      'it is important to', 'it is essential to',
      'in this context', 'in light of',
      'on the other hand', 'on the contrary',
      'as mentioned', 'as previously stated', 'as noted above',
      'first and foremost', 'last but not least',
    ];
    const rawLower = raw.toLowerCase();
    const transitionHits = transitions.filter(t => rawLower.includes(t)).length;

    // ── Hedging language ──
    const hedges = [
      'it seems', 'it appears', 'arguably', 'potentially',
      'it could be said', 'one might argue', 'in many ways',
      'to some extent', 'in some sense', 'broadly speaking',
    ];
    const hedgeHits = hedges.filter(h => rawLower.includes(h)).length;

    // ── Repetitive bigrams ──
    const bigrams = {};
    for (let i = 0; i < words.length - 1; i++) {
      const bg = words[i].toLowerCase() + ' ' + words[i + 1].toLowerCase();
      bigrams[bg] = (bigrams[bg] || 0) + 1;
    }
    const bigramCounts = Object.values(bigrams);
    const maxBigram    = bigramCounts.length ? Math.max(...bigramCounts) : 0;
    const bigramRepeat = bigramCounts.filter(c => c > 2).length;

    // ── Passive voice ratio (approximation) ──
    const passiveMatches = raw.match(/\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi) || [];
    const passiveRatio   = passiveMatches.length / sents.length;

    // ── Average word length ──
    const avgWordLen = words.reduce((s, w) => s + w.replace(/[^a-z]/gi, '').length, 0) / words.length;

    // ── Parenthetical usage ──
    const parenthetical = (raw.match(/\([^)]{10,80}\)/g) || []).length;

    // ── Numeric / citation density (human writing tends to cite) ──
    const numbers = (raw.match(/\b\d+(\.\d+)?\b/g) || []).length;

    // ── Paragraph structure ──
    const paragraphs = raw.split(/\n{2,}/).filter(p => p.trim().length > 20);
    const paraLens   = paragraphs.map(p => p.trim().split(/\s+/).length);
    const avgParaLen = paraLens.length
      ? paraLens.reduce((a, b) => a + b, 0) / paraLens.length
      : avgSentLen;

    return {
      wordCount:       words.length,
      sentCount:       sents.length,
      charCount:       chars,
      ttr,
      avgSentLen,
      sentStdDev,
      punctDensity,
      commas,
      semicolons,
      dashes,
      parens,
      transitionHits,
      hedgeHits,
      maxBigram,
      bigramRepeat,
      passiveRatio,
      avgWordLen,
      parenthetical,
      numbers,
      paragraphs:      paragraphs.length,
      avgParaLen,
    };
  }

  // ── Scoring model ─────────────────────────────────────

  /**
   * Score text for AI probability using the extracted feature vector.
   *
   * Returns:
   *   aiPct     — 0–100  probability content is AI-generated
   *   humanPct  — 0–100  (complement: 100 - aiPct)
   *   confidence — 0–1   how certain the heuristic is
   *
   * @param   {object} f  FeatureVector from extractFeatures()
   * @returns {{ aiPct:number, humanPct:number, confidence:number }}
   */
  function _score(f) {
    if (f.tooShort) {
      return { aiPct: 50, humanPct: 50, confidence: 0.1 };
    }

    // Each check adds/subtracts from an "AI evidence" accumulator.
    // Positive = more evidence of AI; negative = more evidence of human.
    let evidence   = 0;
    let maxEvidence = 0;

    function check(signal, weight) {
      evidence    += signal * weight;
      maxEvidence += Math.abs(weight);
    }

    // TTR: AI text tends toward higher lexical diversity (polished)
    // Very low ttr (<0.5) also suggests repetitive human content
    const ttrNorm = f.ttr > 0.80 ? 1 : f.ttr > 0.65 ? 0.5 : f.ttr < 0.45 ? -0.3 : 0;
    check(ttrNorm, 15);

    // Transition markers: strong signal — AI loves structural scaffolding
    check(Math.min(f.transitionHits / 3, 1), 25);

    // Hedge language: moderate signal
    check(Math.min(f.hedgeHits / 2, 1), 12);

    // Sentence length variance: human writing is messier
    // Low std dev = robotic uniformity
    const sentVarScore = f.sentStdDev < 3 ? 1 : f.sentStdDev < 6 ? 0.4 : 0;
    check(sentVarScore, 18);

    // Repetitive bigrams: human speech has natural repetition,
    // but AI produces structural bigram repeats ("in order to", "as well as")
    check(Math.min(f.bigramRepeat / 4, 1), 10);

    // Punctuation density: AI tends to be metronomic
    const punctScore = f.punctDensity > 0.18 && f.punctDensity < 0.28 ? 0.6 : 0;
    check(punctScore, 8);

    // Passive voice: AI tends to over-use passive constructions
    check(Math.min(f.passiveRatio, 1), 10);

    // Word length: AI text tends toward slightly longer average words
    const wlScore = f.avgWordLen > 5.5 ? 0.8 : f.avgWordLen > 4.8 ? 0.3 : 0;
    check(wlScore, 6);

    // Parenthetical usage: moderate AI signal (clarifying asides)
    check(Math.min(f.parenthetical / 3, 1), 6);

    // Numbers / citations — human writers tend to reference data more
    const numScore = f.numbers / f.wordCount;
    check(numScore > 0.04 ? -0.5 : 0, 5);

    // Paragraph uniformity
    if (f.paragraphs > 1) {
      const paraScore = f.avgParaLen > 80 && f.avgParaLen < 140 ? 0.5 : 0;
      check(paraScore, 5);
    }

    // Normalise to [0, 1]
    const normalised = maxEvidence > 0 ? (evidence / maxEvidence) : 0;

    // Map to [5, 95] to avoid absolute certainty from heuristics alone
    const aiPct = Math.round(Math.max(5, Math.min(95, normalised * 80 + 10)));

    // Confidence: based on word count (more text = more signal)
    const confidence = Math.min(0.85, 0.3 + (f.wordCount / 400) * 0.55);

    return {
      aiPct,
      humanPct: 100 - aiPct,
      confidence: +confidence.toFixed(3),
    };
  }

  // ── Signal generation ─────────────────────────────────

  /**
   * Produce a list of highlighted evidence spans from the text.
   * Each signal identifies a sentence/phrase and its type.
   *
   * @param   {string} text
   * @param   {number} aiPct  0–100 AI probability
   * @returns {Signal[]}
   */
  function generateSignals(text, aiPct) {
    const sents = text.match(/[^.!?]+[.!?]+/g) || [text];
    const rawLower = text.toLowerCase();

    const AI_MARKERS = [
      'furthermore', 'moreover', 'in addition', 'consequently',
      'in conclusion', 'to summarize', 'as mentioned', 'it is worth noting',
      'it should be noted', 'on the other hand', 'first and foremost',
      'last but not least', 'in this context', 'additionally',
      'it is important to', 'broadly speaking',
    ];

    const FAKE_MARKERS = [
      'breaking', 'shocking', 'secret', 'exposed', 'they don\'t want you',
      'hidden truth', 'mainstream media', 'deep state', 'big pharma',
      'wake up', 'censored', 'you won\'t believe', 'share before deleted',
    ];

    return sents.slice(0, 10).map(sent => {
      const sl    = sent.toLowerCase();
      const aiHit = AI_MARKERS.filter(m => sl.includes(m)).length;
      const fakeHit = FAKE_MARKERS.filter(m => sl.includes(m)).length;

      if (fakeHit > 0) {
        return { text: sent.trim(), type: 'misinformation', strength: Math.min(1, 0.5 + fakeHit * 0.25) };
      }
      if (aiHit > 0 || aiPct > 65) {
        return { text: sent.trim(), type: 'ai-pattern', strength: Math.min(1, 0.3 + aiHit * 0.2) };
      }
      return { text: sent.trim(), type: 'neutral', strength: 0.05 };
    });
  }

  // ── Public entry point ────────────────────────────────

  /**
   * Full heuristic analysis of a text string.
   *
   * @param   {string} text
   * @returns {{
   *   aiPct:      number,
   *   humanPct:   number,
   *   confidence: number,
   *   signals:    Signal[],
   *   features:   FeatureVector,
   *   modelId:    'heuristics',
   *   modelName:  'Statistical Heuristics',
   * }}
   */
  function analyzeText(text) {
    const features = extractFeatures(text);
    const { aiPct, humanPct, confidence } = _score(features);
    const signals  = generateSignals(text, aiPct);

    return {
      aiPct,
      humanPct,
      confidence,
      signals,
      features,
      modelId:   'heuristics',
      modelName: 'Statistical Heuristics',
    };
  }

  /**
   * Lightweight quick score — for realtime scanning.
   * Returns trust-score scale (100 = authentic, 0 = AI-generated).
   *
   * @param   {string} text
   * @returns {{ score:number, label:string, confidence:number }}
   */
  function quickScore(text) {
    if (!text || text.trim().length < 20) {
      return { score: 50, label: 'UNCERTAIN', confidence: 0 };
    }
    const { aiPct, confidence } = analyzeText(text);
    const score = 100 - aiPct;   // trust score = inverse of AI probability
    const label = CONFIG.getVerdict(score).label;
    return { score: Math.round(score), label, confidence };
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({ analyzeText, quickScore, extractFeatures, generateSignals });

})();

window.Heuristics = Heuristics;

// ── Backwards-compat global (used by realtime-scan.js) ──
function heuristicScore(text) {
  return 100 - Heuristics.analyzeText(text).aiPct;
}
window.heuristicScore = heuristicScore;