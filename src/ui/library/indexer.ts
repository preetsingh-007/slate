/**
 * Background indexing of the library's full text on this device (L12): PDF pages, EPUB text and
 * clipping Markdown, one item at a time and yielding between pages, so reading stays smooth.
 */
import type { Services } from '../../app/services';
import { parseEpub } from '../../core/library/epub';
import { closePdf, iteratePageTexts, openPdf } from '../../core/library/pdf';
import { LibraryTextIndex } from '../../core/library/textIndex';

/** Yields to the page; the timeout keeps indexing going on a busy page. */
const idle = () =>
  new Promise<void>((r) =>
    'requestIdleCallback' in window ? (window as unknown as { requestIdleCallback(cb: () => void, o: { timeout: number }): void }).requestIdleCallback(() => r(), { timeout: 250 }) : setTimeout(r, 16),
  );

export function startIndexer(services: Services): () => void {
  const index = new LibraryTextIndex(services.db);
  const ctl = new AbortController();
  let running = false;
  let again = false;

  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (const c of services.library.clippings()) {
          if (ctl.signal.aborted) return;
          if (await index.has(c.id, c.contentHash)) continue;
          const content = await services.library.clippingContent(c.id);
          if (content) await index.put({ id: c.id, text: content.markdown, source: c.contentHash });
        }
        for (const b of services.library.books()) {
          if (ctl.signal.aborted) return;
          if (await index.has(b.id, b.fileHash)) continue;
          const blob = await services.assets.get(b.fileHash);
          if (!blob) continue;
          try {
            if (b.format === 'pdf') {
              const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()), { transfer: true });
              const pages: string[] = [];
              try {
                for await (const p of iteratePageTexts(pdf, { signal: ctl.signal })) {
                  pages.push(p.text);
                  if (p.page % 8 === 0) await idle();
                }
              } finally {
                await closePdf(pdf);
              }
              await index.put({ id: b.id, pages, source: b.fileHash });
            } else {
              const book = await parseEpub(blob);
              try {
                await index.put({ id: b.id, text: await book.sampleText(Infinity), source: b.fileHash });
              } finally {
                book.dispose();
              }
            }
          } catch {
            /* unreadable or aborted: try again next time */
          }
          await idle();
        }
      } while (again && !ctl.signal.aborted);
    } finally {
      running = false;
    }
  };

  const t = setTimeout(() => void run(), 1500);
  const off = services.library.onChange.on(() => void run());
  const onFile = () => void run();
  window.addEventListener('slate-book-file', onFile);
  return () => {
    clearTimeout(t);
    ctl.abort();
    off();
    window.removeEventListener('slate-book-file', onFile);
  };
}
