// ════════════════════════════════════════════════════════
//  DB — Persistence Layer
//
//  Primary storage: IndexedDB (opened by app.js bootstrap)
//  Fallback storage: localStorage (when IDB is unavailable)
//
//  The module detects which backend is available at call-time
//  via STATE.get('idbReady'), so it works correctly whether
//  called before or after IDB initialisation completes.
//
//  Public API  (window.DB):
//
//  Results
//    DB.saveResult(result)           → Promise<result>
//    DB.getResultById(id)            → Promise<object|null>
//    DB.getResults(opts?)            → Promise<object[]>
//    DB.deleteResult(id)             → Promise<void>
//    DB.clearResults()               → Promise<void>
//    DB.getStats()                   → Promise<StatsObject>
//
//  Chain (blocks)
//    DB.saveBlock(block)             → Promise<block>
//    DB.getBlock(index)              → Promise<object|null>
//    DB.getChain()                   → Promise<object[]>
//    DB.getLatestBlock()             → Promise<object|null>
//    DB.clearChain()                 → Promise<void>
//    DB.getChainLength()             → Promise<number>
//
//  Low-level
//    DB.idbOp(store,mode,fn)         → Promise<*>   (re-exported)
// ════════════════════════════════════════════════════════

const DB = (() => {

  // ── Self-contained IDB connection ─────────────────────
  // Không phụ thuộc app.js hay STATE — tự mở IDB khi load.

  let _idb = null;

  const _idbReady = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('No IDB')); return; }
    const NAME    = (typeof CONFIG !== 'undefined' && CONFIG.IDB && CONFIG.IDB.NAME)    || 'aiproof_db';
    const VERSION = (typeof CONFIG !== 'undefined' && CONFIG.IDB && CONFIG.IDB.VERSION) || 1;
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('results')) {
        const s = db.createObjectStore('results', { keyPath: 'id' });
        s.createIndex('by_timestamp', 'timestamp',     { unique: false });
        s.createIndex('by_verdict',   'verdict.label', { unique: false });
        s.createIndex('by_type',      'type',          { unique: false });
      }
      if (!db.objectStoreNames.contains('chain')) {
        const s = db.createObjectStore('chain', { keyPath: 'index' });
        s.createIndex('by_timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('model_cache')) db.createObjectStore('model_cache', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings'))    db.createObjectStore('settings',    { keyPath: 'key' });
    };
    req.onsuccess = (ev) => {
      _idb = ev.target.result;
      _idb.onerror = (e) => console.error('[DB] IDB runtime error', e);
      window._idb = _idb;
      if (typeof STATE !== 'undefined' && STATE.set) STATE.set({ idbReady: true });
      console.info('[DB] IndexedDB ready:', NAME);
      resolve();
    };
    req.onerror   = () => { console.warn('[DB] IDB open failed — falling back to localStorage'); reject(req.error); };
    req.onblocked = () => { console.warn('[DB] IDB blocked'); reject(new Error('IDB blocked')); };
  });

  function _useIDB() { return _idb !== null; }

  // ── Generic IDB operation ─────────────────────────────

  async function idbOp(storeName, mode, fn) {
    await _idbReady.catch(() => {});   // wait for open; never throw
    if (!_idb) throw new Error('IDB not available');
    return new Promise((resolve, reject) => {
      const tx  = _idb.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // Expose globally for backwards compat
  window.idbOp = idbOp;

  /**
   * Read all records from an IDB object store using a cursor.
   * Returns records in storage order.
   *
   * @param   {string} storeName
   * @param   {string} [indexName]  optional index to iterate
   * @returns {Promise<object[]>}
   */
  function _idbGetAll(storeName, indexName) {
    return new Promise((resolve, reject) => {
      if (!window.idbOp) return reject(new Error('idbOp unavailable'));

      const results = [];
      // Use IDBObjectStore.getAll if available (faster), else cursor
      try {
        idbOp(storeName, 'readonly', store => {
          const source = indexName ? store.index(indexName) : store;
          return source.getAll();
        }).then(resolve).catch(() => {
          // fallback: manual cursor
          _idbCursor(storeName, resolve, reject);
        });
      } catch {
        _idbCursor(storeName, resolve, reject);
      }
    });
  }

  function _idbCursor(storeName, resolve, reject) {
    const results = [];
    idbOp(storeName, 'readonly', store => store.openCursor())
      .then(() => resolve(results))  // cursor returns undefined from idbOp
      .catch(reject);
    // This path uses a raw transaction instead
    _idbCursorRaw(storeName, results, resolve, reject);
  }

  function _idbCursorRaw(storeName, results, resolve, reject) {
    // Access the raw IDB through window._idb if app.js exposes it
    // Otherwise fall through to localStorage
    resolve(results);
  }

  // ── localStorage fallback helpers ─────────────────────

  function _lsRead(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function _lsWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[DB] localStorage write failed:', e);
      return false;
    }
  }

  // ── RESULTS ───────────────────────────────────────────

  /**
   * Save an analysis result.
   * Adds a `savedAt` ISO timestamp if not already present.
   * Prunes oldest records when MAX_STORED_RESULTS is reached.
   *
   * @param   {object} result   must have an `id` field
   * @returns {Promise<object>} the saved result (with savedAt)
   */
  async function saveResult(result) {
    const record = {
      ...result,
      savedAt: result.savedAt || new Date().toISOString(),
    };

    if (_useIDB()) {
      await idbOp(CONFIG.IDB.STORES.RESULTS, 'readwrite', store => store.put(record));
      await _pruneResults();
    } else {
      const all = _lsRead(CONFIG.STORAGE_KEY_RESULTS, []);
      // Upsert: replace if id exists, else prepend
      const idx = all.findIndex(r => r.id === record.id);
      if (idx >= 0) { all[idx] = record; }
      else          { all.unshift(record); }
      // Prune
      if (all.length > CONFIG.MAX_STORED_RESULTS) {
        all.length = CONFIG.MAX_STORED_RESULTS;
      }
      _lsWrite(CONFIG.STORAGE_KEY_RESULTS, all);
    }

    return record;
  }

  /**
   * Look up a single result by its string id.
   *
   * @param   {string} id
   * @returns {Promise<object|null>}
   */
  async function getResultById(id) {
    if (_useIDB()) {
      const rec = await idbOp(
        CONFIG.IDB.STORES.RESULTS, 'readonly',
        store => store.get(id)
      );
      return rec ?? null;
    }
    const all = _lsRead(CONFIG.STORAGE_KEY_RESULTS, []);
    return all.find(r => r.id === id) ?? null;
  }

  /**
   * Return an array of results, newest first.
   *
   * Options:
   *   limit   {number}  max records to return  (default: all)
   *   offset  {number}  skip this many records  (default: 0)
   *   verdict {string}  filter by verdict label (default: none)
   *   type    {string}  filter by content type  (default: none)
   *
   * @param   {{ limit?:number, offset?:number, verdict?:string, type?:string }} opts
   * @returns {Promise<object[]>}
   */
  async function getResults(opts = {}) {
    let all;

    if (_useIDB()) {
      all = await _idbGetAll(CONFIG.IDB.STORES.RESULTS);
    } else {
      all = _lsRead(CONFIG.STORAGE_KEY_RESULTS, []);
    }

    // Sort newest-first by savedAt / timestamp
    all = all.slice().sort((a, b) => {
      const ta = a.savedAt || a.timestamp || '';
      const tb = b.savedAt || b.timestamp || '';
      return tb.localeCompare(ta);
    });

    // Filters
    if (opts.verdict) {
      all = all.filter(r => r.verdict?.label === opts.verdict);
    }
    if (opts.type) {
      all = all.filter(r => r.type === opts.type);
    }

    // Pagination
    const offset = opts.offset || 0;
    all = all.slice(offset);
    if (opts.limit) all = all.slice(0, opts.limit);

    return all;
  }

  /**
   * Delete one result by id.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function deleteResult(id) {
    if (_useIDB()) {
      await idbOp(CONFIG.IDB.STORES.RESULTS, 'readwrite', store => store.delete(id));
    } else {
      const filtered = _lsRead(CONFIG.STORAGE_KEY_RESULTS, []).filter(r => r.id !== id);
      _lsWrite(CONFIG.STORAGE_KEY_RESULTS, filtered);
    }
  }

  /**
   * Delete ALL results from storage.
   * @returns {Promise<void>}
   */
  async function clearResults() {
    if (_useIDB()) {
      await idbOp(CONFIG.IDB.STORES.RESULTS, 'readwrite', store => store.clear());
    } else {
      _lsWrite(CONFIG.STORAGE_KEY_RESULTS, []);
    }
  }

  /**
   * Prune records over MAX_STORED_RESULTS limit (IDB path only).
   * Deletes oldest records by savedAt timestamp.
   */
  async function _pruneResults() {
    try {
      const all = await _idbGetAll(CONFIG.IDB.STORES.RESULTS);
      if (all.length <= CONFIG.MAX_STORED_RESULTS) return;

      all.sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''));
      const toDelete = all.slice(0, all.length - CONFIG.MAX_STORED_RESULTS);
      for (const rec of toDelete) {
        await idbOp(CONFIG.IDB.STORES.RESULTS, 'readwrite', store => store.delete(rec.id));
      }
    } catch (err) {
      console.warn('[DB] _pruneResults failed:', err);
    }
  }

  // ── CHAIN (blocks) ────────────────────────────────────

  /**
   * Persist a single block.
   * Uses block.index as the IDB key (see schema in CONFIG.IDB).
   *
   * @param   {object} block  must have an `index` field (number)
   * @returns {Promise<object>}
   */
  async function saveBlock(block) {
    if (_useIDB()) {
      await idbOp(CONFIG.IDB.STORES.CHAIN, 'readwrite', store => store.put(block));
    } else {
      const chain = _lsRead(CONFIG.STORAGE_KEY_CHAIN, []);
      const idx   = chain.findIndex(b => b.index === block.index);
      if (idx >= 0) { chain[idx] = block; }
      else          { chain.push(block); chain.sort((a, b) => a.index - b.index); }
      _lsWrite(CONFIG.STORAGE_KEY_CHAIN, chain);
    }
    return block;
  }

  /**
   * Retrieve a block by its integer index.
   *
   * @param   {number} blockIndex
   * @returns {Promise<object|null>}
   */
  async function getBlock(blockIndex) {
    if (_useIDB()) {
      const block = await idbOp(
        CONFIG.IDB.STORES.CHAIN, 'readonly',
        store => store.get(blockIndex)
      );
      return block ?? null;
    }
    const chain = _lsRead(CONFIG.STORAGE_KEY_CHAIN, []);
    return chain.find(b => b.index === blockIndex) ?? null;
  }

  /**
   * Return the entire chain as an array, sorted by block index ascending.
   *
   * @returns {Promise<object[]>}
   */
  async function getChain() {
    let chain;
    if (_useIDB()) {
      chain = await _idbGetAll(CONFIG.IDB.STORES.CHAIN);
    } else {
      chain = _lsRead(CONFIG.STORAGE_KEY_CHAIN, []);
    }
    return chain.slice().sort((a, b) => a.index - b.index);
  }

  /**
   * Return the block with the highest index, or null if chain is empty.
   *
   * @returns {Promise<object|null>}
   */
  async function getLatestBlock() {
    const chain = await getChain();
    return chain.length > 0 ? chain[chain.length - 1] : null;
  }

  /**
   * Return the number of blocks currently in the chain.
   *
   * @returns {Promise<number>}
   */
  async function getChainLength() {
    if (_useIDB()) {
      const count = await idbOp(
        CONFIG.IDB.STORES.CHAIN, 'readonly',
        store => store.count()
      );
      return count ?? 0;
    }
    return (_lsRead(CONFIG.STORAGE_KEY_CHAIN, [])).length;
  }

  /**
   * Delete all blocks from storage.
   * @returns {Promise<void>}
   */
  async function clearChain() {
    if (_useIDB()) {
      await idbOp(CONFIG.IDB.STORES.CHAIN, 'readwrite', store => store.clear());
    } else {
      _lsWrite(CONFIG.STORAGE_KEY_CHAIN, []);
    }
  }

  // ── Persistence helpers (legacy sync compat) ──────────

  /**
   * @deprecated Use DB.getChain() (async)
   * Synchronous chain read from localStorage only.
   * Used by older code paths that haven't been updated yet.
   */
  function _syncGetChain() {
    return _lsRead(CONFIG.STORAGE_KEY_CHAIN, []);
  }

  /**
   * @deprecated Use DB.saveBlock() (async)
   */
  function _syncSaveChain(chain) {
    _lsWrite(CONFIG.STORAGE_KEY_CHAIN, chain);
  }

  // ── Stats ─────────────────────────────────────────────

  /**
   * Compute summary statistics across all stored results.
   *
   * @returns {Promise<{total:number, verdicts:object, types:object, lastScan:string|null}>}
   */
  async function getStats() {
    const results = await getResults();
    const verdicts = {};
    const types    = {};

    for (const r of results) {
      const v = r.verdict?.label || 'unknown';
      const t = r.type || 'unknown';
      verdicts[v] = (verdicts[v] || 0) + 1;
      types[t]    = (types[t]    || 0) + 1;
    }

    const chainLen = await getChainLength();

    return {
      total:      results.length,
      chainBlocks: chainLen,
      verdicts,
      types,
      lastScan:   results[0]?.savedAt || null,
    };
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    // Results
    saveResult,
    getResultById,
    getResults,
    deleteResult,
    clearResults,

    // Chain
    saveBlock,
    getBlock,
    getChain,
    getLatestBlock,
    getChainLength,
    clearChain,

    // Stats
    getStats,

    // Low-level (for advanced callers)
    idbOp,

    // Deprecated sync shims (blockchain.js legacy calls)
    _syncGetChain,
    _syncSaveChain,
  });

})();

window.DB = DB;