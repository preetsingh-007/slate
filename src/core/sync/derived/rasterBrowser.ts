/**
 * Mark PNGs in the browser (G5): the mark's SVG, with its images already inlined as data: URIs,
 * is decoded as an image and drawn onto a canvas at the requested size, then encoded as PNG.
 * SVG drawn this way loads no external resources and does not taint the canvas.
 */
import type { Rasterizer } from './marks';

export const browserRasterizer: Rasterizer = async (svg, width, height) => {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the browser could not encode the PNG');
    // release the canvas memory right away (iPad Safari keeps it otherwise)
    canvas.width = canvas.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
};
