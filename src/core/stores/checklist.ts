/**
 * Editing the To-dos page checklist (G4): a Y.Text with one Markdown task per line,
 * `- [ ] text` or `- [x] text` (see todo.ts). Every operation is a minimal Y.Text edit on
 * whole lines or on the characters that changed, so edits from several devices merge:
 * concurrent additions both survive, a toggle and a text edit of the same item both apply.
 *
 * Reading is lenient: a merge of two concurrent toggles can leave `[xx]` or `[x ]`; such an
 * item counts as checked when its box contains an x, and the next toggle rewrites the box.
 * Lines that are not tasks are kept untouched and not shown.
 */
import * as Y from 'yjs';
import { replaceText } from '../canvas/segment';

export interface ChecklistLine {
  /** position among the items (task lines only) */
  index: number;
  checked: boolean;
  /** the item's text as stored (not trimmed) */
  text: string;
  /** offsets in the text: line start, line end (before the newline), the `[` and the item text */
  lineStart: number;
  lineEnd: number;
  box: number;
  boxEnd: number;
  textStart: number;
}

const ITEM = /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([^\]\n]{0,8})\]([ \t]?)(.*)$/;

export function parseChecklist(s: string): ChecklistLine[] {
  const out: ChecklistLine[] = [];
  let pos = 0;
  for (const line of s.split('\n')) {
    const m = ITEM.exec(line);
    if (m) {
      const box = pos + m[1].length;
      const boxEnd = box + m[2].length + 2;
      out.push({
        index: out.length,
        checked: /x/i.test(m[2]),
        // untrimmed, so a trailing space survives while it is being typed
        text: m[4],
        lineStart: pos,
        lineEnd: pos + line.length,
        box,
        boxEnd,
        textStart: boxEnd + m[3].length,
      });
    }
    pos += line.length + 1;
  }
  return out;
}

const clean = (text: string) => text.replace(/\s*\n\s*/g, ' ');
const lineOf = (text: string, checked = false) => `- [${checked ? 'x' : ' '}] ${clean(text)}`;

function transact(t: Y.Text, fn: () => void) {
  if (t.doc) t.doc.transact(fn, 'local');
  else fn();
}

/** Inserts a whole line at a line boundary `at` (0, after a newline, or the end). */
function insertLine(t: Y.Text, at: number, line: string) {
  const s = t.toString();
  if (at >= s.length && s.length && !s.endsWith('\n')) t.insert(s.length, `\n${line}\n`);
  else t.insert(at, `${line}\n`);
}

/** Adds an item before item `before` (default: at the end). Returns the new item's index. */
export function addItem(t: Y.Text, text: string, before?: number): number {
  const items = parseChecklist(t.toString());
  const target = before !== undefined && before < items.length ? items[before] : undefined;
  transact(t, () => insertLine(t, target ? target.lineStart : t.length, lineOf(text)));
  return target ? before! : items.length;
}

/** Adds an item right after item `index` (Enter in an item). Returns the new item's index. */
export function addItemAfter(t: Y.Text, index: number, text = ''): number {
  return addItem(t, text, index + 1);
}

export function setChecked(t: Y.Text, index: number, checked: boolean) {
  const it = parseChecklist(t.toString())[index];
  if (!it) return;
  const want = checked ? 'x' : ' ';
  const inner = t.toString().slice(it.box + 1, it.boxEnd - 1);
  if (inner === want) return;
  transact(t, () => {
    t.delete(it.box + 1, inner.length);
    t.insert(it.box + 1, want);
  });
}

/** Replaces an item's text with a minimal edit (so concurrent typing merges). */
export function setItemText(t: Y.Text, index: number, text: string) {
  const s = t.toString();
  const it = parseChecklist(s)[index];
  if (!it) return;
  const next = s.slice(0, it.textStart) + clean(text) + s.slice(it.lineEnd);
  if (next !== s) transact(t, () => replaceText(t, s, next));
}

/** Removes an item's line. */
export function removeItem(t: Y.Text, index: number) {
  const s = t.toString();
  const it = parseChecklist(s)[index];
  if (!it) return;
  transact(t, () => {
    if (it.lineEnd < s.length) t.delete(it.lineStart, it.lineEnd - it.lineStart + 1);
    else if (it.lineStart > 0) t.delete(it.lineStart - 1, it.lineEnd - it.lineStart + 1);
    else t.delete(0, s.length);
  });
}

/**
 * Moves item `from` so it ends up at position `to` among the items. Y.Text has no move: the
 * line is deleted and re-inserted, so a concurrent edit of the moved item on another device
 * is lost (its toggle or text change applies to the deleted copy).
 */
export function moveItem(t: Y.Text, from: number, to: number) {
  const s = t.toString();
  const items = parseChecklist(s);
  const it = items[from];
  if (!it || from === to || to < 0 || to >= items.length) return;
  const line = s.slice(it.lineStart, it.lineEnd);
  const hasNl = it.lineEnd < s.length;
  const delStart = hasNl ? it.lineStart : Math.max(0, it.lineStart - 1);
  const delLen = it.lineEnd - it.lineStart + 1;
  const rest = s.slice(0, delStart) + s.slice(Math.min(s.length, delStart + delLen));
  const restItems = parseChecklist(rest);
  transact(t, () => {
    t.delete(delStart, Math.min(delLen, s.length - delStart));
    if (to < restItems.length) t.insert(restItems[to].lineStart, `${line}\n`);
    else insertLine(t, rest.length, line);
  });
}
