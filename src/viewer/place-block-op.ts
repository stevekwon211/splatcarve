import { Color, Quaternion, Vector3 } from 'three';

import type { PrefabSplat } from './block-prefab.ts';
import type { EditOp } from './edit-history.ts';
import type {
  PackedSplatsWriter,
  StackSlotPool,
  StackedSplatsHashWriter,
} from './stack-op.ts';

export interface PlaceBlockInput {
  writer: PackedSplatsWriter;
  pool: StackSlotPool;
  stackedHash: StackedSplatsHashWriter;
  targetKey: string;
  /** Centre of the target voxel cell, in the mesh-local frame. */
  targetCenter: Vector3;
  prefab: ReadonlyArray<PrefabSplat>;
}

/**
 * Thrown when the slot pool can't fulfil the entire prefab. The op rolls
 * back any slots it had already acquired before throwing — callers can
 * catch and surface a "stack capacity reached" UX hint without worrying
 * about partial state.
 */
export class PlaceBlockCapacityError extends Error {
  readonly acquired: number;
  readonly requested: number;
  constructor(acquired: number, requested: number) {
    super(
      `PlaceBlockOp: pool exhausted after acquiring ${acquired} of ${requested} slots`,
    );
    this.name = 'PlaceBlockCapacityError';
    this.acquired = acquired;
    this.requested = requested;
  }
}

/**
 * Wave G.2 — place a single discrete "block" of splats into a voxel cell.
 *
 * Mirror of `StackOp` but for prefab-based placement instead of cluster
 * duplication. The prefab describes N splats with local offsets / scales /
 * rotations / opacities / colours; `do()` writes them into freshly acquired
 * slots at `targetCenter + offset` and registers each slot in the stacked
 * hash under `targetKey`. `undo()` is symmetric.
 *
 * Two-phase commit (same as `StackOp.D.1`): acquire all slots up front,
 * then write. If any acquisition fails the op rolls back fully and throws.
 *
 * Why a new op rather than reusing `StackOp` with synthesised source IDs:
 * the prefab path skips `writer.readSplat` (no source to read) and uses
 * the prefab's verbatim per-splat parameters. Cleaner code; same surface
 * area to `EditHistory`.
 */
export class PlaceBlockOp implements EditOp {
  private readonly input: PlaceBlockInput;
  private allocatedSlots: number[] = [];
  private applied = false;

  constructor(input: PlaceBlockInput) {
    this.input = input;
  }

  do(): void {
    if (this.applied) {
      throw new Error('PlaceBlockOp: do() called while already applied — call undo() first');
    }
    const n = this.input.prefab.length;
    if (n === 0) {
      this.applied = true;
      return;
    }

    // Phase 1: acquire all slots.
    const slots: number[] = [];
    for (let i = 0; i < n; i++) {
      const slot = this.input.pool.acquire();
      if (slot === null) {
        for (const s of slots) this.input.pool.release(s);
        throw new PlaceBlockCapacityError(slots.length, n);
      }
      slots.push(slot);
    }

    // Phase 2: write splats + register in hash.
    const centre = new Vector3();
    for (let i = 0; i < n; i++) {
      const splat = this.input.prefab[i] as PrefabSplat;
      const slot = slots[i] as number;
      centre.copy(this.input.targetCenter).add(splat.centerOffset);
      this.input.writer.setSplat(
        slot,
        centre,
        splat.scales,
        splat.quaternion,
        splat.opacity,
        splat.color,
      );
      this.input.stackedHash.add(this.input.targetKey, slot);
    }

    this.allocatedSlots = slots;
    this.applied = true;
  }

  undo(): void {
    if (!this.applied) return;
    const zeroCenter = new Vector3();
    const zeroScales = new Vector3();
    const zeroQuat = new Quaternion();
    const zeroColor = new Color();
    for (const slot of this.allocatedSlots) {
      this.input.writer.setSplat(slot, zeroCenter, zeroScales, zeroQuat, 0, zeroColor);
      this.input.stackedHash.remove(this.input.targetKey, slot);
      this.input.pool.release(slot);
    }
    this.allocatedSlots = [];
    this.applied = false;
  }
}
