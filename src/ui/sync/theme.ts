/**
 * Applies the device theme preference: `document.documentElement.dataset.theme` now, and
 * `localStorage['slate-theme']` so `public/theme.js` applies it before the first paint next time.
 */
import type { DevicePrefs } from '../../core/stores/settings';

export function resolveTheme(theme: DevicePrefs['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: DevicePrefs['theme']) {
  try {
    localStorage.setItem('slate-theme', theme);
  } catch {
    // private mode: the theme still applies for this session
  }
  document.documentElement.dataset.theme = resolveTheme(theme);
}
