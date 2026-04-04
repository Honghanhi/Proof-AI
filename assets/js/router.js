// ════════════════════════════════════════════════════════
//  ROUTER — Page Detection & Module Loader  (updated: added nft.html)
// ════════════════════════════════════════════════════════

const Router = (() => {

  const ROUTES = Object.freeze({
    'index.html':    'assets/js/app.js',
    'analyze.html':  'assets/js/analyze-page.js',
    'result.html':   'assets/js/result-page.js',
    'timeline.html': 'assets/js/timeline-page.js',
    'fakenews.html': 'assets/js/fakenews-page.js',
    'url-check.html':'assets/js/url-page.js',
    'nft.html':      'assets/js/nft-page.js',   // ← NEW
    'lab.html':      null,
  });

  let _currentPage  = '';
  let _moduleLoaded = false;

  function _detectPage() {
    const raw = window.location.pathname.split('/').pop();
    return raw || 'index.html';
  }

  function _injectScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const el    = document.createElement('script');
      el.src      = src;
      el.defer    = true;
      el.onload  = () => resolve();
      el.onerror = () => reject(new Error(`Router: failed to load "${src}"`));
      document.head.appendChild(el);
    });
  }

  function _emit(page) {
    document.dispatchEvent(new CustomEvent('router:ready', { detail: { page }, bubbles: false }));
  }

  async function init() {
    _currentPage = _detectPage();
    if (typeof STATE !== 'undefined' && STATE?.set) STATE.set({ currentPage: _currentPage });

    const moduleSrc = ROUTES[_currentPage];
    if (!moduleSrc || _currentPage === 'index.html') {
      _moduleLoaded = true; _emit(_currentPage); return;
    }

    try {
      await _injectScript(moduleSrc);
      _moduleLoaded = true;
      console.info(`[Router] loaded "${_currentPage}": ${moduleSrc}`);
    } catch (err) {
      console.error('[Router]', err.message);
    } finally {
      _emit(_currentPage);
    }
  }

  function navigate(page, params = {}) {
    const query = new URLSearchParams(params).toString();
    window.location.href = page + (query ? '?' + query : '');
  }

  function getParam(name)    { return new URLSearchParams(window.location.search).get(name); }
  function getAllParams()     { return Object.fromEntries(new URLSearchParams(window.location.search)); }
  function back()            { history.length > 1 ? history.back() : navigate('index.html'); }
  function updateParams(p)   { const c=new URLSearchParams(window.location.search); for(const[k,v]of Object.entries(p))c.set(k,v); history.replaceState({},'',window.location.pathname+'?'+c.toString()); }
  function getCurrentPage()  { return _currentPage; }
  function isModuleLoaded()  { return _moduleLoaded; }
  function getRoutes()       { return ROUTES; }

  return Object.freeze({ init, navigate, getParam, getAllParams, updateParams, back, getCurrentPage, isModuleLoaded, getRoutes });
})();

window.Router = Router;