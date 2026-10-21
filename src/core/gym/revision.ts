/**
 * The revision list (G8) and gym's study log (`log/YYYY/MM.md`).
 *
 * Log format (gym README, Log): one `## YYYY-MM-DD` section per day; one bullet per activity
 * with a relative link to the topic. A topic's latest log entry is the latest section whose
 * bullets link to it (or into it: its notes, a problem). A link to a topic with variants
 * counts for each of its variants.
 *
 * Revision order: problems with `status: revisit` (oldest `date` first), then `status: open`
 * (oldest first); then topics and variants with `status: done`, by their latest log entry,
 * oldest first (never logged first, as the longest unrevised).
 */
import { normalizeNewlines } from './frontmatter';
import { linkTargets, unitOf, type GymProblem, type GymStructure, type GymUnit } from './structure';

export const LOG_FILE = /^log\/(\d{4})\/(0[1-9]|1[0-2])\.md$/;

export interface LogSection {
  date: string;
  file: string;
  /** repository paths linked from the section's bullets */
  links: string[];
}

/** Sections of one log file. Headings that are not dates in the file's month are ignored. */
export function parseLog(file: string, text: string): LogSection[] {
  const out: LogSection[] = [];
  let cur: { date: string; lines: string[] } | null = null;
  let fence: string | null = null;
  const flush = () => {
    if (cur) out.push({ date: cur.date, file, links: linkTargets(file, cur.lines.join('\n')) });
  };
  for (const line of normalizeNewlines(text).split('\n')) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      fence = fence ? (f[1] === fence ? null : fence) : f[1];
      continue;
    }
    if (!fence && line.startsWith('## ')) {
      flush();
      const date = line.slice(3).trim();
      cur = /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, lines: [] } : null;
      continue;
    }
    if (cur && !fence && /^\s*[-*+]\s/.test(line)) cur.lines.push(line);
    else if (cur && !fence && /^\s{2,}\S/.test(line) && cur.lines.length) cur.lines.push(line); // bullet continuation
  }
  flush();
  return out;
}

/** Latest log date per topic or variant path. */
export function latestLogDates(structure: Pick<GymStructure, 'units'>, sections: LogSection[]): Map<string, string> {
  const out = new Map<string, string>();
  const credit = (path: string, date: string) => {
    const prev = out.get(path);
    if (!prev || date > prev) out.set(path, date);
  };
  for (const s of sections) {
    for (const link of s.links) {
      const unit = unitOf(structure, link);
      if (!unit) continue;
      credit(unit.path, s.date);
      // a link to (or into the shared part of) a topic with variants revises every variant
      for (const v of unit.variants) credit(v.path, s.date);
    }
  }
  return out;
}

export interface RevisionTopic {
  unit: GymUnit;
  /** latest log date, or null when the topic was never logged */
  lastLogged: string | null;
}

export interface RevisionList {
  revisit: GymProblem[];
  open: GymProblem[];
  done: RevisionTopic[];
}

const byDate = (a: GymProblem, b: GymProblem) => {
  // problems without a date go last: their age is unknown
  if (!a.date !== !b.date) return a.date ? -1 : 1;
  return a.date.localeCompare(b.date) || a.path.localeCompare(b.path);
};

export function revisionList(structure: GymStructure, logDates: Map<string, string>): RevisionList {
  const revisit = structure.problems.filter((p) => p.status === 'revisit').sort(byDate);
  const open = structure.problems.filter((p) => p.status === 'open').sort(byDate);
  const done = structure.units
    .filter((u) => u.status === 'done')
    .map((unit) => ({ unit, lastLogged: logDates.get(unit.path) ?? null }))
    .sort((a, b) => {
      if (a.lastLogged !== b.lastLogged) {
        if (a.lastLogged === null) return -1;
        if (b.lastLogged === null) return 1;
        return a.lastLogged.localeCompare(b.lastLogged);
      }
      return (a.unit.completed || '').localeCompare(b.unit.completed || '') || a.unit.path.localeCompare(b.unit.path);
    });
  return { revisit, open, done };
}
