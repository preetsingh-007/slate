/**
 * Durability NFR: on start, work left behind as drafts (ui/common/drafts.ts) by a tab that was
 * closed, crashed or killed before it reached IndexedDB becomes the real thing: a stroke a
 * committed stroke on its canvas, PDF ink an ink annotation, a margin note its note annotation,
 * a to-do a checklist item. Each draft is cleared once its result is on disk.
 *
 * Recovery is idempotent, so a draft whose work did reach the disk (the write just won the race
 * at page close) changes nothing: strokes and annotations keep the id they were drawn or typed
 * with, and a to-do draft is marked committed before its item is added. Only the tab that runs
 * the app (app/tabLock.ts) recovers, once, at start (main.tsx), so nothing waits for a view the
 * owner may not reopen.
 */
import type { Services } from '../../app/services';
import { imageUnder } from '../../core/canvas/hit';
import { makeStroke } from '../../core/canvas/objects';
import { annotationsMap, putAnnotation } from '../../core/library/annotations';
import { addItem, parseChecklist } from '../../core/stores/checklist';
import { TODO_DOC_ID, annotationsDocId, segmentDocId } from '../../core/stores/docIds';
import { checklistText } from '../../core/stores/todo';
import { isoMonth } from '../../core/util/time';
import { CanvasController } from '../canvas/controller';
import { listDrafts, removeDraft, settleDraft, writeDraft, type AnnotationDraft, type Draft, type StrokeDraft, type TodoDraft } from './drafts';

/** Recovers every draft in storage. Returns how many changed the store. */
export async function recoverDrafts(services: Services, now: () => number = Date.now): Promise<number> {
  let n = 0;
  for (const { key, raw, draft } of listDrafts()) {
    // a draft this version cannot read is kept for one that can
    if (!draft) continue;
    try {
      if (await recoverDraft(services, key, raw, draft, now)) n++;
    } catch (err) {
      // kept, and tried again on the next start
      console.warn(`Slate could not recover ${key}`, err);
    }
  }
  return n;
}

function recoverDraft(services: Services, key: string, raw: string, d: Draft, now: () => number): Promise<boolean> {
  switch (d.kind) {
    case 'stroke':
      return recoverStroke(services, key, d, now);
    case 'ink':
    case 'note':
      return recoverAnnotation(services, key, raw, d);
    case 'todo':
      return recoverTodo(services, key, raw, d);
  }
}

async function recoverStroke(services: Services, key: string, d: StrokeDraft, now: () => number): Promise<boolean> {
  // a canvas this device does not know (yet): keep the draft
  if (!services.canvases.meta(d.canvas)) return false;
  const month = isoMonth(d.created);
  // the controller adds the day's line as drawing does (C19); its "now" is when it was drawn
  const ctl = new CanvasController(services, d.canvas, () => d.created);
  const model = ctl.model;
  let added = false;
  try {
    // the stroke's month (where it lives) and the current one, so it goes on top of both
    await model.load(new Set([month, isoMonth(now())]));
    if (!model.get(d.id)) {
      let pts = d.pts.slice(0, d.pts.length - (d.pts.length % 3));
      if (!pts.length) {
        removeDraft(key);
        return false;
      }
      if (pts.length === 3) pts = [...pts, Math.round((pts[0] + 0.1) * 10) / 10, pts[1], pts[2]]; // a tap leaves a dot
      const stroke = makeStroke(
        { id: d.id, now: d.created, device: services.device, z: model.topZ() },
        { pts, tool: d.tool, color: d.color, size: d.size, attached: imageUnder((r) => model.query(r), pts) },
      );
      ctl.addObjects([stroke]);
      added = true;
    }
  } finally {
    ctl.dispose();
  }
  settleDraft(services.docs, key, segmentDocId(d.canvas, month), () => model.isLoaded(month) && !model.hasQueued());
  return added;
}

async function recoverAnnotation(services: Services, key: string, raw: string, d: AnnotationDraft): Promise<boolean> {
  const { library, docs } = services;
  if (!library.book(d.item) && !library.clipping(d.item)) {
    // deleted on purpose: the draft goes with it; otherwise the item may still arrive by sync
    if (library.tombstones().some((t) => t.id === d.item)) removeDraft(key, raw);
    return false;
  }
  const docId = annotationsDocId(d.item);
  const doc = await docs.open(docId);
  const have = annotationsMap(doc).get(d.annotation.id);
  let changed = false;
  if (!have) {
    putAnnotation(doc, d.annotation);
    changed = true;
  } else if (d.kind === 'note' && have.text !== d.annotation.text) {
    putAnnotation(doc, { ...have, text: d.annotation.text });
    changed = true;
  }
  settleDraft(docs, key, docId);
  return changed;
}

async function recoverTodo(services: Services, key: string, raw: string, d: TodoDraft): Promise<boolean> {
  const text = d.text.trim().replace(/\s*\n\s*/g, ' ');
  if (!text) {
    removeDraft(key, raw);
    return false;
  }
  const doc = await services.docs.open(TODO_DOC_ID);
  const t = checklistText(doc);
  // a committed to-do may have reached the disk before the tab went away
  const present = d.committed && parseChecklist(t.toString()).some((i) => i.text.trim() === text);
  if (!present) {
    // marked first, so a crash before this write lands cannot add it twice
    writeDraft(key, { kind: 'todo', text, committed: true, created: d.created });
    addItem(t, text);
  }
  settleDraft(services.docs, key, TODO_DOC_ID);
  return !present;
}
