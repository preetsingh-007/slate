import { describe, expect, it } from 'vitest';
import { MemoryGymFiles } from './files';
import { headings } from './headings';
import { GymIndex } from './index';
import { search, searchDoc } from './search';
import { GYM_FIXTURE } from './testing/fixture';

describe('headings', () => {
  it('gives GitHub anchors, de-duplicated, ignoring code', () => {
    const hs = headings('# A *b*\n\n## Spectral theorem\n\n```\n# no\n```\n## Spectral theorem\n## [Link](x.md) and $x^2$');
    expect(hs.map((h) => h.slug)).toEqual(['a-b', 'spectral-theorem', 'spectral-theorem-1', 'link-and-x2']);
    expect(hs[1].offset).toBe('# A *b*\n\n'.length);
  });
});

describe('gym search (G7)', () => {
  const idx = () => new GymIndex(new MemoryGymFiles({ ...GYM_FIXTURE }));

  it('finds full text across gym, offline, pointing at the section', async () => {
    const hits = await idx().search('self-adjoint');
    expect(hits[0]).toMatchObject({ path: 'math/linear-algebra/eigenvalues/notes.md', title: 'Eigenvalues: Notes', anchor: 'spectral-theorem' });
    expect(hits[0].snippet.toLowerCase()).toContain('self-adjoint');
    const [s, e] = hits[0].marks[0];
    expect(hits[0].snippet.slice(s, e).toLowerCase()).toBe('self-adjoint');
  });

  it('ranks title matches first and requires every word', async () => {
    const hits = await idx().search('cauchy sequences');
    expect(hits[0].path).toBe('math/analysis/sequences/notes.md');
    expect((await idx().search('cauchy zebra')).length).toBe(0);
  });

  it('searches marimo notebooks and problems, but not app-owned or tooling folders', async () => {
    const i = idx();
    expect((await i.search('scaled dot-product')).map((h) => h.path)).toEqual(['ml/architectures/transformer/basic/code/transformer.md']);
    expect((await i.search('written by slate')).length).toBe(0);
    expect((await i.search('trace')).map((h) => h.path)).toContain('math/linear-algebra/eigenvalues/problems/002-trace.md');
  });

  it('uses the front matter title of notebooks', () => {
    expect(searchDoc('n.md', '---\ntitle: Transformer\n---\n\n# Other').title).toBe('Transformer');
    expect(search([searchDoc('a.md', '# Alpha\n\nbeta')], '')).toEqual([]);
  });
});
