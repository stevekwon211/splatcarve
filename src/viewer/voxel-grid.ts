import { Box3, Vector3 } from 'three';

export interface VoxelIndex {
  i: number;
  j: number;
  k: number;
}

interface VoxelCounts {
  x: number;
  y: number;
  z: number;
}

/**
 * Uniform voxel grid laid over a world-space AABB. Pure math — owns no GPU resources.
 *
 * The grid's purpose is to *group* splats (via `worldToVoxel`) and produce snap points
 * (via `voxelToWorldCenter`). It is intentionally not a voxel engine: nothing about
 * geometry, materials, or rendering lives here. See `docs/architecture/voxel-conceptual-model.md`.
 */
export class VoxelGrid {
  readonly origin: Vector3;
  readonly voxelSize: number;
  readonly counts: VoxelCounts;

  private constructor(origin: Vector3, voxelSize: number, counts: VoxelCounts) {
    this.origin = origin;
    this.voxelSize = voxelSize;
    this.counts = counts;
  }

  static fromAABB(aabb: Box3, resolution: number): VoxelGrid {
    if (!Number.isInteger(resolution) || resolution <= 0) {
      throw new Error(`VoxelGrid resolution must be a positive integer, got ${resolution}`);
    }

    const size = aabb.getSize(new Vector3());
    if (size.x < 0 || size.y < 0 || size.z < 0) {
      throw new Error('VoxelGrid AABB must have non-negative extent on all axes');
    }

    const longest = Math.max(size.x, size.y, size.z);
    if (longest === 0) {
      throw new Error('VoxelGrid AABB has zero extent on every axis');
    }

    const voxelSize = longest / resolution;
    const counts: VoxelCounts = {
      x: Math.max(1, Math.ceil(size.x / voxelSize)),
      y: Math.max(1, Math.ceil(size.y / voxelSize)),
      z: Math.max(1, Math.ceil(size.z / voxelSize)),
    };

    return new VoxelGrid(aabb.min.clone(), voxelSize, counts);
  }

  worldToVoxel(p: Vector3): VoxelIndex {
    return {
      i: Math.floor((p.x - this.origin.x) / this.voxelSize),
      j: Math.floor((p.y - this.origin.y) / this.voxelSize),
      k: Math.floor((p.z - this.origin.z) / this.voxelSize),
    };
  }

  voxelKey(i: number, j: number, k: number): string {
    return `${i}|${j}|${k}`;
  }

  voxelToWorldCenter(i: number, j: number, k: number, out: Vector3 = new Vector3()): Vector3 {
    out.set(
      this.origin.x + (i + 0.5) * this.voxelSize,
      this.origin.y + (j + 0.5) * this.voxelSize,
      this.origin.z + (k + 0.5) * this.voxelSize,
    );
    return out;
  }

  contains(i: number, j: number, k: number): boolean {
    return (
      i >= 0 &&
      i < this.counts.x &&
      j >= 0 &&
      j < this.counts.y &&
      k >= 0 &&
      k < this.counts.z
    );
  }
}
