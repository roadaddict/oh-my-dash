/* ==========================================================================
   DATA — fetch helpers, polling feeds, the 1-second clock tick.
   ========================================================================== */
/* Network helpers — direct first, then CORS_PROXY if the host blocks CORS. */
/** `ttl` (seconds) asks the proxy to cache less — e.g. live plane positions. */
const withProxy = (url, ttl) => PROXY + encodeURIComponent(url) + (ttl != null ? `&ttl=${ttl}` : '');
/* Feeds that come due together (they share the heartbeat) are fetched by the Worker in
   ONE request: POST /api/proxy/batch. One round trip and one radio wake-up instead of one
   per feed; the Worker's edge cache is shared by every screen in the house. In cloud
   mode this covers every outside GET a feed makes (weather, calendars, RSS …); a host the
   Worker refuses (ALLOWED_HOSTS) is fetched directly, and a Worker without the endpoint
   (an older deploy) means one request each, as before. */
const PROXY_SELF = new URL(`${API}/proxy?url=`, location.href).href;
const batch = { queue: [], timer: 0, off: false };
/** The batchable part of a request: { url, ttl } for the Worker — or null. */
function batchTarget(url, opts) {
  if (typeof url !== 'string' || opts.method || opts.signal || opts.headers || !sync.cloud || cfg.CORS_PROXY) return null;
  if (url.startsWith(PROXY_SELF)) {
    const u = new URL(url);
    return { url: u.searchParams.get('url'), ...(u.searchParams.has('ttl') ? { ttl: Number(u.searchParams.get('ttl')) } : {}), proxied: true };
  }
  // Outside data fetched directly (CORS-friendly APIs): also via the Worker, cached for a minute.
  return /^https?:\/\//.test(url) && new URL(url).origin !== location.origin ? { url, ttl: 60, proxied: false } : null;
}
function viaBatch(url, opts, target) {
  return new Promise((resolve, reject) => {
    batch.queue.push({ url, opts, target, resolve, reject });
    if (!batch.timer) batch.timer = setTimeout(flushBatch, 20); // whatever else is due this moment joins in
  });
}
async function flushBatch() {
  const jobs = batch.queue.splice(0, 20);
  batch.timer = batch.queue.length ? setTimeout(flushBatch, 0) : 0;
  const alone = (j) => fetchWithin(j.url, j.opts, 20000, true).then(j.resolve, j.reject);
  if (jobs.length === 1 || batch.off) return jobs.forEach(alone);
  try {
    const requests = jobs.map(({ target: { url, ttl } }) => ({ url, ...(ttl != null ? { ttl } : {}) }));
    const r = await fetchWithin(
      `${API}/proxy/batch`,
      { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) },
      25000,
      true,
    );
    if (r.status === 404 || r.status === 405) {
      batch.off = true; // an older Worker: one by one from now on
      return jobs.forEach(alone);
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { responses } = await r.json();
    jobs.forEach((j, i) => {
      const x = responses[i];
      // Too big to batch, or a host the Worker won't fetch (ALLOWED_HOSTS): the usual way.
      if (!x || x.status === 413 || (!j.target.proxied && (x.status === 400 || x.status === 403))) alone(j);
      else j.resolve(new Response(x.body, { status: x.status, headers: { 'Content-Type': x.type } }));
    });
  } catch (e) {
    jobs.forEach((j) => j.reject(e));
  }
}
/** fetch() that gives up after `ms`: a half-open connection (flaky Wi-Fi, captive portal) must not stall a feed forever. */
async function fetchWithin(url, opts = {}, ms = 20000, direct = false) {
  const target = direct ? null : batchTarget(url, opts);
  if (target) return viaBatch(url, opts, target);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    throw ctrl.signal.aborted && !opts.signal?.aborted ? new Error(`No answer in ${ms / 1000} s`) : e;
  } finally {
    clearTimeout(timer);
  }
}
async function fetchText(url, { proxyFirst = false } = {}) {
  const attempt = async (u) => {
    const r = await fetchWithin(u, { cache: 'no-store' });
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
  const r = await fetchWithin(url, { cache: 'no-store', ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------- Saved feed data ----------
   Every feed keeps its last good answer on the device (localStorage, "omd.feed.<key>"),
   so after a reload — or a power cut during an internet outage — widgets show it at
   once instead of a loading shimmer, and a reload doesn't re-download data that is
   still fresh. Only plain JSON (plus Dates) is kept; a feed whose data is anything else
   (Maps, class instances) simply isn't saved. Live-only data opts out: { persist: false }. */
const FEED_PREFIX = 'omd.feed.',
  FEED_MAX_BYTES = 256 * 1024,
  FEED_MAX_AGE = 7 * 864e5;
/** Short stable hash of a string (FNV-1a), for storage keys. */
const hashKey = (s) => {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0).toString(36);
};
const feedCodec = {
  /** JSON text, or null when the data isn't plain enough to survive a round trip. */
  encode(data) {
    let plain = true;
    const text = JSON.stringify(data, function (k, v) {
      const orig = this[k];
      if (orig instanceof Date) return { $date: orig.getTime() };
      if (orig && typeof orig === 'object' && !Array.isArray(orig)) {
        const proto = Object.getPrototypeOf(orig);
        if (proto !== Object.prototype && proto !== null) plain = false;
      }
      return v;
    });
    return plain && text != null && text.length <= FEED_MAX_BYTES ? text : null;
  },
  decode: (text) =>
    JSON.parse(text, (k, v) => (v && typeof v === 'object' && typeof v.$date === 'number' && Object.keys(v).length === 1 ? new Date(v.$date) : v)),
};
function loadSavedFeed(key) {
  try {
    const rec = JSON.parse(store.get(FEED_PREFIX + key) || 'null');
    if (!rec || rec.v !== 1 || !(Date.now() - rec.at < FEED_MAX_AGE)) return null;
    return { at: rec.at, data: feedCodec.decode(rec.data) };
  } catch {
    return null;
  }
}
function saveFeed(key, data, at) {
  const text = feedCodec.encode(data);
  if (text != null && !store.set(FEED_PREFIX + key, JSON.stringify({ v: 1, at, data: text }))) pruneSavedFeeds(key);
}
/** Out of space: drop the oldest saved feeds (not `keep`), then give up quietly. */
function pruneSavedFeeds(keep) {
  const all = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(FEED_PREFIX) && k !== FEED_PREFIX + keep) all.push([k, JSON.parse(localStorage.getItem(k))?.at || 0]);
    }
  } catch {
    return;
  }
  all
    .sort((a, b) => a[1] - b[1])
    .slice(0, Math.ceil(all.length / 2) || 0)
    .forEach(([k]) => store.remove(k));
}

/** Panels showing data older than it should be ("12 min ago" in the corner) — offline, or a service is down. */
const staleBadges = new Set();
function updateStaleBadge(el) {
  if (el.isConnected) el._badgeSeen = true;
  else if (el._badgeSeen) return void staleBadges.delete(el); // removed from the page
  let oldest = Infinity;
  for (const { at, interval } of el._feedAges?.values() || [])
    if (interval > 0 && Date.now() - at > Math.max(2 * interval, 10 * 60000)) oldest = Math.min(oldest, at);
  if (oldest === Infinity) delete el.dataset.stale;
  else el.dataset.stale = timeAgo(new Date(oldest));
}
every(60000, () => staleBadges.forEach(updateStaleBadge));

/* New data from any number of feeds is handed to widgets together, in the next frame:
   feeds answering within the same moment cost one layout and one repaint, not one each. */
const pendingNotify = new Set();
let notifyArmed = false;
function flushNotify() {
  if (!notifyArmed) return;
  notifyArmed = false;
  const fns = [...pendingNotify];
  pendingNotify.clear();
  fns.forEach((fn) => fn());
}
function queueNotify(fn) {
  pendingNotify.add(fn);
  if (notifyArmed) return;
  notifyArmed = true;
  requestAnimationFrame(flushNotify);
  setTimeout(flushNotify, 100); // hidden pages get no frames
}
/** After n failures in a row: 15 s, 30 s, 1 min … up to max(interval, 1 min), ±20 % so devices and feeds spread out. */
const retryDelay = (fails, intervalMs) => Math.min(Math.max(intervalMs, 60000), 15000 * 2 ** Math.min(fails - 1, 8)) * (0.8 + Math.random() * 0.4);

/**
 * Shared, lazily-started polling data source with subscribers.
 * visibleOnly: poll only while one of the subscribing panels is on screen (saves
 * bandwidth); a skipped poll is made up as soon as the panel is shown again.
 * Polling stops when the last subscriber leaves (a widget removed in the editor) and
 * starts again with the next one; data younger than one interval is reused then.
 * persist: storage key for the last good data (see above), or false.
 * Polls run on the shared clock (every); failures retry with backoff; nothing is tried
 * while the device is offline — the 'online' event brings every feed up to date.
 */
function createFeed(loader, intervalMs, { visibleOnly = false, persist = false } = {}) {
  const subs = new Map(); // fn → panel element (or null)
  let data,
    error,
    started = false,
    inflight = null,
    retry = 0,
    fails = 0,
    stale = false,
    fetchedAt = 0,
    stopTimer = null;
  const me = {};
  if (persist) {
    const saved = loadSavedFeed(persist);
    if (saved) {
      data = saved.data;
      fetchedAt = saved.at;
    }
  }
  // A panel whose feed (any of them) just failed shows its Retry button (see makePanel);
  // one whose data is overdue (offline, or the service is down) says how old it is.
  const mark = (host, on = !!error) => {
    const el = host?.closest?.('.panel') || host; // some widgets subscribe with an inner element
    if (!el) return;
    const failing = (el._failingFeeds ||= new Set());
    if (on) failing.add(me);
    else failing.delete(me);
    el.classList.toggle('feed-error', failing.size > 0);
    const ages = (el._feedAges ||= new Map());
    if (data !== undefined && fetchedAt) ages.set(me, { at: fetchedAt, interval: intervalMs });
    else ages.delete(me);
    staleBadges.add(el);
    updateStaleBadge(el);
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
        fails = 0;
        clearTimeout(retry);
        if (persist) saveFeed(persist, data, fetchedAt);
      } catch (e) {
        error = e;
        clearTimeout(retry);
        retry = setTimeout(tick, retryDelay(++fails, intervalMs));
      } finally {
        inflight = null;
      }
      queueNotify(notify);
    })();
    return inflight;
  }
  function tick() {
    if (!started) return;
    if (active() && navigator.onLine) refresh();
    else stale = true; // made up when shown again / back online
  }
  const resume = () => {
    if (stale && active() && navigator.onLine) refresh();
  };
  function start() {
    started = true;
    // The first fetch waits for the frame: by then every widget being mounted is laid out,
    // so checking which ones are on screen costs one layout for all, not one per widget.
    if (!fetchedAt || !(intervalMs > 0) || Date.now() - fetchedAt >= intervalMs) queueNotify(tick);
    if (intervalMs > 0) stopTimer = every(intervalMs, tick);
    window.addEventListener('online', tick);
    resumers.add(resume);
  }
  function stop() {
    started = false;
    stopTimer?.();
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
