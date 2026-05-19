import { Box3, Data3DTexture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { FragmentSdfShaderPatch } from './fragment-sdf-shader-patch.ts';
import { VoxelGrid } from './voxel-grid.ts';

/**
 * Anchor-bearing fragment shader fixture mirroring Spark v2.1.0's two
 * critical landmarks: the `out vec4 fragColor;` declaration (uniforms go
 * before it) and the `void main() {\n    vec4 rgba = vRgba;\n` opener
 * (SDF discard goes before `vec4 rgba`).
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

function makeGrid(): VoxelGrid {
  return VoxelGrid.fromAABB(new Box3(new Vector3(0, 0, 0), new Vector3(4, 4, 4)), 4);
}

describe('FragmentSdfShaderPatch — construction', () => {
  it('allocates a Data3DTexture sized from the voxel grid', () => {
    const grid = makeGrid();
    const patch = new FragmentSdfShaderPatch(grid);

    const tex = patch.uniforms.uCarveMask.value;
    expect(tex).toBeInstanceOf(Data3DTexture);
    expect(tex.image.width).toBe(grid.counts.x);
    expect(tex.image.height).toBe(grid.counts.y);
    expect(tex.image.depth).toBe(grid.counts.z);
    const data = tex.image.data as Uint8Array | null;
    expect(data).not.toBeNull();
    expect((data as Uint8Array).length).toBe(grid.counts.x * grid.counts.y * grid.counts.z);
  });

  it('initialises every texel to zero (not carved)', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const data = patch.uniforms.uCarveMask.value.image.data as Uint8Array;
    for (let n = 0; n < data.length; n++) expect(data[n]).toBe(0);
  });

  it('exposes the grid-derived voxel uniforms for fragment world→voxel lookup', () => {
    const grid = makeGrid();
    const patch = new FragmentSdfShaderPatch(grid);

    expect(patch.uniforms.uVoxelOrigin.value.x).toBeCloseTo(grid.origin.x);
    expect(patch.uniforms.uVoxelOrigin.value.y).toBeCloseTo(grid.origin.y);
    expect(patch.uniforms.uVoxelOrigin.value.z).toBeCloseTo(grid.origin.z);

    expect(patch.uniforms.uVoxelSizeInv.value).toBeCloseTo(1 / grid.voxelSize);

    expect(patch.uniforms.uVoxelCountsInv.value.x).toBeCloseTo(1 / grid.counts.x);
    expect(patch.uniforms.uVoxelCountsInv.value.y).toBeCloseTo(1 / grid.counts.y);
    expect(patch.uniforms.uVoxelCountsInv.value.z).toBeCloseTo(1 / grid.counts.z);
  });
});

describe('FragmentSdfShaderPatch — carve / uncarve via texture', () => {
  it('writes 255 into the texel at (i, j, k) on carve()', () => {
    const grid = makeGrid();
    const patch = new FragmentSdfShaderPatch(grid);
    const tex = patch.uniforms.uCarveMask.value;
    const versionBefore = tex.version;
    expect(patch.carve('1|2|3', 1, 2, 3)).toBe(true);

    const w = grid.counts.x;
    const h = grid.counts.y;
    const data = patch.uniforms.uCarveMask.value.image.data as Uint8Array;
    const linear = 1 + 2 * w + 3 * w * h;
    expect(data[linear]).toBe(255);
    expect(tex.version).toBeGreaterThan(versionBefore);
    expect(patch.count).toBe(1);
    expect(patch.has('1|2|3')).toBe(true);
  });

  it('resets the texel on uncarve()', () => {
    const grid = makeGrid();
    const patch = new FragmentSdfShaderPatch(grid);
    patch.carve('1|2|3', 1, 2, 3);
    const tex = patch.uniforms.uCarveMask.value;
    const versionBefore = tex.version;
    expect(patch.uncarve('1|2|3')).toBe(true);

    const w = grid.counts.x;
    const h = grid.counts.y;
    const data = tex.image.data as Uint8Array;
    expect(data[1 + 2 * w + 3 * w * h]).toBe(0);
    expect(tex.version).toBeGreaterThan(versionBefore);
    expect(patch.count).toBe(0);
    expect(patch.has('1|2|3')).toBe(false);
  });

  it('returns false on a duplicate carve key', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    patch.carve('a', 1, 1, 1);
    expect(patch.carve('a', 1, 1, 1)).toBe(false);
  });

  it('returns false on uncarve of an unknown key', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    expect(patch.uncarve('nope')).toBe(false);
  });

  it('updates the union AABB as carves come and go', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    patch.carve('a', 1, 1, 1);
    patch.carve('b', 3, 3, 3);

    const min = patch.uniforms.uCarveBoundsMin.value;
    const max = patch.uniforms.uCarveBoundsMax.value;
    // Voxel (1,1,1) center = (1.5, 1.5, 1.5), half = 0.5 → world bbox [1, 2].
    // Voxel (3,3,3) center = (3.5, 3.5, 3.5) → [3, 4]. Union: [1, 4].
    expect(min.x).toBeCloseTo(1);
    expect(max.x).toBeCloseTo(4);

    patch.uncarve('b');
    expect(max.x).toBeCloseTo(2);
  });

  it('clamps out-of-grid voxel indices safely (writes nothing, returns false)', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    expect(patch.carve('oob', -1, 0, 0)).toBe(false);
    expect(patch.carve('oob2', 99, 0, 0)).toBe(false);
    expect(patch.count).toBe(0);
  });
});

describe('FragmentSdfShaderPatch.compile — shader injection', () => {
  it('declares sampler3D + voxel-mapping uniforms in the fragment shader', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const shader = makeShader();
    patch.compile(shader);

    expect(shader.fragmentShader).toContain('uniform sampler3D uCarveMask');
    expect(shader.fragmentShader).toContain('uniform vec3 uVoxelOrigin');
    expect(shader.fragmentShader).toContain('uniform float uVoxelSizeInv');
    expect(shader.fragmentShader).toContain('uniform vec3 uVoxelCountsInv');
    expect(shader.fragmentShader).toContain('uniform vec3 uCarveBoundsMin');
    expect(shader.fragmentShader).toContain('uniform vec3 uCarveBoundsMax');
    expect(shader.fragmentShader).toContain('uniform int uCarveCount');
    expect(shader.fragmentShader).toContain('in vec3 vWorldPos;');
  });

  it('injects a single texture lookup, not a loop', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const shader = makeShader();
    patch.compile(shader);

    expect(shader.fragmentShader).toContain('texture(uCarveMask');
    expect(shader.fragmentShader).toContain('discard');
    expect(shader.fragmentShader).not.toMatch(/for\s*\(int i/);
    expect(shader.fragmentShader).not.toContain('uCarveCenters[');
  });

  it('gates the texture lookup on the union AABB early-out', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const shader = makeShader();
    patch.compile(shader);

    const boundsIdx = shader.fragmentShader.indexOf('uCarveBoundsMin');
    const sampleIdx = shader.fragmentShader.indexOf('texture(uCarveMask');
    expect(boundsIdx).toBeGreaterThan(-1);
    expect(sampleIdx).toBeGreaterThan(-1);
    expect(boundsIdx).toBeLessThan(sampleIdx);
  });

  it('moves the world-position computation to the vertex stage', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const shader = makeShader();
    patch.compile(shader);

    expect(shader.vertexShader).toContain('uniform mat4 uClipToLocal');
    expect(shader.vertexShader).toContain('out vec3 vWorldPos');
    expect(shader.vertexShader).toContain('uClipToLocal * vec4(ndc, 1.0)');
    expect(shader.fragmentShader).not.toContain('uniform mat4 uClipToLocal');
  });

  it('attaches every uniform onto shader.uniforms by reference', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const shader = makeShader();
    patch.compile(shader);

    for (const k of [
      'uCarveCount',
      'uCarveMask',
      'uCarveBoundsMin',
      'uCarveBoundsMax',
      'uClipToLocal',
      'uVoxelOrigin',
      'uVoxelSizeInv',
      'uVoxelCountsInv',
    ]) {
      expect(shader.uniforms[k]).toBe(
        patch.uniforms[k as keyof typeof patch.uniforms],
      );
    }
  });

  it('throws if expected fragment anchors are missing', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const broken = makeShader('void main() { fragColor = vec4(1.0); }');
    expect(() => patch.compile(broken)).toThrow();
  });

  it('throws if the vertex anchor is missing', () => {
    const patch = new FragmentSdfShaderPatch(makeGrid());
    const broken = makeShader(SPARK_LIKE_FS, 'void main() { gl_Position = vec4(0); }');
    expect(() => patch.compile(broken)).toThrow();
  });
});
