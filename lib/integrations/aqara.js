/**
 * Aqara sensors (temperature, humidity, doors, motion, leaks, batteries) through the Aqara Open API.
 *
 * Google Home has no public read API, but Aqara devices paired to an Aqara hub/app keep reporting
 * to the Aqara cloud even when they are also linked to Google Home — that's what this reads.
 * (Matter/Thread sensors paired *only* to Google Home never reach the Aqara cloud.)
 *
 * Setup: create a project at https://developer.aqara.com (Console → Project management), add the
 * redirect URI https://<your-worker-host>/api/aqara/callback and set on the Worker:
 *   AQARA_APP_ID, AQARA_KEY_ID          (variables)
 *   AQARA_APP_KEY                        (secret)
 *   AQARA_REGION                         GER (default, Europe) | USA | CN | KR | RU | SG
 * Then connect once: the settings drawer → Accounts → Connect Aqara (sign-in redirect), or the
 * e-mail/SMS verification-code fallback. Tokens live in this integration's private rows of the D1 "secrets" table.
 *
 * Routes (all behind the API auth):
 *   GET  /api/aqara/status        { configured, connected, region }
 *   GET  /api/aqara/login         → Aqara sign-in → /api/aqara/callback → back to the dashboard
 *   POST /api/aqara/code          { account }            sends a verification code (fallback flow)
 *   POST /api/aqara/verify        { account, code }      exchanges it for tokens
 *   GET  /api/aqara/sensors       normalized readings, cached for 60 s (≈ 1–3 KB)
 *   GET  /api/aqara/raw           devices + raw resource values, for mapping unusual models
 *   POST /api/aqara/logout
 */
import { defineIntegration, json } from '../integration-kit.js';

const REGIONS = {
  CN: 'open-cn.aqara.com',
  USA: 'open-usa.aqara.com',
  KR: 'open-kr.aqara.com',
  RU: 'open-ru.aqara.com',
  GER: 'open-ger.aqara.com',
  SG: 'open-sg.aqara.com',
};
const region = (env) => (REGIONS[(env.AQARA_REGION || 'GER').toUpperCase()] ? (env.AQARA_REGION || 'GER').toUpperCase() : 'GER');
const base = (env) => env.AQARA_API_BASE || `https://${REGIONS[region(env)]}`;
const configured = (env) => !!(env.AQARA_APP_ID && env.AQARA_KEY_ID && env.AQARA_APP_KEY);
const redirectUri = (request) => `${new URL(request.url).origin}/api/aqara/callback`;
const EXPIRED = new Set([108, 109, 110, 111]);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const md5 = async (s) => hex(await crypto.subtle.digest('MD5', new TextEncoder().encode(s)));
const fail = (msg, status = 502, code) => Object.assign(new Error(msg), { status, code });

/** One signed call to the Aqara Open API. */
async function rawCall(env, intent, data, token) {
  const h = { Appid: env.AQARA_APP_ID, Keyid: env.AQARA_KEY_ID, Nonce: hex(crypto.getRandomValues(new Uint8Array(8))), Time: String(Date.now()) };
  const signed = `${token ? `Accesstoken=${token}&` : ''}Appid=${h.Appid}&Keyid=${h.Keyid}&Nonce=${h.Nonce}&Time=${h.Time}${env.AQARA_APP_KEY}`;
  const r = await fetch(`${base(env)}/v3.0/open/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Lang: 'en', ...h, ...(token ? { Accesstoken: token } : {}), Sign: await md5(signed.toLowerCase()) },
    body: JSON.stringify({ intent, data }),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw fail(`Aqara HTTP ${r.status}`);
  if (j.code !== 0) throw fail(`Aqara: ${j.messageDetail || j.msgDetails || j.message || `code ${j.code}`}`, EXPIRED.has(j.code) ? 401 : 502, j.code);
  return j.result;
}

const tokenRecord = (t, prev = {}) => ({
  accessToken: t.accessToken || t.access_token,
  refreshToken: t.refreshToken || t.refresh_token || prev.refreshToken,
  openId: t.openId || t.open_id || prev.openId || null,
  expiresAt: Date.now() + (Number(t.expiresIn || t.expires_in) || 7 * 86400) * 1000,
});

async function refresh(ctx, t) {
  const next = tokenRecord(await rawCall(ctx.env, 'config.auth.refreshToken', { refreshToken: t.refreshToken }), t);
  if (!next.accessToken) throw fail('Aqara token refresh returned no token — reconnect Aqara.', 409);
  await ctx.secrets.put('', next);
  return next;
}

/** Authenticated call with transparent token refresh. */
async function call(ctx, intent, data = {}) {
  let t = await ctx.secrets.get();
  if (!t?.accessToken) throw fail('Aqara is not connected', 409);
  if (t.refreshToken && t.expiresAt - 86400000 < Date.now()) t = await refresh(ctx, t);
  try {
    return await rawCall(ctx.env, intent, data, t.accessToken);
  } catch (e) {
    if (!EXPIRED.has(e.code) || !t.refreshToken) throw e;
    t = await refresh(ctx, t);
    return rawCall(ctx.env, intent, data, t.accessToken);
  }
}

// ---------------------------------------------------------------- normalizing readings

const kindOf = (model = '') =>
  /magnet|contact|door/i.test(model)
    ? 'contact'
    : /motion|occupancy|presence|fp\d/i.test(model)
      ? 'motion'
      : /wleak|flood|leak/i.test(model)
        ? 'leak'
        : /weather|sensor_ht|\.ht\.|airm|airmonitor|tvoc|temp/i.test(model)
          ? 'climate'
          : /gateway|hub|camera|\.acn0|switch|plug|light|bulb|curtain|lock/i.test(model)
            ? 'other'
            : 'sensor';

/** resourceId → reading, using the model's resource descriptions when Aqara provides them. */
function reading(resourceId, raw, desc, kind) {
  const v = Number(raw);
  const d = (desc || '').toLowerCase();
  const has = (re) => re.test(d);
  if (resourceId === '0.1.85' || has(/temperature/)) return Number.isFinite(v) ? { key: 'temperature', value: Math.round(v) / 100, unit: '°C' } : null;
  if (resourceId === '0.2.85' || has(/humidity/)) return Number.isFinite(v) ? { key: 'humidity', value: Math.round(v / 10) / 10, unit: '%' } : null;
  if (has(/illuminance|lux|light level/)) return Number.isFinite(v) ? { key: 'illuminance', value: Math.round(v), unit: 'lx' } : null;
  if (resourceId === '0.3.85' || has(/pressure/)) return Number.isFinite(v) ? { key: 'pressure', value: Math.round(v / 100), unit: 'hPa' } : null;
  if (has(/tvoc/)) return Number.isFinite(v) ? { key: 'tvoc', value: Math.round(v), unit: 'ppb' } : null;
  if (resourceId === '8.0.2001' || has(/battery (level|percent)|remaining battery/))
    return Number.isFinite(v) ? { key: 'battery', value: Math.max(0, Math.min(100, Math.round(v))), unit: '%' } : null;
  if (resourceId === '3.1.85' || has(/open.*close|contact|motion|occup|leak|water/)) {
    if (kind === 'contact' || has(/open|contact/)) return { key: 'contact', value: v === 1 ? 'open' : 'closed' };
    if (kind === 'leak' || has(/leak|water/)) return { key: 'leak', value: v === 1 };
    if (kind === 'motion' || has(/motion|occup/)) return { key: 'motion', value: v === 1 };
  }
  return null;
}

const memo = new Map(); // isolate-local cache: key → { at, value }
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function devices(ctx) {
  return cached('devices', 3600000, async () => {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const r = await call(ctx, 'query.device.info', { pageNum: page, pageSize: 100 });
      const list = r?.data || [];
      all.push(...list);
      if (list.length < 100 || all.length >= (r?.totalCount ?? 0)) break;
    }
    return all;
  });
}

async function positions(ctx) {
  return cached('positions', 3600000, async () => {
    const r = await call(ctx, 'query.position.info', { pageNum: 1, pageSize: 100 }).catch(() => null);
    return Object.fromEntries((r?.data || []).map((p) => [p.positionId, p.positionName]));
  });
}

async function describe(ctx, model) {
  return cached(`res:${model}`, 86400000, async () => {
    const r = await call(ctx, 'query.resource.info', { model }).catch(() => null);
    return Object.fromEntries((Array.isArray(r) ? r : r?.data || []).map((x) => [x.resourceId, `${x.name || ''} ${x.description || ''}`.trim()]));
  });
}

async function values(ctx, dids) {
  const out = [];
  for (let i = 0; i < dids.length; i += 50) {
    const r = await call(ctx, 'query.resource.value', { resources: dids.slice(i, i + 50).map((subjectId) => ({ subjectId })) });
    out.push(...(Array.isArray(r) ? r : r?.data || []));
  }
  return out;
}

async function sensors(ctx) {
  return cached('sensors', 60000, async () => {
    const devs = (await devices(ctx)).filter((d) => kindOf(d.model) !== 'other');
    const [rooms, vals] = await Promise.all([
      positions(ctx),
      values(
        ctx,
        devs.map((d) => d.did),
      ),
    ]);
    const descs = Object.fromEntries(await Promise.all([...new Set(devs.map((d) => d.model))].map(async (m) => [m, await describe(ctx, m)])));
    const byDid = new Map();
    for (const v of vals) (byDid.get(v.subjectId) || byDid.set(v.subjectId, []).get(v.subjectId)).push(v);
    const list = devs
      .map((d) => {
        const kind = kindOf(d.model);
        const readings = {};
        let updated = 0;
        for (const v of byDid.get(d.did) || []) {
          const r = reading(v.resourceId, v.value, descs[d.model]?.[v.resourceId], kind);
          if (!r || r.key in readings) continue;
          readings[r.key] = r.unit ? { value: r.value, unit: r.unit } : { value: r.value };
          if (r.key !== 'battery') updated = Math.max(updated, Number(v.timeStamp) || 0);
        }
        return {
          id: d.did,
          name: d.deviceName || d.model,
          room: rooms[d.positionId] || '',
          model: d.model,
          kind,
          online: d.state !== 0,
          updated: updated || null,
          readings,
        };
      })
      .filter((s) => Object.keys(s.readings).some((k) => k !== 'battery'));
    list.sort((a, b) => (a.room || '').localeCompare(b.room || '') || a.name.localeCompare(b.name));
    return { sensors: list, at: Date.now() };
  });
}

// ---------------------------------------------------------------- routes

async function handle(request, ctx, path) {
  const env = ctx.env;
  if (path === 'status')
    return json({ configured: configured(env), connected: configured(env) && !!(await ctx.secrets.get())?.accessToken, region: region(env) });
  if (!configured(env)) return json({ error: 'Set AQARA_APP_ID, AQARA_KEY_ID and AQARA_APP_KEY on the Worker first.' }, 409);

  if (path === 'login') {
    const state = await ctx.oauth.newState();
    const q = new URLSearchParams({ client_id: env.AQARA_APP_ID, response_type: 'code', redirect_uri: redirectUri(request), state, theme: '0', lang: 'en' });
    return Response.redirect(`${base(env)}/v3.0/open/authorize?${q}`, 302);
  }
  if (path === 'callback') {
    const u = new URL(request.url);
    if (!u.searchParams.get('code')) return Response.redirect(`${u.origin}/?aqara=${encodeURIComponent(u.searchParams.get('error') || 'denied')}#hub`, 302);
    if (!(await ctx.oauth.checkState(u.searchParams.get('state'))))
      return json({ error: 'Invalid or expired OAuth state — start again from the dashboard.' }, 400);
    const r = await fetch(`${base(env)}/v3.0/open/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.AQARA_APP_ID,
        client_secret: env.AQARA_APP_KEY,
        redirect_uri: redirectUri(request),
        grant_type: 'authorization_code',
        code: u.searchParams.get('code'),
      }),
    });
    const j = await r.json().catch(() => ({}));
    const t = j.result && typeof j.result === 'object' ? j.result : j;
    if (!(t.accessToken || t.access_token))
      return json({ error: `Aqara token exchange failed: ${j.message || j.error_description || j.error || r.status}` }, 502);
    await ctx.secrets.put('', tokenRecord(t));
    memo.clear();
    return Response.redirect(`${u.origin}/?aqara=connected#hub`, 302);
  }
  if (request.method === 'POST' && (path === 'code' || path === 'verify')) {
    const b = await request.json().catch(() => ({}));
    const account = String(b.account || '').trim();
    if (!account) return json({ error: 'account (Aqara e-mail or phone) is required' }, 400);
    if (path === 'code') {
      await rawCall(ctx.env, 'config.auth.getAuthCode', { account, accountType: 0, accessTokenValidity: '1y' });
      return json({ ok: true });
    }
    const t = await rawCall(ctx.env, 'config.auth.getToken', { authCode: String(b.code || '').trim(), account, accountType: 0 });
    await ctx.secrets.put('', tokenRecord(t));
    memo.clear();
    return json({ ok: true });
  }
  if (path === 'logout' && request.method === 'POST') {
    await ctx.secrets.delete();
    memo.clear();
    return json({ ok: true });
  }

  if (path === 'sensors') return json(await sensors(ctx), 200, { 'Cache-Control': 'private, max-age=30' });
  if (path === 'raw') {
    const devs = await devices(ctx);
    return json({
      devices: devs,
      values: await values(
        ctx,
        devs.map((d) => d.did),
      ),
    });
  }
  return json({ error: 'not found' }, 404);
}

export default defineIntegration({
  id: 'aqara',
  env: ['AQARA_APP_ID', 'AQARA_KEY_ID', 'AQARA_APP_KEY', 'AQARA_REGION', 'AQARA_API_BASE'],
  handle,
});
