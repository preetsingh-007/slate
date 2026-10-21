/**
 * Rasteriser for tests (G5): Vitest has no canvas, so mark PNGs are white images of the
 * requested size, with a dark band whose width reflects how much the SVG draws, encoded with
 * pngjs. The browser uses the real rasteriser (rasterBrowser.ts).
 */
import { PNG } from 'pngjs';
import type { Rasterizer } from '../derived/marks';

export const stubRasterizer: Rasterizer = async (svg, width, height) => {
  const png = new PNG({ width, height });
  const ink = Math.min(width, (svg.match(/<(path|image|text|rect|ellipse|circle)\b/g)?.length ?? 0) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dark = y < 2 && x < ink;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = dark ? 32 : 255;
      png.data[i + 3] = 255;
    }
  }
  return new Uint8Array(PNG.sync.write(png));
};

/** Decodes PNG bytes (pngjs needs a Node Buffer). */
export function decodePng(bytes: Uint8Array): { width: number; height: number } {
  const B = (globalThis as unknown as { Buffer: { from(b: Uint8Array): Uint8Array } }).Buffer;
  return PNG.sync.read(B.from(bytes));
}
