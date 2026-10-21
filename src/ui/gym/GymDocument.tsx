/**
 * One rendered gym file in the reader (G7): Markdown with maths, relative images and links,
 * anchors; plain text and images for other files. Exposes a capture function for the lasso
 * (S2) and answers reveal requests from source links (S6).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Notebook } from 'lucide-react';
import type { Capture } from '../../core/model/capture';
import { findGymQuote } from '../../core/gym/locator';
import { basename, isImage, isMarkdown, mimeOf, resolveLink } from '../../core/gym/paths';
import { firstHeading } from '../../core/gym/frontmatter';
import type { LassoResult } from '../sources/LassoOverlay';
import { toast } from '../common/toast';
import { annotate, loadImages, renderGymDoc, renderPlain } from './docRender';
import { clearReveal, openGym, useGymReveal } from './open';
import { captureRegion, flashRects, rangeRects } from './regionCapture';
import { useAsync, useGym } from './useGym';
import { useServices } from '../../app/services';
import { gymPositionId, readingPosition, saveReadingPosition } from '../../core/library/positions';

export interface DocApi {
  capture(lasso: LassoResult): Promise<Capture | null>;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scrolls `scroller` so `rect` sits a little below its top. */
export function scrollToRect(scroller: HTMLElement, rect: DOMRect, fraction = 0.2) {
  const box = scroller.getBoundingClientRect();
  const top = scroller.scrollTop + rect.top - box.top - Math.max(8, scroller.clientHeight * fraction);
  scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
}

export function GymDocument({
  path,
  anchor,
  anchorKey,
  active,
  api,
}: {
  path: string;
  anchor: string;
  /** changes whenever the tab is (re)opened, so the same anchor scrolls again */
  anchorKey: unknown;
  active: boolean;
  api?: MutableRefObject<DocApi | null>;
}) {
  const idx = useGym();
  const { value: text, loading } = useAsync(() => idx.readText(path), [idx, idx.revision, path]);
  const md = isMarkdown(path);
  const doc = useMemo(() => (text != null && md ? renderGymDoc(text) : null), [text, md]);
  const articleRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(0);
  const req = useGymReveal((s) => s.req);

  useLayoutEffect(() => {
    const a = articleRef.current;
    if (!a || text == null) return;
    if (!doc) {
      a.innerHTML = renderPlain(text);
      setReady((n) => n + 1);
      return;
    }
    a.innerHTML = doc.html;
    annotate(a, doc.layout);
    const images = loadImages(a, path, (p) => idx.readBlob(p));
    let live = true;
    // positions are final once images have their size (bounded wait, offline reads are quick)
    void Promise.race([images.done, new Promise((r) => setTimeout(r, 1500))]).then(() => live && setReady((n) => n + 1));
    return () => {
      live = false;
      images.cleanup();
    };
  }, [doc, text, path, idx]);

  const title = useMemo(() => {
    if (!text) return basename(path);
    return doc?.fields?.title || firstHeading(text.slice(doc?.bodyStart ?? 0)) || basename(path);
  }, [text, doc, path]);

  // the lasso's capture function (S2)
  useEffect(() => {
    if (!api) return;
    api.current = {
      capture: async (lasso) => {
        const a = articleRef.current;
        if (!a || !doc || text == null) return null;
        return captureRegion(a, { path, title, sha: idx.entry(path)?.sha ?? '', commit: idx.commit(), text, layout: doc.layout }, lasso);
      },
    };
    return () => {
      if (api.current) api.current = null;
    };
  }, [api, doc, text, path, title, idx]);

  // P3: the place in a file is kept (and synced) like a book's, and restored when it is shown
  // again; a heading or a source link being opened wins. Declared before the effects that
  // consume those requests.
  const services = useServices();
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    const a = articleRef.current;
    const scroller = a?.closest<HTMLElement>('.gym-scroll');
    if (!ready || !active || !a || !scroller || restoredFor.current === path) return;
    restoredFor.current = path;
    if (anchor || useGymReveal.getState().req?.path === path) return;
    const pos = readingPosition(services.settings, gymPositionId(path))?.locator;
    if (pos?.type === 'scroll') scroller.scrollTop = pos.fraction * (scroller.scrollHeight - scroller.clientHeight);
  }, [ready, active, path, anchor, services]);
  useEffect(() => {
    const scroller = articleRef.current?.closest<HTMLElement>('.gym-scroll');
    if (!scroller || !ready) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (scroller.clientWidth === 0) return; // a hidden tab resets its scroll: not a position
      clearTimeout(t);
      t = setTimeout(() => {
        const max = scroller.scrollHeight - scroller.clientHeight;
        const fraction = max > 0 ? Math.round((scroller.scrollTop / max) * 1000) / 1000 : 0;
        void saveReadingPosition(services.settings, gymPositionId(path), { type: 'scroll', fraction }, services.device);
      }, 800);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [ready, path, services]);

  // `path#heading` (G6 badges, links): scroll to the heading
  useEffect(() => {
    const a = articleRef.current;
    if (!ready || !active || !a || !anchor) return;
    const el = a.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`) ?? a.querySelector<HTMLElement>(`#${CSS.escape(anchor.toLowerCase())}`);
    const scroller = a.closest<HTMLElement>('.gym-scroll');
    if (!el || !scroller) return;
    const r = el.getBoundingClientRect();
    scrollToRect(scroller, r, 0);
    flashRects(a, [r], 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, active, anchor, anchorKey]);

  // source links (S6): find the quote, scroll to it and flash it for 2 seconds
  useEffect(() => {
    const a = articleRef.current;
    if (!ready || !active || !a || !req || req.path !== path || text == null) return;
    clearReveal(req.nonce);
    const m = findGymQuote(text, req.locator);
    if (!m) {
      toast('The clipped text is no longer in this file.');
      return;
    }
    if (!m.exact) toast('The file changed since the clip was made; showing the closest match.');
    const rects = rangeRects(a, text, m.start, m.end).filter((r) => r.width || r.height);
    const scroller = a.closest<HTMLElement>('.gym-scroll');
    if (rects.length && scroller) {
      scrollToRect(scroller, rects[0]);
      flashRects(a, rects, 2000);
    }
  }, [ready, active, req, path, text]);

  const onClick = (e: React.MouseEvent) => {
    const link = (e.target as Element).closest('a');
    if (!link) return;
    const rel = link.getAttribute('data-rel');
    const anchorOnly = link.getAttribute('data-anchor');
    if (rel !== null) {
      e.preventDefault();
      const target = resolveLink(path, rel);
      if (target) openGym(target.path + (target.anchor ? `#${target.anchor}` : ''));
    } else if (anchorOnly !== null) {
      e.preventDefault();
      const el = articleRef.current?.querySelector<HTMLElement>(`#${CSS.escape(anchorOnly)}`);
      const scroller = articleRef.current?.closest<HTMLElement>('.gym-scroll');
      if (el && scroller) {
        scrollToRect(scroller, el.getBoundingClientRect(), 0);
        flashRects(articleRef.current!, [el.getBoundingClientRect()], 1200);
      }
    }
  };

  if (text == null && !loading) {
    return <p className="gym-note">{basename(path)} is not available on this device yet; it downloads with the next sync.</p>;
  }
  if (isImage(path)) return <GymImage path={path} />;
  return (
    <>
      {doc?.fields && <FrontMatter fields={doc.fields} path={path} />}
      {/* rendered content is set imperatively (block-tagged HTML); React does not manage its children */}
      <div ref={articleRef} className="gym-md" data-path={path} onClick={onClick} aria-busy={loading} />
    </>
  );
}

function GymImage({ path }: { path: string }) {
  const idx = useGym();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    void idx.readBlob(path).then((b) => {
      if (!b || !live) return;
      u = URL.createObjectURL(b.type ? b : new Blob([b], { type: mimeOf(path) }));
      setUrl(u);
    });
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [idx, path]);
  return <div className="gym-md">{url && <img src={url} alt={basename(path)} />}</div>;
}

const PROBLEM = /\/problems\/\d{3}-[^/]+\.md$/;

/** Front matter, shown tastefully: status chips for topics and problems, a folded panel otherwise. */
function FrontMatter({ fields, path }: { fields: Record<string, string>; path: string }) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  if (fields['marimo-version'] !== undefined) {
    return (
      <details className="gym-fm">
        <summary>
          <Notebook size={14} aria-hidden /> marimo notebook{fields.title ? ` · ${fields.title}` : ''}
        </summary>
        <dl>
          {keys.map((k) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{fields[k] || '—'}</dd>
            </div>
          ))}
        </dl>
        <p className="gym-muted">Code cells are shown as code. The file stores no outputs; run it with marimo to see them.</p>
      </details>
    );
  }
  if (PROBLEM.test(path) || fields.status) {
    const extra = PROBLEM.test(path)
      ? [fields.difficulty && ['Difficulty', fields.difficulty], fields.date && ['Last attempt', fields.date]]
      : [fields.started && ['Started', fields.started], fields.completed && ['Completed', fields.completed]];
    return (
      <div className="gym-fm-chips">
        {fields.status && <StatusChip status={fields.status} />}
        {extra.filter(Boolean).map((x) => {
          const [k, v] = x as string[];
          return (
            <span key={k} className="gym-chip">
              {k}: {v}
            </span>
          );
        })}
        {fields.source && <span className="gym-source">Source: {fields.source}</span>}
      </div>
    );
  }
  return (
    <details className="gym-fm">
      <summary>Front matter</summary>
      <dl>
        {keys.map((k) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{fields[k] || '—'}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function StatusChip({ status }: { status: string }) {
  if (!status) return null;
  return <span className={`gym-status gym-status-${status}`}>{status}</span>;
}
