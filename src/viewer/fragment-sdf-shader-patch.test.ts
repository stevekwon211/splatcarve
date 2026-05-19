import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { FragmentSdfShaderPatch } from './fragment-sdf-shader-patch.ts';

/**
 * Anchor-bearing fragment shader fixture that mirrors Spark's shader's two
 * critical landmarks: the `out vec4 fragColor;` declaration (uniforms go
 * before it) and the `void main() {\n    vec4 rgba = vRgba;\n` opener
 * (SDF discard loop goes before `vec4 rgba`).
 */
const SPARK_LIKE_FS = `precision highp float;
precision highp int;

uniform float near;
uniform float far;

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in uint vSplatIndex;
flat in float adjustedStdDev;

void main() {
    vec4 rgba = vRgba;

    float z2 = dot(vSplatUv, vSplatUv);
    if (z2 > 1.0) discard;

    fragColor = rgba;
}`;

const SPARK_LIKE_VS = `precision highp float;
out vec3 vNdc;

void main() {
    vec3 ndc = vec3(0.0);
    vNdc = ndc;
    gl_Position = vec4(ndc, 1.0);
}`;

interface Shader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, unknown>;
}

function makeShader(fragment = SPARK_LIKE_FS, vertex = SPARK_LIKE_VS): Shader {
  return { vertexShader: vertex, fragmentShader: fragment, uniforms: {} };
}

describe('FragmentSdfShaderPatch.compile — fragment shader injection', () => {
  it('adds the carve uniforms and vWorldPos varying before `out vec4 fragColor;`', () => {
    const patch = new FragmentSdfShaderPatch();
    const shader = makeShader();
    patch.compile(shader);

    // uClipToLocal lives in the vertex stage (perf optimization). Fragment
    // gets the three carve uniforms + the interpolated vWorldPos varying.
    expect(shader.fragmentShader).toContain('uniform int uCarveCount');
    expect(shader.fragmentShader).toContain('uniform vec3 uCarveCenters[256]');
    expect(shader.fragmentShader).toContain('uniform float uCarveHalfExtents[256]');
    expect(shader.fragmentShader).toContain('in vec3 vWorldPos;');

    const uCarveCountIdx = shader.fragmentShader.indexOf('uniform int uCarveCount');
    const outFragColorIdx = shader.fragmentShader.indexOf('out vec4 fragColor;');
    expect(uCarveCountIdx).toBeGreaterThan(-1);
    expect(outFragColorIdx).toBeGreaterThan(-1);
    expect(uCarveCountIdx).toBeLessThan(outFragColorIdx);
  });

  it('injects the SDF discard loop inside main() before `vec4 rgba = vRgba;`', () => {
    const patch = new FragmentSdfShaderPatch();
    const shader = makeShader();
    patch.compile(shader);

    const discardIdx = shader.fragmentShader.indexOf('discard');
    const rgbaInitIdx = shader.fragmentShader.indexOf('vec4 rgba = vRgba;');
    expect(discardIdx).toBeGreaterThan(-1);
    expect(rgbaInitIdx).toBeGreaterThan(-1);
    expect(discardIdx).toBeLessThan(rgbaInitIdx);

    // Fragment reads world position from the vertex-interpolated varying.
    expect(shader.fragmentShader).toContain('in vec3 vWorldPos;');
    expect(shader.fragmentShader).not.toContain('uClipToLocal * vec4(vNdc');
    // Constant loop bound + break, so drivers can unroll.
    expect(shader.fragmentShader).toMatch(/for \(int i = 0; i < 256/);
    expect(shader.fragmentShader).toContain('if (i >= uCarveCount) break;');
  });

  it('moves the matrix multiply from fragment to vertex stage', () => {
    const patch = new FragmentSdfShaderPatch();
    const shader = makeShader();
    patch.compile(shader);

    expect(shader.vertexShader).toContain('uniform mat4 uClipToLocal');
    expect(shader.vertexShader).toContain('out vec3 vWorldPos');
    expect(shader.vertexShader).toContain('uClipToLocal * vec4(ndc, 1.0)');

    // The vertex-stage WRITE to vWorldPos must come AFTER `vNdc = ndc;`
    // so we reuse the already-computed NDC. The DECLARATION (out vec3
    // vWorldPos) sits at the top of the shader as expected.
    const vNdcAssignIdx = shader.vertexShader.indexOf('vNdc = ndc;');
    const vWorldWriteIdx = shader.vertexShader.indexOf('vWorldPos = vp.xyz');
    expect(vNdcAssignIdx).toBeGreaterThan(-1);
    expect(vWorldWriteIdx).toBeGreaterThan(vNdcAssignIdx);

    // The fragment shader no longer declares uClipToLocal (moved to vertex).
    expect(shader.fragmentShader).not.toContain('uniform mat4 uClipToLocal');
  });

  it('attaches the patch uniforms onto shader.uniforms by reference', () => {
    const patch = new FragmentSdfShaderPatch();
    const shader = makeShader();
    patch.compile(shader);

    expect(shader.uniforms['uCarveCount']).toBe(patch.uniforms.uCarveCount);
    expect(shader.uniforms['uCarveCenters']).toBe(patch.uniforms.uCarveCenters);
    expect(shader.uniforms['uCarveHalfExtents']).toBe(patch.uniforms.uCarveHalfExtents);
    expect(shader.uniforms['uClipToLocal']).toBe(patch.uniforms.uClipToLocal);
  });

  it('throws if the expected fragment-shader anchors are missing', () => {
    const patch = new FragmentSdfShaderPatch();
    const broken = makeShader('void main() { fragColor = vec4(1.0); }');
    expect(() => patch.compile(broken)).toThrow();
  });

  it('throws if the expected vertex-shader anchor is missing', () => {
    const patch = new FragmentSdfShaderPatch();
    const broken = makeShader(SPARK_LIKE_FS, 'void main() { gl_Position = vec4(0); }');
    expect(() => patch.compile(broken)).toThrow();
  });
});

describe('FragmentSdfShaderPatch — carve state', () => {
  it('starts empty', () => {
    const patch = new FragmentSdfShaderPatch();
    expect(patch.count).toBe(0);
    expect(patch.uniforms.uCarveCount.value).toBe(0);
  });

  it('carve() writes into the next free slot and updates count', () => {
    const patch = new FragmentSdfShaderPatch();
    expect(patch.carve('1|2|3', new Vector3(1, 2, 3), 0.5)).toBe(true);

    expect(patch.count).toBe(1);
    expect(patch.uniforms.uCarveCount.value).toBe(1);
    expect(patch.has('1|2|3')).toBe(true);

    const slot0 = patch.uniforms.uCarveCenters.value[0] as Vector3;
    expect(slot0.x).toBe(1);
    expect(slot0.y).toBe(2);
    expect(slot0.z).toBe(3);
    expect(patch.uniforms.uCarveHalfExtents.value[0]).toBeCloseTo(0.5);
  });

  it('carve() is idempotent on a duplicate key (returns false, no slot change)', () => {
    const patch = new FragmentSdfShaderPatch();
    patch.carve('k', new Vector3(1, 1, 1), 0.5);
    expect(patch.carve('k', new Vector3(9, 9, 9), 0.5)).toBe(false);
    expect(patch.count).toBe(1);
    const slot0 = patch.uniforms.uCarveCenters.value[0] as Vector3;
    expect(slot0.x).toBe(1);
  });

  it('uncarve() removes via swap-remove and updates count', () => {
    const patch = new FragmentSdfShaderPatch();
    patch.carve('a', new Vector3(1, 0, 0), 0.1);
    patch.carve('b', new Vector3(2, 0, 0), 0.2);
    patch.carve('c', new Vector3(3, 0, 0), 0.3);

    expect(patch.uncarve('b')).toBe(true);

    expect(patch.count).toBe(2);
    expect(patch.uniforms.uCarveCount.value).toBe(2);
    expect(patch.has('b')).toBe(false);
    expect(patch.has('a')).toBe(true);
    expect(patch.has('c')).toBe(true);

    const keys = new Set<string>();
    for (let i = 0; i < patch.count; i++) {
      const v = patch.uniforms.uCarveCenters.value[i] as Vector3;
      if (v.x === 1) keys.add('a');
      if (v.x === 3) keys.add('c');
    }
    expect(keys.has('a')).toBe(true);
    expect(keys.has('c')).toBe(true);
  });

  it('uncarve() returns false for an unknown key without side effects', () => {
    const patch = new FragmentSdfShaderPatch();
    patch.carve('a', new Vector3(), 0.1);
    expect(patch.uncarve('unknown')).toBe(false);
    expect(patch.count).toBe(1);
  });

  it('respects the maxCarves cap', () => {
    const patch = new FragmentSdfShaderPatch(3);
    expect(patch.carve('a', new Vector3(), 0.1)).toBe(true);
    expect(patch.carve('b', new Vector3(), 0.1)).toBe(true);
    expect(patch.carve('c', new Vector3(), 0.1)).toBe(true);
    expect(patch.carve('d', new Vector3(), 0.1)).toBe(false);
    expect(patch.count).toBe(3);
  });

  it('rejects non-positive maxCarves', () => {
    expect(() => new FragmentSdfShaderPatch(0)).toThrow();
    expect(() => new FragmentSdfShaderPatch(-1)).toThrow();
  });
});
