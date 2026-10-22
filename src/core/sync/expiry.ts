/**
 * Token expiry (R4): GitHub reports a fine-grained token's expiry in the
 * `github-authentication-token-expiration` response header, e.g. `2026-11-04 10:00:00 UTC`
 * or `2026-11-04 10:00:00 -0700`. Slate warns 14 days ahead.
 */

export const EXPIRY_HEADER = 'github-authentication-token-expiration';
export const EXPIRY_WARNING_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** Parses the header value; null when it is missing or malformed. */
export function parseTokenExpiry(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(UTC|GMT|Z|[+-]\d{2}:?\d{2})?$/i.exec(value.trim());
  if (!m) return null;
  let zone = (m[3] ?? 'Z').toUpperCase();
  if (zone === 'UTC' || zone === 'GMT') zone = 'Z';
  else if (zone !== 'Z' && !zone.includes(':')) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}${zone}`);
  return Number.isFinite(t) ? t : null;
}

export interface ExpiryState {
  /** days left (rounded down); negative when expired */
  daysLeft: number;
  expired: boolean;
  /** within the warning window (R4: 14 days ahead) */
  warn: boolean;
}

export function expiryState(expiry: number | undefined | null, now = Date.now()): ExpiryState | null {
  if (!expiry) return null;
  const left = expiry - now;
  return { daysLeft: Math.floor(left / DAY), expired: left <= 0, warn: left <= EXPIRY_WARNING_DAYS * DAY };
}

/** Text for the warning, e.g. "Your GitHub token expires in 5 days (4 Nov 2026)." */
export function expiryMessage(expiry: number, now = Date.now()): string {
  const s = expiryState(expiry, now)!;
  const date = new Date(expiry).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (s.expired) return `Your GitHub token expired on ${date}. Create a new one to keep syncing.`;
  if (s.daysLeft < 1) return `Your GitHub token expires today (${date}).`;
  return `Your GitHub token expires in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} (${date}).`;
}
