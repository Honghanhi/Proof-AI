// ════════════════════════════════════════════════════════
//  BLOCKCHAIN-EXPORT — Chain & Result Export
//
//  Produces a self-describing, cryptographically signed JSON
//  archive that can be verified before import on any machine.
//
//  Export envelope schema (v2)
//  ──────────────────────────
//  {
//    schema    : 'aiproof-export-v2'
//    exportedAt: ISO timestamp
//    generator : { app, version, userAgent }
//    manifest  : {
//      blocks       : number   total blocks exported
//      results      : number   total results exported
//      chainRoot    : hex      hash of chain array (canonical JSON)
//      resultsRoot  : hex      hash of results array (canonical JSON)
//    }
//    checksum  : hex    SHA-256 of canonical(manifest + chain + results)
//                       — recomputed by importer before anything is written
//    chain     : Block[]
//    results   : AnalysisResult[]
//  }
//
//  Public API (window.ChainExport):
//
//    ChainExport.exportFull(opts?)          → Promise<void>  download all
//    ChainExport.exportFiltered(ids, opts?) → Promise<void>  selected results
//    ChainExport.exportResult(resultId)     → Promise<void>  single result JSON
//    ChainExport.buildEnvelope(chain, results) → Promise<ExportEnvelope>
//    ChainExport.computeChecksum(env)       → Promise<hex>
//
//  Backwards-compat globals:
//    exportTimeline()          → delegates to ChainExport.exportFull()
//    exportResultAsJSON(id)    → delegates to ChainExport.exportResult(id)
//    exportResult()            → reads ?id from URL, delegates
// ════════════════════════════════════════════════════════

const ChainExport = (() => {

  const SCHEMA_VERSION = 'aiproof-export-v2';
  const APP_VERSION    = window.APP_VERSION || '1.0.0';

  // ── Checksum ──────────────────────────────────────────

  /**
   * Compute a deterministic SHA-256 checksum over the export payload.
   *
   * The input is: canonical JSON of { chain, results, manifest }
   * (excludes `checksum` itself and metadata that changes per-machine).
   *
   * @param   {object} envelope  export object (checksum field may be absent)
   * @returns {Promise<string>}  64-char hex
   */
  async function computeChecksum(envelope) {
    const payload = {
      chain:    envelope.chain    || [],
      results:  envelope.results  || [],
      manifest: envelope.manifest || {},
    };
    return Hash.object(payload);
  }

  // ── Manifest builder ──────────────────────────────────

  /**
   * Build the manifest block that summarises the export contents.
   * Both array roots are independently hashable so an importer can
   * verify chain and results separately.
   *
   * @param   {object[]} chain
   * @param   {object[]} results
   * @returns {Promise<object>}
   */
  async function _buildManifest(chain, results) {
    const [chainRoot, resultsRoot] = await Promise.all([
      Hash.object(chain),
      Hash.object(results),
    ]);
    return {
      blocks:      chain.length,
      results:     results.length,
      chainRoot,
      resultsRoot,
    };
  }

  // ── Envelope builder ──────────────────────────────────

  /**
   * Assemble a complete, signed export envelope from arrays of blocks
   * and results. Call this to inspect the envelope before downloading.
   *
   * @param   {object[]} chain
   * @param   {object[]} results
   * @returns {Promise<ExportEnvelope>}
   */
  async function buildEnvelope(chain, results) {
    const manifest = await _buildManifest(chain, results);

    const envelope = {
      schema:     SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      generator: {
        app:       'AI-PROOF',
        version:   APP_VERSION,
        userAgent: navigator.userAgent,
      },
      manifest,
      checksum:   null,   // filled below
      chain,
      results,
    };

    envelope.checksum = await computeChecksum(envelope);
    return envelope;
  }

  // ── Download helper ───────────────────────────────────

  /**
   * Serialise an envelope to JSON and trigger a browser download.
   *
   * @param   {object} envelope
   * @param   {string} [filename]  auto-generated if omitted
   */
  function _download(envelope, filename) {
    const json = JSON.stringify(envelope, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename || _defaultFilename(envelope);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay so Safari has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function _defaultFilename(envelope) {
    const ts = new Date(envelope.exportedAt)
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    return `aiproof-chain-${ts}.json`;
  }

  // ── Progress overlay ──────────────────────────────────

  /**
   * Show/update/hide a lightweight status toast during export.
   * Falls back gracefully if UI module isn't loaded.
   */
  function _status(msg, type = 'info') {
    if (typeof UI !== 'undefined' && UI.toast) {
      UI.toast(msg, type, type === 'info' ? 1200 : 3000);
    } else {
      console.info('[ChainExport]', msg);
    }
  }

  // ── Full export ───────────────────────────────────────

  /**
   * Export the entire chain and all results as a signed JSON file.
   *
   * @param   {object} [opts]
   * @param   {string} [opts.filename]   override default filename
   * @returns {Promise<void>}
   */
  async function exportFull(opts = {}) {
    _status('Preparing export…');

    try {
      const [chain, results] = await Promise.all([
        DB.getChain(),
        DB.getResults(),
      ]);

      if (chain.length === 0 && results.length === 0) {
        _status('Nothing to export — chain and results are empty.', 'warn');
        return;
      }

      _status(`Building envelope (${chain.length} blocks, ${results.length} results)…`);
      const envelope = await buildEnvelope(chain, results);

      _download(envelope, opts.filename);
      _status(
        `Exported ${chain.length} blocks + ${results.length} results ✓`,
        'success'
      );

      console.info(
        `[ChainExport] full export — checksum: ${envelope.checksum.slice(0, 16)}…`
      );
    } catch (err) {
      _status('Export failed: ' + err.message, 'error');
      console.error('[ChainExport] exportFull error:', err);
      throw err;
    }
  }

  // ── Filtered export (selected result IDs) ────────────

  /**
   * Export only the blocks and results matching the given result IDs.
   * Blocks are included if block.data.resultId is in the id set.
   *
   * @param   {string[]} resultIds
   * @param   {object}   [opts]
   * @param   {string}   [opts.filename]
   * @returns {Promise<void>}
   */
  async function exportFiltered(resultIds, opts = {}) {
    if (!resultIds || resultIds.length === 0) {
      _status('No results selected for export.', 'warn');
      return;
    }

    _status(`Exporting ${resultIds.length} selected result(s)…`);

    try {
      const idSet  = new Set(resultIds);
      const [chain, allResults] = await Promise.all([
        DB.getChain(),
        DB.getResults(),
      ]);

      const filteredResults = allResults.filter(r => idSet.has(r.id));
      const filteredChain   = chain.filter(b =>
        b.index === 0 ||                          // always include genesis
        idSet.has(b.data?.resultId)
      );

      if (filteredResults.length === 0) {
        _status('None of the selected IDs were found in storage.', 'warn');
        return;
      }

      const envelope = await buildEnvelope(filteredChain, filteredResults);
      _download(envelope, opts.filename || _filteredFilename(resultIds));
      _status(`Exported ${filteredResults.length} result(s) ✓`, 'success');

    } catch (err) {
      _status('Filtered export failed: ' + err.message, 'error');
      throw err;
    }
  }

  function _filteredFilename(ids) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `aiproof-selection-${ids.length}-${ts}.json`;
  }

  // ── Single result export ──────────────────────────────

  /**
   * Export one analysis result as a standalone JSON file.
   * Includes its corresponding blockchain block and a lightweight
   * envelope so the file is self-verifiable.
   *
   * @param   {string} resultId
   * @returns {Promise<void>}
   */
  async function exportResult(resultId) {
    try {
      const result = await DB.getResultById(resultId);
      if (!result) {
        _status(`Result ${resultId} not found.`, 'warn');
        return;
      }

      // Find the matching block if it exists
      const chain = await DB.getChain();
      const block = chain.find(b => b.data?.resultId === resultId) || null;

      const single = {
        schema:     SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        type:       'single-result',
        result,
        block,
        checksum:   null,
      };
      single.checksum = await Hash.object({ result, block });

      const filename = `aiproof-result-${resultId.slice(0, 12)}.json`;
      _download(single, filename);
      _status('Result exported ✓', 'success');

    } catch (err) {
      _status('Export failed: ' + err.message, 'error');
      throw err;
    }
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    exportFull,
    exportFiltered,
    exportResult,
    buildEnvelope,
    computeChecksum,
  });

})();

window.ChainExport = ChainExport;

// ── Backwards-compatible globals ──────────────────────────────────────────────

/** @deprecated Use ChainExport.exportFull() */
async function exportTimeline() {
  return ChainExport.exportFull();
}

/** @deprecated Use ChainExport.exportResult(id) */
async function exportResultAsJSON(resultId) {
  return ChainExport.exportResult(resultId);
}

/** Reads ?id from URL and delegates */
async function exportResult() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (id) return ChainExport.exportResult(id);
}

window.exportTimeline     = exportTimeline;
window.exportResultAsJSON = exportResultAsJSON;
window.exportResult       = exportResult;