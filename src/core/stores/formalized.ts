/**
 * `journal/formalized.md` (written in gym, read by the app; G6). Parsed on every pull and
 * kept locally so badges show offline.
 *
 *   - <id> → <relative gym path>[#<heading slug>] · <YYYY-MM-DD>
 *   - <id> → dismissed · <YYYY-MM-DD>
 *
 * Paths are relative to `journal/`.
 */
import type { FormalizedRecord } from '../model/types';
import type { SlateDB } from '../storage/idb';
import { Emitter } from '../util/emitter';

const LINE = /^- ([a-z0-9]+(?:-[a-z0-9]+)*) → (dismissed|[^\s#]+(?:#\S+)?) · (\d{4}-\d{2}-\d{2})\s*$/;

/** Parses formalized.md; malformed lines are skipped. A later line for the same mark wins. */
export function parseFormalized(text: string): Map<string, FormalizedRecord> {
  const out = new Map<string, FormalizedRecord>();
  for (const line of text.split('\n')) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const [, id, target, date] = m;
    if (target === 'dismissed') {
      out.set(id, { id, dismissed: true, date });
      continue;
    }
    const [rel, heading] = target.split('#');
    out.set(id, { id, dismissed: false, path: resolveFromJournal(decodeURIComponent(rel)), heading: heading || undefined, date });
  }
  return out;
}

/** Resolves a path relative to `journal/` to a repository path. */
export function resolveFromJournal(rel: string): string {
  const parts = ['journal'];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export class FormalizedStore {
  readonly onChange = new Emitter<void>();
  private records = new Map<string, FormalizedRecord>();

  private constructor(private db: SlateDB) {}

  static async open(db: SlateDB): Promise<FormalizedStore> {
    const s = new FormalizedStore(db);
    for (const r of (await db.get<FormalizedRecord[]>('formalized')) ?? []) s.records.set(r.id, r);
    return s;
  }

  get(markId: string): FormalizedRecord | undefined {
    return this.records.get(markId);
  }

  all(): Map<string, FormalizedRecord> {
    return this.records;
  }

  /** Replaces the records with a freshly parsed formalized.md. */
  async setFromText(text: string): Promise<void> {
    this.records = parseFormalized(text);
    await this.db.set('formalized', [...this.records.values()]);
    this.onChange.emit();
  }
}
