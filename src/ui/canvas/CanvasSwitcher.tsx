/**
 * Canvas switcher in the top bar (P1): lists the canvases, switches the main canvas, opens one
 * in the side pane, creates and renames canvases. A canvas's slug is its folder name under
 * journal/ and never changes; renaming changes its title.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, PanelRight, Plus, Pencil } from 'lucide-react';
import { useServices } from '../../app/services';
import { slugify } from '../../core/util/ids';
import { useApp } from '../app/store';
import { toast } from '../common/toast';
import { Popup } from '../common/focus';

/** slug → title, for side-pane tab titles. */
export const canvasTitles = new Map<string, string>();

export function CanvasSwitcher() {
  const services = useServices();
  const current = useApp((s) => s.canvas);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'new' | 'rename'>('list');
  const [title, setTitle] = useState('');
  const [, bump] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const list = services.canvases.list();
  for (const m of list) canvasTitles.set(m.slug, m.title);

  useEffect(() => services.canvases.onChange.on(() => bump((x) => x + 1)), [services]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const meta = services.canvases.meta(current);
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    let slug = slugify(t, 40);
    for (let i = 2; services.canvases.meta(slug); i++) slug = `${slugify(t, 36)}-${i}`;
    await services.canvases.create(t, slug);
    useApp.getState().setCanvas(slug);
    setOpen(false);
    toast(`Created canvas “${t}”`);
  };
  const rename = async () => {
    const t = title.trim();
    if (!t || !meta) return;
    await services.canvases.update(meta.slug, { title: t });
    setOpen(false);
  };

  return (
    <div ref={ref} className="cv-switcher">
      <button
        type="button"
        className="btn cv-switch-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Canvas: ${meta?.title ?? current}. Switch canvas`}
        onClick={() => {
          setOpen(!open);
          setMode('list');
        }}
      >
        <span className="cv-switch-title">{meta?.title ?? current}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <Popup className="menu cv-switch-menu" role="menu" label="Canvases" onClose={() => setOpen(false)}>
          {mode === 'list' && (
            <>
              {list.map((m) => (
                <div key={m.slug} className="cv-switch-row">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={m.slug === current}
                    onClick={() => {
                      useApp.getState().setCanvas(m.slug);
                      setOpen(false);
                    }}
                  >
                    <span style={{ width: 16 }}>{m.slug === current && <Check size={14} />}</span>
                    {m.title}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Open ${m.title} in the side pane`}
                    title="Open in the side pane"
                    onClick={() => {
                      useApp.getState().openTab({ kind: 'canvas', slug: m.slug });
                      setOpen(false);
                    }}
                  >
                    <PanelRight size={16} />
                  </button>
                </div>
              ))}
              <hr />
              <button type="button" role="menuitem" onClick={() => (setMode('new'), setTitle(''))}>
                <Plus size={16} /> New canvas…
              </button>
              <button type="button" role="menuitem" onClick={() => (setMode('rename'), setTitle(meta?.title ?? ''))}>
                <Pencil size={16} /> Rename “{meta?.title ?? current}”…
              </button>
            </>
          )}
          {mode !== 'list' && (
            <form
              className="cv-switch-form"
              onSubmit={(e) => {
                e.preventDefault();
                void (mode === 'new' ? create() : rename());
              }}
            >
              <label className="field">
                <span>{mode === 'new' ? 'Title of the new canvas' : 'New title'}</span>
                <input type="text" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              {mode === 'new' && title.trim() && <p className="cv-muted">Folder: journal/{slugify(title, 40)}</p>}
              <div className="actions">
                <button type="button" className="btn" onClick={() => setMode('list')}>
                  Back
                </button>
                <button type="submit" className="btn primary" disabled={!title.trim()}>
                  {mode === 'new' ? 'Create' : 'Rename'}
                </button>
              </div>
            </form>
          )}
        </Popup>
      )}
    </div>
  );
}
