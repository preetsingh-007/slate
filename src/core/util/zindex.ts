/**
 * Fractional indices for z-order: strings that sort lexicographically, with a key always
 * available between any two. Concurrent inserts on two devices may pick the same key; ties
 * are broken by object id, so the order stays deterministic everywhere.
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/**
 * Midpoint of `a` ('' = lowest) and `b` (`null` = highest), as in rocicorp's
 * fractional-indexing. Keys never end in '0', so a key below any key always exists.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (db - da > 1) return DIGITS[(da + db) >> 1];
  if (b !== null && b.length > 1) return b[0];
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** A key strictly between `a` and `b` (`null` = open end). Requires a < b. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  return midpoint(a ?? '', b);
}

/** A key above `max`. */
export function keyAfter(max: string | null): string {
  return keyBetween(max, null);
}

/** A key below `min`. */
export function keyBefore(min: string | null): string {
  return keyBetween(null, min);
}

/** Comparator for objects with z and id. */
export function compareZ(a: { z: string; id: string }, b: { z: string; id: string }): number {
  return a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
