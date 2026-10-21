/**
 * Getting objects out of the canvas (C15, S11): SVG and PNG export with images inlined as data
 * URIs, and copying to other apps as PNG plus Markdown through the async Clipboard API, with
 * a fallback to the copy event (text only) where the API or image types are unavailable.
 */
import type { CanvasObject, Rect } from '../../core/model/types';
import type { Services } from '../../app/services';
import { objectsBounds, objectsToSvg } from '../../core/canvas/export';
import { makePayload, payloadHtml, selectionMarkdown, SLATE_MIME, type ClipboardPayload } from '../../core/canvas/clipboard';

/** Ink colour used in exports (they are read on white). */
export const EXPORT_INK = '#1f2328';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function assetUrls(services: Services, objects: readonly CanvasObject[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const o of objects) {
    const hash = o.kind === 'image' ? o.asset : o.kind === 'clip' ? o.asset : undefined;
    if (!hash || out.has(hash)) continue;
    const blob = await services.assets.get(hash);
    if (blob) out.set(hash, await blobToDataUrl(blob));
  }
  return out;
}

export async function exportSvg(services: Services, objects: readonly CanvasObject[], background?: string, region?: Rect): Promise<string> {
  const urls = await assetUrls(services, objects);
  return objectsToSvg(objects, { assetHref: (hash) => urls.get(hash) ?? '', inkColor: EXPORT_INK, background, padding: region ? 0 : 16, region });
}

/**
 * Rasterises objects to PNG at `scale` × the 100% size (2 = twice the 100% zoom resolution):
 * their bounds plus a margin, or exactly `region` (objects reaching out of it are cut).
 */
export async function exportPng(services: Services, objects: readonly CanvasObject[], scale = 2, region?: Rect): Promise<Blob | null> {
  const b = region ?? objectsBounds(objects);
  if (!b) return null;
  const svg = await exportSvg(services, objects, '#ffffff', region);
  const w = b.w + (region ? 0 : 32);
  const h = b.h + (region ? 0 : 32);
  const k = Math.min(scale, 8192 / w, 8192 / h);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob | null>((resolve) => c.toBlob((x) => resolve(x), 'image/png'));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------------------------------------------------------------- clipboard

/** The last copied objects: pasting within Slate does not depend on what other apps keep. */
let internal: { payload: ClipboardPayload; markdown: string } | null = null;

export function internalClipboard() {
  return internal;
}

/** Text written by the copy-event fallback. */
let pendingCopy: { payload: ClipboardPayload; markdown: string } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('copy', (e) => {
    if (!pendingCopy || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', pendingCopy.markdown || ' ');
    e.clipboardData.setData('text/html', payloadHtml(pendingCopy.payload, pendingCopy.markdown));
    try {
      e.clipboardData.setData(SLATE_MIME, JSON.stringify(pendingCopy.payload));
    } catch {
      /* custom types refused */
    }
    e.preventDefault();
    pendingCopy = null;
  });
}

/**
 * Copies objects: to Slate's own clipboard, and to the system clipboard as PNG plus Markdown
 * (S11). Must be called from a user gesture. Returns 'image' when the PNG made it, 'text' when
 * only text did, 'internal' when only Slate can paste it.
 */
export async function copyObjects(services: Services, canvas: string, objects: readonly CanvasObject[]): Promise<'image' | 'text' | 'internal'> {
  const payload = makePayload(canvas, objects);
  const markdown = selectionMarkdown(objects);
  internal = { payload, markdown };
  const html = payloadHtml(payload, markdown);
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      // Safari needs the item created synchronously with a promise for the slow part
      const png = exportPng(services, objects).then((b) => b ?? new Blob([], { type: 'image/png' }));
      const items: Record<string, Blob | Promise<Blob>> = {
        'text/plain': new Blob([markdown || ' '], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      };
      const withImage = { ...items, 'image/png': png };
      try {
        await navigator.clipboard.write([new ClipboardItem(withImage)]);
        return 'image';
      } catch {
        await navigator.clipboard.write([new ClipboardItem(items)]);
        return 'text';
      }
    }
  } catch {
    /* fall through to the copy event */
  }
  pendingCopy = { payload, markdown };
  try {
    if (document.execCommand('copy')) return 'text';
  } catch {
    /* ignore */
  }
  pendingCopy = null;
  return 'internal';
}

/** Fills a copy event's data (keyboard copy, where the event is already in hand). */
export function fillCopyEvent(e: ClipboardEvent, canvas: string, objects: readonly CanvasObject[]) {
  const payload = makePayload(canvas, objects);
  const markdown = selectionMarkdown(objects);
  internal = { payload, markdown };
  if (!e.clipboardData) return;
  e.clipboardData.setData('text/plain', markdown || ' ');
  e.clipboardData.setData('text/html', payloadHtml(payload, markdown));
  try {
    e.clipboardData.setData(SLATE_MIME, JSON.stringify(payload));
  } catch {
    /* custom types refused */
  }
  e.preventDefault();
}

/** A PNG data URL of objects, prepared ahead of a drag-out (dragstart must be synchronous). */
export async function pngDataUrl(services: Services, objects: readonly CanvasObject[]): Promise<string | null> {
  const blob = await exportPng(services, objects, 1);
  return blob ? blobToDataUrl(blob) : null;
}
