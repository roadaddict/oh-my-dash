/**
 * Cloudflare Worker entry: /api/* goes to the dashboard API, everything else is
 * served from public/ as static assets (see wrangler.jsonc).
 */
import { handleApi } from '../lib/api.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
