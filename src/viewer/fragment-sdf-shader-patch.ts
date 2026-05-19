import {
  ClampToEdgeWrapping,
  Data3DTexture,
  Matrix4,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  Vector3,
} from 'three';

import type { VoxelGrid } from './voxel-grid.ts';

/**
 * Per-fragment SDF mask injection for Spark's `THREE.ShaderMaterial`.
 *
 * Backed by a 3D texture (`sampler3D`) sized exactly to the voxel grid:
 * one byte per voxel cell, `255` = carved and `0` = not carved. The fragment
 * shader reconstructs its world position (via a per-vertex varying that
 * comes from `uClipToLocal · vec4(ndc, 1.0)`), maps it to a voxel-space
 * texture coordinate, samples the mask, and `discard;`s if the texel is
 * set. **One texture lookup per fragment — no per-box loop.** Carve count
 * scales without any per-fragment slowdown.
 *
 * The CPU side maintains the `Uint8Array` backing the texture plus a union
 * AABB over the active carves. The fragment shader uses the AABB as an
 * early-out so fragments outside every carved region pay only a few float
 * compares.
 *
 * Anchors used for string-injection on Spark v2.1.0 (verified by
 * `docs/research/2026-05-19-spark-shader-hook-spike.md`):
 *
 *   - Fragment: `out vec4 fragColor;` → uniform block inserted before.
 *   - Fragment: `void main() {\n    vec4 rgba = vRgba;` → discard prelude
 *     inserted before `vec4 rgba`.
 *   - Vertex: `vNdc = ndc;` → `vWorldPos` write inserted right after,
 *     reusing the just-computed `ndc`.
 *
 * Throws if any anchor disappears — Spark version drift should fail loudly
 * rather than degrade silently into a no-op.
 */
export class FragmentSdfShaderPatch {
  readonly uniforms: {
    uCarveCount: { value: number };
    uCarveMask: { value: Data3DTexture };
    uCarveBoundsMin: { value: Vector3 };
    uCarveBoundsMax: { value: Vector3 };
    uClipToLocal: { value: Matrix4 };
    uVoxelOrigin: { value: Vector3 };
    uVoxelSizeInv: { value: number };
    uVoxelCountsInv: { value: Vector3 };
  };

  private readonly grid: VoxelGrid;
  private readonly data: Uint8Array;
  private readonly indexByKey = new Map<string, { i: number; j: number; k: number }>();

  constructor(grid: VoxelGrid) {
    this.grid = grid;
    const { counts } = grid;
    const size = counts.x * counts.y * counts.z;
    this.data = new Uint8Array(size);

    const tex = new Data3DTexture(this.data, counts.x, counts.y, counts.z);
    tex.format = RedFormat;
    tex.type = UnsignedByteType;
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.wrapR = ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    this.uniforms = {
      uCarveCount: { value: 0 },
      uCarveMask: { value: tex },
      uCarveBoundsMin: { value: new Vector3(Infinity, Infinity, Infinity) },
      uCarveBoundsMax: { value: new Vector3(-Infinity, -Infinity, -Infinity) },
      uClipToLocal: { value: new Matrix4() },
      uVoxelOrigin: { value: grid.origin.clone() },
      uVoxelSizeInv: { value: 1 / grid.voxelSize },
      uVoxelCountsInv: {
        value: new Vector3(1 / counts.x, 1 / counts.y, 1 / counts.z),
      },
    };
  }

  get count(): number {
    return this.uniforms.uCarveCount.value;
  }

  has(key: string): boolean {
    return this.indexByKey.has(key);
  }

  carve(key: string, i: number, j: number, k: number): boolean {
    if (this.indexByKey.has(key)) return false;
    if (!this.grid.contains(i, j, k)) return false;

    const linear = this.linearIndex(i, j, k);
    this.data[linear] = 255;
    this.uniforms.uCarveMask.value.needsUpdate = true;

    this.indexByKey.set(key, { i, j, k });
    this.uniforms.uCarveCount.value = this.indexByKey.size;
    this.expandBoundsToVoxel(i, j, k);
    return true;
  }

  uncarve(key: string): boolean {
    const idx = this.indexByKey.get(key);
    if (!idx) return false;

    const linear = this.linearIndex(idx.i, idx.j, idx.k);
    this.data[linear] = 0;
    this.uniforms.uCarveMask.value.needsUpdate = true;

    this.indexByKey.delete(key);
    this.uniforms.uCarveCount.value = this.indexByKey.size;
    this.recomputeBounds();
    return true;
  }

  compile(shader: {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, unknown>;
  }): void {
    const fragColorAnchor = 'out vec4 fragColor;';
    const mainAnchor = 'void main() {\n    vec4 rgba = vRgba;';
    const vNdcAnchor = 'vNdc = ndc;';

    if (!shader.fragmentShader.includes(fragColorAnchor)) {
      throw new Error(`FragmentSdfShaderPatch: fragment anchor "${fragColorAnchor}" missing.`);
    }
    if (!shader.fragmentShader.includes(mainAnchor)) {
      throw new Error(`FragmentSdfShaderPatch: fragment anchor "void main() {... vec4 rgba = vRgba;" missing.`);
    }
    if (!shader.vertexShader.includes(vNdcAnchor)) {
      throw new Error(`FragmentSdfShaderPatch: vertex anchor "${vNdcAnchor}" missing.`);
    }

    const fragUniforms =
      `uniform int uCarveCount;\n` +
      `uniform sampler3D uCarveMask;\n` +
      `uniform vec3 uCarveBoundsMin;\n` +
      `uniform vec3 uCarveBoundsMax;\n` +
      `uniform vec3 uVoxelOrigin;\n` +
      `uniform float uVoxelSizeInv;\n` +
      `uniform vec3 uVoxelCountsInv;\n` +
      `in vec3 vWorldPos;\n\n` +
      fragColorAnchor;

    const discardPrelude =
      `void main() {\n` +
      `    if (uCarveCount > 0\n` +
      `        && vWorldPos.x >= uCarveBoundsMin.x && vWorldPos.x <= uCarveBoundsMax.x\n` +
      `        && vWorldPos.y >= uCarveBoundsMin.y && vWorldPos.y <= uCarveBoundsMax.y\n` +
      `        && vWorldPos.z >= uCarveBoundsMin.z && vWorldPos.z <= uCarveBoundsMax.z) {\n` +
      `        vec3 coord = (vWorldPos - uVoxelOrigin) * uVoxelSizeInv;\n` +
      `        vec3 texCoord = coord * uVoxelCountsInv;\n` +
      `        if (texture(uCarveMask, texCoord).r > 0.5) discard;\n` +
      `    }\n` +
      `    vec4 rgba = vRgba;`;

    const vNdcReplacement =
      `${vNdcAnchor}\n` +
      `    {\n` +
      `        vec4 vp = uClipToLocal * vec4(ndc, 1.0);\n` +
      `        vWorldPos = vp.xyz / vp.w;\n` +
      `    }`;

    const vertexHeader = `uniform mat4 uClipToLocal;\nout vec3 vWorldPos;\n\n`;

    shader.vertexShader =
      vertexHeader + shader.vertexShader.replace(vNdcAnchor, vNdcReplacement);

    shader.fragmentShader = shader.fragmentShader
      .replace(fragColorAnchor, fragUniforms)
      .replace(mainAnchor, discardPrelude);

    for (const [k, v] of Object.entries(this.uniforms)) {
      shader.uniforms[k] = v;
    }
  }

  private linearIndex(i: number, j: number, k: number): number {
    const { counts } = this.grid;
    return i + j * counts.x + k * counts.x * counts.y;
  }

  private expandBoundsToVoxel(i: number, j: number, k: number): void {
    const vs = this.grid.voxelSize;
    const ox = this.grid.origin.x;
    const oy = this.grid.origin.y;
    const oz = this.grid.origin.z;
    const min = this.uniforms.uCarveBoundsMin.value;
    const max = this.uniforms.uCarveBoundsMax.value;
    min.x = Math.min(min.x, ox + i * vs);
    min.y = Math.min(min.y, oy + j * vs);
    min.z = Math.min(min.z, oz + k * vs);
    max.x = Math.max(max.x, ox + (i + 1) * vs);
    max.y = Math.max(max.y, oy + (j + 1) * vs);
    max.z = Math.max(max.z, oz + (k + 1) * vs);
  }

  private recomputeBounds(): void {
    const min = this.uniforms.uCarveBoundsMin.value;
    const max = this.uniforms.uCarveBoundsMax.value;
    min.set(Infinity, Infinity, Infinity);
    max.set(-Infinity, -Infinity, -Infinity);
    for (const { i, j, k } of this.indexByKey.values()) {
      this.expandBoundsToVoxel(i, j, k);
    }
  }
}
