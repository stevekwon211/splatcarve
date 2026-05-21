import { SplatMesh } from '@sparkjsdev/spark';
import { Box3, Vector3 } from 'three';

export interface LoadedSplat {
  mesh: SplatMesh;
  bbox: Box3;
  splatCount: number;
}

export interface LoadSplatOptions {
  /**
   * When > 0, the bounding box is clipped to the [p, 1−p] percentile of splat
   * centres per axis instead of the naive min/max. This rejects the "floater"
   * outliers (distant sky / cloud splats) endemic to outdoor 3DGS captures —
   * without it, the AABB is dominated by a handful of far-away points and the
   * dense terrain collapses into a few coarse voxels. Typical value: 0.02
   * (clip the outer 2 % on each end). Leave undefined for clean figurine
   * scenes like the butterfly where the naive box is already tight.
   */
  bboxPercentile?: number;
}

/**
 * Loads a 3DGS scene file (`.ply` / `.spz` / `.splat` / `.ksplat` / `.sog`) via Spark
 * and computes its **local-frame** bounding box from the splat centers.
 *
 * The bbox is in the SplatMesh's local frame — same frame as
 * `mesh.packedSplats.forEachSplat`'s `center` argument. Callers that need world-space
 * bounds should iterate again *after* applying `mesh.matrixWorld`.
 */
export async function loadSplat(url: string, options: LoadSplatOptions = {}): Promise<LoadedSplat> {
  const mesh = new SplatMesh({ url, raycastable: true });
  await mesh.initialized;

  const packed = mesh.packedSplats;
  if (!packed) {
    throw new Error('SplatMesh initialized without a PackedSplats payload');
  }

  const percentile = options.bboxPercentile ?? 0;
  const bbox =
    percentile > 0 && percentile < 0.5
      ? computeRobustBbox(packed, percentile)
      : computeNaiveBbox(packed);

  if (bbox.isEmpty()) {
    throw new Error('Loaded splat scene has no splats / empty bounding box');
  }

  return { mesh, bbox, splatCount: packed.numSplats };
}

function computeNaiveBbox(packed: NonNullable<SplatMesh['packedSplats']>): Box3 {
  const bbox = new Box3();
  packed.forEachSplat((_index, center) => {
    bbox.expandByPoint(center);
  });
  return bbox;
}

/**
 * Per-axis [p, 1−p] percentile box. Collects all centre components, sorts each
 * axis, and takes the percentile bounds. O(N log N) once at load — fine for the
 * ~10⁵–10⁶ splats splatcarve loads. Rejects outlier floaters that would
 * otherwise blow up the AABB.
 */
function computeRobustBbox(packed: NonNullable<SplatMesh['packedSplats']>, p: number): Box3 {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  packed.forEachSplat((_index, center) => {
    xs.push(center.x);
    ys.push(center.y);
    zs.push(center.z);
  });
  if (xs.length === 0) return new Box3();

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  const lo = Math.floor(p * (xs.length - 1));
  const hi = Math.ceil((1 - p) * (xs.length - 1));

  return new Box3(
    new Vector3(xs[lo] as number, ys[lo] as number, zs[lo] as number),
    new Vector3(xs[hi] as number, ys[hi] as number, zs[hi] as number),
  );
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
