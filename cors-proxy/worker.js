/**
 * Minimal read-only CORS proxy for Oh My Dashboard (Cloudflare Workers, free tier).
 *
 * Why: most iCal (.ics) feeds, Google Photos shared albums and some RSS feeds
 * don't send CORS headers, so a static page can't read them directly.
 *
 * Deploy:
 *   1. dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker
 *   2. Replace its code with this file → Deploy
 *   3. In the dashboard settings set CORS_PROXY to  https://<name>.<you>.workers.dev/?url=
 *
 * Optional hardening (Worker → Settings → Variables):
 *   ALLOWED_HOSTS    comma-separated hostnames the proxy may fetch, e.g.
 *                    "calendar.google.com,outlook.office365.com,photos.app.goo.gl,photos.google.com"
 *   ALLOWED_ORIGINS  comma-separated origins allowed to call it, e.g.
 *                    "https://you.github.io,null"   ("null" = opened from file://)
 */
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const list = (v) =>
      (v || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const origins = list(env.ALLOWED_ORIGINS);
    const origin = (request.headers.get('Origin') || '').toLowerCase();
    if (origins.length && !origins.includes(origin)) return new Response('Origin not allowed', { status: 403, headers: cors });

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get('url'));
    } catch {
      return new Response('Missing or invalid ?url=', { status: 400, headers: cors });
    }
    if (!/^https?:$/.test(target.protocol)) return new Response('Only http(s) URLs', { status: 400, headers: cors });
    const hosts = list(env.ALLOWED_HOSTS);
    if (hosts.length && !hosts.some((h) => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
      return new Response('Host not allowed', { status: 403, headers: cors });
    }

    const ttl = Math.max(0, Math.min(300, Math.round(Number(new URL(request.url).searchParams.get('ttl') ?? 300)) || 0));
    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (OhMyDashboard CORS proxy)', Accept: '*/*' },
      redirect: 'follow',
      cf: ttl ? { cacheTtl: ttl, cacheEverything: true } : { cacheTtl: 0 },
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8');
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
