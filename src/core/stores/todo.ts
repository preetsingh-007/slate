/**
 * The To-dos page checklist (G4), stored as collaborative text in `journal/todo.yjs`:
 * a Y.Text named 'checklist' holding one Markdown task per line, `- [ ] text` or `- [x] text`.
 * Order of lines is the checklist order; checked items show in the collapsed Done list.
 */
import * as Y from 'yjs';
import { extractTasks } from '../markdown/tasks';

export function checklistText(doc: Y.Doc): Y.Text {
  return doc.getText('checklist');
}

export interface ChecklistItem {
  index: number;
  text: string;
  checked: boolean;
}

export function readChecklist(doc: Y.Doc): ChecklistItem[] {
  return extractTasks(checklistText(doc).toString()).map((t) => ({ index: t.index, text: t.text, checked: t.checked }));
}
