/**
 * A stand-in for a Cloudflare D1 binding on Node's built-in SQLite, enough for lib/:
 * db.prepare(sql).bind(...args).first() / .all() / .run().
 */
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}

/** Rows of the private "secrets" table, as { key: value }. */
export const secretRows = (d1) =>
  Object.fromEntries(
    d1.raw
      .prepare('SELECT key, value FROM secrets')
      .all()
      .map((r) => [r.key, JSON.parse(r.value)]),
  );
