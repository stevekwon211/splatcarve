import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Camera, ShaderMaterial, Vector3 } from 'three';

import { FragmentSdfShaderPatch } from './fragment-sdf-shader-patch.ts';

/**
 * Spark integration for {@link FragmentSdfShaderPatch}.
 *
 * `attach()` installs the patch on `SparkRenderer.material`'s
 * `onBeforeCompile`. Subsequent `carve(key, localCenter)` / `uncarve(key)`
 * mutate uniform-array slots — no shader recompilation, no GPU re-upload.
 *
 * Per-frame, the host must call `updateMatrix(camera, mesh)` so the
 * `uClipToLocal` uniform stays in sync with the current camera + mesh
 * transform.
 */
export class FragmentSdfCarver {
  readonly voxelSize: number;
  private readonly halfExtent: number;
  private readonly patch: FragmentSdfShaderPatch;
  private readonly material: ShaderMaterial;

  constructor(spark: SparkRenderer, voxelSize: number, maxCarves = 256) {
    this.voxelSize = voxelSize;
    this.halfExtent = voxelSize / 2;
    this.patch = new FragmentSdfShaderPatch(maxCarves);
    this.material = spark.material;
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

  carve(key: string, localCenter: Vector3): boolean {
    return this.patch.carve(key, localCenter, this.halfExtent);
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
