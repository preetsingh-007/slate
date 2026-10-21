/**
 * Opening the gym area's side-pane tabs, and requests to reveal a quote in a gym file (S6).
 */
import { create } from 'zustand';
import type { GymLocator, PaneTab } from '../../core/model/types';
import { useApp } from '../app/store';

export const NARROW_QUERY = '(max-width: 700px)';

export function isNarrow(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(NARROW_QUERY).matches;
}

/** Opens a tab in the side pane; full screen on narrow screens (P2: one pane at a time). */
export function openPane(tab: PaneTab) {
  const app = useApp.getState();
  app.openTab(tab);
  if (isNarrow()) app.setLayout('pane');
}

/** Opens a gym path (file, folder, or '' for the tree) in the gym reader (G7). `path` may end in `#heading`. */
export function openGym(path: string) {
  openPane({ kind: 'gym', path });
}

export interface RevealRequest {
  path: string;
  locator: GymLocator;
  nonce: number;
}

/** A pending "scroll to this quote and flash it" for the gym reader showing `path`. */
export const useGymReveal = create<{ req: RevealRequest | null }>(() => ({ req: null }));

let nonce = 0;

export function requestReveal(path: string, locator: GymLocator) {
  useGymReveal.setState({ req: { path, locator, nonce: ++nonce } });
}

export function clearReveal(n: number) {
  if (useGymReveal.getState().req?.nonce === n) useGymReveal.setState({ req: null });
}
