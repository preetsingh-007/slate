import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneState } from '../../core/model/types';
import { ADOPT_WINDOW_MS, LAYOUT_KEY, PANE_SYNC_DELAY_MS, readLocalLayout, restoreLocalLayout, sanitizeLayout, shouldAdopt, startLayoutSync } from './layoutSync';
import { useApp } from './store';

const initial = useApp.getState();

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

function harness(start: number, panes?: PaneState) {
  let now = start;
  let synced = panes;
  const listeners = new Set<() => void>();
  const storage = memoryStorage();
  const setPanes = vi.fn(async (p: PaneState) => {
    synced = p;
  });
  const deps = {
    device: 'ipad',
    storage,
    now: () => now,
    canvasExists: (s: string) => s === 'main' || s === 'physics',
    getPanes: () => synced,
    setPanes,
    onSettingsChange: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    deps,
    storage,
    setPanes,
    tick: (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(ms);
    },
    /** a pull brings another device's layout */
    arrive: (p: PaneState) => {
      synced = p;
      for (const f of listeners) f();
    },
  };
}

const mac = (updated: number, tabs: PaneState['tabs'] = [{ kind: 'todos' }]): PaneState => ({ tabs, active: 0, divider: 0.4, swapped: true, open: true, canvas: 'physics', updated, device: 'mac' });

describe('pane state (P3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useApp.setState({ ...initial, tabs: [], canvas: 'main', paneOpen: false, divider: 0.6, swapped: false, layout: 'split', active: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('sanitizes a stored layout: known tabs only, active in range, divider bounded, an existing canvas', () => {
    const l = sanitizeLayout(
      { tabs: [{ kind: 'book', id: 'b1' }, { kind: 'nope' } as never, { kind: 'gym', path: 'math' }], active: 7, divider: 3, canvas: 'gone', paneOpen: true, layout: 'pane' },
      (s) => s === 'main',
    );
    expect(l).toEqual({ tabs: [{ kind: 'book', id: 'b1' }, { kind: 'gym', path: 'math' }], active: 1, divider: 0.85, canvas: 'main', paneOpen: true, layout: 'pane' });
  });

  it('adopts another device’s newer layout only on start or return, and never over a change made here since', () => {
    expect(shouldAdopt(mac(200), 'ipad', 100, 150, 160)).toBe(true);
    expect(shouldAdopt(mac(200), 'ipad', 300, 150, 160)).toBe(false); // older than this device's
    expect(shouldAdopt(mac(200), 'ipad', 155, 150, 160)).toBe(false); // changed here since start
    expect(shouldAdopt(mac(200), 'ipad', 100, 150, 150 + ADOPT_WINDOW_MS + 1)).toBe(false); // working for a while
    expect(shouldAdopt({ ...mac(200), device: 'ipad' }, 'ipad', 100, 150, 160)).toBe(false); // its own
  });

  it('saves locally at once, syncs after a moment, and restores on reopen', () => {
    const h = harness(1_000);
    const stop = startLayoutSync(h.deps);
    useApp.getState().openTab({ kind: 'clipping', id: 'c1' });
    useApp.getState().setDivider(0.5);
    expect(readLocalLayout(h.storage)).toMatchObject({ tabs: [{ kind: 'clipping', id: 'c1' }], paneOpen: true, divider: 0.5 });
    expect(h.setPanes).not.toHaveBeenCalled();
    h.tick(PANE_SYNC_DELAY_MS);
    expect(h.setPanes).toHaveBeenCalledTimes(1);
    expect(h.setPanes.mock.calls[0][0]).toMatchObject({ tabs: [{ kind: 'clipping', id: 'c1' }], divider: 0.5, open: true, canvas: 'main', device: 'ipad' });
    stop();

    // reopen: the local layout comes back before anything else
    useApp.setState({ tabs: [], paneOpen: false, divider: 0.6 });
    restoreLocalLayout(h.deps);
    expect(useApp.getState()).toMatchObject({ tabs: [{ kind: 'clipping', id: 'c1' }], paneOpen: true, divider: 0.5 });
    expect(JSON.parse(h.storage.getItem(LAYOUT_KEY)!).changed).toBe(1_000);
  });

  it('a newer layout from another device applies on start, but not while the owner is working here', () => {
    const h = harness(10_000, mac(5_000));
    const stop = startLayoutSync(h.deps);
    // adopted on start: this device never changed its layout
    expect(useApp.getState()).toMatchObject({ tabs: [{ kind: 'todos' }], swapped: true, divider: 0.4, canvas: 'physics', paneOpen: true });
    expect(h.setPanes).not.toHaveBeenCalled(); // adopting is not a change to sync back

    // the owner works here; the other device changes again: nothing is yanked
    h.tick(1_000);
    useApp.getState().openTab({ kind: 'gym', path: 'math' });
    h.arrive(mac(12_000, [{ kind: 'revision' }]));
    expect(useApp.getState().tabs[0]).toEqual({ kind: 'gym', path: 'math' });

    // after returning to the app, a newer layout from the other device applies
    h.tick(PANE_SYNC_DELAY_MS);
    h.tick(60_000);
    h.arrive(mac(80_000, [{ kind: 'revision' }]));
    expect(useApp.getState().tabs[0]).toEqual({ kind: 'gym', path: 'math' }); // still in the same session
    document.dispatchEvent(new Event('visibilitychange'));
    expect(useApp.getState().tabs).toEqual([{ kind: 'revision' }]);
    stop();
  });
});
