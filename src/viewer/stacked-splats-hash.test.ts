import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { StackedSplatsHash } from './stacked-splats-hash.ts';
import { VoxelGrid } from './voxel-grid.ts';
import { VoxelHash } from './voxel-hash.ts';

const unitGrid = VoxelGrid.fromAABB(
  new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4)),
  4,
);

describe('StackedSplatsHash', () => {
  it('starts empty', () => {
    const h = new StackedSplatsHash();
    expect(h.splatsIn('0|0|0')).toEqual([]);
    expect(h.size).toBe(0);
  });

  it('add() then splatsIn() returns the splat ID', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    expect(h.splatsIn('0|0|0')).toEqual([1000]);
  });

  it('add() merges multiple IDs into the same voxel key', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    h.add('0|0|0', 1001);
    h.add('0|0|0', 1002);
    expect(h.splatsIn('0|0|0')).toEqual([1000, 1001, 1002]);
  });

  it('add() ignores duplicate (key, slot) pairs', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    h.add('0|0|0', 1000);
    expect(h.splatsIn('0|0|0')).toEqual([1000]);
  });

  it('remove() drops a specific slot from a voxel', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    h.add('0|0|0', 1001);
    h.remove('0|0|0', 1000);
    expect(h.splatsIn('0|0|0')).toEqual([1001]);
  });

  it('remove() of an absent slot is a no-op', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    h.remove('0|0|0', 9999);
    h.remove('9|9|9', 1000);
    expect(h.splatsIn('0|0|0')).toEqual([1000]);
  });

  it('size reflects the number of voxel keys with at least one stacked slot', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    h.add('1|0|0', 1001);
    expect(h.size).toBe(2);
    h.remove('1|0|0', 1001);
    expect(h.size).toBe(1);
  });

  it('clear() removes all entries', () => {
    const h = new StackedSplatsHash();
    h.add('0|0|0', 1000);
    h.add('1|0|0', 1001);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.splatsIn('0|0|0')).toEqual([]);
  });
});

describe('StackedSplatsHash.unionedSplatsIn', () => {
  it('returns just the base hash entries when no slots have been stacked', () => {
    const base = VoxelHash.build(unitGrid, (visit) => {
      visit(7, new Vector3(0.5, 0.5, 0.5));
      visit(8, new Vector3(0.6, 0.5, 0.5));
    });
    const stacked = new StackedSplatsHash();
    const union = stacked.unionedSplatsIn('0|0|0', base);
    expect(union).toEqual(new Uint32Array([7, 8]));
  });

  it('returns just the stacked slots when the base voxel is empty', () => {
    const base = VoxelHash.build(unitGrid, () => {});
    const stacked = new StackedSplatsHash();
    stacked.add('0|0|0', 1000);
    stacked.add('0|0|0', 1001);
    const union = stacked.unionedSplatsIn('0|0|0', base);
    expect(union).toEqual(new Uint32Array([1000, 1001]));
  });

  it('concatenates base then stacked when both contribute', () => {
    const base = VoxelHash.build(unitGrid, (visit) => {
      visit(7, new Vector3(0.5, 0.5, 0.5));
    });
    const stacked = new StackedSplatsHash();
    stacked.add('0|0|0', 1000);
    const union = stacked.unionedSplatsIn('0|0|0', base);
    expect(union).toEqual(new Uint32Array([7, 1000]));
  });

  it('returns an empty array for a voxel with no contributions', () => {
    const base = VoxelHash.build(unitGrid, () => {});
    const stacked = new StackedSplatsHash();
    const union = stacked.unionedSplatsIn('9|9|9', base);
    expect(union).toEqual(new Uint32Array());
  });
});
