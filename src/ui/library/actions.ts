/**
 * Library actions used by buttons, shortcuts, drops and the registries: importing books (L1,
 * L6, S10), New from clipboard (L7) and opening items.
 */
import type { Services } from '../../app/services';
import { importBookFile, sniffBookFormat } from '../../core/library/books';
import { createClipboardClipping } from '../../core/library/clippings';
import { isUrl } from '../../core/library/links';
import { FileTooLargeError } from '../../core/storage/assets';
import { useApp } from '../app/store';
import { toast } from '../common/toast';
import { announceBookFile } from './hooks';
import { useLibraryUi } from './state';

export function openBook(id: string) {
  markOpened(id);
  useApp.getState().openTab({ kind: 'book', id });
}

export function openClipping(id: string) {
  markOpened(id);
  useApp.getState().openTab({ kind: 'clipping', id });
}

export function openLibrary() {
  useApp.getState().openTab({ kind: 'library' });
}

const OPENED_KEY = 'slate-library-opened';

/** When this device last opened each item (for "sort by opened", L12). */
export function openedTimes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function markOpened(id: string) {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify({ ...openedTimes(), [id]: Date.now() }));
  } catch {
    /* private mode */
  }
}

/** Imports PDF and EPUB files as books; opens the first one (L1, S10). Other files are skipped. */
export async function importBookFiles(services: Services, files: File[]): Promise<void> {
  let first: string | null = null;
  let skipped = 0;
  for (const f of files) {
    if (!(await sniffBookFormat(f, f.name))) {
      skipped++;
      continue;
    }
    try {
      const r = await importBookFile(services, f, f.name);
      if (r.existing) {
        announceBookFile();
        toast(`"${r.book.title}" is already in the library; its file is now on this device.`);
      } else toast(`Imported "${r.book.title}"`);
      first ??= r.book.id;
    } catch (e) {
      toast(e instanceof FileTooLargeError ? `${f.name}: ${e.message}` : `Could not import ${f.name}: ${(e as Error).message}`, { ms: 6000 });
    }
  }
  if (skipped && !first) toast('Only PDF and EPUB files can be imported as books.');
  if (first) openBook(first);
}

/** Reads the clipboard: HTML when offered, else plain text. Null when it cannot be read. */
export async function readClipboard(): Promise<{ html?: string; text?: string } | null> {
  const clip = navigator.clipboard;
  if (!clip) return null;
  try {
    if (clip.read) {
      const items = await clip.read();
      const out: { html?: string; text?: string } = {};
      for (const item of items) {
        if (!out.html && item.types.includes('text/html')) out.html = await (await item.getType('text/html')).text();
        if (!out.text && item.types.includes('text/plain')) out.text = await (await item.getType('text/plain')).text();
      }
      if (out.html || out.text) return out;
    }
  } catch {
    /* fall back to readText (Firefox, permission prompts) */
  }
  try {
    const text = await clip.readText();
    return text ? { text } : { text: '' };
  } catch {
    return null;
  }
}

/** New from clipboard (L7): one action, a clipping open in the side pane in well under 0.5 s. */
export async function newFromClipboard(services: Services, data?: { html?: string; text?: string }): Promise<void> {
  const input = data ?? (await readClipboard());
  if (!input) {
    // clipboard API unavailable or refused: let the owner paste into a dialog instead
    useLibraryUi.getState().openDialog({ kind: 'paste' });
    return;
  }
  const text = input.text?.trim() ?? '';
  if (!input.html && isUrl(text)) {
    // a copied link: offer New from link (S9)
    useLibraryUi.getState().openDialog({ kind: 'link', url: text });
    return;
  }
  const c = await createClipboardClipping(services, input);
  if (!c) {
    toast('The clipboard has no text to clip.');
    return;
  }
  openClipping(c.id);
}
