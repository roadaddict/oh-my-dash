/* ==========================================================================
   CLOUD SYNC — the Worker's /api/state + D1 (lib/api.js).
   Shares settings, lists, chores, meals and the family note between the tablet
   and everyone's phones. Falls back to on-device storage on file://, on static
   hosts without the Worker, or when the API refuses (not signed in).
   ========================================================================== */
const bus = new EventTarget();
const emit = (name) => bus.dispatchEvent(new Event(name));
window.addEventListener('storage', (e) => {
  const m = /^omd\.([\w-]+)\.v1$/.exec(e.key || '');
  if (m) emit(m[1]);
});

const API = './api';
const SYNC_CACHE = 'omd.sync-cache.v1';
const sync = {
  mode: 'local', // 'local' | 'cloud' | 'offline' (cloud, last pull failed) | 'denied' (API says not signed in)
  items: {}, // key → { rev, value } as last known (server + pending local edits)
  pending: new Map(), // key → { base: {rev, value}, fns: [], inflight }
  fallbacks: {}, // key → () => default value
  get cloud() {
    return this.mode === 'cloud' || this.mode === 'offline';
  },
};
try {
  sync.items = JSON.parse(store.get(SYNC_CACHE) || '{}') || {};
} catch {
  sync.items = {};
}
const saveSyncCache = () => store.set(SYNC_CACHE, JSON.stringify(sync.items));

async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
  try {
    return await fetch(`${API}${path}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}
/** Pull every shared key; returns the keys whose revision changed. */
async function pullState() {
  const r = await api('/state', sync.etag ? { headers: { 'If-None-Match': sync.etag } } : {});
  if (r.status === 401 || r.status === 403) {
    sync.mode = 'denied';
    return [];
  }
  if (r.status === 304) {
    sync.mode = 'cloud';
    return [];
  }
  if (!r.ok || !(r.headers.get('Content-Type') || '').includes('json')) throw new Error(`state HTTP ${r.status}`);
  const { items = {} } = await r.json();
  sync.etag = r.headers.get('ETag') || null;
  const changed = [];
  for (const [k, v] of Object.entries(items)) {
    if (sync.pending.has(k)) continue; // local edits in flight win until pushed
    if (sync.items[k]?.rev !== v.rev) {
      sync.items[k] = { rev: v.rev, value: v.value };
      changed.push(k);
    }
  }
  sync.mode = 'cloud';
  saveSyncCache();
  return changed;
}
const applyAll = (key, base, fns) => fns.reduce((v, fn) => fn(structuredClone(v ?? sync.fallbacks[key]?.() ?? null)), base);
/** Push queued edits for `key`; on conflict re-apply them on the server's latest value and retry. */
async function pushState(key) {
  const p = sync.pending.get(key);
  if (!p || p.inflight) return;
  p.inflight = true;
  const n = p.fns.length;
  const value = applyAll(key, p.base.value, p.fns);
  try {
    const r = await api(`/state/${key}`, { method: 'PUT', body: JSON.stringify({ rev: p.base.rev, value }) });
    if (r.status === 401 || r.status === 403) {
      sync.mode = 'denied';
      p.inflight = false;
      return;
    }
    const j = await r.json();
    if (r.status === 409) p.base = { rev: j.rev, value: j.value };
    else if (r.ok) {
      p.base = { rev: j.rev, value };
      p.fns.splice(0, n);
    } else throw new Error(j.error || `HTTP ${r.status}`);
    sync.mode = 'cloud';
  } catch (err) {
    console.warn(`Sync of "${key}" failed, will retry:`, err);
    sync.mode = 'offline';
    p.inflight = false;
    return;
  }
  p.inflight = false;
  sync.items[key] = p.fns.length ? { rev: p.base.rev, value: applyAll(key, p.base.value, p.fns) } : p.base;
  if (!p.fns.length) sync.pending.delete(key);
  saveSyncCache();
  emit(key);
  if (p.fns.length) pushState(key);
}

/**
 * Shared value: cloud-synced when the backend is available, localStorage otherwise.
 * Always change it through update(fn) — fn receives the latest value and returns the
 * next one, and may be re-run on top of someone else's concurrent edit.
 */
function sharedState(key, fallback) {
  sync.fallbacks[key] = typeof fallback === 'function' ? fallback : () => structuredClone(fallback);
  const local = persisted(`omd.${key}.v1`, null);
  return {
    get() {
      const v = sync.cloud ? sync.items[key]?.value : local.get();
      return v == null ? sync.fallbacks[key]() : structuredClone(v);
    },
    update(fn) {
      if (!sync.cloud) {
        local.set(fn(this.get()));
        emit(key);
        return;
      }
      let p = sync.pending.get(key);
      if (!p) {
        p = { base: structuredClone(sync.items[key] || { rev: 0, value: null }), fns: [] };
        sync.pending.set(key, p);
      }
      p.fns.push(fn);
      sync.items[key] = { rev: p.base.rev, value: applyAll(key, p.base.value, p.fns) };
      emit(key);
      pushState(key);
    },
  };
}

// Boot: try the backend first (skipped on file:// or with ?LOCAL=1).
if (location.protocol !== 'file:' && !/[?&]local=1/i.test(location.search)) {
  try {
    await pullState();
  } catch {
    if (Object.keys(sync.items).length) sync.mode = 'offline';
  }
  if (sync.mode === 'cloud') await adoptLocalData();
}

/**
 * One-time rescue: settings or lists that were saved on this device before the cloud
 * had them (local mode, not signed in yet, an older storage key) are uploaded when the
 * cloud has nothing for that key. The cloud copy always wins once it exists.
 */
async function adoptLocalData() {
  const read = (k) => {
    try {
      const v = JSON.parse(store.get(k));
      return v && (typeof v !== 'object' || Object.keys(v).length) ? v : null;
    } catch {
      return null;
    }
  };
  const candidates = {
    config: (([c]) => c && Object.fromEntries(Object.entries(c).filter(([k]) => k in CONFIG)))([read(STORE_KEY) || read('omd.settings.v1')]),
    ...Object.fromEntries(['lists', 'chores', 'meals', 'message', 'layouts'].map((k) => [k, read(`omd.${k}.v1`)])),
  };
  await Promise.all(
    Object.entries(candidates).map(async ([key, value]) => {
      if (value == null || sync.items[key]) return;
      try {
        const r = await api(`/state/${key}`, { method: 'PUT', body: JSON.stringify({ rev: 0, value }) });
        if (r.ok) {
          sync.items[key] = { rev: (await r.json()).rev, value };
          console.info(`Uploaded this device's "${key}" to the cloud.`);
        }
      } catch {
        /* try again next boot */
      }
    }),
  );
  saveSyncCache();
}
