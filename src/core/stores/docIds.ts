/** Ids of the Yjs documents kept in the DocStore, and their repository paths. */

/** A canvas segment: `journal/<slug>/<month>/canvas.yjs`. */
export const segmentDocId = (slug: string, month: string) => `seg:${slug}:${month}`;

/** The To-dos page checklist: `journal/todo.yjs`. */
export const TODO_DOC_ID = 'todo';

/** Annotations of a book or clipping: `library/books/<slug>/annotations.yjs` or `library/clippings/<slug>/annotations.yjs`. */
export const annotationsDocId = (itemId: string) => `ann:${itemId}`;

export function parseSegmentDocId(id: string): { slug: string; month: string } | null {
  const m = /^seg:([^:]+):(\d{4}-\d{2})$/.exec(id);
  return m ? { slug: m[1], month: m[2] } : null;
}
