/**
 * App-level UI state: the open canvas, the side pane and its tabs (P1–P3), and the carry
 * tray (S4). Persisted locally; the pane state is also synced through settings (P3).
 */
import { create } from 'zustand';
import type { Capture } from '../../core/model/capture';
import type { PaneTab } from '../../core/model/types';

export type Layout = 'split' | 'canvas' | 'pane';

export interface AppState {
  canvas: string;
  paneOpen: boolean;
  tabs: PaneTab[];
  active: number;
  /** fraction of the width given to the canvas */
  divider: number;
  swapped: boolean;
  /** 'canvas' or 'pane' when one side is full screen */
  layout: Layout;
  carry: Capture[];
  setCanvas(slug: string): void;
  openTab(tab: PaneTab): void;
  closeTab(index: number): void;
  activate(index: number): void;
  togglePane(open?: boolean): void;
  setDivider(f: number): void;
  swap(): void;
  setLayout(l: Layout): void;
  addToCarry(c: Capture): void;
  removeFromCarry(id: string): void;
  restore(s: Partial<Pick<AppState, 'canvas' | 'paneOpen' | 'tabs' | 'active' | 'divider' | 'swapped'>>): void;
}

export const MAX_TABS = 8;

export function sameTab(a: PaneTab, b: PaneTab): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'book':
    case 'clipping':
      return a.id === (b as typeof a).id;
    case 'gym':
      return a.path.split('#')[0] === (b as typeof a).path.split('#')[0];
    case 'canvas':
      return a.slug === (b as typeof a).slug;
    default:
      return true;
  }
}

export const useApp = create<AppState>((set) => ({
  canvas: 'main',
  paneOpen: false,
  tabs: [],
  active: 0,
  divider: 0.6,
  swapped: false,
  layout: 'split',
  carry: [],
  setCanvas: (slug) => set({ canvas: slug }),
  openTab: (tab) =>
    set((s) => {
      const rest = s.tabs.filter((t) => !sameTab(t, tab));
      return { tabs: [tab, ...rest].slice(0, MAX_TABS), active: 0, paneOpen: true, layout: s.layout === 'canvas' ? 'split' : s.layout };
    }),
  closeTab: (index) =>
    set((s) => {
      const tabs = s.tabs.filter((_, i) => i !== index);
      return { tabs, active: Math.min(s.active, Math.max(0, tabs.length - 1)), paneOpen: s.paneOpen && tabs.length > 0 };
    }),
  activate: (index) => set({ active: index, paneOpen: true }),
  togglePane: (open) => set((s) => ({ paneOpen: open ?? !s.paneOpen, layout: 'split' })),
  setDivider: (f) => set({ divider: Math.min(0.85, Math.max(0.15, f)) }),
  swap: () => set((s) => ({ swapped: !s.swapped })),
  setLayout: (layout) => set({ layout }),
  addToCarry: (c) => set((s) => ({ carry: [...s.carry, c] })),
  removeFromCarry: (id) => set((s) => ({ carry: s.carry.filter((c) => c.id !== id) })),
  restore: (r) => set(r),
}));
