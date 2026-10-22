/**
 * Copy, cut and paste of canvas objects (C15, S9, S11).
 *
 * Within Slate, objects travel as JSON (a custom clipboard type, or an attribute in the HTML
 * flavour when only HTML survives); other apps receive a PNG of the selection plus Markdown:
 * text boxes as their Markdown, clips as quotes with their source. Pasted text becomes a text
 * box (Markdown when it looks like Markdown, escaped plain text otherwise).
 */
import type { CanvasObject, Rect } from '../model/types';
import { objectBounds } from './bounds';
import { objectsBounds } from './export';
import { translateObject } from './transform';

export const SLATE_MIME = 'application/x-slate+json';

export interface ClipboardPayload {
  v: 1;
  /** canvas the objects were copied from */
  canvas: string;
  objects: CanvasObject[];
}

export function makePayload(canvas: string, objects: readonly CanvasObject[]): ClipboardPayload {
  return { v: 1, canvas, objects: objects.map((o) => structuredClone(o)) };
}

export function parsePayload(json: string | null | undefined): ClipboardPayload | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as ClipboardPayload;
    if (p && p.v === 1 && Array.isArray(p.objects) && p.objects.every((o) => o && typeof o.id === 'string' && typeof o.kind === 'string')) return p;
  } catch {
    /* not ours */
  }
  return null;
}

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** HTML flavour: the payload in a data attribute, plus the Markdown as preformatted text and an optional image. */
export function payloadHtml(payload: ClipboardPayload, markdown: string, imageDataUrl?: string): string {
  const img = imageDataUrl ? `<img src="${escapeAttr(imageDataUrl)}" alt="">` : '';
  const text = markdown ? `<pre>${escapeAttr(markdown)}</pre>` : '';
  return `<div data-slate="${b64encode(JSON.stringify(payload))}">${img}${text}</div>`;
}

export function payloadFromHtml(html: string | null | undefined): ClipboardPayload | null {
  if (!html) return null;
  const m = /data-slate="([A-Za-z0-9+/=]+)"/.exec(html);
  if (!m) return null;
  try {
    return parsePayload(b64decode(m[1]));
  } catch {
    return null;
  }
}

export interface PasteContext {
  now: number;
  device: string;
  newId(): string;
  /** z keys above everything, in order */
  nextZ(): string;
}

/**
 * Copies of the payload's objects for pasting: new ids (references between them remapped,
 * references to objects left behind dropped), new groups, fresh times, z on top in the same
 * order, and moved so their bounds' top-left lands at `at` (or 24 units down and right).
 */
export function pasteObjects(objects: readonly CanvasObject[], at: { x: number; y: number } | null, ctx: PasteContext): CanvasObject[] {
  const bounds = objectsBounds(objects) ?? { x: 0, y: 0, w: 0, h: 0 };
  const dx = at ? at.x - bounds.x : 24;
  const dy = at ? at.y - bounds.y : 24;
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const o of objects) ids.set(o.id, ctx.newId());
  const map = (id: string | null | undefined) => (id ? ids.get(id) ?? null : null);
  const sorted = [...objects].sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
  return sorted.map((src) => {
    const o = { ...structuredClone(src), ...translateObject(src, dx, dy) } as CanvasObject;
    o.id = ids.get(src.id)!;
    o.z = ctx.nextZ();
    o.created = ctx.now;
    o.edited = ctx.now;
    o.device = ctx.device;
    if (src.group) {
      let g = groups.get(src.group);
      if (!g) groups.set(src.group, (g = ctx.newId()));
      o.group = g;
    }
    if (o.kind === 'stroke') {
      const att = map(o.attached);
      if (att) o.attached = att;
      else delete o.attached;
      const into = map(o.beautifiedInto);
      if (into) o.beautifiedInto = into;
      else delete o.beautifiedInto;
    }
    if (o.kind === 'shape') {
      o.originals = o.originals.map((id) => ids.get(id)).filter((id): id is string => !!id);
      if (o.connects) {
        const c: [string | null, string | null] = [map(o.connects[0]), map(o.connects[1])];
        if (c[0] || c[1]) o.connects = c;
        else delete o.connects;
      }
    }
    return o;
  });
}

/** Objects in reading order: top to bottom, then left to right (rows within 12 units). */
export function readingOrder<T extends CanvasObject>(objects: readonly T[]): T[] {
  const boxes = new Map(objects.map((o) => [o.id, objectBounds(o)]));
  return [...objects].sort((a, b) => {
    const ra = boxes.get(a.id)!;
    const rb = boxes.get(b.id)!;
    if (Math.abs(ra.y - rb.y) > 12) return ra.y - rb.y;
    return ra.x - rb.x;
  });
}

/** Markdown of a selection for other apps (S11): text boxes as Markdown, clips as quotes. */
export function selectionMarkdown(objects: readonly CanvasObject[]): string {
  const parts: string[] = [];
  for (const o of readingOrder(objects)) {
    if (o.kind === 'text' && o.content.trim()) parts.push(o.content.trim());
    else if (o.kind === 'clip') {
      const quote = o.text.trim() ? o.text.trim().split('\n').map((l) => (l ? `> ${l}` : '>')) : ['> [image]'];
      parts.push([...quote, '>', `> — ${o.source.title || 'source'}`].join('\n'));
    }
  }
  return parts.join('\n\n');
}

/**
 * Text of a canvas region captured as a clip (S2 for a canvas source): the Markdown of its text
 * boxes and the text of its clips, in reading order. Unlike `selectionMarkdown` clips are not
 * quoted: the new clip's own source link points back to this canvas.
 */
export function regionMarkdown(objects: readonly CanvasObject[]): string {
  const parts: string[] = [];
  for (const o of readingOrder(objects)) {
    if (o.kind === 'text' && o.content.trim()) parts.push(o.content.trim());
    else if (o.kind === 'clip' && o.text.trim()) parts.push(o.text.trim());
  }
  return parts.join('\n\n');
}

const MD_PATTERNS = [
  /^#{1,6}\s+\S/m,
  /^\s*(?:[-*+]|\d+[.)])\s+\S/m,
  /^\s*>\s?\S/m,
  /^\s*(```|~~~)/m,
  /\*\*[^*\n]+\*\*/,
  /(^|\s)_[^_\n]+_(\s|$)/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /`[^`\n]+`/,
  /\$\$[\s\S]+?\$\$/,
  /\$[^$\s][^$\n]*\$/,
  /^\s*\|.*\|\s*$/m,
];

/** Heuristic: does pasted text use Markdown syntax? (S9) */
export function looksLikeMarkdown(text: string): boolean {
  return MD_PATTERNS.some((re) => re.test(text));
}

/** Escapes plain text so it renders literally as Markdown. */
export function plainToMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/([\\`*_[\]<>$|])/g, '\\$1')
        .replace(/^(\s*)([#+-])/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])/, '$1\\$2'),
    )
    .join('\n');
}

/** Pasted text → text-box content (S9). */
export function pastedTextContent(text: string): string {
  const t = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return looksLikeMarkdown(t) ? t : plainToMarkdown(t);
}

/** The URL when the text is a single http(s) link, else null. */
export function extractUrl(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    return new URL(t).href;
  } catch {
    return null;
  }
}

/** Bounds of a pasted payload, for placing it. */
export function payloadBounds(p: ClipboardPayload): Rect | null {
  return objectsBounds(p.objects);
}
