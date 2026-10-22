/**
 * One kv entry shared by every tab of the app on this device (R1): the stores' in-memory copy of
 * the library index, the canvas list or the settings.
 *
 * A change applies to the in-memory value at once (the UI and sync read it synchronously) and to
 * the stored value in one IndexedDB transaction that re-reads it first, so a change saved by
 * another tab in between is kept rather than overwritten by this tab's stale copy. Tabs tell
 * each other about writes over a BroadcastChannel, and the others re-read. Mutations must be
 * pure and idempotent (applying one twice changes nothing), since a re-read may already
 * contain a change that is still being applied here.
 */
import type { SlateDB } from '../storage/idb';
import { Emitter } from '../util/emitter';
import { tabChannel } from '../storage/tabChannel';

/** What a store change carries: whether sync made it (sync's own writes are not pushed back). */
export interface StoreChange {
  fromSync: boolean;
}

let syncDepth = 0;

/**
 * Runs `fn`, marking the store writes it starts synchronously as made by sync. Only the
 * synchronous part counts, so the owner's edits made while those writes are saved still count
 * as local changes.
 */
export function asSyncWrite<T>(fn: () => T): T {
  syncDepth++;
  try {
    return fn();
  } finally {
    syncDepth--;
  }
}

export class SharedKv<T> {
  readonly onChange = new Emitter<StoreChange>();
  private value: T;
  private pending: ((v: T) => T)[] = [];
  private channel: BroadcastChannel | null;

  private constructor(
    private db: SlateDB,
    private key: string,
    private normalize: (raw: T | undefined) => T,
    initial: T,
  ) {
    this.value = initial;
    // a channel object does not receive its own messages
    this.channel = tabChannel(db, `kv-${key}`);
    this.channel?.addEventListener('message', () => void this.refresh());
  }

  static async open<T>(db: SlateDB, key: string, normalize: (raw: T | undefined) => T): Promise<SharedKv<T>> {
    return new SharedKv(db, key, normalize, normalize(await db.get<T>(key)));
  }

  get(): T {
    return this.value;
  }

  /** Applies `fn` here at once and to the stored value (re-read in the same transaction). */
  async mutate(fn: (v: T) => T): Promise<void> {
    const fromSync = syncDepth > 0;
    this.value = fn(this.value);
    this.pending.push(fn);
    this.onChange.emit({ fromSync });
    let stored: T;
    try {
      stored = await this.db.update<T>(this.key, (raw) => fn(this.normalize(raw)));
    } catch (err) {
      this.pending = this.pending.filter((f) => f !== fn);
      throw err;
    }
    this.pending = this.pending.filter((f) => f !== fn);
    this.adopt(stored, fromSync);
    this.channel?.postMessage(this.key);
  }

  /** Re-reads the stored value (another tab wrote it). */
  async refresh(): Promise<void> {
    this.adopt(this.normalize(await this.db.get<T>(this.key)), false);
  }

  private adopt(stored: T, fromSync: boolean) {
    const next = this.pending.reduce((v, f) => f(v), stored);
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    this.onChange.emit({ fromSync });
  }
}
