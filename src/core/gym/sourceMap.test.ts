// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from './frontmatter';
import { findGymQuote, gymLocator, gymSourceLink } from './locator';
import { absolutizeLinks, alignAtoms, balanceInline, itemMarker, joinPieces, layoutDoc, partialRange, type Atom } from './sourceMap';
import { GYM_FIXTURE } from './testing/fixture';

const NOTES = GYM_FIXTURE['math/linear-algebra/eigenvalues/notes.md'];

describe('rendered region → Markdown source (S2, G7)', () => {
  it('lays a file out in blocks with exact source ranges', () => {
    const text = '---\ntitle: T\n---\n\n# T\n\nPara one\nline two.\n\n- a\n- b\n  - nested\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n\n```py {.marimo}\nx = 1\ny = 2\n```\n\n$$\na^2\n$$\n\n[r]: https://example.com\n';
    const fm = parseFrontMatter(text);
    const { blocks, defs } = layoutDoc(text, fm.bodyStart);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table', 'code', 'displayMath']);
    expect(blocks.map((b) => text.slice(b.start, b.end))).toEqual(['# T', 'Para one\nline two.', '- a\n- b\n  - nested', '| x | y |\n| --- | --- |\n| 1 | 2 |', '```py {.marimo}\nx = 1\ny = 2\n```', '$$\na^2\n$$']);
    expect(blocks[2].items!.map((r) => text.slice(r.start, r.end))).toEqual(['- a', '- b\n  - nested']);
    expect(blocks[3].rows!.map((r) => text.slice(r.start, r.end))).toEqual(['| x | y |', '| --- | --- |', '| 1 | 2 |']);
    expect(blocks[4].code).toMatchObject({ open: '```py {.marimo}', close: '```' });
    expect(blocks[4].code!.lines.map((r) => text.slice(r.start, r.end))).toEqual(['x = 1', 'y = 2']);
    expect(defs).toBe('[r]: https://example.com');
  });

  it('aligns rendered words and formulas with their source, keeping LaTeX', () => {
    const src = 'A **basis** of $V$ is a list in [the space](x.md) and $$\\dim V$$ ends.';
    const atoms: Atom[] = [
      { kind: 'text', text: 'A' },
      { kind: 'text', text: 'basis' },
      { kind: 'text', text: 'of' },
      { kind: 'math', tex: 'V' },
      { kind: 'text', text: 'is' },
      { kind: 'text', text: '&amp;' },
      { kind: 'text', text: 'space' },
      { kind: 'math', tex: '\\dim V' },
    ];
    const r = alignAtoms(src, 0, src.length, atoms);
    expect(r.map((x) => (x ? src.slice(x.start, x.end) : null))).toEqual(['A', 'basis', 'of', '$V$', 'is', null, 'space', '$$\\dim V$$']);
  });

  it('widens a partial selection to balanced links, emphasis and code', () => {
    const src = 'See the **very important** result in [the notes](n.md) and `code here` with $A^*$ ok.';
    const at = (w: string) => src.indexOf(w);
    const bal = (a: string, b: string) => {
      const r = balanceInline(src, at(a), at(b) + b.length, 0, src.length);
      return src.slice(r.start, r.end);
    };
    expect(bal('important', 'result')).toBe('**very important** result');
    expect(bal('result', 'the notes')).toBe('result in [the notes](n.md)');
    expect(bal('notes', 'and')).toBe('[the notes](n.md) and');
    expect(bal('here', 'with')).toBe('`code here` with');
    expect(bal('with', 'ok')).toBe('with $A^*$ ok');
  });

  it('takes a partial paragraph from its first to last selected atom', () => {
    const src = 'One two three four.';
    const atoms = src.split(' ').map((t) => ({ kind: 'text', text: t }) as Atom);
    const ranges = alignAtoms(src, 0, src.length, atoms);
    const r = partialRange(src, { start: 0, end: src.length }, ranges, [false, true, true, false])!;
    expect(src.slice(r.start, r.end)).toBe('two three');
    expect(partialRange(src, { start: 0, end: src.length }, ranges, [false, false, false, false])).toBeNull();
    expect(itemMarker('- [ ] task', { start: 0, end: 10 })).toBe('- [ ] ');
    expect(itemMarker('  12. x', { start: 0, end: 7 })).toBe('12. ');
  });

  it('joins pieces with the source separation, or newlines for skipped content', () => {
    const src = '# H\n\nPara.\n\n- a\n- b\n- c\n';
    const at = (s: string) => ({ start: src.indexOf(s), end: src.indexOf(s) + s.length });
    expect(joinPieces(src, [{ ...at('Para.'), block: 1 }, { ...at('# H'), block: 0 }])!.markdown).toBe('# H\n\nPara.');
    expect(joinPieces(src, [{ ...at('- a'), block: 2 }, { ...at('- c'), block: 2 }])!.markdown).toBe('- a\n- c');
    expect(joinPieces(src, [{ ...at('# H'), block: 0 }, { ...at('- b'), block: 2 }])).toMatchObject({ markdown: '# H\n\n- b', start: 0, end: src.indexOf('- b') + 3 });
    expect(joinPieces(src, [{ ...at('- a'), block: 2, text: '```\nx\n```' }])!.markdown).toBe('```\nx\n```');
    expect(joinPieces(src, [])).toBeNull();
  });

  it('rewrites relative links to repository paths so captured text keeps working (S2)', () => {
    const md = 'See [bases](../vector-spaces/notes.md#bases), [here](#definitions), [web](https://x.org) and ![e](assets/e.svg).\n\n```\n[keep](a.md)\n```\n`[keep](b.md)`';
    expect(absolutizeLinks(md, 'math/la/eigen/notes.md')).toBe(
      'See [bases](/math/la/vector-spaces/notes.md#bases), [here](/math/la/eigen/notes.md#definitions), [web](https://x.org) and ![e](/math/la/eigen/assets/e.svg).\n\n```\n[keep](a.md)\n```\n`[keep](b.md)`',
    );
  });
});

describe('gym locators (S5, S6)', () => {
  it('quotes the source with context and finds it again, exactly or closest', () => {
    const start = NOTES.indexOf('The theorem holds');
    const end = NOTES.indexOf('space.', start) + 6;
    const loc = gymLocator('math/linear-algebra/eigenvalues/notes.md', 'abc', NOTES, start, end);
    expect(loc).toMatchObject({ type: 'gym', path: 'math/linear-algebra/eigenvalues/notes.md', commit: 'abc' });
    expect(loc.quote.exact).toBe(NOTES.slice(start, end));
    expect(loc.quote.prefix.length).toBe(32);
    expect(findGymQuote(NOTES, loc)).toMatchObject({ start, end, exact: true });
    const edited = NOTES.replace('finite-dimensional real inner product space', 'finite-dimensional real inner-product space');
    const m = findGymQuote(edited, loc)!;
    expect(m.exact).toBe(false);
    expect(edited.slice(m.start, m.end)).toContain('The theorem holds');
    const link = gymSourceLink({ path: loc.path, title: 'Eigenvalues: Notes', commit: 'abc', sha: 's1', source: NOTES, start, end, now: 5 });
    expect(link).toMatchObject({ type: 'gym', id: loc.path, contentHash: 's1', capturedAt: 5, locator: loc });
  });
});
