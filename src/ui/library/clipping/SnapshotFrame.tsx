/**
 * Host of the sandboxed snapshot frame (L8 Original view, L11, S1, S2, S6, S7). The frame page
 * (public/snapshot.html) has its own CSP with no network; it is loaded with
 * `sandbox="allow-scripts"` and never `allow-same-origin`, so the saved page cannot reach the
 * app's storage. Everything goes over postMessage, checked against the frame's window.
 *
 * Offline NFR: the page is given to the frame as `srcdoc`, not by URL. A sandboxed frame without
 * allow-same-origin is never served by the service worker, so loading it by URL fails once the
 * app has restarted offline. The app reads the page through the service worker (precached) and
 * the frame needs no request at all. A srcdoc frame is under the app's CSP as well as its own,
 * so vite.config.ts allows the frame's bootstrap script (by hash) and its blob: resources.
 */
import { useEffect, useRef, useState } from 'react';
import { useStylusNoScroll } from '../viewerParts';
import { LassoOverlay, type LassoResult } from '../../sources/LassoOverlay';
import { decorateMessage, type FrameHighlight, type FrameMark } from './frameMessages';

export type { FrameHighlight, FrameMark };

export interface FrameCapture {
  html: string;
  start: number;
  end: number;
  /** region in document coordinates of the frame */
  rect: { x: number; y: number; w: number; h: number };
  docW: number;
  docH: number;
  image: Blob | null;
  imageSize: { w: number; h: number };
}

export interface FrameController {
  reveal(start: number, end: number): void;
  capture(poly: { x: number; y: number }[], scale: number): Promise<FrameCapture | null>;
  /** the frame's document text (offsets of selections, captures and highlights refer to it) */
  text(): Promise<string>;
}

interface Props {
  html: string;
  /** asset file name (`<hash>.<ext>`) → bytes */
  assets: Record<string, Blob>;
  scripts: boolean;
  fraction?: number;
  highlights: FrameHighlight[];
  marks: FrameMark[];
  lasso: boolean;
  controller: React.MutableRefObject<FrameController | null>;
  onLoaded(): void;
  onLink(href: string): void;
  onSelection(s: { start: number; end: number; text: string; rect: DOMRect } | null): void;
  onHighlightClick(id: string, rect: DOMRect): void;
  onNoteClick(id: string, rect: DOMRect): void;
  onMarkClick(key: string, rect: DOMRect): void;
  onScroll(fraction: number): void;
  onLasso(r: LassoResult): void;
}

let reqId = 1;

let framePage: Promise<string> | null = null;
/** The frame page's HTML, read once (from the service worker's precache when offline). */
export function loadFramePage(): Promise<string> {
  framePage ??= fetch(`${import.meta.env.BASE_URL}snapshot.html`)
    .then((r) => {
      if (!r.ok) throw new Error(`snapshot.html: HTTP ${r.status}`);
      return r.text();
    })
    .catch((err) => {
      framePage = null; // try again next time
      throw err;
    });
  return framePage;
}

export function SnapshotFrame(p: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef(new Map<number, (v: FrameCapture | null) => void>());
  const textWaiters = useRef<((t: string) => void)[]>([]);
  const cb = useRef(p);
  cb.current = p;

  const lassoRef = useRef<HTMLDivElement>(null);
  useStylusNoScroll(lassoRef, p.lasso);
  const send = (m: unknown) => frame.current?.contentWindow?.postMessage(m, '*');
  const toClient = (r: { x: number; y: number; w: number; h: number }) => {
    const b = frame.current!.getBoundingClientRect();
    return new DOMRect(b.left + r.x, b.top + r.y, r.w, r.h);
  };

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data ?? {};
      switch (m.type) {
        case 'ready':
          setReady(true);
          send({ type: 'load', html: cb.current.html, assets: cb.current.assets, scripts: cb.current.scripts, fraction: cb.current.fraction });
          break;
        case 'loaded':
          cb.current.onLoaded();
          break;
        case 'link':
          if (typeof m.href === 'string' && /^https?:/i.test(m.href)) cb.current.onLink(m.href);
          break;
        case 'selection':
          cb.current.onSelection(m.none ? null : { start: m.start, end: m.end, text: String(m.text ?? ''), rect: toClient(m.rect) });
          break;
        case 'highlight-click':
          cb.current.onHighlightClick(String(m.id), toClient(m.rect));
          break;
        case 'note-click':
          cb.current.onNoteClick(String(m.id), toClient(m.rect));
          break;
        case 'mark-click':
          cb.current.onMarkClick(String(m.key), toClient(m.rect));
          break;
        case 'scroll':
          cb.current.onScroll(Number(m.fraction) || 0);
          break;
        case 'captured': {
          const done = pending.current.get(m.id);
          pending.current.delete(m.id);
          done?.(m.start === undefined ? null : (m as FrameCapture));
          break;
        }
        case 'text':
          for (const w of textWaiters.current.splice(0)) w(String(m.text ?? ''));
          break;
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  useEffect(() => {
    let alive = true;
    loadFramePage().then(
      (html) => alive && setPage(html),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  // decorations follow the annotations
  useEffect(() => {
    if (ready) send(decorateMessage(p.highlights, p.marks));
  }, [ready, p.highlights, p.marks]);

  p.controller.current = {
    reveal: (start, end) => send({ type: 'reveal', start, end }),
    capture: (poly, scale) =>
      new Promise((resolve) => {
        const b = frame.current?.getBoundingClientRect();
        if (!b) return resolve(null);
        const id = reqId++;
        pending.current.set(id, resolve);
        send({ type: 'capture', id, scale, poly: poly.map((q) => [q.x - b.left, q.y - b.top]) });
        setTimeout(() => {
          if (pending.current.delete(id)) resolve(null);
        }, 15_000);
      }),
    text: () =>
      new Promise((resolve) => {
        textWaiters.current.push(resolve);
        send({ type: 'text' });
      }),
  };

  return (
    <div className="snapshot-host">
      {failed && <p className="empty">The Original view could not be opened. Reload Slate while online once to make it available offline.</p>}
      <iframe
        ref={frame}
        className="snapshot-frame"
        srcDoc={page ?? undefined}
        hidden={!page}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title="Saved page (Original view)"
        data-testid="snapshot-frame"
      />
      {p.lasso && (
        <div
          ref={lassoRef}
          className="snapshot-lasso"
          onWheel={(e) => send({ type: 'scrollBy', dy: e.deltaY, dx: e.deltaX })}
        >
          <LassoOverlay mode="free" onLasso={p.onLasso} label="Lasso: draw around content to capture it" />
        </div>
      )}
    </div>
  );
}
