import { SplatMesh } from '@sparkjsdev/spark';
import { Box3, Vector3 } from 'three';

export interface LoadedSplat {
  mesh: SplatMesh;
  bbox: Box3;
  splatCount: number;
}

/**
 * Loads a 3DGS scene file (`.ply` / `.spz` / `.splat` / `.ksplat` / `.sog`) via Spark
 * and computes its **local-frame** bounding box from the splat centers.
 *
 * The bbox is in the SplatMesh's local frame — same frame as
 * `mesh.packedSplats.forEachSplat`'s `center` argument. Callers that need world-space
 * bounds should iterate again *after* applying `mesh.matrixWorld`.
 */
export async function loadSplat(url: string): Promise<LoadedSplat> {
  const mesh = new SplatMesh({ url, raycastable: true });
  await mesh.initialized;

  const packed = mesh.packedSplats;
  if (!packed) {
    throw new Error('SplatMesh initialized without a PackedSplats payload');
  }

  const bbox = new Box3();
  packed.forEachSplat((_index, center) => {
    bbox.expandByPoint(center);
  });

  if (bbox.isEmpty()) {
    throw new Error('Loaded splat scene has no splats / empty bounding box');
  }

  return { mesh, bbox, splatCount: packed.numSplats };
}

/**
 * Iterator suitable for `VoxelHash.build`. Emits each splat's local-frame center.
 *
 * Reuses an internal `Vector3` for efficiency — `VoxelHash` only reads `center`
 * synchronously inside the visit, so reuse is safe.
 */
export function forEachLocalCenter(
  mesh: SplatMesh,
): (visit: (index: number, center: Vector3) => void) => void {
  return (visit) => {
    const packed = mesh.packedSplats;
    if (!packed) return;
    packed.forEachSplat((index, center) => visit(index, center));
  };
}

/**
 * Iterator for `VoxelHash.buildCoverage`. Reports each splat's center plus a
 * bounding-sphere radius `sigmaMultiplier × max(σx, σy, σz)`.
 *
 * Why max(σ) and not, say, length(σ): for a 3σ ellipsoid with principal scales
 * `(σx, σy, σz)`, the *smallest enclosing sphere* has radius
 * `3 × max(σx, σy, σz)` regardless of rotation. That gives the tightest
 * sphere-AABB the carve hash can use without per-splat OBB tests, and
 * conservatively covers every point inside the 3σ ellipsoid.
 *
 * The default `sigmaMultiplier = 3` corresponds to ≈ 1.1% peak density — visually
 * "the splat ends here." Bump it for cleaner carves at the cost of more
 * over-coverage; drop it to be less aggressive.
 */
export function forEachLocalCenterAndRadius(
  mesh: SplatMesh,
  sigmaMultiplier = 3,
): (visit: (index: number, center: Vector3, radius: number) => void) => void {
  return (visit) => {
    const packed = mesh.packedSplats;
    if (!packed) return;
    packed.forEachSplat((index, center, scales) => {
      const maxScale = Math.max(scales.x, scales.y, scales.z);
      visit(index, center, sigmaMultiplier * maxScale);
    });
  };
}
