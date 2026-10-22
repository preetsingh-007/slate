import { describe, expect, it } from 'vitest';
import { compareZ, isValidKey, keyAfter, keyBefore, keyBetween } from './zindex';

describe('zindex (C15)', () => {
  it('C15: generates keys between any two keys', () => {
    const keys = [keyAfter(null)];
    for (let i = 0; i < 200; i++) keys.push(keyAfter(keys[keys.length - 1]));
    for (let i = 0; i < 200; i++) keys.unshift(keyBefore(keys[0]));
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1] < keys[i]).toBe(true);
      const mid = keyBetween(keys[i - 1], keys[i]);
      expect(keys[i - 1] < mid && mid < keys[i]).toBe(true);
      expect(isValidKey(mid)).toBe(true);
    }
  });

  it('C3: 50,000 objects added on top or at the bottom keep short keys', () => {
    let top: string | null = null;
    let bottom: string | null = null;
    let total = 0;
    for (let i = 0; i < 50_000; i++) {
      const t = keyAfter(top);
      const b = keyBefore(bottom);
      if (top !== null) expect(t > top).toBe(true);
      if (bottom !== null) expect(b < bottom).toBe(true);
      top = t;
      bottom = b;
      total += t.length;
    }
    expect(top!.length).toBeLessThanOrEqual(6);
    expect(bottom!.length).toBeLessThanOrEqual(6);
    expect(total / 50_000).toBeLessThan(5);
  });

  it('C15: repeated inserts at one place stay ordered and grow slowly', () => {
    const lo = keyAfter(null);
    let hi = keyAfter(lo);
    for (let i = 0; i < 1000; i++) {
      const k = keyBetween(lo, hi);
      expect(lo < k && k < hi).toBe(true);
      hi = k;
    }
    expect(hi.length).toBeLessThan(200);
    // random inserts keep a total order
    const keys: string[] = [keyAfter(null)];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 2000; i++) {
      const j = Math.floor(rnd() * (keys.length + 1));
      const k = keyBetween(keys[j - 1] ?? null, keys[j] ?? null);
      keys.splice(j, 0, k);
    }
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
  });

  it('C15: keys of the earlier scheme still get keys above, below and between them', () => {
    const legacy = ['0i', 'i', 'ii', 'r', 'v', 'z', 'zi', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzi'];
    for (const k of legacy) {
      expect(keyAfter(k) > k).toBe(true);
      expect(keyBefore(k) < k).toBe(true);
    }
    for (let i = 1; i < legacy.length; i++) {
      const m = keyBetween(legacy[i - 1], legacy[i]);
      expect(legacy[i - 1] < m && m < legacy[i]).toBe(true);
    }
    const mixed = keyBetween('a5', 'i');
    expect('a5' < mixed && mixed < 'i').toBe(true);
    expect(isValidKey(keyAfter('zi'))).toBe(true);
  });

  it('C15: ties are broken by id', () => {
    expect(compareZ({ z: 'a1', id: 'b' }, { z: 'a1', id: 'a' })).toBe(1);
    expect(compareZ({ z: 'a0', id: 'b' }, { z: 'a1', id: 'a' })).toBe(-1);
  });
});
