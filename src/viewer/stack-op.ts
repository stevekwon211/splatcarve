import { Color, Quaternion, Vector3 } from 'three';

import type { EditOp } from './edit-history.ts';

/** The full per-splat parameter bundle Spark exposes via `forEachSplat`. */
export interface SplatParams {
  center: Vector3;
  scales: Vector3;
  quaternion: Quaternion;
  opacity: number;
  color: Color;
}

export interface PackedSplatsWriter {
  /**
   * Reads splat parameters at `index` into `out` (or a fresh `SplatParams` if
   * `out` is omitted). Implementations must populate every field; the
   * production adapter reads from a CPU-side mirror, not the GPU buffer.
   */
  readSplat(index: number, out?: SplatParams): SplatParams;

  /**
   * Writes splat parameters into the given slot. Implementations may batch the
   * GPU upload (D.4's adapter sets `packedSplats.needsUpdate = true` once per
   * frame); the StackOp does not call `flush` directly.
   */
  setSplat(
    slotIdx: number,
    center: Vector3,
    scales: Vector3,
    quaternion: Quaternion,
    opacity: number,
    color: Color,
  ): void;
}

export interface StackSlotPool {
  acquire(): number | null;
  release(slotIdx: number): void;
}

export interface StackedSplatsHashWriter {
  add(voxelKey: string, slotIdx: number): void;
  remove(voxelKey: string, slotIdx: number): void;
}

export interface StackOpJitter {
  /** Symmetric per-component scale jitter. `0.1` → ±10%. */
  scaleAmp: number;
  /** Symmetric rotation jitter around a random axis. Radians. */
  rotAmpRad: number;
  /** Seed for the deterministic LCG. */
  seed: number;
}

export interface StackOpInput {
  writer: PackedSplatsWriter;
  pool: StackSlotPool;
  stackedHash: StackedSplatsHashWriter;
  targetKey: string;
  sourceSplatIds: ReadonlyArray<number>;
  translationDeltaLocal: Vector3;
  jitter: StackOpJitter;
}

/**
 * Thrown when a StackOp can't acquire enough slots to complete. The op rolls
 * back any partial state (released acquired slots, no hash mutations, no
 * setSplat writes) before throwing — callers can catch + surface a UX
 * "stack capacity reached" hint without worrying about partial application.
 */
export class StackOpCapacityError extends Error {
  readonly acquired: number;
  readonly requested: number;
  constructor(acquired: number, requested: number) {
    super(
      `StackOp: pool exhausted after acquiring ${acquired} of ${requested} slots`,
    );
    this.name = 'StackOpCapacityError';
    this.acquired = acquired;
    this.requested = requested;
  }
}

/**
 * One cluster-copy: read every source splat, write it into a freshly-allocated
 * slot under `targetKey`, optionally jittered. `do()` is a two-phase commit —
 * Phase 1 acquires all slots (or rolls back and throws), Phase 2 writes splats
 * and registers the slots in the stacked hash.
 *
 * `undo()` zeros opacity on every allocated slot, removes the hash entries,
 * and releases the slots back to the pool. Pool slot reuse is LIFO in
 * production (D.2's `StackSlotPool`), so a `do → undo → do` cycle generally
 * recycles the same slot indices in the same order.
 *
 * Pure module: no Spark, no Three.js material references — every external
 * effect goes through `writer`, `pool`, and `stackedHash`. The test path
 * uses in-memory fakes (`bench-runner.test.ts` style); production wires up
 * D.4's `PackedSplatsWriter` and D.2's pool + hash.
 */
export class StackOp implements EditOp {
  private readonly input: StackOpInput;
  private allocatedSlots: number[] = [];
  private applied = false;

  constructor(input: StackOpInput) {
    this.input = input;
  }

  do(): void {
    if (this.applied) {
      throw new Error('StackOp: do() called while already applied — call undo() first');
    }

    const n = this.input.sourceSplatIds.length;
    if (n === 0) {
      this.applied = true;
      return;
    }

    // Phase 1: acquire all slots up front (two-phase commit).
    const slots: number[] = [];
    for (let i = 0; i < n; i++) {
      const slot = this.input.pool.acquire();
      if (slot === null) {
        for (const s of slots) this.input.pool.release(s);
        throw new StackOpCapacityError(slots.length, n);
      }
      slots.push(slot);
    }

    // Phase 2: read source, jitter, write splats, register slots.
    const rng = makeRng(this.input.jitter.seed);
    const src: SplatParams = blankSplatParams();
    const jitteredCenter = new Vector3();
    const jitteredScales = new Vector3();
    const jitteredQuat = new Quaternion();
    const axis = new Vector3();
    const deltaQuat = new Quaternion();

    for (let i = 0; i < n; i++) {
      const srcId = this.input.sourceSplatIds[i] as number;
      const slot = slots[i] as number;

      this.input.writer.readSplat(srcId, src);

      jitteredCenter.copy(src.center).add(this.input.translationDeltaLocal);

      const scaleAmp = this.input.jitter.scaleAmp;
      if (scaleAmp !== 0) {
        jitteredScales.set(
          src.scales.x * (1 + scaleAmp * (2 * rng() - 1)),
          src.scales.y * (1 + scaleAmp * (2 * rng() - 1)),
          src.scales.z * (1 + scaleAmp * (2 * rng() - 1)),
        );
      } else {
        jitteredScales.copy(src.scales);
      }

      const rotAmp = this.input.jitter.rotAmpRad;
      if (rotAmp !== 0) {
        const ax = 2 * rng() - 1;
        const ay = 2 * rng() - 1;
        const az = 2 * rng() - 1;
        const len = Math.hypot(ax, ay, az) || 1;
        axis.set(ax / len, ay / len, az / len);
        const angle = rotAmp * (2 * rng() - 1);
        deltaQuat.setFromAxisAngle(axis, angle);
        jitteredQuat.copy(deltaQuat).multiply(src.quaternion);
      } else {
        jitteredQuat.copy(src.quaternion);
      }

      this.input.writer.setSplat(
        slot,
        jitteredCenter,
        jitteredScales,
        jitteredQuat,
        src.opacity,
        src.color,
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

function blankSplatParams(): SplatParams {
  return {
    center: new Vector3(),
    scales: new Vector3(),
    quaternion: new Quaternion(),
    opacity: 0,
    color: new Color(),
  };
}

/**
 * Linear congruential generator (Numerical Recipes constants). Deterministic,
 * fast, fine for ±10% / ±5° jitter. Returns floats in [0, 1).
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
