/** Factories for canvas objects and marks in sync tests (not used by the app). */
import type { ClipObject, ImageObject, Mark, MarkKind, ShapeObject, SourceLink, StrokeObject, TextObject } from '../../model/types';

const base = (id: string, created: number, x: number, y: number, w: number, h: number) => ({
  id,
  x,
  y,
  w,
  h,
  rotation: 0,
  z: 'i',
  created,
  edited: created,
  device: 'test',
  topics: [] as string[],
});

export function stroke(id: string, created: number, x = 0, y = 0, color = 'currentInk'): StrokeObject {
  return { ...base(id, created, x, y, 40, 20), kind: 'stroke', pts: [x, y, 0.5, x + 20, y + 10, 0.6, x + 40, y + 20, 0.5], tool: 'pen', color, size: 2.5 };
}

export function text(id: string, created: number, content: string, x = 0, y = 0): TextObject {
  return { ...base(id, created, x, y, 300, 60), kind: 'text', content, fontSize: 18 };
}

export function image(id: string, created: number, asset: string, x = 0, y = 0, mime = 'image/png'): ImageObject {
  return { ...base(id, created, x, y, 200, 100), kind: 'image', asset, mime, natural: { w: 400, h: 200 }, alt: 'Board photo' };
}

export function clip(id: string, created: number, source: SourceLink, textMd: string, x = 0, y = 0, asset?: string): ClipObject {
  return { ...base(id, created, x, y, 300, 120), kind: 'clip', text: textMd, display: asset ? 'both' : 'text', source, ...(asset ? { asset, mime: 'image/png', natural: { w: 600, h: 240 } } : {}) };
}

export function shape(id: string, created: number, x = 0, y = 0): ShapeObject {
  return {
    ...base(id, created, x, y, 100, 60),
    kind: 'shape',
    shape: 'rectangle',
    geometry: { kind: 'rectangle', cx: x + 50, cy: y + 30, w: 100, h: 60, rotation: 0 },
    color: '#2f6fde',
    lineWidth: 2,
    originals: [],
  };
}

export function mark(id: string, created: number, kind: MarkKind, objects: string[], region = { x: -10, y: -10, w: 420, h: 220 }, extra: Partial<Mark> = {}): Mark {
  return { id, objects, region, kind, topic: '', problem: '', comment: '', created, ...extra };
}

export function bookSource(bookId: string, title: string, page: number): SourceLink {
  return { type: 'book', id: bookId, title, locator: { type: 'pdf', page, region: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, quote: 'quoted' }, capturedAt: 0, contentHash: 'h' };
}

export function clippingSource(clippingId: string, title: string): SourceLink {
  return { type: 'clipping', id: clippingId, title, locator: { type: 'clipping', quote: { exact: 'x', prefix: '', suffix: '' }, offset: 0 }, capturedAt: 0, contentHash: 'h' };
}

/** A tiny valid PNG (1×1, red). */
export const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
