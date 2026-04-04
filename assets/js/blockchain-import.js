// ════════════════════════════════════════════════════════
//  BLOCKCHAIN-IMPORT — Chain & Result Import
//
//  Validates, verifies, and merges an export envelope produced
//  by blockchain-export.js before writing anything to storage.
//
//  Verification pipeline (executed before any write)
//  ──────────────────────────────────────────────────
//  1. Schema check      — envelope has required fields, known schema version
//  2. Type guards       — chain is array of objects, results is array of objects
//  3. Block structure   — each block has index, hash, previousHash, timestamp
//  4. Checksum verify   — recompute SHA-256 over payload; compare to stored
//  5. Chain integrity   — previousHash links match, block hashes match
//  6. Genesis check     — block[0].index === 0
//  7. Preview modal     — show diff stats before asking user to confirm
//  8. Conflict analysis — classify each incoming record as NEW / DUPLICATE / CONFLICT
//  9. Merge / replace   — write only after user confirmation
//
//  Public API (window.ChainImport):
//
//    ChainImport.importFromFile(opts?)    → Promise<ImportResult>  open picker
//    ChainImport.importFromEnvelope(env)  → Promise<ImportResult>  programmatic
//    ChainImport.verify(envelope)         → Promise<VerifyResult>  check-only
//    ChainImport.preview(envelope)        → Promise<PreviewResult> dry-run diff
//
//  ImportResult:
//  {
//    ok           : boolean
//    newBlocks    : number
//    newResults   : number
//    skipped      : number
//    conflicts    : number
//    chainStrategy: 'merged'|'replaced'|'skipped'
//    errors       : string[]
//  }
//
//  Backwards-compat globals:
//    importTimeline()   → delegates to ChainImport.importFromFile()
// ════════════════════════════════════════════════════════

const ChainImport = (() => {

  const SUPPORTED_SCHEMAS = ['aiproof-export-v2', 'aiproof-export-v1'];

  // ── Validation helpers ────────────────────────────────

  /**
   * Assert a condition; throw a descriptive ImportError if false.
   * @param {boolean} cond
   * @param {string}  msg
   */
  function _assert(cond, msg) {
    if (!cond) throw new ImportError(msg);
  }

  class ImportError extends Error {
    constructor(msg) { super(msg); this.name = 'ImportError'; }
  }

  // ── Schema & structure validation ─────────────────────

  /**
   * Validate the top-level envelope shape.
   * Returns an array of human-readable error strings (empty = valid).
   *
   * @param   {*} raw  parsed JSON
   * @returns {string[]}
   */
  function _validateSchema(raw) {
    const errors = [];

    if (!raw || typeof raw !== 'object') {
      return ['File does not contain a JSON object'];
    }

    // Schema version
    if (!raw.schema) {
      errors.push('Missing "schema" field — this may be an old-format export');
    } else if (!SUPPORTED_SCHEMAS.includes(raw.schema)) {
      errors.push(`Unknown schema version "${raw.schema}". Supported: ${SUPPORTED_SCHEMAS.join(', ')}`);
    }

    // Required top-level fields
    for (const field of ['chain', 'results', 'checksum']) {
      if (!(field in raw)) errors.push(`Missing required field: "${field}"`);
    }

    // chain must be an array
    if ('chain' in raw && !Array.isArray(raw.chain)) {
      errors.push('"chain" must be an array');
    }

    // results must be an array
    if ('results' in raw && !Array.isArray(raw.results)) {
      errors.push('"results" must be an array');
    }

    // manifest (v2 only)
    if (raw.schema === 'aiproof-export-v2') {
      if (!raw.manifest || typeof raw.manifest !== 'object') {
        errors.push('Missing "manifest" block (required for v2 schema)');
      } else {
        for (const k of ['blocks', 'results', 'chainRoot', 'resultsRoot']) {
          if (!(k in raw.manifest)) {
            errors.push(`manifest.${k} is missing`);
          }
        }
      }
    }

    return errors;
  }

  /**
   * Validate the structure of individual block objects.
   * Checks required fields; does NOT recompute hashes (that's done
   * later in the chain-integrity step).
   *
   * @param   {object[]} chain
   * @returns {string[]}  errors
   */
  function _validateBlocks(chain) {
    const errors = [];
    const REQUIRED = ['index', 'timestamp', 'previousHash', 'hash', 'nonce'];

    chain.forEach((block, i) => {
      if (!block || typeof block !== 'object') {
        errors.push(`chain[${i}] is not an object`);
        return;
      }
      for (const field of REQUIRED) {
        if (!(field in block)) {
          errors.push(`chain[${i}] missing field: "${field}"`);
        }
      }
      if (typeof block.index !== 'number') {
        errors.push(`chain[${i}].index must be a number`);
      }
    });

    // Genesis block must be index 0
    if (chain.length > 0 && chain[0].index !== 0) {
      errors.push(`chain[0].index is ${chain[0].index}, expected 0 (genesis)`);
    }

    // Indices must be sequential
    chain.forEach((block, i) => {
      if (i > 0 && block.index !== chain[i - 1].index + 1) {
        errors.push(`chain[${i}].index ${block.index} is not sequential (expected ${chain[i - 1].index + 1})`);
      }
    });

    return errors;
  }

  /**
   * Validate the structure of individual result objects.
   * @param   {object[]} results
   * @returns {string[]}
   */
  function _validateResults(results) {
    const errors = [];
    results.forEach((r, i) => {
      if (!r || typeof r !== 'object') {
        errors.push(`results[${i}] is not an object`);
        return;
      }
      if (!r.id || typeof r.id !== 'string') {
        errors.push(`results[${i}] missing string "id" field`);
      }
      if (!r.trustScore && r.trustScore !== 0) {
        errors.push(`results[${i}] missing "trustScore"`);
      }
    });
    return errors;
  }

  // ── Checksum verification ─────────────────────────────

  /**
   * Recompute the envelope checksum and compare it to the stored value.
   * Uses the same algorithm as ChainExport.computeChecksum().
   *
   * @param   {object} envelope
   * @returns {Promise<{ valid:boolean, stored:string, computed:string }>}
   */
  async function _verifyChecksum(envelope) {
    const stored = envelope.checksum || '';

    // Recompute — must match ChainExport.computeChecksum() exactly
    const payload = {
      chain:    envelope.chain    || [],
      results:  envelope.results  || [],
      manifest: envelope.manifest || {},
    };
    const computed = await Hash.object(payload);

    return {
      valid:    computed === stored,
      stored:   stored.slice(0, 16) + '…',
      computed: computed.slice(0, 16) + '…',
      full:     computed,
    };
  }

  // ── Chain integrity check ─────────────────────────────

  /**
   * Re-derive each block's hash and verify previousHash links.
   * Mirrors the logic in Blockchain.validate() but operates on
   * an arbitrary array rather than the live DB chain.
   *
   * Only checks structural links — not PoW difficulty —
   * because re-mining on import would be prohibitively slow.
   *
   * @param   {object[]} chain
   * @returns {Promise<{ valid:boolean, errors:string[] }>}
   */
  async function _verifyChainIntegrity(chain) {
    const errors = [];
    if (chain.length <= 1) return { valid: true, errors };

    for (let i = 1; i < chain.length; i++) {
      const block = chain[i];
      const prev  = chain[i - 1];

      // previousHash link
      if (block.previousHash !== prev.hash) {
        errors.push(`Block #${block.index}: broken link — previousHash does not match block #${prev.index} hash`);
      }

      // Re-derive hash using the same payload format as blockchain.js
      try {
        const payload = [
          block.index,
          block.timestamp,
          Hash.canonical(block.data),
          block.merkleRoot  || '',
          block.previousHash,
          block.nonce,
        ].join('|');

        const recomputed = await Hash.text(payload);
        if (recomputed !== block.hash) {
          errors.push(`Block #${block.index}: hash mismatch — content may have been tampered`);
        }
      } catch {
        errors.push(`Block #${block.index}: could not recompute hash`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Full verify ───────────────────────────────────────

  /**
   * Run all verification checks on an envelope.
   * Does not write to storage.
   *
   * @param   {object} envelope
   * @returns {Promise<VerifyResult>}
   */
  async function verify(envelope) {
    const errors  = [];

    // 1. Schema + structure
    const schemaErrors = _validateSchema(envelope);
    if (schemaErrors.length) {
      return { valid: false, stage: 'schema', errors: schemaErrors,
               checksum: null, chainIntegrity: null };
    }

    // 2. Block structure
    const blockErrors = _validateBlocks(envelope.chain);
    errors.push(...blockErrors);

    // 3. Result structure
    const resultErrors = _validateResults(envelope.results);
    errors.push(...resultErrors);

    // 4. Checksum
    const checksumResult = await _verifyChecksum(envelope);
    if (!checksumResult.valid) {
      errors.push(
        `Checksum mismatch — file may be corrupted or tampered. ` +
        `Expected ${checksumResult.stored}, got ${checksumResult.computed}`
      );
    }

    // 5. Chain integrity (only if block structure is valid)
    let chainIntegrity = { valid: true, errors: [] };
    if (blockErrors.length === 0 && envelope.chain.length > 1) {
      chainIntegrity = await _verifyChainIntegrity(envelope.chain);
      errors.push(...chainIntegrity.errors);
    }

    return {
      valid:         errors.length === 0,
      stage:         errors.length > 0 ? 'content' : 'ok',
      errors,
      checksum:      checksumResult,
      chainIntegrity,
    };
  }

  // ── Preview / dry-run ─────────────────────────────────

  /**
   * Compute a diff between the incoming envelope and local storage.
   * Returns stats about what would change — no writes occur.
   *
   * @param   {object} envelope
   * @returns {Promise<PreviewResult>}
   */
  async function preview(envelope) {
    const [localChain, localResults] = await Promise.all([
      DB.getChain(),
      DB.getResults(),
    ]);

    const localResultIds = new Set(localResults.map(r => r.id));
    const localBlockIdxs = new Set(localChain.map(b => b.index));

    // Classify incoming results
    const incoming      = envelope.results || [];
    const incomingChain = envelope.chain   || [];

    const newResults       = incoming.filter(r => !localResultIds.has(r.id));
    const duplicateResults = incoming.filter(r =>  localResultIds.has(r.id));

    // Conflicts: same id, different trustScore or content
    const conflicts = duplicateResults.filter(r => {
      const local = localResults.find(lr => lr.id === r.id);
      return local && (
        local.trustScore !== r.trustScore ||
        local.contentHash !== r.contentHash
      );
    });

    // Chain: count blocks the local chain doesn't have
    const newBlocks = incomingChain.filter(b => !localBlockIdxs.has(b.index));

    // Chain strategy
    let chainStrategy;
    if (incomingChain.length === 0) {
      chainStrategy = 'skipped';
    } else if (incomingChain.length > localChain.length) {
      chainStrategy = 'replaced';
    } else {
      chainStrategy = 'merged';
    }

    return {
      newResults:     newResults.length,
      duplicates:     duplicateResults.length - conflicts.length,
      conflicts:      conflicts.length,
      newBlocks:      newBlocks.length,
      chainStrategy,
      incomingBlocks: incomingChain.length,
      incomingResults: incoming.length,
      localBlocks:    localChain.length,
      localResults:   localResults.length,
      conflictDetails: conflicts.slice(0, 5).map(r => ({
        id:     r.id,
        reason: `trustScore: ${localResults.find(l=>l.id===r.id)?.trustScore} → ${r.trustScore}`,
      })),
    };
  }

  // ── Confirmation modal ────────────────────────────────

  /**
   * Render a styled confirmation dialog showing the preview diff.
   * Resolves true if user confirms, false if cancelled.
   *
   * @param   {VerifyResult}  verifyResult
   * @param   {PreviewResult} previewResult
   * @param   {object}        envelope
   * @returns {Promise<boolean>}
   */
  function _showConfirmDialog(verifyResult, previewResult, envelope) {
    return new Promise((resolve) => {

      // Build inner HTML
      const schemaTag  = envelope.schema || 'unknown';
      const exportDate = envelope.exportedAt
        ? new Date(envelope.exportedAt).toLocaleString()
        : 'unknown';
      const checksumOk = verifyResult.checksum?.valid;
      const chainOk    = verifyResult.chainIntegrity?.valid;

      const checksumBadge = checksumOk
        ? `<span style="color:var(--accent-success);">✓ Checksum verified</span>`
        : `<span style="color:var(--accent-danger);">✗ Checksum FAILED</span>`;

      const chainBadge = chainOk
        ? `<span style="color:var(--accent-success);">✓ Chain integrity OK</span>`
        : `<span style="color:var(--accent-danger);">✗ Chain integrity errors</span>`;

      const conflictWarning = previewResult.conflicts > 0
        ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(255,170,0,0.1);
               border-left:3px solid var(--accent-warn);border-radius:4px;font-size:0.78rem;">
             ⚠ ${previewResult.conflicts} conflict(s) — incoming versions will overwrite local data.
           </div>`
        : '';

      const errorList = verifyResult.errors.length
        ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(255,77,77,0.08);
               border-left:3px solid var(--accent-danger);border-radius:4px;font-size:0.75rem;
               max-height:80px;overflow:auto;">
             ${verifyResult.errors.map(e => `<div>• ${_esc(e)}</div>`).join('')}
           </div>`
        : '';

      const html = `
        <div id="import-overlay" style="
          position:fixed;inset:0;z-index:10000;
          background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
          display:flex;align-items:center;justify-content:center;
          animation:fadeIn 0.2s ease;
        ">
          <div style="
            background:var(--bg-panel,#111827);
            border:1px solid rgba(0,229,255,0.25);
            border-radius:12px;padding:28px 32px;
            max-width:520px;width:90%;
            box-shadow:0 8px 48px rgba(0,0,0,0.6);
            font-family:var(--font-body,sans-serif);
          ">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
              <span style="font-size:1.4rem;">📦</span>
              <h2 style="margin:0;font-size:1.05rem;color:var(--text-primary,#f0f0f0);
                          font-family:var(--font-display,monospace);">
                IMPORT PREVIEW
              </h2>
            </div>

            <!-- Meta row -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;
                         margin-bottom:16px;font-size:0.75rem;color:var(--text-secondary,#aaa);">
              <div>Schema: <b style="color:var(--accent-primary)">${_esc(schemaTag)}</b></div>
              <div>Exported: <b>${_esc(exportDate)}</b></div>
              <div>${checksumBadge}</div>
              <div>${chainBadge}</div>
            </div>

            <!-- Diff table -->
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;margin-bottom:4px;">
              <thead>
                <tr style="color:var(--text-muted,#666);font-size:0.68rem;text-transform:uppercase;letter-spacing:.05em;">
                  <th style="text-align:left;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.07);">Category</th>
                  <th style="text-align:right;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.07);">Incoming</th>
                  <th style="text-align:right;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.07);">Local</th>
                  <th style="text-align:right;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.07);">Action</th>
                </tr>
              </thead>
              <tbody>
                ${_row('Blocks', previewResult.incomingBlocks, previewResult.localBlocks,
                         previewResult.chainStrategy === 'replaced'
                           ? '<span style="color:var(--accent-warn)">replace</span>'
                           : previewResult.chainStrategy === 'merged'
                             ? `<span style="color:var(--accent-success)">+${previewResult.newBlocks}</span>`
                             : '<span style="color:var(--text-muted)">skip</span>')}
                ${_row('Results', previewResult.incomingResults, previewResult.localResults,
                         `<span style="color:var(--accent-success)">+${previewResult.newResults} new</span>`)}
                ${_row('Duplicates', previewResult.duplicates, '—',
                         `<span style="color:var(--text-muted)">skip</span>`)}
                ${previewResult.conflicts > 0
                  ? _row('Conflicts', previewResult.conflicts, '—',
                           `<span style="color:var(--accent-warn)">overwrite</span>`)
                  : ''}
              </tbody>
            </table>

            ${conflictWarning}
            ${errorList}

            <!-- Action buttons -->
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
              <button id="import-cancel" style="
                padding:8px 20px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);
                background:transparent;color:var(--text-secondary,#aaa);
                cursor:pointer;font-size:0.85rem;
              ">Cancel</button>
              <button id="import-confirm" style="
                padding:8px 20px;border-radius:6px;border:none;
                background:var(--accent-primary,#00e5ff);
                color:#000;cursor:pointer;font-size:0.85rem;font-weight:700;
                ${verifyResult.checksum && !verifyResult.checksum.valid
                  ? 'background:var(--accent-danger);'
                  : ''}
              ">
                ${!checksumOk ? '⚠ Import Anyway' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container);

      const overlay = document.getElementById('import-overlay');
      const close   = (result) => {
        overlay.style.animation = 'fadeIn 0.15s ease reverse both';
        setTimeout(() => { container.remove(); resolve(result); }, 160);
      };

      document.getElementById('import-confirm').onclick = () => close(true);
      document.getElementById('import-cancel' ).onclick = () => close(false);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    });
  }

  /** Simple HTML table row helper */
  function _row(label, incoming, local, action) {
    return `
      <tr style="color:var(--text-primary,#eee);">
        <td style="padding:5px 0;">${label}</td>
        <td style="text-align:right;padding:5px 0;">${incoming}</td>
        <td style="text-align:right;padding:5px 0;">${local}</td>
        <td style="text-align:right;padding:5px 0;">${action}</td>
      </tr>
    `;
  }

  /** Minimal HTML escaper for user-controlled strings */
  function _esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Merge logic ───────────────────────────────────────

  /**
   * Write the import payload into local storage.
   * Handles IDB and localStorage backends transparently via DB module.
   *
   * Strategy:
   *   Results — upsert (new IDs added, conflicts overwrite local)
   *   Chain   — replaced if incoming is longer, otherwise merge new blocks
   *
   * @param   {object}        envelope
   * @param   {PreviewResult} previewData
   * @returns {Promise<ImportResult>}
   */
  async function _merge(envelope, previewData) {
    const incoming        = envelope.results || [];
    const incomingChain   = envelope.chain   || [];
    const [localResults]  = await Promise.all([DB.getResults()]);

    const localMap = new Map(localResults.map(r => [r.id, r]));
    let   newCount = 0, overwriteCount = 0;

    // ── Results ──
    for (const result of incoming) {
      const existing = localMap.get(result.id);
      if (!existing) {
        await DB.saveResult(result);
        newCount++;
      } else {
        // Conflict: incoming overwrites if trustScore differs
        const isConflict = existing.trustScore !== result.trustScore;
        if (isConflict) {
          await DB.saveResult({ ...result, savedAt: result.savedAt || existing.savedAt });
          overwriteCount++;
        }
        // Pure duplicate (same id + same trustScore) — skip silently
      }
    }

    // ── Chain ──
    const localChain = await DB.getChain();
    let   chainStrategy, newBlockCount = 0;

    if (incomingChain.length === 0) {
      chainStrategy = 'skipped';

    } else if (incomingChain.length > localChain.length) {
      // Incoming chain is longer — replace entirely (more canonical history)
      for (const block of incomingChain) {
        await DB.saveBlock(block);
      }
      chainStrategy  = 'replaced';
      newBlockCount  = incomingChain.length;

    } else {
      // Merge: add blocks the local chain is missing
      const localIdxSet = new Set(localChain.map(b => b.index));
      const missing     = incomingChain.filter(b => !localIdxSet.has(b.index));
      for (const block of missing) {
        await DB.saveBlock(block);
        newBlockCount++;
      }
      chainStrategy = newBlockCount > 0 ? 'merged' : 'skipped';
    }

    return {
      ok:            true,
      newResults:    newCount,
      newBlocks:     newBlockCount,
      skipped:       incoming.length - newCount - overwriteCount,
      conflicts:     overwriteCount,
      chainStrategy,
      errors:        [],
    };
  }

  // ── Status helpers ────────────────────────────────────

  function _status(msg, type = 'info') {
    if (typeof UI !== 'undefined' && UI.toast) {
      UI.toast(msg, type, type === 'info' ? 1500 : 3500);
    } else {
      console.info('[ChainImport]', msg);
    }
  }

  // ── importFromEnvelope ────────────────────────────────

  /**
   * Programmatic import from a parsed envelope object.
   *
   * Runs the full verification pipeline, shows the preview dialog,
   * and writes to storage only after user confirmation.
   *
   * @param   {object} envelope
   * @param   {object} [opts]
   * @param   {boolean} [opts.skipDialog=false]  bypass UI (for automated tests)
   * @param   {boolean} [opts.skipChecksumFail=false]  allow broken checksum
   * @returns {Promise<ImportResult>}
   */
  async function importFromEnvelope(envelope, opts = {}) {
    _status('Verifying import file…');

    // Step 1: Full verification
    let verifyResult;
    try {
      verifyResult = await verify(envelope);
    } catch (err) {
      _status('Verification error: ' + err.message, 'error');
      return { ok: false, errors: [err.message] };
    }

    // Hard-stop schema errors — file is unreadable
    if (verifyResult.stage === 'schema') {
      _status('Invalid file format: ' + verifyResult.errors[0], 'error');
      return { ok: false, errors: verifyResult.errors };
    }

    // Warn but allow continue if only checksum failed and option set
    if (!verifyResult.valid && !opts.skipChecksumFail) {
      if (verifyResult.errors.some(e => e.includes('Checksum'))) {
        console.warn('[ChainImport] checksum failed — proceeding to dialog for user decision');
      }
    }

    // Step 2: Preview diff
    let previewResult;
    try {
      previewResult = await preview(envelope);
    } catch (err) {
      previewResult = {
        newResults: 0, duplicates: 0, conflicts: 0, newBlocks: 0,
        chainStrategy: 'skipped', incomingBlocks: 0, incomingResults: 0,
        localBlocks: 0, localResults: 0, conflictDetails: [],
      };
    }

    // Step 3: Confirmation dialog (unless bypassed)
    if (!opts.skipDialog) {
      const confirmed = await _showConfirmDialog(verifyResult, previewResult, envelope);
      if (!confirmed) {
        _status('Import cancelled.', 'info');
        return { ok: false, cancelled: true, errors: [] };
      }
    }

    // Step 4: Merge
    _status('Importing data…');
    try {
      const result = await _merge(envelope, previewResult);
      _status(
        `Imported: +${result.newResults} results, +${result.newBlocks} blocks` +
        (result.conflicts > 0 ? `, ${result.conflicts} overwritten` : '') + ' ✓',
        'success'
      );

      // Emit event for page modules to react (e.g. timeline reload)
      document.dispatchEvent(new CustomEvent('chain:imported', { detail: result }));

      return result;

    } catch (err) {
      _status('Import write failed: ' + err.message, 'error');
      console.error('[ChainImport] merge error:', err);
      return { ok: false, errors: [err.message] };
    }
  }

  // ── importFromFile ────────────────────────────────────

  /**
   * Open the browser file picker, read the selected JSON file,
   * and run the full import pipeline.
   *
   * @param   {object} [opts]  forwarded to importFromEnvelope()
   * @returns {Promise<ImportResult>}
   */
  async function importFromFile(opts = {}) {
    return new Promise((resolveOuter) => {
      const input    = document.createElement('input');
      input.type     = 'file';
      input.accept   = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.onchange = async (e) => {
        document.body.removeChild(input);
        const file = e.target.files?.[0];
        if (!file) {
          resolveOuter({ ok: false, cancelled: true, errors: [] });
          return;
        }

        _status(`Reading "${file.name}" (${(file.size / 1024).toFixed(1)} KB)…`);

        let raw;
        try {
          raw = await file.text();
        } catch (err) {
          _status('Could not read file: ' + err.message, 'error');
          resolveOuter({ ok: false, errors: ['Could not read file: ' + err.message] });
          return;
        }

        let envelope;
        try {
          envelope = JSON.parse(raw);
        } catch (err) {
          _status('Invalid JSON — file may be corrupted.', 'error');
          resolveOuter({ ok: false, errors: ['JSON parse error: ' + err.message] });
          return;
        }

        const result = await importFromEnvelope(envelope, opts);
        resolveOuter(result);
      };

      input.oncancel = () => {
        document.body.removeChild(input);
        resolveOuter({ ok: false, cancelled: true, errors: [] });
      };

      input.click();
    });
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    importFromFile,
    importFromEnvelope,
    verify,
    preview,
  });

})();

window.ChainImport = ChainImport;

// ── Backwards-compatible global ───────────────────────────────────────────────

/** @deprecated Use ChainImport.importFromFile() */
async function importTimeline(opts) {
  const result = await ChainImport.importFromFile(opts);
  // Legacy callers expected a page reload on success
  if (result.ok) {
    setTimeout(() => window.location.reload(), 800);
  }
}

window.importTimeline = importTimeline;