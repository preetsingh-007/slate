/**
 * Push (R4–R8, G5, G9): write local changes to the repository as one batch.
 *
 * 1. Source files: canvas.json, the Yjs documents GitHub does not have yet (canvas segments,
 *    the to-do checklist, annotations), assets not uploaded yet (stored once, named by content
 *    hash, R7), book.json / meta.json, clipping content (written once, L11), settings.json,
 *    removals of deleted library items, and book files in Git LFS mode.
 * 2. Derived files, regenerated from the documents and never merged (R6, G5): day and mark files
 *    of every segment pushed (of every local segment when the formats or the library and canvas
 *    index changed), queue.md, todos.md, the two READMEs and books' annotations.md.
 * 3. Every Markdown file goes through the link check (G9), then the changes are grouped into
 *    at most one commit per scope (commits.ts) and published with one ref update (R8).
 */
import * as Y from 'yjs';
import type { Annotation, BookMeta, CanvasObject, ClippingMeta } from '../model/types';
import { MAX_FILE_BYTES, assetFileName } from '../storage/assets';
import { stateDigest } from '../storage/digest';
import { TODO_DOC_ID, annotationsDocId, parseSegmentDocId, segmentDocId } from '../stores/docIds';
import { readChecklist } from '../stores/todo';
import { objectBounds, rectsIntersect } from '../canvas/bounds';
import { hash64 } from '../util/ids';
import { DERIVED_VERSION, type SyncContext } from './context';
import { planCommits, type PlannedChange } from './commits';
import { dayMarkdown, daySvg, segmentDays } from './derived/days';
import { journalReadme } from './derived/journalReadme';
import { annotationsMarkdown, clippingMarkdown, libraryReadme } from './derived/library';
import { neutralizeLinks, pathExists } from './derived/links';
import { parseQueue, parseTodos, queueMarkdown, todosMarkdown, uncheckedTasks, type CanvasTodo, type QueueEntry } from './derived/lists';
import { markMarkdown, markPngSize, markSvg, type MarkObject } from './derived/marks';
import { dayOf, segmentAssets, type DerivedEnv, type SegmentContent } from './derived/segment';
import { bytesToBase64, gitBlobSha } from './git/remote';
import { canvasFile, jsonBytes } from './json';
import { lfsPointer } from './lfs';
import { compactState, containedIn, isEmptyUpdate, pathForDoc, withDoc } from './local';
import {
  CLIPPING_DIR,
  FORMALIZED_PATH,
  JOURNAL_README,
  LIBRARY_README,
  NAME,
  QUEUE_PATH,
  SETTINGS_PATH,
  TODOS_PATH,
  ASSET_FILE,
  bookDir,
  bookAnnotationsMdPath,
  bookFilePath,
  bookJsonPath,
  canvasJsonPath,
  clippingAssetPath,
  clippingDir,
  clippingMdPath,
  clippingMetaPath,
  clippingSnapshotPath,
  dayPath,
  markPath,
  segmentAssetPath,
  segmentDir,
  segmentPath,
} from './paths';
import { mergeDoc } from './pull';

const enc = new TextEncoder();
const dec = new TextDecoder();
const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** The files of one push: writes (with their git blob shas) and deletions. */
export class PushPlan {
  readonly writes = new Map<string, { content: Uint8Array; sha: string }>();
  readonly deletes = new Set<string>();

  constructor(private tree: Record<string, string>) {}

  /** Plans a write; a no-op when the repository already has these bytes. */
  async write(path: string, content: Uint8Array): Promise<string> {
    const sha = await gitBlobSha(content);
    this.deletes.delete(path);
    if (this.tree[path] === sha) this.writes.delete(path);
    else this.writes.set(path, { content, sha });
    return sha;
  }

  async text(path: string, text: string): Promise<string> {
    return this.write(path, enc.encode(text));
  }

  delete(path: string) {
    if (path in this.tree && !this.writes.has(path)) this.deletes.add(path);
  }

  has(path: string): boolean {
    return this.writes.has(path) || (path in this.tree && !this.deletes.has(path));
  }

  /** Paths of the repository's journal/ and library/ after this push. */
  finalPaths(): string[] {
    const out = new Set(Object.keys(this.tree));
    for (const p of this.deletes) out.delete(p);
    for (const p of this.writes.keys()) out.add(p);
    return [...out];
  }

  changes(): PlannedChange[] {
    const out: PlannedChange[] = [];
    for (const [path, w] of this.writes) out.push({ path, content: w.content, added: !(path in this.tree) });
    for (const path of this.deletes) out.push({ path, content: null, added: false });
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}

export interface PushOptions {
  /** documents changed since the last push; undefined scans every local document */
  dirtyDocs?: ReadonlySet<string>;
  /** paths of the whole repository (gym files that clips may cite) */
  repoPaths?: readonly string[];
}

export interface PushResult {
  committed: boolean;
  messages: string[];
  head: string | null;
  /** documents whose state is now on GitHub */
  pushedDocs: string[];
}

/** Signature of what the derived files depend on besides the segment itself. */
export function indexSignature(ctx: SyncContext): string {
  const { library, canvases } = ctx.deps;
  return hash64(
    JSON.stringify([
      library.books().map((b) => [b.id, b.slug, b.title]),
      library.clippings().map((c) => [c.id, c.slug, c.title]),
      canvases.list().map((c) => [c.slug, c.title, c.topics]),
    ]),
  );
}

export async function push(ctx: SyncContext, opts: PushOptions = {}): Promise<PushResult> {
  const { deps, st, remote } = ctx;
  const { docs, library, canvases, settings, assets } = deps;
  if (!st.head) throw new Error('push before the first pull');
  const plan = new PushPlan(st.tree);
  const jsonOut = new Map<string, unknown>();
  const docOut = new Map<string, { docId: string; digest: string }>();
  const pngOut = new Map<string, { svg: string; sha: string }>();
  const json = async (path: string, value: unknown) => {
    jsonOut.set(path, JSON.parse(JSON.stringify(value)));
    await plan.write(path, jsonBytes(value));
  };

  const tombs = library.tombstones();
  // L13: a tombstone removes its folder only while the folder still holds that item; another
  // device may have deleted it too and created a new item under the same name since
  const holder = (t: (typeof tombs)[number]) => {
    const path = t.kind === 'book' ? bookJsonPath(t.slug) : clippingMetaPath(t.slug);
    if (!(path in st.tree)) return 'none';
    return (st.base[path] as { id?: unknown } | undefined)?.id === t.id ? 'item' : 'other';
  };
  const replaced = new Set(tombs.filter((t) => holder(t) === 'other').map((t) => t.id));
  const sig = indexSignature(ctx);
  const regenerateAll = st.derivedVersion !== DERIVED_VERSION || st.indexSig !== sig || tombs.length > 0;

  // Removing a library item: day files on segments this device has not downloaded may cite it,
  // so download them now and regenerate everything (G9: no commit may leave a broken link).
  if (tombs.length) {
    for (const [path, sha] of Object.entries(st.tree)) {
      const docId = parseSegmentDocIdFromPath(path);
      if (docId && st.merged[path] !== sha) await mergeDoc(ctx, docId, path, sha);
    }
  }
  const localIds = new Set(await docs.listDocIds());

  // ---------------------------------------------------------------- 1. source files

  for (const t of tombs) {
    if (replaced.has(t.id)) continue;
    const dir = (t.kind === 'book' ? bookDir(t.slug) : clippingDir(t.slug)) + '/';
    for (const p of Object.keys(st.tree)) if (p.startsWith(dir)) plan.delete(p);
  }

  for (const meta of canvases.list()) {
    if (!NAME.test(meta.slug)) {
      ctx.warn(`The canvas "${meta.slug}" is not synced: its name must be lowercase and hyphen-separated.`);
      continue;
    }
    await json(canvasJsonPath(meta.slug), canvasFile(meta));
  }

  // documents (R2): write the merged state when GitHub does not have all of it
  const candidates = opts.dirtyDocs ? [...opts.dirtyDocs] : [...localIds];
  for (const docId of candidates.sort()) {
    const path = pathForDoc(docId, library);
    if (!path) continue;
    const remoteSha = st.tree[path];
    // the repository has a version this device has not merged (e.g. opened while offline)
    if (remoteSha && st.merged[path] !== remoteSha) await mergeDoc(ctx, docId, path, remoteSha);
    const state = await docs.getState(docId);
    if (!state || (isEmptyUpdate(state) && !remoteSha)) continue;
    if (remoteSha && containedIn(state, st.digest[docId])) continue;
    const content = compactState(state);
    await plan.write(path, content);
    docOut.set(path, { docId, digest: stateDigest(content) });
  }

  // assets of segments (R7): uploaded once, named by content hash
  for (const docId of opts.dirtyDocs && !regenerateAll ? [...docOut.values()].map((d) => d.docId) : [...localIds]) {
    const seg = parseSegmentDocId(docId);
    if (!seg || !pathForDoc(docId, library)) continue;
    const content = await ctx.segment(docId);
    if (!content) continue;
    for (const [hash, mime] of segmentAssets(content)) {
      const path = segmentAssetPath(seg.slug, seg.month, hash, mime);
      if (plan.has(path)) continue;
      const blob = await assets.get(hash);
      if (!blob) continue;
      if (blob.size > MAX_FILE_BYTES) {
        ctx.warn(`An image over 50 MB on the ${seg.slug} canvas is not synced.`);
        continue;
      }
      await plan.write(path, new Uint8Array(await blob.arrayBuffer()));
    }
  }

  for (const b of library.books()) {
    if (!NAME.test(b.slug)) {
      ctx.warn(`The book "${b.title}" is not synced: its folder name "${b.slug}" is not valid.`);
      continue;
    }
    await json(bookJsonPath(b.slug), b);
    if (settings.get().lfs) await pushBookFile(ctx, plan, b);
  }

  for (const c of library.clippings()) {
    if (!CLIPPING_DIR.test(c.slug)) {
      ctx.warn(`The clipping "${c.title}" is not synced: its folder name "${c.slug}" is not valid.`);
      continue;
    }
    await json(clippingMetaPath(c.slug), c);
    await pushClippingContent(ctx, plan, c);
  }

  await json(SETTINGS_PATH, settings.get());

  // ---------------------------------------------------------------- 2. derived files

  const segIds = [...localIds].filter((id) => parseSegmentDocId(id) && pathForDoc(id, library));
  const contents = new Map<string, SegmentContent>();
  for (const id of segIds) {
    const c = await ctx.segment(id);
    if (c) contents.set(id, c);
  }
  const regen = new Set<string>();
  for (const d of docOut.values()) if (contents.has(d.docId)) regen.add(d.docId);
  if (regenerateAll) for (const id of contents.keys()) regen.add(id);

  // A mark may cover objects of a neighbouring month: download that segment first, or this
  // device would render the mark differently from one that has it (canvas.json has each month's
  // bounds; months without known bounds are not fetched)
  for (const docId of [...regen]) {
    const c = contents.get(docId)!;
    const months = canvases.meta(c.slug)?.segments ?? {};
    for (const mark of c.marks) {
      for (const [month, bounds] of Object.entries(months)) {
        const id = segmentDocId(c.slug, month);
        const path = segmentPath(c.slug, month);
        if (month === c.month || contents.has(id) || !bounds || !rectsIntersect(bounds, mark.region) || !st.tree[path]) continue;
        await mergeDoc(ctx, id, path, st.tree[path]);
        const content = await ctx.segment(id);
        if (content) contents.set(id, content);
      }
    }
  }

  const repoPaths = opts.repoPaths ?? [];
  const env = (): DerivedEnv => {
    const exists = pathExists([...plan.finalPaths(), ...repoPaths.filter((p) => !p.startsWith('journal/') && !p.startsWith('library/'))]);
    return {
      exists,
      book: (id) => library.book(id),
      clipping: (id) => library.clipping(id),
      canvas: (slug) => canvases.meta(slug),
    };
  };
  const derivedEnv = env();
  // derived files that are about to be written count as existing (days ↔ marks link each other)
  const planned = new Set<string>();
  const withPlanned: DerivedEnv = { ...derivedEnv, exists: (p) => planned.has(p) || derivedEnv.exists(p) };

  for (const docId of [...regen].sort()) {
    const content = contents.get(docId)!;
    for (const date of segmentDays(content)) {
      planned.add(dayPath(content.slug, content.month, date, 'md'));
      planned.add(dayPath(content.slug, content.month, date, 'svg'));
    }
    for (const m of content.marks) {
      planned.add(markPath(content.slug, content.month, m.id, 'md'));
      planned.add(markPath(content.slug, content.month, m.id, 'png'));
    }
  }

  for (const docId of [...regen].sort()) {
    const content = contents.get(docId)!;
    const { slug, month } = content;
    const canvasTopics = canvases.meta(slug)?.topics ?? [];
    const generated = new Set<string>();
    for (const date of segmentDays(content)) {
      const md = dayPath(slug, month, date, 'md');
      const svg = dayPath(slug, month, date, 'svg');
      await plan.text(md, dayMarkdown(content, date, canvasTopics, withPlanned));
      await plan.text(svg, daySvg(content, date));
      generated.add(md).add(svg);
    }
    // the canvas's other local segments: marks may cover objects from neighbouring months
    const sameCanvas = [...contents.values()].filter((c) => c.slug === slug);
    for (const mark of content.marks) {
      const md = markPath(slug, month, mark.id, 'md');
      const png = markPath(slug, month, mark.id, 'png');
      const objects: MarkObject[] = [];
      for (const c of sameCanvas) for (const o of c.objects) if (mark.objects.includes(o.id)) objects.push({ object: o, seg: c });
      await plan.text(md, markMarkdown(content, mark, objects, withPlanned));
      generated.add(md).add(png);
      const inRegion: CanvasObject[] = [];
      for (const c of sameCanvas) for (const o of c.objects) if (rectsIntersect(objectBounds(o), mark.region)) inRegion.push(o);
      const svgKey = hash64(markSvg(mark, inRegion, (hash) => `asset:${hash}`));
      const rec = st.pngs[png];
      if (rec && rec.svg === svgKey && plan.has(png)) continue; // unchanged since rendered
      const hrefs = await dataUris(ctx, inRegion);
      const size = markPngSize(mark.region);
      try {
        const bytes = await deps.rasterize(markSvg(mark, inRegion, (hash) => hrefs.get(hash) ?? TRANSPARENT_PNG), size.w, size.h);
        pngOut.set(png, { svg: svgKey, sha: await plan.write(png, bytes) });
      } catch (err) {
        generated.delete(png);
        ctx.warn(`Could not render mark ${mark.id}: ${String((err as Error)?.message ?? err)}`);
      }
    }
    const prefix = segmentDir(slug, month);
    for (const p of Object.keys(st.tree)) {
      if ((p.startsWith(`${prefix}/days/`) || p.startsWith(`${prefix}/marks/`)) && !generated.has(p)) plan.delete(p);
    }
  }

  // queue.md: marks not formalized, from local segments plus lines for segments not on this device
  const isLocalSegmentPath = (repoPath: string) => {
    const m = /^journal\/([^/]+)\/(\d{4}-\d{2})\//.exec(repoPath);
    return !!m && contents.has(segmentDocId(m[1], m[2]));
  };
  const finalExists = () => pathExists(plan.finalPaths());
  const entries: QueueEntry[] = [];
  for (const c of contents.values()) {
    for (const m of c.marks) {
      if (deps.formalized.get(m.id)) continue;
      entries.push({ id: m.id, kind: m.kind, topic: m.topic, created: m.created, path: markPath(c.slug, c.month, m.id, 'md'), date: dayOf(m.created, c.month) });
    }
  }
  let exists = finalExists();
  const queueText = await repoText(ctx, QUEUE_PATH);
  const carriedQueue = parseQueue(queueText).filter((l) => !isLocalSegmentPath(l.path) && !deps.formalized.get(l.id) && exists(l.path));
  await plan.text(QUEUE_PATH, queueMarkdown(entries.filter((e) => exists(e.path) || planned.has(e.path)), carriedQueue));

  // todos.md (G4): the checklist and every unchecked canvas to-do
  const checklist = ((await withDoc(docs, TODO_DOC_ID, (d) => readChecklist(d))) ?? []).filter((i) => !i.checked && i.text.trim()).map((i) => i.text.trim());
  const canvasTodos: CanvasTodo[] = [];
  for (const c of contents.values()) {
    for (const o of c.objects) {
      if (o.kind !== 'text') continue;
      const date = dayOf(o.created, c.month);
      for (const t of uncheckedTasks(o.content)) canvasTodos.push({ text: t, date, dayPath: dayPath(c.slug, c.month, date, 'md'), y: o.y, x: o.x });
    }
  }
  exists = finalExists();
  const todosText = await repoText(ctx, TODOS_PATH);
  const carriedTodos = parseTodos(todosText).filter((l) => !isLocalSegmentPath(l.dayPath) && exists(l.dayPath));
  await plan.text(TODOS_PATH, todosMarkdown(checklist, canvasTodos, carriedTodos));

  // READMEs
  const canvasRows = canvases
    .list()
    .filter((m) => NAME.test(m.slug))
    .map((meta) => {
      const months = new Set(Object.keys(meta.segments ?? {}));
      for (const p of plan.finalPaths()) {
        const m = new RegExp(`^journal/${meta.slug}/(\\d{4}-\\d{2})/canvas\\.yjs$`).exec(p);
        if (m) months.add(m[1]);
      }
      return { meta, months: [...months].filter((m) => plan.has(segmentPath(meta.slug, m))).sort() };
    });
  await plan.text(JOURNAL_README, journalReadme(canvasRows, FORMALIZED_PATH in st.tree));
  await plan.text(
    LIBRARY_README,
    libraryReadme(
      library.books().filter((b) => NAME.test(b.slug)),
      library.clippings().filter((c) => CLIPPING_DIR.test(c.slug)),
    ),
  );

  // annotations.md of books whose annotations changed
  for (const b of library.books()) {
    if (!NAME.test(b.slug)) continue;
    const docId = annotationsDocId(b.id);
    const annPath = pathForDoc(docId, library)!;
    if (!localIds.has(docId) || !(docOut.has(annPath) || regenerateAll)) continue;
    const anns = await withDoc(docs, docId, readAnnotations);
    if (anns) await plan.text(bookAnnotationsMdPath(b.slug), annotationsMarkdown(b, anns));
  }

  // ---------------------------------------------------------------- 3. links, commits

  const linkExists = pathExists([...plan.finalPaths(), ...repoPaths.filter((p) => !p.startsWith('journal/') && !p.startsWith('library/'))]);
  for (const [path, w] of [...plan.writes]) {
    if (!path.endsWith('.md')) continue;
    const text = dec.decode(w.content);
    const safe = neutralizeLinks(text, path, linkExists);
    if (safe !== text) await plan.text(path, safe);
  }

  const changes = plan.changes();
  const finish = async (head: string | null) => {
    if (head) st.head = head;
    for (const c of changes) {
      if (c.content) st.tree[c.path] = plan.writes.get(c.path)!.sha;
      else {
        delete st.tree[c.path];
        delete st.merged[c.path];
        delete st.base[c.path];
        delete st.pngs[c.path];
      }
    }
    for (const [path, d] of docOut) {
      st.merged[path] = st.tree[path];
      st.digest[d.docId] = d.digest;
    }
    for (const [path, value] of jsonOut) {
      if (!(path in st.tree)) continue;
      st.base[path] = value;
      st.merged[path] = st.tree[path];
    }
    for (const [path, rec] of pngOut) st.pngs[path] = rec;
    st.derivedVersion = DERIVED_VERSION;
    st.indexSig = sig;
    await ctx.save();
    // a tombstone is done once its folder is gone, or holds another item now
    for (const t of tombs) {
      const gone = !Object.keys(st.tree).some((p) => p.startsWith((t.kind === 'book' ? bookDir(t.slug) : clippingDir(t.slug)) + '/'));
      if (gone || replaced.has(t.id)) await ctx.quietly(() => library.clearTombstone(t.id));
    }
  };

  const pushedDocs = [...docOut.values()].map((d) => d.docId);
  if (!changes.length) {
    await finish(null);
    return { committed: false, messages: [], head: st.head, pushedDocs };
  }
  const commits = planCommits(changes);
  const head = await remote.commit(commits, st.head);
  await finish(head.commitSha);
  return { committed: true, messages: commits.map((c) => c.message), head: head.commitSha, pushedDocs };
}

function parseSegmentDocIdFromPath(path: string): string | null {
  const m = /^journal\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(\d{4}-\d{2})\/canvas\.yjs$/.exec(path);
  return m ? segmentDocId(m[1], m[2]) : null;
}

/** The repository's current text of a small derived file (cached by sha in the sync state). */
async function repoText(ctx: SyncContext, path: string): Promise<string> {
  const sha = ctx.st.tree[path];
  if (!sha) return '';
  const hit = ctx.st.texts[path];
  if (hit?.sha === sha) return hit.text;
  const text = dec.decode(await ctx.remote.getBlob(sha));
  ctx.st.texts[path] = { sha, text };
  return text;
}

function readAnnotations(doc: Y.Doc): Annotation[] {
  const out: Annotation[] = [];
  for (const v of doc.getMap('annotations').values()) {
    const a = (v instanceof Y.Map ? v.toJSON() : v) as Annotation;
    if (a && typeof a.id === 'string' && a.locator) out.push(a);
  }
  return out;
}

/** data: URIs of the images of `objects`, so the rasteriser needs no file access (G5). */
async function dataUris(ctx: SyncContext, objects: readonly CanvasObject[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const o of objects) {
    const hash = o.kind === 'image' ? o.asset : o.kind === 'clip' ? o.asset : undefined;
    if (!hash || out.has(hash)) continue;
    const blob = await ctx.deps.assets.get(hash);
    if (!blob) continue;
    const mime = (o.kind === 'image' ? o.mime : o.kind === 'clip' ? o.mime : undefined) || blob.type || 'image/png';
    out.set(hash, `data:${mime};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`);
  }
  return out;
}

/** A clipping's content files, written once (L11): clipping.md, snapshot.html, assets/. */
async function pushClippingContent(ctx: SyncContext, plan: PushPlan, c: ClippingMeta) {
  const { st, deps } = ctx;
  if (clippingMdPath(c.slug) in st.tree && !plan.deletes.has(clippingMdPath(c.slug))) return;
  const content = await deps.library.clippingContent(c.id);
  if (!content) return;
  await plan.text(clippingMdPath(c.slug), clippingMarkdown(c, content.markdown));
  if (content.snapshotHtml) await plan.text(clippingSnapshotPath(c.slug), content.snapshotHtml);
  for (const a of content.assets) {
    const name = a.path.split('/').pop() ?? '';
    const file = ASSET_FILE.test(name) ? name : assetFileName(a.hash, a.mime);
    const path = clippingAssetPath(c.slug, file);
    if (plan.has(path)) continue;
    const blob = await deps.assets.get(a.hash);
    if (!blob) continue;
    if (blob.size > MAX_FILE_BYTES) {
      ctx.warn(`A file over 50 MB in the clipping "${c.title}" is not synced.`);
      continue;
    }
    await plan.write(path, new Uint8Array(await blob.arrayBuffer()));
  }
}

/** Git LFS mode (R7): upload the book file, then commit its pointer. */
async function pushBookFile(ctx: SyncContext, plan: PushPlan, b: BookMeta) {
  const path = bookFilePath(b.slug, b.format);
  if (path in ctx.st.tree || !ctx.lfs) return;
  const blob = await ctx.deps.assets.get(b.fileHash);
  if (!blob) return;
  try {
    await ctx.lfs.upload(b.fileHash, blob);
    await plan.text(path, lfsPointer(b.fileHash, blob.size));
  } catch (err) {
    ctx.warn(String((err as Error)?.message ?? err));
  }
}
