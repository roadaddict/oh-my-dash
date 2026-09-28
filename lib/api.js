/**
 * Dashboard API — routed by src/worker.js for every /api/* request.
 *
 *   GET  /api/ping            public: 204, used for the latency chip
 *   GET  /api/health          public: { ok, authorized, db, authConfigured, ip }
 *   GET  /api/state           all shared keys → { items: { key: { rev, value, … } } }
 *   GET  /api/state/:key      one key
 *   PUT  /api/state/:key      { rev, value } — optimistic concurrency, 409 + latest on conflict
 *   GET  /api/proxy?url=…     same-origin fetch for iCal / RSS / photo / flight feeds (&ttl=seconds, default 300)
 *        /api/spotify/*       Now Playing + playback control (lib/spotify.js)
 *        /api/aqara/*         Aqara sensor readings (lib/aqara.js)
 *        /api/lists[/add]     shared lists for phone shortcuts (lib/lists.js)
 *        /api/strava/*        family Strava stats (lib/strava.js)
 */
import { authorize, authConfigured } from './auth.js';
import { database, json, MAX_VALUE_BYTES, STATE_KEYS } from './http.js';
import { handleSpotify } from './spotify.js';
import { handleAqara } from './aqara.js';
import { handleLists } from './lists.js';
import { handleStrava } from './strava.js';

async function current(db, key) {
  const row = await db.prepare('SELECT value, rev, updated_at, updated_by FROM kv WHERE key = ?1').bind(key).first();
  return row ? { rev: row.rev, value: JSON.parse(row.value), updated_at: row.updated_at, updated_by: row.updated_by } : { rev: 0, value: null };
}

async function listState(request, env) {
  const db = await database(env);
  // Cheap revision check first: the tablet polls every 15 s, and most polls find nothing new.
  const { results: revs } = await db.prepare('SELECT key, rev FROM kv ORDER BY key').all();
  const etag = `"s-${revs.map((r) => `${r.key}.${r.rev}`).join('-') || 'empty'}"`;
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
  const { results } = await db.prepare('SELECT key, value, rev, updated_at, updated_by FROM kv').all();
  const items = {};
  for (const r of results) items[r.key] = { rev: r.rev, value: JSON.parse(r.value), updated_at: r.updated_at, updated_by: r.updated_by };
  return json({ items, now: Date.now() }, 200, { ETag: etag });
}

async function putState(request, env, key, user) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const rev = Number.isInteger(body?.rev) && body.rev >= 0 ? body.rev : null;
  if (rev === null) return json({ error: '"rev" must be a non-negative integer' }, 400);
  const value = JSON.stringify(body.value ?? null);
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) return json({ error: 'value too large' }, 413);

  const db = await database(env);
  const now = Date.now();
  const res = rev === 0
    ? await db.prepare('INSERT INTO kv (key, value, rev, updated_at, updated_by) VALUES (?1, ?2, 1, ?3, ?4) ON CONFLICT(key) DO NOTHING').bind(key, value, now, user).run()
    : await db.prepare('UPDATE kv SET value = ?2, rev = rev + 1, updated_at = ?3, updated_by = ?4 WHERE key = ?1 AND rev = ?5').bind(key, value, now, user, rev).run();
  if (res.meta.changes === 1) return json({ rev: rev + 1, updated_at: now, updated_by: user });
  return json({ error: 'conflict', ...(await current(db, key)) }, 409);
}

async function proxy(request, env) {
  const self = new URL(request.url);
  let target;
  try { target = new URL(self.searchParams.get('url')); } catch { return new Response('Missing or invalid ?url=', { status: 400 }); }
  if (!/^https?:$/.test(target.protocol)) return new Response('Only http(s) URLs', { status: 400 });
  if (target.host === self.host) return new Response('Refusing to proxy this site', { status: 400 });
  const hosts = (env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (hosts.length && !hosts.some((h) => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
    return new Response('Host not allowed', { status: 403 });
  }
  const ttl = Math.max(0, Math.min(300, Math.round(Number(self.searchParams.get('ttl') ?? 300)) || 0));
  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (OhMyDashboard feed proxy)', Accept: '*/*' },
    redirect: 'follow',
    cf: ttl ? { cacheTtl: ttl, cacheEverything: true } : { cacheTtl: 0 },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
      'Cache-Control': `private, max-age=${ttl}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  // Latency probe for the status bar: answered at the nearest Cloudflare edge, no body.
  if (pathname === '/api/ping') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  const user = await authorize(request, env);

  // Health is public so the page can tell "no backend" from "not signed in".
  // `ip` is the public address this request came from — copy it into ALLOWED_IPS for a Bypass policy.
  if (pathname === '/api/health') return json({ ok: true, authorized: !!user, db: !!env.DB, authConfigured: authConfigured(env), ip: request.headers.get('CF-Connecting-IP') || null });

  if (!user) {
    return json({
      error: 'unauthorized',
      hint: authConfigured(env)
        ? 'Sign in through Cloudflare Access, or add this network to ALLOWED_IPS.'
        : 'API auth is not configured: set ACCESS_TEAM_DOMAIN + ACCESS_AUD and/or ALLOWED_IPS on the Worker.',
    }, 401);
  }

  try {
    const m = /^\/api\/state(?:\/([^/]+))?\/?$/.exec(pathname);
    if (m) {
      const key = m[1] && decodeURIComponent(m[1]);
      if (!key) return request.method === 'GET' ? await listState(request, env) : json({ error: 'method not allowed' }, 405);
      if (!STATE_KEYS.has(key)) return json({ error: 'unknown key' }, 404);
      if (request.method === 'GET') return json(await current(await database(env), key));
      if (request.method === 'PUT') return await putState(request, env, key, user);
      return json({ error: 'method not allowed' }, 405);
    }
    const lists = /^\/api\/lists(?:\/([a-z]+))?\/?$/.exec(pathname);
    if (lists) return await handleLists(request, env, lists[1] || '');
    const svc = /^\/api\/(spotify|aqara|strava)\/([a-z]+)\/?$/.exec(pathname);
    if (svc) return await ({ spotify: handleSpotify, aqara: handleAqara, strava: handleStrava })[svc[1]](request, env, svc[2]);
    if (pathname === '/api/proxy') return request.method === 'GET' ? await proxy(request, env) : json({ error: 'method not allowed' }, 405);
    return json({ error: 'not found' }, 404);
  } catch (err) {
    return json({ error: err.message || String(err) }, err.status || 500);
  }
}
