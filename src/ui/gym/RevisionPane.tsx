/**
 * The revision list (G8): problems to revisit (oldest attempt first), open problems, then
 * finished topics by their latest log entry, oldest first. Tapping an entry opens it in the
 * gym reader. Usable full screen on an iPhone.
 */
import { RefreshCw } from 'lucide-react';
import type { GymProblem, GymStructure } from '../../core/gym/structure';
import type { RevisionTopic } from '../../core/gym/revision';
import { dayLabel } from '../../core/util/time';
import type { PaneProps } from '../panes/registry';
import type { PaneTab } from '../../core/model/types';
import { StatusChip } from './GymDocument';
import { openGym } from './open';
import { useAsync, useGym } from './useGym';

const ago = (date: string, today = new Date()) => {
  const [y, m, d] = date.split('-').map(Number);
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
};

export function RevisionPane(_props: PaneProps<Extract<PaneTab, { kind: 'revision' }>>) {
  const idx = useGym();
  const { value: list, loading } = useAsync(() => idx.revisionList(), [idx, idx.revision]);
  const { value: structure } = useAsync(() => idx.structure(), [idx, idx.revision]);
  const empty = idx.files.list().length === 0;

  return (
    <div className="gym-reader">
      <header className="gym-head">
        <h1 className="gym-head-title">Revision</h1>
        <span className="gym-spacer" />
        {loading && <RefreshCw size={14} className="gym-spin" aria-label="Updating" />}
      </header>
      <div className="gym-scroll">
        <div className="gym-page gym-revision">
          {empty ? (
            <p className="gym-note">Gym's files are not on this device yet. They download with the first sync, then the revision list works offline.</p>
          ) : !list ? (
            <p className="gym-muted">Reading gym…</p>
          ) : (
            <>
              <ProblemSection title="Revisit" hint="Solved problems to attempt again, oldest attempt first." problems={list.revisit} structure={structure} />
              <ProblemSection title="Open" hint="Unsolved problems." problems={list.open} structure={structure} />
              <TopicSection topics={list.done} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProblemSection({ title, hint, problems, structure }: { title: string; hint: string; problems: GymProblem[]; structure?: GymStructure }) {
  const unitTitle = (path: string) => structure?.units.find((u) => u.path === path)?.title ?? path;
  return (
    <section className="gym-rev-section" aria-label={title}>
      <h2>
        {title} <span className="gym-count">{problems.length}</span>
      </h2>
      <p className="gym-muted gym-hint">{hint}</p>
      {problems.length === 0 ? (
        <p className="gym-muted">None.</p>
      ) : (
        <ul>
          {problems.map((p) => (
            <li key={p.path}>
              <button className="gym-entry gym-rev-entry" onClick={() => openGym(p.path)}>
                <span className="gym-entry-title">
                  {p.number} · {p.title}
                </span>
                <span className="gym-muted">{unitTitle(p.unit)}</span>
                <span className="gym-rev-meta">
                  <StatusChip status={p.status} />
                  {p.difficulty && <span className="gym-chip">{p.difficulty}</span>}
                  {p.date && <span className="gym-muted">last attempt {p.date}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopicSection({ topics }: { topics: RevisionTopic[] }) {
  return (
    <section className="gym-rev-section" aria-label="Topics">
      <h2>
        Topics <span className="gym-count">{topics.length}</span>
      </h2>
      <p className="gym-muted gym-hint">Finished topics, least recently studied first (from the log).</p>
      {topics.length === 0 ? (
        <p className="gym-muted">None.</p>
      ) : (
        <ul>
          {topics.map(({ unit, lastLogged }) => (
            <li key={unit.path}>
              <button className="gym-entry gym-rev-entry" onClick={() => openGym(unit.path)}>
                <span className="gym-entry-title">{unit.title}</span>
                <span className="gym-muted gym-path">{unit.path}</span>
                <span className="gym-rev-meta">
                  <StatusChip status={unit.status} />
                  <span className="gym-muted" title={lastLogged ? dayLabel(lastLogged) : undefined}>
                    {lastLogged ? `last logged ${lastLogged} (${ago(lastLogged)})` : 'never logged'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
