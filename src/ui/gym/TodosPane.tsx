/**
 * The To-dos page (G4), a side-pane tab (full screen on iPhone-width screens):
 * - Checklist: standalone to-dos in the collaborative `todo` document. Enter adds the next
 *   item; tap the box to check; drag the handle (or Alt+↑/↓) to reorder; swipe left, the
 *   remove button, or Delete on an empty item to remove. Checked items move to a collapsed
 *   Done list.
 * - From the canvas: every unchecked `- [ ]` line in canvas text boxes, by day, newest first.
 *   Checking one checks it on the canvas; tapping its text jumps to it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { GripVertical, Trash2, Plus } from 'lucide-react';
import { useServices } from '../../app/services';
import type { PaneTab } from '../../core/model/types';
import { addItem, addItemAfter, moveItem, parseChecklist, removeItem, setChecked, setItemText, type ChecklistLine } from '../../core/stores/checklist';
import { setCanvasTodo, type CanvasTodo } from '../../core/stores/canvasTodos';
import { TODO_DOC_ID } from '../../core/stores/docIds';
import { checklistText } from '../../core/stores/todo';
import { renderInline } from '../../core/markdown/render';
import { addDays, dayLabel, isoDate } from '../../core/util/time';
import { useApp } from '../app/store';
import { canvasApi } from '../common/registries';
import { toast } from '../common/toast';
import type { PaneProps } from '../panes/registry';
import { isNarrow } from './open';
import { canvasTodoIndexFor } from './useGym';

export function TodosPane(_props: PaneProps<Extract<PaneTab, { kind: 'todos' }>>) {
  return (
    <div className="gym-reader">
      <header className="gym-head">
        <h1 className="gym-head-title">To-dos</h1>
      </header>
      <div className="gym-scroll">
        <div className="gym-page gym-todos">
          <section aria-labelledby="todo-checklist">
            <h2 id="todo-checklist">Checklist</h2>
            <Checklist />
          </section>
          <section aria-labelledby="todo-canvas">
            <h2 id="todo-canvas">From the canvas</h2>
            <CanvasTodos />
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- checklist

function useChecklist(): { t: Y.Text | null; text: string } {
  const { docs } = useServices();
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  useEffect(() => {
    let live = true;
    let retained = false;
    void docs.open(TODO_DOC_ID).then((d) => {
      if (!live) return;
      docs.retain(TODO_DOC_ID);
      retained = true;
      setDoc(d);
    });
    return () => {
      live = false;
      if (retained) docs.release(TODO_DOC_ID);
    };
  }, [docs]);
  const t = doc ? checklistText(doc) : null;
  const text = useSyncExternalStore(
    (cb) => {
      if (!t) return () => {};
      t.observe(cb);
      return () => t.unobserve(cb);
    },
    () => (t ? t.toString() : ''),
  );
  return { t, text };
}

interface Drag {
  index: number;
  pointer: number;
  startY: number;
  dy: number;
  /** position among the open items it would drop at */
  target: number;
}

function Checklist() {
  const { t, text } = useChecklist();
  const items = useMemo(() => parseChecklist(text), [text]);
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  // the item (input, or its reorder handle) to focus after the next render
  const [focus, setFocus] = useState<{ index: number; handle?: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (focus === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(focus.handle ? `[data-handle="${focus.index}"]` : `input[data-item="${focus.index}"]`);
    if (el) {
      el.focus();
      setFocus(null);
    }
  });

  if (!t) return <p className="gym-muted">Loading…</p>;

  const remove = (it: ChecklistLine, focusAfter?: number | null) => {
    const { text: body, checked, index } = it;
    removeItem(t, index);
    if (focusAfter !== undefined && focusAfter !== null) setFocus({ index: focusAfter });
    if (body.trim())
      toast(`Removed “${body.trim().slice(0, 40)}”`, {
        action: {
          label: 'Undo',
          run: () => {
            const i = addItem(t, body, index);
            if (checked) setChecked(t, i, true);
          },
        },
      });
  };

  /** Moves an open item by `delta` places among the open items. */
  const step = (it: ChecklistLine, delta: number, handle = false) => {
    const pos = open.findIndex((o) => o.index === it.index);
    const other = open[pos + delta];
    if (!other) return;
    moveItem(t, it.index, other.index);
    setFocus({ index: other.index, handle });
  };

  const targetOf = (y: number): number => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [])];
    let pos = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        pos = i;
        break;
      }
    }
    return Math.max(0, pos);
  };

  const onHandleDown = (e: React.PointerEvent, it: ChecklistLine) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = open.findIndex((o) => o.index === it.index);
    setDrag({ index: it.index, pointer: e.pointerId, startY: e.clientY, dy: 0, target: pos });
    e.preventDefault();
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    setDrag({ ...drag, dy: e.clientY - drag.startY, target: targetOf(e.clientY) });
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const from = open.findIndex((o) => o.index === drag.index);
    setDrag(null);
    if (drag.target !== from && open[drag.target]) moveItem(t, drag.index, open[drag.target].index);
  };

  const row = (it: ChecklistLine, pos: number) => {
    const dragging = drag?.index === it.index;
    const from = drag ? open.findIndex((o) => o.index === drag.index) : -1;
    const dropClass = drag && !dragging && pos === drag.target ? (drag.target < from ? ' drop-before' : ' drop-after') : '';
    return (
      <SwipeRow key={`${it.index}:${it.lineStart}`} className={`gym-todo${dragging ? ' dragging' : ''}${dropClass}`} style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined} onSwipe={() => remove(it)}>
        <button
          className="gym-todo-handle"
          data-handle={it.index}
          aria-label={`Reorder “${it.text.trim() || 'empty item'}”. Use the up and down arrow keys.`}
          onPointerDown={(e) => onHandleDown(e, it)}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={() => setDrag(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              step(it, e.key === 'ArrowUp' ? -1 : 1, true);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              remove(it);
            }
          }}
        >
          <GripVertical size={16} />
        </button>
        <input
          type="checkbox"
          checked={false}
          aria-label={`Done: ${it.text.trim() || 'empty item'}`}
          onChange={() => setChecked(t, it.index, true)}
          onKeyDown={(e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              remove(it);
            }
          }}
        />
        <input
          type="text"
          className="gym-todo-input"
          data-item={it.index}
          aria-label="To-do"
          value={it.text}
          onChange={(e) => setItemText(t, it.index, e.target.value)}
          onKeyDown={(e) => {
            const input = e.currentTarget;
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              setFocus({ index: addItemAfter(t, it.index, '') });
            } else if ((e.key === 'Backspace' || e.key === 'Delete') && input.value === '') {
              e.preventDefault();
              const prev = open[pos - 1];
              const next = open[pos + 1];
              remove(it, e.key === 'Backspace' ? (prev?.index ?? null) : next ? next.index - 1 : null);
              if (!prev && !next) newRef.current?.focus();
            } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault();
              step(it, e.key === 'ArrowUp' ? -1 : 1);
            } else if (!e.altKey && e.key === 'ArrowDown' && input.selectionStart === input.value.length) {
              const next = open[pos + 1];
              if (next) setFocus({ index: next.index });
              else newRef.current?.focus();
            } else if (!e.altKey && e.key === 'ArrowUp' && input.selectionStart === 0) {
              const prev = open[pos - 1];
              if (prev) setFocus({ index: prev.index });
            }
          }}
        />
        <button className="gym-todo-remove" aria-label={`Remove “${it.text.trim() || 'empty item'}”`} onClick={() => remove(it)}>
          <Trash2 size={14} />
        </button>
      </SwipeRow>
    );
  };

  return (
    <div className="gym-checklist">
      {open.length === 0 && <p className="gym-muted">Nothing to do. Add a to-do below.</p>}
      <ul ref={listRef} className="gym-todo-list" aria-label="Checklist">
        {open.map(row)}
      </ul>
      <div className="gym-todo gym-todo-new">
        <Plus size={16} aria-hidden className="gym-todo-plus" />
        <input
          ref={newRef}
          type="text"
          className="gym-todo-input"
          placeholder="Add a to-do"
          aria-label="Add a to-do"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim()) {
              e.preventDefault();
              addItem(t, draft.trim());
              setDraft('');
            } else if (e.key === 'ArrowUp' && open.length) {
              e.preventDefault();
              setFocus({ index: open[open.length - 1].index });
            }
          }}
        />
      </div>
      {done.length > 0 && (
        <details className="gym-done">
          <summary>Done ({done.length})</summary>
          <ul className="gym-todo-list" aria-label="Done">
            {done.map((it) => (
              <SwipeRow key={`${it.index}:${it.lineStart}`} className="gym-todo checked" onSwipe={() => remove(it)}>
                <span className="gym-todo-handle-space" />
                <input type="checkbox" checked aria-label={`Not done: ${it.text.trim()}`} onChange={() => setChecked(t, it.index, false)} />
                <span className="gym-todo-text-done">{it.text}</span>
                <button className="gym-todo-remove" aria-label={`Remove “${it.text.trim()}”`} onClick={() => remove(it)}>
                  <Trash2 size={14} />
                </button>
              </SwipeRow>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A list row that can be swiped left to remove (touch and pen; mouse users have the button). */
function SwipeRow({ children, className, style, onSwipe }: { children: React.ReactNode; className: string; style?: React.CSSProperties; onSwipe(): void }) {
  const [dx, setDx] = useState(0);
  const s = useRef<{ id: number; x: number; y: number; on: boolean } | null>(null);
  return (
    <li
      className={className}
      style={{ ...style, ...(dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.3, 1 + dx / 200) } : null) }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' || (e.target as Element).closest('.gym-todo-handle')) return;
        s.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
      }}
      onPointerMove={(e) => {
        const st = s.current;
        if (!st || st.id !== e.pointerId) return;
        const ddx = e.clientX - st.x;
        if (!st.on) {
          if (Math.abs(ddx) < 10) return;
          if (Math.abs(e.clientY - st.y) > Math.abs(ddx)) {
            s.current = null;
            return;
          }
          st.on = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        setDx(Math.min(0, ddx));
      }}
      onPointerUp={() => {
        const swiped = s.current?.on && dx < -90;
        s.current = null;
        setDx(0);
        if (swiped) onSwipe();
      }}
      onPointerCancel={() => {
        s.current = null;
        setDx(0);
      }}
    >
      {children}
    </li>
  );
}

// ---------------------------------------------------------------- from the canvas

const todoKey = (t: CanvasTodo) => `${t.canvas}:${t.object}:${t.task}`;

function CanvasTodos() {
  const services = useServices();
  const index = canvasTodoIndexFor(services);
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  useEffect(() => index.onChange.on(() => setTick((n) => n + 1)), [index]);
  useEffect(() => services.canvases.onChange.on(() => setTick((n) => n + 1)), [services]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => index.days(), [index, tick]);
  // once the list no longer has a checked item, forget it
  useEffect(() => {
    const live = new Set(index.all().map(todoKey));
    setPending((p) => (p.size && [...p].some((k) => !live.has(k)) ? new Set([...p].filter((k) => live.has(k))) : p));
  }, [index, tick]);

  const canvases = new Map(services.canvases.list().map((c) => [c.slug, c.title]));
  const several = new Set(index.all().map((t) => t.canvas)).size > 1;
  const today = isoDate();

  if (!days.length) return <p className="gym-muted">No open to-dos in canvas text boxes. Write <code>- [ ] …</code> in a text box to add one.</p>;
  return (
    <div className="gym-canvas-todos">
      {days.map((d) => (
        <section key={d.date} className="gym-todo-day" aria-label={dayLabel(d.date)}>
          <h3>{d.date === today ? `Today · ${dayLabel(d.date)}` : d.date === addDays(today, -1) ? `Yesterday · ${dayLabel(d.date)}` : dayLabel(d.date)}</h3>
          <ul className="gym-todo-list">
            {d.todos.map((todo) => {
              const k = todoKey(todo);
              const done = pending.has(k);
              return (
                <li key={k} className={`gym-todo${done ? ' checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={done}
                    aria-label={`Done: ${todo.text}`}
                    onChange={async (e) => {
                      const on = e.target.checked;
                      setPending((p) => {
                        const n = new Set(p);
                        if (on) n.add(k);
                        else n.delete(k);
                        return n;
                      });
                      if (!(await setCanvasTodo(services.canvases, todo, on))) toast('That to-do is no longer on the canvas.');
                    }}
                  />
                  <button className="gym-todo-text" title="Show on the canvas" onClick={() => void revealOnCanvas(todo.canvas, todo.object)}>
                    <span dangerouslySetInnerHTML={{ __html: renderInline(todo.text) }} />
                    {several && <span className="gym-muted gym-todo-canvas">{canvases.get(todo.canvas) ?? todo.canvas}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Shows a canvas object: switches canvas if needed, brings the canvas on screen, reveals it. */
export async function revealOnCanvas(slug: string, id: string): Promise<boolean> {
  const app = useApp.getState();
  if (app.canvas !== slug) app.setCanvas(slug);
  if (isNarrow()) app.setLayout('canvas');
  else if (app.layout === 'pane') app.setLayout('split');
  // the canvas registers its API when it mounts
  for (let i = 0; i < 60; i++) {
    const api = canvasApi(slug);
    if (api) {
      api.revealObject(id);
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  toast('The canvas is not available.');
  return false;
}
