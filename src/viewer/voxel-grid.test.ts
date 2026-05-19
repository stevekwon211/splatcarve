import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { VoxelGrid } from './voxel-grid.ts';

describe('VoxelGrid.fromAABB', () => {
  it('produces uniform voxelSize for a cube AABB with resolution 4', () => {
    const aabb = new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4));
    const grid = VoxelGrid.fromAABB(aabb, 4);

    expect(grid.voxelSize).toBeCloseTo(1);
    expect(grid.counts).toEqual({ x: 4, y: 4, z: 4 });
  });

  it('keeps voxelSize uniform across non-cube AABBs, with resolution on the longest axis', () => {
    const aabb = new Box3(new Vector3(0, 0, 0), new Vector3(8, 4, 2));
    const grid = VoxelGrid.fromAABB(aabb, 4);

    expect(grid.voxelSize).toBeCloseTo(2);
    expect(grid.counts).toEqual({ x: 4, y: 2, z: 1 });
  });

  it('clamps zero-extent axes to a count of 1 without dividing by zero', () => {
    const aabb = new Box3(new Vector3(0, 0, 0), new Vector3(4, 0, 4));
    const grid = VoxelGrid.fromAABB(aabb, 4);

    expect(grid.counts.y).toBe(1);
    expect(Number.isFinite(grid.voxelSize)).toBe(true);
  });

  it('rejects non-positive or non-integer resolution', () => {
    const aabb = new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4));

    expect(() => VoxelGrid.fromAABB(aabb, 0)).toThrow();
    expect(() => VoxelGrid.fromAABB(aabb, -3)).toThrow();
    expect(() => VoxelGrid.fromAABB(aabb, 1.5)).toThrow();
  });

  it('rejects an inverted AABB', () => {
    const inverted = new Box3(new Vector3(1, 1, 1), new Vector3(0, 0, 0));
    expect(() => VoxelGrid.fromAABB(inverted, 4)).toThrow();
  });
});

describe('VoxelGrid.worldToVoxel', () => {
  const aabb = new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2));
  const grid = VoxelGrid.fromAABB(aabb, 4);

  it('maps the AABB min corner to (0,0,0)', () => {
    expect(grid.worldToVoxel(new Vector3(-2, -2, -2))).toEqual({ i: 0, j: 0, k: 0 });
  });

  it('maps a point inside the first voxel to (0,0,0)', () => {
    expect(grid.worldToVoxel(new Vector3(-1.5, -1.5, -1.5))).toEqual({ i: 0, j: 0, k: 0 });
  });

  it('moves to (1,0,0) one voxel past the min on the x axis', () => {
    expect(grid.worldToVoxel(new Vector3(-1, -2, -2))).toEqual({ i: 1, j: 0, k: 0 });
  });

  it('returns out-of-bounds indices for the AABB max corner (exclusive upper)', () => {
    expect(grid.worldToVoxel(new Vector3(2, 2, 2))).toEqual({ i: 4, j: 4, k: 4 });
  });
});

describe('VoxelGrid.voxelKey', () => {
  const grid = VoxelGrid.fromAABB(new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1)), 1);

  it('produces a deterministic, pipe-separated string', () => {
    expect(grid.voxelKey(0, 0, 0)).toBe('0|0|0');
    expect(grid.voxelKey(-1, 2, 3)).toBe('-1|2|3');
  });
});

describe('VoxelGrid.voxelToWorldCenter', () => {
  const aabb = new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4));
  const grid = VoxelGrid.fromAABB(aabb, 4);

  it('returns the geometric center of the requested voxel', () => {
    const c = grid.voxelToWorldCenter(0, 0, 0);
    expect(c.x).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
    expect(c.z).toBeCloseTo(0.5);
  });

  it('round-trips with worldToVoxel for every in-bounds voxel', () => {
    for (let i = 0; i < grid.counts.x; i++) {
      for (let j = 0; j < grid.counts.y; j++) {
        for (let k = 0; k < grid.counts.z; k++) {
          const center = grid.voxelToWorldCenter(i, j, k);
          expect(grid.worldToVoxel(center)).toEqual({ i, j, k });
        }
      }
    }
  });

  it('writes into the provided output Vector3 without allocating', () => {
    const out = new Vector3();
    const result = grid.voxelToWorldCenter(2, 2, 2, out);
    expect(result).toBe(out);
    expect(out.x).toBeCloseTo(2.5);
    expect(out.y).toBeCloseTo(2.5);
    expect(out.z).toBeCloseTo(2.5);
  });
});

describe('VoxelGrid.contains', () => {
  const grid = VoxelGrid.fromAABB(new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4)), 4);

  it('returns true for in-bounds indices', () => {
    expect(grid.contains(0, 0, 0)).toBe(true);
    expect(grid.contains(3, 3, 3)).toBe(true);
  });

  it('returns false for indices outside the counts in any axis', () => {
    expect(grid.contains(-1, 0, 0)).toBe(false);
    expect(grid.contains(4, 0, 0)).toBe(false);
    expect(grid.contains(0, 4, 0)).toBe(false);
    expect(grid.contains(0, 0, 4)).toBe(false);
  });
});
