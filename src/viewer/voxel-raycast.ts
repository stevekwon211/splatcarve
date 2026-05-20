import type { Vector3 } from 'three';

import type { VoxelGrid, VoxelIndex } from './voxel-grid.ts';

export type VoxelFace = 'pos-x' | 'neg-x' | 'pos-y' | 'neg-y' | 'pos-z' | 'neg-z' | 'inside';

export interface CrosshairHit {
  /** The first occupied voxel the ray intersects. */
  hitVoxel: VoxelIndex;
  /** Which face of `hitVoxel` the ray entered through (for place-block adjacency). */
  hitFace: VoxelFace;
  /** Empty voxel adjacent to `hitVoxel` on the side the ray came from — the cell a "place block" op should fill. */
  prevEmptyVoxel: VoxelIndex;
}

export interface CastInput {
  /** Ray origin in the voxel grid's frame (mesh-local for splatcarve). */
  origin: Vector3;
  /** Ray direction; need not be normalized — internal math is reach-based, not time-based. */
  direction: Vector3;
  /** Maximum world-space distance the ray walks before giving up. */
  maxReach: number;
  grid: VoxelGrid;
  isOccupied: (key: string) => boolean;
}

/**
 * Wave G.2 — Amanatides & Woo "Fast Voxel Traversal" raycast.
 *
 * Walks the voxel grid cell-by-cell along `direction`, returning the first
 * occupied voxel within `maxReach` along with the face the ray entered
 * through and the previously-traversed (empty) voxel — that's the cell
 * the place-block op fills.
 *
 * Reference: J. Amanatides and A. Woo, "A Fast Voxel Traversal Algorithm
 * for Ray Tracing" (Eurographics 1987). Variants of this algorithm power
 * every voxel game's crosshair pick — fenomas/fast-voxel-raycast (MIT) is
 * the JS implementation I cross-checked against.
 */
export function castVoxelRay(input: CastInput): CrosshairHit | null {
  const dir = input.direction;
  const origin = input.origin;
  const grid = input.grid;
  const voxSize = grid.voxelSize;

  // Starting voxel.
  let current: VoxelIndex = grid.worldToVoxel(origin);

  // Degenerate: camera inside a solid cell. Caller decides what to do.
  if (input.isOccupied(grid.voxelKey(current.i, current.j, current.k))) {
    return { hitVoxel: current, hitFace: 'inside', prevEmptyVoxel: current };
  }

  // Step direction per axis (+1 / -1; 0 only if the direction component is exactly 0).
  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  // tDelta[axis]: distance along the ray (in world units along `dir`'s
  // magnitude) to advance one full voxel on that axis. Infinite if the
  // direction component is zero.
  const tDeltaX = stepX !== 0 ? Math.abs(voxSize / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(voxSize / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(voxSize / dir.z) : Infinity;

  // tMax[axis]: distance to the first voxel boundary along the ray.
  const cellMinX = grid.origin.x + current.i * voxSize;
  const cellMinY = grid.origin.y + current.j * voxSize;
  const cellMinZ = grid.origin.z + current.k * voxSize;
  const nextBoundaryX = stepX > 0 ? cellMinX + voxSize : cellMinX;
  const nextBoundaryY = stepY > 0 ? cellMinY + voxSize : cellMinY;
  const nextBoundaryZ = stepZ > 0 ? cellMinZ + voxSize : cellMinZ;
  let tMaxX = stepX !== 0 ? (nextBoundaryX - origin.x) / dir.x : Infinity;
  let tMaxY = stepY !== 0 ? (nextBoundaryY - origin.y) / dir.y : Infinity;
  let tMaxZ = stepZ !== 0 ? (nextBoundaryZ - origin.z) / dir.z : Infinity;

  // The ray walks parameter `t`; the world-space distance traveled is
  // `t * |dir|`. We compare `t` to `maxReach / |dir|`.
  const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (dirLen === 0) return null;
  const maxT = input.maxReach / dirLen;

  // Step until we either hit an occupied cell or exceed maxReach.
  const HARD_STEP_CAP = 1024;
  for (let step = 0; step < HARD_STEP_CAP; step++) {
    let face: VoxelFace;
    let t: number;

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      if (tMaxX > maxT) return null;
      t = tMaxX;
      current = { i: current.i + stepX, j: current.j, k: current.k };
      face = stepX > 0 ? 'neg-x' : 'pos-x';
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      if (tMaxY > maxT) return null;
      t = tMaxY;
      current = { i: current.i, j: current.j + stepY, k: current.k };
      face = stepY > 0 ? 'neg-y' : 'pos-y';
      tMaxY += tDeltaY;
    } else {
      if (tMaxZ > maxT) return null;
      t = tMaxZ;
      current = { i: current.i, j: current.j, k: current.k + stepZ };
      face = stepZ > 0 ? 'neg-z' : 'pos-z';
      tMaxZ += tDeltaZ;
    }

    if (input.isOccupied(grid.voxelKey(current.i, current.j, current.k))) {
      const prev: VoxelIndex = {
        i: face === 'neg-x' ? current.i - 1 : face === 'pos-x' ? current.i + 1 : current.i,
        j: face === 'neg-y' ? current.j - 1 : face === 'pos-y' ? current.j + 1 : current.j,
        k: face === 'neg-z' ? current.k - 1 : face === 'pos-z' ? current.k + 1 : current.k,
      };
      return { hitVoxel: current, hitFace: face, prevEmptyVoxel: prev };
    }

    // (t is the parameter where this step CROSSED into `current`; we
    // continue checking the next boundary)
    void t;
  }

  return null;
}
