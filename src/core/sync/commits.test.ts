import { describe, expect, it } from 'vitest';
import { journalSummary, librarySummary, planCommits, type PlannedChange } from './commits';

const b = new Uint8Array([1]);
const add = (path: string): PlannedChange => ({ path, content: b, added: true });
const upd = (path: string): PlannedChange => ({ path, content: b, added: false });
const del = (path: string): PlannedChange => ({ path, content: null, added: false });

describe('commit batching and messages (R8)', () => {
  it('summarises journal changes by canvas and month', () => {
    expect(journalSummary([upd('journal/main/2026-10/canvas.yjs'), upd('journal/main/2026-10/days/2026-10-21.md'), upd('journal/queue.md')])).toBe('Update main canvas, 2026-10');
    expect(journalSummary([upd('journal/main/2026-09/canvas.yjs'), upd('journal/main/2026-10/canvas.yjs')])).toBe('Update main canvas, 2026-09 and 2026-10');
    expect(journalSummary([add('journal/physics/canvas.json'), add('journal/physics/2026-10/canvas.yjs'), upd('journal/todo.yjs')])).toBe('Add physics canvas; update to-dos');
    expect(journalSummary([upd('journal/queue.md'), upd('journal/todos.md')])).toBe('Update queue and to-dos');
    expect(journalSummary([upd('journal/README.md')])).toBe('Update index');
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((c) => upd(`journal/canvas-${c}/2026-10/canvas.yjs`));
    const s = journalSummary(many);
    expect(s.length).toBeLessThanOrEqual(72);
    expect(s).toMatch(/^Update canvas-a canvas, 2026-10.* \(\+\d more\)$/);
  });

  it('summarises library changes by item', () => {
    expect(librarySummary([add('library/clippings/2026-10-21-attention/meta.json'), add('library/clippings/2026-10-21-attention/clipping.md'), upd('library/README.md')])).toBe('Add clipping 2026-10-21-attention');
    expect(librarySummary([upd('library/books/sicp/annotations.yjs'), upd('library/books/sicp/annotations.md')])).toBe('Update annotations of sicp');
    expect(librarySummary([upd('library/books/sicp/book.json')])).toBe('Update book sicp');
    expect(librarySummary([upd('library/settings.json')])).toBe('Update settings');
    expect(librarySummary([del('library/books/old/book.json'), del('library/books/old/annotations.yjs')])).toBe('Remove book old');
  });

  it('makes one commit per scope, library before journal', () => {
    const commits = planCommits([upd('journal/main/2026-10/canvas.yjs'), upd('library/settings.json'), upd('journal/queue.md')]);
    expect(commits.map((c) => c.message)).toEqual(['library: Update settings', 'journal: Update main canvas, 2026-10']);
    expect(commits[1].files.map((f) => f.path)).toEqual(['journal/main/2026-10/canvas.yjs', 'journal/queue.md']);
    expect(planCommits([upd('journal/todo.yjs')]).map((c) => c.message)).toEqual(['journal: Update to-dos']);
  });

  it('removes library items after the journal stops linking to them (G9)', () => {
    const removal = [del('library/books/old/book.json'), del('library/books/old/annotations.yjs')];
    expect(planCommits([...removal, upd('journal/main/2026-10/days/2026-10-21.md')]).map((c) => c.message)).toEqual(['journal: Update main canvas, 2026-10', 'library: Remove book old']);
    expect(planCommits([...removal, add('library/books/new/book.json'), upd('journal/main/2026-10/days/2026-10-21.md')]).map((c) => c.message)).toEqual([
      'library: Add book new',
      'journal: Update main canvas, 2026-10',
      'library: Remove book old',
    ]);
    expect(planCommits([...removal, upd('library/README.md')]).map((c) => c.message)).toEqual(['library: Remove book old']);
  });
});
