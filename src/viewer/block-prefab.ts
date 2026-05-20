import { Color, Quaternion, Vector3 } from 'three';

export interface PrefabSplat {
  /** Splat centre offset from the target voxel's centre. */
  centerOffset: Vector3;
  scales: Vector3;
  quaternion: Quaternion;
  opacity: number;
  color: Color;
}

/**
 * Wave G.2 — block prefab generator.
 *
 * A "block" placed in game mode is rendered as a regular 3×3×3 grid of
 * 27 small splats that together fill one voxel cell. Each splat is a
 * sphere ≈ 1/6 the voxel size, spaced at 1/3 of the voxel — close enough
 * that overlap blurs out the gaps but small enough that the silhouette
 * still reads as a cube rather than a soft ball.
 *
 * Single block type for the MVP. Multiple block types (grass / stone /
 * etc.) is a post-MVP extension; the factory signature is ready for it.
 */
export function makeCubePrefab(voxelSize: number, color: Color): PrefabSplat[] {
  const dotScale = voxelSize / 6;
  const stride = voxelSize / 3;
  const out: PrefabSplat[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        out.push({
          centerOffset: new Vector3((i - 1) * stride, (j - 1) * stride, (k - 1) * stride),
          scales: new Vector3(dotScale, dotScale, dotScale),
          quaternion: new Quaternion(),
          opacity: 1,
          color: color.clone(),
        });
      }
    }
  }
  return out;
}
