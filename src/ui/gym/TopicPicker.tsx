/**
 * The topic picker (G1, G2, G3): a searchable, keyboard-accessible combobox of gym topic and
 * variant paths, or of problem files for `kind: 'problem'`. Works offline from the mirror.
 * A path that is not in gym yet can be typed; it is accepted with a warning, so a topic can
 * be tagged before it is created in gym.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { TopicPickerProps } from '../common/registries';
import { isProblemPathShape, isTopicPathShape } from '../../core/gym/structure';
import { StatusChip } from './GymDocument';
import { useAsync, useGym } from './useGym';

interface Option {
  value: string;
  title: string;
  status: string;
  /** search text */
  hay: string;
  depth: number;
}

const MAX = 60;

export function rankOptions(options: Option[], query: string): Option[] {
  const words = query.toLowerCase().split(/[\s/]+/).filter(Boolean);
  if (!words.length) return options.slice(0, MAX);
  const q = query.toLowerCase().trim();
  return options
    .map((o) => {
      if (!words.every((w) => o.hay.includes(w))) return null;
      const score = (o.value.startsWith(q) ? 4 : 0) + (o.value.includes(q) ? 2 : 0) + (o.title.toLowerCase().includes(q) ? 2 : 0) - o.depth * 0.1;
      return { o, score };
    })
    .filter((x): x is { o: Option; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX)
    .map((x) => x.o);
}

export function GymTopicPicker({ kind, value, onChange, topic, label, autoFocus }: TopicPickerProps) {
  const idx = useGym();
  const { value: structure } = useAsync(() => idx.structure(), [idx, idx.revision]);
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const warnId = useId();

  // follow the value when it changes from outside
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  const options = useMemo<Option[]>(() => {
    if (!structure) return [];
    if (kind === 'problem') {
      return structure.problems
        .filter((p) => !topic || p.unit === topic || p.unit.startsWith(`${topic}/`) || topic.startsWith(`${p.unit}/`))
        .map((p) => ({ value: p.path, title: `${p.number} · ${p.title}`, status: p.status, hay: `${p.path} ${p.title}`.toLowerCase(), depth: 0 }));
    }
    return structure.units.map((u) => ({ value: u.path, title: u.title, status: u.status, hay: `${u.path} ${u.title}`.toLowerCase(), depth: u.kind === 'variant' ? 1 : 0 }));
  }, [structure, kind, topic]);

  const query = text === value ? '' : text;
  const shown = useMemo(() => rankOptions(options, query), [options, query]);
  const known = useMemo(() => new Set(options.map((o) => o.value)), [options]);

  const commit = (v: string) => {
    const next = v.trim().replace(/^\/+|\/+$/g, '');
    setText(next);
    setOpen(false);
    if (next !== value) onChange(next);
  };

  const warning = !value
    ? null
    : known.has(value) || !structure
      ? null
      : kind === 'problem'
        ? isProblemPathShape(value)
          ? 'Not in gym yet. It will be created there when formalized.'
          : 'Not a problem path (<topic>/problems/NNN-<slug>.md).'
        : isTopicPathShape(value)
          ? 'Not in gym yet. Tag it now; create the topic in gym later.'
          : 'Not a topic path (domain/subject/topic, or …/topic/variant).';

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      setNavigated(true);
      const n = shown.length;
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // the highlighted option when the list is open and the owner typed or moved in it;
      // otherwise the typed text, which may be a path not in gym yet
      if (open && shown[active] && (query || navigated)) commit(shown[active].value);
      else commit(text);
    } else if (e.key === 'Escape') {
      // first Escape closes the list (keeping the text), the second reverts it; a third
      // reaches the surrounding dialog
      if (!open && text === value) return;
      e.preventDefault();
      e.stopPropagation();
      if (open) setOpen(false);
      else setText(value);
    } else if (e.key === 'Tab' && open) {
      setOpen(false);
    }
  };

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;
  return (
    <div className="gym-picker">
      {label && (
        <label className="gym-picker-label" htmlFor={`${listId}-input`}>
          {label}
        </label>
      )}
      <div className="gym-picker-field">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={warning ? warnId : undefined}
          aria-label={label ? undefined : kind === 'problem' ? 'Problem path' : 'Topic path'}
          placeholder={kind === 'problem' ? 'math/…/problems/001-….md' : 'math/linear-algebra/eigenvalues'}
          autoFocus={autoFocus}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setNavigated(false);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // a click on an option commits first (mousedown is prevented on the list)
            if (text !== value) commit(text);
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            className="gym-picker-clear"
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              commit('');
              inputRef.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="gym-picker-list" aria-label={kind === 'problem' ? 'Problems' : 'Topics'} onMouseDown={(e) => e.preventDefault()}>
          {shown.length === 0 && (
            <li className="gym-picker-empty" role="presentation">
              {structure ? (text.trim() ? 'No match. Press Enter to use this path.' : 'Gym has no entries yet.') : 'Reading gym…'}
            </li>
          )}
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`gym-picker-option${o.depth ? ' variant' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(o.value)}
            >
              <span className="gym-entry-title">{o.title}</span>
              <span className="gym-muted gym-path">{o.value}</span>
              <StatusChip status={o.status} />
            </li>
          ))}
        </ul>
      )}
      {warning && (
        <p id={warnId} className="gym-picker-warn" role="status">
          <TriangleAlert size={14} aria-hidden /> {warning}
        </p>
      )}
    </div>
  );
}
