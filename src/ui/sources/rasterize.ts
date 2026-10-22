/**
 * Image of a region of rendered HTML (S2), for captures from clippings, EPUB chapters and gym
 * files. The region's DOM is cloned with computed styles into an SVG foreignObject and drawn
 * to a canvas. Browsers that taint canvases drawn from foreignObject (some Safari versions)
 * make this return null; callers then make a text-only capture.
 */

const STYLE_PROPS = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'white-space',
  'vertical-align',
  'display',
  'margin',
  'padding',
  'border',
  'border-radius',
  'list-style',
  'width',
  'height',
  'max-width',
  'box-sizing',
  'position',
  'top',
  'left',
  'transform',
  'opacity',
];

async function toDataUrl(src: string): Promise<string | null> {
  // network use NFR: only local images (blob:, data:, the app's own files) are read
  if (!/^(blob|data):/i.test(src) && new URL(src, location.href).origin !== location.origin) return null;
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function cloneWithStyles(el: Element): Promise<Element> {
  const clone = el.cloneNode(false) as Element;
  if (el instanceof HTMLElement || el instanceof SVGElement) {
    const cs = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    clone.setAttribute('style', style);
  }
  if (el instanceof HTMLImageElement && el.currentSrc) {
    const data = await toDataUrl(el.currentSrc);
    if (data) (clone as HTMLImageElement).src = data;
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName;
      if (tag === 'SCRIPT' || tag === 'IFRAME') continue;
      // KaTeX's MathML copy is hidden with `clip`, which the clone does not carry: skip it
      if ((child as Element).classList.contains('katex-mathml')) continue;
      clone.appendChild(await cloneWithStyles(child as Element));
    } else if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode());
  }
  return clone;
}

/**
 * Renders the part of `container` under the client rectangle `rect` at `scale` × device
 * pixels. Returns a PNG blob, or null when the browser refuses.
 */
export async function rasterizeRegion(container: HTMLElement, rect: DOMRect, scale = 2): Promise<{ blob: Blob; w: number; h: number } | null> {
  const box = container.getBoundingClientRect();
  const width = container.scrollWidth;
  const height = container.scrollHeight;
  const clone = await cloneWithStyles(container);
  (clone as HTMLElement).setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const xml = new XMLSerializer().serializeToString(clone);
  const ox = rect.left - box.left + container.scrollLeft;
  const oy = rect.top - box.top + container.scrollTop;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}" viewBox="${ox} ${oy} ${rect.width} ${rect.height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xml}</foreignObject></svg>`;
  // a data: URL, not a blob: URL: Chromium taints a canvas drawn from a blob-URL SVG that
  // contains a foreignObject, so toBlob would always fail there
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(container).backgroundColor || '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/png');
      } catch {
        resolve(null);
      }
    });
    return blob ? { blob, w: rect.width, h: rect.height } : null;
  } catch {
    return null;
  }
}
