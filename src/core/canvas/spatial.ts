/**
 * Uniform-grid spatial index over object bounding boxes (C3). Cells are CELL canvas units
 * square; an object is registered in every cell its box touches. Queries visit only the
 * cells under the query rectangle, so cost scales with what is visible, not with the canvas.
 */
import type { Rect } from '../model/types';

export const CELL = 512;

const MAX_CELLS = 4096;

const key = (cx: number, cy: number) => `${cx},${cy}`;

function cellCount(r: Rect): number {
  return (Math.floor((r.x + r.w) / CELL) - Math.floor(r.x / CELL) + 1) * (Math.floor((r.y + r.h) / CELL) - Math.floor(r.y / CELL) + 1);
}

export class SpatialIndex {
  private cells = new Map<string, Set<string>>();
  private boxes = new Map<string, Rect>();
  /** objects covering too many cells to register individually; checked by every query */
  private large = new Set<string>();

  get size(): number {
    return this.boxes.size;
  }

  box(id: string): Rect | undefined {
    return this.boxes.get(id);
  }

  ids(): IterableIterator<string> {
    return this.boxes.keys();
  }

  set(id: string, r: Rect) {
    const prev = this.boxes.get(id);
    if (prev && prev.x === r.x && prev.y === r.y && prev.w === r.w && prev.h === r.h) return;
    if (prev) this.unlink(id, prev);
    this.boxes.set(id, r);
    if (cellCount(r) > MAX_CELLS) {
      this.large.add(id);
      return;
    }
    this.forCells(r, (k) => {
      let s = this.cells.get(k);
      if (!s) this.cells.set(k, (s = new Set()));
      s.add(id);
    });
  }

  delete(id: string) {
    const prev = this.boxes.get(id);
    if (!prev) return;
    this.unlink(id, prev);
    this.boxes.delete(id);
  }

  clear() {
    this.large.clear();
    this.cells.clear();
    this.boxes.clear();
  }

  /** Ids whose boxes intersect `r` (touching counts). */
  query(r: Rect): Set<string> {
    const out = new Set<string>();
    const hit = (b: Rect) => b.x <= r.x + r.w && r.x <= b.x + b.w && b.y <= r.y + r.h && r.y <= b.y + b.h;
    for (const id of this.large) if (hit(this.boxes.get(id)!)) out.add(id);
    if (cellCount(r) > MAX_CELLS) {
      for (const [id, b] of this.boxes) if (hit(b)) out.add(id);
      return out;
    }
    this.forCells(r, (k) => {
      const s = this.cells.get(k);
      if (!s) return;
      for (const id of s) {
        if (out.has(id)) continue;
        if (hit(this.boxes.get(id)!)) out.add(id);
      }
    });
    return out;
  }

  /** Bounding box of everything, or null when empty. */
  bounds(): Rect | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const b of this.boxes.values()) {
      if (b.x < x0) x0 = b.x;
      if (b.y < y0) y0 = b.y;
      if (b.x + b.w > x1) x1 = b.x + b.w;
      if (b.y + b.h > y1) y1 = b.y + b.h;
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private unlink(id: string, r: Rect) {
    if (this.large.delete(id)) return;
    this.forCells(r, (k) => {
      const s = this.cells.get(k);
      if (!s) return;
      s.delete(id);
      if (!s.size) this.cells.delete(k);
    });
  }

  private forCells(r: Rect, fn: (k: string) => void) {
    const cx0 = Math.floor(r.x / CELL);
    const cy0 = Math.floor(r.y / CELL);
    const cx1 = Math.floor((r.x + r.w) / CELL);
    const cy1 = Math.floor((r.y + r.h) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) fn(key(cx, cy));
  }
}
