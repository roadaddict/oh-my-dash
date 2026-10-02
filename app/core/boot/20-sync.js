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

/* ---------- Edits not yet in the cloud survive a reload ----------
   An edit made offline (or while the API was down) waits in sync.pending as functions,
   which can't be stored. So the device keeps, per key, the value it last synced from
   (base) and its own value (mine); after a reload the edit is replayed as "my change
   from base, applied to whatever the cloud has now" — see merge3. */
const PENDING_KEY = 'omd.sync-pending.v1';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const byId = (arr) => Array.isArray(arr) && arr.every((x) => isObj(x) && x.id != null);
/**
 * Three-way merge: `mine` changed `base`; `theirs` is someone else's newer version.
 * Objects merge key by key, arrays of { id } item by item (adds, removals and edits on
 * both sides survive); where both changed the same value, mine wins.
 */
function merge3(base, mine, theirs) {
  if (same(mine, base)) return theirs;
  if (same(theirs, base) || theirs === undefined) return mine;
  if (isObj(base) && isObj(mine) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])) {
      const inM = k in mine,
        inT = k in theirs,
        inB = k in base;
      if (!inM && inB && same(theirs[k], base[k])) continue; // I removed it, they didn't touch it
      if (!inT && inB && same(mine[k], base[k])) continue; // they removed it, I didn't touch it
      out[k] = !inM ? theirs[k] : !inT ? mine[k] : merge3(base[k], mine[k], theirs[k]);
    }
    return out;
  }
  if (byId(mine) && byId(theirs) && (base == null || byId(base))) {
    const idx = (a) => new Map((a || []).map((x) => [x.id, x]));
    const b = idx(base),
      m = idx(mine),
      t = idx(theirs);
    const out = [];
    for (const x of theirs) {
      if (!m.has(x.id) && b.has(x.id) && same(x, b.get(x.id))) continue; // I removed it
      out.push(m.has(x.id) ? merge3(b.get(x.id), m.get(x.id), x) : x);
    }
    // Mine that they don't have: new ones go in at my position; ones they removed stay removed unless I changed them.
    mine.forEach((x, i) => {
      if (t.has(x.id)) return;
      if (b.has(x.id) && same(x, b.get(x.id))) return;
      const after = i > 0 ? out.findIndex((y) => y.id === mine[i - 1].id) : -1;
      out.splice(after + 1, 0, x);
    });
    return out;
  }
  return mine;
}
function savePending() {
  if (!sync.pending.size) return store.remove(PENDING_KEY);
  const out = {};
  sync.pending.forEach((p, key) => {
    // `from`: what my edits started from (the defaults, when the cloud had nothing yet).
    out[key] = { base: p.base, from: p.base.value ?? sync.fallbacks[key]?.() ?? null, value: applyAll(key, p.base.value, p.fns) };
  });
  store.set(PENDING_KEY, JSON.stringify(out));
}
try {
  for (const [key, rec] of Object.entries(JSON.parse(store.get(PENDING_KEY) || '{}') || {})) {
    if (!rec?.base) continue;
    sync.pending.set(key, { base: rec.base, fns: [(theirs) => merge3(rec.from, rec.value, theirs)] });
    sync.items[key] = { rev: rec.base.rev, value: rec.value };
  }
} catch {
  /* nothing usable saved */
}

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
  savePending();
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
      saveSyncCache();
      savePending();
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
