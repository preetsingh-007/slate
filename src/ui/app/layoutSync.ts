/**
 * P3: the open panes, tabs and divider survive reopening the app, and follow the owner across
 * devices.
 *
 * - Local first: every layout change is written to localStorage at once and read back
 *   synchronously before the first render, so the app reopens as it was, offline too.
 * - Synced: the layout goes to `settings.panes` (library/settings.json) a moment after it
 *   settles, stamped with the time of the change and this device.
 * - Another device's newer layout is adopted when the app starts or returns to the foreground,
 *   but never while the owner is working here: once the layout was changed on this device
 *   since that start or return, or after `ADOPT_WINDOW_MS`, it waits for the next return.
 *
 * Scroll positions are not part of this state: each tab keeps its own place in
 * `settings.readingPositions` (books, clippings, gym files, side-pane canvases).
 */
import type { PaneState, PaneTab } from '../../core/model/types';
import { MAX_TABS, useApp, type AppState, type Layout } from './store';

export const LAYOUT_KEY = 'slate-layout';
/** Delay before a layout change is written to the synced settings. */
export const PANE_SYNC_DELAY_MS = 1500;
/** How long after start or return a newer layout from another device may still apply. */
export const ADOPT_WINDOW_MS = 120_000;

export type PersistedLayout = Pick<AppState, 'canvas' | 'paneOpen' | 'tabs' | 'active' | 'divider' | 'swapped' | 'layout'>;

export interface LocalLayout extends PersistedLayout {
  /** when the layout last changed on this device (or the time of the adopted remote layout) */
  changed: number;
}

export function persistedOf(s: PersistedLayout): PersistedLayout {
  return { canvas: s.canvas, paneOpen: s.paneOpen, tabs: s.tabs, active: s.active, divider: s.divider, swapped: s.swapped, layout: s.layout };
}

const TAB_KINDS = new Set<PaneTab['kind']>(['book', 'clipping', 'gym', 'canvas', 'todos', 'revision', 'library']);

function validTab(t: unknown): t is PaneTab {
  if (!t || typeof t !== 'object') return false;
  const tab = t as Record<string, unknown>;
  if (!TAB_KINDS.has(tab.kind as PaneTab['kind'])) return false;
  if (tab.kind === 'book' || tab.kind === 'clipping') return typeof tab.id === 'string';
  if (tab.kind === 'gym') return typeof tab.path === 'string';
  if (tab.kind === 'canvas') return typeof tab.slug === 'string';
  return true;
}

/**
 * A layout safe to apply: known tab kinds only, at most MAX_TABS, the active tab in range, the
 * divider within its bounds, and a main canvas that exists (else `fallbackCanvas`).
 */
export function sanitizeLayout(l: Partial<PersistedLayout>, canvasExists: (slug: string) => boolean, fallbackCanvas = 'main'): Partial<PersistedLayout> {
  const out: Partial<PersistedLayout> = {};
  const tabs = Array.isArray(l.tabs) ? l.tabs.filter(validTab).slice(0, MAX_TABS) : undefined;
  if (tabs) out.tabs = tabs;
  if (typeof l.active === 'number' && Number.isFinite(l.active)) out.active = Math.max(0, Math.min(Math.round(l.active), Math.max(0, (tabs?.length ?? 1) - 1)));
  if (typeof l.divider === 'number' && Number.isFinite(l.divider)) out.divider = Math.min(0.85, Math.max(0.15, l.divider));
  if (typeof l.swapped === 'boolean') out.swapped = l.swapped;
  if (typeof l.paneOpen === 'boolean') out.paneOpen = l.paneOpen && (tabs ? tabs.length > 0 : true);
  if (l.layout === 'split' || l.layout === 'canvas' || l.layout === 'pane') out.layout = l.layout as Layout;
  if (typeof l.canvas === 'string') out.canvas = canvasExists(l.canvas) ? l.canvas : fallbackCanvas;
  return out;
}

export function readLocalLayout(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): LocalLayout | null {
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LocalLayout;
    return v && typeof v === 'object' ? { ...v, changed: typeof v.changed === 'number' ? v.changed : 0 } : null;
  } catch {
    return null;
  }
}

export function writeLocalLayout(l: LocalLayout, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify(l));
  } catch {
    /* private mode or quota: the synced copy still works */
  }
}

/** The synced form of a layout. The full-screen choice stays on the device (it depends on the screen). */
export function toPaneState(l: PersistedLayout, updated: number, device: string): PaneState {
  return { tabs: l.tabs, active: l.active, divider: l.divider, swapped: l.swapped, open: l.paneOpen, canvas: l.canvas, updated, device };
}

export function fromPaneState(p: PaneState): Partial<PersistedLayout> {
  const out: Partial<PersistedLayout> = { tabs: p.tabs, active: p.active, divider: p.divider, swapped: p.swapped, paneOpen: p.open ?? p.tabs.length > 0 };
  if (p.canvas) out.canvas = p.canvas;
  return out;
}

/**
 * Whether another device's synced layout should replace this device's now: it is newer than
 * the last change here, no change was made here since the app started or came back, and that
 * was recently.
 */
export function shouldAdopt(remote: PaneState | undefined, device: string, localChanged: number, sessionStart: number, now: number): remote is PaneState {
  if (!remote || remote.device === device) return false;
  if (remote.updated <= localChanged) return false;
  if (localChanged > sessionStart) return false;
  return now - sessionStart <= ADOPT_WINDOW_MS;
}

export interface LayoutSyncDeps {
  device: string;
  getPanes(): PaneState | undefined;
  setPanes(p: PaneState): Promise<void>;
  onSettingsChange(fn: () => void): () => void;
  canvasExists(slug: string): boolean;
  now?: () => number;
  storage?: Storage;
}

/** Restores the local layout into the app store (call before the first render). */
export function restoreLocalLayout(deps: Pick<LayoutSyncDeps, 'canvasExists' | 'storage'>): LocalLayout | null {
  const local = readLocalLayout(deps.storage ?? globalThis.localStorage);
  if (local) useApp.getState().restore(sanitizeLayout(local, deps.canvasExists));
  return local;
}

/** Keeps the layout persisted and synced; returns a function that stops it. */
export function startLayoutSync(deps: LayoutSyncDeps): () => void {
  const now = deps.now ?? Date.now;
  const storage = deps.storage ?? globalThis.localStorage;
  let changed = readLocalLayout(storage)?.changed ?? 0;
  let last = JSON.stringify(persistedOf(useApp.getState()));
  let adopting: number | null = null;
  let sessionStart = now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const push = () => {
    timer = undefined;
    void deps.setPanes(toPaneState(persistedOf(useApp.getState()), changed, deps.device));
  };

  const offStore = useApp.subscribe((s) => {
    const p = persistedOf(s);
    const json = JSON.stringify(p);
    if (json === last) return;
    last = json;
    changed = adopting ?? now();
    writeLocalLayout({ ...p, changed }, storage);
    if (adopting !== null) return; // already the synced layout
    clearTimeout(timer);
    timer = setTimeout(push, PANE_SYNC_DELAY_MS);
  });

  const consider = () => {
    const remote = deps.getPanes();
    if (!shouldAdopt(remote, deps.device, changed, sessionStart, now())) return;
    adopting = remote.updated;
    try {
      useApp.getState().restore(sanitizeLayout(fromPaneState(remote), deps.canvasExists, useApp.getState().canvas));
    } finally {
      adopting = null;
    }
    changed = Math.max(changed, remote.updated);
  };

  const offSettings = deps.onSettingsChange(consider);
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible') {
      sessionStart = now();
      consider();
    } else if (timer) {
      // going to the background: write the pending change now (sync pushes on hide, R4)
      clearTimeout(timer);
      push();
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  // a layout from another device may have arrived during the last session
  consider();
  // a change made here just before the app was closed may not have reached the settings
  if (changed > (deps.getPanes()?.updated ?? 0)) timer = setTimeout(push, PANE_SYNC_DELAY_MS);

  return () => {
    offStore();
    offSettings();
    clearTimeout(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
