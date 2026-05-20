import { Color, Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeCubePrefab } from './block-prefab.ts';
import { PlaceBlockOp, PlaceBlockCapacityError, type PlaceBlockInput } from './place-block-op.ts';
import { StackSlotPool } from './stack-slot-pool.ts';
import { StackedSplatsHash } from './stacked-splats-hash.ts';
import type { PackedSplatsWriter, SplatParams } from './stack-op.ts';

interface CapturedWrite {
  slotIdx: number;
  center: { x: number; y: number; z: number };
  opacity: number;
  color: { r: number; g: number; b: number };
}

class FakeWriter implements PackedSplatsWriter {
  writes: CapturedWrite[] = [];
  readSplat(_index: number, out?: SplatParams): SplatParams {
    return (
      out ?? {
        center: new Vector3(),
        scales: new Vector3(),
        quaternion: new Quaternion(),
        opacity: 0,
        color: new Color(),
      }
    );
  }
  setSplat(
    slotIdx: number,
    center: Vector3,
    _scales: Vector3,
    _quaternion: Quaternion,
    opacity: number,
    color: Color,
  ): void {
    this.writes.push({
      slotIdx,
      center: { x: center.x, y: center.y, z: center.z },
      opacity,
      color: { r: color.r, g: color.g, b: color.b },
    });
  }
}

const VOXEL_SIZE = 1;
const CELL_CENTER = new Vector3(5.5, 5.5, 5.5); // centre of voxel (5,5,5)

function buildInput(overrides: Partial<PlaceBlockInput> = {}): {
  writer: FakeWriter;
  pool: StackSlotPool;
  hash: StackedSplatsHash;
  input: PlaceBlockInput;
} {
  const writer = new FakeWriter();
  const pool = new StackSlotPool({ baseSlot: 1000, capacity: 1024 });
  const hash = new StackedSplatsHash();
  const input: PlaceBlockInput = {
    writer,
    pool,
    stackedHash: hash,
    targetKey: '5|5|5',
    targetCenter: CELL_CENTER.clone(),
    prefab: makeCubePrefab(VOXEL_SIZE, new Color(0.5, 0.6, 0.7)),
    ...overrides,
  };
  return { writer, pool, hash, input };
}

describe('PlaceBlockOp.do', () => {
  let ctx: ReturnType<typeof buildInput>;
  beforeEach(() => {
    ctx = buildInput();
  });

  it('writes one slot per prefab splat (27 for the default cube)', () => {
    const op = new PlaceBlockOp(ctx.input);
    op.do();
    expect(ctx.writer.writes).toHaveLength(27);
  });

  it('writes each splat at targetCenter + prefab.centerOffset', () => {
    const op = new PlaceBlockOp(ctx.input);
    op.do();
    // The first prefab splat has offset (-1/3, -1/3, -1/3) × voxelSize.
    const offset0 = ctx.input.prefab[0]!.centerOffset;
    expect(ctx.writer.writes[0]!.center.x).toBeCloseTo(CELL_CENTER.x + offset0.x, 6);
    expect(ctx.writer.writes[0]!.center.y).toBeCloseTo(CELL_CENTER.y + offset0.y, 6);
    expect(ctx.writer.writes[0]!.center.z).toBeCloseTo(CELL_CENTER.z + offset0.z, 6);
  });

  it('uses the prefab color and opacity', () => {
    const op = new PlaceBlockOp(ctx.input);
    op.do();
    for (const w of ctx.writer.writes) {
      expect(w.color.r).toBeCloseTo(0.5, 5);
      expect(w.color.g).toBeCloseTo(0.6, 5);
      expect(w.color.b).toBeCloseTo(0.7, 5);
      expect(w.opacity).toBe(1);
    }
  });

  it('registers every acquired slot in the stacked hash under targetKey', () => {
    const op = new PlaceBlockOp(ctx.input);
    op.do();
    expect(ctx.hash.splatsIn('5|5|5')).toHaveLength(27);
  });

  it('throws PlaceBlockCapacityError and rolls back when the pool runs out mid-op', () => {
    const tightPool = new StackSlotPool({ baseSlot: 1000, capacity: 10 });
    const input: PlaceBlockInput = { ...ctx.input, pool: tightPool };
    const op = new PlaceBlockOp(input);
    expect(() => op.do()).toThrow(PlaceBlockCapacityError);
    expect(tightPool.acquiredCount).toBe(0);
    expect(ctx.hash.size).toBe(0);
    expect(ctx.writer.writes).toHaveLength(0);
  });

  it('throws on double-do without an intervening undo', () => {
    const op = new PlaceBlockOp(ctx.input);
    op.do();
    expect(() => op.do()).toThrow(/already applied/i);
  });
});

describe('PlaceBlockOp.undo', () => {
  it('zeros opacity on every placed slot and releases them back to the pool', () => {
    const ctx = buildInput();
    const op = new PlaceBlockOp(ctx.input);
    op.do();
    ctx.writer.writes = [];
    op.undo();
    expect(ctx.writer.writes).toHaveLength(27);
    for (const w of ctx.writer.writes) expect(w.opacity).toBe(0);
    expect(ctx.pool.acquiredCount).toBe(0);
    expect(ctx.hash.splatsIn('5|5|5')).toHaveLength(0);
  });

  it('is a no-op when do() was never called', () => {
    const ctx = buildInput();
    const op = new PlaceBlockOp(ctx.input);
    op.undo();
    expect(ctx.writer.writes).toHaveLength(0);
  });
});
