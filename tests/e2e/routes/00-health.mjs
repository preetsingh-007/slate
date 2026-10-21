export function handle(_req, res, url) {
  if (url.pathname !== '/health') return false;
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
  return true;
}
