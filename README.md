# splatcarve

> Carve 3D Gaussian Splat scenes at voxel resolution with **per-fragment** SDF masking — in the browser, without forking the renderer.

**Status**: 🟢 H2′ (per-fragment SDF mask) shipped. Carve mode produces sharp axis-aligned cube-shaped holes on real 3DGS scenes. Compare `?mask=fragment` (the breakthrough) against `?mask=splatedit` (the legacy per-splat path) to see the difference at a glance. 89/89 unit tests pass across 9 modules. Wave C+ commits: [`a343bd9`](https://github.com/stevekwon211/splatcarve/commit/a343bd9), [`98680d4`](https://github.com/stevekwon211/splatcarve/commit/98680d4), [`7389802`](https://github.com/stevekwon211/splatcarve/commit/7389802).

## What this is

A research-driven WebGPU experiment that answers three falsifiable questions about Gaussian Splatting:

1. **H1 — Picking.** Can a web-based 3DGS renderer be extended to identify the splat under the mouse cursor at sub-frame latency on a ~1M-splat scene? *(Partial — see Wave B dossier.)*
2. **H2 — Carve.** Can deleting splats grouped by a voxel grid produce a visually clean "hole" at interactive latency? *(Falsified for the obvious per-splat approach. See H2′ below.)*
3. **H2′ — Per-fragment carve breakthrough.** Can `THREE.Material.onBeforeCompile` be used to inject per-fragment SDF evaluation into Spark.js's compiled shader, producing truly clean cube-shaped carves on a real 3DGS scene without forking the renderer? *(**Yes, demonstrated.**)*
4. **H3 — Stack.** Can a nearest-neighbor splat-cluster copy fill an empty voxel cell with visually coherent material? *(Future work, Wave D.)*

The output is a single-page demo, a 30-second video, and a published walk-through of how each hypothesis fared.

## What this is NOT

- Not a Minecraft-style voxel engine. "Voxel" here means coordinate quantization (a snap-to-grid hash map), not a chunk system. See `docs/architecture/voxel-conceptual-model.md`.
- Not a production tool. The goal is to learn whether the technique works, not to ship a polished editor.
- Not a replacement for SuperSplat or PlayCanvas's editor — those are excellent at *splat-level* operations. splatcarve specifically explores **voxel-resolution carve/stack** plus the **per-fragment** rendering primitive that makes clean cubes possible.

---

## Technical breakthrough — per-fragment SDF mask on a 3DGS rasterizer

### The problem

3D Gaussian Splatting renders a scene as millions of anisotropic 3D Gaussian "splats." Each splat is a continuous, view-dependent contribution to many screen pixels — there is no surface to clip against, and the splat's footprint can be larger than any one voxel cell. As a result, the obvious approach to "carve a voxel cell" — *delete every splat whose center lies inside that cell* — is mathematically incapable of producing a clean cube-shaped hole:

- Splats whose center sits in the cell get fully removed, but their ellipsoid was also contributing to *neighboring* cells. Result: collateral darkening around the cube.
- Splats whose center is in a neighbor cell but whose 3σ ellipsoid extends *into* the carved cell are unaffected. Result: visible wisps inside the cube.

This is not a tuning problem. No σ multiplier (1σ, 3σ, 5σ) can make per-splat masking produce a sharp cube boundary, because the unit of action is wrong: splat-grained instead of pixel-grained. Spark.js's built-in `SplatEdit` + `SplatEditSdf` API hits the same wall — verified by reading the dyno modifier chain at `spark.module.js:12491`, where the SDF check operates on `gsplat.center` (one point per splat) rather than on per-fragment world position.

### The breakthrough

splatcarve injects per-fragment SDF evaluation directly into Spark's compiled fragment shader using Three.js's standard `Material.onBeforeCompile` hook — without forking Spark and without writing a custom rasterizer. Every fragment of every splat independently checks "is *this pixel's* reconstructed world position inside any carved voxel box?" and, if so, `discard;`s itself. The unit of action becomes the fragment, not the splat.

Visual result: axis-aligned cube-shaped holes with crisp edges at pixel resolution, zero wisps inside, zero collateral darkening outside. The mathematical limitation of per-splat masking is bypassed, not by changing splat granularity, but by changing the *level of the rendering pipeline* at which the mask is evaluated.

A side-by-side comparison is built into the demo: `?mask=fragment` (default, the breakthrough) vs `?mask=splatedit` (legacy per-splat baseline) — same scene, same clicks, dramatically different output.

### How it works

The implementation is split into a pure, TDD'd shader-patch class and a thin Spark integration wrapper:

| File | Role |
|---|---|
| `src/viewer/fragment-sdf-shader-patch.ts` | Owns the carve state and the GLSL-string injection logic. Pure, 12 tests, no Three.js mocks needed. |
| `src/viewer/fragment-sdf-carver.ts` | Hooks `SparkRenderer.material.onBeforeCompile`, maintains the per-frame `uClipToLocal` matrix, exposes the same `carve / uncarve / has / count` API as the legacy `SplatEditCarve`. |
| `src/main.ts` | Picks the carver based on the `?mask=` URL parameter so the A/B comparison stays one URL edit away. |

The injected GLSL adds four uniforms (one int count, two 256-slot arrays, one mat4) and rewrites the start of `main()`:

```glsl
// vertex shader — prepended
uniform mat4 uClipToLocal;
out vec3 vWorldPos;
// after the existing `vNdc = ndc;`
{
  vec4 vp = uClipToLocal * vec4(ndc, 1.0);
  vWorldPos = vp.xyz / vp.w;
}

// fragment shader — before `out vec4 fragColor;`
uniform int uCarveCount;
uniform vec3 uCarveCenters[256];
uniform float uCarveHalfExtents[256];
in vec3 vWorldPos;

// fragment shader — at the start of main(), before `vec4 rgba = vRgba;`
if (uCarveCount > 0) {
  for (int i = 0; i < 256; i++) {
    if (i >= uCarveCount) break;
    vec3 d = abs(vWorldPos - uCarveCenters[i]);
    float h = uCarveHalfExtents[i];
    if (d.x < h && d.y < h && d.z < h) discard;
  }
}
```

The string-injection anchors (`vNdc = ndc;`, `out vec4 fragColor;`, and `void main() {\n    vec4 rgba = vRgba;`) were discovered by a one-day recon spike documented in `docs/research/2026-05-19-spark-shader-hook-spike.md`, which captures the verbatim shaders Spark hands to the WebGL compiler. The patch class throws loudly if any anchor disappears — a future Spark version drift fails fast rather than silently degrading.

### Performance design

Two optimizations applied as a follow-up commit after the user reported stutter at ~28 simultaneous carves:

| Concern | Naive version | Optimized version |
|---|---|---|
| Matrix multiply | Per fragment (~2 M invocations / frame at 1080p × overdraw) | Per vertex (~4 × splat count / frame). Perspective-correct interpolation gives the fragment equivalent data for ~3–5× lower cost. |
| Loop bound | `for (i = 0; i < uCarveCount; i++)` — dynamic, can't unroll | `for (i = 0; i < 256; i++) if (i >= uCarveCount) break;` — constant upper bound, driver can unroll the prefix, early break preserves O(actualCount) work. |
| Per-carve recompile | None — the carve list lives in pre-allocated uniform slots, swap-removed on uncarve. `material.needsUpdate = true` fires only once, at `attach()`. |

### Limitations (honest)

- **256-box cap.** The uniform array is fixed-size. Real scenes may want 1024+; the next step is packing carve data into a data texture and sampling via `texelFetch`.
- **Two-sided geometry shows through.** A single click deletes one voxel cell. If the scene has a back-facing surface (e.g. the far wing of a butterfly capture), the user sees it through the front-facing hole. This is *correct* behavior given the voxel-grouping rule, not a bug; a "drill-through" tool that carves all cells along the view ray is a planned UX option.
- **Spark's 2DGS path is unpatched.** Spark's 2D Gaussian splat code path writes `vNdc` via a different assignment form not matched by our anchor. Carves while 2DGS is enabled may mis-mask. Production scenes (Inria, Polycam) don't use 2DGS; a second anchor is a future task if it ever matters.
- **Anchor-based string injection is fragile to upstream Spark changes.** A planned CI guard hashes the relevant shader region in `node_modules/@sparkjsdev/spark/dist/spark.module.js` and fails the build if it changes, forcing a recon refresh.

### Why this is novel (as far as we can tell)

The Wave-A research pass surveyed every public OSS 3DGS web renderer and editor we could find — Spark (built-in `SplatEdit`), PlayCanvas SuperSplat, mkkellogg/GaussianSplats3D, antimatter15/splat, KeKsBoTer/web-splat — plus the relevant 2024–2026 papers (VolSplat, GaussianOcc, GaussianFormer, Gaussian Grouping, 3DSceneEditor, SuGaR-Editor). All splat-editing systems we found operate at *splat granularity*. None evaluate a per-fragment SDF mask against the splat rasterizer's fragment output. The technique here is, to our knowledge, the first published per-fragment SDF carve on a real-time browser 3DGS rasterizer.

### Reproducibility

```bash
git clone https://github.com/stevekwon211/splatcarve.git
cd splatcarve
pnpm install
pnpm dev
# open http://localhost:5173/

# breakthrough mode (default):
#   http://localhost:5173/?mask=fragment
# legacy baseline for A/B:
#   http://localhost:5173/?mask=splatedit
```

In the running demo: press `2` to enter carve mode (cursor turns red), click on the butterfly. Compare the two modes on the same clicks; the difference is the H2′ result.

Full dossier under `docs/research/`:

- `2026-05-19-spark-shader-hook-spike.md` — the one-day recon that confirmed `onBeforeCompile` fires and captured the GLSL anchors.
- `2026-05-19-h2-partial-results.md` — the per-splat path being falsified.
- `2026-05-19-h2-breakthrough.md` — *(forthcoming, Wave C+.3)* the full breakthrough writeup with side-by-side captures, FPS table, and a possible upstream-PR sketch.

---

## Stack

- TypeScript + WebGPU + [@sparkjsdev/spark](https://sparkjs.dev/) 2.1 + three.js 0.184
- Vite for bundling, Vitest for tests (89/89 green), Prettier for formatting
- MIT license

## Keyboard / URL controls

| Action | Input |
|---|---|
| Orbit / zoom | drag / scroll |
| Pick mode (hover-snap to nearest splat) | `1` |
| Carve mode (click to carve a voxel) | `2` |
| Toggle voxel grid wireframe | `G` |
| Reset pick-latency stats | `R` |
| Undo / redo | `⌘Z` / `⌘⇧Z` (or `Ctrl+Y`) |
| Voxel resolution along longest AABB axis | `?vox=N` (default 64) |
| Carve backend (fragment = breakthrough, splatedit = legacy A/B) | `?mask=fragment` (default) / `?mask=splatedit` |
| Override splat URL | `?splat=https://…/scene.spz` |
| One-shot shader-hook diagnostic | `?spike=1` |

## Why this exists

The motivation, the literature survey of GS + voxel hybrid approaches, and the three Wave-A research-agent reports that informed the architecture all live under `docs/research/`. The conceptual clarification "voxel ≠ voxel engine" is in `docs/architecture/voxel-conceptual-model.md` — read that first.

## Plan & progress

The full phased plan with hypotheses, success criteria, risks, and verification is mirrored from the user's working plan into `docs/plan.md`.

| Wave | Goal | Status |
|---|---|---|
| A | Foundations & first light | ✅ shipped |
| B | Picking (H1) | ✅ partial (latency ✅, exact splat-ID partial) |
| C | Carve (H2) — per-splat baseline | 🟡 deliberately falsified, motivated C+ |
| **C+** | **Per-fragment SDF mask breakthrough (H2′)** | **✅ shipped — this README's centerpiece** |
| D | Stack (H3) | ⏸ pending |
| E | Polish, demo URL, video, dossiers | ⏸ pending |

## License

MIT — see [LICENSE](LICENSE).
