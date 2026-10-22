/**
 * A second canvas as a lasso source (S1, S2, S5): the selection on a canvas shown in the side
 * pane becomes a capture for the main canvas. Its image is the selected region rendered from
 * the canvas objects (everything drawn there, at twice the 100% zoom resolution), its text the
 * Markdown of the selected text boxes and clip texts, and its source link points back to the
 * region on this canvas (S6 reveals and flashes it).
 */
import type { Capture } from '../../core/model/capture';
import type { CanvasObject, Rect, SourceLink } from '../../core/model/types';
import { objectBounds, rectsIntersect } from '../../core/canvas/bounds';
import { regionMarkdown } from '../../core/canvas/clipboard';
import { uid } from '../../core/util/ids';
import type { ActionCtx } from './actions';
import { exportPng } from './io';

/** Margin around the selection, in canvas units, so ink at its edge is not cut. */
const MARGIN = 8;

/** Captures the current selection's region; null when nothing is selected. */
export async function captureSelection(c: ActionCtx, now = Date.now()): Promise<Capture | null> {
  const ids = c.engine.getSelection();
  const box = c.engine.getSelectionBounds();
  if (!ids.length || !box) return null;
  const region: Rect = { x: Math.floor(box.x - MARGIN), y: Math.floor(box.y - MARGIN), w: Math.ceil(box.w + 2 * MARGIN), h: Math.ceil(box.h + 2 * MARGIN) };
  const selected = c.ctl.objectsOf(ids);
  // the image shows the region as drawn, including objects that only reach into it
  const drawn = c.ctl.model.query(region).filter((o: CanvasObject) => !(o.kind === 'stroke' && o.beautifiedInto) && rectsIntersect(objectBounds(o), region));
  const image = await exportPng(c.services, drawn, 2, region);
  const title = c.services.canvases.meta(c.slug)?.title ?? c.slug;
  const source: SourceLink = { type: 'canvas', id: c.slug, title, locator: { type: 'canvas', canvas: c.slug, region }, capturedAt: now, contentHash: '' };
  const capture: Capture = { id: uid(), text: regionMarkdown(selected), source, created: now };
  if (image) {
    capture.image = image;
    capture.imageSize = { w: region.w * 2, h: region.h * 2 };
  }
  return capture;
}
