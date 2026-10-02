import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../../lib/api.js';
import { fakeD1 } from './d1.js';

const env = (extra = {}) => ({ OPEN_API: 'true', DB: fakeD1(), ...extra });
const call = async (e, path, init) => {
  const r = await handleApi(new Request(`https://dash.example${path}`, init), e);
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
};
const put = (key, body) => ({ method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

test('health lists the registered backend integrations', async () => {
  const { status, body } = await call(env(), '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body.integrations.sort(), ['aqara', 'finnhub', 'spotify', 'strava', 'todoist', 'tomtom']);
});

test('without auth configuration the API refuses everything but ping and health', async () => {
  const e = { DB: fakeD1() };
  assert.equal((await call(e, '/api/state')).status, 401);
  assert.equal((await call(e, '/api/todoist/status')).status, 401);
  assert.equal((await call(e, '/api/ping')).status, 204);
});

test('state: optimistic concurrency, and widget keys (w-<widget>-<name>) are allowed', async () => {
  const e = env();
  assert.deepEqual((await call(e, '/api/state/lists', put('lists', { rev: 0, value: { a: 1 } }))).body.rev, 1);
  assert.equal((await call(e, '/api/state/lists', put('lists', { rev: 0, value: { a: 2 } }))).status, 409);
  assert.equal((await call(e, '/api/state/w-example-count', put('x', { rev: 0, value: 3 }))).status, 200);
  assert.equal((await call(e, '/api/state/w-example-count')).body.value, 3);
  assert.equal((await call(e, '/api/state/anything', put('x', { rev: 0, value: 3 }))).status, 404);
  assert.equal((await call(e, '/api/state/w-Bad_Key', put('x', { rev: 0, value: 3 }))).status, 404);
  const all = (await call(e, '/api/state')).body.items;
  assert.deepEqual(Object.keys(all).sort(), ['lists', 'w-example-count']);
});

test('unknown integrations and core route names are 404', async () => {
  assert.equal((await call(env(), '/api/nope/status')).status, 404);
  assert.equal((await call(env(), '/api/spotify')).status, 404);
});

test('an integration answers "not configured" without its secret', async () => {
  for (const id of ['todoist', 'finnhub', 'tomtom']) {
    assert.deepEqual((await call(env(), `/api/${id}/status`)).body, { configured: false });
  }
  assert.deepEqual((await call(env({ TODOIST_TOKEN: 'x' }), '/api/todoist/status')).body, { configured: true });
});

test('proxy batch: several feeds in one round trip, each checked like GET /api/proxy', async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    seen.push(String(url));
    if (String(url).includes('down.example')) throw new Error('connection refused');
    return new Response(`body of ${url}`, { headers: { 'Content-Type': 'text/calendar' } });
  });
  const e = env({ ALLOWED_HOSTS: 'feeds.example,down.example' });
  const post = (requests) => ({ method: 'POST', body: JSON.stringify({ requests }), headers: { 'Content-Type': 'application/json' } });
  const { status, body } = await call(
    e,
    '/api/proxy/batch',
    post([{ url: 'https://feeds.example/a.ics' }, { url: 'https://other.example/x' }, { url: 'https://down.example/y' }, { url: 'nope' }]),
  );
  assert.equal(status, 200);
  assert.deepEqual(
    body.responses.map((r) => r.status),
    [200, 403, 502, 400],
  );
  assert.equal(body.responses[0].body, 'body of https://feeds.example/a.ics');
  assert.equal(body.responses[0].type, 'text/calendar');
  assert.deepEqual(seen, ['https://feeds.example/a.ics', 'https://down.example/y']); // the refused ones were never fetched
  assert.equal((await call(e, '/api/proxy/batch', post([]))).status, 400);
  assert.equal((await call(e, '/api/proxy/batch', post(Array.from({ length: 21 }, () => ({ url: 'https://feeds.example/' }))))).status, 400);
  assert.equal((await call(e, '/api/proxy/batch')).status, 405);
  assert.equal((await call({ DB: fakeD1() }, '/api/proxy/batch', post([{ url: 'https://feeds.example/a' }]))).status, 401);
});
