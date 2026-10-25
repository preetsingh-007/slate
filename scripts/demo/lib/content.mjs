/**
 * Demo content: the gym repository the mocked GitHub serves, a paper (PDF printed by
 * Chromium), a small EPUB textbook, a photo of a board, a web article for New from link and a
 * chatbot answer for New from clipboard. All of it is made up for the demo; nothing is fetched.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { GYM_FIXTURE } from '../../../src/core/gym/testing/fixture.ts';
import { handwrite, roughArrow, roughRect } from './handwriting.mjs';

const require = createRequire(import.meta.url);
const katex = require('katex');
const KATEX_CSS = pathToFileURL(require.resolve('katex/dist/katex.min.css')).href;

export const tex = (s, display = false) => katex.renderToString(s, { displayMode: display, output: 'htmlAndMathml', throwOnError: false });

// ------------------------------------------------------------------ gym repository
const EIGEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240" font-family="Helvetica, Arial, sans-serif">
<rect width="420" height="240" fill="#fbfaf7"/>
<g stroke="#c9ced6" stroke-width="1">${Array.from({ length: 9 }, (_, i) => `<line x1="${30 + i * 45}" y1="10" x2="${30 + i * 45}" y2="230"/>`).join('')}${Array.from({ length: 5 }, (_, i) => `<line x1="10" y1="${30 + i * 45}" x2="410" y2="${30 + i * 45}"/>`).join('')}</g>
<line x1="20" y1="210" x2="405" y2="210" stroke="#57606a" stroke-width="1.5"/><line x1="40" y1="230" x2="40" y2="15" stroke="#57606a" stroke-width="1.5"/>
<defs><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>
<line x1="40" y1="210" x2="140" y2="160" stroke="#2f6fde" stroke-width="4" marker-end="url(#h)"/>
<line x1="40" y1="210" x2="250" y2="105" stroke="#c93a32" stroke-width="3" stroke-dasharray="7 5" marker-end="url(#h)"/>
<line x1="40" y1="210" x2="110" y2="80" stroke="#8a63d2" stroke-width="4" marker-end="url(#h)"/>
<line x1="40" y1="210" x2="215" y2="40" stroke="#8a63d2" stroke-width="2" stroke-dasharray="4 4" opacity=".6" marker-end="url(#h)"/>
<text x="120" y="186" fill="#2f6fde" font-size="17" font-style="italic">v</text>
<text x="252" y="100" fill="#c93a32" font-size="17" font-style="italic">Av = 2v</text>
<text x="76" y="86" fill="#8a63d2" font-size="17" font-style="italic">w</text>
<text x="220" y="40" fill="#8a63d2" font-size="17" font-style="italic">Aw</text>
<text x="300" y="200" fill="#57606a" font-size="13">eigenvectors keep their direction</text>
</svg>`;

const EIGEN_NOTES = `# Eigenvalues: Notes

## Definitions

Suppose $T \\in \\mathcal{L}(V)$. A number $\\lambda \\in \\mathbf{F}$ is an **eigenvalue** of $T$ if there exists $v \\in V$ such that $v \\neq 0$ and $Tv = \\lambda v$. Such a $v$ is an **eigenvector** of $T$ corresponding to $\\lambda$.

A basis is defined in [Vector Spaces](../vector-spaces/notes.md#bases); see also [problem 1](problems/001-diagonal-matrix.md).

![Eigenvectors keep their direction](assets/eigenvectors.svg)

## Characteristic polynomial

For a square matrix $A$, the eigenvalues are the roots of

$$
p_A(\\lambda) = \\det(A - \\lambda I).
$$

For $A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$ we get $p_A(\\lambda) = (2-\\lambda)^2 - 1 = (\\lambda - 1)(\\lambda - 3)$, so the eigenvalues are $1$ and $3$.

## Trace and determinant

If $\\lambda_1, \\dots, \\lambda_n$ are the eigenvalues of $A$, counted with multiplicity, then

$$
\\operatorname{tr} A = \\sum_{i=1}^{n} \\lambda_i, \\qquad \\det A = \\prod_{i=1}^{n} \\lambda_i .
$$

Check: for the matrix above, $\\operatorname{tr} A = 4 = 1 + 3$ and $\\det A = 3 = 1 \\cdot 3$.

## Diagonalization

| Matrix | Eigenvalues | Diagonalizable |
| --- | --- | --- |
| $\\begin{pmatrix} 2 & 0 \\\\ 0 & 3 \\end{pmatrix}$ | $2, 3$ | yes |
| $\\begin{pmatrix} 1 & 1 \\\\ 0 & 1 \\end{pmatrix}$ | $1, 1$ | no |

1. Find the eigenvalues as roots of $p_A$.
2. Find a basis of each eigenspace $E(\\lambda, A) = \\operatorname{null}(A - \\lambda I)$.
3. Stack the eigenvectors as the columns of $P$; then $A = P D P^{-1}$.

\`\`\`python
import numpy as np
A = np.array([[2.0, 1.0], [1.0, 2.0]])
values, vectors = np.linalg.eig(A)
print(values)  # [3. 1.]
\`\`\`

## Spectral theorem

Every self-adjoint operator $T$ on a finite-dimensional real inner product space has an orthonormal basis of eigenvectors $e_1, \\dots, e_n$:

$$
T = \\sum_{i=1}^{n} \\lambda_i \\, e_i e_i^{*}.
$$
`;

export function gymFiles() {
  const files = { ...GYM_FIXTURE };
  files['math/linear-algebra/eigenvalues/notes.md'] = EIGEN_NOTES;
  files['math/linear-algebra/eigenvalues/assets/eigenvectors.svg'] = EIGEN_SVG;
  files['journal/formalized.md'] = '# Formalized\n\nMarks from Slate that have been formalized, one per line.\n';
  files['log/2026/10.md'] += `
## 2026-10-20

- [math/linear-algebra/eigenvalues](../../math/linear-algebra/eigenvalues/notes.md): Characteristic polynomial; started the trace problem.
`;
  return files;
}

// ------------------------------------------------------------------ paper (PDF)
const PAPER_TITLE = 'Spectral Clustering of Study Graphs';

const graphSvg = () => {
  const A = [[40, 50], [95, 30], [70, 105], [130, 80], [30, 140], [110, 150]];
  const B = [[230, 45], [290, 30], [260, 100], [320, 85], [240, 150], [305, 145]];
  const eA = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [1, 2], [2, 5]];
  const line = (p, q, c, w = 1.4) => `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${c}" stroke-width="${w}"/>`;
  const edges = [...eA.map(([i, j]) => line(A[i], A[j], '#8c959f')), ...eA.map(([i, j]) => line(B[i], B[j], '#8c959f')), line(A[3], B[2], '#c93a32', 2), line(A[5], B[4], '#c93a32', 2)];
  const node = (p, c) => `<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="${c}" stroke="#fff" stroke-width="2"/>`;
  return `<svg viewBox="0 0 350 180" width="100%"><rect width="350" height="180" fill="#fff"/>${edges.join('')}${A.map((p) => node(p, '#2f6fde')).join('')}${B.map((p) => node(p, '#e07b24')).join('')}<line x1="185" y1="8" x2="185" y2="172" stroke="#c93a32" stroke-dasharray="5 4" stroke-width="1.5"/><text x="191" y="170" font-size="11" fill="#c93a32" font-family="serif" font-style="italic">Fiedler cut</text></svg>`;
};

const barsSvg = () => {
  const vals = [0, 0.18, 1.9, 2.4, 2.7, 3.1, 3.3, 3.8, 4.2, 4.6, 5.0, 5.6];
  const bars = vals.map((v, i) => `<rect x="${30 + i * 26}" y="${150 - v * 24}" width="16" height="${Math.max(1, v * 24)}" fill="${i === 1 ? '#c93a32' : '#2f6fde'}"/>`).join('');
  return `<svg viewBox="0 0 350 180" width="100%"><rect width="350" height="180" fill="#fff"/><line x1="24" y1="150" x2="340" y2="150" stroke="#57606a"/><line x1="24" y1="150" x2="24" y2="10" stroke="#57606a"/>${bars}<text x="70" y="128" font-size="11" fill="#c93a32" font-family="serif" font-style="italic">λ₂ ≈ 0.18</text><text x="150" y="172" font-size="11" fill="#57606a" font-family="serif">index i of λᵢ</text></svg>`;
};

function paperHtml() {
  const p = (s) => `<p>${s}</p>`;
  const m = (s) => tex(s);
  const M = (s) => `<div class="eq">${tex(s, true)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${PAPER_TITLE}</title>
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
@page { size: Letter; margin: 0.8in 0.75in; }
body { font-family: "Liberation Serif", "Times New Roman", serif; font-size: 10.2pt; line-height: 1.32; color: #111; margin: 0; }
h1 { font-size: 19pt; text-align: center; margin: 0 0 8pt; font-weight: bold; }
.authors { text-align: center; font-size: 11pt; } .aff { text-align: center; font-size: 9pt; color: #333; margin-bottom: 14pt; }
.abstract { margin: 0 0.45in 14pt; font-size: 9.4pt; } .abstract b { display: block; text-align: center; margin-bottom: 3pt; }
.cols { column-count: 2; column-gap: 0.3in; text-align: justify; hyphens: auto; }
h2 { font-size: 11.5pt; margin: 10pt 0 4pt; break-after: avoid; } p { margin: 0 0 6pt; text-indent: 0; }
figure { margin: 6pt 0 8pt; break-inside: avoid; } figcaption { font-size: 8.8pt; margin-top: 3pt; }
.eq { margin: 4pt 0 6pt; } .katex { font-size: 1.02em; }
table { border-collapse: collapse; font-size: 9pt; margin: 4pt auto 8pt; } td, th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2pt 7pt; }
.pb { break-before: page; }
</style></head><body>
<h1>${PAPER_TITLE}</h1>
<div class="authors">Maya Rivera and Jonas Chen</div>
<div class="aff">Department of Mathematics, Example University</div>
<div class="abstract"><b>Abstract</b>A course is a graph: topics are vertices and prerequisites are edges. We show that the second smallest eigenvalue of the graph Laplacian measures how tightly a syllabus hangs together, and that the signs of its eigenvector split a course into two halves that can be studied almost independently. On twelve undergraduate courses the split agrees with the instructors' own module boundaries in 83% of the topics.</div>
<div class="cols">
<h2>1 Introduction</h2>
${p('Students rarely meet a subject in the order in which it was written down. They jump between chapters, revisit prerequisites, and connect ideas across courses. A study plan that respects this structure should know which topics depend on each other, and which groups of topics can be learned on their own.')}
${p(`We model a course as an undirected graph ${m('G = (V, E)')} whose vertices are topics and whose edges join topics that appear together in exercises. Let ${m('A')} be its adjacency matrix and ${m('D')} the diagonal matrix of degrees. The <i>graph Laplacian</i> is`)}
${M('L = D - A.')}
${p(`The matrix ${m('L')} is symmetric and positive semidefinite, so its eigenvalues are real and satisfy ${m('0 = \\lambda_1 \\le \\lambda_2 \\le \\dots \\le \\lambda_n')}.`)}
<figure>${graphSvg()}<figcaption><b>Figure 1.</b> A study graph with two clusters of topics. The sign of the Fiedler vector separates them; only two edges (red) cross the cut.</figcaption></figure>
<h2>2 The Fiedler vector</h2>
${p(`The second eigenvalue ${m('\\lambda_2')}, the <i>algebraic connectivity</i>, is zero exactly when the graph is disconnected. By the Courant–Fischer theorem it is the minimum of the Rayleigh quotient over vectors orthogonal to the constant vector:`)}
${M('\\lambda_2 = \\min_{x \\perp \\mathbf{1}} \\frac{x^{\\top} L x}{x^{\\top} x}.')}
${p(`A minimizer is the <i>Fiedler vector</i>. Since ${m('x^{\\top} L x = \\sum_{(i,j) \\in E} (x_i - x_j)^2')}, it assigns nearby values to connected topics, and splitting the vertices by its sign cuts few edges.`)}
<figure>${barsSvg()}<figcaption><b>Figure 2.</b> Spectrum of the Laplacian of the course in Figure 1. The small gap after ${m('\\lambda_1 = 0')} signals two weakly linked modules.</figcaption></figure>
<h2>3 Results</h2>
${p('We built graphs for twelve courses from their exercise sheets and compared the sign split with the module boundaries chosen by the instructors.')}
<table><tr><th>Course</th><th>Topics</th><th>${m('\\lambda_2')}</th><th>Agreement</th></tr><tr><td>Linear algebra</td><td>38</td><td>0.21</td><td>89%</td></tr><tr><td>Real analysis</td><td>41</td><td>0.34</td><td>81%</td></tr><tr><td>Algorithms</td><td>55</td><td>0.12</td><td>86%</td></tr></table>
${p('Courses with a small algebraic connectivity split cleanly; dense courses such as analysis, where every topic leans on limits, split less well.')}
<h2>4 Discussion</h2>
${p('The spectral view suggests a simple revision strategy: study one side of the Fiedler cut at a time, and spend the remaining time on the few topics whose edges cross it. These bridging topics are where students most often report confusion.')}
${p('Higher eigenvectors refine the split further, as in spectral clustering, and the size of the spectral gap tells how many modules a course really has.')}
<h2>5 Related work</h2>
${p('Spectral partitioning goes back to Fiedler and to Donath and Hoffman; spectral clustering popularised it for data. Prerequisite graphs of courses have been studied for curriculum design, but rarely from the point of view of the student revising for an exam.')}
${p('Our measure needs nothing but the exercise sheets of a course, which every student has, and can be recomputed as the course goes on.')}
<h2>6 Conclusion</h2>
${p('The second eigenvalue of a course graph is a one-number summary of how a syllabus hangs together, and its eigenvector is a practical map for planning revision.')}
</div></body></html>`;
}

// ------------------------------------------------------------------ EPUB textbook
const BOOK_TITLE = 'A Short Course in Linear Algebra';

function epubChapter(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;
}

const mm = (inner) => `<math xmlns="http://www.w3.org/1998/Math/MathML">${inner}</math>`;

export async function makeEpub() {
  const zip = new JSZip();
  const date = new Date(Date.UTC(2025, 0, 10));
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', { date });
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5a1e7e00-0000-4000-8000-000000000042</dc:identifier>
    <dc:title>${BOOK_TITLE}</dc:title>
    <dc:creator>Elena Novak</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Example Press</dc:publisher>
    <dc:date>2025-01-10</dc:date>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`, { date });
  zip.file('OEBPS/nav.xhtml', epubChapter('Contents', `<nav epub:type="toc"><ol><li><a href="text/ch1.xhtml">1. Vector spaces</a></li><li><a href="text/ch2.xhtml">2. Linear maps</a></li><li><a href="text/ch3.xhtml">3. Eigenvalues and eigenvectors</a></li></ol></nav>`), { date });
  const P = (s) => `<p>${s}</p>`;
  zip.file('OEBPS/text/ch1.xhtml', epubChapter('Vector spaces', `<h1>1. Vector spaces</h1>
${P('Linear algebra is the study of spaces in which you can add things and scale them. Arrows in the plane, polynomials, and solutions of a linear differential equation all behave this way, and the same theorems apply to each.')}
${P(`A <b>vector space</b> over a field ${mm('<mi>F</mi>')} is a set ${mm('<mi>V</mi>')} with an addition and a scalar multiplication that satisfy the familiar rules: addition is commutative and associative, there is a zero vector, every vector has an additive inverse, and scalar multiplication distributes over addition.`)}
${P('The most important examples are the spaces of lists of numbers. Their elements are written as columns, and their operations are carried out entry by entry.')}
<h2>1.1 Subspaces</h2>
${P(`A subset ${mm('<mi>U</mi>')} of ${mm('<mi>V</mi>')} is a <b>subspace</b> if it contains zero and is closed under addition and scalar multiplication. Lines and planes through the origin are subspaces of three-dimensional space; a line that misses the origin is not.`)}
${P('Subspaces can be added: the sum of two subspaces is the smallest subspace that contains both. When every vector of the sum can be written in only one way, the sum is called direct.')}
<h2>1.2 Bases and dimension</h2>
${P('A list of vectors is a basis when every vector of the space can be written as a combination of the list in exactly one way. All bases of a finite-dimensional space have the same length, and that length is its dimension.')}
${P('Choosing a basis turns abstract vectors into lists of coordinates, which is what makes computation possible. Much of linear algebra is the art of choosing the basis in which a problem becomes simple.')}`), { date });
  zip.file('OEBPS/text/ch2.xhtml', epubChapter('Linear maps', `<h1>2. Linear maps</h1>
${P('A linear map sends sums to sums and multiples to multiples. Once a basis is chosen on each side, a linear map is described completely by a matrix, and composing maps corresponds to multiplying matrices.')}
${P('The null space of a map collects the vectors it sends to zero; the range collects everything it reaches. The fundamental theorem of linear maps says that their dimensions add up to the dimension of the domain.')}
<h2>2.1 Invertibility</h2>
${P('A map from a space to itself is invertible exactly when its null space is zero, and, in finite dimensions, exactly when it is onto. Injectivity and surjectivity are the same thing for operators on a finite-dimensional space.')}`), { date });
  zip.file('OEBPS/text/ch3.xhtml', epubChapter('Eigenvalues and eigenvectors', `<h1>3. Eigenvalues and eigenvectors</h1>
${P(`Some vectors are special for an operator ${mm('<mi>T</mi>')}: it only stretches them. A nonzero vector ${mm('<mi>v</mi>')} with ${mm('<mi>T</mi><mi>v</mi><mo>=</mo><mi>λ</mi><mi>v</mi>')} is an <b>eigenvector</b>, and the number ${mm('<mi>λ</mi>')} is the corresponding <b>eigenvalue</b>.`)}
${P('In a basis of eigenvectors the matrix of an operator is diagonal, and powers, exponentials and long-term behaviour become easy to compute. Not every operator has such a basis, but every operator on a complex vector space has at least one eigenvector.')}
<h2>3.1 Finding eigenvalues</h2>
${P(`For a matrix ${mm('<mi>A</mi>')}, the number ${mm('<mi>λ</mi>')} is an eigenvalue exactly when ${mm('<mi>A</mi><mo>−</mo><mi>λ</mi><mi>I</mi>')} is not invertible, that is, when its determinant vanishes. The eigenvalues are therefore the roots of the characteristic polynomial.`)}
${P('For a two-by-two matrix the characteristic polynomial depends only on the trace and the determinant, so the eigenvalues can be read off from those two numbers.')}
<h2>3.2 Symmetric matrices</h2>
${P('Real symmetric matrices are the best behaved of all: their eigenvalues are real, and eigenvectors for different eigenvalues are orthogonal. This is the spectral theorem, the subject of the next chapter.')}`), { date });
  return zip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}

// ------------------------------------------------------------------ the web article (New from link)
export const ARTICLE_URL = 'https://blog.example/posts/eigenvectors-visually';

function articleFigureSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="380" viewBox="0 0 800 380" font-family="Georgia, serif">
<rect width="800" height="380" fill="#fff7ec"/>
<g stroke="#ead7bd">${Array.from({ length: 17 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="380"/>`).join('')}${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${i * 50 + 15}" x2="800" y2="${i * 50 + 15}"/>`).join('')}</g>
<defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>
<g stroke-width="5" marker-end="url(#a)">
<line x1="400" y1="315" x2="520" y2="255" stroke="#2f6fde"/><line x1="400" y1="315" x2="640" y2="195" stroke="#2f6fde" opacity=".45" stroke-dasharray="10 8"/>
<line x1="400" y1="315" x2="330" y2="205" stroke="#c0522d"/><line x1="400" y1="315" x2="250" y2="175" stroke="#9a6fb0" opacity=".7" stroke-dasharray="10 8"/>
</g>
<circle cx="400" cy="315" r="6" fill="#333"/>
<text x="530" y="250" font-size="24" fill="#2f6fde" font-style="italic">v</text><text x="650" y="190" font-size="24" fill="#2f6fde" font-style="italic">Av = 2v</text>
<text x="300" y="200" font-size="24" fill="#c0522d" font-style="italic">u</text><text x="160" y="165" font-size="24" fill="#9a6fb0" font-style="italic">Au</text>
<text x="40" y="360" font-size="20" fill="#7a6a58">Most vectors turn. Eigenvectors only stretch.</text>
</svg>`;
}

const ARTICLE_CSS = `body { margin: 0; background: #fffdf8; color: #2b2622; font: 19px/1.6 Georgia, "DejaVu Serif", serif; }
header.site { background: #2b2622; color: #fff7ec; padding: 14px 32px; font: 600 15px Inter, Helvetica, sans-serif; letter-spacing: .04em; }
header.site span { opacity: .7; font-weight: 400; margin-left: 14px; }
article { max-width: 700px; margin: 40px auto; padding: 0 24px; }
h1 { font-size: 40px; line-height: 1.15; margin: 0 0 8px; color: #8a3b1c; }
.byline { color: #7a6a58; font: 15px Inter, Helvetica, sans-serif; margin-bottom: 26px; }
h2 { font-size: 26px; margin-top: 34px; color: #8a3b1c; }
figure { margin: 26px 0; } figure img { width: 100%; border-radius: 8px; border: 1px solid #ead7bd; }
figcaption { font-size: 15px; color: #7a6a58; margin-top: 6px; }
blockquote { border-left: 4px solid #e8b37a; margin: 20px 0; padding: 4px 18px; color: #5a4c40; font-style: italic; }
code { background: #f4ead9; padding: 1px 5px; border-radius: 4px; font-size: 16px; }`;

const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Eigenvectors, visually | The Study Blog</title>
<meta property="og:title" content="Eigenvectors, visually">
<meta property="og:site_name" content="The Study Blog">
<meta name="author" content="Priya Natarajan">
<meta property="article:published_time" content="2026-10-14T08:00:00Z">
<link rel="stylesheet" href="/static/eigen.css">
</head><body>
<header class="site">THE STUDY BLOG <span>notes on learning mathematics</span></header>
<main><article>
<h1>Eigenvectors, visually</h1>
<p class="byline">By Priya Natarajan · 14 October 2026 · 6 min read</p>
<p>Apply a matrix to every arrow in the plane and watch what happens. Almost every arrow turns: it comes out pointing in a new direction. But a few special arrows refuse to turn. They only get longer, shorter, or flip around. Those arrows are the <em>eigenvectors</em>, and the factor by which each one stretches is its <em>eigenvalue</em>.</p>
<figure><img src="/img/eigen-figure.png" alt="Most vectors turn under a matrix; eigenvectors only stretch"><figcaption>Under A, the blue arrow v only doubles; the orange arrow u turns.</figcaption></figure>
<h2>Why they matter</h2>
<p>In the directions of its eigenvectors, a matrix is as simple as a number. If you can write any vector as a combination of eigenvectors, you can apply the matrix ten times, or a thousand, by raising a few numbers to a power. That is why eigenvectors appear in population models, in Google's original PageRank, and in the vibrations of a bridge.</p>
<blockquote>Find the directions in which a transformation is simple, and describe everything else in terms of them.</blockquote>
<h2>Finding them</h2>
<p>Asking for a vector with <code>Av = λv</code> is asking for a nonzero solution of <code>(A − λI)v = 0</code>. Such a solution exists exactly when the matrix <code>A − λI</code> squashes the plane flat, which happens when its determinant is zero. Solve that equation for λ first, then go back and find the arrows.</p>
<ul><li>Two-by-two matrices have at most two eigenvalues.</li><li>The eigenvalues add up to the trace and multiply to the determinant.</li><li>Symmetric matrices always have real eigenvalues and perpendicular eigenvectors.</li></ul>
<p>Next time we will use this to explain why repeatedly multiplying by the same matrix makes almost every vector line up with a single direction, the idea behind the power method.</p>
</article></main>
</body></html>`;

/** Pages the demo's fetch helper serves (URL → { type, body }). */
export async function webPages(browser, dir) {
  const png = await renderPng(browser, articleFigureSvg(), 800, 380, join(dir, 'eigen-figure.png'));
  return {
    [ARTICLE_URL]: { type: 'text/html; charset=utf-8', body: ARTICLE_HTML },
    'https://blog.example/static/eigen.css': { type: 'text/css', body: ARTICLE_CSS },
    'https://blog.example/img/eigen-figure.png': { type: 'image/png', body: png },
  };
}

// ------------------------------------------------------------------ chatbot answer (New from clipboard)
export function chatbotAnswer() {
  const m = (s) => tex(s);
  const M = (s) => `<div class="math-display">${tex(s, true)}</div>`;
  const html = `<div class="font-claude-response"><div class="grid-cols-1"><h2>Why a real symmetric matrix has real eigenvalues</h2>
<p>Let ${m('A = A^{\\top}')} be real, and suppose ${m('Av = \\lambda v')} with ${m('v \\neq 0')}, where ${m('\\lambda')} and ${m('v')} may be complex. Multiply on the left by the conjugate transpose ${m('\\bar v^{\\top}')}:</p>
${M('\\bar v^{\\top} A v = \\lambda \\, \\bar v^{\\top} v = \\lambda \\lVert v \\rVert^2 .')}
<p>Now take the conjugate transpose of the left-hand side. Since ${m('A')} is real and symmetric, ${m('\\overline{A}^{\\top} = A')}, so</p>
${M('\\overline{\\bar v^{\\top} A v} = \\bar v^{\\top} A v .')}
<p>The number ${m('\\bar v^{\\top} A v')} equals its own conjugate, so it is <strong>real</strong>. Because ${m('\\lVert v \\rVert^2 > 0')}, the eigenvalue ${m('\\lambda = \\bar v^{\\top} A v / \\lVert v \\rVert^2')} is real too.</p>
<h3>Key points</h3>
<ul><li>The proof only uses ${m('A = \\overline{A}^{\\top}')}, so it works for every Hermitian matrix.</li><li>Eigenvectors for different eigenvalues are orthogonal: ${m('\\lambda_1 \\langle u, w\\rangle = \\langle Au, w \\rangle = \\langle u, Aw\\rangle = \\lambda_2 \\langle u, w \\rangle')}.</li><li>Together these give the <strong>spectral theorem</strong>: ${m('A = Q \\Lambda Q^{\\top}')} with ${m('Q')} orthogonal.</li></ul></div></div>`;
  const text = `## Why a real symmetric matrix has real eigenvalues

Let $A = A^\\top$ be real, and suppose $Av = \\lambda v$ with $v \\neq 0$ ...`;
  return { html, text };
}

// ------------------------------------------------------------------ photo of the board
export async function boardPhoto(browser, file) {
  const ink = (strokes, color, w) => strokes.map((s) => `<polyline points="${s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" filter="url(#chalk)"/>`).join('');
  const lines = [
    ['Spectral theorem', 70, 120, 46, '#f4f1e8'],
    ['A = A^T  ⇒  A = QΛQ^T', 90, 220, 40, '#f4f1e8'],
    ['λ real,  Q^TQ = I', 120, 310, 36, '#f6e7a6'],
  ];
  let svg = '';
  for (const [t, x, y, size, c] of lines) svg += ink(handwrite(t, x, y, size, { seed: x + y }).strokes, c, size * 0.075);
  svg += ink(roughRect(560, 380, 300, 170, { seed: 21 }), '#bfe3f4', 3.2);
  svg += ink(handwrite('v', 640, 480, 40, { seed: 2 }).strokes, '#bfe3f4', 3);
  svg += ink(roughArrow(600, 520, 780, 430, { seed: 4, head: 22 }), '#bfe3f4', 3.4);
  svg += ink(handwrite('Av = λv', 120, 470, 44, { seed: 8 }).strokes, '#f4f1e8', 3.4);
  const html = `<!doctype html><html><body style="margin:0;background:#1d1c19">
<div style="position:relative;width:1200px;height:800px;overflow:hidden;transform:perspective(1600px) rotateY(-4deg) rotateX(2deg) scale(1.04);transform-origin:50% 50%">
<svg width="1200" height="800" viewBox="0 0 1000 667" style="display:block">
<defs>
<filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .07 0"/></filter>
<filter id="chalk"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="5" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="2.2"/><feGaussianBlur stdDeviation="0.35"/></filter>
<radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/></radialGradient>
<linearGradient id="board" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f4a3d"/><stop offset="1" stop-color="#243a30"/></linearGradient>
</defs>
<rect width="1000" height="667" fill="#6b4a2f"/>
<rect x="18" y="18" width="964" height="600" fill="url(#board)"/>
<g opacity=".08" stroke="#e8efe8" stroke-width="30" fill="none" filter="url(#chalk)"><path d="M60 560 C 300 520, 500 600, 900 540"/><path d="M700 80 C 800 120, 860 60, 950 110"/></g>
${svg}
<rect x="18" y="18" width="964" height="600" filter="url(#noise)"/>
<rect x="0" y="618" width="1000" height="49" fill="#8a6440"/><rect x="120" y="606" width="90" height="14" rx="3" fill="#efece4"/><rect x="230" y="609" width="40" height="10" rx="3" fill="#e7c86a"/>
<rect width="1000" height="667" fill="url(#vig)"/>
</svg></div></body></html>`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  await page.close();
  return readFileSync(file);
}

// ------------------------------------------------------------------ helpers
async function renderPng(browser, svg, w, h, file) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  return readFileSync(file);
}

async function makePaperPdf(browser, file) {
  const htmlFile = join(file, '..', 'paper.html');
  writeFileSync(htmlFile, paperHtml());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.close();
  // document information, as a publisher's PDF has it
  const doc = await PDFDocument.load(pdf);
  doc.setTitle(PAPER_TITLE);
  doc.setAuthor('Maya Rivera; Jonas Chen');
  doc.setSubject('Spectral graph theory');
  doc.setCreationDate(new Date(Date.UTC(2026, 3, 2)));
  const bytes = await doc.save();
  writeFileSync(file, bytes);
  return bytes;
}

/** Makes every file asset into `dir` (paper.pdf, book.epub, board.jpg, …) and returns them. */
export async function makeAssets(browser, dir) {
  mkdirSync(dir, { recursive: true });
  const paper = await makePaperPdf(browser, join(dir, 'paper.pdf'));
  const epub = await makeEpub();
  writeFileSync(join(dir, 'book.epub'), epub);
  const board = await boardPhoto(browser, join(dir, 'board.jpg'));
  return { paper, epub, board, paperTitle: PAPER_TITLE, bookTitle: BOOK_TITLE };
}
