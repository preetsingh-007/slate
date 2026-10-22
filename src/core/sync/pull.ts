/**
 * Pull (R4, R9, G6): bring the repository's journal/ and library/ into local state.
 *
 * Order matters for a new device (R9): the library index (book.json, meta.json) and the canvas
 * list (canvas.json) come first, then settings and formalized.md, then the documents this device
 * already has. Canvas segments, annotation documents and clipping content that are not on the
 * device are only recorded; they download when opened (`ensureDoc`, `ensureClipping`).
 * Yjs documents merge as CRDTs; JSON files merge field by field (json.ts).
 */
import type { BookMeta, ClippingMeta, SyncedSettings } from '../model/types';
import { stateDigest } from '../storage/digest';
import { DEFAULT_SETTINGS, mergeSettings } from '../stores/settings';
import { TODO_DOC_ID, parseSegmentDocId, segmentDocId } from '../stores/docIds';
import { GIT_TRANSPORT, type SyncContext } from './context';
import { readSegment, segmentAssets } from './derived/segment';
import { AuthError, mapLimit } from './git/remote';
import { canvasFile, canvasMetaFromFile, deepEqual, mergeCanvasFile, mergeItemFile, parseJsonBytes, type CanvasFile } from './json';
import { docForPath, withDoc } from './local';
import { CLIPPING_DIR, FORMALIZED_PATH, NAME, SETTINGS_PATH, parseRepoPath, segmentAssetPath, segmentPath } from './paths';

const dec = new TextDecoder();

export class BranchNotFoundError extends Error {
  constructor(branch: string) {
    super(`The branch ${branch} does not exist in the repository.`);
    this.name = 'BranchNotFoundError';
  }
}

export interface PullResult {
  /** the repository moved since the last pull */
  changed: boolean;
  head: string;
  docsMerged: number;
}

export async function pull(ctx: SyncContext, branch: string): Promise<PullResult> {
  const { remote, st, deps } = ctx;
  const head = await remote.getHead();
  if (!head) throw new BranchNotFoundError(branch);
  const mirrorStale = !!deps.mirror && deps.mirror.commit() !== head.commitSha;
  if (head.commitSha === st.head && !mirrorStale) return { changed: false, head: head.commitSha, docsMerged: 0 };

  const entries = await remote.listTree(head.treeSha);
  let docsMerged = 0;
  if (head.commitSha !== st.head) {
    const tree: Record<string, string> = {};
    for (const e of entries) if (e.path.startsWith('journal/') || e.path.startsWith('library/')) tree[e.path] = e.sha;
    await pullLibrary(ctx, tree);
    await pullCanvases(ctx, tree);
    await pullSettings(ctx, tree);
    await pullFormalized(ctx, tree);
    docsMerged = await pullDocs(ctx, tree);
    await pullAssets(ctx, tree);
    for (const p of Object.keys(st.merged)) if (!(p in tree)) delete st.merged[p];
    st.tree = tree;
    st.head = head.commitSha;
    await ctx.save();
    await deps.docs.flush();
  }
  if (deps.mirror) {
    try {
      await deps.mirror.refresh(head.commitSha, entries, (sha) => remote.getBlob(sha));
    } catch (err) {
      // the journal and library are in sync; only the offline copy of gym's notes lags behind
      if (err instanceof AuthError) throw err;
      ctx.warn(`Could not update the offline copy of gym's files: ${String((err as Error)?.message ?? err)}`);
    }
  }
  return { changed: true, head: head.commitSha, docsMerged };
}

async function fetchJson<T>(ctx: SyncContext, sha: string): Promise<T | null> {
  return parseJsonBytes<T>(await ctx.remote.getBlob(sha));
}

/** Downloads the given JSON files in parallel (a new device has the whole index to fetch, R9). */
async function prefetchJson(ctx: SyncContext, entries: [string, string][]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  await mapLimit(entries, 6, async ([path, sha]) => void out.set(path, await fetchJson(ctx, sha)));
  return out;
}

/** A free folder name for an item whose name another device took first (`<slug>-2`, …). */
function freeSlug(slug: string, taken: (s: string) => boolean): string {
  for (let n = 2; ; n++) {
    const s = `${slug}-${n}`;
    if (!taken(s)) return s;
  }
}

async function pullLibrary(ctx: SyncContext, tree: Record<string, string>) {
  const { st, deps } = ctx;
  const { library } = deps;
  const isItem = (path: string) => {
    const f = parseRepoPath(path);
    return (f?.kind === 'book' && f.file === 'book.json' && NAME.test(f.slug)) || (f?.kind === 'clipping' && f.file === 'meta.json' && CLIPPING_DIR.test(f.slug));
  };
  const files = await prefetchJson(ctx, Object.entries(tree).filter(([path, sha]) => isItem(path) && st.merged[path] !== sha));
  for (const [path, sha] of Object.entries(tree)) {
    if (!files.has(path)) continue;
    const f = parseRepoPath(path) as { kind: 'book' | 'clipping'; slug: string };
    const isBook = f.kind === 'book';
    const slug = f.slug;
    const parsed = files.get(path) as ({ id?: unknown } & Record<string, unknown>) | null;
    if (!parsed || typeof parsed.id !== 'string') {
      st.merged[path] = sha;
      continue;
    }
    const remote = { ...parsed, slug } as unknown as BookMeta | ClippingMeta;
    const base = st.base[path] as object | undefined;
    st.merged[path] = sha;
    st.base[path] = remote;
    // deleted here (read now: the owner may have deleted it while the files downloaded); the push removes it
    if (library.tombstones().some((t) => t.id === remote.id)) continue;
    const items: (BookMeta | ClippingMeta)[] = isBook ? library.books() : library.clippings();
    const local = items.find((x) => x.id === remote.id);
    const taken = (s: string) => items.some((x) => x.slug === s) || Object.keys(tree).some((p) => p.startsWith(`library/${isBook ? 'books' : 'clippings'}/${s}/`));
    if (!local) {
      // another item created on this device took the same folder name: move ours aside
      const clash = items.find((x) => x.slug === slug && x.id !== remote.id);
      if (clash) {
        const moved = { ...clash, slug: freeSlug(slug, taken) };
        await ctx.quietly(() => (isBook ? library.putBook(moved as BookMeta) : library.putClipping(moved as ClippingMeta)));
      }
      await ctx.quietly(() => (isBook ? library.putBook(remote as BookMeta) : library.putClipping(remote as ClippingMeta)));
    } else {
      const merged = { ...mergeItemFile(base, local as object, remote as object), slug };
      if (!deepEqual(merged, local)) await ctx.quietly(() => (isBook ? library.putBook(merged as BookMeta) : library.putClipping(merged as ClippingMeta)));
    }
  }
  // folders removed on GitHub (another device deleted the item)
  for (const path of Object.keys(st.base)) {
    if (path in tree) continue;
    const f = parseRepoPath(path);
    if (!f || !((f.kind === 'book' && f.file === 'book.json') || (f.kind === 'clipping' && f.file === 'meta.json'))) continue;
    const id = (st.base[path] as { id?: string }).id;
    const local = id ? library.book(id) ?? library.clipping(id) : undefined;
    if (id && local && local.slug === f.slug) await ctx.quietly(() => library.forget(id));
    delete st.base[path];
    delete st.merged[path];
  }
}

async function pullCanvases(ctx: SyncContext, tree: Record<string, string>) {
  const { st, deps } = ctx;
  const files = await prefetchJson(
    ctx,
    Object.entries(tree).filter(([path, sha]) => {
      const f = parseRepoPath(path);
      return f?.kind === 'canvasJson' && NAME.test(f.slug) && st.merged[path] !== sha;
    }),
  );
  const updates: { slug: string; base: CanvasFile | undefined; remote: CanvasFile }[] = [];
  for (const [path, sha] of Object.entries(tree)) {
    const f = parseRepoPath(path);
    if (f?.kind !== 'canvasJson' || !files.has(path)) continue;
    const parsed = files.get(path) as Partial<CanvasFile> | null;
    st.merged[path] = sha;
    if (!parsed) continue;
    const remote = canvasFile(canvasMetaFromFile(f.slug, parsed));
    updates.push({ slug: f.slug, base: st.base[path] as CanvasFile | undefined, remote });
    st.base[path] = remote;
  }
  const months: [string, string][] = [];
  for (const path of Object.keys(tree)) {
    const f = parseRepoPath(path);
    if (f?.kind === 'segment') months.push([f.slug, f.month]);
  }
  // merged into the list as it is after the downloads, so canvases created or changed here
  // meanwhile are kept (R1)
  await ctx.quietly(() =>
    deps.canvases.mergeFromRemote((current) => {
      const metas = [...current];
      let changed = false;
      for (const { slug, base, remote } of updates) {
        const i = metas.findIndex((m) => m.slug === slug);
        if (i < 0) {
          metas.push(canvasMetaFromFile(slug, remote));
          changed = true;
          continue;
        }
        const next = canvasMetaFromFile(slug, mergeCanvasFile(base, canvasFile(metas[i]), remote));
        if (!deepEqual(next, metas[i])) {
          metas[i] = next;
          changed = true;
        }
      }
      // R3/R9: every month in the repository is a segment the canvas can load on demand
      for (const [slug, month] of months) {
        const i = metas.findIndex((m) => m.slug === slug);
        if (i < 0 || (metas[i].segments && month in metas[i].segments!)) continue;
        metas[i] = { ...metas[i], segments: { ...(metas[i].segments ?? {}), [month]: null } };
        changed = true;
      }
      return changed ? metas : null;
    }),
  );
}

async function pullSettings(ctx: SyncContext, tree: Record<string, string>) {
  const { st, deps } = ctx;
  const sha = tree[SETTINGS_PATH];
  if (!sha || st.merged[SETTINGS_PATH] === sha) return;
  const remote = await fetchJson<SyncedSettings>(ctx, sha);
  st.merged[SETTINGS_PATH] = sha;
  if (!remote) return;
  const local = deps.settings.get();
  const merged = mergeSettings(local, { ...DEFAULT_SETTINGS, ...remote });
  if (!deepEqual(merged, local)) await ctx.quietly(() => deps.settings.replace(merged));
  st.base[SETTINGS_PATH] = remote;
}

/** G6: formalized.md is parsed on every pull that changed it. */
async function pullFormalized(ctx: SyncContext, tree: Record<string, string>) {
  const { st, deps } = ctx;
  const sha = tree[FORMALIZED_PATH];
  if (sha === st.merged[FORMALIZED_PATH] && (sha || deps.formalized.all().size === 0)) return;
  const text = sha ? dec.decode(await ctx.remote.getBlob(sha)) : '';
  await deps.formalized.setFromText(text);
  if (sha) st.merged[FORMALIZED_PATH] = sha;
  else delete st.merged[FORMALIZED_PATH];
}

/** Merges the repository's version of a document into the local one (R2). */
export async function mergeDoc(ctx: SyncContext, docId: string, path: string, sha: string): Promise<void> {
  const bytes = await ctx.remote.getBlob(sha);
  let digest: string;
  try {
    digest = stateDigest(bytes);
  } catch {
    // corrupt file: leave it; this device's next push overwrites it with the local state
    ctx.warn(`Skipped ${path}: not a valid document.`);
    ctx.st.merged[path] = sha;
    return;
  }
  await ctx.deps.docs.applyRemote(docId, bytes, GIT_TRANSPORT);
  ctx.st.merged[path] = sha;
  ctx.st.digest[docId] = digest;
}

async function pullDocs(ctx: SyncContext, tree: Record<string, string>): Promise<number> {
  const { st, deps } = ctx;
  const local = new Set(await deps.docs.listDocIds());
  const jobs: [string, string, string][] = [];
  for (const [path, sha] of Object.entries(tree)) {
    if (st.merged[path] === sha) continue;
    const docId = docForPath(path, deps.library);
    if (!docId) continue;
    // R9: segments and annotations that are not on this device download when opened
    if (docId !== TODO_DOC_ID && !local.has(docId) && !deps.docs.isLoaded(docId)) continue;
    jobs.push([docId, path, sha]);
  }
  await mapLimit(jobs, 4, ([docId, path, sha]) => mergeDoc(ctx, docId, path, sha));
  return jobs.length;
}

/** Downloads the images and clip images a local segment references that are missing here (R7). */
export async function fetchSegmentAssets(ctx: SyncContext, slug: string, month: string, tree: Record<string, string>): Promise<void> {
  const { deps } = ctx;
  const docId = segmentDocId(slug, month);
  const refs = await withDoc(deps.docs, docId, (d) => segmentAssets(readSegment(slug, month, d)));
  if (!refs) return;
  const missing: [string, string, string][] = [];
  for (const [hash, mime] of refs) {
    const sha = tree[segmentAssetPath(slug, month, hash, mime)];
    if (sha && !(await deps.assets.has(hash))) missing.push([hash, mime, sha]);
  }
  await mapLimit(missing, 4, async ([hash, mime, sha]) => {
    const bytes = await ctx.remote.getBlob(sha);
    await deps.assets.putWithHash(hash, new Blob([bytes as BlobPart], { type: mime }));
  });
}

async function pullAssets(ctx: SyncContext, tree: Record<string, string>) {
  const { st, deps } = ctx;
  for (const docId of await deps.docs.listDocIds()) {
    const seg = parseSegmentDocId(docId);
    if (!seg) continue;
    const path = segmentPath(seg.slug, seg.month);
    if (!tree[path] || st.assetsAt[path] === tree[path]) continue;
    await fetchSegmentAssets(ctx, seg.slug, seg.month, tree);
    st.assetsAt[path] = tree[path];
  }
}
