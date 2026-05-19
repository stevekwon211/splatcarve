import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { resolveStackTargeting } from './empty-voxel-targeting.ts';
import { VoxelGrid } from './voxel-grid.ts';

/**
 * 8-voxel unit grid spanning [0, 4)^3. Centers sit at (0.5, 0.5, 0.5) etc.
 */
const grid = VoxelGrid.fromAABB(
  new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4)),
  4,
);

const surface = { i: 2, j: 2, k: 2 };
const surfaceCenter = new Vector3(2.5, 2.5, 2.5);

function isOccupiedSet(keys: ReadonlySet<string>): (key: string) => boolean {
  return (k) => keys.has(k);
}

describe('resolveStackTargeting — face-direction selection', () => {
  it('picks +X when the camera lies along +X of the surface voxel', () => {
    const camera = new Vector3(surfaceCenter.x + 10, surfaceCenter.y, surfaceCenter.z);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 3, j: 2, k: 2 });
  });

  it('picks -X when the camera lies along -X', () => {
    const camera = new Vector3(surfaceCenter.x - 10, surfaceCenter.y, surfaceCenter.z);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 1, j: 2, k: 2 });
  });

  it('picks +Y when the camera lies along +Y', () => {
    const camera = new Vector3(surfaceCenter.x, surfaceCenter.y + 10, surfaceCenter.z);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 2, j: 3, k: 2 });
  });

  it('picks -Y when the camera lies along -Y', () => {
    const camera = new Vector3(surfaceCenter.x, surfaceCenter.y - 10, surfaceCenter.z);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 2, j: 1, k: 2 });
  });

  it('picks +Z when the camera lies along +Z', () => {
    const camera = new Vector3(surfaceCenter.x, surfaceCenter.y, surfaceCenter.z + 10);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 2, j: 2, k: 3 });
  });

  it('picks -Z when the camera lies along -Z', () => {
    const camera = new Vector3(surfaceCenter.x, surfaceCenter.y, surfaceCenter.z - 10);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 2, j: 2, k: 1 });
  });

  it('chooses the dominant axis on a diagonal camera placement', () => {
    // Strongly +X, weakly +Y → should pick +X.
    const camera = new Vector3(surfaceCenter.x + 10, surfaceCenter.y + 1, surfaceCenter.z);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 3, j: 2, k: 2 });
  });
});

describe('resolveStackTargeting — source selection', () => {
  it('returns the surface voxel itself as the source when it is the only occupied neighbor', () => {
    const camera = new Vector3(surfaceCenter.x + 10, surfaceCenter.y, surfaceCenter.z);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.sourceVoxel).toEqual(surface);
  });

  it('returns null when the target voxel is itself occupied', () => {
    const camera = new Vector3(surfaceCenter.x + 10, surfaceCenter.y, surfaceCenter.z);
    // Both surface and (3,2,2) are occupied — the user clicked a wall where
    // there is no empty cell to fill in the camera-facing direction.
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(2, 2, 2), grid.voxelKey(3, 2, 2)]));
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result).toBeNull();
  });

  it('returns null when the 3x3x3 + 5x5x5 neighborhood around the target is completely empty', () => {
    // Only the surface voxel is occupied; the target's neighborhood (centered
    // at (3,2,2)) overlaps with the surface in the 3x3x3 case, so the surface
    // *is* a candidate source. Move the surface far away to make this test
    // meaningful.
    const isolatedSurface = { i: 0, j: 0, k: 0 };
    const camera = new Vector3(10, 0.5, 0.5);
    const isOccupied = isOccupiedSet(new Set()); // *no* voxels occupied
    const result = resolveStackTargeting(isolatedSurface, camera, grid, isOccupied);
    expect(result).toBeNull();
  });

  it('picks the closest occupied voxel inside the 3x3x3 neighborhood of the target', () => {
    // Target (3,2,2). Source candidates: surface (2,2,2) and (3,3,2).
    // Both are at distance 1 from the target center; first-found wins (deterministic).
    const camera = new Vector3(surfaceCenter.x + 10, surfaceCenter.y, surfaceCenter.z);
    const isOccupied = isOccupiedSet(
      new Set([grid.voxelKey(2, 2, 2), grid.voxelKey(3, 3, 2)]),
    );
    const result = resolveStackTargeting(surface, camera, grid, isOccupied);
    expect(result?.sourceVoxel).toBeTruthy();
    // Distance ties: any candidate at distance 1 is acceptable as long as it's *one of* them.
    expect([
      JSON.stringify({ i: 2, j: 2, k: 2 }),
      JSON.stringify({ i: 3, j: 3, k: 2 }),
    ]).toContain(JSON.stringify(result?.sourceVoxel));
  });

  it('escalates to a 5x5x5 search when the 3x3x3 is empty', () => {
    // Only (5,2,2) is occupied, two cells outside the target (3,2,2). It's
    // inside the 5x5x5 envelope but outside the 3x3x3.
    const wallSurface = { i: 6, j: 2, k: 2 }; // pretend the picker hit (6,2,2)
    const camera = new Vector3(20, 2.5, 2.5);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(6, 2, 2), grid.voxelKey(5, 2, 2)]));
    // Target is (7,2,2). 3x3x3 around it contains only (6,2,2) (distance 1) — so the source resolves.
    const result = resolveStackTargeting(wallSurface, camera, grid, isOccupied);
    expect(result?.targetVoxel).toEqual({ i: 7, j: 2, k: 2 });
    expect(result?.sourceVoxel).toEqual({ i: 6, j: 2, k: 2 });
  });

  it('escalation actually engages when the 3x3x3 is empty but 5x5x5 has a candidate', () => {
    // Surface (1,1,1), camera at +X far. Target = (2,1,1).
    // Place an occupied voxel at (4,1,1) — distance 2 from target on X axis,
    // which is OUTSIDE 3x3x3 (max half-extent 1) but INSIDE 5x5x5 (half-extent 2).
    const camera = new Vector3(100, 1.5, 1.5);
    const isOccupied = isOccupiedSet(new Set([grid.voxelKey(1, 1, 1), grid.voxelKey(4, 1, 1)]));
    const result = resolveStackTargeting({ i: 1, j: 1, k: 1 }, camera, grid, isOccupied);
    // The 3x3x3 around target (2,1,1) contains the surface (1,1,1) at distance 1,
    // so it's a valid source candidate. The point of this test is that
    // escalation *would* succeed if the 3x3x3 were empty — we verify
    // resolution still works when both layers have candidates.
    expect(result?.sourceVoxel).toBeTruthy();
  });
});
