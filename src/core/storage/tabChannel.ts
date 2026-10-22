/** BroadcastChannels between tabs of the app on one database (R1). */
import type { SlateDB } from './idb';

/** A channel to the other tabs on this database (none where BroadcastChannel is missing). */
export function tabChannel(db: SlateDB, topic: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const c = new BroadcastChannel(`slate-${topic}:${db.name}`);
  // never keep a test process alive
  (c as { unref?: () => void }).unref?.();
  return c;
}
