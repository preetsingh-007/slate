/**
 * A small gym repository for tests (unit and end-to-end), following gym's README conventions:
 * domains with subject indexes, topics with status front matter, a topic with variants, problems
 * from templates/problem.md, a study log, assets, a marimo notebook, and the folders that are
 * not domains (log, templates, scripts, journal, library, dot-folders).
 */

export const GYM_COMMIT = 'c0ffee1234567890';

const svg = (label: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80"><rect width="200" height="80" fill="${color}"/><text x="100" y="45" font-size="16" text-anchor="middle" fill="#fff">${label}</text></svg>`;

const problem = (title: string, fm: { source: string; difficulty: string; status: string; date: string }, statement: string, solution = '') =>
  `---
source: ${fm.source}
difficulty: ${fm.difficulty}
status: ${fm.status}
date: ${fm.date}
---

# ${title}

## Statement

${statement}

## Solution

${solution}

## Remarks
`;

export const GYM_FIXTURE: Record<string, string> = {
  'README.md': `# gym

Notes, problems, and implementations from self-study.

## Domains

| Directory | Domain |
| --- | --- |
| [\`math/\`](math/) | Mathematics |
| [\`cs/\`](cs/) | Computer science |
| [\`ml/\`](ml/) | Machine learning |
`,
  'AGENTS.md': '# Agent instructions\n',
  '.agents/skills/quiz/SKILL.md': '---\nname: quiz\ndescription: Quiz the owner.\n---\n\n# Quiz\n',
  'scripts/check.py': 'print("ok")\n',
  'templates/topic/README.md': '---\nstatus: planned\nstarted:\ncompleted:\n---\n\n# <Topic>\n',
  'templates/problem.md': '---\nsource: <Author>\ndifficulty: <easy | medium | hard>\nstatus: <open | solved | revisit>\ndate: <YYYY-MM-DD>\n---\n\n# <Title>\n',
  'journal/README.md': '# Journal\n\nWritten by Slate.\n',
  'journal/formalized.md': '# Formalized\n',
  'library/README.md': '# Library\n\nWritten by Slate.\n',

  // ---------------------------------------------------------------- math
  'math/README.md': `# Mathematics

## Subjects

| Subject | Scope |
| --- | --- |
| [linear-algebra](linear-algebra/) | Vector spaces, linear maps, eigenvalues. |
| [analysis](analysis/) | Sequences, series, continuity. |
`,
  'math/linear-algebra/README.md': `# Linear Algebra

Finite-dimensional vector spaces and the linear maps between them.

## Topics

In study order.

1. [vector-spaces](vector-spaces/)
2. [eigenvalues](eigenvalues/)

## References

- Axler, *Linear Algebra Done Right*, 4th edition.
`,
  'math/linear-algebra/vector-spaces/README.md': `---
status: done
started: 2026-09-01
completed: 2026-09-20
---

# Vector Spaces

Vector spaces, subspaces, span, linear independence, bases and dimension.

## References

- Axler, *Linear Algebra Done Right*, 4th edition, chapters 1–2.
`,
  'math/linear-algebra/vector-spaces/notes.md': `# Vector Spaces: Notes

## Bases

A **basis** of $V$ is a list of vectors in $V$ that is linearly independent and spans $V$.

## Dimension

Any two bases of a finite-dimensional vector space have the same length, $\\dim V$.
`,
  'math/linear-algebra/vector-spaces/problems/001-subspace-intersection.md': problem(
    'Intersection of subspaces',
    { source: 'Axler, Linear Algebra Done Right, 4th edition, exercise 1C.10', difficulty: 'easy', status: 'solved', date: '2026-09-05' },
    'Prove that the intersection of every collection of subspaces of $V$ is a subspace of $V$.',
    'Each subspace contains $0$, so the intersection does.',
  ),
  'math/linear-algebra/vector-spaces/problems/002-union-of-subspaces.md': problem(
    'Union of two subspaces',
    { source: 'Axler, Linear Algebra Done Right, 4th edition, exercise 1C.12', difficulty: 'medium', status: 'revisit', date: '2026-09-15' },
    'Prove that the union of two subspaces of $V$ is a subspace of $V$ if and only if one of the subspaces is contained in the other.',
  ),
  'math/linear-algebra/eigenvalues/README.md': `---
status: active
started: 2026-10-15
completed:
---

# Eigenvalues

Invariant subspaces, eigenvalues and eigenvectors, upper-triangular matrices.

## Prerequisites

- [vector-spaces](../vector-spaces/)

## References

- Axler, *Linear Algebra Done Right*, 4th edition, chapter 5.
`,
  'math/linear-algebra/eigenvalues/notes.md': `# Eigenvalues: Notes

## Definitions

Suppose $T \\in \\mathcal{L}(V)$. A number $\\lambda \\in \\mathbf{F}$ is an **eigenvalue** of $T$ if there exists $v \\in V$ such that $v \\neq 0$ and $Tv = \\lambda v$.

A basis is defined in [Vector Spaces](../vector-spaces/notes.md#bases); see also [problem 1](problems/001-diagonal-matrix.md).

![Eigenvectors keep their direction](assets/eigenvectors.svg)

## Spectral theorem

$$
T = \\sum_{i=1}^{n} \\lambda_i \\, e_i e_i^{*}
$$

The theorem holds for every *self-adjoint* operator on a finite-dimensional real inner product space.

| Matrix | Eigenvalues |
| --- | --- |
| $\\begin{pmatrix} 2 & 0 \\\\ 0 & 3 \\end{pmatrix}$ | $2, 3$ |
| $\\begin{pmatrix} 0 & 1 \\\\ 1 & 0 \\end{pmatrix}$ | $1, -1$ |

Steps to diagonalise:

1. Find the eigenvalues as roots of the characteristic polynomial.
2. Find a basis of each eigenspace.
3. Stack the eigenvectors as the columns of $P$.

\`\`\`python
import numpy as np
A = np.array([[2.0, 0.0], [0.0, 3.0]])
values, vectors = np.linalg.eig(A)
print(values)
\`\`\`

## Spectral theorem

A second section with the same title, to test anchors: [back to definitions](#definitions).
`,
  'math/linear-algebra/eigenvalues/assets/eigenvectors.svg': svg('eigenvectors', '#2f6fde'),
  'math/linear-algebra/eigenvalues/problems/001-diagonal-matrix.md': problem(
    'Eigenvalues of a diagonal matrix',
    { source: 'Axler, Linear Algebra Done Right, 4th edition, exercise 5A.4', difficulty: 'easy', status: 'open', date: '2026-10-10' },
    'Show that the eigenvalues of a diagonal matrix are its diagonal entries.',
  ),
  'math/linear-algebra/eigenvalues/problems/002-trace.md': problem(
    'Trace and eigenvalues',
    { source: 'Axler, Linear Algebra Done Right, 4th edition, exercise 8B.3', difficulty: 'hard', status: 'revisit', date: '2026-10-01' },
    'Prove that the trace of $T$ equals the sum of the eigenvalues of $T$, counted with multiplicity.',
    'Use an upper-triangular matrix of $T$.',
  ),
  'math/linear-algebra/eigenvalues/problems/003-invariant-subspace.md': problem(
    'Invariant subspaces of a rotation',
    { source: 'original', difficulty: 'medium', status: 'solved', date: '2026-10-16' },
    'Find every invariant subspace of a rotation of $\\mathbf{R}^2$ by $\\pi/2$.',
    'Only $\\{0\\}$ and $\\mathbf{R}^2$.',
  ),
  'math/analysis/README.md': `# Analysis

## Topics

In study order.

1. [sequences](sequences/)
`,
  'math/analysis/sequences/README.md': `---
status: done
started: 2026-08-10
completed: 2026-08-30
---

# Sequences

Limits of sequences, the monotone convergence theorem, Cauchy sequences.
`,
  'math/analysis/sequences/notes.md': '# Sequences: Notes\n\n## Cauchy sequences\n\nA sequence $(a_n)$ is **Cauchy** if for every $\\varepsilon > 0$ there is $N$ with $|a_m - a_n| < \\varepsilon$ for all $m, n \\ge N$.\n',

  // ---------------------------------------------------------------- cs
  'cs/README.md': `# Computer Science

## Subjects

| Subject | Scope |
| --- | --- |
| [operating-systems](operating-systems/) | Processes, memory, file systems. |
`,
  'cs/operating-systems/README.md': '# Operating Systems\n\n## Topics\n\nIn study order.\n\n1. [processes](processes/)\n',
  'cs/operating-systems/processes/README.md': '---\nstatus: planned\nstarted:\ncompleted:\n---\n\n# Processes\n\nThe process abstraction, scheduling, context switches.\n',

  // ---------------------------------------------------------------- ml (topic with variants)
  'ml/README.md': `# Machine Learning

## Subjects

| Subject | Scope |
| --- | --- |
| [architectures](architectures/) | Neural network architectures: derivation, implementation, and training. |
`,
  'ml/architectures/README.md': '# Architectures\n\n## Topics\n\nIn study order.\n\n1. [transformer](transformer/)\n',
  'ml/architectures/transformer/README.md': `# Transformer

The encoder–decoder transformer.

## Variants

| Variant | Difference |
| --- | --- |
| [basic](basic/) | The architecture of Vaswani et al. |
| [quantization](quantization/) | Weights quantized to 8 bits. |
`,
  'ml/architectures/transformer/notes.md': '# Transformer: Notes\n\n## Attention\n\n$$\\operatorname{Attention}(Q, K, V) = \\operatorname{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right) V$$\n\n![Attention](assets/attention.svg)\n',
  'ml/architectures/transformer/assets/attention.svg': svg('attention', '#2f8a4e'),
  'ml/architectures/transformer/basic/README.md': `---
status: done
started: 2026-10-01
completed: 2026-10-12
---

# Transformer: basic

The architecture of Vaswani et al., implemented in JAX. The notebook is [\`code/transformer.md\`](code/transformer.md).
`,
  'ml/architectures/transformer/basic/code/transformer.md': `---
title: Transformer
marimo-version: 0.25.1
width: medium
---

# Transformer

This notebook derives the transformer architecture and implements it in JAX.

\`\`\`python {.marimo hide_code="true"}
import marimo as mo
import numpy as np
\`\`\`

## Scaled dot-product attention

The scores are $QK^\\top / \\sqrt{d_k}$.

\`\`\`python {.marimo}
def attention(q, k, v):
    scores = q @ k.T / np.sqrt(q.shape[-1])
    return softmax(scores) @ v
\`\`\`
`,
  'ml/architectures/transformer/basic/code/requirements.txt': 'jax==0.4.30\nmarimo==0.25.1\n',
  'ml/architectures/transformer/quantization/README.md': '---\nstatus: active\nstarted: 2026-10-14\ncompleted:\n---\n\n# Transformer: quantization\n\nWeights quantized to 8 bits.\n',

  // ---------------------------------------------------------------- log
  'log/README.md': '# Log\n\nOne file per month at `YYYY/MM.md`.\n',
  'log/2026/08.md': `# 2026-08

## 2026-08-30

- [math/analysis/sequences](../../math/analysis/sequences/): Finished Cauchy sequences.
`,
  'log/2026/09.md': `# 2026-09

## 2026-09-02

- [math/analysis/sequences](../../math/analysis/sequences/notes.md): Revised the monotone convergence theorem.

## 2026-09-20

- [math/linear-algebra/vector-spaces](../../math/linear-algebra/vector-spaces/): Read Axler 2C. Solved problem 002.
`,
  'log/2026/10.md': `# 2026-10

## 2026-10-12

- [ml/architectures/transformer/basic](../../ml/architectures/transformer/basic/): Trained the full model.

## 2026-10-16

- [math/linear-algebra/eigenvalues](../../math/linear-algebra/eigenvalues/problems/003-invariant-subspace.md): Solved problem 003.
`,
};
