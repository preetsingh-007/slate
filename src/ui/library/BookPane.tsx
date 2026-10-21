/**
 * A book in the side pane: the PDF or EPUB viewer, or, when the file is not on this device
 * (synced from another device, L6), an offer to import it; the re-imported file is matched by
 * its content hash.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import type { PaneTab } from '../../core/model/types';
import { restoreBookFile } from '../../core/library/books';
import { useServices } from '../../app/services';
import { toast } from '../common/toast';
import type { PaneProps } from '../panes/registry';
import { announceBookFile, useBook, useHasFile } from './hooks';
import { EpubViewer } from './epub/EpubViewer';
import { PdfViewer } from './pdf/PdfViewer';

export function BookPane({ tab }: PaneProps<Extract<PaneTab, { kind: 'book' }>>) {
  const services = useServices();
  const book = useBook(tab.id);
  const hasFile = useHasFile(book?.fileHash ?? '');
  const [missing, setMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => setMissing(hasFile === false), [hasFile]);
  const onMissing = useCallback(() => setMissing(true), []);
  // R9, L6: in Git LFS mode the file downloads from the repository when it is not here
  const bookId = book?.id;
  useEffect(() => {
    if (!missing || !bookId || !services.settings.get().lfs) return;
    let alive = true;
    setDownloading(true);
    void services.sync.ensureBookFile(bookId).then((ok) => {
      if (!alive) return;
      setDownloading(false);
      if (ok) announceBookFile();
    });
    return () => {
      alive = false;
    };
  }, [missing, bookId, services]);
  if (!book) return <div className="empty">This book was deleted.</div>;
  if (hasFile === null) return <div className="empty">Opening…</div>;
  if (missing && downloading)
    return (
      <div className="empty" role="status">
        Downloading the file of “{book.title}”…
      </div>
    );
  if (missing) return <MissingFile bookId={book.id} />;
  return book.format === 'pdf' ? <PdfViewer key={book.fileHash} book={book} onMissing={onMissing} /> : <EpubViewer key={book.fileHash} book={book} onMissing={onMissing} />;
}

function MissingFile({ bookId }: { bookId: string }) {
  const services = useServices();
  const book = useBook(bookId)!;
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (await restoreBookFile(services, book, file)) {
        announceBookFile();
        toast(`The file of "${book.title}" is now on this device.`);
      } else toast(`${file.name} is a different file from the one imported on your other device.`, { ms: 6000 });
    } catch (e) {
      toast(`Could not store the file: ${(e as Error).message}`);
    }
  };
  return (
    <div
      className={`empty missing-file${drag ? ' drag' : ''}`}
      data-testid="missing-file"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void take(e.dataTransfer.files[0]);
      }}
    >
      <div>
        <h3>{book.title}</h3>
        <p>The file of this book is not on this device. Import the file to read it; it is matched by its content, so any copy of the same file works.</p>
        <p className="muted small">{book.fileName}</p>
        <button className="btn primary" onClick={() => input.current?.click()}>
          <FileUp size={16} /> Import the file to read
        </button>
        <input ref={input} type="file" hidden accept={book.format === 'pdf' ? '.pdf,application/pdf' : '.epub,application/epub+zip'} onChange={(e) => void take(e.target.files?.[0])} data-testid="missing-file-input" />
      </div>
    </div>
  );
}
