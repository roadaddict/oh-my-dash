import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import integrations from '../../lib/integrations/index.js';
import { integrationContext } from '../../lib/integration-host.js';
import { defineIntegration } from '../../lib/integration-kit.js';
import { handleApi } from '../../lib/api.js';
import { fakeD1, secretRows } from './d1.js';

const def = (id) => integrations.find((i) => i.id === id);
const WORKER_ENV = {
  DB: fakeD1(),
  OPEN_API: 'true',
  ACCESS_AUD: 'aud',
  SPOTIFY_CLIENT_ID: 'sp-id',
  SPOTIFY_CLIENT_SECRET: 'sp-secret',
  STRAVA_CLIENT_ID: 'st-id',
  STRAVA_CLIENT_SECRET: 'st-secret',
  TODOIST_TOKEN: 'td',
  FINNHUB_TOKEN: 'fh',
  TOMTOM_KEY: 'tt',
};

let realFetch, calls;
beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
const mockFetch = (handler) => {
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  };
};
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('every integration sees only the variables it declared — no D1, no other secrets', () => {
  for (const d of integrations) {
    const ctx = integrationContext(d, WORKER_ENV);
    assert.ok(
      Object.keys(ctx.env).every((k) => d.env.includes(k)),
      `${d.id} sees ${Object.keys(ctx.env)}`,
    );
    assert.equal(ctx.env.DB, undefined);
    assert.ok(Object.isFrozen(ctx.env));
  }
  assert.deepEqual(Object.keys(integrationContext(def('todoist'), WORKER_ENV).env), ['TODOIST_TOKEN']);
});

test("an integration's storage is its own rows: <id> and <id>:<name>", async () => {
  const env = { DB: fakeD1() };
  const spotify = integrationContext(def('spotify'), env),
    strava = integrationContext(def('strava'), env);
  await spotify.secrets.put('', { refresh_token: 'r' });
  await strava.secrets.put('index', [{ id: 1 }]);
  await strava.secrets.put('1', { access_token: 'a' });
  assert.deepEqual(Object.keys(secretRows(env.DB)).sort(), ['spotify', 'strava:1', 'strava:index']);
  // Same names from another integration land in its own namespace.
  assert.equal(await spotify.secrets.get('index'), null);
  assert.deepEqual(await strava.secrets.get('index'), [{ id: 1 }]);
  await assert.rejects(() => strava.secrets.get('../spotify'), /invalid storage name/);
});

test('OAuth state is one-time and per integration', async () => {
  const env = { DB: fakeD1() };
  const a = integrationContext(def('strava'), env),
    b = integrationContext(def('spotify'), env);
  const state = await a.oauth.newState('2');
  assert.match(state, /^2\.[0-9a-f]{32}$/);
  assert.equal(await b.oauth.checkState(state), false);
  assert.equal(await a.oauth.checkState(state), true);
  assert.equal(await a.oauth.checkState(state), false);
});

test('defineIntegration rejects bad definitions', () => {
  assert.throws(() => defineIntegration({ id: 'State', handle() {} }), /lower-case/);
  assert.throws(() => defineIntegration({ id: 'proxy', handle() {} }), /route of the dashboard/);
  assert.throws(() => defineIntegration({ id: 'x' }), /handle/);
  assert.throws(() => defineIntegration({ id: 'x', env: ['lower'], handle() {} }), /UPPER_CASE/);
});

test('todoist: tasks of a project, add, close — the token never leaves the Worker', async () => {
  mockFetch((url, init) => {
    assert.equal(init?.headers?.Authorization, 'Bearer td');
    if (url.endsWith('/projects'))
      return jsonResponse({
        results: [
          { id: 'p1', name: 'Home' },
          { id: 'in', name: 'Inbox', inbox_project: true },
        ],
      });
    if (url.includes('/tasks?project_id=p1')) return jsonResponse({ results: [{ id: 7, content: 'Milk', checked: false }] });
    if (url.endsWith('/tasks') && init.method === 'POST') {
      assert.equal(JSON.parse(init.body).project_id, 'p1');
      return jsonResponse({ id: 8 });
    }
    if (url.endsWith('/tasks/7/close')) return new Response(null, { status: 204 });
    return jsonResponse({}, 404);
  });
  const env = { ...WORKER_ENV, DB: fakeD1() };
  const get = async (p, init) => {
    const r = await handleApi(new Request(`https://d.example/api/todoist/${p}`, init), env);
    return { status: r.status, body: await r.json() };
  };
  const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
  const tasks = await get('tasks?project=home');
  assert.deepEqual(tasks.body, { tasks: [{ id: '7', text: 'Milk', done: false }] });
  assert.ok(!JSON.stringify(tasks.body).includes('td'));
  assert.equal((await get('add', post({ text: 'Eggs', project: 'Home' }))).status, 200);
  assert.equal((await get('close', post({ id: 7 }))).status, 200);
  assert.equal((await get('close', post({ id: '../../x' }))).status, 400);
});

test('finnhub: quotes are validated and cached', async () => {
  mockFetch((url) => jsonResponse({ c: 212.4, dp: 0.8 }));
  const env = { ...WORKER_ENV, DB: fakeD1() };
  const get = async (q) => {
    const r = await handleApi(new Request(`https://d.example/api/finnhub/quotes?symbols=${q}`), env);
    return { status: r.status, body: await r.json() };
  };
  assert.deepEqual((await get('aapl,<script>')).body, { quotes: [{ sym: 'AAPL', price: 212.4, change: 0.8 }] });
  await get('AAPL');
  assert.equal(calls.length, 1);
  assert.equal((await get('')).status, 400);
});

test('tomtom: coordinates are validated; traffic delay in minutes', async () => {
  mockFetch(() => jsonResponse({ routes: [{ summary: { travelTimeInSeconds: 1860, trafficDelayInSeconds: 360, lengthInMeters: 11200 } }] }));
  const env = { ...WORKER_ENV, DB: fakeD1() };
  const get = async (q) => {
    const r = await handleApi(new Request(`https://d.example/api/tomtom/route?${q}`), env);
    return { status: r.status, body: await r.json() };
  };
  assert.deepEqual((await get('from=51.5,-0.1&to=51.51,-0.09')).body, { mins: 31, delay: 6, km: 11.2 });
  assert.equal((await get('from=91,0&to=1,1')).status, 400);
  assert.equal((await get('from=abc&to=1,1')).status, 400);
});
