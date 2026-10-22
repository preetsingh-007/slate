/** What a sync run works with: the stores, the remote and the persisted state. */
import type { AssetStore } from '../storage/assets';
import type { DocStore } from '../storage/docstore';
import type { SlateDB } from '../storage/idb';
import type { CanvasStore } from '../stores/canvases';
import type { FormalizedStore } from '../stores/formalized';
import type { LibraryStore } from '../stores/library';
import type { SettingsStore } from '../stores/settings';
import type { GymMirror } from '../gym/mirror';
import type { Rasterizer } from './derived/marks';
import type { FetchLike, GitRemote } from './git/remote';
import type { SyncState } from './state';
import type { SegmentContent } from './derived/segment';
import type { LfsClient } from './lfs';

export interface SyncDeps {
  db: SlateDB;
  docs: DocStore;
  assets: AssetStore;
  settings: SettingsStore;
  canvases: CanvasStore;
  library: LibraryStore;
  formalized: FormalizedStore;
  /** offline mirror of gym's files (G1, G7, G8), refreshed on every pull */
  mirror?: GymMirror;
  /** renders mark PNGs (G5); the browser rasteriser in the app, a stub in tests */
  rasterize: Rasterizer;
  /** network access (tests pass the in-memory GitHub) */
  fetch?: FetchLike;
  now?: () => number;
}

export interface SyncContext {
  deps: SyncDeps;
  remote: GitRemote;
  st: SyncState;
  save(): Promise<void>;
  /** runs store writes without marking them as local changes to push */
  quietly<T>(fn: () => Promise<T>): Promise<T>;
  warn(message: string): void;
  /** a local canvas segment's content (cached until the document changes) */
  segment(docId: string): Promise<SegmentContent | null>;
  /** LFS client when Git LFS mode is on (R7) */
  lfs?: LfsClient;
}

/** Transport name of updates merged from GitHub (DocStore origin). */
export const GIT_TRANSPORT = 'git';

/** Version of the derived file formats; bump to regenerate every segment's files. */
export const DERIVED_VERSION = 1;
