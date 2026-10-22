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
 */
import type { BookMeta, ClippingMeta } from '../model/types';
import type { SlateDB } from '../storage/idb';
import { Emitter } from '../util/emitter';

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

export class LibraryStore {
  readonly onChange = new Emitter<void>();
  private index: LibraryIndex = { books: [], clippings: [], deleted: [] };

  private constructor(private db: SlateDB) {}

  static async open(db: SlateDB): Promise<LibraryStore> {
    const s = new LibraryStore(db);
    s.index = { books: [], clippings: [], deleted: [], ...((await db.get<LibraryIndex>('library')) ?? {}) };
    return s;
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
    this.index.books = [...this.index.books.filter((b) => b.id !== meta.id), meta];
    await this.save();
  }

  async putClipping(meta: ClippingMeta, content?: ClippingContent): Promise<void> {
    if (content) await this.db.set(`clipping:${meta.id}`, content);
    this.index.clippings = [...this.index.clippings.filter((c) => c.id !== meta.id), meta];
    await this.save();
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
    this.onChange.emit();
    return true;
  }

  async clippingContent(id: string): Promise<ClippingContent | null> {
    return (await this.db.get<ClippingContent>(`clipping:${id}`)) ?? null;
  }

  async deleteBook(id: string): Promise<void> {
    const b = this.book(id);
    if (!b) return;
    this.index.books = this.index.books.filter((x) => x.id !== id);
    this.index.deleted = [...this.index.deleted, { kind: 'book', id, slug: b.slug, deleted: Date.now() }];
    await this.save();
  }

  async deleteClipping(id: string): Promise<void> {
    const c = this.clipping(id);
    if (!c) return;
    this.index.clippings = this.index.clippings.filter((x) => x.id !== id);
    this.index.deleted = [...this.index.deleted, { kind: 'clipping', id, slug: c.slug, deleted: Date.now() }];
    await this.db.del(`clipping:${id}`);
    await this.save();
  }

  /** Called by sync once the item's folder is gone from the repository. */
  async clearTombstone(id: string): Promise<void> {
    this.index.deleted = this.index.deleted.filter((t) => t.id !== id);
    await this.save();
  }

  /** Removes an item that was deleted on another device (no tombstone). */
  async forget(id: string): Promise<void> {
    this.index.books = this.index.books.filter((x) => x.id !== id);
    this.index.clippings = this.index.clippings.filter((x) => x.id !== id);
    await this.db.del(`clipping:${id}`);
    await this.save();
  }

  private async save() {
    await this.db.set('library', this.index);
    this.onChange.emit();
  }
}
