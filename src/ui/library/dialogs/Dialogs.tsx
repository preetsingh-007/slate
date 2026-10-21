/** Paste, edit and delete dialogs of the library (L1, L7, L12, L13). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { useServices } from '../../../app/services';
import { editBook, citationFor } from '../../../core/library/books';
import { lookupBib } from '../../../core/citations/enrich';
import { findArxivId, findDoi } from '../../../core/library/pdf';
import { helperAsFetch, isConfigured } from '../../../core/library/helper';
import { clipsPointingTo, deleteLibraryItem, type ClipSummary } from '../../../core/library/remove';
import { LibraryTextIndex } from '../../../core/library/textIndex';
import { useApp } from '../../app/store';
import { getTopicPicker } from '../../common/registries';
import { toast } from '../../common/toast';
import { newFromClipboard } from '../actions';
import { TopicTags } from '../clipping/ClippingPane';
import { useLibraryUi } from '../state';

function Dialog({ title, children, onClose, labelId }: { title: ReactNode; children: ReactNode; onClose(): void; labelId: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <h2 id={labelId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const close = () => useLibraryUi.getState().openDialog(null);

/** Fallback for New from clipboard when the clipboard cannot be read directly (L7). */
export function PasteDialog() {
  const services = useServices();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Dialog title="New from clipboard" onClose={close} labelId="paste-title">
      <p className="muted">Paste here (⌘V or Ctrl+V, or long-press and Paste).</p>
      <div
        ref={ref}
        className="paste-target"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Paste area"
        tabIndex={0}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          const text = e.clipboardData.getData('text/plain');
          close();
          void newFromClipboard(services, { html: html || undefined, text });
        }}
      />
      <div className="actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** Edit a book's metadata (L1: title, authors, year, edition; citation follows) or a clipping's. */
export function EditDialog({ itemKind, id }: { itemKind: 'book' | 'clipping'; id: string }) {
  const services = useServices();
  const book = itemKind === 'book' ? services.library.book(id) : undefined;
  const clipping = itemKind === 'clipping' ? services.library.clipping(id) : undefined;
  const [title, setTitle] = useState(book?.title ?? clipping?.title ?? '');
  const [authors, setAuthors] = useState((book?.authors ?? []).join('; '));
  const [year, setYear] = useState(book?.year ? String(book.year) : '');
  const [edition, setEdition] = useState(book?.edition ?? '');
  const [label, setLabel] = useState(clipping?.sourceLabel ?? '');
  const [topics, setTopics] = useState<string[]>(book?.topics ?? clipping?.topics ?? []);
  const [ident, setIdent] = useState('');
  const [looking, setLooking] = useState(false);
  if (!book && !clipping) return null;
  const authorList = authors.split(/\s*;\s*|\n/).map((a) => a.trim()).filter(Boolean);
  const citation = citationFor({ authors: authorList, title, edition, year: Number(year) || undefined });

  const lookup = async () => {
    const cfg = services.settings.getSecrets();
    if (!isConfigured(cfg)) return toast('Set up the fetch helper (New from link) to look up metadata.');
    setLooking(true);
    try {
      const bib = await lookupBib({ doi: findDoi(ident), arxiv: findArxivId(ident) ?? (/^\d{4}\.\d{4,5}(v\d+)?$/.test(ident.trim()) ? ident.trim() : undefined) }, helperAsFetch(cfg));
      if (!bib) return toast('Nothing found for that identifier.');
      if (bib.title) setTitle(bib.title);
      if (bib.authors?.length) setAuthors(bib.authors.join('; '));
      if (bib.year) setYear(String(bib.year));
    } catch (e) {
      toast(`Lookup failed: ${(e as Error).message}`);
    } finally {
      setLooking(false);
    }
  };

  const save = async () => {
    if (book) await services.library.putBook(editBook(book, { title: title.trim() || book.title, authors: authorList, year: Number(year) || undefined, edition: edition.trim() || undefined, topics }));
    else if (clipping) {
      const next = { ...clipping, title: title.trim() || clipping.title, topics };
      if (label.trim()) next.sourceLabel = label.trim();
      else delete next.sourceLabel;
      await services.library.putClipping(next);
    }
    close();
  };
  const Picker = getTopicPicker();
  // the topic picker commits a typed path when it loses focus: let that commit (and the
  // re-render it causes) happen before saving, with the latest state
  const saveRef = useRef(save);
  saveRef.current = save;
  return (
    <Dialog title={book ? 'Book details' : 'Clipping details'} onClose={close} labelId="edit-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
          setTimeout(() => void saveRef.current(), 0);
        }}
      >
        <label className="field">
          <span>Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        {book && (
          <>
            <label className="field">
              <span>Authors (separate with ;)</span>
              <input type="text" value={authors} onChange={(e) => setAuthors(e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Year</span>
                <input type="text" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, '').slice(0, 4))} />
              </label>
              <label className="field">
                <span>Edition</span>
                <input type="text" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="4th" />
              </label>
            </div>
            <div className="field">
              <span>Citation (gym format)</span>
              <output className="citation" aria-live="polite">
                {citation}
              </output>
            </div>
            <div className="field-row">
              <label className="field" style={{ flex: 1 }}>
                <span>DOI or arXiv id (optional lookup)</span>
                <input type="text" value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="10.1000/xyz or 2401.01234" />
              </label>
              <button type="button" className="btn" onClick={() => void lookup()} disabled={!ident.trim() || looking} style={{ alignSelf: 'flex-end', marginBottom: 10 }}>
                <Search size={14} /> Look up
              </button>
            </div>
          </>
        )}
        {clipping && (
          <label className="field">
            <span>Source label</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ChatGPT, Claude, a URL…" />
          </label>
        )}
        <div className="field">
          <span>Topics</span>
          <TopicTags topics={topics} onChange={setTopics} Picker={Picker} />
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary" onMouseDown={(e) => e.preventDefault()}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Delete with a warning listing the clips that point to the item (L13). */
export function DeleteDialog({ itemKind, id }: { itemKind: 'book' | 'clipping'; id: string }) {
  const services = useServices();
  const item = itemKind === 'book' ? services.library.book(id) : services.library.clipping(id);
  const [clips, setClips] = useState<ClipSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    void clipsPointingTo(services.canvases, id).then((c) => alive && setClips(c));
    return () => {
      alive = false;
    };
  }, [services.canvases, id]);
  if (!item) return null;
  const remove = async () => {
    await deleteLibraryItem({ library: services.library, index: new LibraryTextIndex(services.db), settings: services.settings }, itemKind, id);
    const app = useApp.getState();
    const i = app.tabs.findIndex((t) => (t.kind === 'book' || t.kind === 'clipping') && t.id === id);
    if (i >= 0) app.closeTab(i);
    close();
    toast(`Deleted "${item.title}"`);
  };
  return (
    <Dialog title={`Delete ${itemKind === 'book' ? 'book' : 'clipping'}?`} onClose={close} labelId="delete-title">
      <p>
        <strong>{item.title}</strong> and its highlights and notes will be removed from the library.
      </p>
      {clips === null && <p className="muted">Looking for clips from it…</p>}
      {clips && clips.length > 0 && (
        <div className="warning" role="alert" data-testid="delete-warning">
          <p>
            <AlertTriangle size={16} /> {clips.length === 1 ? '1 clip on your canvases points to it.' : `${clips.length} clips on your canvases point to it.`} They keep their image and
            text, and their badge will show “source deleted”.
          </p>
          <ul className="clip-summary">
            {clips.slice(0, 20).map((c) => (
              <li key={`${c.canvas}/${c.clipId}`}>
                <span className="muted small">
                  {c.canvas} · {c.month}
                </span>{' '}
                {c.label}
              </li>
            ))}
            {clips.length > 20 && <li className="muted">and {clips.length - 20} more</li>}
          </ul>
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn danger" onClick={() => void remove()} disabled={clips === null}>
          Delete
        </button>
      </div>
    </Dialog>
  );
}
