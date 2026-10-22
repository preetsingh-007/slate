/**
 * Durability NFR: a crash or closed tab loses nothing drawn or typed. Work still held in the UI
 * when the page goes away (a stroke whose pen has not lifted, a note or to-do being typed) is
 * committed when the page is hidden or unloaded, and the document store is flushed after it.
 * These writes are best effort: a closing page may get no time to finish them (headless
 * Chromium, a suspended iPad PWA). What guarantees the work is its draft in localStorage
 * (drafts.ts), written synchronously while the work goes on and recovered on the next start.
 *
 * The DocStore flushes on `pagehide` by itself, but its listener was registered first and runs
 * before these savers, so each saver flushes again once it has written.
 */
import { useEffect, useRef } from 'react';
import { useServices } from '../../app/services';

/** Calls `save` when the page is hidden (app switch, tab closed, iOS suspension). Returns a remover. */
export function onPageHide(save: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onVisibility = () => document.visibilityState === 'hidden' && save();
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** React form of `onPageHide`: `save` runs, then the document store writes to IndexedDB. */
export function usePageHide(save: () => void) {
  const services = useServices();
  const latest = useRef(save);
  latest.current = save;
  useEffect(
    () =>
      onPageHide(() => {
        latest.current();
        void services.docs.flushNow();
      }),
    [services],
  );
}
