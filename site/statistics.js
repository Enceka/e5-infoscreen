'use strict';

// Keep this small client independent of the release feed. Statistics are
// optional: a failed request never hides or blocks the update link.
const infoscreenStatistics = (() => {
  const endpoint = 'https://busuanzi.9420.ltd/api';
  const counts = new Map();
  const states = new Map();
  let root = null;
  let started = false;
  try {
    root = new URL(document.querySelector('meta[name="site-url"]').content);
    root.search = ''; root.hash = '';
    if (root.origin !== location.origin || root.pathname !== new URL('./', location.href).pathname) root = null;
  } catch (_) {}

  function counterUrl(key) {
    return key === 'visits' ? root.href : new URL('__stats__/downloads/infoscreen', root).href;
  }
  function notify() { document.dispatchEvent(new Event('infoscreen-statistics')); }
  async function request(key, increment) {
    if (!root) return;
    states.set(key, 'loading');
    try {
      const response = await fetch(endpoint, { method: increment ? 'POST' : 'GET', headers: { 'x-bsz-referer': counterUrl(key) }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', keepalive: !!increment, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json(), value = result?.data?.page_pv;
      if (result.success !== true || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid statistics');
      counts.set(key, Math.max(counts.get(key) ?? 0, value)); states.set(key, 'ready');
    } catch (_) { if (!counts.has(key)) states.set(key, 'error'); }
    notify();
  }
  return {
    start() { if (!started && root) { started = true; void request('visits', true); void request('download:core', false); } },
    recordDownload() { if (root) void request('download:core', true); },
    count: (key) => counts.get(key),
    state: (key) => root ? (states.get(key) || 'loading') : 'disabled'
  };
})();
window.infoscreenStatistics = infoscreenStatistics;
