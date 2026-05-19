import type { Vector3 } from 'three';

import type { VoxelGrid } from './voxel-grid.ts';

/**
 * Callback shape produced by Spark's `PackedSplats.forEachSplat` (after we discard
 * the parameters we don't need for hashing).
 *
 * Designed as the unit of input so the hash builder can be tested without a real SplatMesh.
 */
export type ForEachSplatCenter = (visit: (index: number, center: Vector3) => void) => void;

/**
 * Like {@link ForEachSplatCenter} but also reports a bounding-sphere radius around
 * each splat's center. Used by {@link VoxelHash.buildCoverage} to register a splat
 * in every voxel its 3σ ellipsoid AABB intersects, not just the one containing its
 * center. The carve pipeline reads from this hash to avoid wispy holes caused by
 * neighbor splats whose ellipsoid extends into the target voxel.
 */
export type ForEachSplatCoverage = (
  visit: (index: number, center: Vector3, radius: number) => void,
) => void;

export interface VoxelHashStats {
  splatCount: number;
  voxelCount: number;
  maxSplatsInAnyVoxel: number;
  meanSplatsPerVoxel: number;
}

/**
 * Maps each splat to the voxel cell containing its center `μ`.
 *
 * - The world state remains the splat array. This hash is an *invisible* index.
 * - Splats whose center lies outside the grid's AABB are still indexed — they end up
 *   under voxel keys that fail `VoxelGrid.contains`, which is the caller's signal to
 *   ignore them or to expand the grid.
 *
 * Splat IDs are stored per-voxel as `Uint32Array` for compact iteration during
 * later wave operations (carve = lookup splats in a voxel; stack = clone splats
 * from a neighboring voxel).
 */
export class VoxelHash {
  readonly grid: VoxelGrid;
  readonly stats: VoxelHashStats;

  private readonly cells: ReadonlyMap<string, Uint32Array>;
  private readonly splatToCell: ReadonlyMap<number, string>;

  private constructor(
    grid: VoxelGrid,
    cells: ReadonlyMap<string, Uint32Array>,
    splatToCell: ReadonlyMap<number, string>,
    stats: VoxelHashStats,
  ) {
    this.grid = grid;
    this.cells = cells;
    this.splatToCell = splatToCell;
    this.stats = stats;
  }

  static build(grid: VoxelGrid, source: ForEachSplatCenter): VoxelHash {
    const cellsBuilder = new Map<string, number[]>();
    const splatToCell = new Map<number, string>();
    let splatCount = 0;

    source((index, center) => {
      const { i, j, k } = grid.worldToVoxel(center);
      const key = grid.voxelKey(i, j, k);
      pushUnique(cellsBuilder, key, index);
      splatToCell.set(index, key);
      splatCount++;
    });

    return VoxelHash.finalize(grid, cellsBuilder, splatToCell, splatCount);
  }

  /**
   * Conservative variant: each splat is registered in every voxel its bounding
   * sphere AABB overlaps. `voxelOf(splatId)` still returns the splat's *center*
   * voxel — the canonical "home" cell. `splatsIn(key)` is the set of splats whose
   * ellipsoid touches that cell, which is the right set for a clean carve.
   *
   * Memory cost grows with average coverage. For a Spark scene with median splat
   * scale ≈ voxelSize / 6, expected coverage is ~1 voxel per splat (so this hash
   * is roughly the same size as the center-only hash). For large splats it can
   * grow up to ~K³ voxels per splat, where K ≈ 6σ / voxelSize.
   */
  static buildCoverage(grid: VoxelGrid, source: ForEachSplatCoverage): VoxelHash {
    const cellsBuilder = new Map<string, number[]>();
    const splatToCell = new Map<number, string>();
    let splatCount = 0;

    const { x: ox, y: oy, z: oz } = grid.origin;
    const vs = grid.voxelSize;

    source((index, center, radius) => {
      const centerIdx = grid.worldToVoxel(center);
      const centerKey = grid.voxelKey(centerIdx.i, centerIdx.j, centerIdx.k);
      splatToCell.set(index, centerKey);
      splatCount++;

      if (radius <= 0) {
        pushUnique(cellsBuilder, centerKey, index);
        return;
      }

      const minI = Math.floor((center.x - radius - ox) / vs);
      const maxI = Math.floor((center.x + radius - ox) / vs);
      const minJ = Math.floor((center.y - radius - oy) / vs);
      const maxJ = Math.floor((center.y + radius - oy) / vs);
      const minK = Math.floor((center.z - radius - oz) / vs);
      const maxK = Math.floor((center.z + radius - oz) / vs);

      for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
          for (let k = minK; k <= maxK; k++) {
            pushUnique(cellsBuilder, grid.voxelKey(i, j, k), index);
          }
        }
      }
    });

    return VoxelHash.finalize(grid, cellsBuilder, splatToCell, splatCount);
  }

  private static finalize(
    grid: VoxelGrid,
    cellsBuilder: Map<string, number[]>,
    splatToCell: Map<number, string>,
    splatCount: number,
  ): VoxelHash {
    const cells = new Map<string, Uint32Array>();
    let maxSplatsInAnyVoxel = 0;
    for (const [key, ids] of cellsBuilder) {
      cells.set(key, Uint32Array.from(ids));
      if (ids.length > maxSplatsInAnyVoxel) maxSplatsInAnyVoxel = ids.length;
    }

    const voxelCount = cells.size;
    const meanSplatsPerVoxel = voxelCount === 0 ? 0 : splatCount / voxelCount;

    return new VoxelHash(grid, cells, splatToCell, {
      splatCount,
      voxelCount,
      maxSplatsInAnyVoxel,
      meanSplatsPerVoxel,
    });
  }

  splatsIn(key: string): Uint32Array | undefined {
    return this.cells.get(key);
  }

  voxelOf(splatId: number): string | undefined {
    return this.splatToCell.get(splatId);
  }
}

function pushUnique(builder: Map<string, number[]>, key: string, index: number): void {
  let bucket = builder.get(key);
  if (!bucket) {
    bucket = [];
    builder.set(key, bucket);
  }
  // Cheap dedupe — if the same splat is enumerated twice the carve list double-deletes,
  // which is wasteful but not incorrect. Coverage builds never emit duplicates given
  // their AABB iteration is unique by (i, j, k), so we skip the linear scan.
  bucket.push(index);
}
