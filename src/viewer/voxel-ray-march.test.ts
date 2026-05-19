import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { findFirstSurfaceVoxel } from './voxel-ray-march.ts';
import { VoxelGrid } from './voxel-grid.ts';
import { VoxelHash } from './voxel-hash.ts';

/**
 * 4×4×4 unit grid with origin at (0, 0, 0), voxelSize=1.
 */
function makeUnitGrid(): VoxelGrid {
  return VoxelGrid.fromAABB(new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4)), 4);
}

/**
 * Build a VoxelHash containing splat-center records at the given voxel indices.
 * Each voxel gets one synthetic splat at the voxel's geometric center.
 */
function hashAtVoxels(grid: VoxelGrid, voxels: Array<[number, number, number]>): VoxelHash {
  const centerCache = new Vector3();
  let nextId = 0;
  return VoxelHash.build(grid, (visit) => {
    for (const [i, j, k] of voxels) {
      grid.voxelToWorldCenter(i, j, k, centerCache);
      visit(nextId++, centerCache);
    }
  });
}

describe('findFirstSurfaceVoxel', () => {
  const grid = makeUnitGrid();
  const dirX = new Vector3(1, 0, 0);
  const never = (): boolean => false;

  it('returns the voxel under the start point when it has splats and is not carved', () => {
    const hash = hashAtVoxels(grid, [[1, 1, 1]]);
    const start = grid.voxelToWorldCenter(1, 1, 1, new Vector3());

    const hit = findFirstSurfaceVoxel(grid, start, dirX, hash, never);
    expect(hit).toEqual({ i: 1, j: 1, k: 1 });
  });

  it('marches forward when the start voxel is empty', () => {
    const hash = hashAtVoxels(grid, [[3, 1, 1]]);
    const start = grid.voxelToWorldCenter(0, 1, 1, new Vector3());

    const hit = findFirstSurfaceVoxel(grid, start, dirX, hash, never);
    expect(hit).toEqual({ i: 3, j: 1, k: 1 });
  });

  it('skips carved voxels even when they have splats', () => {
    const hash = hashAtVoxels(grid, [
      [1, 1, 1],
      [3, 1, 1],
    ]);
    const start = grid.voxelToWorldCenter(1, 1, 1, new Vector3());
    const carved = (key: string): boolean => key === '1|1|1';

    const hit = findFirstSurfaceVoxel(grid, start, dirX, hash, carved);
    expect(hit).toEqual({ i: 3, j: 1, k: 1 });
  });

  it('returns null when nothing un-carved is found in maxSteps', () => {
    const hash = hashAtVoxels(grid, [[1, 1, 1]]);
    const start = grid.voxelToWorldCenter(1, 1, 1, new Vector3());
    const allCarved = (): boolean => true;

    const hit = findFirstSurfaceVoxel(grid, start, dirX, hash, allCarved);
    expect(hit).toBeNull();
  });

  it('respects the maxSteps cap', () => {
    const hash = hashAtVoxels(grid, [[3, 1, 1]]);
    const start = grid.voxelToWorldCenter(0, 1, 1, new Vector3());

    // Only step once → won't reach (3,1,1).
    const hit = findFirstSurfaceVoxel(grid, start, dirX, hash, never, 1);
    expect(hit).toBeNull();
  });

  it('rejects a non-normalized or zero-direction safely', () => {
    const hash = hashAtVoxels(grid, [[2, 2, 2]]);
    const start = new Vector3(0, 0, 0);
    expect(findFirstSurfaceVoxel(grid, start, new Vector3(0, 0, 0), hash, never)).toBeNull();
  });
});
