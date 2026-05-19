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
 * - `targetVoxel` candidates are the three camera-facing axis neighbors of
 *   `surfaceVoxel`, ordered by alignment with the view ray. The first
 *   candidate whose cell is empty AND whose neighborhood has at least one
 *   occupied voxel wins.
 * - `sourceVoxel` is the nearest occupied voxel within a 3×3×3 neighborhood
 *   of the chosen target. If empty, the search escalates to 5×5×5.
 * - Returns `null` only when all three preferred axes are blocked OR the
 *   ambient neighborhood is completely empty.
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

  const directions = orderedFaceDirections(cameraLocal, surfaceCenter);

  for (const dir of directions) {
    const targetVoxel: VoxelIndex = {
      i: surfaceVoxel.i + dir.di,
      j: surfaceVoxel.j + dir.dj,
      k: surfaceVoxel.k + dir.dk,
    };
    if (isOccupied(grid.voxelKey(targetVoxel.i, targetVoxel.j, targetVoxel.k))) continue;

    const source3 = findNearestOccupied(targetVoxel, 1, grid, isOccupied);
    if (source3) return { targetVoxel, sourceVoxel: source3 };
    const source5 = findNearestOccupied(targetVoxel, 2, grid, isOccupied);
    if (source5) return { targetVoxel, sourceVoxel: source5 };
  }

  return null;
}

/* -------------------------------------------------------------------------- */

interface FaceDirection {
  di: number;
  dj: number;
  dk: number;
}

const scratchSurfaceCenter = new Vector3();

/**
 * Returns the three camera-facing axis neighbors of `surfaceCenter`, sorted by
 * alignment with the view direction (dominant axis first). Stack mode tries
 * them in order so a blocked dominant face falls back to the second-best face
 * rather than dropping the ghost entirely.
 */
function orderedFaceDirections(cameraLocal: Vector3, surfaceCenter: Vector3): FaceDirection[] {
  const dx = cameraLocal.x - surfaceCenter.x;
  const dy = cameraLocal.y - surfaceCenter.y;
  const dz = cameraLocal.z - surfaceCenter.z;

  const axes: Array<{ mag: number; dir: FaceDirection }> = [
    { mag: Math.abs(dx), dir: { di: dx >= 0 ? 1 : -1, dj: 0, dk: 0 } },
    { mag: Math.abs(dy), dir: { di: 0, dj: dy >= 0 ? 1 : -1, dk: 0 } },
    { mag: Math.abs(dz), dir: { di: 0, dj: 0, dk: dz >= 0 ? 1 : -1 } },
  ];
  axes.sort((a, b) => b.mag - a.mag);
  return axes.map((a) => a.dir);
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
