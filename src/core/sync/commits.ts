/**
 * Commit batching and messages (R8): a push makes at most one commit per scope, with the
 * message `<scope>: <summary>` (gym README, "Commits"), e.g. `journal: Update main canvas,
 * 2026-10` or `library: Add clipping 2026-10-21-attention`.
 *
 * Order keeps gym's checker green on every commit (G9): library additions and updates come
 * first (journal files link to library items), then journal. Removing library items comes last,
 * after the journal commit that drops links to them, so a push that both adds and removes
 * library items makes a second library commit.
 */
import type { CommitSpec } from './git/remote';
import { parseRepoPath } from './paths';

export interface PlannedChange {
  path: string;
  /** new content, or null to delete */
  content: Uint8Array | null;
  /** the path did not exist in the repository before */
  added: boolean;
}

const MAX_SUMMARY = 72;

function joinItems(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Joins summary parts with '; ' and shortens to fit one line. */
function summarize(parts: string[]): string {
  const uniq = [...new Set(parts)];
  for (let n = uniq.length; n >= 1; n--) {
    const more = uniq.length - n;
    const s = uniq.slice(0, n).join('; ') + (more ? ` (+${more} more)` : '');
    if (s.length <= MAX_SUMMARY || n === 1) return s.length <= MAX_SUMMARY ? s : s.slice(0, MAX_SUMMARY - 1) + '…';
  }
  return 'Update';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function journalSummary(changes: PlannedChange[]): string {
  const canvasMonths = new Map<string, Set<string>>();
  const newCanvases: string[] = [];
  const parts: string[] = [];
  let todo = false;
  let lists = false;
  let readme = false;
  for (const c of changes) {
    const f = parseRepoPath(c.path);
    if (!f) continue;
    switch (f.kind) {
      case 'canvasJson':
        if (c.added) newCanvases.push(f.slug);
        else if (!canvasMonths.has(f.slug)) canvasMonths.set(f.slug, new Set());
        break;
      case 'segment':
      case 'segmentAsset':
      case 'day':
      case 'mark': {
        let s = canvasMonths.get(f.slug);
        if (!s) canvasMonths.set(f.slug, (s = new Set()));
        s.add(f.month);
        break;
      }
      case 'todo':
        todo = true;
        break;
      case 'queue':
      case 'todos':
        lists = true;
        break;
      case 'journalReadme':
        readme = true;
        break;
    }
  }
  for (const slug of newCanvases.sort()) {
    parts.push(`add ${slug} canvas`);
    canvasMonths.delete(slug);
  }
  for (const [slug, months] of [...canvasMonths].sort(([a], [b]) => a.localeCompare(b))) {
    const ms = [...months].sort();
    parts.push(ms.length ? `update ${slug} canvas, ${joinItems(ms)}` : `update ${slug} canvas`);
  }
  if (todo) parts.push('update to-dos');
  if (!parts.length && lists) parts.push('update queue and to-dos');
  if (!parts.length && readme) parts.push('update index');
  return cap(summarize(parts.length ? parts : ['update journal']));
}

export function librarySummary(changes: PlannedChange[]): string {
  const items = new Map<string, { kind: 'book' | 'clipping'; added: boolean; removed: boolean; ann: boolean; meta: boolean }>();
  let settings = false;
  let readme = false;
  for (const c of changes) {
    const f = parseRepoPath(c.path);
    if (!f) continue;
    if (f.kind === 'settings') settings = true;
    else if (f.kind === 'libraryReadme') readme = true;
    else if (f.kind === 'book' || f.kind === 'clipping' || f.kind === 'clippingAsset') {
      const kind = f.kind === 'book' ? 'book' : 'clipping';
      const key = `${kind}:${f.slug}`;
      let it = items.get(key);
      if (!it) items.set(key, (it = { kind, added: false, removed: false, ann: false, meta: false }));
      const file = 'file' in f ? f.file : '';
      if (c.content === null) it.removed = true;
      if ((file === 'book.json' || file === 'meta.json') && c.added) it.added = true;
      if (file === 'annotations.yjs' || file === 'annotations.md') it.ann = true;
      else it.meta = true;
    }
  }
  const parts: string[] = [];
  for (const [key, it] of [...items].sort(([a], [b]) => a.localeCompare(b))) {
    const slug = key.slice(key.indexOf(':') + 1);
    if (it.removed && !it.added) parts.push(`remove ${it.kind} ${slug}`);
    else if (it.added) parts.push(`add ${it.kind} ${slug}`);
    else if (it.ann && !it.meta) parts.push(`update annotations of ${slug}`);
    else parts.push(`update ${it.kind} ${slug}`);
  }
  if (settings) parts.push('update settings');
  if (!parts.length && readme) parts.push('update index');
  return cap(summarize(parts.length ? parts : ['update library']));
}

/** Groups planned changes into the push's commits, in order (see the module comment). */
export function planCommits(changes: PlannedChange[]): CommitSpec[] {
  const lib = changes.filter((c) => c.path.startsWith('library/'));
  const journal = changes.filter((c) => c.path.startsWith('journal/'));
  const removedDirs = new Set<string>();
  for (const c of lib) {
    const f = parseRepoPath(c.path);
    if (c.content === null && f && (f.kind === 'book' || f.kind === 'clipping') && (f.file === 'book.json' || f.file === 'meta.json')) {
      removedDirs.add(c.path.slice(0, c.path.lastIndexOf('/') + 1));
    }
  }
  const isRemoval = (c: PlannedChange) => c.content === null && [...removedDirs].some((d) => c.path.startsWith(d));
  const libFirst = lib.filter((c) => !isRemoval(c));
  const libLast = lib.filter(isRemoval);
  const out: CommitSpec[] = [];
  const toFiles = (cs: PlannedChange[]) => cs.map((c) => ({ path: c.path, content: c.content }));
  // removals can go first when nothing in this push needs the journal to change before them
  if (libFirst.length && libLast.length && journal.length) {
    out.push({ message: `library: ${librarySummary(libFirst)}`, files: toFiles(libFirst) });
    out.push({ message: `journal: ${journalSummary(journal)}`, files: toFiles(journal) });
    out.push({ message: `library: ${librarySummary(libLast)}`, files: toFiles(libLast) });
    return out;
  }
  if (lib.length && (!libLast.length || !journal.length)) out.push({ message: `library: ${librarySummary(lib)}`, files: toFiles(lib) });
  if (journal.length) out.push({ message: `journal: ${journalSummary(journal)}`, files: toFiles(journal) });
  if (libLast.length && journal.length && !libFirst.length) out.push({ message: `library: ${librarySummary(libLast)}`, files: toFiles(libLast) });
  return out;
}
