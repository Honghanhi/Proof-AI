// ════════════════════════════════════════════════════════
//  HASH — Cryptographic Hashing Utilities
//
//  All functions use the browser's native Web Crypto API
//  (window.crypto.subtle) — no external dependencies.
//
//  Public API (attached to window.Hash and also exposed as
//  top-level globals for backwards-compatibility):
//
//    Hash.text(str, algo?)          → Promise<hex>
//    Hash.object(obj)               → Promise<hex>
//    Hash.bytes(buffer, algo?)      → Promise<hex>
//    Hash.hmac(key, msg)            → Promise<hex>
//    Hash.fingerprint(str, len?)    → Promise<hex>   short id
//    Hash.verify(content, expected) → Promise<bool>
//    Hash.canonical(obj)            → string          stable JSON
//    Hash.bufferToHex(buf)          → string
//    Hash.hexToBytes(hex)           → Uint8Array
// ════════════════════════════════════════════════════════

const Hash = (() => {

  // ── Algo name map ─────────────────────────────────────
  const ALGO_MAP = {
    'sha256': 'SHA-256',
    'sha512': 'SHA-512',
    'sha384': 'SHA-384',
    'SHA-256': 'SHA-256',
    'SHA-512': 'SHA-512',
  };

  function _resolveAlgo(algo = 'sha256') {
    const name = ALGO_MAP[algo];
    if (!name) throw new Error(`Hash: unsupported algorithm "${algo}"`);
    return name;
  }

  // ── Core encode / digest ──────────────────────────────

  const _encoder = new TextEncoder();

  /**
   * Hash a UTF-8 string and return a lowercase hex digest.
   *
   * @param   {string} text
   * @param   {string} [algo='sha256']  'sha256' | 'sha512' | 'sha384'
   * @returns {Promise<string>}  64-char hex string for SHA-256
   */
  async function text(str, algo = 'sha256') {
    const bytes  = _encoder.encode(str);
    const digest = await crypto.subtle.digest(_resolveAlgo(algo), bytes);
    return bufferToHex(digest);
  }

  /**
   * Hash a raw ArrayBuffer or TypedArray.
   *
   * @param   {ArrayBuffer|TypedArray} buffer
   * @param   {string} [algo='sha256']
   * @returns {Promise<string>}
   */
  async function bytes(buffer, algo = 'sha256') {
    const buf    = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
    const digest = await crypto.subtle.digest(_resolveAlgo(algo), buf);
    return bufferToHex(digest);
  }

  /**
   * Deterministically hash a JavaScript object.
   *
   * Uses canonical() to produce a stable JSON representation
   * (sorted keys, no undefined values) before hashing, so two
   * objects with the same logical content always yield the same hash
   * regardless of key insertion order.
   *
   * @param   {object} obj
   * @param   {string} [algo='sha256']
   * @returns {Promise<string>}
   */
  async function object(obj, algo = 'sha256') {
    return text(canonical(obj), algo);
  }

  /**
   * Compute an HMAC-SHA-256 tag.
   * Useful for signing block headers with a session secret.
   *
   * @param   {string} keyStr  — raw key material (will be UTF-8 encoded)
   * @param   {string} message
   * @returns {Promise<string>}  hex MAC
   */
  async function hmac(keyStr, message) {
    const keyBytes = _encoder.encode(keyStr);
    const msgBytes = _encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
    return bufferToHex(sig);
  }

  /**
   * Return a short hex fingerprint of a string.
   * Useful for display IDs, not for security.
   *
   * @param   {string} str
   * @param   {number} [len=16]  number of hex chars to return
   * @returns {Promise<string>}
   */
  async function fingerprint(str, len = 16) {
    const h = await text(str);
    return h.slice(0, len);
  }

  /**
   * Verify a string against a previously computed hash.
   *
   * @param   {string} content
   * @param   {string} expectedHex
   * @param   {string} [algo='sha256']
   * @returns {Promise<boolean>}
   */
  async function verify(content, expectedHex, algo = 'sha256') {
    const actual = await text(content, algo);
    // Constant-time comparison via timing-safe approach (best effort in JS)
    if (actual.length !== expectedHex.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) {
      diff |= actual.charCodeAt(i) ^ expectedHex.charCodeAt(i);
    }
    return diff === 0;
  }

  // ── Encoding helpers ──────────────────────────────────

  /**
   * Convert an ArrayBuffer to a lowercase hex string.
   * @param   {ArrayBuffer} buffer
   * @returns {string}
   */
  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Decode a hex string to a Uint8Array.
   * @param   {string} hex
   * @returns {Uint8Array}
   */
  function hexToBytes(hex) {
    if (hex.length % 2 !== 0) throw new Error('Hash.hexToBytes: odd-length hex string');
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return arr;
  }

  // ── Canonical JSON ────────────────────────────────────

  /**
   * Produce a stable, deterministic JSON string from an object.
   *
   * Rules:
   *   - Object keys are sorted lexicographically (recursive)
   *   - undefined values and function-valued keys are omitted
   *   - Arrays preserve element order
   *   - Primitive values are passed through JSON.stringify
   *
   * @param   {*} value
   * @returns {string}
   */
  function canonical(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map(canonical).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    const pairs = keys
      .filter(k => value[k] !== undefined && typeof value[k] !== 'function')
      .map(k => JSON.stringify(k) + ':' + canonical(value[k]));
    return '{' + pairs.join(',') + '}';
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({
    text,
    bytes,
    object,
    hmac,
    fingerprint,
    verify,
    bufferToHex,
    hexToBytes,
    canonical,
  });

})();

window.Hash = Hash;

// ── Backwards-compatible globals ──────────────────────
// Existing code calls hashText(), hashObject(), etc. directly.
// These shims preserve that interface without duplication.

/** @deprecated Use Hash.text() */
const hashText    = (t, a)   => Hash.text(t, a);
/** @deprecated Use Hash.object() */
const hashObject  = (o)      => Hash.object(o);
/** @deprecated Use Hash.bufferToHex() */
const bufferToHex = (b)      => Hash.bufferToHex(b);
/** @deprecated Use Hash.fingerprint() */
const fingerprint = (t, l)   => Hash.fingerprint(t, l);
/** @deprecated Use Hash.verify() */
const verifyHash  = (c, e)   => Hash.verify(c, e);

window.hashText    = hashText;
window.hashObject  = hashObject;
window.bufferToHex = bufferToHex;
window.fingerprint = fingerprint;
window.verifyHash  = verifyHash;