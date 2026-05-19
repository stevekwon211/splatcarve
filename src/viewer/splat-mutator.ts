/**
 * Minimal surface a `CarveOperation` (and future `StackOperation`) needs from
 * the splat backing store. Concrete implementations wrap Spark's
 * `PackedSplats` + `SplatMesh.updateVersion`; tests use a fake.
 */
export interface SplatMutator {
  /** Read current opacity for a splat. */
  getOpacity(index: number): number;

  /** Overwrite the splat's opacity. Does not upload to GPU — caller batches. */
  setOpacity(index: number, opacity: number): void;

  /** Upload pending mutations. Called once per op (or per frame in batched mode). */
  commit(): void;
}
