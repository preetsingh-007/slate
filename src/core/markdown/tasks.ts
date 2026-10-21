/**
 * `- [ ]` / `- [x]` task items in Markdown text (C7, G4). Task n is the n-th task item in
 * the source outside code fences, matching `data-task="n"` in rendered HTML.
 */

export interface TaskItem {
  index: number;
  /** 0-based line number */
  line: number;
  checked: boolean;
  text: string;
  /** offset of the `[` in the source, for toggling */
  offset: number;
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s?(.*)$/;
const FENCE = /^\s*(```|~~~)/;

export function extractTasks(text: string): TaskItem[] {
  const out: TaskItem[] = [];
  let inFence: string | null = null;
  let offset = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      if (!inFence) inFence = f[1];
      else if (f[1] === inFence) inFence = null;
    } else if (!inFence) {
      const m = TASK.exec(line);
      if (m) out.push({ index: out.length, line: i, checked: m[2] !== ' ', text: m[3].trim(), offset: offset + m[1].length });
    }
    offset += line.length + 1;
  }
  return out;
}

/** Returns the text with task `index` set to `checked` (unchanged when there is no such task). */
export function setTask(text: string, index: number, checked: boolean): string {
  const t = extractTasks(text)[index];
  if (!t) return text;
  return text.slice(0, t.offset) + (checked ? '[x]' : '[ ]') + text.slice(t.offset + 3);
}
