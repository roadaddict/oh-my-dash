/**
 * Server-only storage for integrations' tokens. Lives in its own D1 table and is never
 * returned by /api/state, so tokens don't reach any browser. Integrations don't use this
 * directly: lib/integration-host.js gives each one only its own rows (ctx.secrets).
 */
const ready = new WeakMap(); // D1 binding → table created
async function table(env) {
  if (!env.DB) throw Object.assign(new Error('D1 binding "DB" is missing.'), { status: 500 });
  if (!ready.has(env.DB)) {
    ready.set(
      env.DB,
      env.DB.prepare('CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)')
        .run()
        .catch((e) => {
          ready.delete(env.DB);
          throw e;
        }),
    );
  }
  await ready.get(env.DB);
  return env.DB;
}

export async function getSecret(env, key) {
  const row = await (await table(env)).prepare('SELECT value FROM secrets WHERE key = ?1').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

export async function putSecret(env, key, value) {
  await (
    await table(env)
  )
    .prepare('INSERT INTO secrets (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3')
    .bind(key, JSON.stringify(value), Date.now())
    .run();
}

export async function deleteSecret(env, key) {
  await (await table(env)).prepare('DELETE FROM secrets WHERE key = ?1').bind(key).run();
}
