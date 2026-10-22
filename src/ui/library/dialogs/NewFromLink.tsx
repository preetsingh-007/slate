/**
 * New from link (L8, L9, L10): paste a URL; the fetch helper downloads the page; the article and
 * a snapshot are saved as a clipping. PDF links offer Import as book; arXiv abstract pages offer
 * the PDF or the HTML paper; failures explain why and offer New from clipboard.
 */
import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, FileText, Globe, Link2, Settings2 } from 'lucide-react';
import { useServices } from '../../../app/services';
import { importBookFile } from '../../../core/library/books';
import { createLinkClipping, fetchLink } from '../../../core/library/clippings';
import { FetchError, helperFetch, isConfigured } from '../../../core/library/helper';
import { classifyUrl, fileNameFromUrl, normalizeUrl, type LinkKind } from '../../../core/library/links';
import type { ResourceFetcher } from '../../../core/library/snapshot';
import { toast } from '../../common/toast';
import { usePopupFocus } from '../../common/focus';
import { newFromClipboard, openBook, openClipping } from '../actions';
import { useLibraryUi } from '../state';

type Stage =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'arxiv'; link: LinkKind }
  | { kind: 'pdf'; url: string; bytes?: Uint8Array }
  | { kind: 'error'; error: string; clipboard: boolean; settings: boolean };

export function NewFromLinkDialog({ initialUrl }: { initialUrl?: string }) {
  const services = useServices();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [showHelper, setShowHelper] = useState(!isConfigured(services.settings.getSecrets()));
  const [helperUrl, setHelperUrl] = useState(services.settings.getSecrets().helperUrl ?? '');
  const [helperKey, setHelperKey] = useState(services.settings.getSecrets().helperKey ?? '');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // the address field takes focus (the effect below); Tab stays inside; focus returns on close
  usePopupFocus(dialog, { trap: true, autoFocus: false });
  const abort = useRef<AbortController | null>(null);
  const close = () => {
    abort.current?.abort();
    useLibraryUi.getState().openDialog(null);
  };

  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfg = () => services.settings.getSecrets();
  const fail = (e: unknown) => {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    if (e instanceof FetchError) setStage({ kind: 'error', error: e.message, clipboard: e.offerClipboard, settings: e.reason === 'not-configured' || e.reason === 'helper-key' });
    else setStage({ kind: 'error', error: `Could not save the page: ${(e as Error)?.message ?? e}`, clipboard: true, settings: false });
  };

  const fetchRes = (signal: AbortSignal): ResourceFetcher => async (u) => {
    const r = await helperFetch(cfg(), u, { signal, timeoutMs: 6000 });
    return { bytes: r.bytes, contentType: r.contentType, finalUrl: r.finalUrl };
  };

  /** Downloads a PDF and imports it as a book (L1, L10). */
  const importPdf = async (pdfUrl: string, bytes?: Uint8Array) => {
    const ctl = (abort.current = new AbortController());
    try {
      setStage({ kind: 'busy', label: 'Downloading the PDF…' });
      const data = bytes ?? (await helperFetch(cfg(), pdfUrl, { signal: ctl.signal })).bytes;
      setStage({ kind: 'busy', label: 'Importing…' });
      const r = await importBookFile(services, new Blob([data as BlobPart], { type: 'application/pdf' }), fileNameFromUrl(pdfUrl));
      toast(r.existing ? `"${r.book.title}" is already in the library.` : `Imported "${r.book.title}"`);
      useLibraryUi.getState().openDialog(null);
      openBook(r.book.id);
    } catch (e) {
      fail(e);
    }
  };

  /** Saves a web page as a clipping (L8). */
  const savePage = async (pageUrl: string) => {
    const ctl = (abort.current = new AbortController());
    try {
      setStage({ kind: 'busy', label: 'Downloading the page…' });
      const page = await fetchLink((u) => helperFetch(cfg(), u, { signal: ctl.signal }), pageUrl);
      if (page.type === 'pdf') return setStage({ kind: 'pdf', url: page.finalUrl, bytes: page.bytes });
      setStage({ kind: 'busy', label: 'Saving the article and the page…' });
      const c = await createLinkClipping({ library: services.library, assets: (b) => services.assets.put(b) }, page, fetchRes(ctl.signal), { requestedUrl: pageUrl });
      useLibraryUi.getState().openDialog(null);
      openClipping(c.id);
    } catch (e) {
      fail(e);
    }
  };

  const go = (raw: string) => {
    const u = normalizeUrl(raw);
    if (!u) return setStage({ kind: 'error', error: 'That is not a web address (http or https).', clipboard: false, settings: false });
    if (!isConfigured(cfg())) {
      setShowHelper(true);
      return setStage({ kind: 'error', error: new FetchError('not-configured').message, clipboard: true, settings: true });
    }
    const link = classifyUrl(u);
    if (link.kind === 'arxiv-abs') return setStage({ kind: 'arxiv', link });
    if (link.kind === 'pdf') return setStage({ kind: 'pdf', url: link.pdfUrl ?? u });
    void savePage(u);
  };

  const saveHelper = async () => {
    await services.settings.setSecrets({ helperUrl: helperUrl.trim(), helperKey: helperKey.trim() });
    setShowHelper(false);
    setStage({ kind: 'idle' });
  };

  const busy = stage.kind === 'busy';

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby="nfl-title">
        <h2 id="nfl-title">
          <Link2 size={18} /> New from link
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) go(url);
          }}
        >
          <label className="field">
            <span>Web address</span>
            <input ref={input} type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} aria-describedby="nfl-status" />
          </label>
          <div id="nfl-status" className="nfl-status" role="status" aria-live="polite">
            {stage.kind === 'busy' && <span className="spinner-text">{stage.label}</span>}
            {stage.kind === 'error' && <span className="error-text">{stage.error}</span>}
          </div>
          {stage.kind === 'arxiv' && (
            <div className="choice" role="group" aria-label="arXiv paper">
              <p>This is an arXiv abstract page.</p>
              <button type="button" className="btn primary" onClick={() => void importPdf(stage.link.pdfUrl!)}>
                <FileText size={14} /> Import the PDF as a book
              </button>
              <button type="button" className="btn" onClick={() => void savePage(stage.link.htmlUrl!)}>
                <Globe size={14} /> Save the HTML paper as an article
              </button>
              <button type="button" className="btn" onClick={() => void savePage(stage.link.url)}>
                Save the abstract page
              </button>
            </div>
          )}
          {stage.kind === 'pdf' && (
            <div className="choice" role="group" aria-label="PDF link">
              <p>This link is a PDF.</p>
              <button type="button" className="btn primary" onClick={() => void importPdf(stage.url, stage.bytes)}>
                <FileText size={14} /> Import as book
              </button>
            </div>
          )}
          {stage.kind === 'error' && stage.clipboard && (
            <div className="choice">
              <p className="muted small">Open the page in your browser, copy the text, then:</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  useLibraryUi.getState().openDialog(null);
                  void newFromClipboard(services);
                }}
              >
                <ClipboardPaste size={14} /> New from clipboard
              </button>
            </div>
          )}
          {showHelper ? (
            <fieldset className="helper-settings">
              <legend>
                <Settings2 size={14} /> Fetch helper
              </legend>
              <p className="muted small">New from link downloads pages through your fetch helper (see worker/README.md). Its key stays on this device.</p>
              <label className="field">
                <span>Helper URL</span>
                <input type="url" value={helperUrl} onChange={(e) => setHelperUrl(e.target.value)} placeholder="https://slate-fetch.example.workers.dev" />
              </label>
              <label className="field">
                <span>Helper key</span>
                <input type="password" value={helperKey} onChange={(e) => setHelperKey(e.target.value)} autoComplete="off" />
              </label>
              <button type="button" className="btn" onClick={() => void saveHelper()} disabled={!helperUrl.trim() || !helperKey.trim()}>
                Save helper settings
              </button>
            </fieldset>
          ) : (
            <button type="button" className="link-btn small" onClick={() => setShowHelper(true)}>
              Fetch helper settings
            </button>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || !url.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
