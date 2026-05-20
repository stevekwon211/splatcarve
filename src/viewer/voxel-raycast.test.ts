import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { castVoxelRay } from './voxel-raycast.ts';
import { VoxelGrid } from './voxel-grid.ts';

// Unit grid 10×10×10 with 1 m cells.
const grid = VoxelGrid.fromAABB(new Box3(new Vector3(0, 0, 0), new Vector3(10, 10, 10)), 10);

function occ(...keys: string[]): (k: string) => boolean {
  const s = new Set(keys);
  return (k) => s.has(k);
}

describe('castVoxelRay', () => {
  it('returns null when no occupied cell is within reach', () => {
    const r = castVoxelRay({
      origin: new Vector3(5, 5, 5),
      direction: new Vector3(1, 0, 0),
      maxReach: 3,
      grid,
      isOccupied: () => false,
    });
    expect(r).toBeNull();
  });

  it('hits the first occupied cell along +X with the correct face and prev cell', () => {
    // Origin at world (5.5, 5.5, 5.5) is inside voxel (5,5,5). Wall at (8,5,5).
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(1, 0, 0),
      maxReach: 10,
      grid,
      isOccupied: occ('8|5|5'),
    });
    expect(r).not.toBeNull();
    expect(r?.hitVoxel).toEqual({ i: 8, j: 5, k: 5 });
    expect(r?.hitFace).toBe('neg-x');
    expect(r?.prevEmptyVoxel).toEqual({ i: 7, j: 5, k: 5 });
  });

  it('hits along +Y with face neg-y', () => {
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(0, 1, 0),
      maxReach: 10,
      grid,
      isOccupied: occ('5|8|5'),
    });
    expect(r?.hitFace).toBe('neg-y');
    expect(r?.prevEmptyVoxel).toEqual({ i: 5, j: 7, k: 5 });
  });

  it('hits along +Z with face neg-z', () => {
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(0, 0, 1),
      maxReach: 10,
      grid,
      isOccupied: occ('5|5|8'),
    });
    expect(r?.hitFace).toBe('neg-z');
    expect(r?.prevEmptyVoxel).toEqual({ i: 5, j: 5, k: 7 });
  });

  it('hits along -X with face pos-x', () => {
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(-1, 0, 0),
      maxReach: 10,
      grid,
      isOccupied: occ('2|5|5'),
    });
    expect(r?.hitVoxel).toEqual({ i: 2, j: 5, k: 5 });
    expect(r?.hitFace).toBe('pos-x');
    expect(r?.prevEmptyVoxel).toEqual({ i: 3, j: 5, k: 5 });
  });

  it('respects maxReach — wall beyond reach is not hit', () => {
    // Wall at i=9 is 3.5 voxel-widths away; maxReach=2 → too far.
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(1, 0, 0),
      maxReach: 2,
      grid,
      isOccupied: occ('9|5|5'),
    });
    expect(r).toBeNull();
  });

  it('skips empty cells in between and hits the first occupied one', () => {
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(1, 0, 0),
      maxReach: 10,
      grid,
      isOccupied: occ('8|5|5', '9|5|5'),
    });
    expect(r?.hitVoxel).toEqual({ i: 8, j: 5, k: 5 });
  });

  it('reports the starting voxel as hit when the camera is inside an occupied cell', () => {
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(1, 0, 0),
      maxReach: 10,
      grid,
      isOccupied: occ('5|5|5'),
    });
    // Inside-the-solid case is degenerate but should at least not crash.
    expect(r?.hitVoxel).toEqual({ i: 5, j: 5, k: 5 });
  });

  it('walks a diagonal ray and selects the correct axis at each step', () => {
    // 45° in XZ plane: dir = (1, 0, 1) normalised. From (5.5, 5.5, 5.5).
    // First boundary on either axis is at t = 0.5 / (1/sqrt(2)) = 0.707…
    // Walls at +X (i=7) and +Z (i=7) on the chosen plane — the ray hits
    // whichever axis tMax tags first. With ties, the +X half-step wins
    // (X has the same tMax as Z; the algorithm picks X first deterministically).
    const r = castVoxelRay({
      origin: new Vector3(5.5, 5.5, 5.5),
      direction: new Vector3(1, 0, 1).normalize(),
      maxReach: 10,
      grid,
      isOccupied: occ('7|5|6'),
    });
    expect(r).not.toBeNull();
    // The path before hitting (7,5,6) walks (5,5,5)→(6,5,5)→(6,5,6)→(7,5,6) or
    // similar; either way the hit voxel must be the wall.
    expect(r?.hitVoxel).toEqual({ i: 7, j: 5, k: 6 });
  });
});
