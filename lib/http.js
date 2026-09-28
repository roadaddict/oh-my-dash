export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

/** Keys the dashboard is allowed to store. */
export const STATE_KEYS = new Set(['config', 'lists', 'chores', 'meals', 'message', 'layouts', 'netstats']);
export const MAX_VALUE_BYTES = 256 * 1024;

let ready = null;
/** D1 handle with the key/value table created on first use (no manual migration needed). */
export async function database(env) {
  if (!env.DB) throw Object.assign(new Error('D1 binding "DB" is missing — bind a D1 database as "DB" on the Worker (Settings → Bindings).'), { status: 500 });
  if (!ready) {
    ready = env.DB.prepare(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      rev INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    )`).run().catch((e) => { ready = null; throw e; });
  }
  await ready;
  return env.DB;
}
