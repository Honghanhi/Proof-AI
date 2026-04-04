// ════════════════════════════════════════════════════════
//  MERKLE — Binary Merkle Tree
//
//  Implements the standard Bitcoin-style binary Merkle tree:
//    • Leaves are hashed first (Hash.text per leaf)
//    • Odd levels duplicate the last node before pairing
//    • Internal nodes = Hash.text(leftHash + rightHash)
//
//  Public API  (window.Merkle + backwards-compat globals):
//
//    Merkle.root(leaves)             → Promise<string|null>
//    Merkle.build(leaves)            → Promise<MerkleTree>
//    Merkle.proof(leaves, leafIndex) → Promise<MerkleProof>
//    Merkle.verify(leafHash, proof, root) → Promise<bool>
//    Merkle.draw(canvasId, leaves)   → Promise<void>
//
//  MerkleTree  = { levels: string[][], root: string|null }
//  MerkleProof = { sibling: string, direction: 'L'|'R' }[]
// ════════════════════════════════════════════════════════

const Merkle = (() => {

  // ── Pair hash helper ─────────────────────────────────

  /**
   * Hash a pair of hex digests by concatenating and re-hashing.
   * @param {string} left   hex digest
   * @param {string} right  hex digest (may equal left for odd levels)
   */
  function _pair(left, right) {
    return Hash.text(left + right);
  }

  // ── Core: build ──────────────────────────────────────

  /**
   * Build a complete Merkle tree from an array of string leaves.
   *
   * Returns a MerkleTree object:
   * {
   *   levels : string[][]  — levels[0] = hashed leaves, levels[N] = [root]
   *   root   : string|null — root hash, or null if no leaves
   * }
   *
   * @param   {string[]} leaves
   * @returns {Promise<{levels: string[][], root: string|null}>}
   */
  async function build(leaves) {
    if (!leaves || leaves.length === 0) {
      return { levels: [], root: null };
    }

    // Hash every leaf
    let level = await Promise.all(leaves.map(l => Hash.text(String(l))));
    const levels = [level.slice()];

    // Build up to root
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left  = level[i];
        const right = level[i + 1] ?? left; // duplicate last node if odd count
        next.push(await _pair(left, right));
      }
      level = next;
      levels.push(level.slice());
    }

    return { levels, root: level[0] };
  }

  /**
   * Convenience: return only the Merkle root hash.
   * Returns null for empty input.
   *
   * @param   {string[]} leaves
   * @returns {Promise<string|null>}
   */
  async function root(leaves) {
    const tree = await build(leaves);
    return tree.root;
  }

  // ── Proof generation ──────────────────────────────────

  /**
   * Generate a Merkle inclusion proof for the leaf at leafIndex.
   *
   * The proof is an ordered array of sibling nodes that, when
   * combined with the leaf hash from leaf → root, allows any
   * third party to recompute and verify the root.
   *
   * Each proof step: { sibling: hexHash, direction: 'L' | 'R' }
   *   'R' means the sibling is to the RIGHT of the current node.
   *   'L' means the sibling is to the LEFT.
   *
   * @param   {string[]} leaves
   * @param   {number}   leafIndex   0-based index of the leaf to prove
   * @returns {Promise<Array<{sibling:string, direction:'L'|'R'}>>}
   */
  async function proof(leaves, leafIndex) {
    if (!leaves || leaves.length === 0) return [];
    if (leafIndex < 0 || leafIndex >= leaves.length) {
      throw new RangeError(`Merkle.proof: leafIndex ${leafIndex} out of range [0, ${leaves.length - 1}]`);
    }

    const tree  = await build(leaves);
    const steps = [];
    let   idx   = leafIndex;

    for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
      const level     = tree.levels[lvl];
      const isRight   = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;

      // If no right sibling exists (odd level), duplicate current node
      const sibling = siblingIdx < level.length ? level[siblingIdx] : level[idx];

      steps.push({
        sibling,
        direction: isRight ? 'L' : 'R',
      });

      idx = Math.floor(idx / 2);
    }

    return steps;
  }

  // ── Proof verification ────────────────────────────────

  /**
   * Verify a Merkle inclusion proof.
   *
   * @param   {string}  leafData   the original leaf string (will be hashed)
   * @param   {Array<{sibling:string, direction:'L'|'R'}>} proofSteps
   * @param   {string}  expectedRoot  known-good root hash
   * @returns {Promise<boolean>}
   */
  async function verify(leafData, proofSteps, expectedRoot) {
    let current = await Hash.text(String(leafData));

    for (const step of proofSteps) {
      if (step.direction === 'R') {
        // current is left, sibling is right
        current = await _pair(current, step.sibling);
      } else {
        // current is right, sibling is left
        current = await _pair(step.sibling, current);
      }
    }

    return current === expectedRoot;
  }

  // ── Canvas renderer ───────────────────────────────────

  /**
   * Draw a Merkle tree onto a <canvas> element.
   *
   * Layout: root at top, leaves at bottom.
   * Nodes are drawn as rounded-rect boxes showing the first 6 hex chars.
   * Edges connect each parent to its two children.
   *
   * @param {string}   canvasId  id of <canvas> element
   * @param {string[]} leaves
   * @returns {Promise<void>}
   */
  async function draw(canvasId, leaves) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (!leaves || leaves.length === 0) {
      ctx.fillStyle = 'rgba(0,229,255,0.3)';
      ctx.font      = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No leaves', W / 2, H / 2);
      return;
    }

    const tree   = await build(leaves);
    const levels = tree.levels;
    const nLevels = levels.length;
    if (nLevels === 0) return;

    // Render top-down: levels[last] = root (top), levels[0] = leaves (bottom)
    const reversedLevels = [...levels].reverse();

    const rowH   = H / (nLevels + 1);
    const BOX_W  = 52;
    const BOX_H  = 20;

    // Pre-compute x positions per level
    const xPos = reversedLevels.map((lvl, li) => {
      const n = lvl.length;
      return lvl.map((_, ni) => ((ni + 1) / (n + 1)) * W);
    });

    // Draw edges first (so boxes render on top)
    ctx.lineWidth   = 1;
    ctx.strokeStyle = 'rgba(0,229,255,0.22)';

    for (let li = 0; li < reversedLevels.length - 1; li++) {
      const parentLevel = reversedLevels[li];
      const childLevel  = reversedLevels[li + 1];
      const yParent = rowH * (li + 1);
      const yChild  = rowH * (li + 2);

      parentLevel.forEach((_, pi) => {
        const px  = xPos[li][pi];
        // Each parent connects to its two children (ci = pi*2 and pi*2+1)
        [pi * 2, pi * 2 + 1].forEach(ci => {
          if (ci < childLevel.length) {
            const cx = xPos[li + 1][ci];
            ctx.beginPath();
            ctx.moveTo(px, yParent + BOX_H / 2);

            // Bezier curve for visual elegance
            const midY = (yParent + yChild) / 2;
            ctx.bezierCurveTo(px, midY, cx, midY, cx, yChild - BOX_H / 2);
            ctx.stroke();
          }
        });
      });
    }

    // Draw nodes
    ctx.font      = '9px monospace';
    ctx.textAlign = 'center';

    reversedLevels.forEach((lvl, li) => {
      const isRoot   = li === 0;
      const isLeaf   = li === reversedLevels.length - 1;
      const y        = rowH * (li + 1);

      lvl.forEach((hash, ni) => {
        const x = xPos[li][ni];

        // Box fill + border
        const alpha = isRoot ? 0.18 : isLeaf ? 0.12 : 0.08;
        ctx.fillStyle   = `rgba(0,229,255,${alpha})`;
        ctx.strokeStyle = isRoot
          ? 'rgba(0,255,157,0.8)'
          : 'rgba(0,229,255,0.55)';
        ctx.lineWidth = isRoot ? 1.5 : 1;

        ctx.beginPath();
        ctx.roundRect(x - BOX_W / 2, y - BOX_H / 2, BOX_W, BOX_H, 4);
        ctx.fill();
        ctx.stroke();

        // Hash label
        ctx.fillStyle = isRoot ? '#00ff9d' : '#00e5ff';
        ctx.fillText(hash.slice(0, 7) + '…', x, y + 4);
      });
    });

    // Root label
    const rootY = rowH;
    ctx.fillStyle = 'rgba(0,255,157,0.5)';
    ctx.font      = '8px monospace';
    ctx.fillText('ROOT', xPos[0][0], rootY - BOX_H / 2 - 4);
  }

  // ── Lab page glue ─────────────────────────────────────

  /** Called by lab.html inline script */
  async function buildMerkle() {
    const el     = document.getElementById('merkle-leaves');
    if (!el) return;
    const leaves = el.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!leaves.length) return;
    await draw('merkle-canvas', leaves);
  }

  // ── Public surface ────────────────────────────────────
  return Object.freeze({ root, build, proof, verify, draw, buildMerkle });

})();

window.Merkle = Merkle;

// ── Backwards-compat globals ──────────────────────────
const buildMerkleRoot = (l)    => Merkle.root(l);
const buildMerkleTree = (l)    => Merkle.build(l).then(t => t.levels);
const drawMerkleTree  = (id,l) => Merkle.draw(id, l);
const buildMerkle     = ()     => Merkle.buildMerkle();

window.buildMerkleRoot = buildMerkleRoot;
window.buildMerkleTree = buildMerkleTree;
window.drawMerkleTree  = drawMerkleTree;
window.buildMerkle     = buildMerkle;