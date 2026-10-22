/**
 * The list of canvases (`journal/<canvas>/canvas.json`) and their open models.
 *
 *   kv 'canvases'   CanvasMeta[]   (each with `segments`: month → bounds, R3/R9)
 *   doc seg:<slug>:<YYYY-MM>       one canvas segment (see core/canvas/segment.ts)
 */
import * as Y from 'yjs';
import { CanvasModel } from '../canvas/model';
import { objectsMap, readObject } from '../canvas/segment';
import type { CanvasMeta, ClipObject, Rect } from '../model/types';
import type { DocStore } from '../storage/docstore';
import type { SlateDB } from '../storage/idb';
import { uid } from '../util/ids';
import { SharedKv } from './sharedKv';
import { parseSegmentDocId, segmentDocId } from './docIds';

export const DEFAULT_CANVAS = 'main';

export interface ClipRef {
  canvas: string;
  month: string;
  clip: ClipObject;
}

export class CanvasStore {
  private kv!: SharedKv<CanvasMeta[]>;
  private models = new Map<string, CanvasModel>();
  private fetchRemote: ((docId: string) => Promise<unknown>) | null = null;

  private constructor(
    private docs: DocStore,
    private device: string,
  ) {}

  /**
   * The list is shared with other tabs (sharedKv.ts): every change re-reads it before writing.
   */
  static async open(db: SlateDB, docs: DocStore, device: string): Promise<CanvasStore> {
    const s = new CanvasStore(docs, device);
    s.kv = await SharedKv.open<CanvasMeta[]>(db, 'canvases', (raw) => raw ?? []);
    if (!s.metas.some((m) => m.slug === DEFAULT_CANVAS)) {
      const main: CanvasMeta = { id: DEFAULT_CANVAS, slug: DEFAULT_CANVAS, title: 'Main', topics: [], segments: {} };
      await s.kv.mutate((list) => (list.some((m) => m.slug === DEFAULT_CANVAS) ? list : [...list, main]));
    }
    return s;
  }

  /** Fires on every change, here or saved by another tab. */
  get onChange() {
    return this.kv.onChange;
  }

  private get metas(): CanvasMeta[] {
    return this.kv.get();
  }

  list(): CanvasMeta[] {
    return this.metas;
  }

  meta(slug: string): CanvasMeta | undefined {
    return this.metas.find((m) => m.slug === slug);
  }

  async create(title: string, slug: string): Promise<CanvasMeta> {
    if (this.meta(slug)) throw new Error(`A canvas named ${slug} exists.`);
    const meta: CanvasMeta = { id: uid(), slug, title, topics: [], segments: {} };
    await this.kv.mutate((list) => (list.some((m) => m.slug === slug) ? list : [...list, meta]));
    return this.meta(slug) ?? meta;
  }

  /** Updates a canvas's metadata (title, topics, segment bounds). */
  async update(slug: string, patch: Partial<Omit<CanvasMeta, 'slug'>>): Promise<void> {
    await this.kv.mutate((list) => list.map((m) => (m.slug === slug ? { ...m, ...patch } : m)));
  }

  /**
   * Applies sync's merge to the list as it is now (not to a copy taken before downloading, which
   * would drop canvases created or edited meanwhile). `merge` returns the new list, or null when
   * nothing changed.
   */
  async mergeFromRemote(merge: (current: readonly CanvasMeta[]) => CanvasMeta[] | null): Promise<void> {
    if (!merge(this.metas)) return;
    await this.kv.mutate((list) => merge(list) ?? list);
  }

  /** Months known to have content (from the index) plus loaded ones. */
  months(slug: string): string[] {
    return Object.keys(this.meta(slug)?.segments ?? {}).sort();
  }

  /** The live model of a canvas (one per canvas per app). */
  model(slug: string): CanvasModel {
    let m = this.models.get(slug);
    if (!m) {
      m = new CanvasModel(slug, { open: (month) => this.openSegment(slug, month) }, this.device);
      this.models.set(slug, m);
    }
    return m;
  }

  /**
   * R9: lets sync download a segment from the repository before it is opened, when this device
   * does not have it yet (set by the sync engine; it bounds how long it waits).
   */
  setRemoteFetcher(fn: ((docId: string) => Promise<unknown>) | null) {
    this.fetchRemote = fn;
  }

  /**
   * R9 without blocking offline use: a month this device has opens at once and the remote
   * version merges into it when it arrives; only a month with nothing local waits (bounded by
   * the fetcher) for its download.
   */
  private async openSegment(slug: string, month: string) {
    const id = segmentDocId(slug, month);
    if (this.fetchRemote) {
      const fetching = this.fetchRemote(id).catch(() => undefined);
      if (!(await this.docs.has(id))) await fetching;
    }
    const doc = await this.docs.open(id);
    this.docs.retain(id);
    return doc;
  }

  /**
   * R9 for views that read every segment without opening the canvases (S7 margin marks, the
   * To-dos page's canvas to-dos): asks sync for each month listed in the canvas index. Months
   * already merged cost nothing; the rest download in the background (a few at a time) and
   * announce themselves through `DocStore.onDocChanged`.
   */
  async fetchAllSegments(): Promise<void> {
    const fetch = this.fetchRemote;
    if (!fetch) return;
    const ids = this.metas.flatMap((m) => Object.keys(m.segments ?? {}).map((month) => segmentDocId(m.slug, month)));
    let next = 0;
    const worker = async () => {
      while (next < ids.length) await fetch(ids[next++]).catch(() => undefined);
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  /** Records the bounds of loaded segments in the canvas index. */
  async recordSegmentBounds(slug: string, bounds: Record<string, Rect | null>): Promise<void> {
    const meta = this.meta(slug);
    if (!meta) return;
    const segments = { ...(meta.segments ?? {}), ...bounds };
    if (JSON.stringify(segments) === JSON.stringify(meta.segments ?? {})) return;
    // merged into the stored months, not this tab's copy of them
    await this.kv.mutate((list) => list.map((m) => (m.slug === slug ? { ...m, segments: { ...(m.segments ?? {}), ...bounds } } : m)));
  }

  /**
   * Every clip, on any canvas and in any stored segment, whose source is `sourceId` (L13, S7).
   * Reads segment documents without opening canvases.
   */
  async findClipsOf(sourceId: string): Promise<ClipRef[]> {
    const out: ClipRef[] = [];
    for (const docId of await this.docs.listDocIds()) {
      const seg = parseSegmentDocId(docId);
      if (!seg) continue;
      const doc = this.docs.getLoaded(docId) ?? (await stateDoc(this.docs, docId));
      if (!doc) continue;
      for (const m of objectsMap(doc).values()) {
        const o = m instanceof Y.Map ? readObject(m) : null;
        if (o?.kind === 'clip' && o.source.id === sourceId) out.push({ canvas: seg.slug, month: seg.month, clip: o });
      }
    }
    return out;
  }

}

async function stateDoc(docs: DocStore, docId: string): Promise<Y.Doc | null> {
  const state = await docs.getState(docId);
  if (!state) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}
