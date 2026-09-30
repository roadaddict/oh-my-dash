/**
 * Everything a backend integration may import. An integration is one file in
 * lib/integrations/ (registered automatically by `npm run build`):
 *
 *   import { defineIntegration } from '../integration-kit.js';
 *   export default defineIntegration({
 *     id: 'strava',                                   // served at /api/strava/<path>
 *     env: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'], // the only Worker variables it can see
 *     async handle(request, ctx, path) { … return ctx.json({ … }); },
 *   });
 *
 * ctx (see lib/integration-host.js):
 *   ctx.env        the declared variables/secrets, nothing else (no D1, no other keys)
 *   ctx.secrets    its own private storage in D1 — get(name) / put(name, value) / delete(name);
 *                  name '' is the integration's main record. Never sent to browsers.
 *   ctx.oauth      newState(tag?) / checkState(state): one-time OAuth `state` (CSRF), 10 min
 *   ctx.json(body, status?, headers?) · ctx.fail(message, status?) → throw it for an error reply
 * Every route is behind the dashboard's sign-in (Cloudflare Access / home IP), like the rest of /api.
 */
import { json } from './http.js';

export { json };

/** An error the API answers with `{ error: message }` and this status. */
export const fail = (message, status = 502) => Object.assign(new Error(message), { status });

/** Route names the dashboard itself uses under /api. */
export const RESERVED = ['state', 'proxy', 'lists', 'health', 'ping'];

export function defineIntegration(def) {
  const bad = (msg) => {
    throw new TypeError(`defineIntegration: ${msg}`);
  };
  if (!def || typeof def !== 'object') bad('pass one object: { id, env, handle(request, ctx, path) }');
  if (typeof def.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(def.id)) bad(`id must be lower-case letters, digits and "-" (got ${JSON.stringify(def.id)})`);
  if (RESERVED.includes(def.id)) bad(`"${def.id}" is a route of the dashboard itself`);
  if (typeof def.handle !== 'function') bad(`"${def.id}" needs a handle(request, ctx, path) function`);
  const env = def.env ?? [];
  if (!Array.isArray(env) || env.some((k) => typeof k !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(k)))
    bad(`"${def.id}".env must be a list of UPPER_CASE variable names`);
  return Object.freeze({ ...def, env: Object.freeze([...env]) });
}
