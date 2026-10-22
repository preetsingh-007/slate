/**
 * Actions on a selection (C15, C16) and on the canvas (paste, insert). Each is one undo step.
 */
import type { CanvasObject, ClipDisplay, ShapeObject, StrokeObject } from '../../core/model/types';
import type { Services } from '../../app/services';
import type { CanvasEngine } from './engine/engine';
import type { CanvasController } from './controller';
import { objectBounds, rectsIntersect } from '../../core/canvas/bounds';
import { beautifyShapes, type ConnectorEnd } from '../../core/ink/beautify';
import { makeImage, makeShape, makeText, fitImage } from '../../core/canvas/objects';
import { extractUrl, parsePayload, pastedTextContent, pasteObjects, payloadFromHtml, SLATE_MIME, type ClipboardPayload } from '../../core/canvas/clipboard';
import { keyBetween } from '../../core/util/zindex';
import { uid } from '../../core/util/ids';
import { handleLink, importFiles } from '../common/registries';
import { toast } from '../common/toast';
import { copyObjects, download, exportPng, exportSvg, internalClipboard } from './io';
import { altFromName, prepareImage } from './imageImport';

export interface ActionCtx {
  engine: CanvasEngine;
  ctl: CanvasController;
  services: Services;
  slug: string;
}

const selected = (c: ActionCtx) => c.ctl.objectsOf(c.engine.getSelection());

export function deleteSelection(c: ActionCtx) {
  const ids = c.engine.getSelection();
  if (!ids.length) return;
  c.engine.clearSelection();
  c.ctl.remove(ids);
}

/** Copies of the selection 24 units down and right (with the strokes on selected images). */
export function duplicateSelection(c: ActionCtx) {
  const objs = withDependents(c, selected(c));
  if (!objs.length) return;
  const copies = place(c, objs, null);
  c.ctl.addObjects(copies);
  c.engine.select(copies.filter((o) => !(o.kind === 'stroke' && o.attached && copies.some((x) => x.id === o.attached))).map((o) => o.id));
}

function withDependents(c: ActionCtx, objs: CanvasObject[]): CanvasObject[] {
  const ids = new Set(objs.map((o) => o.id));
  const out = [...objs];
  for (const o of objs) {
    if (o.kind === 'image') for (const s of c.ctl.attachedTo(o.id)) if (!ids.has(s.id)) (ids.add(s.id), out.push(s));
    if (o.kind === 'shape') for (const id of o.originals) if (!ids.has(id)) {
      const s = c.ctl.get(id);
      if (s) (ids.add(id), out.push(s));
    }
  }
  return out;
}

function place(c: ActionCtx, objs: readonly CanvasObject[], at: { x: number; y: number } | null): CanvasObject[] {
  let z = c.ctl.model.topZ();
  let first = true;
  return pasteObjects(objs, at, {
    now: Date.now(),
    device: c.ctl.device,
    newId: () => uid(),
    nextZ: () => {
      if (!first) z = keyBetween(z, null);
      first = false;
      return z;
    },
  });
}

export function recolorSelection(c: ActionCtx, color: string) {
  const patches = selected(c)
    .filter((o) => o.kind === 'stroke' || o.kind === 'shape')
    .map((o) => [o.id, { color }] as [string, Record<string, unknown>]);
  c.ctl.update(patches);
}

export function setLineWidth(c: ActionCtx, lineWidth: number) {
  c.ctl.update(selected(c).filter((o) => o.kind === 'shape').map((o) => [o.id, { lineWidth }] as [string, Record<string, unknown>]));
}

export function groupSelection(c: ActionCtx) {
  const ids = c.engine.getSelection();
  if (ids.length < 2) return;
  const g = uid();
  c.ctl.update(ids.map((id) => [id, { group: g }] as [string, Record<string, unknown>]));
}

export function ungroupSelection(c: ActionCtx) {
  c.ctl.update(
    selected(c)
      .filter((o) => o.group)
      .map((o) => [o.id, { group: undefined }] as [string, Record<string, unknown>]),
  );
}

/**
 * Bring forward / send back one step: above (below) the nearest object that overlaps the
 * selection, keeping the selection's own order.
 */
export function restack(c: ActionCtx, dir: 1 | -1) {
  const sel = selected(c).sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : 0));
  if (!sel.length) return;
  const ids = new Set(sel.map((o) => o.id));
  const box = c.engine.getSelectionBounds();
  if (!box) return;
  const others = c.ctl.model.query(box).filter((o) => !ids.has(o.id));
  const all = [...c.ctl.model.objects()].filter((o) => !ids.has(o.id)).map((o) => o.z).sort();
  let lo: string | null;
  let hi: string | null;
  if (dir > 0) {
    const top = sel[sel.length - 1].z;
    const above = others.filter((o) => o.z > top && rectsIntersect(objectBounds(o), box)).map((o) => o.z).sort();
    if (!above.length) return;
    lo = above[0];
    hi = all.find((z) => z > lo!) ?? null;
  } else {
    const bottom = sel[0].z;
    const below = others.filter((o) => o.z < bottom && rectsIntersect(objectBounds(o), box)).map((o) => o.z).sort();
    if (!below.length) return;
    hi = below[below.length - 1];
    lo = [...all].reverse().find((z) => z < hi!) ?? null;
  }
  const patches: [string, Record<string, unknown>][] = [];
  let prev = lo;
  for (const o of sel) {
    const z = keyBetween(prev, hi);
    patches.push([o.id, { z }]);
    prev = z;
  }
  c.ctl.update(patches);
}

export function setClipDisplay(c: ActionCtx, display: ClipDisplay) {
  c.ctl.update(selected(c).filter((o) => o.kind === 'clip').map((o) => [o.id, { display }] as [string, Record<string, unknown>]));
}

// ---------------------------------------------------------------- Beautify (C16)

export function beautifySelection(c: ActionCtx): number {
  const strokes = selected(c).filter((o): o is StrokeObject => o.kind === 'stroke' && !o.beautifiedInto);
  if (!strokes.length) return 0;
  const box = c.engine.getSelectionBounds()!;
  const near = c.ctl.model.query({ x: box.x - 200, y: box.y - 200, w: box.w + 400, h: box.h + 400 });
  const selectedIds = new Set(c.engine.getSelection());
  const existing = near.filter((o): o is ShapeObject => o.kind === 'shape' && !selectedIds.has(o.id)).map((o) => ({ id: o.id, geometry: o.geometry }));
  const res = beautifyShapes(strokes, { existing });
  if (!res.shapes.length) {
    toast('No shapes recognised in the selection.');
    return 0;
  }
  const now = Date.now();
  const ids = res.shapes.map(() => uid());
  const ref = (e: ConnectorEnd): string | null => (e === null ? null : typeof e === 'number' ? ids[e] : e);
  let z = c.ctl.model.topZ();
  const shapes = res.shapes.map((s, i) => {
    const o = makeShape(
      { id: ids[i], now, device: c.ctl.device, z },
      { geometry: s.geometry, color: s.color, lineWidth: s.lineWidth, originals: s.strokeIds, connects: s.connects ? [ref(s.connects[0]), ref(s.connects[1])] : undefined },
    );
    z = keyBetween(z, null);
    return o;
  });
  c.ctl.addObjects(shapes, (tx) => {
    shapes.forEach((s) => {
      for (const id of s.originals) tx.update(id, { beautifiedInto: s.id });
    });
  });
  c.engine.select([...ids, ...res.leftover]);
  return shapes.length;
}

/** Restores the strokes a beautified shape replaced (one tap, C16). */
export function restoreSelection(c: ActionCtx) {
  const shapes = selected(c).filter((o): o is ShapeObject => o.kind === 'shape' && o.originals.length > 0);
  if (!shapes.length) return;
  const originals: string[] = [];
  c.ctl.model.transact((tx) => {
    for (const s of shapes) {
      tx.remove(s.id);
      for (const id of s.originals) {
        if (!c.ctl.model.has(id)) continue;
        tx.update(id, { beautifiedInto: undefined });
        originals.push(id);
      }
    }
  });
  c.engine.select(originals);
}

// ---------------------------------------------------------------- copy, paste, export

export async function copySelection(c: ActionCtx, cut = false) {
  const objs = withDependents(c, selected(c));
  if (!objs.length) return;
  const res = await copyObjects(c.services, c.slug, objs);
  if (cut) deleteSelection(c);
  toast(res === 'image' ? (cut ? 'Cut' : 'Copied') + ' as image and text' : res === 'text' ? (cut ? 'Cut' : 'Copied') : 'Copied within Slate');
}

/** Where pasted or dropped content goes: the last pointer position in view, else the view's centre. */
export function pastePoint(c: ActionCtx): { x: number; y: number } {
  const v = c.engine.view;
  const p = c.engine.lastPoint;
  if (p && p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h) return p;
  return { x: v.x + v.w / 2 - 100, y: v.y + v.h / 2 - 50 };
}

export function pastePayload(c: ActionCtx, payload: ClipboardPayload, at: { x: number; y: number } | null) {
  const objs = place(c, payload.objects, at ?? pastePoint(c));
  c.ctl.addObjects(objs);
  c.engine.select(objs.filter((o) => !(o.kind === 'stroke' && o.attached)).map((o) => o.id));
}

/** Pastes from a paste or drop event's data (S9, S10). Returns true when something was pasted. */
export async function pasteData(c: ActionCtx, data: DataTransfer, at: { x: number; y: number } | null): Promise<boolean> {
  const own = parsePayload(safeGet(data, SLATE_MIME)) ?? payloadFromHtml(safeGet(data, 'text/html'));
  const text = safeGet(data, 'text/plain');
  if (own) {
    pastePayload(c, own, at);
    return true;
  }
  const internal = internalClipboard();
  if (internal && text && text === (internal.markdown || ' ')) {
    pastePayload(c, internal.payload, at);
    return true;
  }
  const files = [...(data.files ?? [])];
  const images = files.filter((f) => f.type.startsWith('image/'));
  const books = files.filter((f) => /\.(pdf|epub)$/i.test(f.name) || f.type === 'application/pdf' || f.type === 'application/epub+zip');
  if (books.length) {
    if (!(await importFiles(books))) toast('Books can be imported once the library is available.');
  }
  if (images.length) {
    await insertImages(c, images, at);
    return true;
  }
  if (books.length) return true;
  const uri = safeGet(data, 'text/uri-list')?.split('\n').find((l) => l && !l.startsWith('#'));
  const url = extractUrl(uri ?? text ?? '');
  if (url) {
    if (!handleLink(url)) insertText(c, `[${url}](${url})`, at);
    return true;
  }
  if (text && text.trim()) {
    insertText(c, pastedTextContent(text), at);
    return true;
  }
  return false;
}

function safeGet(d: DataTransfer, type: string): string | null {
  try {
    const v = d.getData(type);
    return v || null;
  } catch {
    return null;
  }
}

/** Paste from the toolbar or menu: the async Clipboard API, else Slate's own clipboard. */
export async function pasteFromClipboard(c: ActionCtx) {
  const at = pastePoint(c);
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : null;
        const own = payloadFromHtml(html);
        if (own) return pastePayload(c, own, at);
        const plain = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : null;
        const internal = internalClipboard();
        if (internal && plain && plain === (internal.markdown || ' ')) return pastePayload(c, internal.payload, at);
        const img = item.types.find((t) => t.startsWith('image/'));
        if (img) return void (await insertImages(c, [await item.getType(img)], at));
        if (plain) {
          const url = extractUrl(plain);
          if (url && handleLink(url)) return;
          return insertText(c, url ? `[${url}](${url})` : pastedTextContent(plain), at);
        }
      }
    }
  } catch {
    /* permission refused: fall back to Slate's clipboard */
  }
  const internal = internalClipboard();
  if (internal) pastePayload(c, internal.payload, at);
  else toast('Nothing to paste. Use ⌘V or the Edit menu to paste from other apps.');
}

export function insertText(c: ActionCtx, content: string, at: { x: number; y: number } | null) {
  const p = at ?? pastePoint(c);
  const t = makeText({ id: uid(), now: Date.now(), device: c.ctl.device, z: c.ctl.model.topZ() }, { x: Math.round(p.x), y: Math.round(p.y), content, w: Math.min(560, Math.max(240, content.length * 4)) });
  c.ctl.addObjects([t]);
  c.engine.select([t.id]);
}

/** Stores images (downscaled, C8) and places them at a point or the view's centre, side by side. */
export async function insertImages(c: ActionCtx, files: Blob[], at: { x: number; y: number } | null) {
  const p = at ?? pastePoint(c);
  const objs: CanvasObject[] = [];
  let x = p.x;
  let z = c.ctl.model.topZ();
  for (const f of files) {
    try {
      const prepared = await prepareImage(f);
      const hash = await c.services.assets.put(prepared.blob);
      const natural = { w: prepared.w || 800, h: prepared.h || 600 };
      const size = fitImage(natural, Math.min(640, c.engine.view.w * 0.8), Math.min(640, c.engine.view.h * 0.8));
      objs.push(
        makeImage(
          { id: uid(), now: Date.now(), device: c.ctl.device, z },
          { asset: hash, mime: prepared.blob.type || f.type || 'image/png', natural, x: Math.round(x), y: Math.round(p.y), w: size.w, h: size.h, alt: altFromName((f as File).name) },
        ),
      );
      z = keyBetween(z, null);
      x += size.w + 16;
    } catch (err) {
      toast(`Could not add the image: ${(err as Error).message}`);
    }
  }
  if (!objs.length) return;
  c.ctl.addObjects(objs);
  c.engine.select(objs.map((o) => o.id));
}

export async function exportSelection(c: ActionCtx, kind: 'png' | 'svg') {
  const objs = withDependents(c, selected(c));
  if (!objs.length) return;
  const name = `${c.slug}-${new Date().toISOString().slice(0, 10)}`;
  if (kind === 'svg') download(new Blob([await exportSvg(c.services, objs)], { type: 'image/svg+xml' }), `${name}.svg`);
  else {
    const png = await exportPng(c.services, objs);
    if (png) download(png, `${name}.png`);
    else toast('Could not render the image.');
  }
}

export function tagObjects(c: ActionCtx, ids: string[], topics: string[]) {
  c.ctl.update(ids.map((id) => [id, { topics }] as [string, Record<string, unknown>]));
}
