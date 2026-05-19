import type { EditOp } from './edit-history.ts';
import type { SplatMutator } from './splat-mutator.ts';

/**
 * Reversible "set opacity to 0 for these splats" operation.
 *
 * Built via {@link snapshot}, which captures every affected splat's current
 * opacity *at construction time*. The snapshot is immutable: subsequent external
 * mutations between `undo()` and `do()` do **not** poison the restore. This
 * matches the contract the integration test exercises.
 *
 * Owns a single `commit()` per `do` or `undo` — the mutator is responsible for
 * batching the actual GPU upload at most once per JS task. For a brush that
 * sweeps many voxels in one frame, build one `CarveOperation` per voxel and
 * call `do()` on each before yielding; the mutator's commit may dedupe.
 */
export class CarveOperation implements EditOp {
  readonly affectedSplatIds: Uint32Array;
  private readonly originalOpacities: Float32Array;
  private readonly mutator: SplatMutator;

  private constructor(
    mutator: SplatMutator,
    affectedSplatIds: Uint32Array,
    originalOpacities: Float32Array,
  ) {
    this.mutator = mutator;
    this.affectedSplatIds = affectedSplatIds;
    this.originalOpacities = originalOpacities;
  }

  static snapshot(mutator: SplatMutator, splatIds: Iterable<number>): CarveOperation {
    const ids = Uint32Array.from(splatIds);
    const originals = new Float32Array(ids.length);
    for (let n = 0; n < ids.length; n++) {
      originals[n] = mutator.getOpacity(ids[n] as number);
    }
    return new CarveOperation(mutator, ids, originals);
  }

  do(): void {
    for (let n = 0; n < this.affectedSplatIds.length; n++) {
      this.mutator.setOpacity(this.affectedSplatIds[n] as number, 0);
    }
    this.mutator.commit();
  }

  undo(): void {
    for (let n = 0; n < this.affectedSplatIds.length; n++) {
      this.mutator.setOpacity(
        this.affectedSplatIds[n] as number,
        this.originalOpacities[n] as number,
      );
    }
    this.mutator.commit();
  }
}
