/**
 * Shared lists for shortcuts and scripts (phones, voice assistants, share sheets).
 *
 *   GET  /api/lists              { lists: { Groceries: ["Milk", …], … } }   open items only
 *   POST /api/lists/add          { text: "milk, eggs", list?: "Groceries" }  → { list, added, reopened }
 *
 * Same rules as the tablet: commas split items, nothing is duplicated (a ticked item is
 * reopened instead), and every add feeds the quick-add suggestions. Behind the normal API
 * auth, so a shortcut uses a Cloudflare Access service token (README → Lists).
 */
import { database, json, MAX_VALUE_BYTES } from './http.js';

const isList = (k, v) => !k.startsWith('_') && Array.isArray(v);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function read(db) {
  const row = await db.prepare("SELECT value, rev FROM kv WHERE key = 'lists'").first();
  return row ? { rev: row.rev, value: JSON.parse(row.value) || {} } : { rev: 0, value: {} };
}

export async function handleLists(request, env, path) {
  const db = await database(env);
  if (!path && request.method === 'GET') {
    const { value } = await read(db);
    return json({ lists: Object.fromEntries(Object.entries(value).filter(([k, v]) => isList(k, v)).map(([k, v]) => [k, v.filter((i) => !i.done).map((i) => i.text)])) });
  }
  if (path !== 'add' || request.method !== 'POST') return json({ error: 'not found' }, 404);

  const body = await request.json().catch(() => ({}));
  const texts = String(body.text || '').split(/\s*[,;\n]\s*/).map((t) => t.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 50);
  if (!texts.length) return json({ error: '"text" is required' }, 400);

  for (let attempt = 0; attempt < 5; attempt++) {
    const { rev, value } = await read(db);
    const names = Object.keys(value).filter((k) => isList(k, value[k]));
    const want = String(body.list || '').trim().toLowerCase();
    const list = names.find((n) => n.toLowerCase() === want) || (want ? String(body.list).trim() : names[0] || 'To-do');
    const items = (value[list] ||= []), rec = ((value._recent ||= {})[list] ||= {});
    const at = Date.now(), added = [], reopened = [];
    texts.forEach((text, k) => {
      const key = text.toLowerCase(), hit = items.find((i) => i.text.toLowerCase() === key);
      if (!hit) { items.push({ id: uid(), text, done: false, at: at + k }); added.push(text); } else if (hit.done) { hit.done = false; hit.at = at + k; reopened.push(text); }
      const r = (rec[key] ||= { text: hit ? hit.text : text, n: 0 });
      r.n++; r.at = at;
    });
    const next = JSON.stringify(value), user = 'shortcut';
    if (new TextEncoder().encode(next).length > MAX_VALUE_BYTES) return json({ error: 'lists are too large — clear ticked items first' }, 413);
    const res = rev === 0
      ? await db.prepare("INSERT INTO kv (key, value, rev, updated_at, updated_by) VALUES ('lists', ?1, 1, ?2, ?3) ON CONFLICT(key) DO NOTHING").bind(next, at, user).run()
      : await db.prepare("UPDATE kv SET value = ?1, rev = rev + 1, updated_at = ?2, updated_by = ?3 WHERE key = 'lists' AND rev = ?4").bind(next, at, user, rev).run();
    if (res.meta.changes === 1) return json({ list, added, reopened });
  }
  return json({ error: 'busy, try again' }, 409);
}
