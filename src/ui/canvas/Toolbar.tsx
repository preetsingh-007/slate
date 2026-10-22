/**
 * The canvas toolbar (C11): pen, highlighter, eraser, lasso, text, space, hand, insert image;
 * undo and redo; pen colours (8 plus custom, synced in settings.colors), sizes (3 plus
 * custom) and presets (C6); eraser and lasso modes (C12, C14); view commands (C2, C5, C21);
 * device settings (C13) and the keyboard shortcuts (help).
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  BookmarkPlus,
  Calendar,
  Camera,
  CircleHelp,
  Eraser,
  Hand,
  Highlighter,
  ImagePlus,
  Images,
  Lasso,
  Map as MapIcon,
  PenLine,
  Plus,
  Redo2,
  Settings,
  SquareDashed,
  Tag,
  Type,
  Undo2,
  UnfoldVertical,
} from 'lucide-react';
import { CURRENT_INK } from '../../core/ink/render';
import { lineForDate, sortedLines } from '../../core/canvas/daylines';
import { dayLabel, isoDate } from '../../core/util/time';
import type { DevicePrefs } from '../../core/stores/settings';
import { useCanvas, useModelVersion } from './context';
import { insertImages, pasteFromClipboard } from './actions';
import { COLOR_NAMES, HIGHLIGHTER_COLORS, HIGHLIGHTER_SIZES, PEN_COLORS, PEN_SIZES, useTools, type Tool } from './toolStore';

const TOOLS: { id: Tool; label: string; key: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'pen', label: 'Pen', key: 'P', Icon: PenLine },
  { id: 'highlighter', label: 'Highlighter', key: 'M', Icon: Highlighter },
  { id: 'eraser', label: 'Eraser', key: 'E', Icon: Eraser },
  { id: 'lasso', label: 'Lasso', key: 'L', Icon: Lasso },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'space', label: 'Insert space', key: 'S', Icon: UnfoldVertical },
  { id: 'hand', label: 'Hand', key: 'H', Icon: Hand },
];

export const SHORTCUTS: [string, string][] = [
  ['P / M / E / L / T / S / H', 'Pen, highlighter (marker), eraser, lasso, text, space, hand'],
  ['Shift+E', 'Eraser: whole strokes ↔ partial'],
  ['Shift+L', 'Lasso: free-form ↔ rectangle'],
  ['Space (hold)', 'Hand tool while held'],
  ['⌘Z / ⇧⌘Z (Ctrl+Y)', 'Undo / redo'],
  ['⌘C / ⌘X / ⌘V', 'Copy, cut, paste'],
  ['⌘D', 'Duplicate'],
  ['⌫ / Delete', 'Delete the selection'],
  ['⌘G / ⇧⌘G', 'Group / ungroup'],
  ['] / [', 'Bring forward / send back'],
  ['⌘A', 'Select everything in view'],
  ['⌥→ / ⌥←', 'Select the next / previous object in view'],
  ['Arrows', 'Nudge the selection (Shift: 10×), or pan'],
  ['⌘= / ⌘− / ⌘0', 'Zoom in / out / 100%'],
  ['⇧1 / ⇧2', 'Fit all / fit selection'],
  ['Home', 'Jump to now'],
  ['Enter', 'Edit the selected text box'],
  ['Click, then type', 'A text box where you clicked'],
  ['Esc', 'Clear the selection or stop editing'],
  ['?', 'This help'],
];

type Pop = 'image' | 'zoom' | 'date' | 'settings' | 'help' | 'size' | null;

export function Toolbar({ minimap, setMinimap, helpSignal = 0 }: { minimap: boolean; setMinimap(v: boolean): void; helpSignal?: number }) {
  const c = useCanvas();
  const { ctl, engine, services, actions } = c;
  const tool = useTools((s) => s.tool);
  const tools = useTools();
  const [pop, setPop] = useState<Pop>(null);
  const [, bump] = useState(0);
  useModelVersion(ctl);
  useEffect(() => services.settings.onChange.on(() => bump((x) => x + 1)), [services]);
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const zoom = Math.round(engine.camera.zoom * 100);
  const [, setZ] = useState(0);
  useEffect(() => engine.settled.on(() => setZ((x) => x + 1)), [engine]);

  useEffect(() => {
    if (helpSignal) setPop((p) => (p === 'help' ? null : 'help'));
  }, [helpSignal]);
  const toggle = (p: Pop) => setPop(pop === p ? null : p);
  const isHl = tool === 'highlighter';
  const style = isHl ? tools.highlighter : tools.pen;
  const setStyle = isHl ? tools.setHighlighter : tools.setPen;
  const settings = services.settings.get();
  const palette = [...(isHl ? HIGHLIGHTER_COLORS : PEN_COLORS), ...settings.colors];
  const sizes = isHl ? HIGHLIGHTER_SIZES : PEN_SIZES;
  const presets = isHl ? settings.highlighters : settings.pens;

  const onFiles = (list: FileList | null) => {
    setPop(null);
    if (list?.length) void insertImages(actions, [...list], null);
  };

  return (
    <div className="cv-toolbar cv-ui" role="toolbar" aria-label={c.embedded ? `Canvas tools, ${services.canvases.meta(c.slug)?.title ?? c.slug}` : 'Canvas tools'} onKeyDown={(e) => e.key === 'Escape' && setPop(null)}>
      <div className="cv-group" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="cv-btn"
            role="radio"
            aria-checked={tool === t.id}
            aria-label={`${t.label} (${t.key})`}
            title={`${t.label} (${t.key})`}
            data-tool={t.id}
            onClick={() => {
              if (tool === t.id && t.id === 'eraser') tools.setEraserMode(tools.eraserMode === 'stroke' ? 'partial' : 'stroke');
              else if (tool === t.id && t.id === 'lasso') tools.setLassoMode(tools.lassoMode === 'free' ? 'rect' : 'free');
              tools.setTool(t.id);
            }}
          >
            <t.Icon size={20} />
          </button>
        ))}
        <button type="button" className="cv-btn" aria-label="Insert image" title="Insert image" aria-haspopup="menu" aria-expanded={pop === 'image'} onClick={() => toggle('image')}>
          <ImagePlus size={20} />
        </button>
      </div>
      <span className="cv-sep" />
      <button type="button" className="cv-btn" aria-label="Undo (⌘Z)" title="Undo (⌘Z)" disabled={!ctl.model.canUndo()} onClick={() => ctl.model.undo()}>
        <Undo2 size={20} />
      </button>
      <button type="button" className="cv-btn" aria-label="Redo (⇧⌘Z)" title="Redo (⇧⌘Z)" disabled={!ctl.model.canRedo()} onClick={() => ctl.model.redo()}>
        <Redo2 size={20} />
      </button>
      <span className="cv-sep" />
      <div className="cv-style" aria-label="Tool options">
        {(tool === 'pen' || tool === 'highlighter') && (
          <>
            {presets.slice(0, 4).map((p, i) => (
              <button
                key={i}
                type="button"
                className={`cv-preset${p.color === style.color && p.size === style.size ? ' on' : ''}`}
                aria-label={`Preset: ${COLOR_NAMES[p.color] ?? p.color}, size ${p.size}`}
                title="Preset"
                onClick={() => setStyle({ color: p.color, size: p.size })}
              >
                <span style={{ background: p.color === CURRENT_INK ? 'var(--ink-default)' : p.color, width: Math.min(18, 4 + p.size * (isHl ? 0.6 : 2)), height: Math.min(18, 4 + p.size * (isHl ? 0.6 : 2)) }} />
              </button>
            ))}
            <span className="cv-sep thin" />
            {palette.map((col) => (
              <button
                key={col}
                type="button"
                className={`cv-swatch${style.color === col ? ' on' : ''}`}
                aria-label={COLOR_NAMES[col] ?? `Custom ${col}`}
                aria-pressed={style.color === col}
                title={COLOR_NAMES[col] ?? col}
                style={{ ['--swatch' as string]: col === CURRENT_INK ? 'var(--ink-default)' : col }}
                onClick={() => setStyle({ color: col })}
              />
            ))}
            <label className="cv-swatch cv-add-color" title="Add a custom colour" aria-label="Add a custom colour">
              <Plus size={14} />
              <input
                type="color"
                className="visually-hidden"
                onChange={(e) => {
                  const col = e.target.value.toLowerCase();
                  setStyle({ color: col });
                  if (!settings.colors.includes(col) && !PEN_COLORS.includes(col) && !HIGHLIGHTER_COLORS.includes(col)) void services.settings.update({ colors: [...settings.colors, col].slice(-12) });
                }}
              />
            </label>
            <span className="cv-sep thin" />
            {sizes.map((s, i) => (
              <button key={s} type="button" className={`cv-size${style.size === s ? ' on' : ''}`} aria-label={`Size ${['small', 'medium', 'large'][i]}`} aria-pressed={style.size === s} onClick={() => setStyle({ size: s })}>
                <span style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
              </button>
            ))}
            <button type="button" className={`cv-size${!sizes.includes(style.size) ? ' on' : ''}`} aria-label="Custom size" title="Custom size" aria-expanded={pop === 'size'} onClick={() => toggle('size')}>
              <span className="cv-size-num">{style.size}</span>
            </button>
            <button
              type="button"
              className="cv-size"
              aria-label="Save the colour and size as a preset"
              title="Save as a preset"
              onClick={() => {
                const list = isHl ? settings.highlighters : settings.pens;
                const next = [{ tool: isHl ? ('highlighter' as const) : ('pen' as const), color: style.color, size: style.size }, ...list.filter((p) => p.color !== style.color || p.size !== style.size)].slice(0, 4);
                void services.settings.update(isHl ? { highlighters: next } : { pens: next });
              }}
            >
              <BookmarkPlus size={16} />
            </button>
          </>
        )}
        {tool === 'eraser' && (
          <div className="cv-seg" role="radiogroup" aria-label="Eraser mode">
            <button type="button" role="radio" aria-checked={tools.eraserMode === 'stroke'} onClick={() => tools.setEraserMode('stroke')}>
              Whole strokes
            </button>
            <button type="button" role="radio" aria-checked={tools.eraserMode === 'partial'} onClick={() => tools.setEraserMode('partial')}>
              Partial
            </button>
          </div>
        )}
        {tool === 'lasso' && (
          <div className="cv-seg" role="radiogroup" aria-label="Lasso mode">
            <button type="button" role="radio" aria-checked={tools.lassoMode === 'free'} onClick={() => tools.setLassoMode('free')}>
              <Lasso size={14} /> Free-form
            </button>
            <button type="button" role="radio" aria-checked={tools.lassoMode === 'rect'} onClick={() => tools.setLassoMode('rect')}>
              <SquareDashed size={14} /> Rectangle
            </button>
          </div>
        )}
        {tool === 'space' && <span className="cv-muted">Drag to insert space, drag back to remove it.</span>}
      </div>
      <span className="cv-spacer" />
      <button type="button" className="cv-btn" aria-label="Go to a date" title="Go to a date" aria-expanded={pop === 'date'} onClick={() => toggle('date')}>
        <Calendar size={20} />
      </button>
      <button type="button" className="cv-btn cv-zoom" aria-label={`Zoom ${zoom}%, view options`} title="View" aria-expanded={pop === 'zoom'} onClick={() => toggle('zoom')}>
        {zoom}%
      </button>
      <button type="button" className="cv-btn" aria-label="Canvas settings" title="Canvas settings" aria-expanded={pop === 'settings'} onClick={() => toggle('settings')}>
        <Settings size={20} />
      </button>
      <button type="button" className="cv-btn" aria-label="Keyboard shortcuts and help (?)" title="Help (?)" aria-expanded={pop === 'help'} onClick={() => toggle('help')}>
        <CircleHelp size={20} />
      </button>

      <input ref={files} type="file" accept="image/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />

      {pop === 'image' && (
        <div className="cv-popover cv-menu cv-pop-left" role="menu" aria-label="Insert image">
          <button type="button" role="menuitem" onClick={() => files.current?.click()}>
            <Images size={16} /> Photo library or files
          </button>
          <button type="button" role="menuitem" onClick={() => camera.current?.click()}>
            <Camera size={16} /> Take a photo
          </button>
          <button type="button" role="menuitem" onClick={() => (setPop(null), void pasteFromClipboard(actions))}>
            <ImagePlus size={16} /> Paste
          </button>
        </div>
      )}
      {pop === 'size' && (
        <div className="cv-popover cv-pop-left" role="dialog" aria-label="Custom size">
          <label className="field">
            <span>Size: {style.size}</span>
            <input type="range" min={isHl ? 4 : 0.5} max={isHl ? 60 : 16} step={0.5} value={style.size} onChange={(e) => setStyle({ size: Number(e.target.value) })} />
          </label>
        </div>
      )}
      {pop === 'zoom' && (
        <div className="cv-popover cv-menu" role="menu" aria-label="View">
          <button type="button" role="menuitem" onClick={() => (setPop(null), void engine.fitAll())}>
            Fit all <kbd>⇧1</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!engine.getSelection().length} onClick={() => (setPop(null), engine.fitSelection())}>
            Fit selection <kbd>⇧2</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => (setPop(null), engine.zoomAtScreen(1))}>
            100% <kbd>⌘0</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => engine.zoomBy(1.25)}>
            Zoom in <kbd>⌘=</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => engine.zoomBy(0.8)}>
            Zoom out <kbd>⌘−</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => (setPop(null), engine.jumpToNow())}>
            Jump to now <kbd>Home</kbd>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={minimap} onClick={() => setMinimap(!minimap)}>
            <MapIcon size={16} /> Minimap
          </button>
          {!c.embedded && (
            <button type="button" role="menuitem" onClick={() => (setPop(null), c.openTopics({ kind: 'canvas' }))}>
              <Tag size={16} /> Tag this canvas…
            </button>
          )}
        </div>
      )}
      {pop === 'date' && <DatePopover onClose={() => setPop(null)} />}
      {pop === 'settings' && <SettingsPopover />}
      {pop === 'help' && (
        <div className="cv-popover cv-help" role="dialog" aria-label="Keyboard shortcuts and gestures">
          <h3>Keyboard</h3>
          <dl>
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h3>Touch and Pencil</h3>
          <ul>
            <li>Once the Pencil is used, only the Pencil draws: one finger pans, two fingers pan and zoom.</li>
            <li>Hold two fingers still for a moment, then spread or pinch to insert or remove space.</li>
            <li>Two-finger tap: undo. Double-tap: edit text or start a text box.</li>
            <li>The stylus eraser end and barrel button work where the browser reports them. Safari does not expose Pencil double-tap or squeeze to web apps.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function DatePopover({ onClose }: { onClose(): void }) {
  const { ctl, engine } = useCanvas();
  const [date, setDate] = useState(isoDate());
  const [, bump] = useState(0);
  useEffect(() => {
    // C21: every day line, from every month
    void ctl.loadAll().then(() => bump((x) => x + 1));
  }, [ctl]);
  const lines = sortedLines(ctl.model.dayLines()).reverse();
  const go = (d: string) => {
    const l = lineForDate(ctl.model.dayLines(), d);
    if (!l) return;
    const k = engine.pxPerUnit;
    engine.setCamera({ x: engine.camera.x, y: l.y - (engine.height * 0.15) / k, zoom: engine.camera.zoom }, true);
    onClose();
  };
  return (
    <div className="cv-popover cv-dates" role="dialog" aria-label="Go to a date">
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(date)} />
      </label>
      <button type="button" className="btn primary" onClick={() => go(date)} disabled={!lines.length}>
        Go
      </button>
      <ul aria-label="Days on this canvas">
        {lines.length === 0 && <li className="cv-muted">No day lines yet.</li>}
        {lines.slice(0, 60).map((l) => (
          <li key={l.date}>
            <button type="button" onClick={() => go(l.date)}>
              {dayLabel(l.date)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsPopover() {
  const { services } = useCanvas();
  const [prefs, setPrefs] = useState<DevicePrefs>(services.settings.getPrefs());
  const set = (p: Partial<DevicePrefs>) => {
    setPrefs({ ...prefs, ...p });
    void services.settings.setPrefs(p);
  };
  const penDetected = useTools((s) => s.penDetected);
  return (
    <div className="cv-popover cv-settings" role="dialog" aria-label="Canvas settings">
      <label className="cv-check">
        <input type="checkbox" checked={prefs.fingerDrawing} onChange={(e) => set({ fingerDrawing: e.target.checked })} />
        Draw with a finger {penDetected ? '(a Pencil was detected)' : ''}
      </label>
      <label className="field">
        <span>Stylus button</span>
        <select value={prefs.pencilDoubleTap} onChange={(e) => set({ pencilDoubleTap: e.target.value as DevicePrefs['pencilDoubleTap'] })}>
          <option value="eraser">Erase while pressed</option>
          <option value="previous">Previous tool while pressed</option>
          <option value="none">Nothing</option>
        </select>
      </label>
      <label className="field">
        <span>Hold two fingers to insert space: {prefs.spaceHoldMs} ms</span>
        <input type="range" min={200} max={1000} step={50} value={prefs.spaceHoldMs} onChange={(e) => set({ spaceHoldMs: Number(e.target.value) })} />
      </label>
      <p className="cv-muted">Pencil double-tap and squeeze are not available to web apps in Safari; the stylus button above is the closest the browser allows.</p>
    </div>
  );
}
