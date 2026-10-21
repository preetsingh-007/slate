/**
 * Marks for gym (G3, G6): a region of the canvas flagged as a note, problem, solution or
 * question, to be formalized later in the gym repository.
 */
import type { CanvasObject, FormalizedRecord, Mark, MarkKind, Rect } from '../model/types';
import { objectsBounds } from './export';

export const MARK_KINDS: readonly MarkKind[] = ['note', 'problem', 'solution', 'question'];

export type MarkStatus = { state: 'pending' } | { state: 'formalized'; path: string; heading?: string; date: string } | { state: 'dismissed'; date: string };

export function markStatus(rec: FormalizedRecord | undefined): MarkStatus {
  if (!rec) return { state: 'pending' };
  if (rec.dismissed) return { state: 'dismissed', date: rec.date };
  return { state: 'formalized', path: rec.path, heading: rec.heading, date: rec.date };
}

/** A mark is editable or removable until it appears in formalized.md (G3). */
export function markEditable(rec: FormalizedRecord | undefined): boolean {
  return !rec;
}

/** Path for the gym pane tab of a formalized mark: the file, at its heading (G6). */
export function gymTabPath(rec: Extract<FormalizedRecord, { dismissed: false }>): string {
  return rec.path + (rec.heading ? '#' + rec.heading : '');
}

/** Padding around the marked objects in a mark's region. */
export const MARK_PAD = 8;

export function markRegion(objects: readonly CanvasObject[]): Rect | null {
  const b = objectsBounds(objects);
  if (!b) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { x: r(b.x - MARK_PAD), y: r(b.y - MARK_PAD), w: r(b.w + 2 * MARK_PAD), h: r(b.h + 2 * MARK_PAD) };
}

export interface MarkFields {
  kind: MarkKind;
  topic: string;
  problem: string;
  comment: string;
}

/** Normalises a gym path typed by hand: trimmed, no leading or trailing slashes. */
export function cleanGymPath(p: string): string {
  return p.trim().replace(/^\/+|\/+$/g, '');
}

export function makeMark(id: string, objects: readonly CanvasObject[], fields: MarkFields, now: number): Mark | null {
  const region = markRegion(objects);
  if (!region) return null;
  return {
    id,
    objects: objects.map((o) => o.id),
    region,
    kind: fields.kind,
    topic: cleanGymPath(fields.topic),
    problem: fields.kind === 'solution' ? cleanGymPath(fields.problem) : '',
    comment: fields.comment.trim(),
    created: now,
  };
}
