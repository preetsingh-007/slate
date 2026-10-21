/**
 * The gym reader (G7): a side-pane tab `{ kind: 'gym', path }`. `path` is '' for the tree and
 * search, a folder (its README plus its contents), or a file, optionally with `#heading`.
 * Read-only; lassoable with gym-file source links (S1, S2, S5).
 */
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ChevronRight, Dumbbell, Folder, FileText, Lasso, Search, SquareDashed, History } from 'lucide-react';
import type { Capture } from '../../core/model/capture';
import type { PaneTab } from '../../core/model/types';
import { basename, dirname, isMarkdown, joinPath, splitAnchor } from '../../core/gym/paths';
import type { GymStructure, GymUnit } from '../../core/gym/structure';
import type { SearchHit } from '../../core/gym/search';
import { LassoOverlay, type LassoMode, type LassoResult } from '../sources/LassoOverlay';
import type { PaneProps } from '../panes/registry';
import { toast } from '../common/toast';
import { CapturePreview } from './CapturePreview';
import { GymDocument, StatusChip, type DocApi } from './GymDocument';
import { clearReveal, openGym, openPane, useGymReveal } from './open';
import { useAsync, useGym } from './useGym';

type GymTab = Extract<PaneTab, { kind: 'gym' }>;

/** Short tab title: "Gym", a folder name, or "folder/file". */
export function gymTabTitle(tab: GymTab): string {
  const { path } = splitAnchor(tab.path);
  if (!path) return 'Gym';
  const name = basename(path).replace(/\.md$/i, '');
  if (name === 'README') return basename(dirname(path)) || 'Gym';
  // folders (no extension) are named by themselves
  if (!basename(path).includes('.')) return name;
  const parent = basename(dirname(path));
  return parent ? `${parent}/${name}` : name;
}

export function GymPane({ tab, active }: PaneProps<GymTab>) {
  const idx = useGym();
  const { path, anchor } = splitAnchor(tab.path);
  const isFile = path !== '' && idx.isFile(path);
  const isDir = !isFile && idx.isDir(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docApi = useRef<DocApi | null>(null);
  const [lasso, setLasso] = useState<LassoMode | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const req = useGymReveal((s) => s.req);
  const docPath = isFile ? path : isDir && idx.isFile(joinPath(path, 'README.md')) ? joinPath(path, 'README.md') : null;
  const lassoable = !!docPath && isMarkdown(docPath);

  // a source link to a file that is not in the mirror (deleted in gym, or not synced yet)
  useEffect(() => {
    if (!active || !req || req.path !== path || isFile) return;
    clearReveal(req.nonce);
    toast(idx.files.list().length ? `${path} is no longer in gym.` : 'Gym files are not on this device yet; they download with the next sync.');
  }, [active, req, path, isFile, idx]);

  useEffect(() => {
    if (!lassoable) setLasso(null);
  }, [lassoable]);

  const onLasso = async (r: LassoResult) => {
    if (!docApi.current || busy) return;
    setBusy(true);
    try {
      const c = await docApi.current.capture(r);
      if (c) setCaptures((list) => [...list, c]);
      else toast('Nothing to capture there.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gym-reader">
      <header className="gym-head">
        <Breadcrumbs path={path} />
        <span className="gym-spacer" />
        {path !== '' && (
          <button className="icon-btn" aria-label="Search gym" title="Search gym" onClick={() => openGym('')}>
            <Search size={16} />
          </button>
        )}
        {lassoable && (
          <>
            <button className="icon-btn" aria-label="Lasso" title="Lasso (free-form)" aria-pressed={lasso === 'free'} onClick={() => setLasso(lasso === 'free' ? null : 'free')}>
              <Lasso size={16} />
            </button>
            <button className="icon-btn" aria-label="Rectangle lasso" title="Rectangle lasso" aria-pressed={lasso === 'rect'} onClick={() => setLasso(lasso === 'rect' ? null : 'rect')}>
              <SquareDashed size={16} />
            </button>
          </>
        )}
      </header>
      <div ref={scrollRef} className={`gym-scroll${lasso ? ' lassoing' : ''}`}>
        {lasso && <LassoHost scroller={scrollRef} mode={lasso} onLasso={onLasso} />}
        <div className="gym-page">
          {path === '' ? (
            <GymHome active={active} />
          ) : isFile ? (
            <GymDocument path={path} anchor={anchor} anchorKey={tab} active={active} api={docApi} />
          ) : isDir ? (
            <GymFolder dir={path} anchor={anchor} anchorKey={tab} active={active} api={docApi} />
          ) : (
            <NotInGym path={path} />
          )}
        </div>
      </div>
      {captures.length > 0 && <CapturePreview captures={captures} onChange={setCaptures} />}
    </div>
  );
}

/** The lasso, pinned over the visible part of the scroller (it scrolls with wheel and trackpad). */
function LassoHost({ scroller, mode, onLasso }: { scroller: React.RefObject<HTMLDivElement | null>; mode: LassoMode; onLasso(r: LassoResult): void }) {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [scroller]);
  return (
    <div className="gym-lasso-host">
      <div className="gym-lasso-box" style={{ height: h }}>
        <LassoOverlay mode={mode} onLasso={onLasso} label="Lasso over the gym file" />
      </div>
    </div>
  );
}

function Breadcrumbs({ path }: { path: string }) {
  const parts = path ? path.split('/') : [];
  return (
    <nav className="gym-crumbs" aria-label="Gym path">
      <button className="gym-crumb" onClick={() => openGym('')}>
        <Dumbbell size={14} aria-hidden /> Gym
      </button>
      {parts.map((p, i) => (
        <span key={i} className="gym-crumb-part">
          <ChevronRight size={12} aria-hidden />
          {i === parts.length - 1 ? (
            <span className="gym-crumb current" aria-current="page">
              {p}
            </span>
          ) : (
            <button className="gym-crumb" onClick={() => openGym(parts.slice(0, i + 1).join('/'))}>
              {p}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function NotInGym({ path }: { path: string }) {
  const idx = useGym();
  const empty = idx.files.list().length === 0;
  return (
    <div className="gym-note">
      {empty ? (
        <p>Gym's files are not on this device yet. They download with the first sync, then stay available offline.</p>
      ) : (
        <p>
          <code>{path}</code> is not in gym.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- folder view

const unitTitle = (s: GymStructure | undefined, path: string) => s?.units.find((u) => u.path === path);

function GymFolder({ dir, anchor, anchorKey, active, api }: { dir: string; anchor: string; anchorKey: unknown; active: boolean; api: React.MutableRefObject<DocApi | null> }) {
  const idx = useGym();
  const { value: structure } = useAsync(() => idx.structure(), [idx, idx.revision]);
  const readme = joinPath(dir, 'README.md');
  const hasReadme = idx.isFile(readme);
  const listing = idx.list(dir);
  const problems = new Map(structure?.problems.map((p) => [p.path, p]));
  const files = listing.files.filter((f) => f !== readme);
  return (
    <>
      {hasReadme ? <GymDocument path={readme} anchor={anchor} anchorKey={anchorKey} active={active} api={api} /> : <h1 className="gym-title">{basename(dir)}</h1>}
      {(listing.dirs.length > 0 || files.length > 0) && (
        <section className="gym-listing" aria-label="Contents">
          <h2>Contents</h2>
          <ul>
            {listing.dirs.map((d) => {
              const u = unitTitle(structure, d);
              return (
                <li key={d}>
                  <button className="gym-entry" onClick={() => openGym(d)}>
                    <Folder size={16} aria-hidden />
                    <span className="gym-entry-title">{u && u.title !== u.name ? `${u.title}` : `${basename(d)}/`}</span>
                    {u && u.title !== u.name && <span className="gym-muted">{basename(d)}/</span>}
                    {u && <StatusChip status={u.status} />}
                  </button>
                </li>
              );
            })}
            {files.map((f) => {
              const p = problems.get(f);
              return (
                <li key={f}>
                  <button className="gym-entry" onClick={() => openGym(f)}>
                    <FileText size={16} aria-hidden />
                    <span className="gym-entry-title">{p ? `${p.number} · ${p.title}` : basename(f)}</span>
                    {p && <StatusChip status={p.status} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- tree and search

function GymHome({ active }: { active: boolean }) {
  const idx = useGym();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const inputRef = useRef<HTMLInputElement>(null);
  const { value: structure, loading } = useAsync(() => idx.structure(), [idx, idx.revision]);
  const { value: hits } = useAsync<SearchHit[]>(() => (query.trim() ? idx.search(query) : Promise.resolve([])), [idx, idx.revision, query]);

  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [active]);

  const empty = idx.files.list().length === 0;
  return (
    <div className="gym-home">
      <div className="gym-search">
        <Search size={16} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search gym"
          aria-label="Search gym"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              (document.querySelector('.gym-results .gym-entry') as HTMLElement | null)?.focus();
            }
          }}
        />
      </div>
      {empty ? (
        <p className="gym-note">Gym's files are not on this device yet. They download with the first sync, then stay available offline.</p>
      ) : query.trim() ? (
        <SearchResults hits={hits ?? []} />
      ) : (
        <>
          <div className="gym-shortcuts">
            <button className="btn" onClick={() => openPane({ kind: 'revision' })}>
              <History size={14} aria-hidden /> Revision list
            </button>
            {idx.isDir('log') && (
              <button className="btn" onClick={() => openGym('log')}>
                Study log
              </button>
            )}
          </div>
          {loading && !structure ? <p className="gym-muted">Reading gym…</p> : structure && <Tree structure={structure} />}
        </>
      )}
    </div>
  );
}

function SearchResults({ hits }: { hits: SearchHit[] }) {
  if (!hits.length) return <p className="gym-note">No matches.</p>;
  return (
    <ul className="gym-results" aria-label="Search results">
      {hits.map((h) => (
        <li key={h.path}>
          <button
            className="gym-entry gym-hit"
            onClick={() => openGym(h.path + (h.anchor ? `#${h.anchor}` : ''))}
            onKeyDown={(e) => {
              const li = (e.currentTarget as HTMLElement).closest('li');
              if (e.key === 'ArrowDown') (li?.nextElementSibling?.querySelector('button') as HTMLElement | null)?.focus();
              else if (e.key === 'ArrowUp') ((li?.previousElementSibling?.querySelector('button') as HTMLElement | null) ?? (document.querySelector('.gym-search input') as HTMLElement | null))?.focus();
              else return;
              e.preventDefault();
            }}
          >
            <span className="gym-entry-title">{h.title}</span>
            <span className="gym-muted gym-path">{h.path}</span>
            {h.snippet && <Snippet text={h.snippet} marks={h.marks} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Snippet({ text, marks }: { text: string; marks: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  parts.push(text.slice(at));
  return <span className="gym-snippet">{parts}</span>;
}

function Tree({ structure }: { structure: GymStructure }) {
  if (!structure.domains.length) return <p className="gym-note">Gym has no domains yet.</p>;
  return (
    <div className="gym-tree">
      {structure.domains.map((d) => (
        <section key={d.path} aria-labelledby={`gym-d-${d.name}`}>
          <h2 id={`gym-d-${d.name}`}>
            <button className="gym-link" onClick={() => openGym(d.path)}>
              {d.title}
            </button>
          </h2>
          {d.subjects.length === 0 && <p className="gym-muted">No subjects yet.</p>}
          {d.subjects.map((s) => (
            <details key={s.path} open>
              <summary>
                <button className="gym-link" onClick={() => openGym(s.path)}>
                  {s.title}
                </button>
              </summary>
              <ul>
                {s.topics.map((t) => (
                  <TopicRow key={t.path} unit={t} />
                ))}
              </ul>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

function TopicRow({ unit }: { unit: GymUnit }) {
  return (
    <li>
      <button className="gym-entry" onClick={() => openGym(unit.path)}>
        <span className="gym-entry-title">{unit.title}</span>
        <StatusChip status={unit.status} />
      </button>
      {unit.variants.length > 0 && (
        <ul>
          {unit.variants.map((v) => (
            <TopicRow key={v.path} unit={v} />
          ))}
        </ul>
      )}
    </li>
  );
}
