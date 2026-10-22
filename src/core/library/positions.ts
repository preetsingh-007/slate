/**
 * Reading positions (L2, L3), remembered per book or clipping and synced through
 * `settings.readingPositions` (library/settings.json). The newer position wins a merge.
 * Other side-pane tabs keep their place here too (P3), under prefixed ids: `gym:<path>` for
 * the gym reader and `canvas:<slug>` for a canvas in the side pane.
 */
import type { Locator, ReadingPosition } from '../model/types';
import type { SettingsStore } from '../stores/settings';

export type PositionLocator = ReadingPosition['locator'];

export function readingPosition(settings: SettingsStore, sourceId: string): ReadingPosition | undefined {
  return settings.get().readingPositions?.[sourceId];
}

/** Saves a position unless it equals the stored one (avoids churn in settings.json). */
export async function saveReadingPosition(settings: SettingsStore, sourceId: string, locator: PositionLocator, device: string, now = Date.now()): Promise<void> {
  const cur = settings.get().readingPositions ?? {};
  if (cur[sourceId] && JSON.stringify(cur[sourceId].locator) === JSON.stringify(locator)) return;
  const pos = { sourceId, locator, updated: now, device };
  await settings.updateReadingPositions((all) => ({ ...all, [sourceId]: pos }));
}

/** Removes the position of a deleted item. */
export async function forgetReadingPosition(settings: SettingsStore, sourceId: string): Promise<void> {
  const cur = settings.get().readingPositions ?? {};
  if (!cur[sourceId]) return;
  await settings.updateReadingPositions((all) => {
    const next = { ...all };
    delete next[sourceId];
    return next;
  });
}

/** Reading-position id of a gym file in the gym reader (P3). */
export const gymPositionId = (path: string) => `gym:${path}`;

/** Reading-position id of a canvas shown in the side pane (P3): its view, as a canvas locator. */
export const canvasPositionId = (slug: string) => `canvas:${slug}`;

/** PDF position: page plus the fraction of the page scrolled past. */
export function pdfPosition(page: number, intra: number): Locator {
  return { type: 'pdf', page, region: { x: 0, y: Math.round(intra * 1000) / 1000, w: 1, h: 0 }, quote: '' };
}

/** EPUB position: chapter href plus the fraction of the chapter scrolled past. */
export function epubPosition(chapter: string, position: number): Locator {
  return { type: 'epub', chapter, quote: { exact: '', prefix: '', suffix: '' }, position: Math.round(position * 1000) / 1000 };
}
