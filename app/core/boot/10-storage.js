/* ==========================================================================
   STORAGE — localStorage helpers and the data meter.
   ========================================================================== */
const STORE_KEY = 'omd.settings.v2';
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
/* ==========================================================================
   DATA METER — how much this dashboard downloads (it lives on a home Wi-Fi).
   Counts: same-origin requests via Resource Timing (exact wire bytes), other
   fetch() calls via Content-Length (or body size if the server doesn't say),
   and photos (fetched as blobs). Not visible to a web page: traffic *inside*
   iframes (transit app, Spotify, Google Calendar) — Android's per-app Wi-Fi
   data usage shows the full total for the kiosk browser.
   ========================================================================== */
const NET_KEY = 'omd.netmeter.v1';
const netmeter = (() => {
  const HEADER_BYTES = 350; // rough request+response header overhead
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let st = null;
  try {
    st = JSON.parse(localStorage.getItem(NET_KEY));
  } catch {
    /* ignore */
  }
  if (!st || typeof st !== 'object') st = {};
  st.days ||= {};
  st.hosts ||= {};
  st.reqs ||= {};
  const minutes = new Map(); // minute → { bytes, reqs } (last 60 min, in memory)
  let unmeasured = 0,
    dirty = false;
  const hostOf = (url) => {
    try {
      const u = new URL(url, location.href);
      if (u.pathname.endsWith('/api/proxy')) return `${new URL(u.searchParams.get('url')).host} ⇢ proxy`;
      return u.origin === location.origin ? `${u.host} (dashboard)` : u.host;
    } catch {
      return 'other';
    }
  };
  function record(url, bytes) {
    const d = dayKey();
    if (st.hostsDay !== d) {
      st.hostsDay = d;
      st.hosts = {};
    }
    st.days[d] = (st.days[d] || 0) + bytes;
    st.reqs[d] = (st.reqs[d] || 0) + 1;
    const host = hostOf(url);
    st.hosts[host] = (st.hosts[host] || 0) + bytes;
    const m = Math.floor(Date.now() / 60000);
    const b = minutes.get(m) || { bytes: 0, reqs: 0 };
    b.bytes += bytes;
    b.reqs++;
    minutes.set(m, b);
    for (const k of minutes.keys()) if (k < m - 60) minutes.delete(k);
    dirty = true;
  }
  every(30000, () => {
    if (!dirty) return;
    dirty = false;
    const keep = Object.keys(st.days).sort().slice(-14);
    st.days = Object.fromEntries(keep.map((k) => [k, st.days[k]]));
    st.reqs = Object.fromEntries(keep.map((k) => [k, st.reqs[k] || 0]));
    try {
      localStorage.setItem(NET_KEY, JSON.stringify(st));
    } catch {
      /* ignore */
    }
  });

  // Exact bytes for everything the browser will report (same-origin, fonts, CDNs with Timing-Allow-Origin).
  const sameOrigin = (url) => {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.initiatorType === 'fetch' && !sameOrigin(e.name)) continue; // counted by the fetch wrapper
        if (e.transferSize > 0) record(e.name, e.transferSize); // 0 = served from cache
        else if (!sameOrigin(e.name) && e.encodedBodySize === 0 && e.initiatorType === 'img') unmeasured++;
      }
    }).observe({ type: 'resource', buffered: true });
    every(10 * 60000, () => performance.clearResourceTimings());
    // The page itself (index.html) — 0 when revalidated from cache.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.transferSize > 0) record(e.name, e.transferSize);
    }).observe({ type: 'navigation', buffered: true });
  } catch {
    /* old WebView */
  }

  // Cross-origin fetch(): Content-Length when exposed, otherwise the (decoded) body size.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const res = await nativeFetch(input, init);
    if (!sameOrigin(url)) {
      if (res.type === 'opaque') record(url, HEADER_BYTES);
      else {
        const len = Number(res.headers.get('Content-Length'));
        if (len > 0 || res.status === 304 || res.status === 204) record(url, HEADER_BYTES + (len || 0));
        else
          res
            .clone()
            .arrayBuffer()
            .then(
              (b) => record(url, HEADER_BYTES + b.byteLength),
              () => record(url, HEADER_BYTES),
            );
      }
    }
    return res;
  };

  return {
    dayKey,
    summary() {
      const now = Math.floor(Date.now() / 60000);
      let hourBytes = 0,
        hourReqs = 0,
        peak = 0;
      for (const [m, b] of minutes)
        if (m > now - 60) {
          hourBytes += b.bytes;
          hourReqs += b.reqs;
          peak = Math.max(peak, b.bytes);
        }
      const since = Math.min(60, Math.max(1, (Date.now() - bootTime) / 60000));
      const d = dayKey();
      return {
        today: st.days[d] || 0,
        todayReqs: st.reqs[d] || 0,
        lastHour: hourBytes,
        reqPerMin: hourReqs / since,
        avgKbps: (hourBytes * 8) / (since * 60) / 1000,
        peakKbps: (peak * 8) / 60 / 1000,
        days: Object.entries(st.days).sort().slice(-7),
        hosts: st.hostsDay === d ? Object.entries(st.hosts).sort((a, b) => b[1] - a[1]) : [],
        unmeasured,
      };
    },
  };
})();
const bootTime = Date.now();
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);

/** JSON value persisted in localStorage, with a fallback when absent/corrupt. */
const persisted = (key, fallback) => ({
  get() {
    try {
      const v = JSON.parse(store.get(key));
      return v ?? structuredClone(fallback);
    } catch {
      return structuredClone(fallback);
    }
  },
  set(v) {
    store.set(key, JSON.stringify(v));
  },
});

function coerce(value, template) {
  if (Array.isArray(template)) {
    return Array.isArray(value)
      ? value
      : String(value ?? '')
          .split(/\r?\n|;;/)
          .map((s) => s.trim())
          .filter(Boolean);
  }
  if (typeof template === 'number') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : template;
  }
  if (typeof template === 'boolean') return value === true || value === 'true' || value === '1' || value === 'on';
  return value == null ? template : String(value).trim();
}
