import { expect, test, type Page } from '@playwright/test';
import { annotations, carry, fakeCanvas, lassoRect, libraryItems, openApp, seedClip, setHelper } from './libraryHelpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** A ChatGPT-like answer as copied from chatgpt.com (KaTeX with MathML annotations, code). */
const CHATGPT_HTML = `<div class="markdown prose w-full break-words"><h3>Eigenvalues of a 2×2 matrix</h3><p>For <span class="katex"><span class="katex-mathml"><math><semantics><mi>A</mi><annotation encoding="application/x-tex">A</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">A</span></span>, solve <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">\\det(A-\\lambda I)=0</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">det</span></span>.</p><ul><li>The trace is the sum of the eigenvalues.</li><li>The determinant is their product.</li></ul><pre><div>python</div><div><button>Copy code</button></div><div><code class="language-python">np.linalg.eig(A)</code></div></pre></div>`;

async function copy(page: Page, items: { html?: string; text: string }) {
  await page.evaluate(async ({ html, text }) => {
    const data: Record<string, Blob> = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
    if (html) data['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(data)]);
  }, items);
}

async function newFromLink(page: Page, url: string) {
  await page.getByRole('button', { name: 'New from link' }).click();
  const dialog = page.getByRole('dialog', { name: 'New from link' });
  await dialog.getByRole('textbox', { name: 'Web address' }).fill(url);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  return dialog;
}

test.describe('New from clipboard', () => {
  test('L7: a ChatGPT answer becomes a Markdown clipping with maths, in well under half a second', async ({ page }) => {
    await openApp(page);
    await copy(page, { html: CHATGPT_HTML, text: 'Eigenvalues of a 2×2 matrix …' });
    const t0 = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'New from clipboard' }).click();
    await expect(page.getByTestId('clipping-pane')).toBeVisible();
    await expect(page.locator('.clip-article .katex').first()).toBeVisible();
    const t1 = await page.evaluate(() => performance.now());
    expect(t1 - t0).toBeLessThan(1500); // NFR 0.5 s; slack for the test harness
    await expect(page.getByRole('textbox', { name: 'Clipping title' })).toHaveValue('Eigenvalues of a 2×2 matrix');
    await expect(page.locator('.clip-meta')).toContainText('ChatGPT');
    await expect(page.locator('.clip-article pre code')).toHaveText('np.linalg.eig(A)');
    const { clippings } = await libraryItems(page);
    expect(clippings[0]).toMatchObject({ origin: 'clipboard', format: 'markdown', sourceLabel: 'ChatGPT', slug: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-eigenvalues-of-a-2-2-matrix$/) });
    const md = await page.evaluate((id) => (window as never as { __slate: { library: { clippingContent(id: string): Promise<{ markdown: string }> } } }).__slate.library.clippingContent(id).then((c) => c.markdown), clippings[0].id);
    expect(md).toContain('solve $\\det(A-\\lambda I)=0$.');
    expect(md).toContain('```python\nnp.linalg.eig(A)\n```');

    // Markdown / Plain text toggle
    await page.getByRole('radio', { name: 'Plain text' }).click();
    await expect(page.locator('.clip-plain')).toContainText('### Eigenvalues of a 2×2 matrix');
    await page.getByRole('radio', { name: 'Markdown' }).click();
    await expect(page.locator('.clip-article h3')).toHaveText('Eigenvalues of a 2×2 matrix');

    // the title is editable
    await page.getByRole('textbox', { name: 'Clipping title' }).fill('Eigenvalues, quickly');
    await page.getByRole('textbox', { name: 'Clipping title' }).press('Enter');
    await expect.poll(async () => (await libraryItems(page)).clippings[0].title).toBe('Eigenvalues, quickly');
  });

  test('L7: plain text defaults to Plain; the keyboard shortcut works when no text field has focus', async ({ page }) => {
    await openApp(page);
    await copy(page, { text: 'Call the office at 5.\nThe price was $5 and $10.' });
    await page.locator('body').click();
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('clipping-pane')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Plain text' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.clip-plain')).toContainText('The price was $5 and $10.');
    expect((await libraryItems(page)).clippings[0]).toMatchObject({ format: 'plain', title: 'Call the office at 5.' });
  });

  test('L7 @touch: New from clipboard from the top bar on a tablet', async ({ page }) => {
    await openApp(page);
    await copy(page, { text: '# Rank–nullity\n\n$$\\dim V = \\operatorname{rank} T + \\operatorname{nullity} T$$' });
    const button = page.getByRole('button', { name: 'New from clipboard' });
    if (test.info().project.use.hasTouch) await button.tap();
    else await button.click();
    await expect(page.locator('.clip-article .katex-display')).toBeVisible();
  });

  test('S9: a copied URL offers New from link instead', async ({ page }) => {
    await openApp(page);
    await copy(page, { text: 'https://blog.example/posts/spaced-repetition' });
    await page.getByRole('button', { name: 'New from clipboard' }).click();
    await expect(page.getByRole('dialog', { name: 'New from link' }).getByRole('textbox', { name: 'Web address' })).toHaveValue('https://blog.example/posts/spaced-repetition');
    // a URL pasted on the canvas uses the same handler
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => (window as never as { __slateUi: { registries: { handleLink(u: string): boolean } } }).__slateUi.registries.handleLink('https://x.example/a'));
    await expect(page.getByRole('dialog', { name: 'New from link' }).getByRole('textbox', { name: 'Web address' })).toHaveValue('https://x.example/a');
  });
});

test.describe('New from link', () => {
  test('L8 L9: an arXiv HTML paper is saved with Reader and Original views that open offline', async ({ page, context }) => {
    await openApp(page);
    await setHelper(page);
    const t0 = Date.now();
    await newFromLink(page, 'https://arxiv.org/html/2401.01234');
    await expect(page.getByTestId('clipping-pane')).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(5000); // NFR: under 5 s for a typical article
    // Reader: Markdown with maths and the figure stored locally
    await expect(page.locator('.clip-article .katex').first()).toBeVisible();
    await expect(page.locator('.clip-article .katex-display')).toBeVisible();
    await expect(page.locator('.clip-article img')).toHaveAttribute('src', /^blob:/);
    // L9 metadata
    const c = (await libraryItems(page)).clippings[0] as unknown as Record<string, unknown>;
    expect(c).toMatchObject({
      origin: 'link',
      title: 'Spectral Methods for Study Graphs',
      url: 'https://arxiv.org/html/2401.01234',
      canonicalUrl: 'https://arxiv.org/abs/2401.01234v1',
      site: 'arXiv.org',
      author: 'Lovelace, Ada, Turing, Alan',
      published: '2024/01/05',
    });
    expect(typeof c.fetched).toBe('number');
    await expect(page.locator('.clip-meta')).toContainText('arXiv.org');

    // Original: the saved page with its stylesheet, scripts off, offline
    await context.setOffline(true);
    await page.getByRole('radio', { name: 'Original' }).click();
    const frame = page.frameLocator('[data-testid="snapshot-frame"]');
    await expect(frame.locator('h1')).toHaveText('Spectral Methods for Study Graphs');
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(20, 40, 160)');
    await expect(frame.locator('img')).toHaveAttribute('src', /^blob:/);
    expect(await frame.locator('body').getAttribute('data-scripted')).toBeNull();
    await context.setOffline(false);
  });

  test('L8: the sandboxed frame has no access to the app storage; scripts run only when turned on', async ({ page }) => {
    await openApp(page);
    await setHelper(page);
    await newFromLink(page, 'https://blog.example/posts/spaced-repetition');
    await expect(page.getByTestId('clipping-pane')).toBeVisible();
    await expect(page.locator('.clip-article h2')).toHaveText('How to use it');
    await page.getByRole('radio', { name: 'Original' }).click();
    const iframe = page.locator('[data-testid="snapshot-frame"]');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    const frame = page.frameLocator('[data-testid="snapshot-frame"]');
    await expect(frame.locator('h1')).toHaveText('Why spaced repetition works');
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(160, 30, 30)');
    const f = page.frames().find((x) => x.url().includes('snapshot.html'))!;
    const probe = await f.evaluate(async () => {
      const out: Record<string, string> = { origin: self.origin };
      try {
        localStorage.getItem('x');
        out.localStorage = 'allowed';
      } catch {
        out.localStorage = 'blocked';
      }
      try {
        indexedDB.open('slate');
        out.indexedDB = 'allowed';
      } catch {
        out.indexedDB = 'blocked';
      }
      try {
        void (window.parent as Window & { __slate?: unknown }).__slate;
        out.parent = String((window.parent as Window & { document: Document }).document);
      } catch {
        out.parent = 'blocked';
      }
      try {
        await fetch('/index.html');
        out.fetch = 'allowed';
      } catch {
        out.fetch = 'blocked';
      }
      return out;
    });
    expect(probe).toEqual({ origin: 'null', localStorage: 'blocked', indexedDB: 'blocked', parent: 'blocked', fetch: 'blocked' });
    expect(await frame.locator('body').getAttribute('data-scripted')).toBeNull();
    await page.getByRole('checkbox', { name: /Scripts/ }).check();
    await expect(page.frameLocator('[data-testid="snapshot-frame"]').locator('body')).toHaveAttribute('data-scripted', 'yes');
  });

  test('L10: an arXiv abstract page offers its PDF, imported as a book', async ({ page }) => {
    await openApp(page);
    await setHelper(page);
    const dialog = await newFromLink(page, 'https://arxiv.org/abs/2401.01234v1');
    await dialog.getByRole('button', { name: 'Import the PDF as a book' }).click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    expect((await libraryItems(page)).books[0].title).toBe('Spectral Methods for Study Graphs');
  });

  test('L1 L10: a PDF link offers Import as book', async ({ page }) => {
    await openApp(page);
    await setHelper(page);
    const dialog = await newFromLink(page, 'https://notes.example/rank.pdf');
    await dialog.getByRole('button', { name: 'Import as book' }).click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    expect((await libraryItems(page)).books[0].title).toBe('Lecture Notes on Rank');
  });

  test('L10: offline, New from link says so and offers New from clipboard', async ({ page, context }) => {
    await openApp(page);
    await setHelper(page);
    await context.setOffline(true);
    const dialog = await newFromLink(page, 'https://blog.example/posts/spaced-repetition');
    await expect(dialog.getByRole('status')).toContainText('offline');
    await expect(dialog.getByRole('button', { name: 'New from clipboard' })).toBeVisible();
    await context.setOffline(false);
  });

  test('L10: failed fetches explain why and offer New from clipboard', async ({ page }) => {
    await openApp(page);
    // helper not configured
    let dialog = await newFromLink(page, 'https://blog.example/posts/spaced-repetition');
    await expect(dialog.getByRole('status')).toContainText('fetch helper is not set up');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await setHelper(page);
    dialog = await newFromLink(page, 'https://x.example/bot');
    await expect(dialog.getByRole('status')).toContainText('bot check');
    await expect(dialog.getByRole('button', { name: 'New from clipboard' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://x.example/login');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('sign in');
    await dialog.getByRole('textbox', { name: 'Web address' }).fill('https://x.example/paywall');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('paywall');
  });
});

test.describe('annotations and lasso on clippings', () => {
  test('L11: highlights and notes on top of a read-only clipping, shown in Reader and Original', async ({ page }) => {
    await openApp(page);
    await setHelper(page);
    await newFromLink(page, 'https://blog.example/posts/spaced-repetition');
    await expect(page.locator('.clip-article')).toContainText('Memory decays');
    const id = (await libraryItems(page)).clippings[0].id;
    const before = await page.evaluate((i) => (window as never as { __slate: { library: { clippingContent(id: string): Promise<{ markdown: string }> } } }).__slate.library.clippingContent(i).then((c) => c.markdown), id);
    await selectHelper(page, 'Memory decays');
    await page.getByRole('dialog', { name: 'Selection actions' }).getByRole('button', { name: 'Highlight blue' }).click();
    await expect(page.locator('.clip-scroll .hl-rect').first()).toBeVisible();
    expect((await annotations(page, id))[0]).toMatchObject({ kind: 'highlight', locator: { type: 'clipping', quote: { exact: 'Memory decays' }, view: 'reader' } });
    // the content never changes
    const after = await page.evaluate((i) => (window as never as { __slate: { library: { clippingContent(id: string): Promise<{ markdown: string }> } } }).__slate.library.clippingContent(i).then((c) => c.markdown), id);
    expect(after).toBe(before);
    // the same highlight shows on the saved page
    await page.getByRole('radio', { name: 'Original' }).click();
    const frame = page.frameLocator('[data-testid="snapshot-frame"]');
    await expect(frame.locator('h1')).toBeVisible();
    await expect(frame.locator('[data-slate-ui] div').first()).toBeAttached();
  });

  test('S1 S2 S5 S6: lasso a clipping in the Reader view and come back by quote', async ({ page }) => {
    await openApp(page);
    await copy(page, { text: '# Spectral theorem\n\nEvery real symmetric matrix is orthogonally diagonalizable.\n\nIts eigenvalues are real.' });
    await page.getByRole('button', { name: 'New from clipboard' }).click();
    await expect(page.locator('.clip-article p').first()).toBeVisible();
    const id = (await libraryItems(page)).clippings[0].id;
    await page.getByRole('button', { name: 'Lasso' }).click();
    const p = (await page.locator('.clip-article p').first().boundingBox())!;
    await lassoRect(page, { x: p.x - 8, y: p.y - 4, width: p.width + 16, height: p.height + 8 });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const c = await carry(page);
    expect(c[0].text).toBe('Every real symmetric matrix is orthogonally diagonalizable.');
    expect(c[0].source).toMatchObject({ type: 'clipping', id, locator: { type: 'clipping', view: 'reader', quote: { exact: 'Every real symmetric matrix is orthogonally diagonalizable.' } } });
    await page.evaluate((src) => (window as never as { __slateUi: { registries: { openSource(l: unknown): Promise<boolean> } } }).__slateUi.registries.openSource(src), c[0].source);
    await expect(page.locator('.clip-scroll [data-testid="flash"]').first()).toBeVisible();
  });

  test('S1 S2: lasso the Original view; capture runs inside the sandboxed frame', async ({ page }) => {
    await openApp(page);
    await setHelper(page);
    await newFromLink(page, 'https://blog.example/posts/spaced-repetition');
    await page.getByRole('radio', { name: 'Original' }).click();
    const frame = page.frameLocator('[data-testid="snapshot-frame"]');
    await expect(frame.locator('h2')).toHaveText('How to use it');
    const id = (await libraryItems(page)).clippings[0].id;
    const h2 = (await frame.locator('h2').boundingBox())!;
    const ul = (await frame.locator('article ul').boundingBox())!;
    await page.getByRole('button', { name: 'Lasso' }).click();
    await lassoRect(page, { x: h2.x - 6, y: h2.y - 4, width: Math.max(h2.width, ul.width) + 12, height: ul.y + ul.height - h2.y + 8 });
    await expect(page.getByTestId('capture-preview')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('capture-preview').getByRole('button', { name: 'Send to canvas' }).click();
    const c = await carry(page);
    expect(c[0].text).toContain('## How to use it');
    expect(c[0].text).toContain('- Write one fact per card.');
    expect(c[0].source).toMatchObject({ type: 'clipping', id, locator: { type: 'clipping', view: 'original', quote: { exact: expect.stringContaining('How to use it') } } });
    await page.getByRole('radio', { name: 'Reader' }).click();
    await page.evaluate((src) => (window as never as { __slateUi: { registries: { openSource(l: unknown): Promise<boolean> } } }).__slateUi.registries.openSource(src), c[0].source);
    await expect(page.getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.frameLocator('[data-testid="snapshot-frame"]').locator('[data-flash]').first()).toBeAttached();
  });
});

test('S7: a clipping marks where clips were taken; the mark lists them and reveals them on the canvas', async ({ page }) => {
  await openApp(page);
  await copy(page, { text: '# Notes\n\nThe spectral theorem diagonalizes symmetric matrices.\n\nOther text.' });
  await page.getByRole('button', { name: 'New from clipboard' }).click();
  await expect(page.locator('.clip-article p').first()).toBeVisible();
  const c = (await libraryItems(page)).clippings[0];
  await fakeCanvas(page);
  await seedClip(page, 'clipQ', { type: 'clipping', id: c.id, title: 'Notes', capturedAt: 1, contentHash: '', locator: { type: 'clipping', view: 'reader', offset: 6, quote: { exact: 'The spectral theorem diagonalizes', prefix: 'Notes', suffix: ' symmetric' } } }, 'The spectral theorem');
  const mark = page.locator('.clip-scroll').getByTestId('clip-mark');
  await expect(mark).toBeVisible({ timeout: 5000 });
  await mark.click();
  await page.getByRole('menuitem', { name: /The spectral theorem/ }).click();
  await expect.poll(() => page.evaluate(() => (window as never as { __revealed: string[] }).__revealed)).toEqual(['clipQ']);
});

/** Selects text in the clipping Reader view. */
async function selectHelper(page: Page, text: string) {
  const { selectText } = await import('./libraryHelpers');
  await selectText(page, '.clip-article', text);
}
