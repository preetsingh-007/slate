import { describe, expect, it } from 'vitest';
import { assertWriteScope, isWritablePath, WriteScopeError } from './scope';

describe('write scope (R5)', () => {
  it('allows only normalised paths under journal/ and library/', () => {
    for (const p of [
      'journal/README.md',
      'journal/queue.md',
      'journal/todo.yjs',
      'journal/main/canvas.json',
      'journal/main/2026-10/canvas.yjs',
      'journal/main/2026-10/days/2026-10-21.md',
      'library/settings.json',
      'library/books/sicp/book.json',
      'library/clippings/2026-10-21-attention/assets/0123456789abcdef.png',
    ]) {
      expect(isWritablePath(p), p).toBe(true);
    }
    for (const p of [
      '',
      'README.md',
      'AGENTS.md',
      'scripts/check.py',
      'math/linear-algebra/notes.md',
      '.github/workflows/ci.yml',
      'journal',
      'journal/',
      'journalx/a.md',
      'libraryx/a.md',
      '/journal/a.md',
      'journal//a.md',
      'journal/./a.md',
      'journal/../README.md',
      'library/../math/x.md',
      'journal\\..\\README.md',
      'journal/a\u0000.md',
      'Journal/a.md',
      // written by gym, never by the app
      'journal/formalized.md',
    ]) {
      expect(isWritablePath(p), JSON.stringify(p)).toBe(false);
    }
  });

  it('assertWriteScope throws on the first path out of scope', () => {
    expect(() => assertWriteScope(['journal/queue.md', 'library/README.md'])).not.toThrow();
    expect(() => assertWriteScope(['journal/queue.md', 'log/2026/10.md'])).toThrowError(WriteScopeError);
  });
});
