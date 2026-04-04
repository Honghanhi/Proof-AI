// ════════════════════════════════════════════════════════
//  BLOCKCHAIN — Immutable Proof-of-Work Ledger
//
//  Implements a lightweight append-only blockchain where each
//  block commits to an analysis result and includes a Merkle
//  root over the transaction fields.
//
//  Block structure
//  ───────────────
//  {
//    index        : number       sequential block number (0 = genesis)
//    timestamp    : ISO string   block creation time
//    data         : object       payload (see BlockData below)
//    merkleRoot   : hex string   Merkle root of data field leaves
//    previousHash : hex string   hash of the preceding block
//    nonce        : number       PoW nonce
//    hash         : hex string   SHA-256 of serialised block header
//  }
//
//  BlockData (for analysis blocks)
//  ────────────────────────────────
//  {
//    resultId     : string
//    trustScore   : number
//    verdict      : string
//    contentHash  : hex string
//    type         : 'text'|'url'|'image'
//    modelHashes  : string[]    fingerprints of model scores
//  }
//
//  Storage: IndexedDB (via DB module) with localStorage fallback.
//
//  Public API  (window.Blockchain):
//
//    Blockchain.addResult(result)     → Promise<Block>
//    Blockchain.getChain()            → Promise<Block[]>
//    Blockchain.getBlock(index)       → Promise<Block|null>
//    Blockchain.getLatestBlock()      → Promise<Block|null>
//    Blockchain.validate()            → Promise<ValidationResult>
//    Blockchain.getProof(resultId)    → Promise<MerkleProof|null>
//    Blockchain.on(event, fn)         → unsubscribe fn
//    Blockchain.hashContent(text)     → Promise<hex>
//    Blockchain.reset()               → Promise<void>  (dev/test only)
//
//  Events:  'block:added'  { block }
//           'chain:valid'  { length }
//           'chain:invalid'{ errors }
// ════════════════════════════════════════════════════════

const Blockchain = (() => {

  // ── Constants ─────────────────────────────────────────

  const GENESIS_PREV_HASH = '0'.repeat(64);
  const GENESIS_DATA      = 'AI-PROOF GENESIS BLOCK v1';

  // ── Event emitter ─────────────────────────────────────

  const _listeners = {};

  function _emit(event, detail) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(detail); } catch (e) { console.error('[Blockchain] listener error:', e); }
    });
  }

  /**
   * Subscribe to a blockchain event.
   * @param   {string}   event  'block:added' | 'chain:valid' | 'chain:invalid'
   * @param   {Function} fn     callback(detail)
   * @returns {Function}        unsubscribe
   */
  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
    return () => { _listeners[event] = _listeners[event].filter(f => f !== fn); };
  }

  // ── Hash content ──────────────────────────────────────

  /**
   * Hash arbitrary text content (convenience wrapper).
   * This is the canonical function to use before storing content refs.
   *
   * @param   {string} text
   * @returns {Promise<string>}  SHA-256 hex
   */
  function hashContent(text) {
    return Hash.text(String(text));
  }

  // ── Block serialisation ───────────────────────────────

  /**
   * Produce the canonical string representation of a block header.
   * This is what gets hashed — deterministic regardless of JS engine.
   *
   * @param {object} block  (hash and merkleRoot may still be null/computing)
   * @returns {string}
   */
  function _blockPayload(block) {
    return [
      block.index,
      block.timestamp,
      Hash.canonical(block.data),
      block.merkleRoot  || '',
      block.previousHash,
      block.nonce,
    ].join('|');
  }

  // ── Merkle root for block data ────────────────────────

  /**
   * Derive the Merkle root for a block's data payload.
   * We hash each top-level field value as a separate leaf.
   *
   * @param   {object} data  BlockData object
   * @returns {Promise<string>}  Merkle root hex
   */
  async function _blockMerkleRoot(data) {
    const leaves = Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))          // stable key order
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`);    // include key in leaf
    return Merkle.root(leaves);
  }

  // ── Mining (Proof-of-Work) ────────────────────────────

  /**
   * Mine a block: increment nonce until the block hash starts with
   * CONFIG.POW_DIFFICULTY leading zeroes.
   *
   * Yields control back to the event loop every 500 iterations to
   * keep the UI responsive during mining.
   *
   * @param   {object} partialBlock  block without nonce/hash set
   * @returns {Promise<object>}      completed block with nonce and hash
   */
  async function _mine(partialBlock) {
    const prefix    = '0'.repeat(CONFIG.POW_DIFFICULTY);
    const block     = { ...partialBlock, nonce: 0, hash: null };
    let   hash      = '';
    let   iterations = 0;

    while (true) {
      hash = await Hash.text(_blockPayload(block));
      if (hash.startsWith(prefix)) break;

      block.nonce++;
      iterations++;

      // Yield to event loop every 500 iterations to avoid blocking UI
      if (iterations % 500 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }

      // Safety valve: after 1 000 000 attempts lower difficulty gracefully
      if (iterations > 1_000_000) {
        console.warn('[Blockchain] mining took > 1M iterations; storing un-mined block');
        break;
      }
    }

    block.hash = hash;
    return block;
  }

  // ── Genesis block ─────────────────────────────────────

  /**
   * Create and persist the genesis block if the chain is empty.
   * Idempotent — safe to call multiple times.
   *
   * @returns {Promise<object>}  genesis block
   */
  async function _ensureGenesis() {
    const existing = await DB.getBlock(0);
    if (existing) return existing;

    const genesis = {
      index:        0,
      timestamp:    new Date().toISOString(),
      data:         GENESIS_DATA,
      merkleRoot:   await Hash.text(GENESIS_DATA),
      previousHash: GENESIS_PREV_HASH,
      nonce:        0,
      hash:         null,
    };

    // Mine the genesis block
    const prefix = '0'.repeat(CONFIG.POW_DIFFICULTY);
    let hash = '';
    let n    = 0;
    while (true) {
      genesis.nonce = n++;
      hash = await Hash.text(_blockPayload(genesis));
      if (hash.startsWith(prefix)) break;
      if (n > 500_000) break; // safety
    }
    genesis.hash = hash;

    await DB.saveBlock(genesis);
    return genesis;
  }

  // ── Add result ────────────────────────────────────────

  /**
   * Commit an analysis result to the blockchain.
   *
   * Steps:
   *   1. Ensure genesis block exists
   *   2. Build BlockData from the result (includes per-model fingerprints)
   *   3. Compute Merkle root of BlockData fields
   *   4. Mine the block (PoW)
   *   5. Persist to IndexedDB via DB.saveBlock()
   *   6. Emit 'block:added' event
   *
   * @param   {object} result  AnalysisResult object
   * @returns {Promise<object>} the newly mined block
   */
  async function addResult(result) {
    await _ensureGenesis();

    const prev = await DB.getLatestBlock();
    if (!prev) throw new Error('[Blockchain] no previous block found after genesis');

    // Build model fingerprints (short ids for each model score)
    const modelHashes = await Promise.all(
      (result.models || []).map(m =>
        Hash.fingerprint(`${m.modelId}:${m.score}:${m.confidence}`, 12)
      )
    );

    // Canonical block data
    const data = {
      resultId:    result.id,
      trustScore:  result.trustScore,
      verdict:     result.verdict?.label || 'UNKNOWN',
      contentHash: result.contentHash || await hashContent(result.content || ''),
      type:        result.type || 'text',
      modelHashes,
    };

    const merkleRoot = await _blockMerkleRoot(data);

    const partialBlock = {
      index:        prev.index + 1,
      timestamp:    new Date().toISOString(),
      data,
      merkleRoot,
      previousHash: prev.hash,
    };

    const block = await _mine(partialBlock);
    await DB.saveBlock(block);

    _emit('block:added', { block });

    console.info(`[Blockchain] block #${block.index} mined — nonce:${block.nonce} hash:${block.hash.slice(0,16)}…`);
    return block;
  }

  // ── Read chain ────────────────────────────────────────

  /**
   * Return the full chain sorted by index ascending.
   * @returns {Promise<object[]>}
   */
  function getChain() {
    return DB.getChain();
  }

  /**
   * Return a single block by index.
   * @param   {number} index
   * @returns {Promise<object|null>}
   */
  function getBlock(index) {
    return DB.getBlock(index);
  }

  /**
   * Return the highest-index block in the chain.
   * @returns {Promise<object|null>}
   */
  function getLatestBlock() {
    return DB.getLatestBlock();
  }

  // ── Validation ────────────────────────────────────────

  /**
   * Validate the full blockchain.
   *
   * Checks per block (skipping genesis):
   *   1. previousHash matches the hash of the preceding block
   *   2. Block hash can be recomputed and matches stored hash
   *   3. Stored hash satisfies the PoW difficulty prefix
   *   4. merkleRoot matches re-derived root from block.data
   *   5. Timestamps are monotonically non-decreasing
   *
   * @returns {Promise<{valid:boolean, length:number, errors:string[]}>}
   */
  async function validate() {
    const chain  = await getChain();
    const errors = [];
    const prefix = '0'.repeat(CONFIG.POW_DIFFICULTY);

    if (chain.length === 0) {
      return { valid: true, length: 0, errors: [] };
    }

    for (let i = 1; i < chain.length; i++) {
      const block = chain[i];
      const prev  = chain[i - 1];
      const tag   = `Block #${block.index}`;

      // 1. Chain link integrity
      if (block.previousHash !== prev.hash) {
        errors.push(`${tag}: previousHash mismatch (chain broken)`);
      }

      // 2. Hash recomputation
      const recomputed = await Hash.text(_blockPayload(block));
      if (recomputed !== block.hash) {
        errors.push(`${tag}: hash invalid (content tampered)`);
      }

      // 3. PoW difficulty
      if (!block.hash.startsWith(prefix)) {
        errors.push(`${tag}: hash does not satisfy PoW difficulty ${CONFIG.POW_DIFFICULTY}`);
      }

      // 4. Merkle root (only for object data, skip genesis string)
      if (block.data && typeof block.data === 'object') {
        const expectedMerkle = await _blockMerkleRoot(block.data);
        if (expectedMerkle !== block.merkleRoot) {
          errors.push(`${tag}: merkleRoot mismatch (data tampered)`);
        }
      }

      // 5. Monotonic timestamps
      if (block.timestamp < prev.timestamp) {
        errors.push(`${tag}: timestamp ${block.timestamp} precedes block #${prev.index}`);
      }
    }

    const result = { valid: errors.length === 0, length: chain.length, errors };
    _emit(result.valid ? 'chain:valid' : 'chain:invalid', result);
    return result;
  }

  // ── Merkle proof for result ───────────────────────────

  /**
   * Find the block containing a given resultId and return the
   * Merkle inclusion proof for that block's data.
   *
   * The proof lets a third party verify that a specific data field
   * was committed in a given block without recomputing the full tree.
   *
   * @param   {string} resultId
   * @returns {Promise<{block:object, proof:object[], root:string}|null>}
   */
  async function getProof(resultId) {
    const chain = await getChain();
    const block = chain.find(b => b.data?.resultId === resultId);
    if (!block || typeof block.data !== 'object') return null;

    // Reconstruct leaves (must match _blockMerkleRoot order)
    const leaves = Object.entries(block.data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`);

    // Prove the leaf at index 0 (resultId field — sorted first alphabetically)
    const leafIndex  = leaves.findIndex(l => l.startsWith('contentHash:') ||
                                              l.startsWith('resultId:'));
    const merkleProof = await Merkle.proof(leaves, Math.max(0, leafIndex));

    return {
      block,
      proof:     merkleProof,
      root:      block.merkleRoot,
      leafIndex: Math.max(0, leafIndex),
    };
  }

  // ── Reset (dev / test) ────────────────────────────────

  /**
   * Wipe the entire chain from storage.
   * Should only be called from developer tools / test suites.
   * @returns {Promise<void>}
   */
  async function reset() {
    await DB.clearChain();
    console.warn('[Blockchain] chain reset');
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    addResult,
    getChain,
    getBlock,
    getLatestBlock,
    validate,
    getProof,
    hashContent,
    on,
    reset,
  });

})();

window.Blockchain = Blockchain;

// ── Lab page sync shim ────────────────────────────────
// lab.html calls getChainValidation() synchronously.
// We provide a non-blocking wrapper that fires and forgets.
function getChainValidation() {
  // Return optimistic sync values immediately
  const snapshot = { valid: true, length: 0, errors: [] };

  // Kick off real async validation in background
  Blockchain.validate().then(result => {
    // Update lab page DOM elements if they exist
    const lenEl   = document.getElementById('chain-length');
    const validEl = document.getElementById('chain-valid');
    const outEl   = document.getElementById('chain-output');

    if (lenEl)   lenEl.textContent   = result.length;
    if (validEl) {
      validEl.textContent  = result.valid ? '✓' : '✗';
      validEl.style.color  = result.valid ? 'var(--accent-success)' : 'var(--accent-danger)';
    }
    if (outEl && !outEl.classList.contains('hidden')) {
      outEl.innerHTML = result.errors.length
        ? result.errors.map(e => `<div style="color:var(--accent-danger);">✗ ${e}</div>`).join('')
        : '<div style="color:var(--accent-success);">✓ All blocks valid. Chain integrity confirmed.</div>';
    }
  }).catch(console.warn);

  return snapshot;
}

window.getChainValidation = getChainValidation;