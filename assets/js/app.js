// ════════════════════════════════════════════════════════
//  APP — Application Bootstrap
//
//  Responsibilities
//  ────────────────
//  1. Open and migrate IndexedDB (with localStorage fallback)
//  2. Hydrate global reactive STATE from persisted settings
//  3. Conditionally inject @xenova/transformers script tag
//     when AI mode is 'cdn' or 'local'
//  4. Call Router.init() to load the correct page module
//  5. Wire up nav highlighting, page-enter animation, and
//     global error boundary
// ════════════════════════════════════════════════════════

// ── Global reactive state ─────────────────────────────────────────────────────
/**
 * Central mutable state object.
 * Components read from STATE and call STATE.set() to trigger
 * registered listeners (lightweight pub-sub, no framework needed).
 *
 * Shape
 * ─────
 * aiMode         – active AI execution mode ('server'|'cdn'|'local')
 * idbReady       – true once IndexedDB is open and usable
 * idbFallback    – true when IDB failed and we fell back to localStorage
 * transformersReady – true once @xenova/transformers has loaded
 * currentPage    – filename of the active HTML page
 * analysisInProgress – whether a scan is running
 * lastResult     – most recent AnalysisResult object (or null)
 */
const STATE = (() => {
  const _data = {
    aiMode:               CONFIG.AI_MODE_DEFAULT,
    idbReady:             false,
    idbFallback:          false,
    transformersReady:    false,
    currentPage:          '',
    analysisInProgress:   false,
    lastResult:           null,
  };

  const _listeners = {};

  return {
    /** Read a state key */
    get(key) { return _data[key]; },

    /** Write one or more keys and notify listeners */
    set(updates) {
      const changed = [];
      for (const [k, v] of Object.entries(updates)) {
        if (_data[k] !== v) {
          _data[k] = v;
          changed.push(k);
        }
      }
      changed.forEach(k => (_listeners[k] || []).forEach(fn => fn(_data[k], _data)));
      if (changed.length) (_listeners['*'] || []).forEach(fn => fn(_data));
    },

    /** Subscribe to changes on a specific key, or '*' for any change */
    on(key, fn) {
      if (!_listeners[key]) _listeners[key] = [];
      _listeners[key].push(fn);
      return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); }; // unsubscribe
    },

    /** Snapshot of full state (read-only copy) */
    snapshot() { return { ..._data }; },
  };
})();

window.STATE = STATE;

// ── IndexedDB bootstrap ───────────────────────────────────────────────────────

/** Shared IDB connection — set once openIDB() resolves */
let _idb = null;

/**
 * Open (or create/migrate) the IndexedDB database.
 * Resolves with the IDBDatabase instance.
 * Rejects if IDB is blocked; callers should catch and set
 * STATE.idbFallback = true before falling back to localStorage.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openIDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));

    const req = indexedDB.open(CONFIG.IDB.NAME, CONFIG.IDB.VERSION);

    // ── Schema creation / migration ──
    req.onupgradeneeded = (event) => {
      const db      = event.target.result;
      const stores  = CONFIG.IDB.STORES;
      const indexes = CONFIG.IDB.INDEXES;

      // results store — keyed by result id
      if (!db.objectStoreNames.contains(stores.RESULTS)) {
        const resultsStore = db.createObjectStore(stores.RESULTS, { keyPath: 'id' });
        (indexes.results || []).forEach(([name, path, opts]) => {
          resultsStore.createIndex(name, path, opts);
        });
      }

      // chain store — keyed by block index
      if (!db.objectStoreNames.contains(stores.CHAIN)) {
        const chainStore = db.createObjectStore(stores.CHAIN, { keyPath: 'index' });
        (indexes.chain || []).forEach(([name, path, opts]) => {
          chainStore.createIndex(name, path, opts);
        });
      }

      // model_cache store — keyed by model id
      if (!db.objectStoreNames.contains(stores.CACHE)) {
        db.createObjectStore(stores.CACHE, { keyPath: 'id' });
      }

      // settings store — arbitrary key/value
      if (!db.objectStoreNames.contains(stores.SETTINGS)) {
        db.createObjectStore(stores.SETTINGS, { keyPath: 'key' });
      }
    };

    req.onsuccess = (event) => {
      _idb = event.target.result;

      // Surface IDB connection errors at runtime
      _idb.onerror = (e) => console.error('[IDB] runtime error', e);

      resolve(_idb);
    };

    req.onerror   = () => reject(req.error);
    req.onblocked = () => {
      console.warn('[IDB] upgrade blocked — close other tabs using this app');
      reject(new Error('IDB blocked'));
    };
  });
}

/**
 * Generic IDB transaction helper.
 * Returns a Promise that resolves with the request result.
 *
 * @param {string}  storeName  — one of CONFIG.IDB.STORES values
 * @param {'readonly'|'readwrite'} mode
 * @param {function(IDBObjectStore): IDBRequest} fn
 */
function idbOp(storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!_idb) return reject(new Error('IDB not ready'));
    const tx  = _idb.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

window.idbOp = idbOp;

// ── Persist/restore user settings ────────────────────────────────────────────

/**
 * Load persisted settings from IDB (or localStorage fallback)
 * and merge them into STATE.
 */
async function loadSettings() {
  try {
    if (STATE.get('idbReady')) {
      const aiModeSetting = await idbOp(
        CONFIG.IDB.STORES.SETTINGS, 'readonly',
        store => store.get('aiMode')
      );
      if (aiModeSetting?.value && CONFIG.AI_MODES.includes(aiModeSetting.value)) {
        STATE.set({ aiMode: aiModeSetting.value });
      }
    } else {
      // localStorage fallback
      try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY_SETTINGS);
        if (raw) {
          const s = JSON.parse(raw);
          if (s.aiMode && CONFIG.AI_MODES.includes(s.aiMode)) {
            STATE.set({ aiMode: s.aiMode });
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[APP] loadSettings failed:', err);
  }
}

/**
 * Persist a setting to IDB (or localStorage fallback).
 * @param {string} key
 * @param {*}      value
 */
async function saveSetting(key, value) {
  try {
    if (STATE.get('idbReady')) {
      await idbOp(
        CONFIG.IDB.STORES.SETTINGS, 'readwrite',
        store => store.put({ key, value })
      );
    } else {
      const raw  = localStorage.getItem(CONFIG.STORAGE_KEY_SETTINGS) || '{}';
      const data = JSON.parse(raw);
      data[key]  = value;
      localStorage.setItem(CONFIG.STORAGE_KEY_SETTINGS, JSON.stringify(data));
    }
  } catch (err) {
    console.warn('[APP] saveSetting failed:', err);
  }
}

window.saveSetting = saveSetting;

// ── @xenova/transformers loader ───────────────────────────────────────────────

/**
 * Dynamically inject the @xenova/transformers script when the
 * current AI mode requires in-browser inference ('cdn' or 'local').
 *
 * Sets STATE.transformersReady = true on success.
 * Silently skips if mode === 'server' or if already loaded.
 *
 * @param {string} mode  current AI mode
 * @returns {Promise<void>}
 */
async function loadTransformersIfNeeded(mode) {
  if (mode === 'server') return;  // backend handles inference
  if (window.__transformers_loaded) {
    STATE.set({ transformersReady: true });
    return;
  }

  return new Promise((resolve, reject) => {
    // Prefer dynamic import for true ESM (tree-shakeable)
    // Fall back to classic script tag for browsers that block dynamic imports
    const src = CONFIG.TRANSFORMERS_CDN;

    const script    = document.createElement('script');
    script.type     = 'module'; // ESM build
    script.src      = src;

    script.onload = () => {
      window.__transformers_loaded = true;

      // For 'local' mode: tell @xenova/transformers where to find weights
      if (mode === 'local' && window.transformers?.env) {
        window.transformers.env.localModelPath = CONFIG.MODEL_PATH_LOCAL;
        window.transformers.env.allowRemoteModels = false;
      }

      STATE.set({ transformersReady: true });
      console.info(`[APP] @xenova/transformers loaded (mode: ${mode})`);
      resolve();
    };

    script.onerror = (err) => {
      console.error('[APP] Failed to load @xenova/transformers from CDN:', err);
      // Don't reject the full bootstrap — degrade gracefully
      resolve();
    };

    document.head.appendChild(script);
  });
}

// ── Nav highlighting ──────────────────────────────────────────────────────────

function highlightActiveNav() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href') || '';
    const isActive = href === current || href === './' + current;
    link.classList.toggle('active', isActive);
  });
}

// ── Global error boundary ─────────────────────────────────────────────────────

window.addEventListener('unhandledrejection', (event) => {
  console.error('[APP] Unhandled promise rejection:', event.reason);
  // Surface to UI if a toast function is available
  if (typeof UI !== 'undefined' && UI.toast) {
    UI.toast('Unexpected error — check console for details.', 'error');
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  // 1. Record current page
  const page = window.location.pathname.split('/').pop() || 'index.html';
  STATE.set({ currentPage: page });

  // 2. Open IndexedDB
  try {
    await openIDB();
    STATE.set({ idbReady: true });
    console.info('[APP] IndexedDB ready');
  } catch (err) {
    console.warn('[APP] IndexedDB unavailable, using localStorage fallback:', err.message);
    STATE.set({ idbFallback: true });
  }

  // 3. Load persisted settings (aiMode etc.)
  await loadSettings();

  // 4. Load transformers if needed (non-blocking for UX)
  const mode = STATE.get('aiMode');
  loadTransformersIfNeeded(mode).catch(console.warn);

  // 5. Init router (detects page, loads module)
  if (typeof Router !== 'undefined') {
    Router.init();
  }

  // 6. Nav + animation
  highlightActiveNav();
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.add('page-enter');

  console.info(`[APP] bootstrap complete — page: ${page}, mode: ${mode}, idb: ${STATE.get('idbReady')}`);
}

// ── State change side-effects ─────────────────────────────────────────────────

// When AI mode changes: persist the new value and re-init transformers
STATE.on('aiMode', async (newMode) => {
  await saveSetting('aiMode', newMode);
  await loadTransformersIfNeeded(newMode);
});

// ── Entry point ───────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

window.APP_VERSION = '1.1.0';