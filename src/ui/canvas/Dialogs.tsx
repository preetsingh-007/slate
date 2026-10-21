/**
 * Dialogs of the canvas: Mark for gym (G3) and topic tags (G2). Gym paths come from the topic
 * picker the gym area registers; without it, a plain text field takes a path.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import type { Mark, MarkKind } from '../../core/model/types';
import { cleanGymPath, MARK_KINDS } from '../../core/canvas/marks';
import { getTopicPicker } from '../common/registries';

/**
 * Runs `save` after any pending input commits. The topic picker commits a typed path on blur;
 * committing can change the dialog's layout, so the button keeps focus from moving on
 * mouse-down (the click still lands on it), blurs the field itself, and saves once React has
 * applied the commit.
 */
function commitThen(save: () => void) {
  (document.activeElement as HTMLElement | null)?.blur();
  setTimeout(save, 0);
}

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function Dialog({ title, onClose, children, actions }: { title: string; onClose(): void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.dlg-close)');
    first?.focus();
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div
      className="dialog-backdrop cv-ui"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
        if (e.key === 'Tab' && ref.current) {
          // keep focus inside the dialog
          const f = [...ref.current.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
          if (!f.length) return;
          const i = f.indexOf(document.activeElement as HTMLElement);
          if (e.shiftKey && i <= 0) {
            e.preventDefault();
            f[f.length - 1].focus();
          } else if (!e.shiftKey && i === f.length - 1) {
            e.preventDefault();
            f[0].focus();
          }
        }
      }}
    >
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="cv-dlg-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn dlg-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

/** A gym path field: the registered topic picker, or a text input (G1 fallback). */
export function GymPathField({ kind, value, onChange, label, topic }: { kind: 'topic' | 'problem'; value: string; onChange(v: string): void; label: string; topic?: string }) {
  const Picker = getTopicPicker();
  if (Picker) return <Picker kind={kind} value={value} onChange={onChange} label={label} topic={topic} />;
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={kind === 'topic' ? 'domain/subject/topic' : 'domain/subject/topic/problems/01-name.md'}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </label>
  );
}

const KIND_LABEL: Record<MarkKind, string> = { note: 'Note', problem: 'Problem', solution: 'Solution', question: 'Question' };

export interface MarkDraft {
  kind: MarkKind;
  topic: string;
  problem: string;
  comment: string;
}

export function MarkDialog({ initial, onSave, onRemove, onClose }: { initial?: Mark; onSave(d: MarkDraft): void; onRemove?(): void; onClose(): void }) {
  const [d, setD] = useState<MarkDraft>({ kind: initial?.kind ?? 'note', topic: initial?.topic ?? '', problem: initial?.problem ?? '', comment: initial?.comment ?? '' });
  const set = (p: Partial<MarkDraft>) => setD((x) => ({ ...x, ...p }));
  const latest = useRef(d);
  latest.current = d;
  return (
    <Dialog
      title={initial ? 'Edit mark' : 'Mark for gym'}
      onClose={onClose}
      actions={
        <>
          {onRemove && (
            <button type="button" className="btn danger" onClick={onRemove}>
              Remove mark
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onMouseDown={keepFocus} onClick={() => commitThen(() => onSave(latest.current))}>
            {initial ? 'Save' : 'Mark'}
          </button>
        </>
      }
    >
      <fieldset className="cv-kinds">
        <legend>Kind</legend>
        {MARK_KINDS.map((k) => (
          <label key={k} className={`cv-kind${d.kind === k ? ' on' : ''}`}>
            <input type="radio" name="mark-kind" value={k} checked={d.kind === k} onChange={() => set({ kind: k })} />
            {KIND_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <GymPathField kind="topic" label="Topic (optional)" value={d.topic} onChange={(topic) => set({ topic })} />
      {d.kind === 'solution' && <GymPathField kind="problem" label="Problem (optional)" value={d.problem} topic={d.topic || undefined} onChange={(problem) => set({ problem })} />}
      <label className="field">
        <span>Comment (optional)</span>
        <textarea rows={2} value={d.comment} onChange={(e) => set({ comment: e.target.value })} />
      </label>
    </Dialog>
  );
}

export function TopicDialog({ title, initial, onSave, onClose }: { title: string; initial: string[]; onSave(topics: string[]): void; onClose(): void }) {
  const [topics, setTopics] = useState<string[]>(initial);
  const [next, setNext] = useState('');
  const add = (v = next) => {
    const p = cleanGymPath(v);
    if (p && !topics.includes(p)) setTopics([...topics, p]);
    setNext('');
  };
  const Picker = getTopicPicker();
  const latest = useRef({ topics, next });
  latest.current = { topics, next };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onMouseDown={keepFocus}
            onClick={() =>
              commitThen(() => {
                const { topics: list, next: pending } = latest.current;
                const p = cleanGymPath(pending);
                onSave(p && !list.includes(p) ? [...list, p] : list);
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <ul className="cv-topic-list" aria-label="Topics">
        {topics.length === 0 && <li className="cv-muted">No topics yet.</li>}
        {topics.map((t) => (
          <li key={t} className="cv-topic">
            <span title={t}>{t}</span>
            <button type="button" className="icon-btn" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="cv-add-topic">
        {Picker ? (
          <Picker kind="topic" value={next} label="Add a topic" onChange={(v) => (v ? add(v) : setNext(v))} />
        ) : (
          <label className="field" style={{ flex: 1 }}>
            <span>Add a topic</span>
            <input
              type="text"
              value={next}
              placeholder="domain/subject/topic"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setNext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </label>
        )}
        {!Picker && (
          <button type="button" className="btn" onClick={() => add()} disabled={!next.trim()}>
            Add
          </button>
        )}
      </div>
    </Dialog>
  );
}
