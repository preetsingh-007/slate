import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../stores/settings';
import type { SyncedSettings } from '../model/types';
import { canvasFile, canvasMetaFromFile, deepEqual, mergeCanvasFile, mergeItemFile, mergeSet3, stableJson } from './json';

describe('JSON files (R2)', () => {
  it('writes deterministic JSON (sorted keys, two-space indent)', () => {
    expect(stableJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{\n  "a": {\n    "d": [\n      2,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n');
    expect(deepEqual({ a: 1, b: [1] }, { b: [1], a: 1 })).toBe(true);
  });

  it('merges sets three ways: additions from both sides, removals from both', () => {
    expect(mergeSet3(['a', 'b', 'c'], ['a', 'c', 'd'], ['a', 'b', 'e'])).toEqual(['a', 'd', 'e']);
    expect(mergeSet3(undefined, ['a'], ['b'])).toEqual(['a', 'b']);
  });

  it('canvas.json merges field by field against the last synced version', () => {
    const base = canvasFile({ id: 'main', slug: 'main', title: 'Main', topics: ['a'], segments: { '2026-09': { x: 0, y: 0, w: 10, h: 10 } } });
    // this device renamed and tagged; the other device tagged and drew in October
    const local = { ...base, title: 'Lectures', topics: ['a', 'b'] };
    const remote = { ...base, topics: ['a', 'c'], segments: { ...base.segments, '2026-10': { x: 0, y: 100, w: 5, h: 5 } } };
    expect(mergeCanvasFile(base, local, remote)).toEqual({
      id: 'main',
      title: 'Lectures',
      topics: ['a', 'b', 'c'],
      segments: { '2026-09': { x: 0, y: 0, w: 10, h: 10 }, '2026-10': { x: 0, y: 100, w: 5, h: 5 } },
    });
    // both changed the same month's bounds: union
    const l2 = { ...base, segments: { '2026-09': { x: 0, y: 0, w: 20, h: 10 } } };
    const r2 = { ...base, segments: { '2026-09': { x: -5, y: 0, w: 10, h: 30 } } };
    expect(mergeCanvasFile(base, l2, r2).segments['2026-09']).toEqual({ x: -5, y: 0, w: 25, h: 30 });
    // only the remote changed the title: the remote wins
    expect(mergeCanvasFile(base, base, { ...base, title: 'Remote' }).title).toBe('Remote');
    expect(canvasMetaFromFile('main', { title: 'X' })).toEqual({ id: 'main', slug: 'main', title: 'X', topics: [], segments: {} });
  });

  it('book.json and meta.json merge field by field; both changed: this device wins', () => {
    const base = { id: 'b', title: 'T', year: 2000, topics: ['x'] };
    expect(mergeItemFile(base, { ...base, title: 'Local' }, { ...base, year: 2001, topics: ['x', 'y'] })).toEqual({ id: 'b', title: 'Local', year: 2001, topics: ['x', 'y'] });
    expect(mergeItemFile(base, { ...base, title: 'Local' }, { ...base, title: 'Remote' }).title).toBe('Local');
    // a field removed on the other side
    expect(mergeItemFile<Record<string, unknown>>(base, base, { id: 'b', title: 'T', topics: ['x'] })).toEqual({ id: 'b', title: 'T', topics: ['x'] });
  });
});

describe('settings.json (R11)', () => {
  const pos = (sourceId: string, updated: number, device: string) => ({ sourceId, locator: { type: 'scroll' as const, fraction: updated / 100 }, updated, device });

  it('newest settings win; reading positions and pane state merge by their own times', () => {
    const a: SyncedSettings = { ...DEFAULT_SETTINGS, colors: ['#111111'], readingPositions: { b1: pos('b1', 10, 'a'), b2: pos('b2', 50, 'a') }, updated: 100 };
    const b: SyncedSettings = {
      ...DEFAULT_SETTINGS,
      colors: ['#222222'],
      readingPositions: { b1: pos('b1', 20, 'b'), b3: pos('b3', 5, 'b') },
      panes: { tabs: [{ kind: 'todos' }], active: 0, divider: 0.5, swapped: false, updated: 30, device: 'b' },
      updated: 90,
    };
    const m = mergeSettings(a, b);
    expect(m.colors).toEqual(['#111111']);
    expect(m.readingPositions.b1.device).toBe('b');
    expect(Object.keys(m.readingPositions).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(m.panes?.device).toBe('b');
    expect(mergeSettings(b, a)).toEqual(m);
  });
});
