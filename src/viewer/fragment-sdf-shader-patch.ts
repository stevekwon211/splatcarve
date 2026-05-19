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
   * Plug into `THREE.Material.onBeforeCompile`. Mutates `shader.vertexShader`,
   * `shader.fragmentShader`, and `shader.uniforms` in place.
   *
   * Anchored on stable substrings observed in Spark v2.1.0:
   *   - Vertex: `vNdc = ndc;` — inject `vWorldPos` write right after, so the
   *     per-vertex world position is computed once and interpolated
   *     (perspective-correct) to the fragment.
   *   - Fragment: `out vec4 fragColor;` — insert uniform declarations + the
   *     `in vec3 vWorldPos;` declaration before.
   *   - Fragment: `void main() {\n    vec4 rgba = vRgba;` — insert the
   *     SDF discard loop just before `vec4 rgba`.
   *
   * Performance rationale (Wave C+.2 perf pass): the matrix multiply +
   * perspective divide moved from per-fragment (~2M invocations at 1080p
   * × splat overdraw) to per-vertex (~4 × numSplats invocations). The loop
   * uses a constant upper bound (`MAX_CARVES`) with an early `break` so
   * drivers can unroll.
   */
  compile(shader: {
    vertexShader: string;
    fragmentShader: string;
    uniforms: Record<string, unknown>;
  }): void {
    const fragColorAnchor = 'out vec4 fragColor;';
    const mainAnchor = 'void main() {\n    vec4 rgba = vRgba;';
    const vNdcAnchor = 'vNdc = ndc;';

    if (!shader.fragmentShader.includes(fragColorAnchor)) {
      throw new Error(
        `FragmentSdfShaderPatch: fragment-shader anchor "${fragColorAnchor}" not found; Spark may have rewritten its shader.`,
      );
    }
    if (!shader.fragmentShader.includes(mainAnchor)) {
      throw new Error(
        `FragmentSdfShaderPatch: fragment-shader anchor "void main() {... vec4 rgba = vRgba;" not found.`,
      );
    }
    if (!shader.vertexShader.includes(vNdcAnchor)) {
      throw new Error(
        `FragmentSdfShaderPatch: vertex-shader anchor "${vNdcAnchor}" not found.`,
      );
    }

    const fragUniforms =
      `uniform int uCarveCount;\n` +
      `uniform vec3 uCarveCenters[${this.maxCarves}];\n` +
      `uniform float uCarveHalfExtents[${this.maxCarves}];\n` +
      `in vec3 vWorldPos;\n\n` +
      fragColorAnchor;

    const discardLoop =
      `void main() {\n` +
      `    if (uCarveCount > 0) {\n` +
      `        for (int i = 0; i < ${this.maxCarves}; i++) {\n` +
      `            if (i >= uCarveCount) break;\n` +
      `            vec3 d = abs(vWorldPos - uCarveCenters[i]);\n` +
      `            float h = uCarveHalfExtents[i];\n` +
      `            if (d.x < h && d.y < h && d.z < h) discard;\n` +
      `        }\n` +
      `    }\n` +
      `    vec4 rgba = vRgba;`;

    // Vertex stage: declare uClipToLocal + vWorldPos, then compute right
    // after `vNdc = ndc;`. The first match is what we want — there are
    // two `vNdc = ...` writes (regular path and 2DGS path); both end up
    // writing the same NDC value for the splat's depth, so patching the
    // regular path covers the common case. The 2DGS path uses a different
    // assignment form so it isn't matched by this anchor and its
    // `vWorldPos` will be left as its garbage default (which is fine because
    // the carve check is gated on `uCarveCount > 0` — but at the cost of
    // mis-discarding when 2DGS is active and someone has carves; we accept
    // this as a documented limitation for now).
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
      .replace(mainAnchor, discardLoop);

    shader.uniforms['uCarveCount'] = this.uniforms.uCarveCount;
    shader.uniforms['uCarveCenters'] = this.uniforms.uCarveCenters;
    shader.uniforms['uCarveHalfExtents'] = this.uniforms.uCarveHalfExtents;
    shader.uniforms['uClipToLocal'] = this.uniforms.uClipToLocal;
  }
}
