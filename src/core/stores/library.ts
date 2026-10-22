/**
 * Local store of the library (Books and Clippings shelves). Metadata lives in the `kv` store,
 * files in the content-addressed `blobs` store, annotations in Yjs documents
 * (`ann:<item id>`, see docIds).
 *
 *   kv 'library'           { books: BookMeta[], clippings: ClippingMeta[], deleted: Tombstone[] }
 *   kv 'clipping:<id>'     ClippingContent
 *   blob <fileHash>        book files
 *   blob <asset hash>      snapshot resources and images
 *
 * Deletions leave a tombstone until sync has removed the item's folder from the repository.
 * The index is shared with other tabs (sharedKv.ts): every change re-reads it before writing.
 */
import type { BookMeta, ClippingMeta } from '../model/types';
import type { SlateDB } from '../storage/idb';
import { SharedKv } from './sharedKv';

export interface SnapshotAsset {
  /** path used inside snapshot.html, `assets/<hash>.<ext>` */
  path: string;
  hash: string;
  mime: string;
  /** original URL the resource was downloaded from */
  url?: string;
}

/** The read-only content of a clipping (L11). */
export interface ClippingContent {
  /** clipping.md body (without front matter): the article or pasted text as Markdown */
  markdown: string;
  /** snapshot.html for link clippings: the saved page with resources rewritten to assets/ */
  snapshotHtml?: string;
  assets: SnapshotAsset[];
}

export interface Tombstone {
  kind: 'book' | 'clipping';
  id: string;
  slug: string;
  deleted: number;
}

interface LibraryIndex {
  books: BookMeta[];
  clippings: ClippingMeta[];
  deleted: Tombstone[];
}

const normalize = (raw: Partial<LibraryIndex> | undefined): LibraryIndex => ({ books: [], clippings: [], deleted: [], ...(raw ?? {}) });

export class LibraryStore {
  private constructor(
    private db: SlateDB,
    private kv: SharedKv<LibraryIndex>,
  ) {}

  /** Fires on every change, here or saved by another tab. */
  get onChange() {
    return this.kv.onChange;
  }

  static async open(db: SlateDB): Promise<LibraryStore> {
    return new LibraryStore(db, await SharedKv.open<LibraryIndex>(db, 'library', normalize));
  }

  private get index(): LibraryIndex {
    return this.kv.get();
  }

  books(): BookMeta[] {
    return this.index.books;
  }

  clippings(): ClippingMeta[] {
    return this.index.clippings;
  }

  book(id: string): BookMeta | undefined {
    return this.index.books.find((b) => b.id === id);
  }

  clipping(id: string): ClippingMeta | undefined {
    return this.index.clippings.find((c) => c.id === id);
  }

  tombstones(): Tombstone[] {
    return this.index.deleted;
  }

  /** Adds or replaces a book's metadata (the file is stored separately by hash). */
  async putBook(meta: BookMeta): Promise<void> {
    await this.kv.mutate((ix) => ({ ...ix, books: [...ix.books.filter((b) => b.id !== meta.id), meta] }));
  }

  async putClipping(meta: ClippingMeta, content?: ClippingContent): Promise<void> {
    if (content) await this.db.set(`clipping:${meta.id}`, content);
    await this.kv.mutate((ix) => ({ ...ix, clippings: [...ix.clippings.filter((c) => c.id !== meta.id), meta] }));
  }

  /**
   * Stores a clipping's content downloaded by sync, without touching its metadata (which may
   * have changed, or been deleted, while the content downloaded). False when it is gone.
   */
  async putClippingContent(id: string, content: ClippingContent): Promise<boolean> {
    if (!this.clipping(id)) return false;
    await this.db.set(`clipping:${id}`, content);
    if (!this.clipping(id)) {
      await this.db.del(`clipping:${id}`);
      return false;
    }
    // listeners re-read the content; nothing in the index changed, so nothing to push
    this.onChange.emit({ fromSync: true });
    return true;
  }

  async clippingContent(id: string): Promise<ClippingContent | null> {
    return (await this.db.get<ClippingContent>(`clipping:${id}`)) ?? null;
  }

  async deleteBook(id: string): Promise<void> {
    const b = this.book(id);
    if (!b) return;
    const tomb: Tombstone = { kind: 'book', id, slug: b.slug, deleted: Date.now() };
    await this.kv.mutate((ix) => ({ ...ix, books: ix.books.filter((x) => x.id !== id), deleted: [...ix.deleted.filter((t) => t.id !== id), tomb] }));
  }

  async deleteClipping(id: string): Promise<void> {
    const c = this.clipping(id);
    if (!c) return;
    const tomb: Tombstone = { kind: 'clipping', id, slug: c.slug, deleted: Date.now() };
    const done = this.kv.mutate((ix) => ({ ...ix, clippings: ix.clippings.filter((x) => x.id !== id), deleted: [...ix.deleted.filter((t) => t.id !== id), tomb] }));
    await this.db.del(`clipping:${id}`);
    await done;
  }

  /** Called by sync once the item's folder is gone from the repository. */
  async clearTombstone(id: string): Promise<void> {
    await this.kv.mutate((ix) => ({ ...ix, deleted: ix.deleted.filter((t) => t.id !== id) }));
  }

  /** Removes an item that was deleted on another device (no tombstone). */
  async forget(id: string): Promise<void> {
    const done = this.kv.mutate((ix) => ({ ...ix, books: ix.books.filter((x) => x.id !== id), clippings: ix.clippings.filter((x) => x.id !== id) }));
    await this.db.del(`clipping:${id}`);
    await done;
  }
}
