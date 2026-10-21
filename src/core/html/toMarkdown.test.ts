// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, htmlToText, mathmlToTex, nodeToMarkdown } from './toMarkdown';

/** KaTeX output as it appears in ChatGPT and Claude answers (MathML + annotation + HTML). */
const katex = (tex: string, display = false) => {
  const inner = `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height:0.68em;"></span><span class="mord mathnormal">x</span></span></span></span>`;
  return display ? `<span class="katex-display">${inner}</span>` : inner;
};

/** HTML put on the clipboard when an answer is selected and copied on chatgpt.com. */
const CHATGPT = `<meta charset="utf-8"><div class="markdown prose w-full break-words dark:prose-invert light"><h3>Eigenvalues of a 2×2 matrix</h3>
<p>For a matrix ${katex('A')}, the eigenvalues solve ${katex('\\det(A - \\lambda I) = 0')}:</p>
${katex('\\lambda^2 - \\operatorname{tr}(A)\\,\\lambda + \\det A = 0', true)}
<ol><li><p><strong>Compute</strong> the trace and determinant.</p></li><li><p>Solve the quadratic; see <a href="https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors" target="_new" rel="noopener">Wikipedia</a>.</p><ul><li>Real roots when the discriminant is ≥ 0</li></ul></li></ol>
<pre class="!overflow-visible"><div class="contain-inline-size rounded-md border-[0.5px] border-token-border-medium relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-[5px]">python</div><div class="sticky top-9"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-sidebar-surface-secondary text-token-text-secondary flex items-center rounded-sm px-2 font-sans text-xs"><button class="flex gap-1 items-center select-none py-1" aria-label="Copy"><svg width="24" height="24"></svg>Copy code</button></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-python"><span><span class="hljs-keyword">import</span><span> numpy </span><span class="hljs-keyword">as</span><span> np
A = np.array([[</span><span class="hljs-number">2</span><span>, </span><span class="hljs-number">1</span><span>], [</span><span class="hljs-number">1</span><span>, </span><span class="hljs-number">2</span><span>]])
</span></span></code></div></div></pre>
<table><thead><tr><th>Matrix</th><th>Eigenvalues</th></tr></thead><tbody><tr><td>${katex('I')}</td><td>1, 1</td></tr><tr><td>diag(2, 3)</td><td>2 | 3</td></tr></tbody></table>
<p>Costs $5 and uses <code>np.linalg.eig</code>.</p></div>`;

/** HTML put on the clipboard when an answer is selected and copied on claude.ai. */
const CLAUDE = `<div class="font-claude-message"><div><div class="grid-cols-1 grid gap-2.5"><p class="whitespace-pre-wrap break-words">The <strong>spectral theorem</strong> says a real symmetric matrix ${katex('S')} can be written as</p>
<div class="math math-display">${katex('S = Q \\Lambda Q^{\\top}', true)}</div>
<ul class="[&amp;:not(:last-child)_ul]:pb-1 list-disc space-y-1.5 pl-7"><li class="whitespace-normal break-words">${katex('Q')} is orthogonal,</li><li class="whitespace-normal break-words">${katex('\\Lambda')} is diagonal.</li></ul>
<div class="relative flex flex-col rounded-lg"><div class="text-text-300 absolute pl-3 pt-2.5 text-xs">python</div><div class="pointer-events-none sticky my-0.5 ml-0.5 flex items-center justify-end px-1.5 py-1 mix-blend-luminosity top-0"><div class="from-bg-300/90 to-bg-300/70 pointer-events-auto rounded-md bg-gradient-to-b p-0.5 backdrop-blur-md"><button class="flex flex-row items-center gap-1 rounded-md p-1 py-0.5 text-xs transition-opacity delay-100 text-text-300 hover:bg-bg-200 opacity-60 hover:opacity-100"><svg></svg><span class="text-text-200 pr-0.5">Copy</span></button></div></div><div><pre class="code-block__code !my-0 !rounded-lg !text-sm !leading-relaxed" style="background: transparent;"><code class="language-python" style="white-space: pre;"><span><span class="token">w</span><span>, Q = np.linalg.eigh(S)</span></span></code></pre></div></div>
<blockquote><p>Every symmetric matrix is <em>orthogonally</em> diagonalizable.</p></blockquote></div></div></div>`;

describe('HTML to Markdown for clipboard answers (L7)', () => {
  it('converts a ChatGPT answer: headings, KaTeX maths, nested lists, links, code with language, tables', () => {
    const md = htmlToMarkdown(CHATGPT);
    expect(md).toContain('### Eigenvalues of a 2×2 matrix');
    expect(md).toContain('For a matrix $A$, the eigenvalues solve $\\det(A - \\lambda I) = 0$:');
    expect(md).toContain('$$\n\\lambda^2 - \\operatorname{tr}(A)\\,\\lambda + \\det A = 0\n$$');
    expect(md).toContain('1. **Compute** the trace and determinant.');
    expect(md).toContain('2. Solve the quadratic; see [Wikipedia](https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors).');
    expect(md).toMatch(/\n {3}- Real roots when the discriminant is ≥ 0/);
    expect(md).toContain('```python\nimport numpy as np\nA = np.array([[2, 1], [1, 2]])\n```');
    expect(md).not.toMatch(/Copy code|^python$/m);
    expect(md).toContain('| Matrix | Eigenvalues |\n| --- | --- |\n| $I$ | 1, 1 |\n| diag(2, 3) | 2 \\| 3 |');
    expect(md).toContain('Costs \\$5 and uses `np.linalg.eig`.');
    // the KaTeX visual copy is not duplicated
    expect(md.match(/\\det\(A/g)).toHaveLength(1);
  });

  it('converts a Claude answer: display maths in wrappers, list maths, code label removed, quotes', () => {
    const md = htmlToMarkdown(CLAUDE);
    expect(md).toContain('The **spectral theorem** says a real symmetric matrix $S$ can be written as');
    expect(md).toContain('$$\nS = Q \\Lambda Q^{\\top}\n$$');
    expect(md).toContain('- $Q$ is orthogonal,\n- $\\Lambda$ is diagonal.');
    expect(md).toContain('```python\nw, Q = np.linalg.eigh(S)\n```');
    expect(md).not.toMatch(/^python$|Copy/m);
    expect(md).toContain('> Every symmetric matrix is *orthogonally* diagonalizable.');
  });

  it('sanitises: scripts and handlers never survive, javascript: links become text', () => {
    const md = htmlToMarkdown('<p onclick="x()">Hi <a href="javascript:alert(1)">there</a><script>alert(1)</script><img src=x onerror=alert(1)></p>');
    expect(md).toBe('Hi there');
  });

  it('plain text keeps paragraphs', () => {
    expect(htmlToText('<p>One</p><p>Two <b>bold</b></p>')).toBe('One\n\nTwo bold');
  });
});

describe('HTML to Markdown for pages (L8, S2)', () => {
  it('resolves relative links and images against the page URL and maps images', () => {
    const md = htmlToMarkdown('<p><a href="/wiki/Rank">rank</a> <a href="#sec">here</a></p><p><img src="img/fig 1.png" alt="Figure 1"></p>', {
      baseUrl: 'https://example.org/notes/page.html',
      image: (u) => (u === 'https://example.org/notes/img/fig%201.png' ? 'assets/abc.png' : null),
    });
    expect(md).toBe('[rank](https://example.org/wiki/Rank) [here](https://example.org/notes/page.html#sec)\n\n![Figure 1](assets/abc.png)');
  });

  it('drops relative links without a base so clipping.md has only absolute links', () => {
    expect(htmlToMarkdown('<a href="other.md">x</a> <img src="a.png" alt="pic">')).toBe('x pic');
  });

  it('reads LaTeX from arXiv/LaTeXML alttext, Wikipedia displaystyle, MathJax scripts and plain MathML', () => {
    const arxiv = '<p>Let <math alttext="f(x)=x^{2}" class="ltx_Math" display="inline"><semantics><mrow><mi>f</mi></mrow><annotation encoding="application/x-tex">f(x)=x^{2}</annotation></semantics></math> hold.</p>';
    expect(htmlToMarkdown(arxiv)).toBe('Let $f(x)=x^{2}$ hold.');
    const wiki = '<p><span class="mwe-math-element"><span class="mwe-math-mathml-inline"><math alttext="{\\displaystyle a^{2}+b^{2}}"><mi>a</mi></math></span><img src="x.svg" class="mwe-math-fallback-image-inline"></span></p>';
    expect(htmlToMarkdown(wiki)).toBe('$a^{2}+b^{2}$');
    const mathjax = '<p>Area <script type="math/tex">\\pi r^2</script> and <script type="math/tex; mode=display">E=mc^2</script></p>';
    expect(htmlToMarkdown(mathjax)).toBe('Area $\\pi r^2$ and\n\n$$\nE=mc^2\n$$');
    const plain = new DOMParser().parseFromString(
      '<math><mfrac><mrow><mi>a</mi><mo>+</mo><mn>1</mn></mrow><msqrt><mi>x</mi></msqrt></mfrac><msup><mi>e</mi><mi>π</mi></msup></math>',
      'text/html',
    ).querySelector('math')!;
    expect(mathmlToTex(plain)).toBe('\\frac{a + 1}{\\sqrt{x}} e^{\\pi}');
  });

  it('converts a range of a live document (lasso capture)', () => {
    document.body.innerHTML = '<article><h2>Rank</h2><p>The <em>rank</em> of a matrix.</p><ul><li>one</li><li>two</li></ul></article>';
    const r = document.createRange();
    r.setStart(document.querySelector('h2')!.firstChild!, 0);
    r.setEnd(document.querySelectorAll('li')[0].firstChild!, 3);
    expect(nodeToMarkdown(r.cloneContents())).toBe('## Rank\n\nThe *rank* of a matrix.\n\n- one');
  });

  it('task lists and escaping', () => {
    expect(htmlToMarkdown('<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>')).toBe('- [x] done\n- [ ] todo');
    expect(htmlToMarkdown('<p># not a heading and *stars*</p>')).toBe('\\# not a heading and \\*stars\\*');
  });
});
