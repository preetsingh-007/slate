/**
 * Local full-text index of the library (L12): the text of every book (PDF pages, EPUB text)
 * and clipping, kept in IndexedDB under kv `libtext:<id>` on this device only (it is derived
 * from files the device has, and rebuilt when missing). Search matches every query word in the
 * title or the text, case- and accent-insensitively.
 */
import type { SlateDB } from '../storage/idb';
import { LRU } from '../util/lru';

export interface IndexedText {
  id: string;
  /** PDF: text per page (index 0 = page 1) */
  pages?: string[];
  /** EPUB and clippings */
  text?: string;
  /** content hash the text was extracted from (file hash, clipping content hash) */
  source: string;
}

export interface SearchItem {
  id: string;
  title: string;
  /** authors, site, source label… also matched */
  extra?: string;
}

export interface SearchHit {
  id: string;
  inTitle: boolean;
  /** text around the first match in the full text */
  snippet?: string;
  /** PDF page of the first match */
  page?: number;
}

const KEY = (id: string) => `libtext:${id}`;

/** Lower-case, accent-free, whitespace-collapsed text for matching. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function queryWords(q: string): string[] {
  return fold(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

const shared = new WeakMap<SlateDB, LibraryTextIndex>();

export class LibraryTextIndex {
  private cache = new LRU<string, IndexedText | null>(24);

  constructor(private db: SlateDB) {}

  /**
   * The database's one index in this tab. Every user shares it, so the search sees what the
   * background indexer adds: a separate instance would keep its cached "not indexed yet".
   */
  static for(db: SlateDB): LibraryTextIndex {
    let index = shared.get(db);
    if (!index) shared.set(db, (index = new LibraryTextIndex(db)));
    return index;
  }

  async get(id: string): Promise<IndexedText | null> {
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit;
    const v = (await this.db.get<IndexedText>(KEY(id))) ?? null;
    this.cache.set(id, v);
    return v;
  }

  /** True when the item's text is indexed for this content. */
  async has(id: string, source: string): Promise<boolean> {
    return (await this.get(id))?.source === source;
  }

  async put(entry: IndexedText): Promise<void> {
    await this.db.set(KEY(entry.id), entry);
    this.cache.set(entry.id, entry);
  }

  async remove(id: string): Promise<void> {
    await this.db.del(KEY(id));
    this.cache.delete(id);
  }

  /** Items matching every query word in their title/extra or their indexed text. */
  async search(query: string, items: SearchItem[], signal?: AbortSignal): Promise<SearchHit[]> {
    const words = queryWords(query);
    if (!words.length) return items.map((i) => ({ id: i.id, inTitle: false }));
    const out: SearchHit[] = [];
    for (const item of items) {
      if (signal?.aborted) break;
      const head = fold(`${item.title} ${item.extra ?? ''}`);
      const missing = words.filter((w) => !head.includes(w));
      if (!missing.length) {
        out.push({ id: item.id, inTitle: true });
        continue;
      }
      const t = await this.get(item.id);
      if (!t) continue;
      const hit = matchText(t, missing, words[0]);
      if (hit) out.push({ id: item.id, inTitle: false, ...hit });
    }
    return out;
  }
}

function matchText(t: IndexedText, words: string[], first: string): { snippet: string; page?: number } | null {
  if (t.pages) {
    const folded = t.pages.map(fold);
    const all = folded.join(' ');
    if (!words.every((w) => all.includes(w))) return null;
    const probe = words.includes(first) ? first : words[0];
    const p = folded.findIndex((x) => x.includes(probe));
    return { snippet: snippet(t.pages[p] ?? '', folded[p] ?? '', probe), page: p + 1 };
  }
  const text = t.text ?? '';
  const f = fold(text);
  if (!words.every((w) => f.includes(w))) return null;
  return { snippet: snippet(text, f, words[0]) };
}

/** ~120 characters around the match (positions are approximate after folding). */
function snippet(raw: string, folded: string, word: string): string {
  const i = folded.indexOf(word);
  const flat = raw.replace(/\s+/g, ' ');
  const start = Math.max(0, i - 50);
  const s = flat.slice(start, start + 120).trim();
  return (start > 0 ? '…' : '') + s + (start + 120 < flat.length ? '…' : '');
}
