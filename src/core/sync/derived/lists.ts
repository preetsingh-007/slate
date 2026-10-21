/**
 * `journal/queue.md` and `journal/todos.md` (G5, G4).
 *
 * queue.md: one line per mark not listed in `formalized.md`, oldest first:
 *   - [<id>](<relative path to the mark .md>) · <kind> · <topic or "no topic"> · <YYYY-MM-DD>
 *
 * todos.md: `## Checklist` (the To-dos page's unchecked items, `- [ ] <text>`) and
 * `## From the canvas` (one line per unchecked canvas to-do,
 * `- [ ] <text> · [<YYYY-MM-DD>](<relative path to the day file>)`), grouped by day, newest
 * day first, in reading order within a day.
 *
 * A device may not have every canvas segment locally (R9: segments download when opened). Lines
 * for segments it does not have are carried over from the repository's current file, which the
 * device that last pushed those segments generated from them.
 */
import type { MarkKind } from '../../model/types';
import { extractTasks } from '../../markdown/tasks';
import { QUEUE_PATH, TODOS_PATH, relativeLink, resolveLink } from '../paths';

export interface QueueEntry {
  id: string;
  kind: MarkKind;
  topic: string;
  created: number;
  /** repository path of the mark's .md */
  path: string;
  /** the mark's day, YYYY-MM-DD */
  date: string;
}

export function queueLine(e: QueueEntry): string {
  return `- [${e.id}](${relativeLink(QUEUE_PATH, e.path)}) · ${e.kind} · ${e.topic || 'no topic'} · ${e.date}`;
}

const QUEUE_LINE = /^- \[([a-z0-9]+(?:-[a-z0-9]+)*)\]\(([^)\s]+)\) · (note|problem|solution|question) · (.+) · (\d{4}-\d{2}-\d{2})$/;

export interface QueueLine {
  id: string;
  /** repository path of the mark's .md */
  path: string;
  date: string;
  line: string;
}

export function parseQueue(text: string): QueueLine[] {
  const out: QueueLine[] = [];
  for (const line of text.split('\n')) {
    const m = QUEUE_LINE.exec(line);
    if (!m) continue;
    const path = resolveLink(QUEUE_PATH, m[2]);
    if (path) out.push({ id: m[1], path, date: m[5], line });
  }
  return out;
}

/** queue.md from this device's marks plus lines carried over (already formatted). */
export function queueMarkdown(entries: QueueEntry[], carried: QueueLine[] = []): string {
  const rows: { date: string; created: number; id: string; line: string }[] = [
    ...entries.map((e) => ({ date: e.date, created: e.created, id: e.id, line: queueLine(e) })),
    // carried lines know only their date; order them by date among the rest
    ...carried.map((c) => ({ date: c.date, created: Number.NaN, id: c.id, line: c.line })),
  ];
  rows.sort((a, b) => a.date.localeCompare(b.date) || (Number.isNaN(a.created) || Number.isNaN(b.created) ? 0 : a.created - b.created) || (a.id < b.id ? -1 : 1));
  return ['# Queue', '', ...rows.map((r) => r.line)].join('\n').replace(/\n+$/, '') + '\n';
}

export interface CanvasTodo {
  text: string;
  date: string;
  /** repository path of the day file */
  dayPath: string;
  /** reading order within the day */
  y: number;
  x: number;
}

export interface TodosLine {
  dayPath: string;
  date: string;
  line: string;
}

/** Unchecked to-dos in Markdown text (outside code fences). */
export function uncheckedTasks(text: string): string[] {
  return extractTasks(text)
    .filter((t) => !t.checked && t.text.trim())
    .map((t) => t.text.trim());
}

export function todoLine(t: CanvasTodo): string {
  return `- [ ] ${t.text} · [${t.date}](${relativeLink(TODOS_PATH, t.dayPath)})`;
}

const TODO_LINE = /^- \[ \] (.*) · \[(\d{4}-\d{2}-\d{2})\]\(([^)\s]+)\)$/;

/** The "From the canvas" lines of a todos.md. */
export function parseTodos(text: string): TodosLine[] {
  const out: TodosLine[] = [];
  let inCanvas = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) inCanvas = line.trim() === '## From the canvas';
    if (!inCanvas) continue;
    const m = TODO_LINE.exec(line);
    if (!m) continue;
    const dayPath = resolveLink(TODOS_PATH, m[3]);
    if (dayPath) out.push({ dayPath, date: m[2], line });
  }
  return out;
}

export function todosMarkdown(checklist: readonly string[], canvas: readonly CanvasTodo[], carried: readonly TodosLine[] = []): string {
  const rows = [
    ...canvas.map((t, i) => ({ date: t.date, key: t.dayPath, y: t.y, x: t.x, i, line: todoLine(t) })),
    ...carried.map((c, i) => ({ date: c.date, key: c.dayPath, y: 0, x: 0, i: canvas.length + i, line: c.line })),
  ];
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key) || a.y - b.y || a.x - b.x || a.i - b.i);
  const out = ['# To-dos', '', '## Checklist', ''];
  for (const t of checklist) out.push(`- [ ] ${t}`);
  if (checklist.length) out.push('');
  out.push('## From the canvas', '');
  for (const r of rows) out.push(r.line);
  return out.join('\n').replace(/\n+$/, '') + '\n';
}
