import { expect, test, type Locator, type Page } from '@playwright/test';
import { openWithGym, pane } from './gym-helpers';

const checklist = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const d = await (window as any).__slate.docs.open('todo');
    return d.getText('checklist').toString();
  });

const press = (l: Locator) => (test.info().project.name === 'tablet' ? l.tap() : l.click());

/** Seeds canvas text boxes through the canvas store (the canvas UI is another area). */
async function seedCanvas(page: Page) {
  await page.evaluate(async () => {
    const s = (window as any).__slate;
    const now = Date.now();
    const yesterday = now - 86_400_000;
    const month = (t: number) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const box = (id: string, content: string, created: number, y: number) => ({ id, kind: 'text', x: 0, y, w: 300, h: 60, rotation: 0, z: 'i', created, edited: created, device: 'e2e', topics: [], content, fontSize: 16 });
    const main = s.canvases.model('main');
    await main.load([month(now), month(yesterday)]);
    main.transact((tx: any) => {
      tx.add(box('tb-today', 'Lecture 5\n- [ ] prove $\\dim U + \\dim W$\n- [x] done already', now, 200));
      tx.add(box('tb-old', '- [ ] email the TA', yesterday, 50));
    });
    await s.canvases.create('Physics', 'physics');
    const phys = s.canvases.model('physics');
    await phys.load([month(now)]);
    phys.transact((tx: any) => tx.add(box('tb-phys', '- [ ] lab report', now, 10)));
  });
}

test.describe('To-dos page (G4)', () => {
  test('checklist: Enter adds the next item, tap checks into Done, reorder and remove @touch', async ({ page }) => {
    await openWithGym(page);
    await press(page.getByRole('button', { name: 'To-dos', exact: true }));
    const p = pane(page);
    await expect(p.getByRole('heading', { name: 'Checklist' })).toBeVisible();
    const add = p.getByRole('textbox', { name: 'Add a to-do' });
    await add.fill('Buy chalk');
    await add.press('Enter');
    await add.fill('Email TA');
    await add.press('Enter');
    await expect.poll(() => checklist(page)).toBe('- [ ] Buy chalk\n- [ ] Email TA\n');

    // Enter in an item adds the next one right after it, focused
    const list = p.getByRole('list', { name: 'Checklist' });
    await list.getByRole('textbox', { name: 'To-do' }).first().press('End');
    await list.getByRole('textbox', { name: 'To-do' }).first().press('Enter');
    await expect(list.getByRole('textbox', { name: 'To-do' }).nth(1)).toBeFocused();
    await page.keyboard.type('Read Axler 5B');
    await expect.poll(() => checklist(page)).toBe('- [ ] Buy chalk\n- [ ] Read Axler 5B\n- [ ] Email TA\n');

    // tap to check: the item moves to the collapsed Done list
    await press(p.getByRole('checkbox', { name: 'Done: Buy chalk' }));
    await expect.poll(() => checklist(page)).toBe('- [x] Buy chalk\n- [ ] Read Axler 5B\n- [ ] Email TA\n');
    await expect(list.getByRole('textbox', { name: 'To-do' })).toHaveCount(2);
    const done = p.locator('details.gym-done');
    await expect(done.locator('summary')).toHaveText('Done (1)');
    await expect(done.getByText('Buy chalk')).toBeHidden();
    await press(done.locator('summary'));
    await expect(done.getByText('Buy chalk')).toBeVisible();

    // keyboard reorder: Alt+↑ moves the item up among the open items
    await list.getByRole('textbox', { name: 'To-do' }).nth(1).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => checklist(page)).toBe('- [x] Buy chalk\n- [ ] Email TA\n- [ ] Read Axler 5B\n');

    // remove: the button, then Backspace on an emptied item
    await press(p.getByRole('button', { name: 'Remove “Email TA”' }));
    await expect.poll(() => checklist(page)).toBe('- [x] Buy chalk\n- [ ] Read Axler 5B\n');
    await expect(page.getByRole('status')).toContainText('Removed “Email TA”');
    const item = list.getByRole('textbox', { name: 'To-do' }).first();
    await item.fill('');
    await item.press('Backspace');
    await expect.poll(() => checklist(page)).toBe('- [x] Buy chalk\n');
  });

  test('drag the handle to reorder', async ({ page }) => {
    await openWithGym(page);
    await page.evaluate(async () => {
      const d = await (window as any).__slate.docs.open('todo');
      d.getText('checklist').insert(0, '- [ ] one\n- [ ] two\n- [ ] three\n');
    });
    await page.getByRole('button', { name: 'To-dos', exact: true }).click();
    const handles = pane(page).locator('.gym-todo-handle');
    await expect(handles).toHaveCount(3);
    const from = (await handles.nth(0).boundingBox())!;
    const to = (await handles.nth(2).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height - 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => checklist(page)).toBe('- [ ] two\n- [ ] three\n- [ ] one\n');
    // the handle reorders from the keyboard too
    await handles.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => checklist(page)).toBe('- [ ] three\n- [ ] two\n- [ ] one\n');
    await expect(pane(page).locator('.gym-todo-handle').nth(1)).toBeFocused();
  });

  test('swipe left removes an item @touch', async ({ page }) => {
    test.skip(test.info().project.name !== 'tablet', 'real touch events');
    await openWithGym(page);
    await page.evaluate(async () => {
      const d = await (window as any).__slate.docs.open('todo');
      d.getText('checklist').insert(0, '- [ ] keep\n- [ ] swipe me\n');
    });
    await page.getByRole('button', { name: 'To-dos', exact: true }).tap();
    const row = pane(page).locator('li.gym-todo').nth(1);
    const b = (await row.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y = b.y + b.height / 2;
    const x0 = b.x + b.width - 60;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 16, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => checklist(page)).toBe('- [ ] keep\n');
  });

  test('from the canvas: open to-dos by day, newest first; checking one checks it on the canvas; tapping jumps to it @touch', async ({ page }) => {
    await openWithGym(page);
    await seedCanvas(page);
    // a stand-in canvas API records what the To-dos page asks the canvas to reveal
    await page.evaluate(() => {
      const g = (window as any).__slateGym;
      (window as any).__revealed = [];
      for (const slug of ['main', 'physics'])
        g.registerCanvasApi(slug, {
          insertCaptures: async () => [],
          revealObject: (id: string) => (window as any).__revealed.push(`${slug}:${id}`),
          revealRegion: () => {},
          clientToCanvas: () => null,
        });
    });
    await press(page.getByRole('button', { name: 'To-dos', exact: true }));
    const days = pane(page).locator('.gym-todo-day');
    await expect(days).toHaveCount(2);
    await expect(days.nth(0).locator('h3')).toContainText('Today');
    await expect(days.nth(1).locator('h3')).toContainText('Yesterday');
    await expect(days.nth(0).locator('li')).toHaveCount(2);
    await expect(days.nth(0)).toContainText('Physics');
    await expect(days.nth(0).locator('.katex')).toHaveCount(1);
    await expect(days.nth(1)).toContainText('email the TA');
    await expect(pane(page)).not.toContainText('done already');

    // checking it here checks it in the text box on the canvas
    await press(pane(page).getByRole('checkbox', { name: /Done: prove/ }));
    await expect
      .poll(() => page.evaluate(() => (window as any).__slate.canvases.model('main').get('tb-today').content))
      .toBe('Lecture 5\n- [x] prove $\\dim U + \\dim W$\n- [x] done already');
    await expect(days.nth(0).locator('li')).toHaveCount(1);

    // tapping the text jumps to it on the canvas, switching canvas when needed
    await press(pane(page).getByRole('button', { name: /lab report/ }));
    await expect.poll(() => page.evaluate(() => (window as any).__revealed)).toEqual(['physics:tb-phys']);
    expect(await page.evaluate(() => (window as any).__slateGym.app.getState().canvas)).toBe('physics');
  });
});

test.describe('To-dos page on an iPhone-width screen (G4, P2)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens full screen and works with one hand @touch', async ({ page }) => {
    await openWithGym(page);
    await press(page.getByRole('button', { name: 'To-dos', exact: true }));
    await expect(page.locator('.pane-canvas')).toBeHidden();
    const p = pane(page);
    await expect(p.getByRole('heading', { name: 'Checklist' })).toBeInViewport();
    const box = (await p.locator('.gym-todos').boundingBox())!;
    expect(box.width).toBeGreaterThan(340);
    await p.getByRole('textbox', { name: 'Add a to-do' }).fill('Quick one');
    await p.getByRole('textbox', { name: 'Add a to-do' }).press('Enter');
    await expect.poll(() => checklist(page)).toBe('- [ ] Quick one\n');
  });
});
