/**
 * Layout of a canvas segment document (`journal/<canvas>/<YYYY-MM>/canvas.yjs`), R2/R3.
 *
 *   objects:   Y.Map<id, Y.Map>   one Y.Map per object; plain values are immutable (an edit
 *                                 replaces the value); a text box's `content` is a Y.Text
 *   marks:     Y.Map<id, Y.Map>   marks for gym
 *   days:      Y.Map<"date@device", y>  day lines; read through `dayLines`, which keeps the
 *                                 lowest line per date (C19)
 *   dayTopics: Y.Map<date, string[]>    topic tags of a day (G2)
 *
 * An object lives in the segment of the month it was created in, forever.
 */
import * as Y from 'yjs';
import type { CanvasObject, Mark, ObjectKind } from '../model/types';
import { parseDate } from '../util/time';

export const LOCAL = 'local';
/** Origin for derived layout writes (measured text heights): not part of undo. */
export const LAYOUT = 'layout';

export function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function marksMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('marks');
}

export function daysMap(doc: Y.Doc): Y.Map<number> {
  return doc.getMap('days');
}

export function dayTopicsMap(doc: Y.Doc): Y.Map<string[]> {
  return doc.getMap('dayTopics');
}

const KINDS: ReadonlySet<ObjectKind> = new Set(['stroke', 'text', 'image', 'clip', 'shape']);

/** Plain snapshot of an object. Returns null for malformed entries (e.g. from a newer app). */
export function readObject(m: Y.Map<unknown>): CanvasObject | null {
  const o: Record<string, unknown> = {};
  for (const [k, v] of m.entries()) o[k] = v instanceof Y.Text ? v.toString() : v;
  if (typeof o.id !== 'string' || !KINDS.has(o.kind as ObjectKind)) return null;
  if (!Array.isArray(o.topics)) o.topics = [];
  if (typeof o.rotation !== 'number') o.rotation = 0;
  if (typeof o.z !== 'string') o.z = 'i';
  if (o.kind === 'text' && typeof o.content !== 'string') o.content = '';
  return o as unknown as CanvasObject;
}

/** Creates the Y.Map for a new object. */
export function createObjectMap(obj: CanvasObject): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (obj.kind === 'text' && k === 'content') m.set(k, new Y.Text(v as string));
    else m.set(k, v);
  }
  return m;
}

/** Applies a patch of plain fields to an object's Y.Map. `content` replaces the text. */
export function patchObjectMap(m: Y.Map<unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'kind') continue;
    if (k === 'content') {
      const t = m.get('content');
      if (t instanceof Y.Text) {
        const cur = t.toString();
        if (cur !== v) replaceText(t, cur, String(v ?? ''));
      } else m.set('content', new Y.Text(String(v ?? '')));
      continue;
    }
    if (v === undefined) m.delete(k);
    else m.set(k, v);
  }
}

/** Replaces text with a minimal edit (common prefix/suffix kept) so concurrent edits merge. */
export function replaceText(t: Y.Text, cur: string, next: string) {
  let start = 0;
  while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
  let endCur = cur.length;
  let endNext = next.length;
  while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
    endCur--;
    endNext--;
  }
  if (endCur > start) t.delete(start, endCur - start);
  if (endNext > start) t.insert(start, next.slice(start, endNext));
}

export function readMark(m: Y.Map<unknown>): Mark | null {
  const o = Object.fromEntries(m.entries()) as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    objects: Array.isArray(o.objects) ? (o.objects as string[]) : [],
    region: (o.region as Mark['region']) ?? { x: 0, y: 0, w: 0, h: 0 },
    kind: (o.kind as Mark['kind']) ?? 'note',
    topic: (o.topic as string) ?? '',
    problem: (o.problem as string) ?? '',
    comment: (o.comment as string) ?? '',
    created: (o.created as number) ?? 0,
  };
}

export function createMarkMap(mark: Mark): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(mark)) m.set(k, v);
  return m;
}

/** Day lines of one segment: date → y, keeping the lowest (largest y) line per date. */
export function dayLines(doc: Y.Doc): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, y] of daysMap(doc).entries()) {
    const date = key.split('@')[0];
    const prev = out.get(date);
    if (prev === undefined || y > prev) out.set(date, y);
  }
  return out;
}

/** Removes duplicate day lines (two devices created one for the same date): keeps the lowest. */
export function normalizeDays(doc: Y.Doc, origin: unknown = LAYOUT) {
  const days = daysMap(doc);
  const keep = new Map<string, string>();
  for (const key of [...days.keys()].sort()) {
    const date = key.split('@')[0];
    const kept = keep.get(date);
    if (kept === undefined || days.get(key)! > days.get(kept)!) keep.set(date, key);
  }
  const kept = new Set(keep.values());
  const drop = [...days.keys()].filter((key) => !kept.has(key));
  if (!drop.length) return;
  doc.transact(() => {
    for (const key of drop) days.delete(key);
  }, origin);
}

/** Slack around a day for objects made in another time zone (see `pruneDays`). */
const ZONE_SLACK = 12 * 3600_000;

/**
 * C19: removes the lines of days that have no objects left. Deleting a day's last object
 * removes its line (model.ts); this clears lines left behind before that, or by an older app.
 * An object counts for a day when it was made within 12 hours of it, so a line is kept when
 * its objects were made on a device in another time zone.
 */
export function pruneDays(doc: Y.Doc, origin: unknown = LAYOUT) {
  const days = daysMap(doc);
  if (!days.size) return;
  const created: number[] = [];
  for (const m of objectsMap(doc).values()) {
    const c = m.get('created');
    if (typeof c === 'number') created.push(c);
  }
  const drop = [...days.keys()].filter((key) => {
    const start = parseDate(key.split('@')[0]).getTime();
    const end = start + 86_400_000;
    return !created.some((c) => c >= start - ZONE_SLACK && c < end + ZONE_SLACK);
  });
  if (!drop.length) return;
  doc.transact(() => {
    for (const key of drop) days.delete(key);
  }, origin);
}
