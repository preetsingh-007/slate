/**
 * What sync remembers about the repository between runs (kv `sync:state:<remote id>`). It is a
 * cache: losing it costs re-downloads, never data (documents merge, JSON files merge against
 * an empty base, derived files are regenerated).
 */
import type { SlateDB } from '../storage/idb';

export interface SyncState {
  v: 1;
  /** commit the state reflects (last pull or push); null before the first pull */
  head: string | null;
  /** every path under journal/ and library/ at `head` → git blob sha */
  tree: Record<string, string>;
  /** path → blob sha of the remote version merged into local state (documents and JSON files) */
  merged: Record<string, string>;
  /**
   * document id → digest (state vector and delete set, storage/digest.ts) of the remote copy,
   * to skip pushing documents GitHub already has
   */
  digest: Record<string, string>;
  /** JSON file path → its content as last synced (the base of three-way merges) */
  base: Record<string, unknown>;
  /** mark PNG path → hash of the SVG it was rendered from and the sha written */
  pngs: Record<string, { svg: string; sha: string }>;
  /** segment path → segment sha whose assets were downloaded */
  assetsAt: Record<string, string>;
  /** queue.md / todos.md text at a sha (lines are carried over for segments not on this device) */
  texts: Record<string, { sha: string; text: string }>;
  /** version of the derived formats last written; a change regenerates every local segment */
  derivedVersion: number;
  /** signature of the library and canvas index the derived files were generated with */
  indexSig: string;
  /** R7: path → the content (blob sha) GitHub refused as too large, and when; not sent again for a day */
  rejected: Record<string, { sha: string; at: number }>;
}

export const emptyState = (): SyncState => ({
  v: 1,
  head: null,
  tree: {},
  merged: {},
  digest: {},
  base: {},
  pngs: {},
  assetsAt: {},
  texts: {},
  derivedVersion: 0,
  indexSig: '',
  rejected: {},
});

export const stateKey = (remoteId: string) => `sync:state:${remoteId}`;

export async function loadState(db: SlateDB, remoteId: string): Promise<SyncState> {
  const saved = await db.get<SyncState>(stateKey(remoteId));
  return saved && saved.v === 1 ? { ...emptyState(), ...saved } : emptyState();
}

export async function saveState(db: SlateDB, remoteId: string, st: SyncState): Promise<void> {
  await db.set(stateKey(remoteId), st);
}
