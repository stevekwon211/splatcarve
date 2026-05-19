import { describe, expect, it } from 'vitest';

import { CarveOperation } from './carve-operation.ts';
import type { SplatMutator } from './splat-mutator.ts';

class FakeMutator implements SplatMutator {
  readonly opacities: Map<number, number>;
  commits = 0;

  constructor(initial: ReadonlyMap<number, number>) {
    this.opacities = new Map(initial);
  }

  getOpacity(index: number): number {
    const v = this.opacities.get(index);
    if (v === undefined) throw new Error(`FakeMutator: unknown splat ${index}`);
    return v;
  }

  setOpacity(index: number, opacity: number): void {
    if (!this.opacities.has(index)) {
      throw new Error(`FakeMutator: unknown splat ${index}`);
    }
    this.opacities.set(index, opacity);
  }

  commit(): void {
    this.commits++;
  }
}

describe('CarveOperation', () => {
  it('snapshots original opacities and zeroes them on do()', () => {
    const m = new FakeMutator(
      new Map([
        [10, 0.8],
        [11, 0.5],
        [12, 0.9],
      ]),
    );
    const op = CarveOperation.snapshot(m, [10, 12]);
    op.do();

    expect(m.getOpacity(10)).toBe(0);
    expect(m.getOpacity(11)).toBe(0.5);
    expect(m.getOpacity(12)).toBe(0);
    expect(m.commits).toBe(1);
  });

  it('restores original opacities on undo()', () => {
    const m = new FakeMutator(
      new Map([
        [10, 0.8],
        [11, 0.5],
        [12, 0.9],
      ]),
    );
    const op = CarveOperation.snapshot(m, [10, 12]);
    op.do();
    op.undo();

    expect(m.getOpacity(10)).toBeCloseTo(0.8);
    expect(m.getOpacity(11)).toBeCloseTo(0.5);
    expect(m.getOpacity(12)).toBeCloseTo(0.9);
    expect(m.commits).toBe(2);
  });

  it('round-trips do/undo/do/undo without drift', () => {
    const m = new FakeMutator(
      new Map([
        [0, 0.42],
        [1, 0.71],
      ]),
    );
    const op = CarveOperation.snapshot(m, [0, 1]);
    op.do();
    op.undo();
    op.do();
    op.undo();
    expect(m.getOpacity(0)).toBeCloseTo(0.42);
    expect(m.getOpacity(1)).toBeCloseTo(0.71);
  });

  it('reports the splat IDs it affects', () => {
    const m = new FakeMutator(new Map([[5, 0.5]]));
    const op = CarveOperation.snapshot(m, [5]);
    expect(op.affectedSplatIds).toEqual(new Uint32Array([5]));
  });

  it('is a no-op (single commit) when the splat list is empty', () => {
    const m = new FakeMutator(new Map());
    const op = CarveOperation.snapshot(m, []);
    op.do();
    op.undo();
    expect(m.commits).toBe(2);
  });

  it('does not double-snapshot when do() is called after undo() (replay path)', () => {
    const m = new FakeMutator(
      new Map([
        [0, 0.6],
        [1, 0.7],
      ]),
    );
    const op = CarveOperation.snapshot(m, [0, 1]);
    op.do();
    op.undo();
    // External code mutates opacity between undo and the next do (shouldn't matter —
    // the snapshot is fixed at construction time).
    m.setOpacity(0, 0.9);
    op.do();
    op.undo();
    // After undo, opacity 0 must be back to the original 0.6 — NOT 0.9.
    expect(m.getOpacity(0)).toBeCloseTo(0.6);
    expect(m.getOpacity(1)).toBeCloseTo(0.7);
  });
});
