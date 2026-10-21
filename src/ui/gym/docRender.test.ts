// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { annotate, loadImages, renderGymDoc } from './docRender';
import { GYM_FIXTURE } from '../../core/gym/testing/fixture';

const NOTES = GYM_FIXTURE['math/linear-algebra/eigenvalues/notes.md'];

function mount(text: string) {
  const doc = renderGymDoc(text);
  const article = document.createElement('div');
  article.innerHTML = doc.html;
  annotate(article, doc.layout);
  return { doc, article };
}

describe('gym reader rendering (G7)', () => {
  it('tags blocks, list items, table rows and code with their source ranges', () => {
    const { article } = mount(NOTES);
    const slice = (el: Element) => NOTES.slice(Number(el.getAttribute('data-s')), Number(el.getAttribute('data-e')));
    const blocks = [...article.querySelectorAll(':scope > .gym-block')];
    expect(slice(blocks[0])).toBe('# Eigenvalues: Notes');
    expect(blocks.some((b) => slice(b).startsWith('$$\nT = \\sum'))).toBe(true);
    const items = [...article.querySelectorAll('ol > li[data-s]')].map(slice);
    expect(items).toEqual([
      '1. Find the eigenvalues as roots of the characteristic polynomial.',
      '2. Find a basis of each eigenspace.',
      '3. Stack the eigenvectors as the columns of $P$.',
    ]);
    const rows = [...article.querySelectorAll('tr[data-s]')].map(slice);
    expect(rows[0]).toBe('| Matrix | Eigenvalues |');
    expect(rows[2]).toContain('0 & 1');
    expect(article.querySelector('pre[data-code]')).not.toBeNull();
    expect(article.querySelector('.katex')).not.toBeNull();
  });

  it('numbers repeated headings like GitHub and keeps relative links for the reader', () => {
    const { article } = mount(NOTES);
    expect([...article.querySelectorAll('h2')].map((h) => h.id)).toEqual(['definitions', 'spectral-theorem', 'spectral-theorem-1']);
    expect(article.querySelector('a[data-rel="../vector-spaces/notes.md#bases"]')).not.toBeNull();
    expect(article.querySelector('a[data-anchor="definitions"]')).not.toBeNull();
  });

  it('keeps marimo front matter out of the rendered text and code cells in', () => {
    const { doc, article } = mount(GYM_FIXTURE['ml/architectures/transformer/basic/code/transformer.md']);
    expect(doc.fields).toMatchObject({ title: 'Transformer', 'marimo-version': '0.25.1' });
    expect(article.textContent).not.toContain('marimo-version');
    expect(article.querySelectorAll('pre code.language-python')).toHaveLength(2);
  });

  it('renders reference-style links in every block', () => {
    const { article } = mount('See [the notes][n].\n\n- also [here][n]\n\n[n]: ../x/notes.md\n');
    expect(article.querySelectorAll('a[data-rel="../x/notes.md"]')).toHaveLength(2);
  });

  it('loads relative images from the mirror, relative to the file, with their MIME type', async () => {
    const { article } = mount(NOTES);
    const asked: string[] = [];
    const blobs: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => (blobs.push(b), 'blob:x');
    try {
      const { done, cleanup } = loadImages(article, 'math/linear-algebra/eigenvalues/notes.md', async (p) => (asked.push(p), new Blob(['<svg/>'])));
      await Promise.race([done, new Promise((r) => setTimeout(r, 200))]);
      cleanup();
    } finally {
      URL.createObjectURL = orig;
    }
    expect(asked).toEqual(['math/linear-algebra/eigenvalues/assets/eigenvectors.svg']);
    expect(blobs[0].type).toBe('image/svg+xml');
    expect(article.querySelector('img')!.getAttribute('src')).toBe('blob:x');
  });
});
