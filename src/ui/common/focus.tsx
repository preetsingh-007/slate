/**
 * Focus management for menus, popovers and dialogs (accessibility NFR: every action except
 * drawing works from the keyboard).
 *
 * - On open, focus moves into the popup: the first menu item of a menu, else an element marked
 *   `data-autofocus`, else the first control, else the popup itself.
 * - Escape closes it (and goes no further, so the canvas keeps its selection).
 * - In a menu, the arrow keys, Home and End move between items.
 * - A modal (`trap`) keeps Tab inside.
 * - On close, focus returns to where it was (the button that opened it), unless the person has
 *   since moved it somewhere else.
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])';

const visible = (el: HTMLElement) => !el.closest('[hidden]') && (el.offsetParent !== null || el.getClientRects().length > 0);

export interface PopupFocusOptions {
  onClose?: () => void;
  /** keep Tab inside (modal dialogs) */
  trap?: boolean;
  /** move focus in on open (default true) */
  autoFocus?: boolean;
}

export function usePopupFocus(ref: RefObject<HTMLElement | null>, opts: PopupFocusOptions = {}) {
  const latest = useRef(opts);
  latest.current = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const isMenu = el.getAttribute('role') === 'menu';
    if (latest.current.autoFocus !== false && !el.contains(document.activeElement)) {
      const items = [...el.querySelectorAll<HTMLElement>(ITEMS)].filter(visible);
      const target =
        (isMenu ? items.find((i) => i.getAttribute('aria-checked') === 'true') ?? items[0] : undefined) ??
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible);
      if (target) target.focus({ preventScroll: true });
      else {
        if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
        el.focus({ preventScroll: true });
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && latest.current.onClose) {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (isMenu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const items = [...el.querySelectorAll<HTMLElement>(ITEMS)].filter(visible);
        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
        return;
      }
      if (e.key === 'Tab' && latest.current.trap) {
        const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
        if (!f.length) return e.preventDefault();
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      // the popup is going away: give focus back to its opener, unless it has moved on
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || el.contains(now))) opener.focus({ preventScroll: true });
    };
    // runs once per popup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** A popup element (menu or non-modal dialog) with the focus behaviour above. */
export const Popup = forwardRef<HTMLDivElement, { role: 'menu' | 'dialog'; label: string; className?: string; style?: CSSProperties; onClose?: () => void; trap?: boolean; autoFocus?: boolean; children: ReactNode; onPointerDown?: (e: ReactPointerEvent) => void }>(
  function Popup({ role, label, className, style, onClose, trap, autoFocus, children, onPointerDown }, outer) {
    const ref = useRef<HTMLDivElement>(null);
    useImperativeHandle(outer, () => ref.current!);
    usePopupFocus(ref, { onClose, trap, autoFocus });
    return (
      <div ref={ref} className={className} style={style} role={role} aria-label={label} onPointerDown={onPointerDown}>
        {children}
      </div>
    );
  },
);
