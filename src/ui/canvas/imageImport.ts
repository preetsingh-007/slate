/**
 * Image import (C8), adapted from Axiom's imageImport: camera photos and other large images
 * are downscaled to 2,560 px on the long edge before they are stored; GIFs (animation), SVGs,
 * small images and anything the browser cannot decode are kept byte for byte.
 */

/** Photos are stored at most this many pixels on their long edge. */
export const MAX_IMAGE_EDGE = 2560;
/** Images above this size are re-encoded even when their dimensions are small. */
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const PHOTO_QUALITY = 0.86;

export async function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = { w: bmp.width, h: bmp.height };
    bmp.close();
    return s;
  } catch {
    return svgSize(blob);
  }
}

/** SVGs cannot always become ImageBitmaps: read their size from an <img>. */
async function svgSize(blob: Blob): Promise<{ w: number; h: number }> {
  if (typeof Image === 'undefined') return { w: 0, h: 0 };
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return { w: 0, h: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Target size for an image that should be downscaled, or null to keep it as is. */
export function fitWithin(w: number, h: number, maxEdge = MAX_IMAGE_EDGE): { w: number; h: number } | null {
  if (!w || !h) return null;
  const k = maxEdge / Math.max(w, h);
  if (k >= 1) return null;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Shrinks camera photos and other large images before they are stored: a 12-megapixel photo
 * becomes ~2560 px on its long edge (JPEG). PNG screenshots stay PNG (they may be transparent).
 */
export async function prepareImage(blob: Blob): Promise<{ blob: Blob; w: number; h: number }> {
  const type = blob.type.toLowerCase();
  if (type === 'image/gif' || type === 'image/svg+xml') {
    const { w, h } = await imageSize(blob);
    return { blob, w, h };
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return { blob, w: 0, h: 0 };
  }
  const w = bmp.width;
  const h = bmp.height;
  const target = fitWithin(w, h) ?? (blob.size > MAX_IMAGE_BYTES ? { w, h } : null);
  if (!target) {
    bmp.close();
    return { blob, w, h };
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.w;
    canvas.height = target.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob, w, h };
    const keepPng = type === 'image/png';
    if (!keepPng) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, target.w, target.h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, target.w, target.h);
    const out = await canvasToBlob(canvas, keepPng ? 'image/png' : 'image/jpeg', keepPng ? undefined : PHOTO_QUALITY);
    // re-encoding must actually help; otherwise keep the original
    if (!out || (out.size >= blob.size && target.w === w)) return { blob, w, h };
    return { blob: out, w: target.w, h: target.h };
  } catch {
    return { blob, w, h };
  } finally {
    bmp.close();
  }
}

/** Alt text from a file name ("IMG_2041.jpeg" → "IMG_2041"); camera files get none. */
export function altFromName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  if (!base || /^image$/i.test(base)) return undefined;
  return base;
}
