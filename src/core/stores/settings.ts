/**
 * Settings (R11). Synced, non-secret settings live in `library/settings.json`; secrets (the
 * GitHub token, the fetch helper key) stay on this device only.
 */
import type { SyncedSettings } from '../model/types';
import type { SlateDB } from '../storage/idb';
import { Emitter } from '../util/emitter';

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

export class SettingsStore {
  readonly onChange = new Emitter<void>();
  private synced: SyncedSettings = DEFAULT_SETTINGS;
  private secrets: DeviceSecrets = {};
  private prefs: DevicePrefs = DEFAULT_PREFS;

  private constructor(private db: SlateDB) {}

  static async open(db: SlateDB): Promise<SettingsStore> {
    const s = new SettingsStore(db);
    s.synced = { ...DEFAULT_SETTINGS, ...((await db.get<SyncedSettings>('settings')) ?? {}) };
    s.secrets = (await db.get<DeviceSecrets>('secrets')) ?? {};
    s.prefs = { ...DEFAULT_PREFS, ...((await db.get<DevicePrefs>('prefs')) ?? {}) };
    return s;
  }

  get(): SyncedSettings {
    return this.synced;
  }

  /**
   * Local change: bumps `updated` so it wins the next merge. Reading positions and pane state
   * carry their own times and merge by them (`mergeSettings`); they pass `touch: false` so that
   * scrolling a book here does not make this device's older pens win over another device's.
   */
  async update(patch: Partial<SyncedSettings>, opts: { touch?: boolean } = {}): Promise<void> {
    this.synced = { ...this.synced, ...patch, updated: opts.touch === false ? this.synced.updated : Date.now() };
    await this.db.set('settings', this.synced);
    this.onChange.emit();
  }

  /** Replaces the settings with a merged version (from sync). */
  async replace(next: SyncedSettings): Promise<void> {
    this.synced = { ...DEFAULT_SETTINGS, ...next };
    await this.db.set('settings', this.synced);
    this.onChange.emit();
  }

  getSecrets(): DeviceSecrets {
    return this.secrets;
  }

  async setSecrets(patch: Partial<DeviceSecrets>): Promise<void> {
    this.secrets = { ...this.secrets, ...patch };
    await this.db.set('secrets', this.secrets);
    this.onChange.emit();
  }

  getPrefs(): DevicePrefs {
    return this.prefs;
  }

  async setPrefs(patch: Partial<DevicePrefs>): Promise<void> {
    this.prefs = { ...this.prefs, ...patch };
    await this.db.set('prefs', this.prefs);
    this.onChange.emit();
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
