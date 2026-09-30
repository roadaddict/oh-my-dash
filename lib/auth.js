/**
 * Request authorisation for the dashboard API.
 *
 * A request is allowed when ANY of these is true:
 *   1. It carries a valid Cloudflare Access JWT (family members who signed in with Google).
 *      Needs env ACCESS_TEAM_DOMAIN (e.g. "myfamily.cloudflareaccess.com") and ACCESS_AUD.
 *   2. It comes from an IP / CIDR listed in env ALLOWED_IPS (e.g. the tablet on home Wi-Fi).
 *   3. env OPEN_API === "true" (local development only — never set this in production).
 * With nothing configured the API refuses every request (secure by default).
 */

let certCache = { team: '', at: 0, keys: [] };

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const decodeJSON = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function accessKeys(team, fetchImpl = fetch) {
  if (certCache.team === team && Date.now() - certCache.at < 3600e3 && certCache.keys.length) return certCache.keys;
  const r = await fetchImpl(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access certs HTTP ${r.status}`);
  const j = await r.json();
  certCache = { team, at: Date.now(), keys: j.keys || [] };
  return certCache.keys;
}

/** Returns the signed-in email (or service-token name) for a valid Access JWT, else null. */
export async function verifyAccessJwt(token, env, fetchImpl = fetch) {
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = decodeJSON(h),
      payload = decodeJSON(p);
    const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (payload.iss !== `https://${team}`) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (!(payload.exp * 1000 > Date.now())) return null;
    const jwk = (await accessKeys(team, fetchImpl)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    return ok ? payload.email || payload.common_name || 'service-token' : null;
  } catch {
    return null;
  }
}

function parseIp(ip) {
  ip = (ip || '').trim();
  if (ip.includes(':')) {
    const [head, tail] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail !== undefined && tail ? tail.split(':') : [];
    if (tail === undefined && h.length !== 8) return null;
    const parts = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return null;
    return { v: 6, n: parts.reduce((a, x) => (a << 16n) + BigInt(parseInt(x, 16)), 0n) };
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return { v: 4, n: p.reduce((a, x) => (a << 8n) + BigInt(x), 0n) };
}

/** True when `ip` is inside `cidr` ("203.0.113.7", "203.0.113.0/24", "2001:db8:1234::/48"). */
export function ipInCidr(ip, cidr) {
  const [base, bitsText] = cidr.trim().split('/');
  const a = parseIp(ip),
    b = parseIp(base);
  if (!a || !b || a.v !== b.v) return false;
  const total = a.v === 4 ? 32 : 128;
  const bits = bitsText === undefined ? total : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > total) return false;
  const shift = BigInt(total - bits);
  return a.n >> shift === b.n >> shift;
}

const cookie = (request, name) =>
  (request.headers.get('Cookie') || '')
    .split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** Resolves to an identity string when the request is allowed, else null. */
export async function authorize(request, env) {
  if (env.OPEN_API === 'true') return 'open-api';
  const email = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization'), env);
  if (email) return email;
  const ip = request.headers.get('CF-Connecting-IP');
  const allowed = (env.ALLOWED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ip && allowed.some((c) => ipInCidr(ip, c))) return `ip:${ip}`;
  return null;
}

export function authConfigured(env) {
  return env.OPEN_API === 'true' || !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) || !!(env.ALLOWED_IPS || '').trim();
}
