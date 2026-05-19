import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { VoxelGrid } from './voxel-grid.ts';
import {
  VoxelHash,
  type ForEachSplatCenter,
  type ForEachSplatCoverage,
} from './voxel-hash.ts';

function fromList(
  centers: Array<{ index: number; center: Vector3 }>,
): ForEachSplatCenter {
  return (visit) => {
    for (const { index, center } of centers) visit(index, center);
  };
}

function fromCoverageList(
  items: Array<{ index: number; center: Vector3; radius: number }>,
): ForEachSplatCoverage {
  return (visit) => {
    for (const it of items) visit(it.index, it.center, it.radius);
  };
}

const unitGrid = VoxelGrid.fromAABB(
  new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4)),
  4,
);

describe('VoxelHash.build', () => {
  it('returns an empty hash for an empty source', () => {
    const hash = VoxelHash.build(unitGrid, () => {});

    expect(hash.stats.splatCount).toBe(0);
    expect(hash.stats.voxelCount).toBe(0);
    expect(hash.stats.maxSplatsInAnyVoxel).toBe(0);
    expect(hash.stats.meanSplatsPerVoxel).toBe(0);
  });

  it('places a single splat in the voxel containing its center', () => {
    const hash = VoxelHash.build(
      unitGrid,
      fromList([{ index: 42, center: new Vector3(0.5, 0.5, 0.5) }]),
    );

    expect(hash.stats.splatCount).toBe(1);
    expect(hash.stats.voxelCount).toBe(1);
    expect(hash.splatsIn('0|0|0')).toEqual(new Uint32Array([42]));
    expect(hash.voxelOf(42)).toBe('0|0|0');
  });

  it('groups multiple splats that fall into the same voxel', () => {
    const hash = VoxelHash.build(
      unitGrid,
      fromList([
        { index: 0, center: new Vector3(0.1, 0.1, 0.1) },
        { index: 1, center: new Vector3(0.9, 0.9, 0.9) },
        { index: 2, center: new Vector3(0.5, 0.5, 0.5) },
      ]),
    );

    expect(hash.stats.splatCount).toBe(3);
    expect(hash.stats.voxelCount).toBe(1);
    expect(hash.splatsIn('0|0|0')).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('distributes splats across multiple voxels with correct stats', () => {
    const hash = VoxelHash.build(
      unitGrid,
      fromList([
        { index: 0, center: new Vector3(0.5, 0.5, 0.5) },
        { index: 1, center: new Vector3(1.5, 0.5, 0.5) },
        { index: 2, center: new Vector3(0.5, 1.5, 0.5) },
      ]),
    );

    expect(hash.stats.splatCount).toBe(3);
    expect(hash.stats.voxelCount).toBe(3);
    expect(hash.stats.maxSplatsInAnyVoxel).toBe(1);
    expect(hash.stats.meanSplatsPerVoxel).toBeCloseTo(1);
  });

  it('indexes splats outside the AABB into out-of-range voxel keys without dropping them', () => {
    const hash = VoxelHash.build(
      unitGrid,
      fromList([
        { index: 0, center: new Vector3(-1, 0.5, 0.5) },
        { index: 1, center: new Vector3(5, 0.5, 0.5) },
      ]),
    );

    expect(hash.stats.splatCount).toBe(2);
    expect(hash.stats.voxelCount).toBe(2);
    expect(hash.splatsIn('-1|0|0')).toEqual(new Uint32Array([0]));
    expect(hash.splatsIn('5|0|0')).toEqual(new Uint32Array([1]));
  });

  it('computes maxSplatsInAnyVoxel and meanSplatsPerVoxel for heterogeneous occupancy', () => {
    const hash = VoxelHash.build(
      unitGrid,
      fromList([
        { index: 0, center: new Vector3(0.1, 0.1, 0.1) },
        { index: 1, center: new Vector3(0.2, 0.2, 0.2) },
        { index: 2, center: new Vector3(0.3, 0.3, 0.3) },
        { index: 3, center: new Vector3(1.5, 1.5, 1.5) },
        { index: 4, center: new Vector3(1.6, 1.6, 1.6) },
      ]),
    );

    expect(hash.stats.splatCount).toBe(5);
    expect(hash.stats.voxelCount).toBe(2);
    expect(hash.stats.maxSplatsInAnyVoxel).toBe(3);
    expect(hash.stats.meanSplatsPerVoxel).toBeCloseTo(2.5);
  });
});

describe('VoxelHash queries', () => {
  const hash = VoxelHash.build(unitGrid, (visit) => {
    visit(7, new Vector3(0.5, 0.5, 0.5));
  });

  it('returns undefined for empty voxels', () => {
    expect(hash.splatsIn('3|3|3')).toBeUndefined();
  });

  it('returns undefined for unknown splat IDs', () => {
    expect(hash.voxelOf(999)).toBeUndefined();
  });
});

describe('VoxelHash.buildCoverage', () => {
  it('places a zero-radius splat only in its center voxel', () => {
    const h = VoxelHash.buildCoverage(
      unitGrid,
      fromCoverageList([{ index: 0, center: new Vector3(0.5, 0.5, 0.5), radius: 0 }]),
    );
    expect(h.stats.voxelCount).toBe(1);
    expect(h.splatsIn('0|0|0')).toEqual(new Uint32Array([0]));
    expect(h.voxelOf(0)).toBe('0|0|0');
  });

  it('keeps a sub-voxel-radius splat in its center voxel only', () => {
    const h = VoxelHash.buildCoverage(
      unitGrid,
      fromCoverageList([{ index: 0, center: new Vector3(0.5, 0.5, 0.5), radius: 0.3 }]),
    );
    expect(h.stats.voxelCount).toBe(1);
    expect(h.splatsIn('0|0|0')).toEqual(new Uint32Array([0]));
  });

  it('extends a splat to every voxel its AABB overlaps', () => {
    // Center (0.5, 0.5, 0.5) + radius 0.6 → AABB [-0.1, 1.1] on every axis.
    // floor((-0.1) / 1) = -1; floor(1.1 / 1) = 1. So i,j,k ∈ {-1, 0, 1} → 27 voxels.
    const h = VoxelHash.buildCoverage(
      unitGrid,
      fromCoverageList([{ index: 7, center: new Vector3(0.5, 0.5, 0.5), radius: 0.6 }]),
    );
    expect(h.stats.voxelCount).toBe(27);
    expect(h.splatsIn('0|0|0')).toEqual(new Uint32Array([7]));
    expect(h.splatsIn('-1|0|0')).toEqual(new Uint32Array([7]));
    expect(h.splatsIn('1|1|1')).toEqual(new Uint32Array([7]));
  });

  it('exposes the splat in every overlap cell while voxelOf returns just the center cell', () => {
    const h = VoxelHash.buildCoverage(
      unitGrid,
      fromCoverageList([{ index: 5, center: new Vector3(1.5, 0.5, 0.5), radius: 0.6 }]),
    );
    expect(h.voxelOf(5)).toBe('1|0|0');
    // AABB on x is [0.9, 2.1] → x cells {0, 1, 2}. y, z each [-0.1, 1.1] → {-1, 0, 1}.
    // 3 × 3 × 3 = 27 cells. Splat 5 is in every one of them.
    expect(h.splatsIn('0|-1|-1')?.length).toBe(1);
    expect(h.splatsIn('2|1|1')?.length).toBe(1);
  });

  it('groups multiple splats whose coverage overlaps the same voxel', () => {
    const h = VoxelHash.buildCoverage(
      unitGrid,
      fromCoverageList([
        { index: 0, center: new Vector3(0.5, 0.5, 0.5), radius: 0 },
        { index: 1, center: new Vector3(1.5, 0.5, 0.5), radius: 0.6 },
      ]),
    );
    const at000 = h.splatsIn('0|0|0');
    expect(at000?.length).toBe(2);
    expect(Array.from(at000 as Uint32Array).sort()).toEqual([0, 1]);
  });

  it('produces an empty hash from an empty source', () => {
    const h = VoxelHash.buildCoverage(unitGrid, () => {});
    expect(h.stats.voxelCount).toBe(0);
    expect(h.stats.splatCount).toBe(0);
  });
});
