/**
 * Fractional indices for z-order: strings that sort lexicographically (plain code-unit order),
 * with a key always available between any two. Concurrent inserts on two devices may pick the
 * same key; ties are broken by object id, so the order stays deterministic everywhere.
 *
 * The keys are those of rocicorp's fractional-indexing (`generateKeyBetween`): a variable-length
 * integer part (its first character, 'a'–'z' for 2–27 characters and 'A'–'Z' for 27–2, gives its
 * length) followed by an optional base-62 fraction that never ends in '0'. Appending at the top or
 * the bottom increments or decrements the integer, so keys grow logarithmically: every new
 * object goes on top (`CanvasModel.topZ`), and 50,000 strokes still have four-character keys.
 *
 * Keys of the earlier base-36 midpoint scheme (still in development databases) are not valid
 * integers here; they are bounded by the nearest valid key above or below, or, when none fits,
 * split with the plain midpoint, so they keep their order and never make a write fail.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const SMALLEST_INTEGER = 'A' + '0'.repeat(26);

const isDigit = (c: string) => c.length === 1 && DIGITS.includes(c);

/** Midpoint of fractions `a` ('' = 0) and `b` (`null` = 1); requires a < b and no trailing '0'. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b[0];
  return DIGITS[da] + midpoint(a.slice(1), null);
}

function integerLength(head: string): number | null {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  return null;
}

/** Whether `key` is a key of this scheme. */
export function isValidKey(key: string): boolean {
  const n = integerLength(key[0] ?? '');
  if (n === null || key.length < n || key === SMALLEST_INTEGER) return false;
  for (const c of key.slice(1)) if (!isDigit(c)) return false;
  return !(key.length > n && key.endsWith('0'));
}

function incrementInteger(x: string): string | null {
  const head = x[0];
  const digs = x.slice(1).split('');
  for (let i = digs.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d < BASE) {
      digs[i] = DIGITS[d];
      return head + digs.join('');
    }
    digs[i] = '0';
  }
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push('0');
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x: string): string | null {
  const head = x[0];
  const digs = x.slice(1).split('');
  for (let i = digs.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d >= 0) {
      digs[i] = DIGITS[d];
      return head + digs.join('');
    }
    digs[i] = DIGITS[BASE - 1];
  }
  if (head === 'a') return 'Z' + DIGITS[BASE - 1];
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITS[BASE - 1]);
  else digs.pop();
  return h + digs.join('');
}

/** rocicorp's generateKeyBetween, for valid keys with a < b. */
function generate(a: string | null, b: string | null): string {
  if (a === null) {
    if (b === null) return 'a0';
    const ib = b.slice(0, integerLength(b[0])!);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('keyBetween: no key below');
    return res;
  }
  const ia = a.slice(0, integerLength(a[0])!);
  const fa = a.slice(ia.length);
  if (b === null) {
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ib = b.slice(0, integerLength(b[0])!);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error('keyBetween: no key above');
  return i < b ? i : ia + midpoint(fa, null);
}

const nextHead = (h: string) => (h === 'Z' ? 'a' : h === 'z' ? null : String.fromCharCode(h.charCodeAt(0) + 1));
const prevHead = (h: string) => (h === 'a' ? 'Z' : h === 'A' ? null : String.fromCharCode(h.charCodeAt(0) - 1));

/** The smallest-ish valid key above an arbitrary string (a legacy key), or null. */
function validAbove(s: string): string | null {
  const h = s[0];
  const n = integerLength(h);
  if (n === null) return h < 'a' ? 'a0' : null;
  const i = s.slice(0, n).padEnd(n, '0');
  if ([...i.slice(1)].every(isDigit)) {
    if (i > s && i !== SMALLEST_INTEGER) return i;
    return incrementInteger(i);
  }
  const next = nextHead(h);
  return next && next + '0'.repeat(integerLength(next)! - 1);
}

/** A valid key below an arbitrary string (a legacy key), or null. */
function validBelow(s: string): string | null {
  const h = s[0];
  const n = integerLength(h);
  if (n === null) return h > 'z' ? 'z' + DIGITS[BASE - 1].repeat(26) : h > 'Z' ? 'Z' + DIGITS[BASE - 1] : null;
  const i = s.slice(0, n).padEnd(n, '0');
  if ([...i.slice(1)].every(isDigit)) {
    if (s.length > n && i !== SMALLEST_INTEGER) return i;
    const d = decrementInteger(i);
    return d === SMALLEST_INTEGER ? null : d;
  }
  const prev = prevHead(h);
  return prev && prev + DIGITS[BASE - 1].repeat(integerLength(prev)! - 1);
}

/** A key strictly between `a` and `b` (`null` = open end). Requires a < b. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);
  const lo = a === null || isValidKey(a) ? a : validAbove(a);
  const hi = b === null || isValidKey(b) ? b : validBelow(b);
  if ((a === null || lo !== null) && (b === null || hi !== null) && (lo === null || hi === null || lo < hi)) {
    // a legacy bound was replaced by a valid key just inside it, which is itself a fine answer
    if (lo !== a && (hi === null || lo! < hi)) return lo!;
    if (hi !== b && lo === null) return hi!;
    return generate(lo, hi);
  }
  // legacy keys with no valid key between them: split them as plain fractions
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
