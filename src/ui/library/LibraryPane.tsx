/**
 * The library view (L12, L13, L1): two shelves, Books and Clippings, in a grid or a list;
 * search across titles and full text (indexed on this device); sort by added, opened or title;
 * filter by gym topic. Files dropped here are imported as books.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ClipboardPaste, FileText, FileUp, Globe, LayoutGrid, Link2, List, MessageSquareText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { BookMeta, ClippingMeta } from '../../core/model/types';
import { LibraryTextIndex, type SearchHit } from '../../core/library/textIndex';
import { useServices } from '../../app/services';
import { importBookFiles, newFromClipboard, openBook, openClipping, openedTimes } from './actions';
import { useLibraryItems, useLocalPref, useSettingsVersion } from './hooks';
import { useLibraryUi } from './state';

type Shelf = 'books' | 'clippings';
type Sort = 'added' | 'opened' | 'title';

export function LibraryPane() {
  const services = useServices();
  const { books, clippings } = useLibraryItems();
  useSettingsVersion();
  const [shelf, setShelf] = useLocalPref<Shelf>('slate-lib-shelf', 'books');
  const [layout, setLayout] = useLocalPref<'grid' | 'list'>('slate-lib-layout', 'grid');
  const [sort, setSort] = useLocalPref<Sort>('slate-lib-sort', 'added');
  const [topic, setTopic] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Map<string, SearchHit> | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const index = useMemo(() => new LibraryTextIndex(services.db), [services.db]);

  // which book files are not on this device (L6)
  useEffect(() => {
    let alive = true;
    void Promise.all(books.map(async (b) => [b.id, await services.assets.has(b.fileHash)] as const)).then((r) => {
      if (alive) setMissing(new Set(r.filter(([, has]) => !has).map(([id]) => id)));
    });
    const on = () => setMissing(new Set());
    window.addEventListener('slate-book-file', on);
    return () => {
      alive = false;
      window.removeEventListener('slate-book-file', on);
    };
  }, [books, services.assets]);

  const items: (BookMeta | ClippingMeta)[] = shelf === 'books' ? books : clippings;
  const topics = useMemo(() => [...new Set([...books, ...clippings].flatMap((i) => i.topics ?? []))].sort(), [books, clippings]);

  // full-text search (debounced)
  useEffect(() => {
    if (!query.trim()) return setHits(null);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const list = items.map((i) => ({
        id: i.id,
        title: i.title,
        extra: 'authors' in i ? i.authors.join(' ') : [i.site, i.author, i.sourceLabel].filter(Boolean).join(' '),
      }));
      void index.search(query, list, ctl.signal).then((r) => !ctl.signal.aborted && setHits(new Map(r.map((h) => [h.id, h]))));
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, items, index]);

  const opened = openedTimes();
  const positions = services.settings.get().readingPositions ?? {};
  const openedAt = (id: string) => Math.max(opened[id] ?? 0, positions[id]?.updated ?? 0);
  const shown = items
    .filter((i) => !topic || (i.topics ?? []).some((t) => t === topic || t.startsWith(`${topic}/`)))
    .filter((i) => !hits || hits.has(i.id))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : sort === 'opened' ? openedAt(b.id) - openedAt(a.id) : b.added - a.added));

  const open = (i: BookMeta | ClippingMeta) => ('fileHash' in i ? openBook(i.id) : openClipping(i.id));

  return (
    <div
      className={`library${drag ? ' drag' : ''}`}
      data-testid="library"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const files = [...e.dataTransfer.files];
        if (files.length) return void importBookFiles(services, files);
        const url = e.dataTransfer.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'));
        if (url) useLibraryUi.getState().openDialog({ kind: 'link', url });
      }}
    >
      <div className="lib-head">
        <div className="seg" role="tablist" aria-label="Shelves">
          <button role="tab" aria-selected={shelf === 'books'} onClick={() => setShelf('books')}>
            <BookOpen size={14} /> Books <span className="count">{books.length}</span>
          </button>
          <button role="tab" aria-selected={shelf === 'clippings'} onClick={() => setShelf('clippings')}>
            <MessageSquareText size={14} /> Clippings <span className="count">{clippings.length}</span>
          </button>
        </div>
        <span className="spacer" />
        {shelf === 'books' ? (
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <FileUp size={14} /> Import
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => void newFromClipboard(services)} title="New from clipboard (Ctrl/⌘ Shift V)">
              <ClipboardPaste size={14} /> Clipboard
            </button>
            <button className="btn" onClick={() => useLibraryUi.getState().openDialog({ kind: 'link' })}>
              <Link2 size={14} /> Link
            </button>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".pdf,.epub,application/pdf,application/epub+zip"
          data-testid="import-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importBookFiles(services, files);
          }}
        />
      </div>
      <div className="lib-filters">
        <input type="search" aria-label={`Search ${shelf}`} placeholder="Search titles and text" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="added">Recently added</option>
          <option value="opened">Recently opened</option>
          <option value="title">Title</option>
        </select>
        <select aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="seg" role="radiogroup" aria-label="Layout">
          <button role="radio" aria-checked={layout === 'grid'} aria-label="Grid" onClick={() => setLayout('grid')}>
            <LayoutGrid size={14} />
          </button>
          <button role="radio" aria-checked={layout === 'list'} aria-label="List" onClick={() => setLayout('list')}>
            <List size={14} />
          </button>
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? shelf === 'books'
              ? 'No books yet. Import a PDF or EPUB, or drop files here.'
              : 'No clippings yet. Copy a chatbot answer and choose New from clipboard, or save a web page with New from link.'
            : 'Nothing matches.'}
        </div>
      ) : (
        <ul className={`lib-items ${layout}`} aria-label={shelf === 'books' ? 'Books' : 'Clippings'}>
          {shown.map((i) => (
            <Item key={i.id} item={i} layout={layout} hit={hits?.get(i.id)} missing={missing.has(i.id)} onOpen={() => open(i)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Item({ item, layout, hit, missing, onOpen }: { item: BookMeta | ClippingMeta; layout: 'grid' | 'list'; hit?: SearchHit; missing: boolean; onOpen(): void }) {
  const [menu, setMenu] = useState(false);
  const isBook = 'fileHash' in item;
  const sub = isBook ? [item.authors.join(', '), item.year].filter(Boolean).join(' · ') : [item.sourceLabel, item.site, item.author].filter(Boolean).join(' · ');
  const kind = isBook ? item.format.toUpperCase() : item.origin === 'link' ? 'Web' : 'Clipboard';
  return (
    <li className={`lib-item ${layout}`} data-testid="library-item">
      <button className="lib-open" onClick={onOpen} aria-label={`Open ${item.title}`}>
        <span className={`lib-cover ${isBook ? item.format : 'clipping'}`} aria-hidden>
          {isBook ? <FileText size={layout === 'grid' ? 28 : 16} /> : item.origin === 'link' ? <Globe size={layout === 'grid' ? 28 : 16} /> : <MessageSquareText size={layout === 'grid' ? 28 : 16} />}
          {layout === 'grid' && <span className="badge">{kind}</span>}
        </span>
        <span className="lib-text">
          <span className="lib-title">{item.title}</span>
          {sub && <span className="lib-sub muted small">{sub}</span>}
          {missing && <span className="lib-missing small">File not on this device</span>}
          {hit?.snippet && (
            <span className="lib-snippet small">
              {hit.page ? `p. ${hit.page}: ` : ''}
              {hit.snippet}
            </span>
          )}
          {(item.topics ?? []).length > 0 && (
            <span className="lib-topics">
              {(item.topics ?? []).map((t) => (
                <span key={t} className="chip small">
                  {t.split('/').pop()}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      <div className="lib-actions">
        <button className="icon-btn small" aria-label={`More actions for ${item.title}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <div className="menu inline" role="menu" onMouseLeave={() => setMenu(false)}>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false);
                useLibraryUi.getState().openDialog({ kind: 'edit', itemKind: isBook ? 'book' : 'clipping', id: item.id });
              }}
            >
              <Pencil size={14} /> Edit details and topics
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenu(false);
                useLibraryUi.getState().openDialog({ kind: 'delete', itemKind: isBook ? 'book' : 'clipping', id: item.id });
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
