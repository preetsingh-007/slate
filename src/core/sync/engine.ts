/**
 * The sync engine (R1–R11): keeps the device's local state and the gym repository on GitHub in
 * step, in the background.
 *
 * - Local first (R1): every edit is already on disk (DocStore, IndexedDB); sync only reads it.
 * - Pull on start and on returning to the foreground, and every 45 s while visible; push about
 *   20 s after the last change and when the app goes to the background (R4).
 * - A rejected push (the branch moved) pulls, merges and retries (R4). Documents merge as CRDTs,
 *   JSON files field by field (R2), derived files are regenerated (R6).
 * - An authentication failure pauses sync and asks for a new token; nothing local is touched (R4).
 * - Canvas segments, annotations and clipping content download when opened (R9): `ensureDoc`,
 *   `ensureClipping`, `ensureBookFile`.
 * - The status (R10) is always available: synced, syncing, offline, or error with its reason, and
 *   a warning when changes have been unsynced for more than a day.
 */
import { parseSegmentDocId, annotationsDocId } from '../stores/docIds';
import { Emitter } from '../util/emitter';
import { GIT_TRANSPORT, type SyncContext, type SyncDeps } from './context';
import { readSegment, type SegmentContent } from './derived/segment';
import { parseClippingMarkdown } from './derived/library';
import { expiryMessage, expiryState } from './expiry';
import { GITHUB_API, GitHubRemote, parseRepo } from './git/github';
import { AuthError, ConflictError, GitRemoteError, NotFoundError, type RepoInfo } from './git/remote';
import { LfsClient, lfsEndpoint, parseLfsPointer } from './lfs';
import { pathForDoc, withDoc } from './local';
import type { SnapshotAsset } from '../stores/library';
import { mimeFor } from '../storage/assets';
import { bookFilePath, clippingAnnotationsPath, clippingDir, clippingMdPath, clippingSnapshotPath, segmentPath } from './paths';
import { BranchNotFoundError, fetchSegmentAssets, mergeDoc, pull } from './pull';
import { push } from './push';
import { emptyState, loadState, saveState, stateKey, type SyncState } from './state';
import { WriteScopeError } from './scope';

export type SyncPhase = 'off' | 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** why sync is off or failed, in words for the owner */
  reason?: string;
  /** paused until the connection is fixed (a new token, repository or branch, R4) */
  needsToken: boolean;
  lastSyncedAt?: number;
  /** oldest local change not yet on GitHub */
  unsyncedSince?: number;
  /** changes unsynced for more than a day (R10) */
  stale: boolean;
  tokenExpiry?: number;
  /** "Your GitHub token expires in 5 days" (R4: 14 days ahead) */
  expiryWarning?: string;
  /** non-fatal problems of the last sync (files not synced, LFS) */
  warnings: string[];
  repo?: string;
  branch?: string;
}

export interface SyncTimings {
  /** R4: push about 20 s after the last change */
  pushDelayMs: number;
  /** pull interval while the app is visible (a change appears on another device within 60 s) */
  pullIntervalMs: number;
  /** first sync after start */
  initialDelayMs: number;
  /** longest wait for an on-demand download before opening with what is local */
  ensureTimeoutMs: number;
}

export const DEFAULT_TIMINGS: SyncTimings = { pushDelayMs: 20_000, pullIntervalMs: 45_000, initialDelayMs: 400, ensureTimeoutMs: 8_000 };

const DAY = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;

export interface ConnectInput {
  token: string;
  repo: string;
  branch: string;
}

export interface VerifyResult {
  ok: boolean;
  repo?: RepoInfo;
  branchExists?: boolean;
  tokenExpiry?: number;
  /** what failed, in words */
  error?: string;
}

export interface SyncEngineOptions {
  /** GitHub API base (test builds point it at a mock); default https://api.github.com */
  apiBase?: string | (() => string | undefined);
  timings?: Partial<SyncTimings>;
  /** Web Locks name so only one tab syncs */
  lockName?: string;
}

interface Meta {
  lastSyncedAt?: number;
  unsyncedSince?: number;
}

const META_KEY = 'sync:meta';

export class SyncEngine {
  readonly onStatus = new Emitter<SyncStatus>();
  private status: SyncStatus = { phase: 'off', needsToken: false, stale: false, warnings: [] };
  private timings: SyncTimings;
  private remote: GitHubRemote | null = null;
  private st: SyncState | null = null;
  private config: { token: string; repo: string; branch: string; apiBase: string } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private running: Promise<void> | null = null;
  private dirty = new Map<string, number>();
  private gen = 0;
  private storesDirty = false;
  private fullScan = true;
  private quiet = 0;
  private paused = false;
  private warnings: string[] = [];
  private meta: Meta = {};
  private segCache = new Map<string, SegmentContent>();
  private ensuring = new Map<string, Promise<void>>();
  private repoPaths: string[] = [];
  private lastSettings: unknown;
  private bg: { timers: ReturnType<typeof setTimeout>[]; interval: ReturnType<typeof setInterval>; pushTimer?: ReturnType<typeof setTimeout>; cleanup: (() => void)[] } | null = null;
  private releaseLock: (() => void) | undefined;
  private startGen = 0;
  private offs: (() => void)[] = [];
  private ready: Promise<void>;

  constructor(
    readonly deps: SyncDeps,
    private opts: SyncEngineOptions = {},
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...(opts.timings ?? {}) };
    this.lastSettings = deps.settings.get();
    this.offs.push(
      deps.docs.onUpdate.on(({ docId, from }) => {
        if (from === GIT_TRANSPORT) return;
        this.dirty.set(docId, ++this.gen);
        this.localChange();
      }),
      deps.docs.onDocChanged.on(({ docId }) => this.segCache.delete(docId)),
      deps.canvases.onChange.on(() => this.storeChange()),
      deps.library.onChange.on(() => this.storeChange()),
      deps.settings.onChange.on(() => this.settingsChange()),
    );
    this.ready = this.init();
  }

  private async init() {
    this.meta = (await this.deps.db.get<Meta>(META_KEY)) ?? {};
    await this.configureFromSecrets();
    this.refreshStatus();
  }

  /** Resolves once stored settings are loaded. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  // ================================================================ configuration

  private apiBase(): string {
    const base = typeof this.opts.apiBase === 'function' ? this.opts.apiBase() : this.opts.apiBase;
    return (base || GITHUB_API).replace(/\/+$/, '');
  }

  private makeRemote(input: ConnectInput): GitHubRemote {
    return new GitHubRemote({
      token: input.token,
      repo: input.repo,
      branch: input.branch,
      baseUrl: this.apiBase(),
      fetch: this.deps.fetch,
      onTokenExpiry: (t) => void this.recordExpiry(t),
    });
  }

  private async recordExpiry(t: number) {
    if (this.deps.settings.getSecrets().tokenExpiry !== t) await this.deps.settings.setSecrets({ tokenExpiry: t });
    this.refreshStatus();
  }

  private async configureFromSecrets() {
    const s = this.deps.settings.getSecrets();
    const next = s.token && s.repo && parseRepo(s.repo) ? { token: s.token, repo: s.repo, branch: s.branch || 'main', apiBase: this.apiBase() } : null;
    const same = JSON.stringify(next) === JSON.stringify(this.config);
    if (same) return;
    this.config = next;
    this.paused = false;
    this.st = null;
    this.remote = next ? this.makeRemote(next) : null;
    this.deps.mirror?.setFetcher(this.remote ? (sha) => this.remote!.getBlob(sha) : null);
    this.status.reason = undefined;
    this.refreshStatus(next ? 'synced' : 'off');
    if (next && this.bg) void this.sync();
  }

  configured(): boolean {
    return !!this.config;
  }

  /**
   * R4: checks a token before the first sync: the repository is visible, the token can write
   * to it (the repository's `permissions`), and the branch exists.
   */
  async verify(input: ConnectInput): Promise<VerifyResult> {
    if (!parseRepo(input.repo)) return { ok: false, error: 'Enter the repository as owner/name, for example sagal/gym.' };
    if (!input.token.trim()) return { ok: false, error: 'Enter the token.' };
    let expiry: number | undefined;
    const remote = new GitHubRemote({ token: input.token.trim(), repo: input.repo, branch: input.branch || 'main', baseUrl: this.apiBase(), fetch: this.deps.fetch, onTokenExpiry: (t) => (expiry = t) });
    try {
      const repo = await remote.getRepo();
      if (!repo.canPush) return { ok: false, repo, tokenExpiry: expiry, error: 'The token can read the repository but not write to it. Give it "Contents: Read and write".' };
      const head = await remote.getHead();
      if (!head) return { ok: false, repo, branchExists: false, tokenExpiry: expiry, error: `The branch "${input.branch || 'main'}" does not exist in ${repo.fullName}.` };
      return { ok: true, repo, branchExists: true, tokenExpiry: expiry };
    } catch (err) {
      return { ok: false, tokenExpiry: expiry, error: describeError(err) };
    }
  }

  /** Verifies, stores the connection on this device only (R4), and starts syncing. */
  async connect(input: ConnectInput): Promise<VerifyResult> {
    const r = await this.verify(input);
    if (!r.ok) return r;
    await this.deps.settings.setSecrets({ token: input.token.trim(), repo: input.repo.trim(), branch: input.branch.trim() || 'main', tokenExpiry: r.tokenExpiry });
    await this.configureFromSecrets();
    this.start();
    await this.sync();
    return r;
  }

  /** Forgets the token on this device. Local data stays. */
  async disconnect(): Promise<void> {
    await this.deps.settings.setSecrets({ token: undefined, tokenExpiry: undefined });
    await this.configureFromSecrets();
  }

  private settingsChange() {
    const synced = this.deps.settings.get();
    if (synced !== this.lastSettings) {
      this.lastSettings = synced;
      if (!this.quiet) this.storeChange();
    }
    void this.configureFromSecrets();
    this.refreshStatus();
  }

  // ================================================================ change tracking

  private storeChange() {
    if (this.quiet) return;
    this.storesDirty = true;
    this.localChange();
  }

  private localChange() {
    if (!this.meta.unsyncedSince) {
      this.meta.unsyncedSince = this.now();
      void this.saveMeta();
      this.refreshStatus();
    }
    this.schedulePush();
  }

  private async saveMeta() {
    await this.deps.db.set(META_KEY, this.meta);
  }

  /** True when there are local changes GitHub does not have yet. */
  hasLocalChanges(): boolean {
    return this.dirty.size > 0 || this.storesDirty || !!this.meta.unsyncedSince;
  }

  // ================================================================ status

  getStatus(): SyncStatus {
    return this.status;
  }

  private refreshStatus(phase?: SyncPhase, reason?: string | null) {
    const now = this.now();
    const expiry = this.deps.settings.getSecrets().tokenExpiry;
    const exp = this.config ? expiryState(expiry, now) : null;
    const next: SyncStatus = {
      ...this.status,
      phase: phase ?? (this.config ? this.status.phase : 'off'),
      lastSyncedAt: this.meta.lastSyncedAt,
      unsyncedSince: this.meta.unsyncedSince,
      stale: !!this.config && !!this.meta.unsyncedSince && now - this.meta.unsyncedSince > DAY,
      tokenExpiry: expiry,
      expiryWarning: exp?.warn && expiry ? expiryMessage(expiry, now) : undefined,
      warnings: [...this.warnings],
      needsToken: this.paused,
      repo: this.config?.repo,
      branch: this.config?.branch,
    };
    if (reason !== undefined) next.reason = reason ?? undefined;
    if (!this.config) next.reason = 'Not connected to GitHub. Changes are kept on this device.';
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.onStatus.emit(next);
  }

  private fail(err: unknown) {
    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || err instanceof TypeError;
    if (err instanceof AuthError || err instanceof NotFoundError || err instanceof BranchNotFoundError) {
      // R4: pause and ask for a new token (or repository/branch); local changes stay as they are
      this.paused = true;
      this.refreshStatus('error', describeError(err));
      return;
    }
    if (offline) {
      this.refreshStatus('offline', 'Offline. Changes are saved on this device and sync when you are back online.');
      return;
    }
    this.refreshStatus('error', describeError(err));
  }

  // ================================================================ runs

  private async state(): Promise<SyncState> {
    if (!this.st) this.st = await loadState(this.deps.db, this.remote!.id);
    return this.st;
  }

  private context(st: SyncState): SyncContext {
    const lfsOn = !!this.deps.settings.get().lfs && !!this.config;
    return {
      deps: this.deps,
      remote: this.remote!,
      st,
      save: () => saveState(this.deps.db, this.remote!.id, st),
      quietly: async (fn) => {
        this.quiet++;
        try {
          return await fn();
        } finally {
          this.quiet--;
        }
      },
      warn: (m) => {
        if (!this.warnings.includes(m)) this.warnings.push(m);
      },
      segment: (docId) => this.segment(docId),
      lfs: lfsOn ? new LfsClient(lfsEndpoint(this.apiBase(), this.config!.repo), this.config!.token, this.deps.fetch) : undefined,
    };
  }

  private async segment(docId: string): Promise<SegmentContent | null> {
    const hit = this.segCache.get(docId);
    if (hit) return hit;
    const seg = parseSegmentDocId(docId);
    if (!seg) return null;
    const content = await withDoc(this.deps.docs, docId, (d) => readSegment(seg.slug, seg.month, d));
    if (content) this.segCache.set(docId, content);
    return content;
  }

  /** Serialises runs: never two pulls or pushes at once. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private offline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  /** Pull, merge, push; retried when another device pushed in between (R4). */
  sync(): Promise<void> {
    if (this.running) return this.running;
    const run = this.exclusive(async () => {
      await this.ready;
      if (!this.remote) return this.refreshStatus('off');
      if (this.paused) return;
      if (this.offline()) return this.refreshStatus('offline', 'Offline. Changes are saved on this device and sync when you are back online.');
      this.refreshStatus('syncing');
      this.warnings = [];
      const st = await this.state();
      try {
        for (let attempt = 1; ; attempt++) {
          const ctx = this.context(st);
          try {
            const pulled = await pull(ctx, this.config!.branch);
            this.repoPaths = this.deps.mirror?.list().map((e) => e.path) ?? this.repoPaths;
            const dirtySnapshot = new Map(this.dirty);
            const storesWereDirty = this.storesDirty;
            const needPush = pulled.changed || dirtySnapshot.size > 0 || storesWereDirty || this.fullScan || !!this.meta.unsyncedSince;
            if (needPush) {
              this.storesDirty = false;
              try {
                await push(ctx, { dirtyDocs: this.fullScan ? undefined : new Set(dirtySnapshot.keys()), repoPaths: this.repoPaths });
              } catch (err) {
                this.storesDirty = this.storesDirty || storesWereDirty;
                throw err;
              }
              this.fullScan = false;
              for (const [id, gen] of dirtySnapshot) if ((this.dirty.get(id) ?? 0) <= gen) this.dirty.delete(id);
            }
            break;
          } catch (err) {
            if (err instanceof ConflictError && attempt < MAX_ATTEMPTS) continue; // the branch moved: pull, merge, retry
            throw err;
          }
        }
        this.meta.lastSyncedAt = this.now();
        if (!this.dirty.size && !this.storesDirty) this.meta.unsyncedSince = undefined;
        await this.saveMeta();
        this.refreshStatus('synced', null);
      } catch (err) {
        this.fail(err);
      }
    });
    this.running = run.finally(() => {
      this.running = null;
    });
    return this.running;
  }

  // ================================================================ background (R4)

  start(): void {
    if (this.bg || this.releaseLock) return;
    const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: LockManager }).locks : undefined;
    if (this.opts.lockName && locks) {
      const gen = ++this.startGen;
      void locks
        .request(this.opts.lockName, () => new Promise<void>((resolve) => {
          if (gen !== this.startGen) return resolve();
          this.releaseLock = resolve;
          this.begin();
        }))
        .catch(() => undefined);
      return;
    }
    this.begin();
  }

  private begin() {
    if (this.bg) return;
    const cleanup: (() => void)[] = [];
    const listen = (target: EventTarget | undefined, type: string, fn: () => void) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, fn);
      cleanup.push(() => target.removeEventListener(type, fn));
    };
    const doc = typeof document !== 'undefined' ? document : undefined;
    const win = typeof window !== 'undefined' ? window : undefined;
    // pull on returning to the foreground; push when the app goes to the background
    listen(doc, 'visibilitychange', () => {
      if (doc!.visibilityState === 'visible' || this.hasLocalChanges()) void this.sync();
    });
    listen(win, 'pagehide', () => {
      if (this.hasLocalChanges()) void this.sync();
    });
    listen(win, 'online', () => void this.sync());
    listen(win, 'offline', () => this.refreshStatus('offline', 'Offline. Changes are saved on this device and sync when you are back online.'));
    const interval = setInterval(() => {
      this.refreshStatus();
      if (!doc || doc.visibilityState === 'visible') void this.sync();
    }, this.timings.pullIntervalMs);
    this.bg = { timers: [setTimeout(() => void this.sync(), this.timings.initialDelayMs)], interval, cleanup };
  }

  private schedulePush() {
    const bg = this.bg;
    if (!bg) return;
    if (bg.pushTimer) clearTimeout(bg.pushTimer);
    bg.pushTimer = setTimeout(() => {
      if (this.bg) this.bg.pushTimer = undefined;
      void this.sync();
    }, this.timings.pushDelayMs);
  }

  stop(): void {
    this.startGen++;
    this.releaseLock?.();
    this.releaseLock = undefined;
    if (!this.bg) return;
    clearInterval(this.bg.interval);
    for (const t of this.bg.timers) clearTimeout(t);
    if (this.bg.pushTimer) clearTimeout(this.bg.pushTimer);
    for (const f of this.bg.cleanup) f();
    this.bg = null;
  }

  destroy(): void {
    this.stop();
    for (const off of this.offs) off();
    this.offs = [];
  }

  // ================================================================ on demand (R9)

  /**
   * Downloads a document from the repository when this device does not have its latest version
   * (a canvas segment, a book's or clipping's annotations). Waits at most a few seconds; a slower
   * download finishes in the background and merges into the open document.
   */
  async ensureDoc(docId: string): Promise<void> {
    await this.ready;
    if (!this.remote || this.paused || this.offline()) return;
    let p = this.ensuring.get(docId);
    if (!p) {
      p = this.fetchDoc(docId)
        .catch((err) => {
          if (err instanceof AuthError) this.fail(err);
        })
        .finally(() => this.ensuring.delete(docId));
      this.ensuring.set(docId, p);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([p, new Promise<void>((r) => (timer = setTimeout(r, this.timings.ensureTimeoutMs)))]);
    clearTimeout(timer);
  }

  private async fetchDoc(docId: string) {
    const st = await this.state();
    if (!st.head) await this.exclusive(() => pull(this.context(st), this.config!.branch));
    const path = pathForDoc(docId, this.deps.library);
    if (!path) return;
    const sha = st.tree[path];
    if (!sha || st.merged[path] === sha) return;
    const ctx = this.context(st);
    await mergeDoc(ctx, docId, path, sha);
    const seg = parseSegmentDocId(docId);
    if (seg) {
      await fetchSegmentAssets(ctx, seg.slug, seg.month, st.tree);
      st.assetsAt[segmentPath(seg.slug, seg.month)] = sha;
    }
    await ctx.save();
  }

  /**
   * Makes a clipping's content available on this device (R9), downloading clipping.md,
   * snapshot.html and its assets when needed. Returns false when it is not available.
   */
  async ensureClipping(id: string): Promise<boolean> {
    await this.ready;
    const { library, assets } = this.deps;
    const meta = library.clipping(id);
    if (!meta) return false;
    if (await library.clippingContent(id)) {
      void this.ensureDoc(annotationsDocId(id));
      return true;
    }
    if (!this.remote || this.paused || this.offline()) return false;
    try {
      const st = await this.state();
      if (!st.head) await this.exclusive(() => pull(this.context(st), this.config!.branch));
      const mdSha = st.tree[clippingMdPath(meta.slug)];
      if (!mdSha) return false;
      const dec = new TextDecoder();
      const markdown = parseClippingMarkdown(dec.decode(await this.remote.getBlob(mdSha)));
      const snapSha = st.tree[clippingSnapshotPath(meta.slug)];
      const snapshotHtml = snapSha ? dec.decode(await this.remote.getBlob(snapSha)) : undefined;
      const prefix = `${clippingDir(meta.slug)}/assets/`;
      const files = Object.entries(st.tree).filter(([p]) => p.startsWith(prefix));
      const list: SnapshotAsset[] = [];
      for (const [p, sha] of files) {
        const file = p.slice(prefix.length);
        const hash = file.split('.')[0];
        const mime = mimeFor(file);
        if (!(await assets.has(hash))) await assets.putWithHash(hash, new Blob([(await this.remote.getBlob(sha)) as BlobPart], { type: mime }));
        list.push({ path: `assets/${file}`, hash, mime });
      }
      await this.context(st).quietly(() => library.putClipping(meta, { markdown, snapshotHtml, assets: list }));
      if (st.tree[clippingAnnotationsPath(meta.slug)]) void this.ensureDoc(annotationsDocId(id));
      return true;
    } catch (err) {
      if (err instanceof AuthError) this.fail(err);
      return false;
    }
  }

  /** In Git LFS mode, downloads a book's file when it is not on this device (R7). */
  async ensureBookFile(id: string): Promise<boolean> {
    await this.ready;
    const book = this.deps.library.book(id);
    if (!book) return false;
    if (await this.deps.assets.has(book.fileHash)) return true;
    if (!this.remote || !this.config || this.offline()) return false;
    try {
      const st = await this.state();
      const sha = st.tree[bookFilePath(book.slug, book.format)];
      if (!sha) return false;
      const pointer = parseLfsPointer(new TextDecoder().decode(await this.remote.getBlob(sha)));
      if (!pointer) return false;
      const client = new LfsClient(lfsEndpoint(this.apiBase(), this.config.repo), this.config.token, this.deps.fetch);
      const blob = await client.download(pointer.oid, pointer.size);
      await this.deps.assets.putWithHash(book.fileHash, new Blob([await blob.arrayBuffer()], { type: book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip' }));
      return true;
    } catch (err) {
      this.warnings.push(String((err as Error)?.message ?? err));
      this.refreshStatus();
      return false;
    }
  }

  // ================================================================ rebuild

  /**
   * Clears the local cache so the app rebuilds it from the repository on the next start (the
   * repository is the source of truth). Syncs first; refuses when local changes could not be
   * pushed, unless `force`. Device secrets and preferences are kept. The caller reloads the app.
   */
  async rebuild(opts: { force?: boolean } = {}): Promise<void> {
    if (!this.remote) throw new Error('Connect to GitHub first: the cache is rebuilt from the repository.');
    await this.sync();
    if (!opts.force && (this.status.phase !== 'synced' || this.hasLocalChanges())) {
      throw new Error('Some changes are not on GitHub yet. Sync first, or rebuild anyway and lose them.');
    }
    this.stop();
    const { db, docs } = this.deps;
    await docs.flush();
    for (const id of await db.listDocIds()) await db.deleteDoc(id);
    const keep = new Set(['secrets', 'prefs', 'sync:onboarding']);
    for (const key of await db.kvKeys()) if (!keep.has(key)) await db.del(key);
    await this.deps.mirror?.clear();
    this.st = emptyState();
    await db.del(stateKey(this.remote.id));
  }
}

/** The owner-facing explanation of a sync failure. */
export function describeError(err: unknown): string {
  if (err instanceof AuthError) {
    return err.status === 401
      ? 'GitHub rejected the token (it may have expired or been revoked). Enter a new token to resume sync; your changes are kept on this device.'
      : `GitHub refused access: ${err.message.replace(/^GitHub denied access: /, '')}. Check the token's repository access and permissions.`;
  }
  if (err instanceof NotFoundError) return 'The repository or branch was not found, or the token has no access to it.';
  if (err instanceof BranchNotFoundError) return err.message;
  if (err instanceof WriteScopeError) return `Internal error: ${err.message}`;
  if (err instanceof ConflictError) return 'Another device kept pushing at the same time; sync will retry.';
  if (err instanceof GitRemoteError && err.retryAt) return `GitHub's rate limit was reached; sync resumes at ${new Date(err.retryAt).toLocaleTimeString()}.`;
  if (err instanceof TypeError) return 'Could not reach GitHub. Check the connection.';
  return String((err as Error)?.message ?? err);
}
