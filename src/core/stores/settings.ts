/**
 * Settings (R11). Synced, non-secret settings live in `library/settings.json`; secrets (the
 * GitHub token, the fetch helper key) stay on this device only.
 */
import type { SyncedSettings } from '../model/types';
import type { SlateDB } from '../storage/idb';
import { Emitter } from '../util/emitter';
import { SharedKv, type StoreChange } from './sharedKv';

export interface DeviceSecrets {
  /** fine-grained personal access token, gym repository only */
  token?: string;
  /** owner/name */
  repo?: string;
  branch?: string;
  /** expiry read from GitHub's response headers (ms), when known */
  tokenExpiry?: number;
  helperUrl?: string;
  helperKey?: string;
  /** GitHub API base for test builds only (the mocked API); production always uses api.github.com */
  apiBase?: string;
}

/** Device-only preferences (not synced). */
export interface DevicePrefs {
  theme: 'system' | 'light' | 'dark';
  /** C13: draw with a finger even when a Pencil has been detected */
  fingerDrawing: boolean;
  /** C4: two-finger hold time that switches pinch from zoom to space insertion */
  spaceHoldMs: number;
  /** C11: Pencil double-tap / squeeze action */
  pencilDoubleTap: 'eraser' | 'previous' | 'none';
  minimap: boolean;
}

export const DEFAULT_SETTINGS: SyncedSettings = {
  pens: [
    { tool: 'pen', color: 'currentInk', size: 2.5 },
    { tool: 'pen', color: '#2f6fde', size: 2.5 },
    { tool: 'pen', color: '#c93a32', size: 2.5 },
  ],
  highlighters: [{ tool: 'highlighter', color: '#f5d742', size: 16 }],
  colors: [],
  readingPositions: {},
  updated: 0,
};

export const DEFAULT_PREFS: DevicePrefs = {
  theme: 'system',
  fingerDrawing: false,
  spaceHoldMs: 400,
  pencilDoubleTap: 'eraser',
  minimap: true,
};

/**
 * The three entries are shared with other tabs (sharedKv.ts): every change re-reads the entry
 * before writing, so two tabs never overwrite each other's settings.
 */
export class SettingsStore {
  /** Fires on every change of any of the three, here or saved by another tab. */
  readonly onChange = new Emitter<StoreChange>();

  private constructor(
    private synced: SharedKv<SyncedSettings>,
    private secrets: SharedKv<DeviceSecrets>,
    private prefs: SharedKv<DevicePrefs>,
  ) {
    for (const kv of [synced, secrets, prefs] as SharedKv<unknown>[]) kv.onChange.on((c) => this.onChange.emit(c));
  }

  static async open(db: SlateDB): Promise<SettingsStore> {
    return new SettingsStore(
      await SharedKv.open<SyncedSettings>(db, 'settings', (raw) => ({ ...DEFAULT_SETTINGS, ...(raw ?? {}) })),
      await SharedKv.open<DeviceSecrets>(db, 'secrets', (raw) => raw ?? {}),
      await SharedKv.open<DevicePrefs>(db, 'prefs', (raw) => ({ ...DEFAULT_PREFS, ...(raw ?? {}) })),
    );
  }

  get(): SyncedSettings {
    return this.synced.get();
  }

  /**
   * Local change: bumps `updated` so it wins the next merge. Reading positions and pane state
   * carry their own times and merge by them (`mergeSettings`); they pass `touch: false` so that
   * scrolling a book here does not make this device's older pens win over another device's.
   */
  async update(patch: Partial<SyncedSettings>, opts: { touch?: boolean } = {}): Promise<void> {
    const now = Date.now();
    await this.synced.mutate((s) => ({ ...s, ...patch, updated: opts.touch === false ? s.updated : now }));
  }

  /** Merges the repository's settings.json into the settings as they are now (from sync). */
  async mergeFromRemote(remote: SyncedSettings): Promise<void> {
    const full = { ...DEFAULT_SETTINGS, ...remote };
    await this.synced.mutate((s) => ({ ...DEFAULT_SETTINGS, ...mergeSettings(s, full) }));
  }

  getSecrets(): DeviceSecrets {
    return this.secrets.get();
  }

  async setSecrets(patch: Partial<DeviceSecrets>): Promise<void> {
    await this.secrets.mutate((s) => ({ ...s, ...patch }));
  }

  getPrefs(): DevicePrefs {
    return this.prefs.get();
  }

  async setPrefs(patch: Partial<DevicePrefs>): Promise<void> {
    await this.prefs.mutate((p) => ({ ...p, ...patch }));
  }
}

/**
 * Merges two versions of settings.json: per reading position the newer wins; everything
 * else from the side with the newer `updated`.
 */
export function mergeSettings(a: SyncedSettings, b: SyncedSettings): SyncedSettings {
  const [older, newer] = a.updated >= b.updated ? [b, a] : [a, b];
  const readingPositions = { ...older.readingPositions };
  for (const [k, v] of Object.entries(newer.readingPositions ?? {})) {
    const o = readingPositions[k];
    if (!o || v.updated >= o.updated) readingPositions[k] = v;
  }
  const panes = !older.panes ? newer.panes : !newer.panes ? older.panes : newer.panes.updated >= older.panes.updated ? newer.panes : older.panes;
  return { ...older, ...newer, readingPositions, panes };
}
