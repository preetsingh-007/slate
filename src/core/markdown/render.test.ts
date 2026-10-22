// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { githubSlug, renderMarkdown } from './render';
import { extractTasks, setTask } from './tasks';

describe('renderMarkdown', () => {
  it('renders maths, tasks, headings and links safely', () => {
    const html = renderMarkdown('# Spectral theorem\n\n$x^2$ and\n\n$$\\int f$$\n\n- [ ] one\n- [x] two\n\n[n](notes.md#a) [e](https://example.com) [j](javascript:alert(1))\n\n![f](assets/a.svg)<script>alert(1)</script>');
    expect(html).toContain('id="spectral-theorem"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).toMatch(/data-task="0"/);
    expect(html).toMatch(/data-task="1"[^>]*checked/);
    expect(html).toContain('data-rel="notes.md#a"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script');
    expect(html).toContain('data-rel-src="assets/a.svg"');
  });

  it('G7: removes ids and names that would clobber the DOM, and keeps heading anchors', () => {
    const html = renderMarkdown('hello <img name="querySelector" src="x"> <form name="x" id="getElementById"></form> <a id="cookie" name="cookie">c</a> <img id="createElement" src="y">\n\n## Title\n\n## Cookie\n\n## Spectral theorem\n\n<h3 data-slate-heading-id="x">raw</h3> <p data-slate-heading-id="body">p</p>');
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    expect(doc.querySelector('[name="querySelector"]')).toBeNull();
    expect(doc.querySelector('#getElementById')).toBeNull();
    expect(doc.querySelector('a#cookie, a[name="cookie"]')).toBeNull();
    expect(doc.querySelector('img#createElement')).toBeNull();
    expect([...doc.querySelectorAll('h2')].map((h) => h.id)).toEqual(['title', 'cookie', 'spectral-theorem']);
    expect(doc.querySelector('p#body')).toBeNull();
    expect(html).not.toContain('data-slate-heading-id');
  });

  it('makes GitHub heading slugs', () => {
    expect(githubSlug('Rank–nullity theorem (2.7)')).toBe('ranknullity-theorem-27');
    expect(githubSlug('Q & A')).toBe('q--a');
  });
});

describe('tasks', () => {
  it('finds and toggles tasks outside code fences', () => {
    const text = '- [ ] a\n```\n- [ ] not\n```\n  * [x] b\n1. [ ] c';
    const tasks = extractTasks(text);
    expect(tasks.map((t) => [t.text, t.checked])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
    expect(setTask(text, 1, false)).toBe('- [ ] a\n```\n- [ ] not\n```\n  * [ ] b\n1. [ ] c');
    expect(setTask(text, 2, true).endsWith('1. [x] c')).toBe(true);
  });
});
