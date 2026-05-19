import { Matrix4, Vector3 } from 'three';

/**
 * Per-fragment SDF mask injection for Spark's `THREE.ShaderMaterial`.
 *
 * Plug into `Material.onBeforeCompile` by passing `compile` (or by hand
 * mutating the shader returned from the callback). The injection adds four
 * uniforms and a `discard;` loop that runs once per fragment, before Spark's
 * own density evaluation:
 *
 * ```glsl
 * if (uCarveCount > 0) {
 *   vec4 worldH = uClipToLocal * vec4(vNdc, 1.0);
 *   vec3 localPos = worldH.xyz / worldH.w;
 *   for (int i = 0; i < uCarveCount; i++) {
 *     vec3 d = abs(localPos - uCarveCenters[i]);
 *     float h = uCarveHalfExtents[i];
 *     if (d.x < h && d.y < h && d.z < h) discard;
 *   }
 * }
 * ```
 *
 * `vNdc` is already declared as `in vec3 vNdc;` in Spark's fragment shader
 * (verified in `docs/research/2026-05-19-spark-shader-hook-spike.md`), so no
 * vertex-shader injection is needed. `uClipToLocal` is updated each frame
 * by the wrapping `FragmentSdfCarver` (`= inverse(projection · view · meshWorld)`).
 *
 * The patch owns the carve state (which voxel keys are active, which slot
 * they occupy in the uniform arrays). Slots are managed with swap-remove
 * so the active range is always contiguous at the start of the array — the
 * GLSL `for` loop iterates `0..uCarveCount-1` and skips empty tails.
 */
export class FragmentSdfShaderPatch {
  readonly maxCarves: number;

  readonly uniforms: {
    uCarveCount: { value: number };
    uCarveCenters: { value: Vector3[] };
    uCarveHalfExtents: { value: Float32Array };
    uClipToLocal: { value: Matrix4 };
  };

  private readonly indexByKey = new Map<string, number>();
  private readonly keyByIndex: (string | undefined)[];

  constructor(maxCarves = 256) {
    if (!Number.isFinite(maxCarves) || maxCarves <= 0) {
      throw new Error(`FragmentSdfShaderPatch.maxCarves must be > 0, got ${maxCarves}`);
    }
    this.maxCarves = maxCarves;

    const centers: Vector3[] = new Array(maxCarves);
    for (let i = 0; i < maxCarves; i++) centers[i] = new Vector3();

    this.uniforms = {
      uCarveCount: { value: 0 },
      uCarveCenters: { value: centers },
      uCarveHalfExtents: { value: new Float32Array(maxCarves) },
      uClipToLocal: { value: new Matrix4() },
    };

    this.keyByIndex = new Array(maxCarves);
  }

  get count(): number {
    return this.uniforms.uCarveCount.value;
  }

  has(key: string): boolean {
    return this.indexByKey.has(key);
  }

  carve(key: string, localCenter: Vector3, halfExtent: number): boolean {
    if (this.indexByKey.has(key)) return false;
    if (this.count >= this.maxCarves) return false;

    const slot = this.count;
    (this.uniforms.uCarveCenters.value[slot] as Vector3).copy(localCenter);
    this.uniforms.uCarveHalfExtents.value[slot] = halfExtent;
    this.indexByKey.set(key, slot);
    this.keyByIndex[slot] = key;
    this.uniforms.uCarveCount.value = slot + 1;
    return true;
  }

  uncarve(key: string): boolean {
    const slot = this.indexByKey.get(key);
    if (slot === undefined) return false;

    const lastSlot = this.count - 1;
    if (slot !== lastSlot) {
      const lastKey = this.keyByIndex[lastSlot] as string;
      (this.uniforms.uCarveCenters.value[slot] as Vector3).copy(
        this.uniforms.uCarveCenters.value[lastSlot] as Vector3,
      );
      this.uniforms.uCarveHalfExtents.value[slot] = this.uniforms.uCarveHalfExtents.value[
        lastSlot
      ] as number;
      this.indexByKey.set(lastKey, slot);
      this.keyByIndex[slot] = lastKey;
    }
    this.keyByIndex[lastSlot] = undefined;
    this.indexByKey.delete(key);
    this.uniforms.uCarveCount.value = lastSlot;
    return true;
  }

  /**
   * Plug into `THREE.Material.onBeforeCompile`. Mutates `shader.fragmentShader`
   * and `shader.uniforms` in place. Vertex shader is untouched — `vNdc` is
   * already exported by Spark.
   *
   * Anchored on two stable substrings observed in Spark v2.1.0:
   *   1. `out vec4 fragColor;` (insert uniform declarations before)
   *   2. `void main() {\n    vec4 rgba = vRgba;` (insert SDF loop before
   *      `vec4 rgba`)
   *
   * Throws if either anchor is missing — that's a Spark version drift and
   * we'd rather fail loudly than silently produce a no-op shader.
   */
  compile(shader: {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, unknown>;
  }): void {
    const fragColorAnchor = 'out vec4 fragColor;';
    const mainAnchor = 'void main() {\n    vec4 rgba = vRgba;';

    if (!shader.fragmentShader.includes(fragColorAnchor)) {
      throw new Error(
        `FragmentSdfShaderPatch: fragment-shader anchor "${fragColorAnchor}" not found; Spark may have rewritten its shader. Open docs/research/2026-05-19-spark-shader-hook-spike.md to re-establish anchors.`,
      );
    }
    if (!shader.fragmentShader.includes(mainAnchor)) {
      throw new Error(
        `FragmentSdfShaderPatch: fragment-shader anchor "void main() {... vec4 rgba = vRgba;" not found; Spark may have rewritten its shader.`,
      );
    }

    const uniformsBlock =
      `uniform int uCarveCount;\n` +
      `uniform vec3 uCarveCenters[${this.maxCarves}];\n` +
      `uniform float uCarveHalfExtents[${this.maxCarves}];\n` +
      `uniform mat4 uClipToLocal;\n\n` +
      fragColorAnchor;

    const discardLoop =
      `void main() {\n` +
      `    if (uCarveCount > 0) {\n` +
      `        vec4 worldH = uClipToLocal * vec4(vNdc, 1.0);\n` +
      `        vec3 localPos = worldH.xyz / worldH.w;\n` +
      `        for (int i = 0; i < uCarveCount; i++) {\n` +
      `            vec3 d = abs(localPos - uCarveCenters[i]);\n` +
      `            float h = uCarveHalfExtents[i];\n` +
      `            if (d.x < h && d.y < h && d.z < h) discard;\n` +
      `        }\n` +
      `    }\n` +
      `    vec4 rgba = vRgba;`;

    shader.fragmentShader = shader.fragmentShader
      .replace(fragColorAnchor, uniformsBlock)
      .replace(mainAnchor, discardLoop);

    shader.uniforms['uCarveCount'] = this.uniforms.uCarveCount;
    shader.uniforms['uCarveCenters'] = this.uniforms.uCarveCenters;
    shader.uniforms['uCarveHalfExtents'] = this.uniforms.uCarveHalfExtents;
    shader.uniforms['uClipToLocal'] = this.uniforms.uClipToLocal;
  }
}
