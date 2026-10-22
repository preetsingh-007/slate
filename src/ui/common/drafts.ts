/**
 * Durability NFR: drafts of work still held by the UI. A stroke whose pen has not lifted, PDF
 * ink being drawn, a margin note or a to-do being typed live only in memory until they are
 * committed, and writes started when the page goes away (pagehide) may never reach IndexedDB:
 * a closed tab, a crashed browser or a suspended iPad PWA gives the page no time for async
 * work. So the UI keeps a small copy of such work in localStorage, written synchronously while
 * the work goes on (strokes on every pointer event while short, then about every 150 ms; text
 * on every change) and once more at page
 * hide, and clears it only when the committed work is in IndexedDB (`settleDraft`). On the next
 * start the app turns each draft left behind into the real thing (`recoverDrafts.ts`).
 *
 * Keys are `slate-draft:<kind>:<scope>` (scope: the object's id, so a committed stroke waiting
 * for its write and the next stroke have a draft each). Values are small JSON with a version:
 * a draft that does not parse, or has an unknown version, is left alone, never deleted.
 */
import type { Annotation, StrokeTool } from '../../core/model/types';

export const DRAFT_PREFIX = 'slate-draft:';
export const DRAFT_VERSION = 1;

export type DraftKind = 'stroke' | 'ink' | 'note' | 'todo';

/** A canvas stroke being drawn (canvas units, quantised `x, y, pressure` triples). */
export interface StrokeDraft {
  v: typeof DRAFT_VERSION;
  kind: 'stroke';
  canvas: string;
  /** the id the stroke has when committed, so recovery never adds it twice */
  id: string;
  created: number;
  tool: StrokeTool;
  color: string;
  size: number;
  pts: number[];
}

/** PDF ink being drawn, or a margin note being typed: the whole annotation as it would be saved. */
export interface AnnotationDraft {
  v: typeof DRAFT_VERSION;
  kind: 'ink' | 'note';
  /** book or clipping id (document `ann:<item>`) */
  item: string;
  annotation: Annotation;
}

/** A to-do being typed on the To-dos page. */
export interface TodoDraft {
  v: typeof DRAFT_VERSION;
  kind: 'todo';
  text: string;
  /** set (before the item is added) once Enter or page hide added it to the checklist */
  committed: boolean;
  created: number;
}

export type Draft = StrokeDraft | AnnotationDraft | TodoDraft;

/** A draft without its version (filled in on write). */
export type DraftInput = Draft extends infer D ? (D extends Draft ? Omit<D, 'v'> : never) : never;

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function store(): DraftStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage throws on access
  }
}

export const draftKey = (kind: DraftKind, scope: string) => `${DRAFT_PREFIX}${kind}:${scope}`;

/** Writes a draft synchronously. Returns the stored text, or null when storage refused it. */
export function writeDraft(key: string, draft: DraftInput): string | null {
  const raw = JSON.stringify({ ...draft, v: DRAFT_VERSION });
  try {
    store()?.setItem(key, raw);
    return raw;
  } catch {
    return null; // private mode or quota: the pagehide savers remain
  }
}

export function readDraftRaw(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The draft under `key`, or null when there is none or it is not one this version understands. */
export function readDraft(key: string): Draft | null {
  const raw = readDraftRaw(key);
  return raw === null ? null : parseDraft(raw);
}

export function parseDraft(raw: string): Draft | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const d = v as Partial<Draft> & { v?: unknown };
  if (d.v !== DRAFT_VERSION) return null;
  switch (d.kind) {
    case 'stroke': {
      const s = d as Partial<StrokeDraft>;
      return typeof s.canvas === 'string' && typeof s.id === 'string' && typeof s.created === 'number' && Array.isArray(s.pts) && (s.tool === 'pen' || s.tool === 'highlighter') && typeof s.color === 'string' && typeof s.size === 'number'
        ? (s as StrokeDraft)
        : null;
    }
    case 'ink':
    case 'note': {
      const a = d as Partial<AnnotationDraft>;
      return typeof a.item === 'string' && !!a.annotation && typeof a.annotation.id === 'string' && a.annotation.kind === a.kind ? (a as AnnotationDraft) : null;
    }
    case 'todo': {
      const t = d as Partial<TodoDraft>;
      return typeof t.text === 'string' ? ({ ...t, committed: !!t.committed } as TodoDraft) : null;
    }
    default:
      return null;
  }
}

/** Removes a draft; with `ifRaw`, only while it still holds that text (nothing newer was written). */
export function removeDraft(key: string, ifRaw?: string): void {
  try {
    const s = store();
    if (!s) return;
    if (ifRaw !== undefined && s.getItem(key) !== ifRaw) return;
    s.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Every draft in storage; `draft` is null for one this version cannot read (kept as it is). */
export function listDrafts(): { key: string; raw: string; draft: Draft | null }[] {
  const s = store();
  if (!s) return [];
  const out: { key: string; raw: string; draft: Draft | null }[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    for (const key of keys.sort()) {
      const raw = s.getItem(key);
      if (raw !== null) out.push({ key, raw, draft: parseDraft(raw) });
    }
  } catch {
    /* storage went away */
  }
  return out;
}

/**
 * Calls `write` at most every `ms` while work goes on (the first call writes at once). While
 * `eager()` holds (the work is still small, so writing it costs next to nothing) every call
 * writes at once. `flush` writes now if a write is due; `cancel` drops a due write.
 */
export function draftThrottle(write: () => void, opts: { ms?: number; eager?: () => boolean } = {}) {
  const ms = opts.ms ?? 150;
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = undefined;
    last = Date.now();
    write();
  };
  return {
    schedule() {
      if (opts.eager?.()) return run();
      if (timer) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    flush() {
      if (timer) run();
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Strokes up to this many points have their draft written on every pointer event. */
export const EAGER_DRAFT_POINTS = 200;

/** What `settleDraft` needs of the document store. */
export interface SavedSignal {
  whenSaved(docId: string): Promise<void>;
}

/**
 * The work in the draft under `key` was committed to document `docId`: clear the draft once
 * that document is in IndexedDB, unless a newer draft was written meanwhile. `ready` says when
 * the commit has reached the document (a stroke for a month still loading, a note saved before
 * its annotations opened); it is polled until then, for at most two minutes.
 */
export function settleDraft(docs: SavedSignal, key: string, docId: string, ready?: () => boolean): void {
  const raw = readDraftRaw(key);
  if (raw === null) return;
  const clear = () => void docs.whenSaved(docId).then(() => removeDraft(key, raw));
  if (!ready || ready()) return clear();
  // the commit never arriving (dropped) leaves the draft for the next start to recover
  const until = Date.now() + 120_000;
  const poll = () => {
    if (readDraftRaw(key) !== raw) return;
    if (ready()) clear();
    else if (Date.now() < until) setTimeout(poll, 200);
  };
  setTimeout(poll, 200);
}
