/** Helpers for the library e2e tests. */
import { expect, type Page } from '@playwright/test';

export const API = process.env.SLATE_E2E_API ?? 'http://localhost:4455';
export const HELPER_KEY = 'e2e-key';

/** Opens the app with empty storage and waits for the services. */
export async function openApp(page: Page) {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __slate?: unknown }).__slate);
}

/** Points the app at the fake fetch helper of the test server. */
export async function setHelper(page: Page) {
  await page.evaluate(
    ([url, key]) => (window as unknown as { __slate: { settings: { setSecrets(p: object): Promise<void> } } }).__slate.settings.setSecrets({ helperUrl: url, helperKey: key }),
    [`${API}/helper/`, HELPER_KEY],
  );
}

export async function openLibrary(page: Page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByTestId('library')).toBeVisible();
}

/** Imports a book through the library's file picker and waits until it is open. */
export async function importFile(page: Page, name: string, buffer: Uint8Array, mimeType: string) {
  await openLibrary(page);
  await page.getByRole('tab', { name: /Books/ }).click();
  const before = (await libraryItems(page)).books.length;
  await page.getByTestId('import-input').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
  await expect.poll(async () => (await libraryItems(page)).books.length).toBe(before + 1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __slateUi: { useApp: { getState(): { tabs: { kind: string }[] } } } }).__slateUi.useApp.getState().tabs[0]?.kind))
    .toBe('book');
}

/** Selects text in the active pane programmatically (the first element matching, chars [from, to)). */
export async function selectText(page: Page, selector: string, needle: string) {
  await page.evaluate(
    ([sel, text]) => {
      const root = document.querySelector(sel)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const i = (n.nodeValue ?? '').indexOf(text);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + text.length);
        const s = window.getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        const b = r.getBoundingClientRect();
        (n.parentElement as HTMLElement).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: b.right, clientY: b.bottom }));
        return;
      }
      throw new Error(`text not found: ${text}`);
    },
    [selector, needle] as const,
  );
}

/** Draws a lasso rectangle with the mouse over a client rect (lasso tool must be on). */
export async function lassoRect(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const pts = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
    [box.x, box.y + 2],
  ];
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

/** Carry tray contents (captures sent while the canvas placeholder has no API). */
export async function carry(page: Page) {
  return page.evaluate(() => {
    const ui = (window as unknown as { __slateUi: { useApp: { getState(): { carry: { text: string; source: unknown; image?: Blob; imageSize?: unknown }[] } } } }).__slateUi;
    return ui.useApp.getState().carry.map((c) => ({ text: c.text, source: c.source, hasImage: !!c.image, imageSize: c.imageSize }));
  });
}

/** Annotations stored in ann:<id>. */
export async function annotations(page: Page, itemId: string) {
  return page.evaluate(async (id) => {
    const s = (window as unknown as { __slate: { docs: { open(id: string): Promise<{ getMap(n: string): { toJSON(): Record<string, unknown> } }> } } }).__slate;
    const doc = await s.docs.open(`ann:${id}`);
    return Object.values(doc.getMap('annotations').toJSON()) as { kind: string; color: string; text?: string; locator: Record<string, unknown>; strokes?: unknown[]; rects?: unknown[] }[];
  }, itemId);
}

/** Library items. */
export async function libraryItems(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __slate: { library: { books(): { id: string; title: string; fileHash: string; slug: string }[]; clippings(): { id: string; title: string; slug: string }[] } } }).__slate;
    return { books: s.library.books(), clippings: s.library.clippings() };
  });
}

/** Seeds a clip on the main canvas (October 2026 segment) pointing to a source. */
export async function seedClip(page: Page, clipId: string, source: object, text = 'A clipped passage') {
  await page.evaluate(
    async ([id, src, t]) => {
      const s = (window as unknown as { __slate: { docs: { open(id: string): Promise<{ getMap(n: string): { set(k: string, v: unknown): void; constructor: new () => { set(k: string, v: unknown): void } } }> } } }).__slate;
      const doc = await s.docs.open('seg:main:2026-10');
      const objects = doc.getMap('objects');
      // a Y.Map built with the document's own Yjs (page code cannot import yjs)
      const m = new objects.constructor();
      const fields: Record<string, unknown> = { id, kind: 'clip', x: 0, y: 0, w: 200, h: 100, rotation: 0, z: 'a', created: Date.UTC(2026, 9, 21), edited: Date.UTC(2026, 9, 21), device: 'e2e', topics: [], text: t, display: 'both', source: src };
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      objects.set(id, m);
    },
    [clipId, source, text] as const,
  );
}

/** Registers a fake canvas API recording inserted captures and revealed objects. */
export async function fakeCanvas(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __slateUi: { registries: { registerCanvasApi(slug: string, api: object): void } }; __inserted: unknown[]; __revealed: string[] };
    w.__inserted = [];
    w.__revealed = [];
    const pane = () => document.querySelector('.pane-canvas')!.getBoundingClientRect();
    w.__slateUi.registries.registerCanvasApi('main', {
      insertCaptures: async (captures: { text: string; source: unknown }[], at?: { x: number; y: number }) => {
        w.__inserted.push({ captures: captures.map((c) => ({ text: c.text, source: c.source })), at });
        return captures.map((_, i) => `clip${i}`);
      },
      revealObject: (id: string) => w.__revealed.push(id),
      revealRegion: () => {},
      clientToCanvas: (x: number, y: number) => {
        const r = pane();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? { x: x - r.left, y: y - r.top } : null;
      },
    });
  });
}
