import { describe, expect, it } from 'vitest';
import { parseFormalized, resolveFromJournal } from './formalized';

describe('formalized.md (G6)', () => {
  it('parses formalized and dismissed lines, later lines winning', () => {
    const recs = parseFormalized(
      [
        '# Formalized',
        '',
        '- abc123 → ../math/linear-algebra/eigenvalues/notes.md#spectral-theorem · 2026-10-22',
        '- def456 → dismissed · 2026-10-22',
        '- ghi789 → ../math/linear-algebra/eigenvalues/problems/005-trace.md · 2026-10-23',
        'garbage line',
        '- def456 → ../cs/os/notes.md · 2026-10-24',
      ].join('\n'),
    );
    expect(recs.get('abc123')).toEqual({ id: 'abc123', dismissed: false, path: 'math/linear-algebra/eigenvalues/notes.md', heading: 'spectral-theorem', date: '2026-10-22' });
    expect(recs.get('ghi789')).toMatchObject({ path: 'math/linear-algebra/eigenvalues/problems/005-trace.md', heading: undefined });
    expect(recs.get('def456')).toMatchObject({ dismissed: false, path: 'cs/os/notes.md' });
    expect(recs.size).toBe(3);
  });

  it('resolves paths relative to journal/', () => {
    expect(resolveFromJournal('../a/b.md')).toBe('a/b.md');
    expect(resolveFromJournal('main/2026-10/marks/x.md')).toBe('journal/main/2026-10/marks/x.md');
  });
});
