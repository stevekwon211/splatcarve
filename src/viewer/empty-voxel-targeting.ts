import { Vector3 } from 'three';

import type { VoxelGrid, VoxelIndex } from './voxel-grid.ts';

export interface StackTargeting {
  /** The empty voxel that the user's stack click should fill. */
  targetVoxel: VoxelIndex;
  /** The occupied voxel whose splat cluster should be copied into `targetVoxel`. */
  sourceVoxel: VoxelIndex;
}

/**
 * Resolves a stack-mode click against the picker's first-surface voxel and the
 * camera position (mesh-local).
 *
 * - `targetVoxel` is the empty voxel adjacent to `surfaceVoxel` along the
 *   camera-facing axis. Six choices (±X, ±Y, ±Z); the axis with the largest
 *   component of `camera - surfaceCenter` wins. Returns `null` if that
 *   adjacent voxel is itself occupied — the user is trying to stack onto
 *   existing material.
 * - `sourceVoxel` is the nearest occupied voxel within a 3×3×3 neighborhood
 *   of the target. If empty, the search escalates to 5×5×5. Returns `null`
 *   if both layers turn up no occupied candidate.
 *
 * Pure module: no Spark, no UI. Inputs are the surface voxel index (from the
 * existing `findFirstSurfaceVoxel` ray-march), the camera position (in the
 * grid's frame — see `splat.ts` for why that's mesh-local), the grid
 * (for `voxelKey` + `voxelToWorldCenter`), and an `isOccupied(key)` predicate
 * that the caller composes from `VoxelHash.splatsIn` + `StackedSplatsHash`.
 */
export function resolveStackTargeting(
  surfaceVoxel: VoxelIndex,
  cameraLocal: Vector3,
  grid: VoxelGrid,
  isOccupied: (key: string) => boolean,
): StackTargeting | null {
  const surfaceCenter = scratchSurfaceCenter;
  grid.voxelToWorldCenter(surfaceVoxel.i, surfaceVoxel.j, surfaceVoxel.k, surfaceCenter);

  const dir = pickFaceDirection(cameraLocal, surfaceCenter);
  const targetVoxel: VoxelIndex = {
    i: surfaceVoxel.i + dir.di,
    j: surfaceVoxel.j + dir.dj,
    k: surfaceVoxel.k + dir.dk,
  };

  if (isOccupied(grid.voxelKey(targetVoxel.i, targetVoxel.j, targetVoxel.k))) {
    return null;
  }

  const source3 = findNearestOccupied(targetVoxel, 1, grid, isOccupied);
  if (source3) return { targetVoxel, sourceVoxel: source3 };

  const source5 = findNearestOccupied(targetVoxel, 2, grid, isOccupied);
  if (source5) return { targetVoxel, sourceVoxel: source5 };

  return null;
}

/* -------------------------------------------------------------------------- */

interface FaceDirection {
  di: number;
  dj: number;
  dk: number;
}

const scratchSurfaceCenter = new Vector3();

function pickFaceDirection(cameraLocal: Vector3, surfaceCenter: Vector3): FaceDirection {
  const dx = cameraLocal.x - surfaceCenter.x;
  const dy = cameraLocal.y - surfaceCenter.y;
  const dz = cameraLocal.z - surfaceCenter.z;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);

  if (ax >= ay && ax >= az) return { di: dx >= 0 ? 1 : -1, dj: 0, dk: 0 };
  if (ay >= az) return { di: 0, dj: dy >= 0 ? 1 : -1, dk: 0 };
  return { di: 0, dj: 0, dk: dz >= 0 ? 1 : -1 };
}

/**
 * Linear scan over a `(2r+1)^3` neighborhood centered on `target`. Returns the
 * first occupied voxel found at the smallest L∞ distance; ties broken by
 * iteration order (deterministic but unspecified).
 */
function findNearestOccupied(
  target: VoxelIndex,
  radius: number,
  grid: VoxelGrid,
  isOccupied: (key: string) => boolean,
): VoxelIndex | null {
  let best: VoxelIndex | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (let di = -radius; di <= radius; di++) {
    for (let dj = -radius; dj <= radius; dj++) {
      for (let dk = -radius; dk <= radius; dk++) {
        if (di === 0 && dj === 0 && dk === 0) continue;
        const i = target.i + di;
        const j = target.j + dj;
        const k = target.k + dk;
        const key = grid.voxelKey(i, j, k);
        if (!isOccupied(key)) continue;
        const distSq = di * di + dj * dj + dk * dk;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { i, j, k };
        }
      }
    }
  }

  return best;
}
