/**
 * Beautify (C16), shapes only: rough lines, arrows, rectangles, ellipses, triangles and diamonds
 * in a selection of strokes snap to clean geometry, aligned with their neighbours, with arrow
 * and line endpoints glued to the shapes they point at.
 *
 *   beautifyShapes(strokes, { existing }) → { shapes, leftover }
 *
 * Writing and unrecognised ink stay as strokes (`leftover`). The caller turns each result into
 * a ShapeObject and hides the original strokes (`beautifiedInto`), so one tap restores them.
 *
 * Adapted from Axiom's beautify.ts: the handwriting/AI path and the class colour-coding are
 * dropped; shapes keep the colour of the ink they were drawn with.
 */
import type { ShapeGeometry as SlateGeometry, ShapeKind as SlateShapeKind } from '../model/types';
import { clusterStrokes } from './cluster';
import { alignShapes, isClosedKind, snapConnectors } from './shapes';
import type { ShapeGeometry, ShapeKind } from './recognize';
import type { InkStroke } from './types';

/** End of a connector: an index into `shapes` (a new shape) or the id of an existing shape. */
export type ConnectorEnd = number | string | null;

export interface BeautifiedShape {
  shape: SlateShapeKind;
  geometry: SlateGeometry;
  color: string;
  lineWidth: number;
  strokeIds: string[];
  /** lines and arrows: what each end is attached to ([tail, tip]) */
  connects?: [ConnectorEnd, ConnectorEnd];
}

export interface ExistingShape {
  id: string;
  geometry: SlateGeometry;
}

export interface BeautifyOptions {
  /** shapes already on the canvas near the selection: connectors may attach to them; they never move */
  existing?: readonly ExistingShape[];
  /** align nearby shapes and snap connectors (default true) */
  align?: boolean;
}

export interface BeautifyResult {
  shapes: BeautifiedShape[];
  /** strokes that stay as ink (writing, doodles) */
  leftover: string[];
}

/** Slate stores circles as ellipse shapes (the geometry keeps `kind: 'circle'`). */
export function shapeKindOf(g: SlateGeometry): SlateShapeKind {
  return g.kind === 'circle' ? 'ellipse' : g.kind;
}

/** The colour most member strokes use. */
function dominantColor(strokes: readonly InkStroke[]): string {
  const counts = new Map<string, number>();
  for (const s of strokes) counts.set(s.color, (counts.get(s.color) ?? 0) + 1);
  let best = strokes[0]?.color ?? 'currentInk';
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}

export function beautifyShapes(strokes: readonly InkStroke[], opts: BeautifyOptions = {}): BeautifyResult {
  const pens = strokes.filter((s) => s.tool === 'pen');
  const clusters = clusterStrokes(pens);
  const placed: { geometry: ShapeGeometry; strokes: InkStroke[] }[] = clusters.shapes.map((c) => ({ geometry: c.recognition.geometry, strokes: c.strokes }));
  const n = placed.length;
  const existing = opts.existing ?? [];
  if (opts.align !== false && n) {
    alignShapes(placed);
    // existing closed shapes take part in connector snapping only (appended after the new ones)
    const all = [...placed, ...existing.filter((e) => isClosedKind(e.geometry.kind as ShapeKind)).map((e) => ({ geometry: e.geometry as ShapeGeometry, strokes: [] as InkStroke[], id: e.id }))];
    const links = snapConnectors(all);
    for (const [ci, ends] of links) {
      if (ci >= n) continue;
      const ref = (i: number | null): ConnectorEnd => (i === null ? null : i < n ? i : (all[i] as { id?: string }).id ?? null);
      (placed[ci] as { connects?: [ConnectorEnd, ConnectorEnd] }).connects = [ref(ends[0]), ref(ends[1])];
    }
  }
  const used = new Set<string>();
  const shapes: BeautifiedShape[] = placed.map((p) => {
    const avgSize = p.strokes.reduce((a, s) => a + s.size, 0) / Math.max(1, p.strokes.length);
    for (const s of p.strokes) used.add(s.id);
    const g = p.geometry as SlateGeometry;
    const out: BeautifiedShape = {
      shape: shapeKindOf(g),
      geometry: g,
      color: dominantColor(p.strokes),
      lineWidth: Math.round(Math.min(8, Math.max(1.5, avgSize * 0.9)) * 10) / 10,
      strokeIds: p.strokes.map((s) => s.id),
    };
    const connects = (p as { connects?: [ConnectorEnd, ConnectorEnd] }).connects;
    if (connects && (g.kind === 'line' || g.kind === 'arrow')) out.connects = connects;
    return out;
  });
  return { shapes, leftover: strokes.filter((s) => !used.has(s.id)).map((s) => s.id) };
}
