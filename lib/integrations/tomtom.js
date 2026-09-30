/**
 * TomTom: live-traffic drive times for the Commute widget.
 *
 * Setup: developer.tomtom.com → sign up → your "My first API key" (2,500 requests a day
 * is plenty), then
 *   npx wrangler secret put TOMTOM_KEY
 *
 *   GET /api/tomtom/status                                   { configured }
 *   GET /api/tomtom/route?from=lat,lon&to=lat,lon            { mins, delay, km }   (delay = minutes of traffic)
 * Routes are cached for two minutes.
 */
import { defineIntegration, json, fail } from '../integration-kit.js';

const base = (env) => env.TOMTOM_BASE || 'https://api.tomtom.com';
const memo = new Map(); // "from|to" → { at, route }
const point = (s) => {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s || '');
  if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) return null;
  return `${(+m[1]).toFixed(5)},${(+m[2]).toFixed(5)}`;
};

async function handle(request, ctx, path) {
  const env = ctx.env;
  const configured = !!String(env.TOMTOM_KEY || '').trim();
  if (path === 'status') return json({ configured });
  if (!configured) return json({ error: 'Set the TOMTOM_KEY secret on the Worker first (README → Secrets).' }, 409);
  if (path !== 'route') return json({ error: 'not found' }, 404);
  const q = new URL(request.url).searchParams;
  const from = point(q.get('from')),
    to = point(q.get('to'));
  if (!from || !to) return json({ error: '"from" and "to" must be "lat,lon"' }, 400);
  const key = `${from}|${to}`,
    hit = memo.get(key);
  if (hit && Date.now() - hit.at < 120000) return json(hit.route);
  const r = await fetch(
    `${base(env)}/routing/1/calculateRoute/${from}:${to}/json?traffic=true&departAt=now&key=${encodeURIComponent(String(env.TOMTOM_KEY).trim())}`,
  );
  if (r.status === 403 || r.status === 401) throw fail('TomTom refused the key — check the TOMTOM_KEY secret', 409);
  if (!r.ok) throw fail(`TomTom HTTP ${r.status}`);
  const s = (await r.json()).routes?.[0]?.summary;
  if (!s) throw fail('TomTom found no route', 404);
  const route = { mins: s.travelTimeInSeconds / 60, delay: (s.trafficDelayInSeconds || 0) / 60, km: s.lengthInMeters / 1000 };
  memo.set(key, { at: Date.now(), route });
  return json(route);
}

export default defineIntegration({ id: 'tomtom', env: ['TOMTOM_KEY', 'TOMTOM_BASE'], handle });
