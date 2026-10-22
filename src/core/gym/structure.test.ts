import { describe, expect, it } from 'vitest';
import { firstHeading, parseFrontMatter } from './frontmatter';
import { MemoryGymFiles } from './files';
import { GymIndex } from './index';
import { dirname, normalizePath, resolveLink, splitAnchor } from './paths';
import { isProblemPathShape, isTopicPathShape, readStructure, unitOf } from './structure';
import { GYM_FIXTURE } from './testing/fixture';

const read = async (p: string) => GYM_FIXTURE[p] ?? null;

describe('front matter (G1)', () => {
  it('reads status fields like gym\'s check.py', () => {
    const fm = parseFrontMatter('---\nstatus: active        # planned | active | done\nstarted: 2026-10-15\ncompleted:\ntitle: "Quoted"\n---\n\n# Eigenvalues\n');
    expect(fm.fields).toEqual({ status: 'active', started: '2026-10-15', completed: '', title: 'Quoted' });
    expect(fm.body).toBe('\n# Eigenvalues\n');
    expect(firstHeading(fm.body)).toBe('Eigenvalues');
  });

  it('treats files without a closed block as having no front matter', () => {
    expect(parseFrontMatter('# Title\n---\n').fields).toBeNull();
    expect(parseFrontMatter('---\nstatus: open\n').fields).toBeNull();
    expect(parseFrontMatter('---\n---\nbody').fields).toEqual({});
  });

  it('ignores headings in code fences and strips inline Markdown from titles', () => {
    expect(firstHeading('```\n# not\n```\n# The *real* [title](x.md)')).toBe('The real title');
  });
});

describe('paths (G7)', () => {
  it('resolves relative links, anchors and root-absolute links', () => {
    expect(resolveLink('math/la/eigenvalues/notes.md', '../vector-spaces/notes.md#bases')).toEqual({ path: 'math/la/vector-spaces/notes.md', anchor: 'bases' });
    expect(resolveLink('math/la/eigenvalues/notes.md', 'problems/')).toEqual({ path: 'math/la/eigenvalues/problems', anchor: '' });
    expect(resolveLink('log/2026/10.md', '../../math/la/eigenvalues/')).toEqual({ path: 'math/la/eigenvalues', anchor: '' });
    expect(resolveLink('a/b.md', '/ml/x.md')).toEqual({ path: 'ml/x.md', anchor: '' });
    expect(resolveLink('a/b.md', 'with%20space.md')).toEqual({ path: 'a/with space.md', anchor: '' });
    expect(resolveLink('a/b.md', 'https://example.com')).toBeNull();
    expect(resolveLink('a/b.md', '#x')).toBeNull();
    expect(normalizePath('/a/./b/../c/')).toBe('a/c');
    expect(dirname('README.md')).toBe('');
    expect(splitAnchor('a.md#x#y')).toEqual({ path: 'a.md', anchor: 'x#y' });
  });
});

describe('gym structure (G1)', () => {
  it('reads domains, subjects, topics and variants in index order, skipping non-domains', async () => {
    const s = await readStructure(Object.keys(GYM_FIXTURE), read);
    expect(s.domains.map((d) => d.path)).toEqual(['math', 'cs', 'ml']);
    expect(s.domains[0].title).toBe('Mathematics');
    expect(s.domains[0].subjects.map((x) => x.path)).toEqual(['math/linear-algebra', 'math/analysis']);
    expect(s.domains[0].subjects[0].topics.map((t) => t.name)).toEqual(['vector-spaces', 'eigenvalues']);
    expect(s.units.map((u) => u.path)).toEqual([
      'math/linear-algebra/vector-spaces',
      'math/linear-algebra/eigenvalues',
      'math/analysis/sequences',
      'cs/operating-systems/processes',
      'ml/architectures/transformer',
      'ml/architectures/transformer/basic',
      'ml/architectures/transformer/quantization',
    ]);
  });

  it('reads status front matter of topics and variants (status lives in variants)', async () => {
    const s = await readStructure(Object.keys(GYM_FIXTURE), read);
    const by = new Map(s.units.map((u) => [u.path, u]));
    expect(by.get('math/linear-algebra/eigenvalues')).toMatchObject({ kind: 'topic', title: 'Eigenvalues', status: 'active', started: '2026-10-15', completed: '' });
    expect(by.get('math/linear-algebra/vector-spaces')).toMatchObject({ status: 'done', completed: '2026-09-20' });
    const t = by.get('ml/architectures/transformer')!;
    expect(t).toMatchObject({ status: '', title: 'Transformer' });
    expect(t.variants.map((v) => [v.path, v.kind, v.status])).toEqual([
      ['ml/architectures/transformer/basic', 'variant', 'done'],
      ['ml/architectures/transformer/quantization', 'variant', 'active'],
    ]);
  });

  it('reads problems with their front matter', async () => {
    const s = await readStructure(Object.keys(GYM_FIXTURE), read);
    expect(s.problems.map((p) => p.path)).toContain('math/linear-algebra/eigenvalues/problems/002-trace.md');
    expect(s.problems.find((p) => p.number === '002' && p.unit.endsWith('eigenvalues'))).toMatchObject({
      title: 'Trace and eigenvalues',
      status: 'revisit',
      date: '2026-10-01',
      difficulty: 'hard',
      slug: 'trace',
    });
    expect(unitOf(s, 'ml/architectures/transformer/basic/code/transformer.md')?.path).toBe('ml/architectures/transformer/basic');
    expect(unitOf(s, 'ml/architectures/transformer/notes.md')?.path).toBe('ml/architectures/transformer');
  });

  it('orders unlisted children after listed ones and tolerates missing READMEs', async () => {
    const files = { 'math/README.md': '# M\n\n[b](b/)\n', 'math/b/t/README.md': '---\nstatus: planned\n---\n# T', 'math/a/u/notes.md': 'x' };
    const s = await readStructure(Object.keys(files), async (p) => (files as Record<string, string>)[p] ?? null);
    expect(s.domains[0].subjects.map((x) => [x.name, x.indexed])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    expect(s.units.find((u) => u.name === 'u')).toMatchObject({ title: 'u', status: '' });
  });

  it('recognises topic and problem path shapes for free-typed paths', () => {
    expect(isTopicPathShape('math/linear-algebra/eigenvalues')).toBe(true);
    expect(isTopicPathShape('ml/architectures/transformer/basic')).toBe(true);
    expect(isTopicPathShape('math/linear-algebra')).toBe(false);
    expect(isTopicPathShape('log/2026/10')).toBe(false);
    expect(isTopicPathShape('Math/x/y')).toBe(false);
    expect(isProblemPathShape('math/la/eigen/problems/004-new.md')).toBe(true);
    expect(isProblemPathShape('math/la/eigen/notes.md')).toBe(false);
  });
});

describe('GymIndex (G1, G7)', () => {
  it('lists folders and recomputes when the mirror changes', async () => {
    const files = new MemoryGymFiles({ ...GYM_FIXTURE });
    const idx = new GymIndex(files);
    expect(idx.isDir('math/linear-algebra')).toBe(true);
    expect(idx.isFile('math/linear-algebra/README.md')).toBe(true);
    expect(idx.list('math/linear-algebra/eigenvalues')).toEqual({
      dirs: ['math/linear-algebra/eigenvalues/assets', 'math/linear-algebra/eigenvalues/problems'],
      files: ['math/linear-algebra/eigenvalues/README.md', 'math/linear-algebra/eigenvalues/notes.md'],
    });
    expect(idx.list('').dirs).not.toContain('.agents');
    const before = (await idx.structure()).units.length;
    let changes = 0;
    idx.onChange.on(() => changes++);
    files.set('cs/operating-systems/memory/README.md', '---\nstatus: planned\n---\n# Memory\n', 'c2');
    expect(changes).toBe(1);
    expect(idx.commit()).toBe('c2');
    expect((await idx.structure()).units.length).toBe(before + 1);
  });

  it('normalises CRLF line endings', async () => {
    const idx = new GymIndex(new MemoryGymFiles({ 'a.md': '# A\r\nb\r\n' }));
    expect(await idx.readText('a.md')).toBe('# A\nb\n');
  });
});
