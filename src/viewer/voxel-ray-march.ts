import { Vector3 } from 'three';

import type { VoxelGrid, VoxelIndex } from './voxel-grid.ts';
import type { VoxelHash } from './voxel-hash.ts';

// Module-scoped scratch. `findFirstSurfaceVoxel` runs on every pointermove
// and walks up to `maxSteps` iterations; reusing these avoids one Vector3
// allocation per call (and a per-iteration multiply chain) on the hot path.
const scratchPos = new Vector3();

/**
 * Minecraft-style voxel ray-march. Starts at `origin` and walks along `dir`,
 * returning the first voxel that has at least one splat (per `centerHash`)
 * AND is not flagged carved (per `isCarved(key)`).
 *
 * Used by the picker to bypass already-carved cells so the cursor lands on
 * the next visible surface beyond a hole, rather than sticking on the cell
 * the user already excavated.
 *
 * `dir` is expected to be normalized. A zero direction returns `null` to
 * keep the caller safe from NaN-fueled infinite walks.
 *
 * Step size is half a voxel — small enough to never skip a 1-voxel-thick
 * cell, conservative enough to terminate quickly. Worst case is
 * `maxSteps` iterations (~100 by default), which for typical scenes covers
 * the entire grid diagonal.
 */
export function findFirstSurfaceVoxel(
  grid: VoxelGrid,
  origin: Vector3,
  dir: Vector3,
  centerHash: VoxelHash,
  isCarved: (key: string) => boolean,
  maxSteps = 100,
): VoxelIndex | null {
  const dirLengthSq = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z;
  if (dirLengthSq === 0) return null;

  const stepScale = (grid.voxelSize * 0.5) / Math.sqrt(dirLengthSq);
  scratchPos.copy(origin);

  let lastKey = '';
  for (let n = 0; n < maxSteps; n++) {
    const idx = grid.worldToVoxel(scratchPos);
    const key = grid.voxelKey(idx.i, idx.j, idx.k);
    if (key !== lastKey) {
      const splats = centerHash.splatsIn(key);
      if (splats && splats.length > 0 && !isCarved(key)) {
        return idx;
      }
      lastKey = key;
    }
    scratchPos.addScaledVector(dir, stepScale);
  }
  return null;
}
