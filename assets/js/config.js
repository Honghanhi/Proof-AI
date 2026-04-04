// ════════════════════════════════════════════════════════
//  CONFIG — Global Configuration  (FIXED v2)
//
//  Changes:
//  1. API_TIMEOUT increased to 90s (Render cold-start = up to 60s)
//  2. SERVICES URLs confirmed correct
//  3. AI_MODE_DEFAULT = 'server' (use Render backend by default)
//  4. Added helper: getServiceUrl(key) for safe access
// ════════════════════════════════════════════════════════

const CONFIG = (() => {

  // ── Environment detection ─────────────────────────────
  const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
  const IS_DEV   = IS_LOCAL || window.location.hostname.endsWith('.local');

  // ── Backend API Microservices ─────────────────────────
  const SERVICES = {
    GATEWAY:  'https://gateway-g5cc.onrender.com',
    TEXT:     'https://text-service-glgj.onrender.com',
    FAKENEWS: 'https://fakenews-service.onrender.com',
    IMAGE:    'https://image-lchq.onrender.com',
    UTILITY:  'https://utility-service-m2n3.onrender.com',
  };

  // Default API base URL (gateway)
  const API_BASE_URL = SERVICES.GATEWAY;

  // IMPORTANT: 90s timeout to survive Render free-tier cold-start (can take 50-60s)
  const API_TIMEOUT = 90_000;

  // ── AI Execution Modes ────────────────────────────────
  const AI_MODES        = ['server', 'cdn', 'local'];
  const AI_MODE_DEFAULT = 'server';   // Always use Render backend

  // ── @xenova/transformers CDN ──────────────────────────
  const TRANSFORMERS_CDN =
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

  // ── Local model path ──────────────────────────────────
  const MODEL_PATH_LOCAL = '/models/';

  // ── Model registry ────────────────────────────────────
  const MODELS = [
    {
      id:        'gpt-detector',
      name:      'GPT Detector',
      weight:    0.25,
      hfRepo:    'openai-community/roberta-base-openai-detector',
      task:      'text-classification',
      maxTokens: 512,
      icon:      '🤖',
    },
    {
      id:        'roberta-base',
      name:      'RoBERTa-Base',
      weight:    0.20,
      hfRepo:    'roberta-base',
      task:      'text-classification',
      maxTokens: 512,
      icon:      '🔬',
    },
    {
      id:        'radar',
      name:      'RADAR',
      weight:    0.20,
      hfRepo:    'TrustSafeAI/RADAR-Vicuna-7B',
      task:      'text-classification',
      maxTokens: 512,
      icon:      '📡',
    },
    {
      id:        'fake-news-bert',
      name:      'FakeNews-BERT',
      weight:    0.20,
      hfRepo:    'mrm8488/bert-tiny-finetuned-fake-news-detection',
      task:      'text-classification',
      maxTokens: 512,
      icon:      '📰',
    },
    {
      id:        'grover',
      name:      'Grover',
      weight:    0.15,
      hfRepo:    'grover-mega',
      task:      'text-classification',
      maxTokens: 1024,
      icon:      '🌀',
    },
  ];

  // ── Verdict thresholds ────────────────────────────────
  const VERDICTS = [
    { min: 85, label: 'AUTHENTIC',    class: 'badge-green',  color: 'var(--accent-success)' },
    { min: 70, label: 'LIKELY REAL',  class: 'badge-green',  color: '#7aff6e'               },
    { min: 50, label: 'UNCERTAIN',    class: 'badge-yellow', color: 'var(--accent-warn)'    },
    { min: 30, label: 'SUSPICIOUS',   class: 'badge-yellow', color: '#ff7a00'               },
    { min:  0, label: 'AI-GENERATED', class: 'badge-red',    color: 'var(--accent-danger)'  },
  ];

  // ── IndexedDB schema ──────────────────────────────────
  const IDB = Object.freeze({
    NAME:    'aiproof_db',
    VERSION: 1,
    STORES: Object.freeze({
      RESULTS:  'results',
      CHAIN:    'chain',
      CACHE:    'model_cache',
      SETTINGS: 'settings',
    }),
    INDEXES: Object.freeze({
      results: [
        ['by_timestamp', 'timestamp',     { unique: false }],
        ['by_verdict',   'verdict.label', { unique: false }],
        ['by_type',      'type',          { unique: false }],
      ],
      chain: [
        ['by_timestamp', 'timestamp', { unique: false }],
      ],
    }),
  });

  // ── LocalStorage fallback keys ────────────────────────
  const STORAGE_KEY_CHAIN    = 'aiproof_blockchain';
  const STORAGE_KEY_RESULTS  = 'aiproof_results';
  const STORAGE_KEY_SETTINGS = 'aiproof_settings';

  // ── UX constants ─────────────────────────────────────
  const QR_SIZE            = 120;
  const REALTIME_DEBOUNCE  = 600;
  const POW_DIFFICULTY     = 2;
  const MAX_STORED_RESULTS = 500;

  // ── Helpers ───────────────────────────────────────────
  function getVerdict(score) {
    return VERDICTS.find(v => score >= v.min) || VERDICTS[VERDICTS.length - 1];
  }

  function resolveModelPath(model, mode) {
    if (mode === 'local') return MODEL_PATH_LOCAL + model.id + '/';
    return model.hfRepo;
  }

  /** Safe accessor for service URL by key */
  function getServiceUrl(key) {
    return SERVICES[key] || SERVICES.GATEWAY;
  }

  // ── Public surface (frozen) ───────────────────────────
  return Object.freeze({
    IS_LOCAL, IS_DEV,
    API_BASE_URL, API_TIMEOUT,
    SERVICES,
    AI_MODES, AI_MODE_DEFAULT,
    TRANSFORMERS_CDN, MODEL_PATH_LOCAL,
    MODELS, VERDICTS,
    IDB,
    STORAGE_KEY_CHAIN, STORAGE_KEY_RESULTS, STORAGE_KEY_SETTINGS,
    QR_SIZE, REALTIME_DEBOUNCE, POW_DIFFICULTY, MAX_STORED_RESULTS,
    getVerdict, resolveModelPath, getServiceUrl,
  });
})();

window.CONFIG = CONFIG;