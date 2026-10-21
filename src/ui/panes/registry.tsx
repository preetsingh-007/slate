/**
 * What each kind of side-pane tab shows. Each area registers its component here.
 */
import type { ComponentType } from 'react';
import type { PaneTab } from '../../core/model/types';

export interface PaneProps<T extends PaneTab = PaneTab> {
  tab: T;
  /** true while this pane is visible (inactive tabs stay mounted but hidden) */
  active: boolean;
}

export interface PaneKind<T extends PaneTab = PaneTab> {
  component: ComponentType<PaneProps<T>>;
  title(tab: T): string;
}

const kinds = new Map<PaneTab['kind'], PaneKind>();

export function registerPane<K extends PaneTab['kind']>(kind: K, def: PaneKind<Extract<PaneTab, { kind: K }>>) {
  kinds.set(kind, def as unknown as PaneKind);
}

export function paneKind(kind: PaneTab['kind']): PaneKind | undefined {
  return kinds.get(kind);
}
