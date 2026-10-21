/**
 * Repository layout of `journal/` and `library/` (PRD "Gym interface → Repository layout",
 * gym README "Slate"). Every path the sync engine reads or writes is built and classified here.
 */
import { extFor } from '../storage/assets';

export const JOURNAL_README = 'journal/README.md';
export const QUEUE_PATH = 'journal/queue.md';
export const TODO_PATH = 'journal/todo.yjs';
export const TODOS_PATH = 'journal/todos.md';
export const FORMALIZED_PATH = 'journal/formalized.md';
export const LIBRARY_README = 'library/README.md';
export const SETTINGS_PATH = 'library/settings.json';

/** gym's naming rule for folders (check.py NAME) */
export const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const CLIPPING_DIR = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
export const ASSET_FILE = /^[0-9a-f]{16,64}(\.[a-z0-9]+)?$/;

export const canvasDir = (slug: string) => `journal/${slug}`;
export const canvasJsonPath = (slug: string) => `journal/${slug}/canvas.json`;
export const segmentDir = (slug: string, month: string) => `journal/${slug}/${month}`;
export const segmentPath = (slug: string, month: string) => `${segmentDir(slug, month)}/canvas.yjs`;
export const segmentAssetPath = (slug: string, month: string, hash: string, mime: string) => `${segmentDir(slug, month)}/assets/${hash}.${extFor(mime)}`;
export const dayPath = (slug: string, month: string, date: string, ext: 'md' | 'svg') => `${segmentDir(slug, month)}/days/${date}.${ext}`;
export const markPath = (slug: string, month: string, id: string, ext: 'md' | 'png') => `${segmentDir(slug, month)}/marks/${id}.${ext}`;

export const bookDir = (slug: string) => `library/books/${slug}`;
export const bookJsonPath = (slug: string) => `${bookDir(slug)}/book.json`;
export const bookAnnotationsPath = (slug: string) => `${bookDir(slug)}/annotations.yjs`;
export const bookAnnotationsMdPath = (slug: string) => `${bookDir(slug)}/annotations.md`;
export const bookFilePath = (slug: string, format: 'pdf' | 'epub') => `${bookDir(slug)}/book.${format}`;
export const clippingDir = (slug: string) => `library/clippings/${slug}`;
export const clippingMetaPath = (slug: string) => `${clippingDir(slug)}/meta.json`;
export const clippingMdPath = (slug: string) => `${clippingDir(slug)}/clipping.md`;
export const clippingSnapshotPath = (slug: string) => `${clippingDir(slug)}/snapshot.html`;
export const clippingAnnotationsPath = (slug: string) => `${clippingDir(slug)}/annotations.yjs`;
export const clippingAssetPath = (slug: string, file: string) => `${clippingDir(slug)}/assets/${file}`;

export type RepoFile =
  | { kind: 'journalReadme' | 'queue' | 'todo' | 'todos' | 'formalized' | 'libraryReadme' | 'settings' }
  | { kind: 'canvasJson'; slug: string }
  | { kind: 'segment'; slug: string; month: string }
  | { kind: 'segmentAsset'; slug: string; month: string; file: string; hash: string }
  | { kind: 'day'; slug: string; month: string; date: string; ext: string }
  | { kind: 'mark'; slug: string; month: string; id: string; ext: string }
  | { kind: 'book'; slug: string; file: string }
  | { kind: 'clipping'; slug: string; file: string }
  | { kind: 'clippingAsset'; slug: string; file: string; hash: string };

/** Classifies a repository path under journal/ or library/; null for anything else. */
export function parseRepoPath(path: string): RepoFile | null {
  const s = path.split('/');
  if (s[0] === 'journal') {
    if (s.length === 2) {
      const top: Record<string, RepoFile['kind']> = { 'README.md': 'journalReadme', 'queue.md': 'queue', 'todo.yjs': 'todo', 'todos.md': 'todos', 'formalized.md': 'formalized' };
      const kind = top[s[1]];
      return kind ? ({ kind } as RepoFile) : null;
    }
    const slug = s[1];
    if (s.length === 3 && s[2] === 'canvas.json') return { kind: 'canvasJson', slug };
    if (s.length >= 4 && MONTH.test(s[2])) {
      const month = s[2];
      if (s.length === 4 && s[3] === 'canvas.yjs') return { kind: 'segment', slug, month };
      if (s.length === 5 && s[3] === 'assets' && ASSET_FILE.test(s[4])) return { kind: 'segmentAsset', slug, month, file: s[4], hash: s[4].split('.')[0] };
      let m: RegExpExecArray | null;
      if (s.length === 5 && s[3] === 'days' && (m = /^(\d{4}-\d{2}-\d{2})\.(md|svg)$/.exec(s[4]))) return { kind: 'day', slug, month, date: m[1], ext: m[2] };
      if (s.length === 5 && s[3] === 'marks' && (m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(md|png)$/.exec(s[4]))) return { kind: 'mark', slug, month, id: m[1], ext: m[2] };
    }
    return null;
  }
  if (s[0] === 'library') {
    if (s.length === 2 && s[1] === 'README.md') return { kind: 'libraryReadme' };
    if (s.length === 2 && s[1] === 'settings.json') return { kind: 'settings' };
    if (s[1] === 'books' && s.length === 4) return { kind: 'book', slug: s[2], file: s[3] };
    if (s[1] === 'clippings' && s.length === 4) return { kind: 'clipping', slug: s[2], file: s[3] };
    if (s[1] === 'clippings' && s.length === 5 && s[3] === 'assets' && ASSET_FILE.test(s[4])) return { kind: 'clippingAsset', slug: s[2], file: s[4], hash: s[4].split('.')[0] };
  }
  return null;
}

/** Normalises a '/'-separated path, resolving '.' and '..'; null when it leaves the repository. */
export function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/**
 * Relative link from the file `fromFile` to the repository path `to` (a file, or a folder
 * ending in '/'), e.g. from `journal/main/2026-10/days/2026-10-21.md` to
 * `library/books/sicp/` → `../../../../library/books/sicp/`.
 */
export function relativeLink(fromFile: string, to: string): string {
  const from = dirOf(fromFile).split('/').filter(Boolean);
  const trailing = to.endsWith('/');
  const target = to.split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < target.length - (trailing ? 0 : 1) && from[i] === target[i]) i++;
  const rel = [...from.slice(i).map(() => '..'), ...target.slice(i)].join('/');
  return (rel || '.') + (trailing && rel ? '/' : '');
}

/** Resolves a relative link written in `fromFile` to a repository path (null when outside). */
export function resolveLink(fromFile: string, link: string): string | null {
  if (link.startsWith('/')) return normalizePath(link);
  return normalizePath(`${dirOf(fromFile)}/${link}`);
}
