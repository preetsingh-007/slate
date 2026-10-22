/**
 * Mapping between local documents and repository files, and reading documents without opening
 * them in the app (R3, R9).
 */
import * as Y from 'yjs';
import type { DocStore } from '../storage/docstore';
import { stateDigest } from '../storage/digest';
import type { LibraryStore } from '../stores/library';
import { TODO_DOC_ID, annotationsDocId, parseSegmentDocId, segmentDocId } from '../stores/docIds';
import { CLIPPING_DIR, NAME, MONTH, TODO_PATH, bookAnnotationsPath, clippingAnnotationsPath, parseRepoPath, segmentPath } from './paths';

/** Repository path of a document, or null when it has none (yet). */
export function pathForDoc(docId: string, library: LibraryStore): string | null {
  if (docId === TODO_DOC_ID) return TODO_PATH;
  const seg = parseSegmentDocId(docId);
  if (seg) return NAME.test(seg.slug) && MONTH.test(seg.month) ? segmentPath(seg.slug, seg.month) : null;
  if (docId.startsWith('ann:')) {
    const id = docId.slice(4);
    const book = library.book(id);
    if (book) return NAME.test(book.slug) ? bookAnnotationsPath(book.slug) : null;
    const clipping = library.clipping(id);
    if (clipping) return CLIPPING_DIR.test(clipping.slug) ? clippingAnnotationsPath(clipping.slug) : null;
  }
  return null;
}

/** Document id of a repository path, or null when the path is not a document. */
export function docForPath(path: string, library: LibraryStore): string | null {
  const f = parseRepoPath(path);
  if (!f) return null;
  if (f.kind === 'todo') return TODO_DOC_ID;
  if (f.kind === 'segment') return segmentDocId(f.slug, f.month);
  if (f.kind === 'book' && f.file === 'annotations.yjs') {
    const b = library.books().find((x) => x.slug === f.slug);
    return b ? annotationsDocId(b.id) : null;
  }
  if (f.kind === 'clipping' && f.file === 'annotations.yjs') {
    const c = library.clippings().find((x) => x.slug === f.slug);
    return c ? annotationsDocId(c.id) : null;
  }
  return null;
}

/**
 * Runs `fn` on a document: the live one when it is open, otherwise a temporary copy built from
 * its stored state (destroyed afterwards). Returns null when the document has no state.
 */
export async function withDoc<T>(docs: DocStore, docId: string, fn: (doc: Y.Doc) => T): Promise<T | null> {
  const live = docs.getLoaded(docId);
  if (live) return fn(live);
  const state = await docs.getState(docId);
  if (!state) return null;
  const doc = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(doc, state);
    return fn(doc);
  } finally {
    doc.destroy();
  }
}

/** Re-encodes a (possibly log-merged) state through a GC-enabled doc: smaller files in Git. */
export function compactState(state: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** True when the remote copy (with `digest`) already has exactly this state. */
export function containedIn(state: Uint8Array, digest: string | undefined): boolean {
  return !!digest && stateDigest(state) === digest;
}

export function isEmptyUpdate(u: Uint8Array): boolean {
  // an empty Yjs update encodes as [0, 0] (no structs, empty delete set)
  return u.length <= 2 && u.every((b) => b === 0);
}
