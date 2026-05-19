import { Color, Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  StackOp,
  StackOpCapacityError,
  type PackedSplatsWriter,
  type SplatParams,
  type StackOpInput,
  type StackSlotPool,
  type StackedSplatsHashWriter,
} from './stack-op.ts';

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

interface CapturedWrite {
  slotIdx: number;
  center: { x: number; y: number; z: number };
  scales: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  opacity: number;
  color: { r: number; g: number; b: number };
}

class FakeWriter implements PackedSplatsWriter {
  /** Pre-populated splat database read by readSplat. */
  readonly sources = new Map<number, SplatParams>();
  /** Every setSplat in order. */
  writes: CapturedWrite[] = [];

  setSource(index: number, params: Partial<SplatParams>): void {
    this.sources.set(index, {
      center: params.center ?? new Vector3(),
      scales: params.scales ?? new Vector3(1, 1, 1),
      quaternion: params.quaternion ?? new Quaternion(),
      opacity: params.opacity ?? 1,
      color: params.color ?? new Color(1, 1, 1),
    });
  }

  readSplat(index: number, out?: SplatParams): SplatParams {
    const src = this.sources.get(index);
    if (!src) throw new Error(`FakeWriter: no source for index ${index}`);
    const target =
      out ?? {
        center: new Vector3(),
        scales: new Vector3(),
        quaternion: new Quaternion(),
        opacity: 0,
        color: new Color(),
      };
    target.center.copy(src.center);
    target.scales.copy(src.scales);
    target.quaternion.copy(src.quaternion);
    target.opacity = src.opacity;
    target.color.copy(src.color);
    return target;
  }

  setSplat(
    slotIdx: number,
    center: Vector3,
    scales: Vector3,
    quaternion: Quaternion,
    opacity: number,
    color: Color,
  ): void {
    this.writes.push({
      slotIdx,
      center: { x: center.x, y: center.y, z: center.z },
      scales: { x: scales.x, y: scales.y, z: scales.z },
      quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      opacity,
      color: { r: color.r, g: color.g, b: color.b },
    });
  }
}

class FakePool implements StackSlotPool {
  private next: number;
  private readonly released: number[] = [];
  private readonly capacity: number;
  private acquired = new Set<number>();

  constructor(capacity = 1024, baseSlot = 1000) {
    this.capacity = capacity;
    this.next = baseSlot;
  }

  acquire(): number | null {
    if (this.released.length > 0) {
      const slot = this.released.pop() as number;
      this.acquired.add(slot);
      return slot;
    }
    if (this.acquired.size >= this.capacity) return null;
    const slot = this.next++;
    this.acquired.add(slot);
    return slot;
  }

  release(slotIdx: number): void {
    this.acquired.delete(slotIdx);
    this.released.push(slotIdx);
  }

  get acquiredCount(): number {
    return this.acquired.size;
  }
  get acquiredSlots(): ReadonlyArray<number> {
    return [...this.acquired].sort((a, b) => a - b);
  }
}

class FakeHash implements StackedSplatsHashWriter {
  readonly entries = new Map<string, Set<number>>();
  add(key: string, slot: number): void {
    let set = this.entries.get(key);
    if (!set) {
      set = new Set();
      this.entries.set(key, set);
    }
    set.add(slot);
  }
  remove(key: string, slot: number): void {
    this.entries.get(key)?.delete(slot);
  }
  splatsIn(key: string): ReadonlyArray<number> {
    return [...(this.entries.get(key) ?? [])].sort((a, b) => a - b);
  }
}

/* -------------------------------------------------------------------------- */
/* Test scaffolding                                                            */
/* -------------------------------------------------------------------------- */

function buildInput(overrides: Partial<StackOpInput> = {}): {
  writer: FakeWriter;
  pool: FakePool;
  hash: FakeHash;
  input: StackOpInput;
} {
  const writer = new FakeWriter();
  const pool = new FakePool();
  const hash = new FakeHash();

  // Three source splats centered along the X axis at integer voxels.
  writer.setSource(0, { center: new Vector3(0, 0, 0), color: new Color(1, 0, 0) });
  writer.setSource(1, { center: new Vector3(1, 0, 0), color: new Color(0, 1, 0) });
  writer.setSource(2, { center: new Vector3(2, 0, 0), color: new Color(0, 0, 1) });

  const input: StackOpInput = {
    writer,
    pool,
    stackedHash: hash,
    targetKey: '5|0|0',
    sourceSplatIds: [0, 1, 2],
    translationDeltaLocal: new Vector3(10, 0, 0),
    jitter: { scaleAmp: 0, rotAmpRad: 0, seed: 1 },
    ...overrides,
  };

  return { writer, pool, hash, input };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('StackOp.do', () => {
  let ctx: ReturnType<typeof buildInput>;

  beforeEach(() => {
    ctx = buildInput();
  });

  it('reads every source splat exactly once', () => {
    const op = new StackOp(ctx.input);
    op.do();
    expect(ctx.writer.writes).toHaveLength(3);
  });

  it('writes translated centers (source + translationDeltaLocal) when jitter is zero', () => {
    const op = new StackOp(ctx.input);
    op.do();
    expect(ctx.writer.writes.map((w) => w.center)).toEqual([
      { x: 10, y: 0, z: 0 },
      { x: 11, y: 0, z: 0 },
      { x: 12, y: 0, z: 0 },
    ]);
  });

  it('preserves opacity and color from the source splat', () => {
    const op = new StackOp(ctx.input);
    op.do();
    expect(ctx.writer.writes.map((w) => w.color)).toEqual([
      { r: 1, g: 0, b: 0 },
      { r: 0, g: 1, b: 0 },
      { r: 0, g: 0, b: 1 },
    ]);
    expect(ctx.writer.writes.map((w) => w.opacity)).toEqual([1, 1, 1]);
  });

  it('registers each new slot under the target voxel key', () => {
    const op = new StackOp(ctx.input);
    op.do();
    expect(ctx.hash.splatsIn(ctx.input.targetKey)).toHaveLength(3);
  });

  it('writes nothing on an empty source list', () => {
    const empty = buildInput({ sourceSplatIds: [] });
    const op = new StackOp(empty.input);
    op.do();
    expect(empty.writer.writes).toHaveLength(0);
    expect(empty.pool.acquiredCount).toBe(0);
  });

  it('throws StackOpCapacityError and leaves the pool/hash untouched when capacity runs out', () => {
    const tight = buildInput();
    tight.input.writer = tight.writer;
    // Override the pool to one with capacity 2.
    const smallPool = new FakePool(2);
    const input2: StackOpInput = { ...tight.input, pool: smallPool };

    const op = new StackOp(input2);
    expect(() => op.do()).toThrow(StackOpCapacityError);
    expect(smallPool.acquiredCount).toBe(0);
    expect(tight.hash.entries.size).toBe(0);
    expect(tight.writer.writes).toHaveLength(0);
  });

  it('throws if called twice without an intervening undo', () => {
    const op = new StackOp(ctx.input);
    op.do();
    expect(() => op.do()).toThrow(/already applied/i);
  });
});

describe('StackOp.undo', () => {
  it('zeros opacity on every previously-allocated slot', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.do();
    ctx.writer.writes = [];
    op.undo();
    expect(ctx.writer.writes).toHaveLength(3);
    for (const w of ctx.writer.writes) expect(w.opacity).toBe(0);
  });

  it('releases every slot back to the pool', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.do();
    const acquiredBefore = ctx.pool.acquiredCount;
    op.undo();
    expect(ctx.pool.acquiredCount).toBe(0);
    expect(acquiredBefore).toBe(3);
  });

  it('removes the slot entries from the stacked hash', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.do();
    op.undo();
    expect(ctx.hash.splatsIn(ctx.input.targetKey)).toHaveLength(0);
  });

  it('is a no-op when do() was never called', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.undo();
    expect(ctx.writer.writes).toHaveLength(0);
    expect(ctx.pool.acquiredCount).toBe(0);
  });

  it('is a no-op on a second consecutive undo', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.do();
    op.undo();
    const writesAfterFirstUndo = ctx.writer.writes.length;
    op.undo();
    expect(ctx.writer.writes).toHaveLength(writesAfterFirstUndo);
  });
});

describe('StackOp round-trip', () => {
  it('do -> undo -> do leaves the same hash entries (LIFO pool reuse)', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.do();
    const slotsBefore = ctx.hash.splatsIn(ctx.input.targetKey);
    op.undo();
    op.do();
    const slotsAfter = ctx.hash.splatsIn(ctx.input.targetKey);
    expect(slotsAfter).toEqual(slotsBefore);
  });

  it('do -> undo -> do produces the same scene state (slot reordering is invisible)', () => {
    const ctx = buildInput();
    const op = new StackOp(ctx.input);
    op.do();
    // Group writes by slot index so we can compare without caring about LIFO ordering.
    const stateFromWrites = (writes: typeof ctx.writer.writes): Map<number, unknown> => {
      const out = new Map<number, unknown>();
      for (const w of writes) {
        const { slotIdx, ...rest } = w;
        out.set(slotIdx, rest);
      }
      return out;
    };
    const stateBefore = stateFromWrites(ctx.writer.writes);

    op.undo();
    ctx.writer.writes = [];
    op.do();

    // The slot indices may differ (LIFO reuse), but the *parameters written
    // per slot* must form the same set of (params) values.
    const stateAfter = stateFromWrites(ctx.writer.writes);
    expect([...stateAfter.values()].sort()).toEqual([...stateBefore.values()].sort());
  });
});

describe('StackOp jitter', () => {
  it('is deterministic across two fresh ops with the same seed', () => {
    const a = buildInput({ jitter: { scaleAmp: 0.1, rotAmpRad: 0.05, seed: 42 } });
    const b = buildInput({ jitter: { scaleAmp: 0.1, rotAmpRad: 0.05, seed: 42 } });
    new StackOp(a.input).do();
    new StackOp(b.input).do();
    expect(a.writer.writes.map((w) => w.scales)).toEqual(b.writer.writes.map((w) => w.scales));
    expect(a.writer.writes.map((w) => w.quaternion)).toEqual(
      b.writer.writes.map((w) => w.quaternion),
    );
  });

  it('differs when the seed changes', () => {
    const a = buildInput({ jitter: { scaleAmp: 0.1, rotAmpRad: 0.05, seed: 1 } });
    const b = buildInput({ jitter: { scaleAmp: 0.1, rotAmpRad: 0.05, seed: 2 } });
    new StackOp(a.input).do();
    new StackOp(b.input).do();
    expect(a.writer.writes.map((w) => w.scales)).not.toEqual(
      b.writer.writes.map((w) => w.scales),
    );
  });

  it('respects scaleAmp — jittered scales fall within source * (1 ± amp)', () => {
    const ctx = buildInput({ jitter: { scaleAmp: 0.1, rotAmpRad: 0, seed: 7 } });
    new StackOp(ctx.input).do();
    for (const w of ctx.writer.writes) {
      // Source scale is (1, 1, 1); allowed range is [0.9, 1.1] inclusive.
      for (const v of [w.scales.x, w.scales.y, w.scales.z]) {
        expect(v).toBeGreaterThanOrEqual(0.9);
        expect(v).toBeLessThanOrEqual(1.1);
      }
    }
  });
});
