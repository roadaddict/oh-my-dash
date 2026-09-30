/**
 * Finnhub: stock quotes for the Markets widget.
 *
 * Setup: a free key at https://finnhub.io, then
 *   npx wrangler secret put FINNHUB_TOKEN
 *
 *   GET /api/finnhub/status                   { configured }
 *   GET /api/finnhub/quotes?symbols=AAPL,MSFT { quotes: [{ sym, price, change }] }   (change = % today)
 * Quotes are cached for a minute, so several screens cost one call per symbol.
 */
import { defineIntegration, json, fail } from '../integration-kit.js';

const base = (env) => env.FINNHUB_BASE || 'https://finnhub.io/api/v1';
const memo = new Map(); // symbol → { at, quote }

async function quote(env, sym) {
  const hit = memo.get(sym);
  if (hit && Date.now() - hit.at < 60000) return hit.quote;
  const r = await fetch(`${base(env)}/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(String(env.FINNHUB_TOKEN).trim())}`);
  if (r.status === 401 || r.status === 403) throw fail('Finnhub refused the token — check the FINNHUB_TOKEN secret', 409);
  if (r.status === 429) throw fail('Finnhub rate limit — try again in a minute', 429);
  if (!r.ok) throw fail(`Finnhub HTTP ${r.status}`);
  const q = await r.json();
  const value = { sym, price: q.c, change: q.dp };
  memo.set(sym, { at: Date.now(), quote: value });
  return value;
}

async function handle(request, ctx, path) {
  const env = ctx.env;
  const configured = !!String(env.FINNHUB_TOKEN || '').trim();
  if (path === 'status') return json({ configured });
  if (!configured) return json({ error: 'Set the FINNHUB_TOKEN secret on the Worker first (README → Secrets).' }, 409);
  if (path !== 'quotes') return json({ error: 'not found' }, 404);
  const symbols = [
    ...new Set(
      (new URL(request.url).searchParams.get('symbols') || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9.:^-]{1,20}$/.test(s)),
    ),
  ].slice(0, 25);
  if (!symbols.length) return json({ error: '"symbols" is required' }, 400);
  return json({ quotes: await Promise.all(symbols.map((s) => quote(env, s))) }, 200, { 'Cache-Control': 'private, max-age=60' });
}

export default defineIntegration({ id: 'finnhub', env: ['FINNHUB_TOKEN', 'FINNHUB_BASE'], handle });
