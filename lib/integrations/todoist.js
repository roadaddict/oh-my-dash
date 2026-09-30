/**
 * Todoist: one project as an extra tab of the Lists widget.
 *
 * Setup: Todoist → Settings → Integrations → Developer → API token, then
 *   npx wrangler secret put TODOIST_TOKEN
 * The token stays on the Worker; screens only ever see the tasks.
 *
 *   GET  /api/todoist/status               { configured }
 *   GET  /api/todoist/tasks?project=Name   { tasks: [{ id, text, done }] }   ("" = Inbox)
 *   POST /api/todoist/close   { id }        tick off
 *   POST /api/todoist/reopen  { id }
 *   POST /api/todoist/add     { text, project? }
 */
import { defineIntegration, json, fail } from '../integration-kit.js';

const base = (env) => env.TODOIST_BASE || 'https://api.todoist.com/api/v1';
const results = (j) => (Array.isArray(j) ? j : j.results || j.items || []);
const projects = new Map(); // `${project}` → { at, id }

async function todoist(env, path, init = {}) {
  const r = await fetch(`${base(env)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${String(env.TODOIST_TOKEN).trim()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (r.status === 401 || r.status === 403) throw fail('Todoist refused the token — check the TODOIST_TOKEN secret', 409);
  if (!r.ok) throw fail(`Todoist HTTP ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Project name (or id) → id; "" = the Inbox. Cached for an hour. */
async function projectId(env, name) {
  const want = String(name || '')
    .trim()
    .toLowerCase();
  const hit = projects.get(want);
  if (hit && Date.now() - hit.at < 3600e3) return hit.id;
  const list = results(await todoist(env, '/projects'));
  const pr = want ? list.find((x) => x.name.toLowerCase() === want || String(x.id) === want) : list.find((x) => x.inbox_project || x.is_inbox_project);
  const id = pr ? pr.id : '';
  projects.set(want, { at: Date.now(), id });
  return id;
}

async function handle(request, ctx, path) {
  const env = ctx.env;
  const configured = !!String(env.TODOIST_TOKEN || '').trim();
  if (path === 'status') return json({ configured });
  if (!configured) return json({ error: 'Set the TODOIST_TOKEN secret on the Worker first (README → Secrets).' }, 409);

  if (path === 'tasks' && request.method === 'GET') {
    const pid = await projectId(env, new URL(request.url).searchParams.get('project'));
    const j = await todoist(env, `/tasks${pid ? `?project_id=${encodeURIComponent(pid)}` : ''}`);
    return json({ tasks: results(j).map((t) => ({ id: String(t.id), text: t.content, done: !!(t.checked || t.is_completed) })) });
  }
  if (request.method !== 'POST') return json({ error: 'not found' }, 404);
  const body = await request.json().catch(() => ({}));
  if (path === 'close' || path === 'reopen') {
    const id = String(body.id || '');
    if (!/^[\w-]{1,64}$/.test(id)) return json({ error: '"id" is required' }, 400);
    await todoist(env, `/tasks/${encodeURIComponent(id)}/${path}`, { method: 'POST' });
    return json({ ok: true });
  }
  if (path === 'add') {
    const text = String(body.text || '')
      .trim()
      .slice(0, 500);
    if (!text) return json({ error: '"text" is required' }, 400);
    const pid = await projectId(env, body.project);
    await todoist(env, '/tasks', { method: 'POST', body: JSON.stringify({ content: text, ...(pid ? { project_id: pid } : {}) }) });
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}

export default defineIntegration({ id: 'todoist', env: ['TODOIST_TOKEN', 'TODOIST_BASE'], handle });
