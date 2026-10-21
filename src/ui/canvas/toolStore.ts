/**
 * Tool state shared by every canvas view and the toolbar (C6, C11, C12, C13, C14).
 *
 * `penDetected` flips on the first time a stylus touches any canvas: from then on only the
 * Pencil draws and fingers pan and zoom (C13), unless finger drawing is allowed in the prefs.
 */
import { create } from 'zustand';
import { CURRENT_INK } from '../../core/ink/render';

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'text' | 'space' | 'hand';
export type EraserMode = 'stroke' | 'partial';
export type LassoMode = 'free' | 'rect';

/** Eight pen colours (C6); `currentInk` follows the theme (dark ink on light, light on dark). */
export const PEN_COLORS = [CURRENT_INK, '#2f6fde', '#c93a32', '#2f8a4e', '#e07a1f', '#8e4ec6', '#8a5a2b', '#6b727a'];
export const HIGHLIGHTER_COLORS = ['#f5d742', '#7ed957', '#5cc8ff', '#ff7eb6', '#ffa94d', '#b197fc', '#63e6be', '#ced4da'];
/** Three sizes (C6), in canvas units. */
export const PEN_SIZES = [1.6, 2.5, 4.5];
export const HIGHLIGHTER_SIZES = [10, 16, 26];
/** Eraser radius on screen, in CSS pixels. */
export const ERASER_PX = 10;

export const COLOR_NAMES: Record<string, string> = {
  [CURRENT_INK]: 'Ink',
  '#2f6fde': 'Blue',
  '#c93a32': 'Red',
  '#2f8a4e': 'Green',
  '#e07a1f': 'Orange',
  '#8e4ec6': 'Purple',
  '#8a5a2b': 'Brown',
  '#6b727a': 'Grey',
  '#f5d742': 'Yellow',
  '#7ed957': 'Lime',
  '#5cc8ff': 'Sky',
  '#ff7eb6': 'Pink',
  '#ffa94d': 'Apricot',
  '#b197fc': 'Lavender',
  '#63e6be': 'Mint',
  '#ced4da': 'Silver',
};

export interface PenStyle {
  color: string;
  size: number;
}

export interface ToolState {
  tool: Tool;
  /** the tool before the current one (stylus button "previous tool") */
  prevTool: Tool;
  pen: PenStyle;
  highlighter: PenStyle;
  eraserMode: EraserMode;
  lassoMode: LassoMode;
  penDetected: boolean;
  setTool(t: Tool): void;
  setPen(p: Partial<PenStyle>): void;
  setHighlighter(p: Partial<PenStyle>): void;
  setEraserMode(m: EraserMode): void;
  setLassoMode(m: LassoMode): void;
  setPenDetected(v: boolean): void;
}

export const useTools = create<ToolState>((set, get) => ({
  tool: 'pen',
  prevTool: 'lasso',
  pen: { color: CURRENT_INK, size: PEN_SIZES[1] },
  highlighter: { color: HIGHLIGHTER_COLORS[0], size: HIGHLIGHTER_SIZES[1] },
  eraserMode: 'stroke',
  lassoMode: 'free',
  penDetected: false,
  setTool: (tool) => {
    const cur = get().tool;
    if (cur !== tool) set({ tool, prevTool: cur });
  },
  setPen: (p) => set((s) => ({ pen: { ...s.pen, ...p } })),
  setHighlighter: (p) => set((s) => ({ highlighter: { ...s.highlighter, ...p } })),
  setEraserMode: (eraserMode) => set({ eraserMode }),
  setLassoMode: (lassoMode) => set({ lassoMode }),
  setPenDetected: (penDetected) => {
    if (get().penDetected !== penDetected) set({ penDetected });
  },
}));

export const isDrawingTool = (t: Tool) => t === 'pen' || t === 'highlighter' || t === 'eraser';
