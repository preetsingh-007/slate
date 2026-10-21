/**
 * Wires the library into the app: side-pane kinds ('library', 'book', 'clipping'), source
 * openers for books and clippings (S6), the link handler (S9) and file importer (S10, L1), the
 * New from clipboard shortcut (L7), background indexing (L12), dialogs and the capture preview.
 */
import { useEffect } from 'react';
import { ClipboardPaste, Library, Link2 } from 'lucide-react';
import type { PaneTab } from '../../core/model/types';
import { useServices, type Services } from '../../app/services';
import { registerFileImporter, registerLinkHandler, registerSourceOpener } from '../common/registries';
import { toast } from '../common/toast';
import { registerPane } from '../panes/registry';
import { importBookFiles, newFromClipboard, openBook, openClipping, openLibrary } from './actions';
import { BookPane } from './BookPane';
import { CapturePreview } from './CapturePreview';
import { ClippingPane } from './clipping/ClippingPane';
import { DeleteDialog, EditDialog, PasteDialog } from './dialogs/Dialogs';
import { NewFromLinkDialog } from './dialogs/NewFromLink';
import { startIndexer } from './indexer';
import { LibraryPane } from './LibraryPane';
import { useLibraryUi } from './state';
import './library.css';

/** Set by LibraryMount; pane titles are read outside React. */
let servicesRef: Services | null = null;

registerPane('library', { component: LibraryPane, title: () => 'Library' });
registerPane('book', {
  component: BookPane,
  title: (tab: Extract<PaneTab, { kind: 'book' }>) => servicesRef?.library.book(tab.id)?.title ?? 'Book',
});
registerPane('clipping', {
  component: ClippingPane,
  title: (tab: Extract<PaneTab, { kind: 'clipping' }>) => servicesRef?.library.clipping(tab.id)?.title ?? 'Clipping',
});

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.('[contenteditable="true"]');
}

/** Mount once in the app shell. */
export function LibraryMount() {
  const services = useServices();
  servicesRef = services;
  const dialog = useLibraryUi((s) => s.dialog);

  useEffect(() => {
    // S6: a clip's badge opens its source at the location, offline too
    registerSourceOpener('book', (link) => {
      const book = services.library.book(link.id);
      if (!book) return toast('This book was deleted (source deleted).');
      useLibraryUi.getState().jump(book.id, link.locator);
      openBook(book.id);
    });
    registerSourceOpener('clipping', (link) => {
      const c = services.library.clipping(link.id);
      if (!c) return toast('This clipping was deleted (source deleted).');
      useLibraryUi.getState().jump(c.id, link.locator);
      openClipping(c.id);
    });
    registerLinkHandler((url) => useLibraryUi.getState().openDialog({ kind: 'link', url }));
    registerFileImporter((files) => importBookFiles(services, files));
    const stop = startIndexer(services);
    // L7: Ctrl/Cmd+Shift+V when no text field is being edited
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'v') return;
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      e.preventDefault();
      void newFromClipboard(services);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey);
    };
  }, [services]);

  return (
    <>
      <CapturePreview />
      {dialog?.kind === 'link' && <NewFromLinkDialog initialUrl={dialog.url} />}
      {dialog?.kind === 'paste' && <PasteDialog />}
      {dialog?.kind === 'edit' && <EditDialog itemKind={dialog.itemKind} id={dialog.id} />}
      {dialog?.kind === 'delete' && <DeleteDialog itemKind={dialog.itemKind} id={dialog.id} />}
    </>
  );
}

/** Top-bar buttons: Library, New from clipboard, New from link. */
export function LibraryButtons() {
  const services = useServices();
  return (
    <>
      <button className="icon-btn" aria-label="Library" title="Library" onClick={openLibrary}>
        <Library size={18} />
      </button>
      <button className="icon-btn" aria-label="New from clipboard" title="New from clipboard (Ctrl/⌘ Shift V)" onClick={() => void newFromClipboard(services)}>
        <ClipboardPaste size={18} />
      </button>
      <button className="icon-btn" aria-label="New from link" title="New from link" onClick={() => useLibraryUi.getState().openDialog({ kind: 'link' })}>
        <Link2 size={18} />
      </button>
    </>
  );
}
