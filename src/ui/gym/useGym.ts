/**
 * React access to gym's files (G1, G7, G8): one `GymIndex` per app services, following
 * `services.gymFiles` (the sync engine's offline mirror).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useServices, type Services } from '../../app/services';
import { GymIndex } from '../../core/gym/index';
import { CanvasTodoIndex } from '../../core/stores/canvasTodos';

const indexes = new WeakMap<Services, GymIndex>();

export function gymIndexFor(s: Services): GymIndex {
  let idx = indexes.get(s);
  if (!idx) indexes.set(s, (idx = new GymIndex(s.gymFiles)));
  else if (idx.files !== s.gymFiles) idx.setFiles(s.gymFiles);
  return idx;
}

/** The gym index; re-renders the caller whenever the mirror changes. */
export function useGym(): GymIndex {
  const idx = gymIndexFor(useServices());
  useSyncExternalStore(
    (cb) => idx.onChange.on(cb),
    () => idx.revision,
  );
  return idx;
}

/** Result of an async computation that is redone when `deps` change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { value: T | undefined; loading: boolean; error: unknown } {
  const [state, setState] = useState<{ value: T | undefined; loading: boolean; error: unknown }>({ value: undefined, loading: true, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (value) => live && setState({ value, loading: false, error: null }),
      (error) => live && setState({ value: undefined, loading: false, error }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

const todoIndexes = new WeakMap<Services, CanvasTodoIndex>();

/** The live canvas to-do list (G4), shared by every To-dos page of the app. */
export function canvasTodoIndexFor(s: Services): CanvasTodoIndex {
  let idx = todoIndexes.get(s);
  if (!idx) {
    todoIndexes.set(s, (idx = new CanvasTodoIndex(s.canvases, s.docs)));
    void idx.refresh();
  }
  return idx;
}
