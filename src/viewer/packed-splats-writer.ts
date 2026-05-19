import { Color, Quaternion, Vector3 } from 'three';

import type { PackedSplatsWriter, SplatParams } from './stack-op.ts';

/**
 * Narrow contract over Spark's `PackedSplats`. The writer only depends on the
 * surface Spark guarantees in its `.d.ts` — `numSplats`, `ensureSplats`,
 * `getSplat`, `setSplat`, `needsUpdate`. Tests use an in-memory fake; production
 * passes the real `mesh.packedSplats`.
 *
 * Verified against `node_modules/@sparkjsdev/spark/dist/types/PackedSplats.d.ts`
 * (Spark 2.1).
 */
export interface PackedSplatsLike {
  numSplats: number;
  needsUpdate: boolean;
  ensureSplats(numSplats: number): Uint32Array;
  getSplat(index: number): {
    center: Vector3;
    scales: Vector3;
    quaternion: Quaternion;
    opacity: number;
    color: Color;
  };
  setSplat(
    index: number,
    center: Vector3,
    scales: Vector3,
    quaternion: Quaternion,
    opacity: number,
    color: Color,
  ): void;
}

/**
 * Adapts Spark's `PackedSplats` to {@link PackedSplatsWriter} with one critical
 * behavior change: `setSplat` does *not* set `needsUpdate = true` per write.
 *
 * Why: setting `needsUpdate` triggers a full `DataArrayTexture` reupload on the
 * next render (Spark does not support `texSubImage3D`). At ~6 MB for a 377K
 * splat buffer that's ~1–3 ms on Apple Silicon — fine *per frame*, ruinous
 * *per write* in a click-drag stroke that fires N times in a single frame.
 *
 * The fix is the dirty-set + `flushIfDirty()` pattern: callers issue any
 * number of `setSplat` writes, then call `flushIfDirty()` exactly once per
 * `requestAnimationFrame` tick to schedule the GPU upload.
 */
export class BufferedPackedSplatsWriter implements PackedSplatsWriter {
  private readonly packed: PackedSplatsLike;
  private dirty = false;

  constructor(packed: PackedSplatsLike) {
    this.packed = packed;
  }

  readSplat(index: number, out?: SplatParams): SplatParams {
    const src = this.packed.getSplat(index);
    if (!out) {
      return {
        center: src.center.clone(),
        scales: src.scales.clone(),
        quaternion: src.quaternion.clone(),
        opacity: src.opacity,
        color: src.color.clone(),
      };
    }
    out.center.copy(src.center);
    out.scales.copy(src.scales);
    out.quaternion.copy(src.quaternion);
    out.opacity = src.opacity;
    out.color.copy(src.color);
    return out;
  }

  setSplat(
    index: number,
    center: Vector3,
    scales: Vector3,
    quaternion: Quaternion,
    opacity: number,
    color: Color,
  ): void {
    this.packed.setSplat(index, center, scales, quaternion, opacity, color);
    this.dirty = true;
  }

  /**
   * Marks the underlying Spark buffer as needing a GPU re-upload if any writes
   * have landed since the last flush. Returns whether the flush actually
   * propagated a signal (so callers can log perf without re-reading
   * `needsUpdate`).
   *
   * Idempotent: calling repeatedly without intervening writes is a no-op.
   */
  flushIfDirty(): boolean {
    if (!this.dirty) return false;
    this.packed.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  /**
   * Initial setup at load time. Grows the underlying buffer to
   * `baseCount + stackCount`, sets `numSplats` so the renderer iterates the
   * full range, and zeros opacity across the stack region so the
   * pre-allocated slots are invisible until a stack op writes to them.
   *
   * Marks dirty + flushes immediately so the renderer picks up the new payload
   * on the next frame.
   */
  preallocate(baseCount: number, stackCount: number): void {
    const total = baseCount + stackCount;
    this.packed.ensureSplats(total);
    this.packed.numSplats = total;

    if (stackCount > 0) {
      const zeroCenter = new Vector3();
      const zeroScales = new Vector3();
      const zeroQuat = new Quaternion();
      const zeroColor = new Color();
      for (let slot = baseCount; slot < total; slot++) {
        this.packed.setSplat(slot, zeroCenter, zeroScales, zeroQuat, 0, zeroColor);
      }
      this.dirty = true;
      this.flushIfDirty();
    }
  }
}
