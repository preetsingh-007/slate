/**
 * Offline mirror of the gym repository (G1, G7, G8) in IndexedDB, refreshed by sync on every
 * pull: the repository tree (paths and blob shas), the content of every Markdown file outside
 * `journal/` and `library/`, and the images and SVGs those files reference (up to a size cap).
 * Content is downloaded by blob sha, only when it changed.
 *
 *   kv gym:tree        { commit, entries }
 *   kv gym:index       path → sha of mirrored content
 *   kv gym:refs        Markdown path → image paths it references
 *   kv gym:f:<path>    text (Markdown) or Blob (images)
 */
import type { SlateDB } from '../storage/idb';
import { Emitter } from '../util/emitter';
import type { GymEntry, GymFiles } from './files';

/** Markdown larger than this is not mirrored (read on demand when online). */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
/** Images larger than this are not mirrored. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Files read on demand (not mirrored) up to this size. */
export const MAX_ON_DEMAND_BYTES = 1024 * 1024;

const IMAGE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

export type BlobFetcher = (sha: string) => Promise<Uint8Array>;

export interface GymMirror extends GymFiles {
  /** Updates the mirror to `commit` (sync calls this after a pull). */
  refresh(commit: string, entries: GymEntry[], getBlob: BlobFetcher): Promise<void>;
  /** Lets reads of files that are not mirrored fetch them while online (null when offline). */
  setFetcher(fn: BlobFetcher | null): void;
  clear(): Promise<void>;
}

const isMirroredMarkdown = (e: GymEntry) => e.path.endsWith('.md') && !e.path.startsWith('journal/') && !e.path.startsWith('library/') && e.size <= MAX_MARKDOWN_BYTES;

export function imageMime(path: string): string | null {
  return IMAGE_EXT[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** Relative image references in Markdown (`![](x)` and `<img src="x">`), resolved to repository paths. */
export function imageRefs(mdPath: string, text: string): string[] {
  const out = new Set<string>();
  const dir = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/')) : '';
  const add = (raw: string) => {
    const t = raw.split('#')[0].split('?')[0];
    if (!t || t.includes('://') || t.startsWith('data:') || t.startsWith('mailto:')) return;
    let decoded = t;
    try {
      decoded = decodeURIComponent(t);
    } catch {
      // keep as written
    }
    const parts: string[] = [];
    for (const seg of (decoded.startsWith('/') ? decoded : `${dir}/${decoded}`).split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (!parts.length) return;
        parts.pop();
      } else parts.push(seg);
    }
    const p = parts.join('/');
    if (imageMime(p)) out.add(p);
  };
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)) add(m[1]);
  for (const m of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(m[1]);
  return [...out];
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const dec = new TextDecoder();

export class IdbGymFiles implements GymMirror {
  private head = '';
  private entries: GymEntry[] = [];
  private byPath = new Map<string, GymEntry>();
  private index: Record<string, string> = {};
  private refs: Record<string, string[]> = {};
  private fetcher: BlobFetcher | null = null;
  private memo = new Map<string, { sha: string; data: string | Blob }>();
  private changed = new Emitter<void>();

  private constructor(private db: SlateDB) {}

  static async open(db: SlateDB): Promise<IdbGymFiles> {
    const m = new IdbGymFiles(db);
    const tree = await db.get<{ commit: string; entries: GymEntry[] }>('gym:tree');
    if (tree) m.setTree(tree.commit, tree.entries);
    m.index = (await db.get<Record<string, string>>('gym:index')) ?? {};
    m.refs = (await db.get<Record<string, string[]>>('gym:refs')) ?? {};
    return m;
  }

  private setTree(commit: string, entries: GymEntry[]) {
    this.head = commit;
    this.entries = entries;
    this.byPath = new Map(entries.map((e) => [e.path, e]));
  }

  commit(): string {
    return this.head;
  }

  list(): GymEntry[] {
    return this.entries;
  }

  onChange(fn: () => void): () => void {
    const off = this.changed.on(fn);
    return () => void off();
  }

  setFetcher(fn: BlobFetcher | null): void {
    this.fetcher = fn;
  }

  private async read(path: string): Promise<string | Blob | null> {
    const entry = this.byPath.get(path);
    if (this.index[path] && (!entry || this.index[path] === entry.sha)) {
      const v = await this.db.get<string | Blob>(`gym:f:${path}`);
      if (v !== undefined) return v;
    }
    if (!entry || !this.fetcher || entry.size > MAX_ON_DEMAND_BYTES) return null;
    const hit = this.memo.get(path);
    if (hit && hit.sha === entry.sha) return hit.data;
    try {
      const bytes = await this.fetcher(entry.sha);
      const mime = imageMime(path);
      const data = mime ? new Blob([bytes as BlobPart], { type: mime }) : dec.decode(bytes);
      if (this.memo.size > 64) this.memo.clear();
      this.memo.set(path, { sha: entry.sha, data });
      return data;
    } catch {
      return null;
    }
  }

  async readText(path: string): Promise<string | null> {
    const v = await this.read(path);
    if (v === null) return null;
    return typeof v === 'string' ? v : await v.text();
  }

  async readBlob(path: string): Promise<Blob | null> {
    const v = await this.read(path);
    if (v === null) return null;
    return typeof v === 'string' ? new Blob([v], { type: imageMime(path) ?? 'text/plain' }) : v;
  }

  async refresh(commit: string, entries: GymEntry[], getBlob: BlobFetcher): Promise<void> {
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const markdown = entries.filter(isMirroredMarkdown);
    const index = { ...this.index };
    const refs: Record<string, string[]> = {};
    for (const e of markdown) if (this.refs[e.path]) refs[e.path] = this.refs[e.path];

    // 1. Markdown that changed
    const changedMd = markdown.filter((e) => index[e.path] !== e.sha);
    await mapLimit(changedMd, 6, async (e) => {
      const text = dec.decode(await getBlob(e.sha));
      await this.db.set(`gym:f:${e.path}`, text);
      index[e.path] = e.sha;
      refs[e.path] = imageRefs(e.path, text);
    });

    // 2. images the Markdown references
    const wantedImages = new Set<string>();
    for (const list of Object.values(refs)) for (const p of list) wantedImages.add(p);
    const images = [...wantedImages].map((p) => byPath.get(p)).filter((e): e is GymEntry => !!e && e.size <= MAX_IMAGE_BYTES && index[e.path] !== e.sha);
    await mapLimit(images, 6, async (e) => {
      const bytes = await getBlob(e.sha);
      await this.db.set(`gym:f:${e.path}`, new Blob([bytes as BlobPart], { type: imageMime(e.path)! }));
      index[e.path] = e.sha;
    });

    // 3. forget what is no longer wanted
    const keep = new Set([...markdown.map((e) => e.path), ...[...wantedImages].filter((p) => byPath.has(p))]);
    for (const p of Object.keys(index)) {
      if (keep.has(p)) continue;
      delete index[p];
      await this.db.del(`gym:f:${p}`);
    }

    this.index = index;
    this.refs = refs;
    this.setTree(commit, entries);
    await this.db.set('gym:index', index);
    await this.db.set('gym:refs', refs);
    await this.db.set('gym:tree', { commit, entries });
    this.memo.clear();
    this.changed.emit();
  }

  async clear(): Promise<void> {
    for (const p of Object.keys(this.index)) await this.db.del(`gym:f:${p}`);
    this.index = {};
    this.refs = {};
    this.setTree('', []);
    await this.db.del('gym:index');
    await this.db.del('gym:refs');
    await this.db.del('gym:tree');
    this.changed.emit();
  }
}
