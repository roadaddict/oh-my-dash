/**
 * Runs the backend integrations (lib/integrations/*, registered in lib/integrations/index.js
 * by `npm run build`) — each in its own box:
 *   • it sees only the Worker variables it declared (ctx.env), never D1 or other secrets;
 *   • its private storage is its own rows of the D1 "secrets" table: "<id>" and "<id>:<name>"
 *     (plus "oauth_state:<id>"), so one integration can't read another's tokens.
 */
import integrations from './integrations/index.js';
import { getSecret, putSecret, deleteSecret } from './secrets.js';
import { json, fail } from './integration-kit.js';

const byId = new Map();
for (const def of integrations) {
  if (byId.has(def.id)) throw new Error(`Two backend integrations are called "${def.id}"`);
  byId.set(def.id, def);
}
export const integrationIds = () => [...byId.keys()];

/** What an integration gets as `ctx` (exported for the tests). */
export function integrationContext(def, env) {
  const key = (name = '') => {
    const n = String(name);
    if (n && !/^[\w.-]{1,80}$/.test(n)) throw fail(`invalid storage name "${n}"`, 500);
    return n ? `${def.id}:${n}` : def.id;
  };
  const stateKey = `oauth_state:${def.id}`;
  return Object.freeze({
    id: def.id,
    env: Object.freeze(Object.fromEntries(def.env.filter((k) => env[k] != null).map((k) => [k, env[k]]))),
    secrets: Object.freeze({
      get: async (name) => getSecret(env, key(name)),
      put: async (name, value) => putSecret(env, key(name), value),
      delete: async (name) => deleteSecret(env, key(name)),
    }),
    oauth: Object.freeze({
      /** A one-time `state` for an OAuth redirect; `tag` (e.g. which app) is kept in front of it. */
      async newState(tag = '') {
        const rand = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
        const state = tag ? `${tag}.${rand}` : rand;
        await putSecret(env, stateKey, { state, at: Date.now() });
        return state;
      },
      /** True once for the state newState() made in the last 10 minutes. */
      async checkState(state) {
        const saved = await getSecret(env, stateKey);
        await deleteSecret(env, stateKey);
        return !!saved && saved.state === state && Date.now() - saved.at < 10 * 60000;
      },
    }),
    json,
    fail,
  });
}

/** Response for /api/<id>/<path>, or null when there's no integration called `id`. */
export async function handleIntegration(request, env, id, path) {
  const def = byId.get(id);
  if (!def) return null;
  return def.handle(request, integrationContext(def, env), path);
}
