// Test server for end-to-end tests: serves fixture pages for New from link, a fake fetch
// helper, and a mocked GitHub API. Each area adds a module in tests/e2e/routes/ exporting
// `handle(req, res, url): boolean | Promise<boolean>` (true when it answered the request).
import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 4455);

const routes = [];
for (const f of readdirSync(join(here, 'routes')).filter((f) => f.endsWith('.mjs')).sort()) {
  routes.push(await import(pathToFileURL(join(here, 'routes', f)).href));
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    for (const r of routes) if (await r.handle(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(err?.stack ?? err));
  }
}).listen(port, () => console.log(`[e2e server] http://localhost:${port}`));
