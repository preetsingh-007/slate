/**
 * One tab at a time (R1): the app holds a Web Lock for as long as it runs, so two tabs of one
 * browser never work on the same local data at once. Another tab can take over ("Use here"),
 * which steals the lock; the tab that had it learns so and stops.
 *
 * Where Web Locks are missing the app runs anyway: the stores re-read shared state before every
 * write and tabs tell each other about writes (core/stores/sharedKv.ts, DocStore), so a second
 * tab cannot overwrite the first one's saved work.
 */

export type TabLock =
  /** this tab runs the app; `lost` resolves when another tab takes over */
  | { state: 'held'; lost: Promise<void> }
  /** another tab runs the app */
  | { state: 'busy' }
  /** no Web Locks in this browser */
  | { state: 'unsupported' };

export const APP_LOCK = 'slate-app';

/**
 * Takes the app's lock. Waits up to `waitMs` for a tab that is closing or reloading to let go;
 * with `steal`, takes it from the tab that has it.
 */
export function acquireTabLock(name = APP_LOCK, opts: { steal?: boolean; waitMs?: number } = {}): Promise<TabLock> {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: LockManager }).locks : undefined;
  if (!locks) return Promise.resolve({ state: 'unsupported' });
  return new Promise<TabLock>((resolve) => {
    let held = false;
    let onLost!: () => void;
    const lost = new Promise<void>((r) => (onLost = r));
    const ctl = opts.steal ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), opts.waitMs ?? 1500) : undefined;
    const options: LockOptions = opts.steal ? { steal: true } : { signal: ctl!.signal };
    locks
      .request(name, options, () => {
        held = true;
        clearTimeout(timer);
        resolve({ state: 'held', lost });
        // held until the page goes away or another tab steals it
        return new Promise<void>(() => {});
      })
      .catch(() => {
        clearTimeout(timer);
        // before acquiring: timed out waiting; after: stolen by another tab
        if (held) onLost();
        else resolve({ state: 'busy' });
      });
  });
}
