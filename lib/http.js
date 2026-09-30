export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

/** Keys the dashboard is allowed to store: its own, plus widgets' synced state ("w-<widget>-<name>", ctx.state). */
export const STATE_KEYS = new Set(['config', 'lists', 'chores', 'meals', 'message', 'layouts', 'netstats']);
export const isStateKey = (key) => STATE_KEYS.has(key) || /^w-[a-z][a-z0-9-]{0,80}$/.test(key);
export const MAX_VALUE_BYTES = 256 * 1024;

const ready = new WeakMap(); // D1 binding → table created
/** D1 handle with the key/value table created on first use (no manual migration needed). */
export async function database(env) {
  if (!env.DB) throw Object.assign(new Error('D1 binding "DB" is missing — bind a D1 database as "DB" on the Worker (Settings → Bindings).'), { status: 500 });
  if (!ready.has(env.DB)) {
    ready.set(
      env.DB,
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      rev INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    )`)
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
