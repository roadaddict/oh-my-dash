/**
 * Strava stats for the family: this week (per day), last 4 weeks, this year, last activity.
 *
 * Setup: https://www.strava.com/settings/api → create an app, "Authorization Callback Domain"
 * = your dashboard's host (e.g. oh-my-dashboard.<you>.workers.dev). Worker variables:
 *   STRAVA_CLIENT_ID (text), STRAVA_CLIENT_SECRET (secret)
 * New Strava apps may only allow ONE connected athlete (the app owner). For a second person,
 * either ask Strava for more capacity, or let them create their own app and add it as
 *   STRAVA_CLIENT_ID_2 / STRAVA_CLIENT_SECRET_2   (their "Connect" button then uses app 2).
 * Each person connects once (⚙ → Accounts). Tokens stay in this integration's private rows of the D1 "secrets" table.
 *
 *   GET  /api/strava/status          { configured, apps: [1, 2?], athletes: [{ id, name, avatar, app }] }
 *   GET  /api/strava/login?app=1     → Strava consent → /api/strava/callback → back to the dashboard
 *   GET  /api/strava/stats?today=YYYY-MM-DD&weekStart=1&sports=Run,Ride
 *                                    per-athlete summary (~1 KB each), cached 15 min
 *   POST /api/strava/logout          { id }
 */
import { defineIntegration, json } from '../integration-kit.js';

const base = (env) => env.STRAVA_BASE || 'https://www.strava.com';
const clean = (v) => String(v ?? '').trim(); // pasted values sometimes carry a space or newline
const apps = (env) =>
  [
    { n: 1, id: clean(env.STRAVA_CLIENT_ID), secret: clean(env.STRAVA_CLIENT_SECRET) },
    { n: 2, id: clean(env.STRAVA_CLIENT_ID_2), secret: clean(env.STRAVA_CLIENT_SECRET_2) },
  ].filter((a) => a.id && a.secret);
const appFor = (env, n) => apps(env).find((a) => a.n === Number(n)) || apps(env)[0];
const redirectUri = (request) => `${new URL(request.url).origin}/api/strava/callback`;
const fail = (msg, status = 502) => Object.assign(new Error(msg), { status });

/** Sport groups shown on the dashboard. */
const GROUPS = {
  Run: ['Run', 'TrailRun', 'VirtualRun'],
  Ride: ['Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide', 'EMountainBikeRide', 'Velomobile', 'Handcycle'],
  Walk: ['Walk', 'Hike'],
  Swim: ['Swim'],
};
const groupOf = (t) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(t)) || 'Other';

async function athletes(ctx) {
  return (await ctx.secrets.get('index')) || [];
}
async function setAthletes(ctx, list) {
  await ctx.secrets.put('index', list);
}

async function token(ctx, id) {
  const env = ctx.env;
  const t = await ctx.secrets.get(String(id));
  if (!t) throw fail('athlete not connected', 409);
  if (t.expires_at * 1000 - 60000 > Date.now()) return t.access_token;
  const app = appFor(env, t.app);
  if (!app) throw fail('Strava app keys missing on the Worker', 409);
  const r = await fetch(`${base(env)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw fail(`Strava token refresh failed (${r.status}) — reconnect in ⚙ → Accounts`, 409);
  await ctx.secrets.put(String(id), { ...t, access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: j.expires_at });
  return j.access_token;
}

async function activitiesSince(ctx, id, afterSec) {
  const env = ctx.env;
  const tok = await token(ctx, id),
    out = [];
  for (let page = 1; page <= 6; page++) {
    const r = await fetch(`${base(env)}/api/v3/athlete/activities?after=${afterSec}&per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (r.status === 429) throw fail('Strava rate limit — try again in a few minutes', 429);
    if (r.status === 401)
      throw fail('Strava needs permission to read activities — reconnect in ⚙ → Accounts and keep “View data about your private activities” ticked', 409);
    if (!r.ok) throw fail(`Strava HTTP ${r.status}`);
    const list = await r.json();
    out.push(...list);
    if (list.length < 200) break;
  }
  return out;
}

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const r1 = (x) => Math.round(x * 10) / 10;

/** Everything the widget shows, from activities in the athlete's local time. */
function summarize(acts, today, weekStart, sports) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const week0 = addDays(today, -((dow - weekStart + 7) % 7)),
    four0 = addDays(today, -27),
    year = today.slice(0, 4);
  const prev0 = addDays(week0, -7),
    prevSameDay = addDays(today, -7); // last week, and last week up to today's weekday
  const prevWeek = { km: 0, toDate: 0 };
  const pick = sports.length ? acts.filter((a) => sports.includes(groupOf(a.sport_type || a.type))) : acts;
  const empty = () => ({ km: 0, time: 0, count: 0, bySport: {} });
  const week = { ...empty(), days: [0, 0, 0, 0, 0, 0, 0] },
    four = empty(),
    ytd = empty();
  const add = (bucket, a, km) => {
    bucket.km += km;
    bucket.time += a.moving_time || 0;
    bucket.count++;
    const g = groupOf(a.sport_type || a.type);
    bucket.bySport[g] = (bucket.bySport[g] || 0) + km;
  };
  let last = null;
  for (const a of pick) {
    const day = String(a.start_date_local || a.start_date || '').slice(0, 10),
      km = (a.distance || 0) / 1000;
    if (!day || day > today) continue;
    if (day >= week0) {
      add(week, a, km);
      week.days[Math.round((Date.parse(day) - Date.parse(week0)) / 864e5)] += km;
    } else if (day >= prev0) {
      prevWeek.km += km;
      if (day <= prevSameDay) prevWeek.toDate += km;
    }
    if (day >= four0) add(four, a, km);
    if (day.slice(0, 4) === year) add(ytd, a, km);
    if (!last || (a.start_date || '') > (last.start_date || '')) last = a;
  }
  const tidy = (b) => ({
    ...b,
    km: r1(b.km),
    bySport: Object.fromEntries(
      Object.entries(b.bySport)
        .map(([k, v]) => [k, r1(v)])
        .sort((x, y) => y[1] - x[1]),
    ),
  });
  return {
    week: { ...tidy(week), days: week.days.map(r1), start: week0 },
    lastWeek: { km: r1(prevWeek.km), toDate: r1(prevWeek.toDate) },
    fourWeeks: tidy(four),
    year: { ...tidy(ytd), year },
    last: last && {
      name: last.name,
      sport: groupOf(last.sport_type || last.type),
      type: last.sport_type || last.type,
      km: r1((last.distance || 0) / 1000),
      time: last.moving_time || 0,
      date: last.start_date_local || last.start_date,
    },
  };
}

const memo = new Map(); // `${id}|${query}` → { at, value }

async function handle(request, ctx, path) {
  const env = ctx.env;
  const u = new URL(request.url);
  if (path === 'status') {
    // Names only (never values) of the variables the running Worker can't see — helps spot build-vs-runtime mix-ups.
    const missing = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'].filter((k) => !String(env[k] ?? '').trim());
    return json({
      configured: apps(env).length > 0,
      apps: apps(env).map((a) => a.n),
      athletes: apps(env).length ? await athletes(ctx) : [],
      ...(missing.length ? { missing } : {}),
    });
  }
  if (!apps(env).length) return json({ error: 'Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET on the Worker first.' }, 409);

  if (path === 'login') {
    const app = appFor(env, u.searchParams.get('app'));
    const state = await ctx.oauth.newState(String(app.n)); // "<app>.<random>": the callback knows which app
    const q = new URLSearchParams({
      client_id: app.id,
      redirect_uri: redirectUri(request),
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state,
    });
    return Response.redirect(`${base(env)}/oauth/authorize?${q}`, 302);
  }
  if (path === 'callback') {
    const state = u.searchParams.get('state') || '';
    if (u.searchParams.get('error') || !u.searchParams.get('code'))
      return Response.redirect(`${u.origin}/?strava=${encodeURIComponent(u.searchParams.get('error') || 'denied')}`, 302);
    if (!(await ctx.oauth.checkState(state))) return json({ error: 'Invalid or expired OAuth state — start again from the dashboard.' }, 400);
    const app = appFor(env, state.split('.')[0]);
    const r = await fetch(`${base(env)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, code: u.searchParams.get('code'), grant_type: 'authorization_code' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token || !j.athlete?.id) {
      const capacity = /limit|capacity/i.test(JSON.stringify(j)) ? ' This Strava app may be limited to one athlete: see README → Strava.' : '';
      return json({ error: `Strava sign-in failed (${r.status}).${capacity}` }, 502);
    }
    const a = j.athlete,
      avatar = /^https?:/.test(a.profile_medium || '') ? a.profile_medium : null;
    const who = { id: a.id, name: a.firstname || a.username || `Athlete ${a.id}`, avatar, app: app.n };
    await ctx.secrets.put(String(a.id), {
      app: app.n,
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at,
      scope: u.searchParams.get('scope') || '',
    });
    await setAthletes(ctx, [...(await athletes(ctx)).filter((x) => x.id !== a.id), who]);
    memo.clear();
    return Response.redirect(`${u.origin}/?strava=connected`, 302);
  }
  if (path === 'logout' && request.method === 'POST') {
    const { id } = await request.json().catch(() => ({}));
    if (!/^\d+$/.test(String(id))) return json({ error: 'id is required' }, 400);
    await ctx.secrets.delete(String(id));
    await setAthletes(
      ctx,
      (await athletes(ctx)).filter((x) => String(x.id) !== String(id)),
    );
    memo.clear();
    return json({ ok: true });
  }
  if (path === 'stats') {
    const today = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('today') || '') ? u.searchParams.get('today') : new Date().toISOString().slice(0, 10);
    const weekStart = Math.max(0, Math.min(6, Number(u.searchParams.get('weekStart') ?? 1) || 0));
    const sports = (u.searchParams.get('sports') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => GROUPS[s] || s === 'Other');
    // One fetch covers this year and the last 4 weeks (which may reach into last year).
    const from = [addDays(today, -27), `${today.slice(0, 4)}-01-01`].sort()[0];
    const afterSec = Math.floor(Date.parse(`${addDays(from, -1)}T00:00:00Z`) / 1000);
    const out = await Promise.all(
      (await athletes(ctx)).map(async (a) => {
        const key = `${a.id}|${today}|${weekStart}|${sports}`,
          hit = memo.get(key);
        if (hit && Date.now() - hit.at < 15 * 60000) return hit.value;
        try {
          const value = { ...a, ...summarize(await activitiesSince(ctx, a.id, afterSec), today, weekStart, sports) };
          memo.set(key, { at: Date.now(), value });
          return value;
        } catch (e) {
          return { ...a, error: e.message };
        }
      }),
    );
    return json({ athletes: out }, 200, { 'Cache-Control': 'private, max-age=300' });
  }
  return json({ error: 'not found' }, 404);
}

export default defineIntegration({
  id: 'strava',
  env: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_CLIENT_ID_2', 'STRAVA_CLIENT_SECRET_2', 'STRAVA_BASE'],
  handle,
});
