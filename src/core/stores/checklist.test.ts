import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addItem, addItemAfter, moveItem, parseChecklist, removeItem, setChecked, setItemText } from './checklist';
import { checklistText, readChecklist } from './todo';

const doc = (text = '') => {
  const d = new Y.Doc();
  if (text) checklistText(d).insert(0, text);
  return d;
};
const items = (d: Y.Doc) => readChecklist(d).map((i) => `${i.checked ? 'x' : ' '} ${i.text}`);
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe('To-dos page checklist (G4)', () => {
  it('adds items at the end and after an item (Enter)', () => {
    const d = doc();
    const t = checklistText(d);
    expect(addItem(t, 'buy chalk')).toBe(0);
    addItem(t, 'email TA');
    expect(addItemAfter(t, 0, 'read 5A')).toBe(1);
    expect(t.toString()).toBe('- [ ] buy chalk\n- [ ] read 5A\n- [ ] email TA\n');
    expect(items(d)).toEqual(['  buy chalk', '  read 5A', '  email TA']);
  });

  it('checks, edits, removes and reorders with minimal edits', () => {
    const d = doc('- [ ] a\n- [ ] b\n- [ ] c');
    const t = checklistText(d);
    setChecked(t, 1, true);
    expect(t.toString()).toBe('- [ ] a\n- [x] b\n- [ ] c');
    setItemText(t, 0, 'alpha\nline');
    expect(items(d)[0]).toBe('  alpha line');
    moveItem(t, 0, 2);
    expect(items(d)).toEqual(['x b', '  c', '  alpha line']);
    expect(t.toString()).toBe('- [x] b\n- [ ] c\n- [ ] alpha line\n');
    moveItem(t, 2, 0);
    expect(items(d)).toEqual(['  alpha line', 'x b', '  c']);
    removeItem(t, 2);
    removeItem(t, 0);
    expect(t.toString()).toBe('- [x] b\n');
    removeItem(t, 0);
    expect(t.toString()).toBe('');
  });

  it('keeps lines that are not tasks and reads `* [X]` and numbered items', () => {
    const d = doc('# heading\n* [X] one\n\n1. [ ] two\nnote');
    expect(items(d)).toEqual(['x one', '  two']);
    removeItem(checklistText(d), 0);
    expect(checklistText(d).toString()).toBe('# heading\n\n1. [ ] two\nnote');
  });

  it('merges concurrent edits from two devices with nothing lost', () => {
    const a = doc('- [ ] shared one\n- [ ] shared two\n');
    const b = new Y.Doc();
    sync(a, b);
    const ta = checklistText(a);
    const tb = checklistText(b);
    addItem(ta, 'from A');
    addItem(tb, 'from B');
    setChecked(ta, 0, true);
    setItemText(tb, 0, 'shared one, edited');
    removeItem(tb, 1);
    sync(a, b);
    expect(ta.toString()).toBe(tb.toString());
    expect(items(a).sort()).toEqual(['  from A', '  from B', 'x shared one, edited'].sort());
  });

  it('reads a double toggle merge as checked and repairs the box on the next toggle', () => {
    const a = doc('- [ ] x\n');
    const b = new Y.Doc();
    sync(a, b);
    setChecked(checklistText(a), 0, true);
    setChecked(checklistText(b), 0, true);
    sync(a, b);
    expect(parseChecklist(checklistText(a).toString())[0].checked).toBe(true);
    setChecked(checklistText(a), 0, false);
    expect(checklistText(a).toString()).toBe('- [ ] x\n');
  });
});
