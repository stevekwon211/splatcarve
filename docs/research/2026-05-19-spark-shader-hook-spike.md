# Wave C+.1 — Spark shader-hook recon spike outcome

> **Date:** 2026-05-19.
> **Status:** ✅ `Material.onBeforeCompile` fires on `SparkRenderer.material`. Wave C+.2 is unblocked. No Spark fork required.

## Question

Can we inject per-fragment SDF evaluation into Spark's splat shader without forking Spark?

## Answer

**Yes.** Three.js's standard `Material.onBeforeCompile` hook fires on Spark's internal `THREE.ShaderMaterial` and lets us modify `shader.vertexShader`, `shader.fragmentShader`, and `shader.uniforms` before compile.

## How we found the hook

The first attempt traversed `SplatMesh` and found no material — because `SplatMesh extends SplatGenerator extends THREE.Object3D`, not `THREE.Mesh`. SplatMesh is a *data generator*, not the render mesh.

The actual render mesh is **`SparkRenderer`**, confirmed by reading `node_modules/@sparkjsdev/spark/dist/types/SparkRenderer.d.ts`:

```ts
export declare class SparkRenderer extends THREE.Mesh {
    readonly renderer: THREE.WebGLRenderer;
    readonly material: THREE.ShaderMaterial;  // ← the hook target
    ...
}
```

`SparkRenderer` is the THREE.Mesh added to the scene via `scene.add(spark)`. It owns the single ShaderMaterial used to rasterize every splat from every SplatMesh in the scene. **One material, one fragment shader — patch it once, every splat gets the per-fragment SDF mask.**

Bonus discovery: `SparkRendererOptions` already exposes `vertexShader?: string`, `fragmentShader?: string`, and `extraUniforms?: Record<string, unknown>` for officially-supported shader replacement. If `onBeforeCompile` ever stops working, we have this as Plan B without a fork.

## Verified at runtime

With `?spike=1` in the URL, the recon spike printed:

- `[spike] candidate: SparkRenderer.material type=ShaderMaterial`
- `[spike] onBeforeCompile #1 (SparkRenderer.material)` fired during the first render
- `[spike] post-tick: 1 compiles fired`

## Captured artifacts

### Uniforms (29 total)

```
renderSize, near, far, renderToViewQuat, renderToViewPos, renderToViewBasis,
renderToViewOffset, maxStdDev, minPixelRadius, maxPixelRadius, minAlpha,
enable2DGS, lodInflate, preBlurAmount, blurAmount, focalDistance, apertureAngle,
falloff, clipXY, focalAdjustment, encodeLinear, ordering, enableExtSplats,
enableCovSplats, extSplats, extSplats2, time, deltaTime, debugFlag
```

Notably **absent** from this list but auto-injected by Three.js because the shaders reference them: `projectionMatrix`, `modelViewMatrix`, `viewMatrix`, `modelMatrix`, `cameraPosition`. (`ShaderMaterial` does this; `RawShaderMaterial` does not.)

### Fragment shader (1492 chars, full source)

```glsl
precision highp float;
precision highp int;

#include <splatDefines>

uniform float near;
uniform float far;
uniform bool encodeLinear;
uniform float time;
uniform bool debugFlag;
uniform float maxStdDev;
uniform float minAlpha;
uniform bool disableFalloff;
uniform float falloff;

out vec4 fragColor;

in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in uint vSplatIndex;
flat in float adjustedStdDev;

#include <logdepthbuf_pars_fragment>

void main() {
    vec4 rgba = vRgba;

    float z2 = dot(vSplatUv, vSplatUv);
    if (z2 > (adjustedStdDev * adjustedStdDev)) {
        discard;
    }

    if (false) {
        float a = rgba.a;
        float shifted = sqrt(z2) - max(0.0, a - 1.0);
        float exponent = -0.5 * max(1.0, a) * sqr(max(0.0, shifted));
        float min1a = min(1.0, a);
        rgba.a = mix(min1a, min1a * exp(exponent), falloff);
    } else {
        if (rgba.a <= 1.0) {
            rgba.a = mix(rgba.a, rgba.a * exp(-0.5 * z2), falloff);
        } else {
            float a = exp((rgba.a*rgba.a - 1.0) / 2.718281828459045);
            float alpha = 1.0 - pow(1.0 - exp(-0.5 * z2), a);
            rgba.a = mix(1.0, alpha, falloff);
        }
    }

    if (rgba.a < minAlpha) {
        discard;
    }
    if (encodeLinear) {
        rgba.rgb = srgbToLinear(rgba.rgb);
    }

    #ifdef PREMULTIPLIED_ALPHA
        fragColor = vec4(rgba.rgb * rgba.a, rgba.a);
    #else
        fragColor = rgba;
    #endif

    #include <logdepthbuf_fragment>
}
```

**Key observations for C+.2:**

- `in vec3 vNdc;` — interpolated NDC coordinates per fragment. **Combined with `inverse(projectionMatrix * viewMatrix)`, this gives us per-fragment world position.** No varying additions to the vertex shader needed.
- `void main() {\n    vec4 rgba = vRgba;` — unique, stable anchor for our string replace. Insert SDF discard just before this line.
- `precision highp float;` is the file's first declaration — we have control over uniform precision.

### Vertex shader — relevant bits

The vertex shader is 7551 chars; the relevant section that computes the splat's NDC position is:

```glsl
vec3 ndcCenter = clipCenter.xyz / clipCenter.w;
vec3 ndc = vec3(ndcCenter.xy + ndcOffset, ndcCenter.z);
vNdc = ndc;
gl_Position = vec4(ndc.xy * clipCenter.w, clipCenter.zw);
```

So `vNdc.z` is the splat's NDC depth (constant per splat across its quad), and `vNdc.xy` is the per-fragment NDC x/y (varies as the quad is interpolated).

Reconstructing per-fragment world position:

```
clipPos = vec4(vNdc, 1.0)
worldPos = inverse(projectionMatrix * viewMatrix * meshMatrixWorld) * clipPos
worldPos /= worldPos.w
```

Since splatcarve adds the SplatMesh to the scene with identity transform, `meshMatrixWorld = I` and world = local. We can therefore pass a single combined `uClipToLocal = inverse(projectionMatrix * viewMatrix)` uniform from JS, recomputed each frame.

## Injection plan for C+.2

**Fragment shader, two `string.replace()` calls:**

1. **Add uniforms** — insert before `out vec4 fragColor;`:
   ```glsl
   uniform int uCarveCount;
   uniform vec3 uCarveCenters[256];
   uniform float uCarveHalfExtents[256];
   uniform mat4 uClipToLocal;
   ```

2. **Inject SDF discard loop** — replace `void main() {\n    vec4 rgba = vRgba;` with:
   ```glsl
   void main() {
       if (uCarveCount > 0) {
           vec4 worldH = uClipToLocal * vec4(vNdc, 1.0);
           vec3 localPos = worldH.xyz / worldH.w;
           for (int i = 0; i < uCarveCount; i++) {
               vec3 d = abs(localPos - uCarveCenters[i]);
               float h = uCarveHalfExtents[i];
               if (d.x < h && d.y < h && d.z < h) {
                   discard;
               }
           }
       }
       vec4 rgba = vRgba;
   ```

**Vertex shader: no changes.** `vNdc` is already exported.

**JS side:**

- Initial uniforms when `onBeforeCompile` fires:
  - `uCarveCount: { value: 0 }`
  - `uCarveCenters: { value: new Array(256).fill(null).map(() => new Vector3()) }`
  - `uCarveHalfExtents: { value: new Float32Array(256) }`
  - `uClipToLocal: { value: new Matrix4() }`
- In the animation loop (or `onBeforeRender`):
  - `uClipToLocal.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld).invert()` — recompute each frame.

## Risk addressed

- ✅ `onBeforeCompile` actually fires.
- ✅ Three.js auto-binds `projectionMatrix`, `viewMatrix`, etc. (we'll pass our own `uClipToLocal` for clarity).
- ✅ Anchor strings are stable: `void main() {\n    vec4 rgba = vRgba;` is a unique substring in Spark's fragment shader.
- ⚠️ Spark version updates may rewrite the shader. We will commit a CI check that hashes the relevant substring (separate task, post-C+.3).

## Decision: proceed to C+.2

The fallback path (vendor Spark source) is now unused. The breakthrough is reachable through the cleanest possible route: a single `onBeforeCompile` callback on a single ShaderMaterial.
