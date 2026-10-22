// Updates the CSP hash of the bootstrap script in public/snapshot.html (the snapshot frame,
// L8). Run after editing that script: node scripts/snapshot-csp.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../public/snapshot.html', import.meta.url);
const html = readFileSync(path, 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const hash = createHash('sha256').update(script, 'utf8').digest('base64');
const next = html.replace(/script-src 'sha256-[^']*'/, `script-src 'sha256-${hash}'`);
if (next !== html) writeFileSync(path, next);
console.log(`[slate] snapshot frame script hash: sha256-${hash}`);
