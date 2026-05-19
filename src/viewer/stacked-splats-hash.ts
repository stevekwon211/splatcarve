import type { VoxelHash } from './voxel-hash.ts';

/**
 * Mutable per-voxel index of *stacked* (Wave-D-added) splat slot IDs.
 *
 * Sibling to the build-once, immutable {@link VoxelHash} that indexes the
 * scene's original splat centers. Wave D needs to add splats at runtime;
 * VoxelHash.cells is `ReadonlyMap<string, Uint32Array>`, so we maintain a
 * parallel mutable structure and merge on query via
 * {@link unionedSplatsIn}.
 *
 * Picker / carve / stack code paths that need to see *all* splats in a voxel
 * call `unionedSplatsIn(key, baseHash)`; paths that only care about the
 * scene's original geometry stay on the base hash.
 */
export class StackedSplatsHash {
  private readonly cells = new Map<string, number[]>();

  /**
   * Adds `slotIdx` under `voxelKey`. Duplicate (key, slot) pairs are ignored —
   * the same slot index never appears twice under the same key.
   */
  add(voxelKey: string, slotIdx: number): void {
    let bucket = this.cells.get(voxelKey);
    if (!bucket) {
      bucket = [];
      this.cells.set(voxelKey, bucket);
    }
    if (!bucket.includes(slotIdx)) bucket.push(slotIdx);
  }

  /**
   * Removes `slotIdx` from `voxelKey`. No-op if the slot is not registered or
   * the key has no bucket. Removes the bucket itself when it becomes empty
   * so `size` reflects only keys with active stacked splats.
   */
  remove(voxelKey: string, slotIdx: number): void {
    const bucket = this.cells.get(voxelKey);
    if (!bucket) return;
    const idx = bucket.indexOf(slotIdx);
    if (idx === -1) return;
    bucket.splice(idx, 1);
    if (bucket.length === 0) this.cells.delete(voxelKey);
  }

  /** Stacked slot IDs in `voxelKey`. Returns an empty array (not null) for unknown keys. */
  splatsIn(voxelKey: string): ReadonlyArray<number> {
    return this.cells.get(voxelKey) ?? EMPTY;
  }

  /** Number of voxel keys with at least one active stacked slot. */
  get size(): number {
    return this.cells.size;
  }

  clear(): void {
    this.cells.clear();
  }

  /**
   * Returns the union of base + stacked splat IDs for `voxelKey` as a single
   * `Uint32Array`. Base entries come first (preserving the existing scene's
   * iteration order), followed by stacked entries in insertion order.
   *
   * The picker uses this so a click on a stacked splat resolves to that
   * splat just like a click on an original splat.
   */
  unionedSplatsIn(voxelKey: string, baseHash: VoxelHash): Uint32Array {
    const base = baseHash.splatsIn(voxelKey);
    const stacked = this.cells.get(voxelKey);
    const baseLen = base ? base.length : 0;
    const stackedLen = stacked ? stacked.length : 0;
    if (baseLen === 0 && stackedLen === 0) return EMPTY_U32;

    const out = new Uint32Array(baseLen + stackedLen);
    if (base) out.set(base, 0);
    if (stacked) {
      for (let i = 0; i < stackedLen; i++) out[baseLen + i] = stacked[i] as number;
    }
    return out;
  }
}

const EMPTY: ReadonlyArray<number> = Object.freeze([]);
const EMPTY_U32 = new Uint32Array(0);
