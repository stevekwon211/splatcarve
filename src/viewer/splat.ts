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
