// ═══════════════════════════════════════
// VERSION-COMPARE — Text Diff Engine
// ═══════════════════════════════════════

/**
 * Compute a word-level diff between two strings.
 * Returns HTML with additions/deletions highlighted.
 */
function computeDiff(textA, textB) {
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);

  // LCS-based diff
  const lcs    = computeLCS(wordsA, wordsB);
  const result = buildDiffHtml(wordsA, wordsB, lcs);
  return result;
}

function tokenize(text) {
  // Split by word boundaries while preserving spaces and punctuation
  return text.match(/\S+|\s+/g) || [];
}

function computeLCS(a, b) {
  const m = a.length;
  const n = b.length;
  // DP table (space-optimized: only two rows)
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  const table = [];

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(curr[j - 1], prev[j]);
      }
    }
    table.push([...curr]);
    prev = [...curr];
    curr.fill(0);
  }

  // Backtrack
  const lcs   = [];
  let i = m, j = n;
  for (let ri = m - 1; ri >= 0 && j > 0;) {
    if (a[ri] === b[j - 1]) {
      lcs.unshift({ ai: ri, bi: j - 1, val: a[ri] });
      ri--; j--;
    } else if (j > 0 && (ri === 0 || table[ri - 1]?.[j] <= (table[ri]?.[j - 1] || 0))) {
      j--;
    } else {
      ri--;
    }
  }

  return lcs;
}

function buildDiffHtml(wordsA, wordsB, lcs) {
  let html     = '';
  let ai       = 0;
  let bi       = 0;
  let lcsi     = 0;

  while (ai < wordsA.length || bi < wordsB.length) {
    const lcsCur = lcs[lcsi];

    if (lcsCur && ai === lcsCur.ai && bi === lcsCur.bi) {
      // Common token
      html += escapeHTMLDiff(wordsA[ai]);
      ai++; bi++; lcsi++;
    } else {
      // Flush deletions
      while (ai < wordsA.length && !(lcsi < lcs.length && ai === lcs[lcsi].ai)) {
        html += `<span style="background:rgba(255,61,90,0.2);color:var(--accent-danger);text-decoration:line-through;">${escapeHTMLDiff(wordsA[ai])}</span>`;
        ai++;
      }
      // Flush additions
      while (bi < wordsB.length && !(lcsi < lcs.length && bi === lcs[lcsi].bi)) {
        html += `<span style="background:rgba(0,255,157,0.15);color:var(--accent-success);">${escapeHTMLDiff(wordsB[bi])}</span>`;
        bi++;
      }
    }
  }

  return html || '<span style="color:var(--text-muted);">No differences found.</span>';
}

function escapeHTMLDiff(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

window.computeDiff = computeDiff;