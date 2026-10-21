import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Services } from '../../app/services';
import type { Pt } from '../../core/model/types';
import type { Camera } from '../../core/canvas/camera';
import type { Emitter } from '../../core/util/emitter';
import type { CanvasEngine } from './engine/engine';
import type { CanvasController } from './controller';
import type { ActionCtx } from './actions';

export interface TopicTarget {
  kind: 'objects' | 'day' | 'canvas';
  ids?: string[];
  date?: string;
}

export interface CanvasCtxValue {
  engine: CanvasEngine;
  ctl: CanvasController;
  services: Services;
  slug: string;
  actions: ActionCtx;
  embedded: boolean;
  /** text box being edited, or a draft position */
  editing: { id?: string; at?: Pt; initial?: string } | null;
  setEditing(e: { id?: string; at?: Pt; initial?: string } | null): void;
  openMarkDialog(markId?: string): void;
  openTopics(target: TopicTarget): void;
  cropping: string | null;
  setCropping(id: string | null): void;
}

export const CanvasCtx = createContext<CanvasCtxValue | null>(null);

export function useCanvas(): CanvasCtxValue {
  const c = useContext(CanvasCtx);
  if (!c) throw new Error('useCanvas outside a canvas view');
  return c;
}

/** Calls `fn` with the camera now and on every frame in which it changes (imperative updates). */
export function useFrame(engine: CanvasEngine, fn: (cam: Camera) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useLayoutEffect(() => {
    ref.current(engine.camera);
    return engine.frame.on((cam) => ref.current(cam));
  }, [engine]);
}

/** Re-renders when the canvas model changes (optionally only for some changes). */
export function useModelVersion(ctl: CanvasController, filter?: (c: { changed: Set<string>; removed: Set<string>; marks: boolean; days: boolean }) => boolean): number {
  const [v, setV] = useState(0);
  const f = useRef(filter);
  f.current = filter;
  useEffect(() => ctl.model.onChange.on((c) => (!f.current || f.current(c) ? setV((x) => x + 1) : undefined)), [ctl]);
  return v;
}

/** The latest value an emitter fired (or `initial`). */
export function useEmitter<T, I = T>(em: Emitter<T>, initial: I): T | I {
  const [v, setV] = useState<T | I>(initial);
  useEffect(() => em.on((x) => setV(() => x)), [em]);
  return v;
}

/** The ids of the views, so only the last-used canvas reacts to keys and pastes. */
let activeView: string | null = null;
export function setActiveView(id: string) {
  activeView = id;
}
export function isActiveView(id: string): boolean {
  return activeView === id;
}
export function getActiveView(): string | null {
  return activeView;
}
