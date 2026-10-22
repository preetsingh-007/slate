/**
 * A canvas as one continuous surface over its monthly segment documents (R3).
 *
 * - Objects, marks and day lines are read from every loaded segment into flat caches and a
 *   spatial index, kept current by observing the documents (local, undo and remote changes).
 * - All writes go through `transact`, which routes each operation to the segment that owns
 *   it (an object's creation month) and records one undo step for the whole action, even
 *   when it touches several segments (C17).
 * - W1: a write to a month that is not loaded yet (the first stroke after midnight on the 1st,
 *   before the new month's document has opened) is never dropped: its operations wait for the
 *   month to load and are applied then, as part of the same undo step. Until then they show
 *   in the caches (objects, marks, day lines), so the surface looks the same either way.
 */
import * as Y from 'yjs';
import type { CanvasObject, Mark, Rect } from '../model/types';
import { Emitter } from '../util/emitter';
import { isoMonth } from '../util/time';
import { compareZ, keyAfter, keyBefore } from '../util/zindex';
import { objectBounds, unionRect } from './bounds';
import {
  LAYOUT,
  LOCAL,
  createMarkMap,
  createObjectMap,
  dayLines,
  dayTopicsMap,
  daysMap,
  marksMap,
  normalizeDays,
  objectsMap,
  patchObjectMap,
  readMark,
  readObject,
} from './segment';
import { SpatialIndex } from './spatial';

export interface SegmentSource {
  /** Loads (or creates empty) the document of a month. */
  open(month: string): Promise<Y.Doc>;
}

export interface CanvasChange {
  /** objects added or changed */
  changed: Set<string>;
  removed: Set<string>;
  marks: boolean;
  days: boolean;
  /** true when the change came from sync, not from this device */
  remote: boolean;
}

/** Patch of plain fields. `content` replaces a text box's text with a minimal edit. */
export type ObjectPatch = Partial<Omit<CanvasObject, 'id' | 'kind'>> & Record<string, unknown>;

export interface CanvasTx {
  add(obj: CanvasObject): void;
  update(id: string, patch: ObjectPatch): void;
  remove(id: string): void;
  setMark(mark: Mark): void;
  removeMark(id: string): void;
  /** Creates the day line for `date` at `y` (C19). */
  setDay(date: string, y: number): void;
  removeDay(date: string): void;
  setDayTopics(date: string, topics: string[]): void;
}

export interface TransactOptions {
  /** record an undo step (default true) */
  undoable?: boolean;
  /** set `edited` on updated objects (default true) */
  touch?: boolean;
}

type Op =
  | { t: 'add'; obj: CanvasObject }
  | { t: 'update'; id: string; patch: ObjectPatch }
  | { t: 'remove'; id: string }
  | { t: 'mark'; mark: Mark }
  | { t: 'unmark'; id: string }
  | { t: 'day'; date: string; y: number }
  | { t: 'unday'; date: string }
  | { t: 'dayTopics'; date: string; topics: string[] };

interface Segment {
  month: string;
  doc: Y.Doc;
  undo: Y.UndoManager;
  dispose: () => void;
}

/** W1: the operations of one action on a month that was not loaded when it was made. */
interface Queued {
  month: string;
  ops: Op[];
  touch: boolean;
  t: number;
  undoable: boolean;
  /** the undo step this belongs to (its month is added when the operations are applied) */
  entry: string[] | null;
  state: 'queued' | 'cancelled' | 'applied';
}

export class CanvasModel {
  readonly onChange = new Emitter<CanvasChange>();
  readonly index = new SpatialIndex();
  private segs = new Map<string, Segment>();
  private loading = new Map<string, Promise<void>>();
  private objs = new Map<string, CanvasObject>();
  private where = new Map<string, string>();
  private markCache = new Map<string, { mark: Mark; month: string }>();
  private undoStack: string[][] = [];
  private redoStack: string[][] = [];
  private inAction = false;
  private replaying = false;
  private zMax: string | null = null;
  private zMin: string | null = null;
  /** W1: actions waiting for their month to load, in order, per month */
  private queued = new Map<string, Queued[]>();
  /** W1: undo steps with parts waiting for a month to load */
  private entryQueued = new WeakMap<string[], Queued[]>();
  /** W1: day lines (y, or null when removed) and day topics of queued actions */
  private queuedDays = new Map<string, number | null>();
  private queuedDayTopics = new Map<string, string[]>();

  constructor(
    readonly slug: string,
    private source: SegmentSource,
    readonly device: string,
    private now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- segments

  async load(months: Iterable<string>): Promise<void> {
    await Promise.all([...months].map((m) => this.loadOne(m)));
  }

  isLoaded(month: string): boolean {
    return this.segs.has(month);
  }

  loadedMonths(): string[] {
    return [...this.segs.keys()].sort();
  }

  segmentDoc(month: string): Y.Doc | undefined {
    return this.segs.get(month)?.doc;
  }

  private loadOne(month: string): Promise<void> {
    if (this.segs.has(month)) return Promise.resolve();
    let p = this.loading.get(month);
    if (!p) {
      p = this.source.open(month).then((doc) => this.attach(month, doc));
      this.loading.set(month, p);
      p.finally(() => this.loading.delete(month));
    }
    return p;
  }

  /** W1: loads a month that queued actions wait for, retrying until it opens. */
  private loadForQueue(month: string) {
    this.loadOne(month).catch(() => {
      setTimeout(() => {
        if (this.queued.has(month) && !this.segs.has(month)) this.loadForQueue(month);
      }, 1000);
    });
  }

  /** W1: whether actions are waiting for a month to load. */
  hasQueued(): boolean {
    return this.queued.size > 0;
  }

  private attach(month: string, doc: Y.Doc) {
    if (this.segs.has(month)) return;
    const objects = objectsMap(doc);
    const marks = marksMap(doc);
    const days = daysMap(doc);
    const dayTopics = dayTopicsMap(doc);
    const undo = new Y.UndoManager([objects, marks, days, dayTopics], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 500,
    });
    // a text edit made outside `transact` (typing in a text box) is its own undo step
    undo.on('stack-item-added', (e: { type: 'undo' | 'redo' }) => {
      if (e.type !== 'undo' || this.inAction || this.replaying) return;
      this.undoStack.push([month]);
      this.redoStack = [];
    });

    const onObjects = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
      const ids = new Set<string>();
      for (const ev of events) {
        if (ev.target === objects) for (const k of (ev as Y.YMapEvent<unknown>).keysChanged) ids.add(k);
        else if (ev.path.length) ids.add(String(ev.path[0]));
      }
      const change = this.emptyChange(tr);
      for (const id of ids) this.refreshObject(month, objects, id, change);
      this.emit(change);
    };
    const onMarks = (_e: unknown, tr: Y.Transaction) => {
      this.refreshMarks(month, marks);
      const change = this.emptyChange(tr);
      change.marks = true;
      this.emit(change);
    };
    const onDays = (_e: unknown, tr: Y.Transaction) => {
      const change = this.emptyChange(tr);
      change.days = true;
      // a remote merge may leave two lines for one date: keep the lower one (C19)
      if (change.remote) queueMicrotask(() => normalizeDays(doc));
      this.emit(change);
    };
    objects.observeDeep(onObjects);
    marks.observeDeep(onMarks);
    days.observe(onDays);
    dayTopics.observe(onDays);

    const seg: Segment = {
      month,
      doc,
      undo,
      dispose: () => {
        objects.unobserveDeep(onObjects);
        marks.unobserveDeep(onMarks);
        days.unobserve(onDays);
        dayTopics.unobserve(onDays);
        undo.destroy();
      },
    };
    this.segs.set(month, seg);

    const change: CanvasChange = { changed: new Set(), removed: new Set(), marks: true, days: true, remote: true };
    for (const id of objects.keys()) this.refreshObject(month, objects, id, change);
    this.refreshMarks(month, marks);
    normalizeDays(doc);
    this.emit(change);
    this.applyQueued(seg);
  }

  /** W1: applies the actions that waited for this month, each as part of its own undo step. */
  private applyQueued(seg: Segment) {
    const list = this.queued.get(seg.month);
    if (!list) return;
    this.queued.delete(seg.month);
    for (const date of [...this.queuedDays.keys()]) if (date.startsWith(seg.month)) this.queuedDays.delete(date);
    for (const date of [...this.queuedDayTopics.keys()]) if (date.startsWith(seg.month)) this.queuedDayTopics.delete(date);
    for (const q of list) if (q.state === 'queued') this.applyBatch(seg, q);
  }

  private applyBatch(seg: Segment, q: Queued) {
    this.inAction = true;
    try {
      const before = seg.undo.undoStack.length;
      if (q.undoable) seg.undo.stopCapturing();
      seg.doc.transact(() => this.apply(seg.doc, q.ops, q.touch, q.t), q.undoable ? LOCAL : LAYOUT);
      if (q.undoable) {
        seg.undo.stopCapturing();
        if (seg.undo.undoStack.length > before && q.entry && !q.entry.includes(seg.month)) q.entry.push(seg.month);
      }
      q.state = 'applied';
    } finally {
      this.inAction = false;
    }
  }

  /**
   * W1: shows queued actions of a month that is not loaded in the caches. Every cached object
   * and mark of such a month comes from its queue, so this rebuilds them from scratch.
   */
  private showQueued(month: string, change: CanvasChange) {
    for (const [id, m] of this.where) {
      if (m !== month) continue;
      this.objs.delete(id);
      this.where.delete(id);
      this.index.delete(id);
      change.removed.add(id);
    }
    for (const [id, v] of this.markCache) if (v.month === month) this.markCache.delete(id);
    for (const date of [...this.queuedDays.keys()]) if (date.startsWith(month)) this.queuedDays.delete(date);
    for (const date of [...this.queuedDayTopics.keys()]) if (date.startsWith(month)) this.queuedDayTopics.delete(date);
    change.marks = true;
    change.days = true;
    for (const q of this.queued.get(month) ?? []) {
      if (q.state !== 'queued') continue;
      for (const op of q.ops) {
        switch (op.t) {
          case 'add':
            this.cacheObject(month, op.obj, change);
            break;
          case 'update': {
            const o = this.objs.get(op.id);
            if (!o || this.where.get(op.id) !== month) break;
            const next = { ...o } as Record<string, unknown>;
            for (const [k, v] of Object.entries(op.patch)) {
              if (k === 'id' || k === 'kind') continue;
              if (v === undefined) delete next[k];
              else next[k] = v;
            }
            if (q.touch && op.patch.edited === undefined) next.edited = q.t;
            this.cacheObject(month, next as unknown as CanvasObject, change);
            break;
          }
          case 'remove':
            if (this.where.get(op.id) !== month) break;
            this.objs.delete(op.id);
            this.where.delete(op.id);
            this.index.delete(op.id);
            change.changed.delete(op.id);
            change.removed.add(op.id);
            break;
          case 'mark':
            this.markCache.set(op.mark.id, { mark: op.mark, month });
            break;
          case 'unmark':
            this.markCache.delete(op.id);
            break;
          case 'day':
            this.queuedDays.set(op.date, op.y);
            break;
          case 'unday':
            this.queuedDays.set(op.date, null);
            break;
          case 'dayTopics':
            this.queuedDayTopics.set(op.date, op.topics);
            break;
        }
      }
    }
    for (const id of change.changed) change.removed.delete(id);
  }

  private cacheObject(month: string, obj: CanvasObject, change: CanvasChange) {
    this.objs.set(obj.id, obj);
    this.where.set(obj.id, month);
    this.index.set(obj.id, objectBounds(obj));
    if (this.zMax === null || obj.z > this.zMax) this.zMax = obj.z;
    if (this.zMin === null || obj.z < this.zMin) this.zMin = obj.z;
    change.changed.add(obj.id);
  }

  /** Detaches every segment (the documents themselves are owned by the store). */
  dispose() {
    for (const s of this.segs.values()) s.dispose();
    this.segs.clear();
  }

  private emptyChange(tr: Y.Transaction): CanvasChange {
    const o = tr.origin;
    const local = o === LOCAL || o === LAYOUT || o instanceof Y.UndoManager;
    return { changed: new Set(), removed: new Set(), marks: false, days: false, remote: !local };
  }

  private emit(change: CanvasChange) {
    if (change.changed.size || change.removed.size || change.marks || change.days) this.onChange.emit(change);
  }

  private refreshObject(month: string, objects: Y.Map<Y.Map<unknown>>, id: string, change: CanvasChange) {
    const m = objects.get(id);
    const obj = m instanceof Y.Map ? readObject(m) : null;
    if (!obj) {
      if (this.where.get(id) === month) {
        this.objs.delete(id);
        this.where.delete(id);
        this.index.delete(id);
        change.removed.add(id);
      }
      return;
    }
    this.cacheObject(month, obj, change);
  }

  private refreshMarks(month: string, marks: Y.Map<Y.Map<unknown>>) {
    for (const [id, v] of this.markCache) if (v.month === month && !marks.has(id)) this.markCache.delete(id);
    for (const [id, m] of marks.entries()) {
      const mark = m instanceof Y.Map ? readMark(m) : null;
      if (mark) this.markCache.set(id, { mark, month });
    }
  }

  // ---------------------------------------------------------------- reading

  get(id: string): CanvasObject | undefined {
    return this.objs.get(id);
  }

  has(id: string): boolean {
    return this.objs.has(id);
  }

  monthOf(id: string): string | undefined {
    return this.where.get(id);
  }

  objects(): IterableIterator<CanvasObject> {
    return this.objs.values();
  }

  get count(): number {
    return this.objs.size;
  }

  /** Objects whose bounds intersect `r`, in z order (bottom first). */
  query(r: Rect): CanvasObject[] {
    const out: CanvasObject[] = [];
    for (const id of this.index.query(r)) out.push(this.objs.get(id)!);
    return out.sort(compareZ);
  }

  /** The live Y.Text of a text box, for editors. */
  textOf(id: string): Y.Text | null {
    const month = this.where.get(id);
    const seg = month ? this.segs.get(month) : undefined;
    const t = seg ? objectsMap(seg.doc).get(id)?.get('content') : undefined;
    return t instanceof Y.Text ? t : null;
  }

  marks(): Mark[] {
    return [...this.markCache.values()].map((v) => v.mark).sort((a, b) => a.created - b.created);
  }

  mark(id: string): Mark | undefined {
    return this.markCache.get(id)?.mark;
  }

  /** Day lines over all loaded segments: date → y. */
  dayLines(): Map<string, number> {
    const out = new Map<string, number>();
    for (const s of this.segs.values()) for (const [d, y] of dayLines(s.doc)) if (!out.has(d) || y > out.get(d)!) out.set(d, y);
    for (const [d, y] of this.queuedDays) {
      if (y === null) out.delete(d);
      else out.set(d, y);
    }
    return out;
  }

  dayTopics(date: string): string[] {
    const queued = this.queuedDayTopics.get(date);
    if (queued) return queued;
    const seg = this.segs.get(date.slice(0, 7));
    return (seg && dayTopicsMap(seg.doc).get(date)) || [];
  }

  /** Bounds of all loaded content (objects only), or null when empty. */
  contentBounds(): Rect | null {
    return this.index.bounds();
  }

  /** Bounds of each loaded month's objects, for the canvas index in canvas.json. */
  segmentBounds(): Record<string, Rect | null> {
    const out: Record<string, Rect | null> = {};
    for (const m of this.segs.keys()) out[m] = null;
    for (const [id, m] of this.where) out[m] = unionRect(out[m] ?? null, this.index.box(id)!);
    return out;
  }

  /** A z key above every object. */
  topZ(): string {
    return keyAfter(this.zMax);
  }

  /** A z key below every object. */
  bottomZ(): string {
    return keyBefore(this.zMin);
  }

  // ---------------------------------------------------------------- writing

  transact(fn: (tx: CanvasTx) => void, opts: TransactOptions = {}): void {
    const ops: Op[] = [];
    const tx: CanvasTx = {
      add: (obj) => ops.push({ t: 'add', obj }),
      update: (id, patch) => ops.push({ t: 'update', id, patch }),
      remove: (id) => ops.push({ t: 'remove', id }),
      setMark: (mark) => ops.push({ t: 'mark', mark }),
      removeMark: (id) => ops.push({ t: 'unmark', id }),
      setDay: (date, y) => ops.push({ t: 'day', date, y }),
      removeDay: (date) => ops.push({ t: 'unday', date }),
      setDayTopics: (date, topics) => ops.push({ t: 'dayTopics', date, topics }),
    };
    fn(tx);
    if (!ops.length) return;

    const byMonth = new Map<string, Op[]>();
    const route = (month: string | undefined, op: Op) => {
      if (!month) return;
      let list = byMonth.get(month);
      if (!list) byMonth.set(month, (list = []));
      list.push(op);
    };
    for (const op of ops) {
      switch (op.t) {
        case 'add':
          route(isoMonth(op.obj.created), op);
          break;
        case 'update':
        case 'remove':
          route(this.where.get(op.id), op);
          break;
        case 'mark':
          route(this.markCache.get(op.mark.id)?.month ?? isoMonth(op.mark.created), op);
          break;
        case 'unmark':
          route(this.markCache.get(op.id)?.month, op);
          break;
        default:
          route(op.date.slice(0, 7), op);
      }
    }

    const undoable = opts.undoable !== false;
    const touch = opts.touch !== false;
    const t = this.now();
    const origin = undoable ? LOCAL : LAYOUT;
    const touched: string[] = [];
    // W1: a month that is not loaded (or still has actions waiting) gets this action's
    // operations queued behind them, never dropped
    const waiting: Queued[] = [];
    for (const [month, list] of byMonth) {
      if (this.segs.has(month) && !this.queued.has(month)) continue;
      const q: Queued = { month, ops: list, touch, t, undoable, entry: null, state: 'queued' };
      waiting.push(q);
      byMonth.delete(month);
      const queue = this.queued.get(month);
      if (queue) queue.push(q);
      else this.queued.set(month, [q]);
    }
    this.inAction = true;
    try {
      for (const [month, list] of byMonth) {
        const seg = this.segs.get(month)!;
        const before = seg.undo.undoStack.length;
        if (undoable) seg.undo.stopCapturing();
        seg.doc.transact(() => this.apply(seg.doc, list, touch, t), origin);
        if (undoable) {
          seg.undo.stopCapturing();
          if (seg.undo.undoStack.length > before) touched.push(month);
        }
      }
    } finally {
      this.inAction = false;
    }
    if (touched.length || (undoable && waiting.length)) {
      this.undoStack.push(touched);
      this.redoStack = [];
      if (waiting.length) {
        this.entryQueued.set(touched, waiting);
        for (const q of waiting) q.entry = touched;
      }
    }
    if (waiting.length) this.queueChanged(new Set(waiting.map((q) => q.month)));
  }

  /** W1: shows the queues of `months` and makes sure those months load. */
  private queueChanged(months: Set<string>) {
    const change: CanvasChange = { changed: new Set(), removed: new Set(), marks: false, days: false, remote: false };
    for (const month of months) {
      if (this.segs.has(month)) {
        // loaded meanwhile (a redo after the month opened): apply now
        const list = this.queued.get(month) ?? [];
        this.queued.delete(month);
        for (const q of list) if (q.state === 'queued') this.applyBatch(this.segs.get(month)!, q);
        continue;
      }
      this.showQueued(month, change);
      if (!this.queued.get(month)?.length) this.queued.delete(month);
      else this.loadForQueue(month);
    }
    this.emit(change);
  }

  private apply(doc: Y.Doc, ops: Op[], touch: boolean, t: number) {
    const objects = objectsMap(doc);
    const marks = marksMap(doc);
    for (const op of ops) {
      switch (op.t) {
        case 'add':
          objects.set(op.obj.id, createObjectMap(op.obj));
          break;
        case 'update': {
          const m = objects.get(op.id);
          if (!m) break;
          patchObjectMap(m, touch && op.patch.edited === undefined ? { ...op.patch, edited: t } : op.patch);
          break;
        }
        case 'remove':
          objects.delete(op.id);
          break;
        case 'mark':
          marks.set(op.mark.id, createMarkMap(op.mark));
          break;
        case 'unmark':
          marks.delete(op.id);
          break;
        case 'day': {
          const days = daysMap(doc);
          for (const k of [...days.keys()]) if (k.split('@')[0] === op.date) days.delete(k);
          days.set(`${op.date}@${this.device}`, op.y);
          break;
        }
        case 'unday': {
          const days = daysMap(doc);
          for (const k of [...days.keys()]) if (k.split('@')[0] === op.date) days.delete(k);
          break;
        }
        case 'dayTopics':
          dayTopicsMap(doc).set(op.date, op.topics);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- undo

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    return this.replay(this.undoStack, this.redoStack, (um) => um.undo());
  }

  redo(): boolean {
    return this.replay(this.redoStack, this.undoStack, (um) => um.redo());
  }

  private replay(from: string[][], to: string[][], step: (um: Y.UndoManager) => unknown): boolean {
    const months = from.pop();
    if (!months) return false;
    this.replaying = true;
    try {
      for (const m of months) {
        const seg = this.segs.get(m);
        if (seg) step(seg.undo);
      }
    } finally {
      this.replaying = false;
    }
    to.push(months);
    // W1: parts still waiting for their month are withdrawn on undo and queued again on redo
    const waiting = this.entryQueued.get(months)?.filter((q) => q.state !== 'applied');
    if (waiting?.length) {
      const undoing = from === this.undoStack;
      for (const q of waiting) {
        q.state = undoing ? 'cancelled' : 'queued';
        const queue = (this.queued.get(q.month) ?? []).filter((x) => x !== q);
        if (!undoing) queue.push(q);
        this.queued.set(q.month, queue);
      }
      this.queueChanged(new Set(waiting.map((q) => q.month)));
    }
    return true;
  }
}
