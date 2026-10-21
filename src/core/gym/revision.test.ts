import { describe, expect, it } from 'vitest';
import { MemoryGymFiles } from './files';
import { GymIndex } from './index';
import { latestLogDates, parseLog, revisionList } from './revision';
import { readStructure } from './structure';
import { GYM_FIXTURE } from './testing/fixture';

describe('study log (G8)', () => {
  it('parses dated sections and resolves their links relative to the log file', () => {
    const s = parseLog(
      'log/2026/10.md',
      '# 2026-10\n\n## 2026-10-15\n\n- [math/la/eigen](../../math/la/eigen/): Read 5A.\n- [x](../../cs/os/processes/notes.md): Notes.\n\n```\n## 2026-10-16\n- [no](../../no/)\n```\n\n## Not a date\n\n- [skip](../../skip/)\n\n## 2026-10-17\n\n* [ml](../../ml/a/t/basic/)\n',
    );
    expect(s).toEqual([
      { date: '2026-10-15', file: 'log/2026/10.md', links: ['math/la/eigen', 'cs/os/processes/notes.md'] },
      { date: '2026-10-17', file: 'log/2026/10.md', links: ['ml/a/t/basic'] },
    ]);
  });

  it('credits the latest entry to the topic, and topic-level entries to its variants', async () => {
    const structure = await readStructure(Object.keys(GYM_FIXTURE), async (p) => GYM_FIXTURE[p] ?? null);
    const sections = ['log/2026/08.md', 'log/2026/09.md', 'log/2026/10.md'].flatMap((f) => parseLog(f, GYM_FIXTURE[f]));
    sections.push({ date: '2026-10-20', file: 'log/2026/10.md', links: ['ml/architectures/transformer/notes.md'] });
    const dates = latestLogDates(structure, sections);
    expect(dates.get('math/analysis/sequences')).toBe('2026-09-02');
    expect(dates.get('math/linear-algebra/vector-spaces')).toBe('2026-09-20');
    expect(dates.get('math/linear-algebra/eigenvalues')).toBe('2026-10-16');
    expect(dates.get('ml/architectures/transformer/basic')).toBe('2026-10-20');
    expect(dates.get('ml/architectures/transformer/quantization')).toBe('2026-10-20');
  });
});

describe('revision list (G8)', () => {
  it('lists revisit problems oldest first, then open problems, then done topics by latest log entry', async () => {
    const list = await new GymIndex(new MemoryGymFiles({ ...GYM_FIXTURE })).revisionList();
    expect(list.revisit.map((p) => p.path)).toEqual([
      'math/linear-algebra/vector-spaces/problems/002-union-of-subspaces.md',
      'math/linear-algebra/eigenvalues/problems/002-trace.md',
    ]);
    expect(list.open.map((p) => p.path)).toEqual(['math/linear-algebra/eigenvalues/problems/001-diagonal-matrix.md']);
    expect(list.done.map((t) => [t.unit.path, t.lastLogged])).toEqual([
      ['math/analysis/sequences', '2026-09-02'],
      ['math/linear-algebra/vector-spaces', '2026-09-20'],
      ['ml/architectures/transformer/basic', '2026-10-12'],
    ]);
  });

  it('puts never-logged done topics first and undated problems last', async () => {
    const files: Record<string, string> = {
      'm/s/a/README.md': '---\nstatus: done\nstarted: 2026-01-01\ncompleted: 2026-02-01\n---\n# A',
      'm/s/b/README.md': '---\nstatus: done\nstarted: 2026-01-01\ncompleted: 2026-01-15\n---\n# B',
      'm/s/b/problems/001-x.md': '---\nstatus: revisit\ndate:\n---\n# X',
      'm/s/b/problems/002-y.md': '---\nstatus: revisit\ndate: 2026-03-01\n---\n# Y',
      'log/2026/03.md': '## 2026-03-02\n\n- [b](../../m/s/b/): x\n',
    };
    const structure = await readStructure(Object.keys(files), async (p) => files[p] ?? null);
    const dates = latestLogDates(structure, parseLog('log/2026/03.md', files['log/2026/03.md']));
    const list = revisionList(structure, dates);
    expect(list.done.map((t) => t.unit.name)).toEqual(['a', 'b']);
    expect(list.revisit.map((p) => p.number)).toEqual(['002', '001']);
  });
});
