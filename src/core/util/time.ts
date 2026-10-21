/** Calendar helpers. Dates are device-local `YYYY-MM-DD`; months are `YYYY-MM`. */

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(t: number | Date = Date.now()): string {
  const d = typeof t === 'number' ? new Date(t) : t;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoMonth(t: number | Date = Date.now()): string {
  return isoDate(t).slice(0, 7);
}

/** UTC timestamp `2026-10-21T14:03:00Z` (seconds precision) for front matter. */
export function isoDateTime(t: number): string {
  return new Date(Math.floor(t / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, delta: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day-line label, e.g. "Tue 21 Oct 2026". */
export function dayLabel(date: string): string {
  const d = parseDate(date);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Months from `from` to `to` inclusive (`YYYY-MM`). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
