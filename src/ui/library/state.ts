/**
 * Library UI state shared by the panes, dialogs and source openers: pending jumps (S6), the
 * captures waiting in the lasso preview (S3) and the open dialogs.
 */
import { create } from 'zustand';
import type { Capture } from '../../core/model/capture';
import type { Locator } from '../../core/model/types';

export interface Jump {
  locator: Locator;
  nonce: number;
}

export type LibraryDialog =
  | { kind: 'link'; url?: string }
  | { kind: 'paste' }
  | { kind: 'edit'; itemKind: 'book' | 'clipping'; id: string }
  | { kind: 'delete'; itemKind: 'book' | 'clipping'; id: string };

interface LibraryUi {
  jumps: Record<string, Jump>;
  /** captures shown in the preview, in lasso order */
  captures: Capture[];
  /** where the preview appears (client coordinates of the last lasso) */
  previewAt: { x: number; y: number } | null;
  dialog: LibraryDialog | null;
  jump(itemId: string, locator: Locator): void;
  /** Takes a pending jump for an item (once). */
  takeJump(itemId: string): Jump | undefined;
  addCapture(c: Capture, at: { x: number; y: number }): void;
  removeCapture(id: string): void;
  clearCaptures(): void;
  openDialog(d: LibraryDialog | null): void;
}

let nonce = 1;

export const useLibraryUi = create<LibraryUi>((set, get) => ({
  jumps: {},
  captures: [],
  previewAt: null,
  dialog: null,
  jump: (itemId, locator) => set((s) => ({ jumps: { ...s.jumps, [itemId]: { locator, nonce: nonce++ } } })),
  takeJump: (itemId) => {
    const j = get().jumps[itemId];
    if (j) {
      const next = { ...get().jumps };
      delete next[itemId];
      set({ jumps: next });
    }
    return j;
  },
  addCapture: (c, at) => set((s) => ({ captures: [...s.captures, c], previewAt: at })),
  removeCapture: (id) => set((s) => ({ captures: s.captures.filter((c) => c.id !== id) })),
  clearCaptures: () => set({ captures: [], previewAt: null }),
  openDialog: (dialog) => set({ dialog }),
}));
