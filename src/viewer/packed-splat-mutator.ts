import { unpackSplat, utils, type SplatMesh } from '@sparkjsdev/spark';

import type { SplatMutator } from './splat-mutator.ts';

type Encoding = NonNullable<SplatMesh['packedSplats']>['splatEncoding'];

/**
 * Concrete `SplatMutator` backed by Spark's `PackedSplats` Uint32Array.
 *
 * - `getOpacity`: reads via `unpackSplat(packed, i, encoding).opacity`. Allocates
 *   a transient object per call. Acceptable on the snapshot path (≤ a few hundred
 *   splats per brush op).
 * - `setOpacity`: uses Spark's `utils.setPackedSplatOpacity` — opacity has its own
 *   encoding-independent slot in the packed format, so no encoding param is needed.
 * - `commit`: calls `SplatMesh.updateVersion()` to flag the GPU-side splat texture
 *   for re-upload. Skipped (no-op) when no `setOpacity` calls happened since the
 *   last commit, so it is safe to call `commit()` more often than necessary.
 *
 * Reasoning per `feedback-sources-and-tdd` memory: `unpackSplat` /
 * `utils.setPackedSplatOpacity` / `updateVersion` are read from
 * `node_modules/@sparkjsdev/spark/dist/types/{utils,SplatGenerator}.d.ts` rather
 * than inferred. (`setPackedSplatOpacity` is only reachable via the `utils`
 * namespace export, not the top-level — verified by grepping `index.d.ts`.)
 */
export class PackedSplatMutator implements SplatMutator {
  private readonly packedArray: Uint32Array;
  private readonly mesh: SplatMesh;
  private readonly packed: NonNullable<SplatMesh['packedSplats']>;
  private readonly encoding: Encoding;
  private dirty = false;

  constructor(mesh: SplatMesh) {
    const packed = mesh.packedSplats;
    if (!packed || !packed.packedArray) {
      throw new Error('PackedSplatMutator: SplatMesh has no PackedSplats / packedArray');
    }
    this.mesh = mesh;
    this.packed = packed;
    this.packedArray = packed.packedArray;
    this.encoding = packed.splatEncoding;
  }

  getOpacity(index: number): number {
    return unpackSplat(this.packedArray, index, this.encoding).opacity;
  }

  setOpacity(index: number, opacity: number): void {
    utils.setPackedSplatOpacity(this.packedArray, index, opacity);
    this.dirty = true;
  }

  /**
   * Flag the GPU-side splat texture for re-upload AND bump the dyno graph version.
   *
   * `packedSplats.needsUpdate = true` is the real upload trigger — without it,
   * mutations to `packedArray` only live in JS memory and the GPU continues to
   * render the stale data. (Confirmed by grepping the Spark bundle for every
   * call site that mutates a packed array and looking at what they set.)
   * `updateVersion()` complements it by invalidating downstream dyno caches.
   */
  commit(): void {
    if (!this.dirty) return;
    this.packed.needsUpdate = true;
    this.mesh.updateVersion();
    this.dirty = false;
  }
}
