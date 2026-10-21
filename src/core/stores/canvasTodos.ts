/**
 * To-dos from the canvas (G4): every unchecked `- [ ]` line in canvas text boxes, across all
 * canvases, grouped by day (the text box's creation date), newest first. Read from loaded
 * segment documents (open canvases) and from stored segments without loading them, like
 * `CanvasStore.findClipsOf`. Checking one writes through the canvas model, so the text box on
 * the canvas changes (one undo step there) and the edit syncs like any other.
 */
import * as Y from 'yjs';
import { objectsMap, readObject } from '../canvas/segment';
import { extractTasks, setTask } from '../markdown/tasks';
import type { DocStore } from '../storage/docstore';
import { Emitter } from '../util/emitter';
import { isoDate } from '../util/time';
import type { CanvasStore } from './canvases';
import { parseSegmentDocId } from './docIds';

export interface CanvasTodo {
  canvas: string;
  month: string;
  /** text box id */
  object: string;
  /** index of the task within the text box (see markdown/tasks.ts) */
  task: number;
  text: string;
  /** creation time of the text box */
  created: number;
  /** device-local date of `created` */
  date: string;
  x: number;
  y: number;
}

export interface TodoDay {
  date: string;
  todos: CanvasTodo[];
}

/** Unchecked tasks in the text boxes of one segment document. */
export function todosOfSegment(canvas: string, month: string, doc: Y.Doc): CanvasTodo[] {
  const out: CanvasTodo[] = [];
  for (const m of objectsMap(doc).values()) {
    const o = m instanceof Y.Map ? readObject(m) : null;
    if (o?.kind !== 'text') continue;
    for (const t of extractTasks(o.content)) {
      if (!t.checked) out.push({ canvas, month, object: o.id, task: t.index, text: t.text, created: o.created, date: isoDate(o.created), x: o.x, y: o.y });
    }
  }
  return out;
}

/** Groups to-dos by day, newest day first; within a day in reading order (top to bottom, left to right). */
export function groupByDay(todos: CanvasTodo[]): TodoDay[] {
  const days = new Map<string, CanvasTodo[]>();
  for (const t of todos) {
    let list = days.get(t.date);
    if (!list) days.set(t.date, (list = []));
    list.push(t);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({
      date,
      todos: list.sort((a, b) => a.canvas.localeCompare(b.canvas) || a.y - b.y || a.x - b.x || a.object.localeCompare(b.object) || a.task - b.task),
    }));
}

/** Checks or unchecks a canvas to-do in its text box, through the canvas model. Returns false when it is gone. */
export async function setCanvasTodo(store: CanvasStore, todo: CanvasTodo, checked: boolean): Promise<boolean> {
  const model = store.model(todo.canvas);
  await model.load([todo.month]);
  const obj = model.get(todo.object);
  if (obj?.kind !== 'text') return false;
  const tasks = extractTasks(obj.content);
  // the text may have changed since the list was read: prefer the same index with the same text
  let task = tasks[todo.task];
  if (!task || task.text !== todo.text) task = tasks.find((t) => t.text === todo.text && t.checked !== checked) ?? task;
  if (!task || task.checked === checked) return !!task;
  model.transact((tx) => tx.update(todo.object, { content: setTask(obj.content, task.index, checked) }));
  return true;
}

/**
 * Live list of canvas to-dos. Re-reads only the segments that changed (debounced), and every
 * segment when the canvas list changes.
 */
export class CanvasTodoIndex {
  readonly onChange = new Emitter<void>();
  private bySeg = new Map<string, CanvasTodo[]>();
  private dirty = new Set<string>();
  private full = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private offs: (() => void)[] = [];
  private slugs: string;

  constructor(
    store: CanvasStore,
    private docs: DocStore,
    private delay = 150,
  ) {
    this.slugs = slugsOf(store);
    this.offs.push(
      docs.onDocChanged.on(({ docId }) => {
        if (!parseSegmentDocId(docId)) return;
        this.dirty.add(docId);
        this.schedule();
      }),
      // the list also changes when segment bounds are recorded: re-read everything only
      // when canvases come or go (new segments arrive through onDocChanged anyway)
      store.onChange.on(() => {
        const slugs = slugsOf(store);
        if (slugs === this.slugs) return;
        this.slugs = slugs;
        this.full = true;
        this.schedule();
      }),
    );
  }

  dispose() {
    for (const off of this.offs) off();
    clearTimeout(this.timer);
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), this.delay);
  }

  /** Re-reads changed segments (all of them on the first call). */
  refresh(): Promise<void> {
    if (this.running) return this.running.then(() => this.refresh());
    this.running = (async () => {
      const ids = this.full ? (await this.docs.listDocIds()).filter((id) => parseSegmentDocId(id)) : [...this.dirty];
      if (this.full) this.bySeg.clear();
      this.full = false;
      this.dirty.clear();
      for (const id of ids) {
        const seg = parseSegmentDocId(id)!;
        const doc = this.docs.getLoaded(id) ?? (await stateDoc(this.docs, id));
        this.bySeg.set(id, doc ? todosOfSegment(seg.slug, seg.month, doc) : []);
      }
      this.onChange.emit();
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  all(): CanvasTodo[] {
    return [...this.bySeg.values()].flat();
  }

  days(): TodoDay[] {
    return groupByDay(this.all());
  }
}

const slugsOf = (store: CanvasStore) =>
  store
    .list()
    .map((m) => m.slug)
    .sort()
    .join('\n');

async function stateDoc(docs: DocStore, docId: string): Promise<Y.Doc | null> {
  const state = await docs.getState(docId);
  if (!state) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}
