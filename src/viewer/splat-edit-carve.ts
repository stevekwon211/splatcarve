import {
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType,
  type SplatMesh,
} from '@sparkjsdev/spark';
import type { Vector3 } from 'three';

/**
 * SDF-based voxel carve, backed by Spark's `SplatEdit` + `SplatEditSdf`.
 *
 * Each carved voxel registers an axis-aligned BOX SDF at the voxel's center
 * with half-extent `voxelSize / 2`. At render time Spark's rasterizer
 * evaluates the union of all SDFs and *multiplies* the sample's alpha by the
 * SDF's `opacity` (here `0`) — so any splat-sample inside the box becomes
 * invisible while the same splat's contribution *outside* the box renders
 * unchanged.
 *
 * Why this beats packed-array opacity mutation for voxel-resolution carving:
 *
 *   - Packed-array mutation deletes whole splats. Anisotropic splats
 *     contribute to many voxels, so deleting "the splats centered in voxel V"
 *     visibly thins the splats in V's neighbors too. The user sees a fuzzy
 *     hole rather than a cube.
 *   - SDF mutation is per-sample, not per-splat. Inside the box → invisible.
 *     Outside → untouched. The hole has the exact shape of the box.
 *
 * The trade-off is that this is purely a visual mask — the underlying splat
 * data is unmodified. A future "hard delete" mode (PLY export, multiplayer
 * sync) would need to bake the SDFs back into packed-array opacity.
 *
 * Primary sources consulted (per `feedback-sources-and-tdd` memory):
 *   - `node_modules/@sparkjsdev/spark/dist/types/SplatEdit.d.ts` for the
 *     `SplatEdit` / `SplatEditSdf` API, `SplatEditSdfType.BOX`,
 *     `SplatEditRgbaBlendMode.MULTIPLY`.
 *   - `examples/interactive-holes/index.html` for the pattern of attaching a
 *     `SplatEdit` as a child of the `SplatMesh`.
 */
export class SplatEditCarve {
  private readonly edit: SplatEdit;
  private readonly sdfs = new Map<string, SplatEditSdf>();
  private readonly voxelSize: number;

  constructor(mesh: SplatMesh, voxelSize: number) {
    this.voxelSize = voxelSize;
    this.edit = new SplatEdit({
      rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
      softEdge: 0,
      sdfSmooth: 0,
    });
    mesh.add(this.edit);
  }

  has(key: string): boolean {
    return this.sdfs.has(key);
  }

  get count(): number {
    return this.sdfs.size;
  }

  carve(key: string, localCenter: Vector3): boolean {
    if (this.sdfs.has(key)) return false;
    const sdf = new SplatEditSdf({
      type: SplatEditSdfType.BOX,
      invert: false,
      opacity: 0,
    });
    sdf.position.copy(localCenter);
    const half = this.voxelSize / 2;
    sdf.scale.set(half, half, half);
    this.edit.addSdf(sdf);
    this.sdfs.set(key, sdf);
    // diagnostic: confirm what Spark will read from this SDF
    console.info(
      `[carve-sdf] key=${key} pos=(${localCenter.x.toFixed(4)},${localCenter.y.toFixed(4)},${localCenter.z.toFixed(4)}) ` +
        `scale=(${sdf.scale.x.toFixed(4)},${sdf.scale.y.toFixed(4)},${sdf.scale.z.toFixed(4)}) ` +
        `radius=${sdf.radius} voxelSize=${this.voxelSize.toFixed(4)} ` +
        `edit.sdfs.length=${this.edit.sdfs?.length ?? 0}`,
    );
    return true;
  }

  uncarve(key: string): boolean {
    const sdf = this.sdfs.get(key);
    if (!sdf) return false;
    this.edit.removeSdf(sdf);
    this.sdfs.delete(key);
    return true;
  }
}
