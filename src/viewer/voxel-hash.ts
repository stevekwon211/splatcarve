import type { Vector3 } from 'three';

import type { VoxelGrid } from './voxel-grid.ts';

/**
 * Callback shape produced by Spark's `PackedSplats.forEachSplat` (after we discard
 * the parameters we don't need for hashing).
 *
 * Designed as the unit of input so the hash builder can be tested without a real SplatMesh.
 */
export type ForEachSplatCenter = (visit: (index: number, center: Vector3) => void) => void;

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
      let bucket = cellsBuilder.get(key);
      if (!bucket) {
        bucket = [];
        cellsBuilder.set(key, bucket);
      }
      bucket.push(index);
      splatToCell.set(index, key);
      splatCount++;
    });

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
