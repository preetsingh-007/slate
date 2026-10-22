// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'public/snapshot.html'), 'utf8');

describe('snapshot frame isolation (L8, non-functional: web content isolation)', () => {
  it('allows only its own bootstrap script (by hash) and blob: scripts, and no network', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    // if this fails after editing the frame script: node scripts/snapshot-csp.mjs
    expect(csp).toContain(`script-src 'sha256-${hash}' blob:`);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toMatch(/unsafe-eval|https?:|\*/);
    // the meta CSP must come before any script
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'));
  });

  it('accepts messages only from the parent and never navigates to links itself', () => {
    expect(html).toContain('if (e.source !== host) return;');
    expect(html).toMatch(/e\.preventDefault\(\);\s+if \(\/\^https\?:\/i\.test\(a\.href\)\) post\(\{ type: 'link'/);
  });

  it("L8: the frame is never given the owner's note text (page scripts may run there)", async () => {
    const { decorateMessage } = await import('./frameMessages');
    const msg = decorateMessage([{ id: 'n1', start: 1, end: 5, color: 'transparent', note: 'my private thought' }, { id: 'h1', start: 6, end: 9, color: '#ff0' }], [{ key: '0', start: 1, end: 2, label: '1 clip from here' }]);
    expect(JSON.stringify(msg)).not.toContain('my private thought');
    expect(msg.highlights).toEqual([
      { id: 'n1', start: 1, end: 5, color: 'transparent', note: true },
      { id: 'h1', start: 6, end: 9, color: '#ff0', note: false },
    ]);
    // and the frame does not show a note's text (its button has a fixed label)
    expect(html).not.toMatch(/[=+,]\s*h\.note\b/);
  });
});
