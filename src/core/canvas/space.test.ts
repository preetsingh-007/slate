import { describe, expect, it } from 'vitest';
import type { Rect } from '../model/types';
import { applySpace, computeSpace, dominantAxis, type SpaceItem } from './space';
import { mulberry32 } from '../ink/testing/synth';

const item = (id: string, x: number, y: number, w: number, h: number): SpaceItem => ({ id, rect: { x, y, w, h } });
const VIEW: Rect = { x: 0, y: 0, w: 1000, h: 1000 };

function overlap(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('C4 local space insertion: scope', () => {
  const items = [
    item('above', 100, 100, 100, 100), // wholly before the split, in view
    item('below', 100, 600, 100, 100), // wholly after, in view
    item('crossing', 400, 450, 100, 100), // crosses the split
    item('farBelow', 100, 1300, 100, 100), // outside the view
    item('farAbove', 100, -400, 100, 100),
    item('right', 1200, 600, 100, 100), // outside, to the side
  ];

  it('moves only visible objects wholly on one side, each with its finger', () => {
    const plan = computeSpace({ items, visible: VIEW, axis: 'y', split: 500, before: -50, after: 120 });
    expect(Object.fromEntries(plan.moves)).toEqual({ above: -50, below: 120 });
    expect(plan.beforeIds).toEqual(['above']);
    expect(plan.afterIds).toEqual(['below']);
  });

  it('works horizontally', () => {
    const plan = computeSpace({ items, visible: VIEW, axis: 'x', split: 300, before: 0, after: 80 });
    // crossing (400–500) is wholly after x=300; above and below are wholly before
    expect(Object.fromEntries(plan.moves)).toEqual({ crossing: 80 });
  });

  it('picks the dominant axis of the movement', () => {
    expect(dominantAxis(3, 40)).toBe('y');
    expect(dominantAxis(-50, 10)).toBe('x');
  });
});

describe('C4 local space insertion: push-through', () => {
  it('pushes outside objects a moved object would run into, repeating until nothing overlaps', () => {
    const view = { x: 0, y: 0, w: 1000, h: 700 };
    const items = [
      item('b', 100, 600, 100, 90), // after side, in view
      item('d', 120, 720, 60, 40), // outside, in b's way
      item('f', 150, 765, 40, 35), // outside, in d's way
      item('g', 2000, 720, 60, 40), // outside, not in the way
      item('h', 300, 800, 50, 50), // outside, beside the column of b
    ];
    const plan = computeSpace({ items, visible: view, axis: 'y', split: 500, before: 0, after: 100 });
    expect(Object.fromEntries(plan.moves)).toEqual({ b: 100, d: 100, f: 100 });
    expect(plan.pushedIds.sort()).toEqual(['d', 'f']);
    const after = applySpace(items, plan, 'y');
    for (let i = 0; i < after.length; i++) for (let j = i + 1; j < after.length; j++) expect(overlap(after[i].rect, after[j].rect)).toBe(false);
  });

  it('an object moving far past an outside object still pushes it (swept area)', () => {
    const view = { x: 0, y: 0, w: 1000, h: 700 };
    const items = [item('m', 0, 600, 100, 10), item('o', 0, 750, 100, 10)];
    const plan = computeSpace({ items, visible: view, axis: 'y', split: 500, before: 0, after: 400 });
    expect(plan.moves.get('o')).toBe(400);
  });

  it('does not push objects that already overlapped (ink on an image off screen)', () => {
    const view = { x: 0, y: 0, w: 1000, h: 700 };
    const items = [item('m', 0, 600, 100, 150), item('o', 0, 720, 100, 10)];
    const plan = computeSpace({ items, visible: view, axis: 'y', split: 500, before: 0, after: 50 });
    expect(plan.moves.has('o')).toBe(false);
  });
});

describe('C4 local space removal', () => {
  it('both sides close in until 8 units apart', () => {
    const items = [item('a', 100, 200, 100, 100), item('b', 100, 400, 100, 100)];
    const plan = computeSpace({ items, visible: VIEW, axis: 'y', split: 350, before: 100, after: -100 });
    expect(plan.moves.get('a')! + -plan.moves.get('b')!).toBeCloseTo(92);
    const [a, b] = applySpace(items, plan, 'y');
    expect(b.rect.y - (a.rect.y + a.rect.h)).toBeCloseTo(8);
  });

  it('stops 8 units from a crossing object', () => {
    const items = [item('c', 0, 450, 100, 100), item('b', 50, 600, 100, 50)];
    const plan = computeSpace({ items, visible: VIEW, axis: 'y', split: 500, before: 0, after: -100 });
    expect(plan.moves.get('b')).toBeCloseTo(-42);
    expect(plan.moves.has('c')).toBe(false);
  });

  it('stops 8 units from an object outside the view and never pushes it', () => {
    const items = [item('out', -300, 100, 250, 600), item('b', -40, 300, 100, 50)];
    const plan = computeSpace({ items, visible: VIEW, axis: 'x', split: -45, before: 0, after: -100 });
    expect(plan.moves.get('b')).toBeCloseTo(-(-40 - -50 - 8));
    expect(plan.moves.has('out')).toBe(false);
  });

  it('is not blocked by objects beside the path', () => {
    const items = [item('a', 0, 0, 100, 100), item('b', 500, 400, 100, 100)];
    const plan = computeSpace({ items, visible: VIEW, axis: 'y', split: 300, before: 0, after: -150 });
    expect(plan.moves.get('b')).toBe(-150);
  });

  it('an object already within 8 units of an obstacle cannot close in further', () => {
    const items = [item('c', 0, 480, 100, 40), item('b', 0, 524, 100, 40)];
    const plan = computeSpace({ items, visible: VIEW, axis: 'y', split: 500, before: 0, after: -60 });
    expect(plan.moves.size).toBe(0);
    expect(plan.after).toBe(0);
  });

  it('never creates an overlap (randomised)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed);
      const items: SpaceItem[] = [];
      for (let i = 0; i < 40; i++) items.push(item(`o${i}`, rng() * 1600 - 300, rng() * 1600 - 300, 20 + rng() * 150, 20 + rng() * 150));
      const axis = seed % 2 ? 'y' : 'x';
      const split = 300 + rng() * 400;
      const insert = seed % 3 === 0;
      const before = insert ? -rng() * 300 : rng() * 300;
      const after = insert ? rng() * 300 : -rng() * 300;
      const plan = computeSpace({ items, visible: VIEW, axis, split, before, after });
      const moved = applySpace(items, plan, axis);
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (overlap(items[i].rect, items[j].rect)) continue;
          expect(overlap(moved[i].rect, moved[j].rect), `seed ${seed}: ${items[i].id} × ${items[j].id}`).toBe(false);
        }
      }
    }
  });
});
