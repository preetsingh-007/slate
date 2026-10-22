/**
 * A static file server like GitHub Pages, for the offline and base-path tests: serves a build
 * directory under a base path, 404 for anything else, on a port the OS picks. Stopping it takes
 * the app's origin off the network for the page and its service worker alike (Playwright's
 * offline mode does not reach service workers).
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { AddressInfo } from 'node:net';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export interface StaticServer {
  /** origin plus base path, ending in "/" */
  url: string;
  /** every request, in order, as "<status> <path>" */
  requests: string[];
  stop(): Promise<void>;
}

export async function serveStatic(dir: string, base = '/'): Promise<StaticServer> {
  const requests: string[] = [];
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    res.on('finish', () => requests.push(`${res.statusCode} ${path}`));
    if (!path.startsWith(base)) {
      res.writeHead(404).end('not found');
      return;
    }
    let file = normalize(join(dir, path.slice(base.length)));
    if (!file.startsWith(normalize(dir))) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}${base}`,
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
