import { expect, test, type Page } from '@playwright/test';
import { openWithGym, pane } from './gym-helpers';

const NOTES = 'math/linear-algebra/eigenvalues/notes.md';

async function rectLasso(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 4 });
  await page.mouse.up();
}

interface Carried {
  text: string;
  source: any;
  image: boolean;
  size: { w: number; h: number } | undefined;
}

/** Captures that were sent: clips placed on the canvas (when it is on screen) or waiting in the carry tray. */
const carry = (page: Page): Promise<Carried[]> =>
  page.evaluate(() => {
    const w = window as any;
    const clips = [...w.__slate.canvases.model('main').objects()]
      .filter((o: any) => o.kind === 'clip')
      .sort((a: any, b: any) => a.created - b.created || (a.y - b.y))
      .map((o: any) => ({ text: o.text, source: o.source, image: !!o.asset, size: o.natural }));
    const tray = w.__slateGym.app.getState().carry.map((c: any) => ({ text: c.text, source: c.source, image: !!c.image, size: c.imageSize }));
    return [...clips, ...tray];
  });

test.describe('lasso from a gym file (S1, S2, S5, S6, G7)', () => {
  test('captures the Markdown source with LaTeX, sends it to the canvas (carry tray), and returns through the source link', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await openWithGym(page);
    await page.evaluate((p) => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: p }), NOTES);
    const md = pane(page).locator('.gym-md');
    const para = md.locator('p', { hasText: 'is an eigenvalue of' });
    await expect(para.locator('.katex').first()).toBeVisible();

    await pane(page).getByRole('button', { name: 'Rectangle lasso' }).click();
    const b = (await para.boundingBox())!;
    await rectLasso(page, { x: b.x - 6, y: b.y - 4, width: b.width + 12, height: b.height + 8 });

    const preview = pane(page).getByRole('region', { name: 'Captures' });
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Send to canvas' }).click();
    await expect(preview).toBeHidden();
    await expect.poll(async () => (await carry(page)).length).toBe(1);

    const [c] = await carry(page);
    expect(c.text).toBe(
      'Suppose $T \\in \\mathcal{L}(V)$. A number $\\lambda \\in \\mathbf{F}$ is an **eigenvalue** of $T$ if there exists $v \\in V$ such that $v \\neq 0$ and $Tv = \\lambda v$.',
    );
    expect(c.source).toMatchObject({ type: 'gym', id: NOTES, title: 'Eigenvalues: Notes', contentHash: `sha-${NOTES}` });
    expect(c.source.locator).toMatchObject({ type: 'gym', path: NOTES, commit: 'c0ffee1234567890' });
    expect(c.source.locator.quote.exact).toBe(c.text);
    expect(c.source.locator.quote.prefix).toBe('# Eigenvalues: Notes\n\n## Definitions\n\n'.slice(-32));
    if (c.image) expect(c.size?.w).toBeGreaterThan(100);

    // back through the source link: the file opens scrolled to the quote, flashed
    await page.evaluate(() => (window as any).__slateGym.app.getState().closeTab(0));
    await page.evaluate((src) => (window as any).__slateGym.openSource(src), c.source);
    const flash = pane(page).locator('.gym-flash').first();
    await expect(flash).toBeVisible();
    await expect(flash).toBeInViewport();
    await expect(pane(page).locator('.gym-flash')).toHaveCount(0, { timeout: 4000 });
  });

  test('a partial selection keeps balanced Markdown; lists, code and links keep their structure', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithGym(page);
    await page.evaluate((p) => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: p }), NOTES);
    const md = pane(page).locator('.gym-md');
    await pane(page).getByRole('button', { name: 'Rectangle lasso' }).click();

    // two list items (out of three) and the start of the code block
    const items = md.locator('ol > li');
    const i2 = (await items.nth(1).boundingBox())!;
    const i3 = (await items.nth(2).boundingBox())!;
    await rectLasso(page, { x: i2.x - 30, y: i2.y + 2, width: i3.width + 40, height: i3.y + i3.height - i2.y - 4 });
    // the paragraph with links: only its second half
    const linkPara = md.locator('p', { hasText: 'A basis is defined in' });
    const vs = (await linkPara.getByRole('link', { name: 'Vector Spaces' }).boundingBox())!;
    const lp = (await linkPara.boundingBox())!;
    await rectLasso(page, { x: vs.x + vs.width / 2, y: lp.y - 2, width: lp.x + lp.width - vs.x - vs.width / 2 + 4, height: lp.height + 4 });
    // two lines of the code block
    const code = md.locator('pre code');
    // the capture previews sit at the bottom of the reader: bring the code to the middle
    await code.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const cb = (await code.boundingBox())!;
    const line = cb.height / 4; // four lines of code
    await rectLasso(page, { x: cb.x - 4, y: cb.y + line * 1.1, width: cb.width + 8, height: line * 1.8 });

    const preview = pane(page).getByRole('region', { name: 'Captures' });
    await expect(preview.locator('.gym-capture')).toHaveCount(3);
    await preview.getByRole('button', { name: 'Send to canvas' }).click();
    await expect.poll(async () => (await carry(page)).length).toBe(3);
    const caps = await carry(page);
    expect(caps.map((c) => c.text)).toEqual([
      '2. Find a basis of each eigenspace.\n3. Stack the eigenvectors as the columns of $P$.',
      '[Vector Spaces](/math/linear-algebra/vector-spaces/notes.md#bases); see also [problem 1](/math/linear-algebra/eigenvalues/problems/001-diagonal-matrix.md).',
      '```python\nA = np.array([[2.0, 0.0], [0.0, 3.0]])\nvalues, vectors = np.linalg.eig(A)\n```',
    ]);
  });

  test('a changed file is found by the closest match, with a notice; a removed file says so', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate((p) => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: p }), NOTES);
    const md = pane(page).locator('.gym-md');
    const para = md.locator('p', { hasText: 'The theorem holds' });
    await pane(page).getByRole('button', { name: 'Lasso', exact: true }).click();
    const b = (await para.boundingBox())!;
    // free-form lasso around the paragraph
    await page.mouse.move(b.x - 8, b.y - 6);
    await page.mouse.down();
    for (const [x, y] of [
      [b.x + b.width + 8, b.y - 6],
      [b.x + b.width + 8, b.y + b.height + 6],
      [b.x - 8, b.y + b.height + 6],
      [b.x - 8, b.y - 4],
    ])
      await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.up();
    await pane(page).getByRole('button', { name: 'Send to canvas' }).click();
    await expect.poll(async () => (await carry(page)).length).toBe(1);
    const [c] = await carry(page);
    expect(c.text).toBe('The theorem holds for every *self-adjoint* operator on a finite-dimensional real inner product space.');

    // edit the file in "gym" (a pull brings a new version)
    const text = await page.evaluate((p) => (window as any).__slate.gymFiles.readText(p), NOTES);
    await page.evaluate(([p, t]) => (window as any).__slateGym.set(p, t, 'c2'), [NOTES, text.replace('real inner product space', 'real inner-product space')]);
    await page.evaluate((src) => (window as any).__slateGym.openSource(src), c.source);
    await expect(page.locator('.toast-host').getByText('showing the closest match')).toBeVisible();
    await expect(pane(page).locator('.gym-flash').first()).toBeVisible();

    await page.evaluate((p) => (window as any).__slateGym.set(p, undefined, 'c3'), NOTES);
    await page.evaluate((src) => (window as any).__slateGym.openSource(src), c.source);
    await expect(page.locator('.toast-host').getByText('is no longer in gym')).toBeVisible();
  });

  test('drags a capture onto the canvas, or sends it below the latest content when the canvas is on screen (S3)', async ({ page }) => {
    await openWithGym(page);
    // a stand-in canvas: records the captures it receives and where
    await page.evaluate(() => {
      (window as any).__inserted = [];
      (window as any).__slateGym.registerCanvasApi('main', {
        insertCaptures: async (caps: any[], at?: { x: number; y: number }) => {
          (window as any).__inserted.push({ texts: caps.map((c) => c.text), at: at ?? null });
          return caps.map((c) => c.id);
        },
        revealObject: () => {},
        revealRegion: () => {},
        clientToCanvas: (x: number, y: number) => {
          const r = document.querySelector('.pane-canvas')!.getBoundingClientRect();
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? { x: x - r.left, y: y - r.top } : null;
        },
      });
    });
    await page.evaluate((p) => (window as any).__slateGym.app.getState().openTab({ kind: 'gym', path: p }), NOTES);
    const md = pane(page).locator('.gym-md');
    await pane(page).getByRole('button', { name: 'Rectangle lasso' }).click();
    for (const text of ['A basis is defined in', 'Steps to diagonalise']) {
      await md.locator('p', { hasText: text }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const b = (await md.locator('p', { hasText: text }).boundingBox())!;
      await rectLasso(page, { x: b.x - 4, y: b.y - 3, width: b.width + 8, height: b.height + 6 });
    }
    const cards = pane(page).locator('.gym-capture');
    await expect(cards).toHaveCount(2);

    // drag the first capture onto the canvas
    const card = (await cards.first().boundingBox())!;
    const canvas = (await page.locator('.pane-canvas').boundingBox())!;
    await page.mouse.move(card.x + 40, card.y + 40);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 200, canvas.y + 150, { steps: 10 });
    await expect(page.locator('.gym-capture-ghost')).toBeVisible();
    await page.mouse.up();
    await expect(cards).toHaveCount(1);
    const first = await page.evaluate(() => (window as any).__inserted[0]);
    expect(first.texts[0]).toContain('A basis is defined in [Vector Spaces]');
    expect(first.at.x).toBeCloseTo(200, -1);

    // Send to canvas places the rest below the latest content (no point given)
    await pane(page).getByRole('button', { name: 'Send to canvas' }).click();
    const second = await page.evaluate(() => (window as any).__inserted[1]);
    expect(second).toEqual({ texts: ['Steps to diagonalise:'], at: null });
    expect(await page.evaluate(() => (window as any).__slateGym.app.getState().carry.length)).toBe(0);
  });
});
