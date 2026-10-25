/**
 * Day lines (C19) and where new work starts (C20).
 *
 * When an object created on a calendar day (device local time) lies below all existing content
 * and that day has no line on this canvas yet, the day's line is created 24 units above it.
 * Objects added that day elsewhere create no line. At most one line per date per canvas; when
 * two devices create one, the model keeps the lower (see segment.ts). Deleting a day's last
 * object removes its line in the same undo step (model.ts).
 */
import type { Rect } from '../model/types';

/** Distance between a day line and the first object below it (C19). */
export const DAY_LINE_OFFSET = 24;
/** Where the preview of today's line sits below the latest content (C20). */
export const PREVIEW_GAP = 64;

/** Lowest point of content, from loaded objects and the recorded bounds of unloaded months. */
export function contentBottom(loaded: Rect | null, recorded: Iterable<Rect | null>): number | null {
  let b = loaded ? loaded.y + loaded.h : -Infinity;
  for (const r of recorded) if (r) b = Math.max(b, r.y + r.h);
  return b === -Infinity ? null : b;
}

/**
 * The y of the day line to create for objects added on `date` whose top edge is `top`, or null
 * when no line should be created. `bottom` is the bottom of the content that existed before.
 */
export function dayLineFor(date: string, top: number, bottom: number | null, lines: ReadonlyMap<string, number>): number | null {
  if (lines.has(date)) return null;
  // "below all existing content": a stroke may start a hair above the lowest ink
  if (bottom !== null && top < bottom - 1) return null;
  return Math.round((top - DAY_LINE_OFFSET) * 10) / 10;
}

/** y of today's preview line: just below the latest content, or at the origin of an empty canvas. */
export function previewLineY(bottom: number | null): number {
  return bottom === null ? 0 : Math.round(bottom + PREVIEW_GAP);
}

/** Day lines sorted top to bottom. */
export function sortedLines(lines: ReadonlyMap<string, number>): { date: string; y: number }[] {
  return [...lines].map(([date, y]) => ({ date, y })).sort((a, b) => a.y - b.y || a.date.localeCompare(b.date));
}

/** The line to jump to for a date: that day's, or else the closest earlier day's (C21). */
export function lineForDate(lines: ReadonlyMap<string, number>, date: string): { date: string; y: number } | null {
  const exact = lines.get(date);
  if (exact !== undefined) return { date, y: exact };
  let best: { date: string; y: number } | null = null;
  for (const [d, y] of lines) if (d < date && (!best || d > best.date)) best = { date: d, y };
  if (best) return best;
  for (const [d, y] of lines) if (!best || d < best.date) best = { date: d, y };
  return best;
}
