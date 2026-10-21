/**
 * Annotations of a book or clipping (L4, L5, L11), stored apart from the file in the Yjs
 * document `ann:<item id>` (Y.Map `annotations`: id → Annotation). Each annotation is an
 * immutable value keyed by id, so edits on two devices merge per annotation (R2).
 */
import * as Y from 'yjs';
import type { Annotation, AnnotationKind, Locator, Rect, StrokeTool } from '../model/types';
import { LOCAL_ORIGIN } from '../storage/docstore';
import { uid } from '../util/ids';

/** The five highlight colours (L4). */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow', value: '#f5d742' },
  { id: 'green', label: 'Green', value: '#5cc27e' },
  { id: 'blue', label: 'Blue', value: '#6ca0f0' },
  { id: 'pink', label: 'Pink', value: '#f06595' },
  { id: 'orange', label: 'Orange', value: '#f59f42' },
] as const;

export function annotationsMap(doc: Y.Doc): Y.Map<Annotation> {
  return doc.getMap<Annotation>('annotations');
}

/** All annotations, oldest first. */
export function listAnnotations(doc: Y.Doc): Annotation[] {
  return [...annotationsMap(doc).values()].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
}

export function putAnnotation(doc: Y.Doc, a: Annotation): void {
  doc.transact(() => annotationsMap(doc).set(a.id, a), LOCAL_ORIGIN);
}

export function removeAnnotation(doc: Y.Doc, id: string): void {
  doc.transact(() => annotationsMap(doc).delete(id), LOCAL_ORIGIN);
}

export function newAnnotation(
  kind: AnnotationKind,
  locator: Locator,
  fields: { color?: string; text?: string; rects?: Rect[]; strokes?: { pts: number[]; color: string; size: number; tool: StrokeTool }[] } = {},
  now = Date.now(),
): Annotation {
  const a: Annotation = { id: uid(), kind, locator, color: fields.color ?? HIGHLIGHT_COLORS[0].value, created: now };
  if (fields.text !== undefined) a.text = fields.text;
  if (fields.rects) a.rects = fields.rects;
  if (fields.strokes) a.strokes = fields.strokes;
  return a;
}

/** Annotations of one PDF page (1-based). */
export function pdfPageAnnotations(list: Annotation[], page: number): Annotation[] {
  return list.filter((a) => a.locator.type === 'pdf' && a.locator.page === page);
}

/** Bounding box of page-normalised ink points (x and y in units of the page width). */
export function inkBounds(pts: number[], size: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    x1 = Math.max(x1, pts[i]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - size / 2, y: y0 - size / 2, w: x1 - x0 + size, h: y1 - y0 + size };
}
