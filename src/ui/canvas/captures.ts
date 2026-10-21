/**
 * Captures → clips (S3, C9): placed at a canvas point, or below the latest content, in order,
 * one under the other. Capture images are stored by hash (R7).
 */
import type { Capture } from '../../core/model/capture';
import type { ClipObject } from '../../core/model/types';
import { objectBounds } from '../../core/canvas/bounds';
import { makeClip } from '../../core/canvas/objects';
import { keyBetween } from '../../core/util/zindex';
import { uid } from '../../core/util/ids';
import type { ActionCtx } from './actions';
import { imageSize } from './imageImport';

export const CLIP_GAP = 16;

/** Clip width in canvas units for a capture image of `w` pixels (captured at about 2× screen). */
export function clipWidth(px: number | undefined): number {
  if (!px) return 480;
  return Math.round(Math.min(640, Math.max(160, px / 2)));
}

export async function insertCaptures(c: ActionCtx, captures: Capture[], at?: { x: number; y: number }): Promise<string[]> {
  if (!captures.length) return [];
  let x: number;
  let y: number;
  if (at) {
    x = at.x;
    y = at.y;
  } else {
    // below the latest content, aligned with the left of the most recent work
    const bottom = c.ctl.contentBottom();
    y = bottom === null ? 0 : bottom + 48;
    const recent = bottom === null ? [] : c.ctl.model.query({ x: -1e9, y: bottom - 600, w: 2e9, h: 600 });
    x = recent.length ? Math.min(...recent.map((o) => objectBounds(o).x)) : c.engine.view.x + 24;
  }
  const clips: ClipObject[] = [];
  let z = c.ctl.model.topZ();
  for (const cap of captures) {
    let asset: string | undefined;
    let natural = cap.imageSize;
    if (cap.image) {
      asset = await c.services.assets.put(cap.image);
      if (!natural?.w) natural = await imageSize(cap.image);
    }
    const w = clipWidth(natural?.w);
    const h = asset && natural?.w ? Math.round((w * natural.h) / natural.w) : Math.max(60, Math.round(cap.text.split('\n').length * 26 + 24));
    const clip = makeClip(
      { id: uid(), now: Date.now(), device: c.ctl.device, z },
      { x: Math.round(x), y: Math.round(y), w, h, text: cap.text, source: cap.source, display: asset ? 'image' : 'text', asset, mime: cap.image?.type || 'image/png', natural },
    );
    clips.push(clip);
    z = keyBetween(z, null);
    y += h + CLIP_GAP;
  }
  c.ctl.addObjects(clips);
  const first = clips[0];
  c.engine.revealRegion({ x: first.x, y: first.y, w: first.w, h: clips[clips.length - 1].y + clips[clips.length - 1].h - first.y });
  c.engine.select(clips.map((o) => o.id));
  return clips.map((o) => o.id);
}
