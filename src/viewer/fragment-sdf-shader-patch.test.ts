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

interface Shader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, unknown>;
}

function makeShader(fragment = SPARK_LIKE_FS, vertex = 'void main(){}'): Shader {
  return { vertexShader: vertex, fragmentShader: fragment, uniforms: {} };
}

describe('FragmentSdfShaderPatch.compile — fragment shader injection', () => {
  it('adds the four uniform declarations before `out vec4 fragColor;`', () => {
    const patch = new FragmentSdfShaderPatch();
    const shader = makeShader();
    patch.compile(shader);

    expect(shader.fragmentShader).toContain('uniform int uCarveCount');
    expect(shader.fragmentShader).toContain('uniform vec3 uCarveCenters[256]');
    expect(shader.fragmentShader).toContain('uniform float uCarveHalfExtents[256]');
    expect(shader.fragmentShader).toContain('uniform mat4 uClipToLocal');

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

    expect(shader.fragmentShader).toContain('uClipToLocal * vec4(vNdc, 1.0)');
    expect(shader.fragmentShader).toContain('for (int i = 0; i < uCarveCount');
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

  it('does not touch the vertex shader', () => {
    const patch = new FragmentSdfShaderPatch();
    const shader = makeShader(SPARK_LIKE_FS, 'untouched vertex source');
    patch.compile(shader);
    expect(shader.vertexShader).toBe('untouched vertex source');
  });

  it('throws if the expected fragment-shader anchors are missing', () => {
    const patch = new FragmentSdfShaderPatch();
    const broken = makeShader('void main() { fragColor = vec4(1.0); }');
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
