/**
 * Deleting books and clippings (L13). Clips on canvases keep their image and text; their badge
 * shows "source deleted" because the source id no longer resolves. The warning lists them.
 */
import type { ClipRef, CanvasStore } from '../stores/canvases';
import type { LibraryStore } from '../stores/library';
import type { SettingsStore } from '../stores/settings';
import type { LibraryTextIndex } from './textIndex';
import { forgetReadingPosition } from './positions';

export interface ClipSummary {
  canvas: string;
  month: string;
  clipId: string;
  /** a short excerpt of the clip's text, or "Image" */
  label: string;
}

/** The clips that point to a library item, for the delete warning. */
export async function clipsPointingTo(canvases: Pick<CanvasStore, 'findClipsOf'>, itemId: string): Promise<ClipSummary[]> {
  const refs: ClipRef[] = await canvases.findClipsOf(itemId);
  return refs
    .map((r) => {
      const text = r.clip.text.replace(/[#>*_`$\\[\]()!-]+/g, ' ').replace(/\s+/g, ' ').trim();
      return { canvas: r.canvas, month: r.month, clipId: r.clip.id, label: text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : 'Image' };
    })
    .sort((a, b) => a.canvas.localeCompare(b.canvas) || a.month.localeCompare(b.month));
}

/** Deletes an item: metadata (with a tombstone for sync), local text index and reading position. */
export async function deleteLibraryItem(
  deps: { library: LibraryStore; index?: LibraryTextIndex; settings?: SettingsStore },
  kind: 'book' | 'clipping',
  id: string,
): Promise<void> {
  if (kind === 'book') await deps.library.deleteBook(id);
  else await deps.library.deleteClipping(id);
  await deps.index?.remove(id);
  if (deps.settings) await forgetReadingPosition(deps.settings, id);
}
