// @vitest-environment node
/**
 * Network use NFR: the app contacts only GitHub and the fetch helper (the URL only). A static
 * check over the app's sources: every web address written in them is either one the app
 * contacts (GitHub's API), a link the person opens, or text that is never fetched; and only
 * known modules call the network. The Playwright test tests/e2e/nfr-network.spec.ts records
 * the requests of a whole workflow.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|html|js|mjs)$/.test(name) ? [p] : [];
  });
}

/** App code: what ships in the bundle (tests, fixtures and test doubles excluded). */
const APP = [...files(join(ROOT, 'src')), join(ROOT, 'index.html'), join(ROOT, 'public/snapshot.html'), join(ROOT, 'public/theme.js')]
  .map((p) => relative(ROOT, p))
  .filter((p) => !/\.test\.tsx?$|\/testing\/|^src\/test\/|fakeGitHub\.ts$|testFetch\.ts$|testHooks\.tsx$/.test(p));

/** Hosts written in app code, and why each is allowed. */
const HOSTS: Record<string, string> = {
  'api.github.com': 'contacted: the GitHub API (sync, R4)',
  'github.com': 'links the person opens (token page, the Slate repository); the Git LFS endpoint (blocked by GitHub and the CSP, see lfs.ts)',
  'git-lfs.github.com': 'text of an LFS pointer file, never fetched',
  'www.w3.org': 'XML namespace names, never fetched',
  'arxiv.org': 'addresses given to the fetch helper (L10) and written into citations',
  'export.arxiv.org': 'citation lookup, only through the fetch helper',
  'api.crossref.org': 'citation lookup, only through the fetch helper',
  'slate-fetch.example.workers.dev': 'placeholder text of the helper URL field',
};

/** Modules that may call the network, and what they reach. */
const CALLERS: Record<string, string> = {
  'src/core/sync/git/github.ts': 'the GitHub API',
  'src/core/sync/lfs.ts': 'the Git LFS API of the repository',
  'src/core/library/helper.ts': 'the fetch helper, with the page URL as its only parameter',
  'src/core/citations/http.ts': 'an injected fetch (always the helper)',
  'src/ui/library/clipping/SnapshotFrame.tsx': "the app's own snapshot.html (from the service worker)",
  'src/ui/sources/rasterize.ts': 'blob:, data: and same-origin images only',
};

describe('network use (NFR): the app contacts only GitHub and the fetch helper', () => {
  it('every web address in the app code is GitHub, a link, or text never fetched', () => {
    const found = new Map<string, Set<string>>();
    for (const f of APP) {
      for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/\bhttps?:\/\/([a-z0-9.*-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!found.has(host)) found.set(host, new Set());
        found.get(host)!.add(f);
      }
    }
    const unknown = [...found].filter(([h]) => !(h in HOSTS)).map(([h, fs]) => `${h} in ${[...fs].join(', ')}`);
    expect(unknown).toEqual([]);
  });

  it('only known modules call the network', () => {
    const callers = APP.filter((f) => /\bfetch\(|globalThis\.fetch|XMLHttpRequest|new WebSocket|EventSource|sendBeacon|importScripts\(/.test(readFileSync(join(ROOT, f), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')));
    // canvases.ts names its sync callback `fetch` (R9): not the network
    expect(callers.filter((f) => !(f in CALLERS) && f !== 'src/core/stores/canvases.ts')).toEqual([]);
  });

  it('the CSP lets the app connect only to itself, GitHub and the helper', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    const connect = /`connect-src ([^`$]+)/.exec(config)![1].trim();
    expect(connect).toBe("'self' https://api.github.com https://*.workers.dev blob: data:");
    expect(config).toContain("\"default-src 'self'\"");
    expect(config).toContain("\"object-src 'none'\"");
    const script = /`script-src ([^`]+)`/.exec(config)![1];
    expect(script).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:|\*/);
  });

  it('citation lookups refuse to run without the helper', async () => {
    const { lookupDoi } = await import('../core/citations/crossref');
    await expect(lookupDoi('10.1234/x')).rejects.toThrow(/fetch helper/);
  });
});
