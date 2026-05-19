import { describe, expect, it } from 'vitest';

import { EditHistory, type EditOp } from './edit-history.ts';

function spyOp(label: string): { op: EditOp; calls: string[] } {
  const calls: string[] = [];
  const op: EditOp = {
    do: (): void => {
      calls.push(`${label}:do`);
    },
    undo: (): void => {
      calls.push(`${label}:undo`);
    },
  };
  return { op, calls };
}

describe('EditHistory', () => {
  it('starts unable to undo or redo', () => {
    const h = new EditHistory();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(0);
  });

  it('records an op without re-running do (caller is responsible for the initial run)', () => {
    const h = new EditHistory();
    const { op, calls } = spyOp('a');
    h.record(op);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(1);
    expect(calls).toEqual([]);
  });

  it('undo calls op.undo and moves the cursor backward', () => {
    const h = new EditHistory();
    const { op, calls } = spyOp('a');
    h.record(op);
    expect(h.undo()).toBe(true);
    expect(calls).toEqual(['a:undo']);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it('redo replays op.do and moves the cursor forward', () => {
    const h = new EditHistory();
    const { op, calls } = spyOp('a');
    h.record(op);
    h.undo();
    expect(h.redo()).toBe(true);
    expect(calls).toEqual(['a:undo', 'a:do']);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('returns false from undo/redo when nothing is available', () => {
    const h = new EditHistory();
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('discards the redo stack when a new op is recorded after an undo', () => {
    const h = new EditHistory();
    const a = spyOp('a');
    const b = spyOp('b');
    h.record(a.op);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.record(b.op);
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(1);
  });

  it('enforces a capacity by evicting oldest ops first', () => {
    const h = new EditHistory(3);
    const ops = [spyOp('a'), spyOp('b'), spyOp('c'), spyOp('d')];
    for (const o of ops) h.record(o.op);
    expect(h.size).toBe(3);
    // First op 'a' should have been evicted; undoing three times should run d, c, b.
    h.undo();
    h.undo();
    h.undo();
    expect(h.canUndo).toBe(false);
    expect(ops[3]!.calls).toEqual(['d:undo']);
    expect(ops[2]!.calls).toEqual(['c:undo']);
    expect(ops[1]!.calls).toEqual(['b:undo']);
    expect(ops[0]!.calls).toEqual([]);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new EditHistory(0)).toThrow();
    expect(() => new EditHistory(-1)).toThrow();
  });

  it('clear() wipes both stacks and disables undo/redo', () => {
    const h = new EditHistory();
    h.record(spyOp('a').op);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
