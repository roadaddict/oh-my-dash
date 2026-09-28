/**
 * Server-only storage for OAuth tokens (Spotify, Aqara). Lives in its own D1 table
 * and is never returned by /api/state, so tokens don't reach any browser.
 */
let ready = null;
async function table(env) {
  if (!env.DB) throw Object.assign(new Error('D1 binding "DB" is missing.'), { status: 500 });
  if (!ready) {
    ready = env.DB.prepare('CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
      .run().catch((e) => { ready = null; throw e; });
  }
  await ready;
  return env.DB;
}

export async function getSecret(env, key) {
  const row = await (await table(env)).prepare('SELECT value FROM secrets WHERE key = ?1').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

export async function putSecret(env, key, value) {
  await (await table(env)).prepare('INSERT INTO secrets (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3')
    .bind(key, JSON.stringify(value), Date.now()).run();
}

export async function deleteSecret(env, key) {
  await (await table(env)).prepare('DELETE FROM secrets WHERE key = ?1').bind(key).run();
}

/** One-time OAuth `state` values (CSRF protection), valid for 10 minutes. */
export async function newOAuthState(env, provider) {
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await putSecret(env, `oauth_state:${provider}`, { state, at: Date.now() });
  return state;
}
export async function checkOAuthState(env, provider, state) {
  const saved = await getSecret(env, `oauth_state:${provider}`);
  await deleteSecret(env, `oauth_state:${provider}`);
  return !!saved && saved.state === state && Date.now() - saved.at < 10 * 60000;
}
