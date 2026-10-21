import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let next = 1;

/** Shows a short notice at the bottom of the screen (announced to screen readers). */
export function toast(text: string, opts: { ms?: number; action?: Toast['action'] } = {}) {
  const id = next++;
  useToasts.setState((s) => ({ list: [...s.list, { id, text, action: opts.action }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), opts.ms ?? 4000);
}

export function ToastHost() {
  const list = useToasts((s) => s.list);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
          {t.action && (
            <button className="btn" style={{ marginLeft: 8 }} onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** True when the viewport is narrow (iPhone, iPad Slide Over): one pane at a time (P2). */
export function useNarrow(): boolean {
  const query = '(max-width: 700px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}
