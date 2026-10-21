/**
 * Screen-space annotations over the canvas, positioned once per frame without re-rendering:
 * day lines with their pinned date labels and day topics (C19, C20, G2), marks for gym with
 * their flags and formalized badges (G3, G6), topic chips on tagged objects (G2), the flash
 * of a revealed region (S6) and gesture hints.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Flag, Tag } from 'lucide-react';
import type { CanvasObject, Mark, Rect } from '../../core/model/types';
import { objectBounds, rectsIntersect, unionRect } from '../../core/canvas/bounds';
import { previewLineY } from '../../core/canvas/daylines';
import { gymTabPath, markStatus } from '../../core/canvas/marks';
import { dayLabel, isoDate } from '../../core/util/time';
import { useApp } from '../app/store';
import { useCanvas, useEmitter, useFrame, useModelVersion } from './context';

// ---------------------------------------------------------------- day lines (C19, C20)

export function DayLines() {
  const { engine, ctl, openTopics } = useCanvas();
  const version = useModelVersion(ctl, (c) => c.days || c.changed.size > 0 || c.removed.size > 0);
  const [today, setToday] = useState(isoDate());
  useEffect(() => {
    const t = setInterval(() => setToday(isoDate()), 60_000);
    return () => clearInterval(t);
  }, []);
  const lines = useMemo(() => {
    const m = ctl.model.dayLines();
    const out = [...m].map(([date, y]) => ({ date, y, preview: false }));
    // C20: on a day with no line yet, today's line shows where new work starts
    if (!m.has(today)) out.push({ date: today, y: previewLineY(ctl.contentBottom()), preview: true });
    return out.sort((a, b) => a.y - b.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, version, today]);
  const refs = useRef(new Map<string, HTMLDivElement>());

  const place = () => {
    const k = engine.pxPerUnit;
    const cam = engine.camera;
    for (const l of lines) {
      const el = refs.current.get(l.date + (l.preview ? ':p' : ''));
      if (!el) continue;
      const top = (l.y - cam.y) * k;
      const on = top > -40 && top < engine.height + 4;
      el.style.display = on ? '' : 'none';
      if (on) el.style.transform = `translateY(${top}px)`;
    }
  };
  useFrame(engine, place);
  useEffect(place);

  return (
    <div className="cv-daylines" aria-label="Days">
      {lines.map((l) => {
        const topics = ctl.model.dayTopics(l.date);
        const key = l.date + (l.preview ? ':p' : '');
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) refs.current.set(key, el);
              else refs.current.delete(key);
            }}
            className={`cv-dayline${l.preview ? ' preview' : ''}`}
            data-date={l.date}
            data-testid={l.preview ? 'dayline-preview' : 'dayline'}
          >
            <div className="cv-dayline-rule" />
            <div className="cv-dayline-label cv-ui">
              <span className="cv-date">{dayLabel(l.date)}</span>
              {topics.map((t) => (
                <span key={t} className="cv-chip cv-topic-chip" title={t}>
                  {shortTopic(t)}
                </span>
              ))}
              <button type="button" className="cv-mini" aria-label={`Tag ${dayLabel(l.date)} with topics`} title="Tag this day with topics" onClick={() => openTopics({ kind: 'day', date: l.date })}>
                <Tag size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function shortTopic(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-1)[0] ?? path;
}

// ---------------------------------------------------------------- marks (G3, G6)

export function MarksLayer({ onOpen }: { onOpen(markId: string): void }) {
  const { engine, ctl, services } = useCanvas();
  const version = useModelVersion(ctl, (c) => c.marks);
  const [, bump] = useState(0);
  useEffect(() => services.formalized.onChange.on(() => bump((x) => x + 1)), [services]);
  const marks = useMemo(() => ctl.model.marks(), [ctl, version]);
  const refs = useRef(new Map<string, HTMLDivElement>());

  const place = () => {
    const k = engine.pxPerUnit;
    const cam = engine.camera;
    const v = engine.view;
    for (const m of marks) {
      const el = refs.current.get(m.id);
      if (!el) continue;
      const on = rectsIntersect(m.region, v);
      el.style.display = on ? '' : 'none';
      if (!on) continue;
      Object.assign(el.style, { transform: `translate(${(m.region.x - cam.x) * k}px, ${(m.region.y - cam.y) * k}px)`, width: `${m.region.w * k}px`, height: `${m.region.h * k}px` });
    }
  };
  useFrame(engine, place);
  useEffect(place);

  return (
    <div className="cv-marks">
      {marks.map((m) => {
        const rec = services.formalized.get(m.id);
        const st = markStatus(rec);
        return (
          <div
            key={m.id}
            ref={(el) => {
              if (el) refs.current.set(m.id, el);
              else refs.current.delete(m.id);
            }}
            className={`cv-mark ${st.state}`}
            data-mark={m.id}
          >
            {st.state === 'formalized' ? (
              <button
                type="button"
                className="cv-flag cv-ui formalized"
                title={`In gym: ${st.path}${st.heading ? '#' + st.heading : ''}`}
                aria-label={`Open in gym: ${st.path}`}
                onClick={() => rec && !rec.dismissed && useApp.getState().openTab({ kind: 'gym', path: gymTabPath(rec) })}
              >
                <BadgeCheck size={14} />
                <span>{kindWord(m)}</span>
              </button>
            ) : (
              <button type="button" className={`cv-flag cv-ui ${st.state}`} title={`${kindWord(m)}${m.topic ? ' · ' + m.topic : ''}`} aria-label={`Mark: ${kindWord(m)}${st.state === 'dismissed' ? ', dismissed' : ''}`} onClick={() => onOpen(m.id)}>
                <Flag size={14} />
                <span>{st.state === 'dismissed' ? 'dismissed' : kindWord(m)}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function kindWord(m: Mark): string {
  return m.kind[0].toUpperCase() + m.kind.slice(1);
}

// ---------------------------------------------------------------- topic chips (G2)

interface ChipCluster {
  key: string;
  topics: string[];
  rect: Rect;
}

/** Tagged objects in view, grouped by their topics and proximity: one chip per cluster. */
export function clusterTagged(objects: CanvasObject[], gap = 48): ChipCluster[] {
  const byTopics = new Map<string, Rect[]>();
  for (const o of objects) {
    if (!o.topics?.length || (o.kind === 'stroke' && o.beautifiedInto)) continue;
    const key = [...o.topics].sort().join('|');
    const list = byTopics.get(key) ?? [];
    list.push(objectBounds(o));
    byTopics.set(key, list);
  }
  const out: ChipCluster[] = [];
  for (const [key, rects] of byTopics) {
    const groups: Rect[] = [];
    for (const r of rects.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const near = groups.find((g) => rectsIntersect({ x: g.x - gap, y: g.y - gap, w: g.w + 2 * gap, h: g.h + 2 * gap }, r));
      if (near) Object.assign(near, unionRect(near, r));
      else groups.push({ ...r });
    }
    groups.forEach((g, i) => out.push({ key: `${key}#${i}`, topics: key.split('|'), rect: g }));
  }
  return out;
}

export function TagChips() {
  const { engine, ctl } = useCanvas();
  const version = useModelVersion(ctl);
  const settledView = useEmitter(engine.settled, null as Rect | null);
  const clusters = useMemo(() => {
    const v = settledView ?? engine.view;
    const objs = ctl.model.query({ x: v.x - v.w / 2, y: v.y - v.h / 2, w: v.w * 2, h: v.h * 2 }).filter((o) => o.topics?.length);
    return clusterTagged(objs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl, version, settledView]);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const place = () => {
    const k = engine.pxPerUnit;
    const cam = engine.camera;
    for (const c of clusters) {
      const el = refs.current.get(c.key);
      if (el) el.style.transform = `translate(${(c.rect.x - cam.x) * k}px, ${(c.rect.y - cam.y) * k - 22}px)`;
    }
  };
  useFrame(engine, place);
  useEffect(place);
  return (
    <div className="cv-tagchips">
      {clusters.map((c) => (
        <div
          key={c.key}
          ref={(el) => {
            if (el) refs.current.set(c.key, el);
            else refs.current.delete(c.key);
          }}
          className="cv-tagchip"
        >
          {c.topics.map((t) => (
            <span key={t} className="cv-chip cv-topic-chip" title={t}>
              <Tag size={11} aria-hidden /> {shortTopic(t)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- flash and hints

export function FlashLayer() {
  const { engine } = useCanvas();
  const [flash, setFlash] = useState<{ r: Rect; n: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let n = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = engine.flash.on((r) => {
      setFlash({ r, n: ++n });
      clearTimeout(t);
      t = setTimeout(() => setFlash(null), 2000);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [engine]);
  const place = () => {
    if (!flash || !el.current) return;
    const k = engine.pxPerUnit;
    const cam = engine.camera;
    Object.assign(el.current.style, { transform: `translate(${(flash.r.x - cam.x) * k - 6}px, ${(flash.r.y - cam.y) * k - 6}px)`, width: `${flash.r.w * k + 12}px`, height: `${flash.r.h * k + 12}px` });
  };
  useFrame(engine, place);
  useEffect(place);
  return flash ? <div key={flash.n} ref={el} className="cv-flash" data-testid="flash" /> : null;
}

export function HintBubble() {
  const { engine } = useCanvas();
  const hint = useEmitter(engine.hint, null);
  return hint ? (
    <div className="cv-hint" role="status">
      {hint}
    </div>
  ) : null;
}
