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
