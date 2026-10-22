/**
 * Model-level operations of one open canvas, shared by the engine (pointer input) and the
 * React UI (menus, dialogs, other areas through the canvas API):
 *
 * - segment loading (R3): the current month always, plus months whose recorded bounds touch
 *   the view; segment bounds are recorded in the canvas index, debounced; when the date
 *   changes (midnight, or returning to the app) the new month is loaded at once (W1);
 * - adding objects creates the day's line when C19 says so, in the same undo step;
 * - deleting an image deletes the strokes drawn on it; deleting a beautified shape deletes
 *   the strokes it replaced;
 * - lookups for attached strokes, connected arrows and group members.
 */
import type { CanvasModel, CanvasTx, ObjectPatch } from '../../core/canvas/model';
import type { CanvasObject, Rect, ShapeObject, StrokeObject } from '../../core/model/types';
import type { Services } from '../../app/services';
import { objectBounds, rectsIntersect } from '../../core/canvas/bounds';
import { contentBottom, dayLineFor } from '../../core/canvas/daylines';
import type { ObjectLookup } from '../../core/canvas/transform';
import { objectsBounds } from '../../core/canvas/export';
import { debounce } from '../../core/util/emitter';
import { uid } from '../../core/util/ids';
import { isoDate, isoMonth } from '../../core/util/time';

export class CanvasController implements ObjectLookup {
  readonly model: CanvasModel;
  private disposers: (() => void)[] = [];
  private recordBounds: ReturnType<typeof debounce<[]>>;

  constructor(
    readonly services: Services,
    readonly slug: string,
    private now: () => number = Date.now,
  ) {
    this.model = services.canvases.model(slug);
    this.recordBounds = debounce(() => {
      void services.canvases.recordSegmentBounds(slug, this.model.segmentBounds());
    }, 1500);
    this.disposers.push(this.model.onChange.on((c) => (c.changed.size || c.removed.size ? this.recordBounds() : undefined)));
    this.watchDate();
  }

  /**
   * W1: the first stroke or text box of a new month needs that month's document. Load it as
   * the date changes (a timer at midnight, and on returning to the app, since timers stall
   * while a device sleeps). Writes made before it opens wait in the model, so this only keeps
   * that wait short.
   */
  private watchDate() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (!this.model.isLoaded(isoMonth(this.now()))) void this.loadForView(null).catch(() => {});
    };
    const arm = () => {
      clearTimeout(timer);
      const now = this.now();
      const d = new Date(now);
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      // at most an hour, so a clock or time-zone change is noticed too
      timer = setTimeout(() => {
        check();
        arm();
      }, Math.min(midnight - now + 500, 3_600_000));
    };
    const onShow = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      check();
      arm();
    };
    arm();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);
    if (typeof window !== 'undefined') window.addEventListener('focus', onShow);
    this.disposers.push(() => {
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onShow);
    });
  }

  get device(): string {
    return this.services.device;
  }

  dispose() {
    this.recordBounds.flush();
    for (const d of this.disposers) d();
  }

  /** Recorded bounds of every month of this canvas (from canvas.json). */
  recordedSegments(): Record<string, Rect | null> {
    return this.services.canvases.meta(this.slug)?.segments ?? {};
  }

  /** Loads the current month, and the months whose recorded bounds touch `view` (R3). */
  async loadForView(view: Rect | null): Promise<void> {
    const months = new Set<string>([isoMonth(this.now())]);
    if (view) for (const [m, b] of Object.entries(this.recordedSegments())) if (b && rectsIntersect(b, view)) months.add(m);
    const missing = [...months].filter((m) => !this.model.isLoaded(m));
    if (missing.length) await this.model.load(missing);
  }

  /** Loads every month of the canvas (date navigation, fit all). */
  async loadAll(): Promise<void> {
    const months = [...Object.keys(this.recordedSegments()), isoMonth(this.now())].filter((m) => !this.model.isLoaded(m));
    if (months.length) await this.model.load(months);
  }

  /** Bounds of all content, including months that are not loaded. */
  allContentBounds(): Rect | null {
    let r = this.model.contentBounds();
    const loaded = new Set(this.model.loadedMonths());
    for (const [m, b] of Object.entries(this.recordedSegments())) {
      if (!b || loaded.has(m)) continue;
      r = r ? union(r, b) : { ...b };
    }
    return r;
  }

  /** Bottom of all content (C19, C20). */
  contentBottom(): number | null {
    const loaded = new Set(this.model.loadedMonths());
    const recorded = Object.entries(this.recordedSegments())
      .filter(([m]) => !loaded.has(m))
      .map(([, b]) => b);
    return contentBottom(this.model.contentBounds(), recorded);
  }

  newId(): string {
    return uid();
  }

  /**
   * Adds objects as one undo step. When they are the first of today's objects below all
   * existing content, today's day line is created 24 units above them (C19). `extra` adds more
   * operations to the same step.
   */
  addObjects(objects: CanvasObject[], extra?: (tx: CanvasTx) => void): void {
    if (!objects.length) return;
    const date = isoDate(this.now());
    // only objects created today count (pasted and new objects are; restored pieces are not)
    const todays = objects.filter((o) => isoDate(o.created) === date);
    const top = todays.length ? Math.min(...todays.map((o) => objectBounds(o).y)) : 0;
    const lineY = todays.length ? dayLineFor(date, top, this.contentBottom(), this.model.dayLines()) : null;
    this.model.transact((tx) => {
      for (const o of objects) tx.add(o);
      if (lineY !== null) tx.setDay(date, lineY);
      extra?.(tx);
    });
  }

  update(patches: Map<string, ObjectPatch> | [string, ObjectPatch][]): void {
    const list = patches instanceof Map ? [...patches] : patches;
    if (!list.length) return;
    this.model.transact((tx) => {
      for (const [id, p] of list) tx.update(id, p);
    });
  }

  /** Ids removed along with `ids`: strokes on deleted images, strokes replaced by deleted shapes. */
  dependents(ids: Iterable<string>): string[] {
    const set = new Set(ids);
    const out = new Set(set);
    const images = new Set<string>();
    for (const id of set) {
      const o = this.model.get(id);
      if (o?.kind === 'image') images.add(id);
      if (o?.kind === 'shape') for (const s of o.originals) out.add(s);
    }
    if (images.size) for (const o of this.model.objects()) if (o.kind === 'stroke' && o.attached && images.has(o.attached)) out.add(o.id);
    return [...out];
  }

  remove(ids: Iterable<string>): void {
    const all = this.dependents(ids);
    if (!all.length) return;
    this.model.transact((tx) => {
      for (const id of all) tx.remove(id);
    });
  }

  get(id: string): CanvasObject | undefined {
    return this.model.get(id);
  }

  attachedTo(imageId: string): StrokeObject[] {
    const out: StrokeObject[] = [];
    for (const o of this.model.objects()) if (o.kind === 'stroke' && o.attached === imageId) out.push(o);
    return out;
  }

  connectedTo(shapeId: string): ShapeObject[] {
    const out: ShapeObject[] = [];
    for (const o of this.model.objects()) if (o.kind === 'shape' && o.connects && (o.connects[0] === shapeId || o.connects[1] === shapeId)) out.push(o);
    return out;
  }

  members(group: string): string[] {
    const out: string[] = [];
    for (const o of this.model.objects()) if (o.group === group) out.push(o.id);
    return out;
  }

  objectsOf(ids: Iterable<string>): CanvasObject[] {
    const out: CanvasObject[] = [];
    for (const id of ids) {
      const o = this.model.get(id);
      if (o) out.push(o);
    }
    return out;
  }

  boundsOf(ids: Iterable<string>): Rect | null {
    return objectsBounds(this.objectsOf(ids));
  }
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
