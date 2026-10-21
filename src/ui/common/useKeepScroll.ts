import { useEffect, useRef, type RefObject } from 'react';

/**
 * Inactive side-pane tabs stay mounted but hidden (display: none), which resets their scroll
 * position; this restores it when the tab is shown again.
 */
export function useKeepScroll(ref: RefObject<HTMLElement | null>, restore?: (el: HTMLElement) => void, key?: unknown) {
  const last = useRef(0);
  const hidden = useRef(false);
  const cb = useRef(restore);
  cb.current = restore;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (el.clientWidth > 0) last.current = el.scrollTop;
    };
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0) {
        hidden.current = true;
        return;
      }
      if (!hidden.current) return;
      hidden.current = false;
      requestAnimationFrame(() => {
        if (cb.current) cb.current(el);
        else el.scrollTop = last.current;
      });
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [ref, key]);
}
