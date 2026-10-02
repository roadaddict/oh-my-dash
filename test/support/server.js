/**
 * Tiny static file server for the browser tests: serves OMD_ROOT (default public/)
 * on OMD_PORT (default 4173). /api/* is answered by the tests' mocks, never here.
 * A request with the cookie omd-test-signed-out=1 is sent to a login page instead, the
 * way Cloudflare Access answers once its session has expired.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const LOGIN_URL = 'https://login.example.test/cdn-cgi/access/login';
const root = resolve(process.env.OMD_ROOT || 'public');
const port = Number(process.env.OMD_PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  if (/(^|;\s*)omd-test-signed-out=1/.test(req.headers.cookie || '')) {
    res.writeHead(302, { Location: LOGIN_URL, 'Cache-Control': 'no-store' });
    return res.end();
  }
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
