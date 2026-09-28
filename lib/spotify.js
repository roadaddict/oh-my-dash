/**
 * Spotify "Now Playing" + remote control through the Web API (Premium needed for control).
 *
 * Setup: create an app at https://developer.spotify.com/dashboard, add the redirect URI
 *   https://<your-worker-host>/api/spotify/callback
 * and set Worker secrets SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET. Then open
 * /api/spotify/login once from any signed-in device; the refresh token is stored in
 * the private D1 "secrets" table and shared by every screen.
 *
 * Routes (all behind the API auth):
 *   GET  /api/spotify/status      { configured, connected }
 *   GET  /api/spotify/login       → Spotify consent → /api/spotify/callback → back to the dashboard
 *   GET  /api/spotify/now         trimmed playback state (≈ 0.5 KB)
 *   GET  /api/spotify/devices     Spotify Connect devices (Google Home / Nest speakers appear here)
 *   GET  /api/spotify/playlists   your playlists
 *   POST /api/spotify/player      { action: play|pause|next|previous|transfer|volume, context_uri?, device_id?, value? }
 *   POST /api/spotify/logout
 */
import { json } from './http.js';
import { getSecret, putSecret, deleteSecret, newOAuthState, checkOAuthState } from './secrets.js';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';
const accountsBase = (env) => env.SPOTIFY_ACCOUNTS_BASE || 'https://accounts.spotify.com';
const apiBase = (env) => env.SPOTIFY_API_BASE || 'https://api.spotify.com/v1';
const configured = (env) => !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
const redirectUri = (request) => `${new URL(request.url).origin}/api/spotify/callback`;
const basicAuth = (env) => `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`;

async function tokenRequest(env, form) {
  const r = await fetch(`${accountsBase(env)}/api/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(`Spotify token error: ${j.error_description || j.error || r.status}`), { status: 502 });
  return j;
}

/** Valid access token, refreshed when it's about to expire. */
async function accessToken(env) {
  const t = await getSecret(env, 'spotify');
  if (!t?.refresh_token) throw Object.assign(new Error('Spotify is not connected'), { status: 409 });
  if (t.access_token && t.expires_at - 60000 > Date.now()) return t.access_token;
  const j = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const next = { access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  await putSecret(env, 'spotify', next);
  return next.access_token;
}

async function sp(env, path, init = {}) {
  const token = await accessToken(env);
  const r = await fetch(`${apiBase(env)}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const reason = j?.error?.reason || '';
    const msg = reason === 'NO_ACTIVE_DEVICE' ? 'No active Spotify device — pick a speaker first'
      : reason === 'PREMIUM_REQUIRED' ? 'Spotify Premium is required for playback control'
      : j?.error?.message || `Spotify HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status === 401 ? 502 : r.status, reason });
  }
  return j;
}

const pickImage = (images, min = 64) => {
  const list = (images || []).filter((i) => i?.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (list.find((i) => (i.width || 0) >= min) || list[list.length - 1])?.url || null;
};
const trimDevice = (d) => d && { id: d.id, name: d.name, type: d.type, active: !!d.is_active, volume: d.volume_percent ?? null, canVolume: d.supports_volume !== false };

export async function handleSpotify(request, env, path) {
  if (path === 'status') return json({ configured: configured(env), connected: configured(env) && !!(await getSecret(env, 'spotify'))?.refresh_token });
  if (!configured(env)) return json({ error: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the Worker first.' }, 409);

  if (path === 'login') {
    const state = await newOAuthState(env, 'spotify');
    const q = new URLSearchParams({ client_id: env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(request), scope: SCOPES, state });
    return Response.redirect(`${accountsBase(env)}/authorize?${q}`, 302);
  }
  if (path === 'callback') {
    const u = new URL(request.url);
    if (u.searchParams.get('error')) return Response.redirect(`${u.origin}/?spotify=${encodeURIComponent(u.searchParams.get('error'))}#hub`, 302);
    if (!(await checkOAuthState(env, 'spotify', u.searchParams.get('state')))) return json({ error: 'Invalid or expired OAuth state — start again from the dashboard.' }, 400);
    const j = await tokenRequest(env, { grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: redirectUri(request) });
    await putSecret(env, 'spotify', { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
    return Response.redirect(`${u.origin}/?spotify=connected#hub`, 302);
  }
  if (path === 'logout' && request.method === 'POST') { await deleteSecret(env, 'spotify'); return json({ ok: true }); }

  if (path === 'now') {
    const p = await sp(env, '/me/player?additional_types=episode');
    if (!p) return json({ active: false });
    const it = p.item || {};
    return json({
      active: true, playing: !!p.is_playing, progress: p.progress_ms ?? 0, duration: it.duration_ms ?? 0,
      title: it.name || '', artist: (it.artists || []).map((a) => a.name).join(', ') || it.show?.name || '',
      album: it.album?.name || '', image: pickImage(it.album?.images || it.images, 250), uri: it.uri || null,
      context: p.context?.uri || null, shuffle: !!p.shuffle_state, device: trimDevice(p.device),
    }, 200, { 'Cache-Control': 'no-store' });
  }
  if (path === 'devices') return json({ devices: ((await sp(env, '/me/player/devices'))?.devices || []).map(trimDevice) });
  if (path === 'playlists') {
    const j = await sp(env, '/me/playlists?limit=50');
    return json({ playlists: (j?.items || []).filter(Boolean).map((pl) => ({ id: pl.id, name: pl.name, uri: pl.uri, image: pickImage(pl.images, 60), owner: pl.owner?.display_name || '' })) },
      200, { 'Cache-Control': 'private, max-age=300' });
  }
  if (path === 'player' && request.method === 'POST') {
    const b = await request.json().catch(() => ({}));
    const dev = b.device_id ? `?device_id=${encodeURIComponent(b.device_id)}` : '';
    switch (b.action) {
      case 'play': await sp(env, `/me/player/play${dev}`, { method: 'PUT', body: b.context_uri ? JSON.stringify({ context_uri: b.context_uri }) : undefined }); break;
      case 'pause': await sp(env, `/me/player/pause${dev}`, { method: 'PUT' }); break;
      case 'next': await sp(env, `/me/player/next${dev}`, { method: 'POST' }); break;
      case 'previous': await sp(env, `/me/player/previous${dev}`, { method: 'POST' }); break;
      case 'transfer': await sp(env, '/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [b.device_id], play: true }) }); break;
      case 'volume': await sp(env, `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(b.value)))}${b.device_id ? `&device_id=${encodeURIComponent(b.device_id)}` : ''}`, { method: 'PUT' }); break;
      default: return json({ error: 'unknown action' }, 400);
    }
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}
