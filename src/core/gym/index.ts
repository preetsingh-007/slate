/**
 * Cached views over gym's files (G1, G7, G8): structure, problems, log, revision list and
 * search, recomputed when the mirror changes (after a pull). Works offline: everything is
 * read from the `GymFiles` mirror.
 */
import { Emitter } from '../util/emitter';
import type { GymEntry, GymFiles } from './files';
import { normalizeNewlines } from './frontmatter';
import { isMarkdown, isWithin } from './paths';
import { LOG_FILE, latestLogDates, parseLog, revisionList, type RevisionList } from './revision';
import { search, searchDoc, type SearchDoc, type SearchHit } from './search';
import { readStructure, type GymStructure } from './structure';

/** Folders whose Markdown is not part of gym's study material (app-owned or tooling). */
const NOT_SEARCHED = ['journal', 'library', 'templates', 'scripts'];

export interface DirListing {
  dirs: string[];
  files: string[];
}

export class GymIndex {
  readonly onChange = new Emitter<void>();
  private src!: GymFiles;
  private unsubscribe: (() => void) | null = null;
  private version = 0;
  private entryMap: Map<string, GymEntry> | null = null;
  private dirSet: Set<string> | null = null;
  private texts = new Map<string, Promise<string | null>>();
  private structureP: Promise<GymStructure> | null = null;
  private logP: Promise<Map<string, string>> | null = null;
  private docsP: Promise<SearchDoc[]> | null = null;

  constructor(files: GymFiles) {
    this.setFiles(files);
  }

  /** Switches to another mirror (the sync engine's, or a test's). */
  setFiles(files: GymFiles) {
    this.unsubscribe?.();
    this.src = files;
    this.unsubscribe = files.onChange(() => this.invalidate());
    this.invalidate();
  }

  get files(): GymFiles {
    return this.src;
  }

  /** Increments on every change of the mirror. */
  get revision(): number {
    return this.version;
  }

  commit(): string {
    return this.src.commit();
  }

  private invalidate() {
    this.version++;
    this.entryMap = null;
    this.dirSet = null;
    this.texts.clear();
    this.structureP = null;
    this.logP = null;
    this.docsP = null;
    this.onChange.emit();
  }

  entries(): Map<string, GymEntry> {
    if (!this.entryMap) {
      this.entryMap = new Map(this.src.list().map((e) => [e.path, e]));
      const dirs = new Set<string>(['']);
      for (const p of this.entryMap.keys()) for (let i = p.indexOf('/'); i >= 0; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i));
      this.dirSet = dirs;
    }
    return this.entryMap;
  }

  entry(path: string): GymEntry | undefined {
    return this.entries().get(path);
  }

  isFile(path: string): boolean {
    return this.entries().has(path);
  }

  isDir(path: string): boolean {
    this.entries();
    return this.dirSet!.has(path);
  }

  /** Immediate sub-folders and files of a folder (dot-entries hidden), sorted. */
  list(dir: string): DirListing {
    const dirs = new Set<string>();
    const files: string[] = [];
    const prefix = dir ? `${dir}/` : '';
    for (const p of this.entries().keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const i = rest.indexOf('/');
      if (rest.startsWith('.')) continue;
      if (i < 0) files.push(p);
      else dirs.add(prefix + rest.slice(0, i));
    }
    return { dirs: [...dirs].sort(), files: files.sort() };
  }

  /** A file's text with normalised line endings (cached until the mirror changes). */
  readText(path: string): Promise<string | null> {
    let p = this.texts.get(path);
    if (!p) {
      p = this.src.readText(path).then((t) => (t === null ? null : normalizeNewlines(t)));
      this.texts.set(path, p);
    }
    return p;
  }

  readBlob(path: string): Promise<Blob | null> {
    return this.src.readBlob(path);
  }

  structure(): Promise<GymStructure> {
    return (this.structureP ??= readStructure(this.entries().keys(), (p) => this.readText(p)));
  }

  /** Latest log date per topic or variant (G8). */
  logDates(): Promise<Map<string, string>> {
    return (this.logP ??= (async () => {
      const structure = await this.structure();
      const sections = [];
      for (const p of [...this.entries().keys()].filter((p) => LOG_FILE.test(p)).sort()) sections.push(...parseLog(p, (await this.readText(p)) ?? ''));
      return latestLogDates(structure, sections);
    })());
  }

  async revisionList(): Promise<RevisionList> {
    const [structure, dates] = await Promise.all([this.structure(), this.logDates()]);
    return revisionList(structure, dates);
  }

  private searchDocs(): Promise<SearchDoc[]> {
    return (this.docsP ??= (async () => {
      const paths = [...this.entries().keys()].filter((p) => isMarkdown(p) && !p.split('/').some((s) => s.startsWith('.')) && !NOT_SEARCHED.some((d) => isWithin(p, d)));
      const docs = await Promise.all(paths.map(async (p) => searchDoc(p, (await this.readText(p)) ?? '')));
      return docs;
    })());
  }

  /** Searches titles, paths and text of gym's Markdown (G7). */
  async search(q: string, limit?: number): Promise<SearchHit[]> {
    return search(await this.searchDocs(), q, limit);
  }
}
