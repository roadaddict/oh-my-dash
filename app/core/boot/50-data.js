/* ==========================================================================
   DATA — fetch helpers, polling feeds, the 1-second clock tick.
   ========================================================================== */
/* Network helpers — direct first, then CORS_PROXY if the host blocks CORS. */
/** `ttl` (seconds) asks the proxy to cache less — e.g. live plane positions. */
const withProxy = (url, ttl) => PROXY + encodeURIComponent(url) + (ttl != null ? `&ttl=${ttl}` : '');
async function fetchText(url, { proxyFirst = false } = {}) {
  const attempt = async (u) => {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };
  if ((proxyFirst || sync.cloud) && PROXY && !/^data:/i.test(url)) return attempt(withProxy(url));
  try {
    return await attempt(url);
  } catch (err) {
    if (!PROXY) throw err;
    return attempt(withProxy(url));
  }
}
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Shared, lazily-started polling data source with subscribers.
 * visibleOnly: poll only while one of the subscribing panels is on screen (saves
 * bandwidth); a skipped poll is made up as soon as the panel is shown again.
 * Polling stops when the last subscriber leaves (a widget removed in the editor) and
 * starts again with the next one; data younger than one interval is reused then.
 */
function createFeed(loader, intervalMs, { visibleOnly = false } = {}) {
  const subs = new Map(); // fn → panel element (or null)
  let data,
    error,
    started = false,
    inflight = null,
    retry = 0,
    stale = false,
    fetchedAt = 0,
    timer = 0;
  const me = {};
  // A panel whose feed (any of them) just failed shows its Retry button (see makePanel).
  const mark = (host, on = !!error) => {
    const el = host?.closest?.('.panel') || host; // some widgets subscribe with an inner element
    if (!el) return;
    const failing = (el._failingFeeds ||= new Set());
    if (on) failing.add(me);
    else failing.delete(me);
    el.classList.toggle('feed-error', failing.size > 0);
  };
  const notify = () =>
    subs.forEach((el, fn) => {
      mark(el);
      try {
        fn(data, error);
      } catch (e) {
        console.error(e);
      }
    });
  const active = () =>
    !document.hidden && !document.body.classList.contains('is-dark-night') && (!visibleOnly || [...subs.values()].some((el) => !el || isVisible(el)));
  function refresh() {
    if (inflight) return inflight;
    stale = false;
    inflight = (async () => {
      try {
        data = await loader();
        error = null;
        fetchedAt = Date.now();
      } catch (e) {
        error = e;
        clearTimeout(retry);
        retry = setTimeout(tick, 60000);
      } finally {
        inflight = null;
      }
      notify();
    })();
    return inflight;
  }
  function tick() {
    if (!started) return;
    if (active()) refresh();
    else stale = true;
  }
  const resume = () => {
    if (stale && active()) refresh();
  };
  function start() {
    started = true;
    if (!fetchedAt || !(intervalMs > 0) || Date.now() - fetchedAt >= intervalMs) refresh();
    if (intervalMs > 0) timer = setInterval(tick, intervalMs);
    window.addEventListener('online', tick);
    resumers.add(resume);
  }
  function stop() {
    started = false;
    clearInterval(timer);
    clearTimeout(retry);
    window.removeEventListener('online', tick);
    resumers.delete(resume);
  }
  return {
    subscribe(fn, el = null) {
      subs.set(fn, el);
      if (data !== undefined || error) {
        mark(el);
        fn(data, error);
      }
      if (!started) start();
      return () => {
        if (!subs.delete(fn)) return;
        mark(el, false);
        if (!subs.size) stop();
      };
    },
    refresh,
    get data() {
      return data;
    },
    get active() {
      return started;
    },
  };
}

/** One shared 1-second heartbeat for every clock on every screen. */
const tickers = new Set();
const onTick = (fn) => {
  tickers.add(fn);
  fn(new Date());
  return () => tickers.delete(fn);
};
(function tick() {
  const now = new Date();
  tickers.forEach((fn) => {
    try {
      fn(now);
    } catch (e) {
      console.error(e);
    }
  });
  setTimeout(tick, 1000 - (Date.now() % 1000) + 10);
})();

/** Backend service status (cached per page load; fresh = ask again, e.g. after connecting on a phone). */
const serviceStatus = (() => {
  const cache = {};
  return (name, fresh = false) => {
    if (fresh) delete cache[name];
    return (cache[name] ||= sync.cloud
      ? api(`/${name}/status`)
          .then((r) => (r.ok ? r.json() : { configured: false, error: `the dashboard API answered HTTP ${r.status}` }))
          .catch((e) => ({ configured: false, error: e.message }))
      : Promise.resolve({ configured: false, local: true }));
  };
})();
async function apiJSON(path, opts) {
  const r = await api(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}
