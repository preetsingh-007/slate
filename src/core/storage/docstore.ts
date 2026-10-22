import * as Y from 'yjs';
import { SlateDB } from './idb';
import { Emitter } from '../util/emitter';
import { LRU } from '../util/lru';
import { tabChannel } from './tabChannel';

/** Origin attached to transactions that come from a sync transport. */
export interface RemoteOrigin {
  transport: string;
}

export const LOCAL_ORIGIN = 'local';
const LOAD_ORIGIN = Symbol('persistence-load');
/** Origin of updates saved by another tab of the app (R1), already in IndexedDB. */
export const TAB_TRANSPORT = 'tab';
const TAB_ORIGIN: RemoteOrigin = { transport: TAB_TRANSPORT };

export interface DocUpdateEvent {
  docId: string;
  update: Uint8Array;
  /** name of the transport the update came from; undefined for local edits */
  from?: string;
}

const COMPACT_THRESHOLD = 128;
const FLUSH_MS = 60;

interface Loaded {
  doc: Y.Doc;
  refs: number;
}

/**
 * Owns every Y.Doc of the app (canvas segments, annotations, to-dos).
 *  - lazily loads docs from the IndexedDB update log and keeps a bounded LRU of open docs;
 *  - persists every update (batched), compacting logs as they grow;
 *  - can answer sync requests for docs that are NOT loaded, operating directly on binary
 *    updates (Y.mergeUpdates / Y.diffUpdate), so syncing many documents stays cheap.
 */
export class DocStore {
  readonly onUpdate = new Emitter<DocUpdateEvent>();
  /** fires (debounced per doc by consumers) whenever doc content changed, from any origin */
  readonly onDocChanged = new Emitter<{ docId: string; remote: boolean }>();
  /** persistence failures (e.g. storage quota exceeded); updates are kept and retried */
  readonly onError = new Emitter<Error>();
  private retryDelay = 0;

  private loaded: LRU<string, Loaded>;
  private loading = new Map<string, Promise<Y.Doc>>();
  private pending = new Map<string, Uint8Array[]>();
  /** batches handed to IndexedDB but not yet committed (a concurrent load must still see them) */
  private inflight = new Map<string, Uint8Array[][]>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private writeChain: Promise<unknown> = Promise.resolve();
  private knownIds: Set<string> | null = null;
  private appendCounts = new Map<string, number>();
  /** R1: updates saved by another tab reach this tab's open documents and change tracking */
  private channel: BroadcastChannel | null;
  /** callers of `whenSaved`, per document */
  private saveWaiters = new Map<string, (() => void)[]>();

  constructor(
    readonly db: SlateDB,
    capacity = 64,
  ) {
    this.loaded = new LRU(capacity, (_id, entry) => {
      if (entry.refs > 0) return false; // pinned by a view
      entry.doc.destroy();
      return true;
    });
    this.channel = tabChannel(db, 'docs');
    this.channel?.addEventListener('message', (e: MessageEvent<{ docId: string; update: Uint8Array }>) => this.fromTab(e.data.docId, e.data.update));
    if (typeof window !== 'undefined') {
      const flush = () => void this.flushNow();
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    }
  }

  private fromTab(docId: string, update: Uint8Array) {
    this.knownIds?.add(docId);
    const live = this.loaded.get(docId)?.doc;
    if (live) Y.applyUpdate(live, update, TAB_ORIGIN);
    else {
      this.onUpdate.emit({ docId, update, from: TAB_TRANSPORT });
      this.onDocChanged.emit({ docId, remote: true });
    }
  }

  isLoaded(docId: string): boolean {
    return this.loaded.has(docId);
  }

  getLoaded(docId: string): Y.Doc | undefined {
    return this.loaded.get(docId)?.doc;
  }

  /** Loads (or returns) a doc. Call retain/release to pin it while a view uses it. */
  async open(docId: string): Promise<Y.Doc> {
    const hit = this.loaded.get(docId);
    if (hit) return hit.doc;
    const inflight = this.loading.get(docId);
    if (inflight) return inflight;
    const p = this.load(docId);
    this.loading.set(docId, p);
    try {
      return await p;
    } finally {
      this.loading.delete(docId);
    }
  }

  retain(docId: string) {
    const e = this.loaded.get(docId);
    if (e) e.refs++;
  }

  release(docId: string) {
    const e = this.loaded.get(docId);
    if (e && e.refs > 0) e.refs--;
  }

  private async load(docId: string): Promise<Y.Doc> {
    const doc = new Y.Doc({ guid: docId });
    const rows = await this.db.getUpdates(docId);
    if (rows.length) {
      // Canvas speed NFR (a month opens in under 1 s): applying the log row by row in one
      // transaction is 2–3 times faster than Y.mergeUpdates followed by one apply (a busy month,
      // 16 MB in 20 rows: about 350 ms against 1 s)
      doc.transact(() => {
        for (const r of rows) Y.applyUpdate(doc, r.data, LOAD_ORIGIN);
      }, LOAD_ORIGIN);
    }
    // Updates not yet durable (e.g. remote updates received while unloaded): in flight to
    // IndexedDB or still buffered. Re-applying something already in `rows` is a no-op.
    for (const batch of this.inflight.get(docId) ?? []) for (const u of batch) Y.applyUpdate(doc, u, LOAD_ORIGIN);
    const pend = this.pending.get(docId);
    if (pend) for (const u of pend) Y.applyUpdate(doc, u, LOAD_ORIGIN);

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      const from = isRemote(origin) ? origin.transport : undefined;
      // another tab saved it already
      if (from !== TAB_TRANSPORT) this.enqueue(docId, update);
      this.onUpdate.emit({ docId, update, from });
      this.onDocChanged.emit({ docId, remote: !!from });
    });
    this.loaded.set(docId, { doc, refs: 0 });
    this.knownIds?.add(docId);
    if (rows.length > COMPACT_THRESHOLD) void this.compact(docId);
    return doc;
  }

  /**
   * Applies an update from a transport. If the doc is loaded it is applied to the live doc
   * (which then persists + re-broadcasts it); otherwise it is appended to the log directly.
   */
  async applyRemote(docId: string, update: Uint8Array, transport: string): Promise<void> {
    const live = this.loaded.get(docId)?.doc ?? (this.loading.has(docId) ? await this.loading.get(docId) : undefined);
    if (live) {
      Y.applyUpdate(live, update, { transport } satisfies RemoteOrigin);
      return;
    }
    // Cheap no-op detection: skip updates we already fully have.
    const sv = await this.getStateVector(docId);
    // the doc may have been opened while we were reading: deliver to the live doc instead
    const nowLive = this.loaded.get(docId)?.doc ?? (this.loading.has(docId) ? await this.loading.get(docId) : undefined);
    if (nowLive) {
      Y.applyUpdate(nowLive, update, { transport } satisfies RemoteOrigin);
      return;
    }
    const missing = Y.diffUpdate(update, sv);
    if (isEmptyUpdate(missing) && sv.length > 1) return;
    this.enqueue(docId, update);
    this.knownIds?.add(docId);
    this.onUpdate.emit({ docId, update, from: transport });
    this.onDocChanged.emit({ docId, remote: true });
  }

  /** Full state of a doc as a single update, without loading it into memory. */
  async getState(docId: string): Promise<Uint8Array | null> {
    const live = this.loaded.get(docId)?.doc;
    if (live) return Y.encodeStateAsUpdate(live);
    const rows = await this.db.getUpdates(docId);
    const parts = rows.map((r) => r.data);
    for (const batch of this.inflight.get(docId) ?? []) parts.push(...batch);
    const pend = this.pending.get(docId);
    if (pend) parts.push(...pend);
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
  }

  async getStateVector(docId: string): Promise<Uint8Array> {
    const live = this.loaded.get(docId)?.doc;
    if (live) return Y.encodeStateVector(live);
    const state = await this.getState(docId);
    return state ? Y.encodeStateVectorFromUpdate(state) : Y.encodeStateVector(new Y.Doc());
  }

  /** The part of our state the peer (with state vector `sv`) is missing. */
  async diff(docId: string, sv: Uint8Array): Promise<Uint8Array | null> {
    const live = this.loaded.get(docId)?.doc;
    if (live) return Y.encodeStateAsUpdate(live, sv);
    const state = await this.getState(docId);
    if (!state) return null;
    return Y.diffUpdate(state, sv);
  }

  /** Whether this device has the document (stored, pending or open). */
  async has(docId: string): Promise<boolean> {
    return this.loaded.has(docId) || (await this.listDocIds()).includes(docId);
  }

  async listDocIds(): Promise<string[]> {
    if (!this.knownIds) {
      this.knownIds = new Set(await this.db.listDocIds());
      for (const id of this.loaded.keys()) this.knownIds.add(id);
      for (const id of this.pending.keys()) this.knownIds.add(id);
    }
    return [...this.knownIds];
  }

  // ---------- persistence ----------

  /** Whether every change of `docId` made so far is in IndexedDB (nothing buffered or in flight). */
  isSaved(docId: string): boolean {
    return !this.pending.has(docId) && !this.inflight.has(docId);
  }

  /**
   * Durability NFR: resolves once every change of `docId` made before the call is in IndexedDB.
   * Drafts of work in progress (ui/common/drafts.ts) are cleared only then. Later changes may
   * delay it (it waits for a moment with nothing unsaved); a failed write waits for its retry.
   */
  whenSaved(docId: string): Promise<void> {
    if (this.isSaved(docId)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.saveWaiters.get(docId);
      if (list) list.push(resolve);
      else this.saveWaiters.set(docId, [resolve]);
    });
  }

  /** A write of `docId` settled: wake `whenSaved` callers if nothing of it is unsaved now. */
  private wroteDoc(docId: string) {
    const list = this.saveWaiters.get(docId);
    if (!list || !this.isSaved(docId)) return;
    this.saveWaiters.delete(docId);
    for (const r of list) r();
  }

  private enqueue(docId: string, update: Uint8Array) {
    const list = this.pending.get(docId);
    if (list) list.push(update);
    else this.pending.set(docId, [update]);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /**
   * Durability NFR: writes the pending updates at once, outside the write chain, for when the
   * page is going away (pagehide) and there may be no later turn of the event loop for queued
   * writes. Each transaction is created before this returns. Yjs updates commute, so rows
   * written out of order merge to the same document.
   */
  flushNow(): Promise<unknown> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.pending.size) return this.writeChain;
    const batch = [...this.pending];
    this.pending.clear();
    const writes = batch.map(([docId, updates]) => {
      const list = this.inflight.get(docId);
      if (list) list.push(updates);
      else this.inflight.set(docId, [updates]);
      const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
      return this.db
        .putUpdate(docId, merged)
        .catch((err) => {
          const pend = this.pending.get(docId);
          this.pending.set(docId, pend ? [merged, ...pend] : [merged]);
          this.onError.emit(err as Error);
          // retried like any write (the page may stay open after all)
          if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), 500);
        })
        .finally(() => {
          const l = this.inflight.get(docId);
          const i = l?.indexOf(updates) ?? -1;
          if (l && i >= 0) l.splice(i, 1);
          if (l && !l.length) this.inflight.delete(docId);
          this.wroteDoc(docId);
        });
    });
    const all = Promise.all(writes);
    this.writeChain = this.writeChain.then(() => all);
    return all;
  }

  /** Writes all pending updates to IndexedDB. Resolves when durable. */
  flush(): Promise<unknown> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.pending.size) return this.writeChain;
    const batch = [...this.pending];
    this.pending.clear();
    for (const [docId, updates] of batch) {
      const list = this.inflight.get(docId);
      if (list) list.push(updates);
      else this.inflight.set(docId, [updates]);
    }
    const settle = (docId: string, updates: Uint8Array[]) => {
      const list = this.inflight.get(docId);
      if (!list) return;
      const i = list.indexOf(updates);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.inflight.delete(docId);
      this.wroteDoc(docId);
    };
    this.writeChain = this.writeChain.then(async () => {
      let failed: Error | null = null;
      for (const [docId, updates] of batch) {
        const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
        try {
          await this.db.putUpdate(docId, merged);
          this.channel?.postMessage({ docId, update: merged });
        } catch (err) {
          // keep the data: put it back in front of anything newer and retry later
          failed = err as Error;
          const pend = this.pending.get(docId);
          this.pending.set(docId, pend ? [merged, ...pend] : [merged]);
          continue;
        } finally {
          settle(docId, updates);
        }
        const n = (this.appendCounts.get(docId) ?? 0) + 1;
        this.appendCounts.set(docId, n);
        if (n >= COMPACT_THRESHOLD) {
          this.appendCounts.set(docId, 0);
          await this.compact(docId).catch(() => {});
        }
      }
      if (failed) {
        this.retryDelay = Math.min(30_000, (this.retryDelay || 500) * 2);
        this.onError.emit(failed);
        if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), this.retryDelay);
      } else this.retryDelay = 0;
    }).catch((err) => {
      // never leave the chain rejected, or every later flush would be skipped
      this.onError.emit(err as Error);
    });
    return this.writeChain;
  }

  async compact(docId: string): Promise<void> {
    await this.db.compact(docId, (updates) => Y.mergeUpdates(updates));
  }

  async destroy() {
    await this.flush();
    for (const e of this.loaded.values()) e.doc.destroy();
  }
}

export function isRemote(origin: unknown): origin is RemoteOrigin {
  return typeof origin === 'object' && origin !== null && 'transport' in origin;
}

function isEmptyUpdate(u: Uint8Array): boolean {
  // An empty Yjs v1 update encodes as [0, 0] (no structs, empty delete set).
  return u.length <= 2 && u.every((b) => b === 0);
}
