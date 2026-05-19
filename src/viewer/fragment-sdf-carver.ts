import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Camera, ShaderMaterial, Vector3 } from 'three';

import { FragmentSdfShaderPatch } from './fragment-sdf-shader-patch.ts';
import type { VoxelGrid } from './voxel-grid.ts';

/**
 * Spark integration for {@link FragmentSdfShaderPatch}.
 *
 * `attach()` installs the patch on `SparkRenderer.material`'s
 * `onBeforeCompile`. After that, `carve(key, i, j, k)` flips one byte in
 * the carve-mask 3D texture and `uncarve(key)` clears it. No shader
 * recompilation, no per-fragment loop — the fragment shader does one
 * `texture(uCarveMask, …)` sample per pixel regardless of how many cells
 * are active.
 *
 * Per frame, the host calls `updateMatrix(camera, mesh)` so the
 * `uClipToLocal` uniform stays in sync with the current camera + mesh
 * transform; that's the matrix the vertex shader uses to write `vWorldPos`.
 *
 * **Coordinate-frame contract:** `carve(key, center)` accepts `center` in
 * the **SplatMesh's local frame** — the same frame as
 * `mesh.packedSplats.forEachSplat`'s `center` argument and the same frame
 * the {@link VoxelGrid} indexes into. The shader's `vWorldPos` varying is
 * also in this frame despite its name (kept for diff readability); the
 * `uClipToLocal` matrix is `inv(projection · view · mesh.matrixWorld)`, so
 * it maps clip → mesh-local, not clip → world. {@link SplatEditCarve}
 * obeys the same contract so the EditOp / undo wiring stays oblivious to
 * the backend choice.
 */
export class FragmentSdfCarver {
  private readonly patch: FragmentSdfShaderPatch;
  private readonly material: ShaderMaterial;
  private readonly grid: VoxelGrid;

  constructor(spark: SparkRenderer, grid: VoxelGrid) {
    this.patch = new FragmentSdfShaderPatch(grid);
    this.material = spark.material;
    this.grid = grid;
  }

  attach(): void {
    this.material.onBeforeCompile = (shader): void => this.patch.compile(shader);
    this.material.needsUpdate = true;
  }

  has(key: string): boolean {
    return this.patch.has(key);
  }

  get count(): number {
    return this.patch.count;
  }

  /**
   * Mirrors `SplatEditCarve.carve(key, localCenter)` for API parity so the
   * downstream EditOp/undo wiring stays oblivious to the backend choice.
   * Internally derives the voxel index and writes one byte into the carve
   * mask texture.
   */
  carve(key: string, localCenter: Vector3): boolean {
    const { i, j, k } = this.grid.worldToVoxel(localCenter);
    return this.patch.carve(key, i, j, k);
  }

  uncarve(key: string): boolean {
    return this.patch.uncarve(key);
  }

  updateMatrix(camera: Camera, mesh: SplatMesh): void {
    this.patch.uniforms.uClipToLocal.value
      .copy(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld)
      .invert();
  }
}
