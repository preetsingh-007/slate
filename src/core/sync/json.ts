/**
 * JSON files in the repository and how concurrent edits to them merge (R2, R11).
 *
 * | File | Merge rule |
 * | --- | --- |
 * | `journal/<canvas>/canvas.json` | Three-way, field by field, against the version last synced. A field changed on one side takes that side; changed on both: `topics` merge as sets (additions and removals from both sides), `segments` merge per month (union of bounds), any other field takes this device's value. Never synced on this device (no base): the repository's value. |
 * | `library/books/<slug>/book.json` | Same three-way field merge (`topics` as sets). A book folder removed on GitHub removes the book here. |
 * | `library/clippings/<slug>/meta.json` | Same three-way field merge. Clipping content (`clipping.md`, `snapshot.html`, `assets/`) never changes after creation (L11), so it is written once and never merged. |
 * | `library/settings.json` | `mergeSettings` (core/stores/settings.ts): each reading position and the pane state newest-wins by their own `updated`; everything else from the side with the newer `updated`. |
 *
 * Files are written with sorted keys and two-space indentation, so equal content gives equal
 * bytes (and the same git blob sha) on every device.
 */
import type { CanvasMeta, Rect } from '../model/types';
import { unionRect } from '../canvas/bounds';

const enc = new TextEncoder();
const dec = new TextDecoder();

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

/** Deterministic JSON text: sorted keys, two-space indent, trailing newline. */
export function stableJson(v: unknown): string {
  return JSON.stringify(sortKeys(v), null, 2) + '\n';
}

export function jsonBytes(v: unknown): Uint8Array {
  return enc.encode(stableJson(v));
}

export function parseJsonBytes<T>(bytes: Uint8Array): T | null {
  try {
    return JSON.parse(dec.decode(bytes)) as T;
  } catch {
    return null;
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** Three-way merge of string sets: keeps additions from both sides, applies removals from both. */
export function mergeSet3(base: readonly string[] | undefined, local: readonly string[], remote: readonly string[]): string[] {
  const b = new Set(base ?? []);
  const out: string[] = [];
  const seen = new Set<string>();
  const removed = new Set<string>();
  for (const x of b) if (!local.includes(x) || !remote.includes(x)) removed.add(x);
  for (const x of [...local, ...remote]) {
    if (seen.has(x) || removed.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** Merges one field changed on both sides; undefined falls back to the default rule. */
export type FieldResolver = (key: string, base: unknown, local: unknown, remote: unknown) => unknown;

/**
 * Field-by-field three-way merge of two versions of a JSON object against their common base
 * (the version last synced; undefined when there is none). Changed on one side → that side;
 * changed on both → `resolve`, else this device's value. Without a base (this device never
 * synced the file, e.g. the default canvas of a new device) the repository's value wins, as
 * the repository is the source of truth.
 */
export function merge3<T extends object>(base: T | undefined, local: T, remote: T, resolve?: FieldResolver): T {
  const out: Record<string, unknown> = {};
  const l = local as Record<string, unknown>;
  const r = remote as Record<string, unknown>;
  const b = (base ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const lv = l[k];
    const rv = r[k];
    let v: unknown;
    if (deepEqual(lv, rv)) v = lv;
    else if (base && deepEqual(lv, b[k])) v = rv;
    else if (base && deepEqual(rv, b[k])) v = lv;
    else {
      const custom = resolve?.(k, b[k], lv, rv);
      v = custom !== undefined ? custom : base ? lv : rv;
    }
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

const topicsResolver: FieldResolver = (key, base, local, remote) => {
  if (key === 'topics' && Array.isArray(local) && Array.isArray(remote)) return mergeSet3(base as string[] | undefined, local as string[], remote as string[]);
  return undefined;
};

// ---------------------------------------------------------------- canvas.json

/** Content of `journal/<canvas>/canvas.json`. The folder name is the slug. */
export interface CanvasFile {
  id: string;
  title: string;
  topics: string[];
  /** month → bounds of the month's objects (R3/R9: which segments exist, for loading on demand) */
  segments: Record<string, Rect | null>;
}

export function canvasFile(meta: CanvasMeta): CanvasFile {
  return { id: meta.id, title: meta.title, topics: meta.topics ?? [], segments: meta.segments ?? {} };
}

export function canvasMetaFromFile(slug: string, f: Partial<CanvasFile>): CanvasMeta {
  return {
    id: typeof f.id === 'string' ? f.id : slug,
    slug,
    title: typeof f.title === 'string' ? f.title : slug,
    topics: Array.isArray(f.topics) ? f.topics.filter((t) => typeof t === 'string') : [],
    segments: f.segments && typeof f.segments === 'object' ? f.segments : {},
  };
}

function mergeSegments(a: Record<string, Rect | null>, b: Record<string, Rect | null>): Record<string, Rect | null> {
  const out: Record<string, Rect | null> = { ...a };
  for (const [m, r] of Object.entries(b)) {
    const cur = out[m];
    out[m] = !cur ? r : !r ? cur : unionRect(cur, r);
  }
  return out;
}

export function mergeCanvasFile(base: CanvasFile | undefined, local: CanvasFile, remote: CanvasFile): CanvasFile {
  return merge3(base, local, remote, (key, b, l, r) => {
    if (key === 'segments') return mergeSegments((l ?? {}) as Record<string, Rect | null>, (r ?? {}) as Record<string, Rect | null>);
    return topicsResolver(key, b, l, r);
  });
}

// ---------------------------------------------------------------- book.json, meta.json

/** book.json and meta.json: the metadata objects themselves, merged field by field. */
export function mergeItemFile<T extends object>(base: T | undefined, local: T, remote: T): T {
  return merge3(base, local, remote, topicsResolver);
}
