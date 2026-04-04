// ═══════════════════════════════════════
// TIMELINE-PAGE — History Controller
// ═══════════════════════════════════════

const PAGE_SIZE = 10;
let _page       = 0;
let _filtered   = [];

document.addEventListener('DOMContentLoaded', () => {
  loadTimeline();
  document.getElementById('search-filter')?.addEventListener('input',  filterTimeline);
  document.getElementById('verdict-filter')?.addEventListener('change', filterTimeline);
  document.getElementById('type-filter')?.addEventListener('change',    filterTimeline);
});

async function loadTimeline() {
  const results = await DB.getResults();
  _filtered     = results;
  _page         = 0;
  _renderStats(results);
  renderPage();
}

function _renderStats(results) {
  const el = document.getElementById('timeline-stats');
  if (!el) return;
  const counts = { text: 0, image: 0, url: 0, nft: 0 };
  results.forEach(r => { if (counts[r.type] !== undefined) counts[r.type]++; else counts.text++; });
  el.innerHTML = `
    <span style="font-size:0.78rem;color:var(--text-muted);">
      ${results.length} total &nbsp;·&nbsp;
      📝 ${counts.text} text &nbsp;·&nbsp;
      🖼️ ${counts.image} image &nbsp;·&nbsp;
      🔗 ${counts.url} URL &nbsp;·&nbsp;
      🎨 ${counts.nft} NFT
    </span>`;
}

async function filterTimeline() {
  const search  = document.getElementById('search-filter')?.value.toLowerCase() || '';
  const verdict = document.getElementById('verdict-filter')?.value || '';
  const type    = document.getElementById('type-filter')?.value   || '';

  const all = await DB.getResults();
  _filtered = all.filter(r => {
    const matchSearch  = !search  || JSON.stringify(r).toLowerCase().includes(search);
    // verdict.label có thể là uppercase ('AUTHENTIC') — so sánh exact
    const matchVerdict = !verdict || (r.verdict?.label || '').toUpperCase() === verdict.toUpperCase();
    const matchType    = !type    || r.type === type;
    return matchSearch && matchVerdict && matchType;
  });

  _page = 0;
  renderPage();
}

// Icon theo type — url và nft có icon riêng
function _dotIcon(type) {
  switch (type) {
    case 'image': return '🖼️';
    case 'url':   return '🔗';
    case 'nft':   return '🎨';
    default:      return '📝';
  }
}

function renderPage() {
  const container = document.getElementById('timeline-entries');
  if (!container) return;

  if (_filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:80px;color:var(--text-muted);">
        <div style="font-size:3rem;margin-bottom:16px;">📭</div>
        <div style="font-family:var(--font-display);font-size:0.8rem;">No results found</div>
      </div>
    `;
    UI.hide('pagination');
    return;
  }

  const start = _page * PAGE_SIZE;
  const slice = _filtered.slice(start, start + PAGE_SIZE);
  const total = _filtered.length;
  const pages = Math.ceil(total / PAGE_SIZE);

  container.innerHTML = '';

  slice.forEach((result, i) => {
    const isLeft = i % 2 === 0;
    const entry  = document.createElement('div');
    entry.className = 'timeline-entry anim-fadeInUp';
    entry.style.animationDelay = `${i * 0.05}s`;

    entry.innerHTML = `
      <div class="timeline-card-left" style="text-align:right;${isLeft ? '' : 'opacity:0;pointer-events:none;'}">
        ${isLeft ? UI.timelineCard(result) : ''}
      </div>
      <div class="timeline-dot">
        ${_dotIcon(result.type)}
      </div>
      <div class="timeline-card-right" style="${!isLeft ? '' : 'opacity:0;pointer-events:none;'}">
        ${!isLeft ? UI.timelineCard(result) : ''}
      </div>
    `;
    container.appendChild(entry);
  });

  UI.show('pagination');
  UI.setText('page-info', `Page ${_page + 1} of ${pages} (${total} total)`);
  document.getElementById('prev-btn').disabled = _page === 0;
  document.getElementById('next-btn').disabled = _page >= pages - 1;
}

function prevPage() {
  if (_page > 0) { _page--; renderPage(); }
}

function nextPage() {
  const pages = Math.ceil(_filtered.length / PAGE_SIZE);
  if (_page < pages - 1) { _page++; renderPage(); }
}

async function clearTimeline() {
  if (!confirm('Clear all verification history? This cannot be undone.')) return;
  await DB.clearResults();
  await DB.clearChain();
  loadTimeline();
  UI.toast('History cleared.', 'info');
}

function importTimeline() {
  if (typeof ChainImport !== 'undefined') {
    ChainImport.openDialog();
  } else {
    UI.toast('Import: drag a .json export file onto the page, or use the ChainImport module.', 'info', 5000);
  }
}

window.prevPage      = prevPage;
window.nextPage      = nextPage;
window.clearTimeline = clearTimeline;
window.importTimeline = importTimeline;