/**
 * W5 · Lookup and revision: the gym reader (tree, a notes file with maths, search), the
 * revision list, and the To-dos page with its checklist and the to-dos written on canvases.
 */
import { sleep } from '../lib/util.mjs';
import { begin, finish, seedHistory, seedToday, start } from './common.mjs';

const K = 'W5 · Lookup and revision';

export default {
  id: 'lookup',
  title: 'Lookup and revision (W5)',
  trailer: [['Gym reader', 4]],
  async run(env) {
    const s = await begin(env, 'lookup');
    const { page, app, d, rec } = s;
    d.capPos = 'left';
    await seedHistory(app);
    await seedToday(app);
    await page.evaluate(async () => {
      const doc = await window.__slate.docs.open('todo');
      const t = doc.getText('checklist');
      if (!t.toString()) t.insert(0, '- [ ] Email the TA about office hours\n- [ ] Print problem sheet 6\n- [x] Return library books\n');
    });
    const side = page.locator('.pane-slot:not([hidden])');

    await start(s, { num: 'Part 5', title: 'Lookup and revision', sub: 'Your gym repository, rendered and searchable, offline.' });

    // ---------------------------------------------------------------- gym reader
    rec.mark('Gym reader');
    await d.caption({ kicker: K, title: 'Gym: browse your notes and problems', body: 'Domains, subjects and topics with their status, rendered with maths, even offline.' });
    await d.click(page.getByRole('button', { name: 'Gym', exact: true }));
    await app.canvas((h) => h.engine.setCamera({ x: -10, y: h.engine.camera.y - 10, zoom: 0.66 }, false));
    await sleep(1200);
    await d.click(side.getByRole('button', { name: /Eigenvalues active/ }));
    await sleep(1400);
    await d.click(side.getByRole('button', { name: 'notes.md' }));
    await side.locator('.gym-md .katex').first().waitFor();
    await sleep(1500);
    await d.hover([1150, 520]);
    await d.wheel(0, 700, { ms: 1400 });
    await sleep(1200);

    // ---------------------------------------------------------------- search
    rec.mark('Search gym');
    await d.caption({ kicker: K, title: 'Search all of gym', body: 'Results open at their section.' });
    await d.click(side.getByRole('navigation', { name: 'Gym path' }).getByRole('button', { name: 'Gym' }).first());
    await sleep(500);
    await d.click(side.getByRole('searchbox', { name: 'Search gym' }));
    await d.type('self-adjoint', { delay: 60 });
    await sleep(1200);
    await d.click(side.getByRole('list', { name: 'Search results' }).getByRole('button').first());
    await sleep(1800);

    // ---------------------------------------------------------------- revision list
    rec.mark('Revision list');
    await d.caption({ kicker: K, title: 'The revision list', body: 'Problems to revisit first, then open problems, then finished topics you have not logged for longest.' });
    await d.click(page.getByRole('button', { name: 'Revision list', exact: true }).first());
    await sleep(1800);
    await d.click(side.getByRole('button', { name: /Trace and eigenvalues/ }));
    await sleep(1800);

    // ---------------------------------------------------------------- to-dos
    rec.mark('To-dos');
    await d.caption({ kicker: K, title: 'To-dos: a checklist, plus every `- [ ]` on your canvases', body: 'Tick them here or on the canvas; tap one from a canvas to jump to it.' });
    await d.click(page.getByRole('button', { name: 'To-dos', exact: true }));
    await sleep(800);
    await d.click(side.getByRole('textbox', { name: 'Add a to-do' }));
    await d.type('Redo problem 002 (trace)');
    await page.keyboard.press('Enter');
    await sleep(700);
    await d.click(side.getByRole('checkbox', { name: /Done: Print problem sheet 6/ }));
    await sleep(1200);
    await d.click(side.getByRole('button', { name: /Read Axler 5B/ }).first());
    await sleep(2200);

    return finish(env, s);
  },
};
