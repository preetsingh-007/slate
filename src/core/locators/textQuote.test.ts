import { describe, expect, it } from 'vitest';
import { findQuote, makeQuote } from './textQuote';

const doc = 'The rank of a matrix equals the dimension of its column space. The rank of a map is the dimension of its image.';

describe('text quote re-anchoring (S5, S6)', () => {
  it('finds an exact quote and disambiguates repeats by context', () => {
    const start = doc.lastIndexOf('The rank');
    const q = makeQuote(doc, start, start + 'The rank'.length);
    const m = findQuote(doc, q)!;
    expect(m.exact).toBe(true);
    expect(m.start).toBe(start);
  });

  it('ignores whitespace differences', () => {
    const m = findQuote('equals   the\ndimension', { exact: 'equals the dimension', prefix: '', suffix: '' })!;
    expect(m).toMatchObject({ start: 0, exact: true });
  });

  it('falls back to the closest match when the text changed', () => {
    const edited = doc.replace('dimension of its column space', 'dimension of the column space');
    const m = findQuote(edited, { exact: 'equals the dimension of its column space', prefix: 'The rank of a matrix ', suffix: '.' })!;
    expect(m.exact).toBe(false);
    expect(edited.slice(m.start, m.end)).toContain('dimension of the column');
    expect(m.score).toBeGreaterThan(0.8);
  });

  it('returns null when nothing is similar', () => {
    expect(findQuote(doc, { exact: 'quantum chromodynamics lattice', prefix: '', suffix: '' })).toBeNull();
  });
});
