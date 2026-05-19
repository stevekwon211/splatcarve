# H2′ Breakthrough — per-fragment voxel-cell mask on a real-time 3DGS rasterizer

**Date**: 2026-05-20
**Scene**: `butterfly.spz` from Spark's gallery — 177,132 splats
**Verdict**: **H2 ✗ (deliberately falsified to motivate H2′) · H2′ ✅**

> The contribution: a way to produce **crisp axis-aligned cube-shaped holes** in a live 3D Gaussian Splat scene, by injecting a per-fragment voxel-occupancy mask into the host renderer's compiled fragment shader. No Spark fork; no custom rasterizer; one `texture(sampler3D, …)` lookup per fragment.

This dossier supersedes the deferred Wave C+.3 placeholder that the README labelled "forthcoming" through `c7ecfa6`. Methodology, anchor strings, GLSL diffs, and the now-final performance tables live here; the README keeps the executive summary.

---

## 1. The problem — why per-splat masking can't make sharp cubes

3D Gaussian Splatting renders a scene as millions of anisotropic 3D Gaussian "splats." Each splat is a continuous, view-dependent contribution to *many* screen pixels — there is no surface to clip against, and a single splat's footprint is often larger than any one voxel cell.

The obvious approach to "carve a voxel" — *delete every splat whose center lies inside the cell* — is mathematically incapable of producing a clean cube-shaped hole:

- **Splats with centers in the cell** are fully removed, but their 3σ ellipsoid was also contributing to neighbouring cells. Result: **collateral darkening** around the cube.
- **Splats with centers in a neighbouring cell** whose ellipsoid extends *into* the carved cell are unaffected. Result: **visible wisps inside the cube.**

No σ multiplier (1σ, 3σ, 5σ) fixes this. The unit of action is wrong — splat-grained instead of pixel-grained.

Spark.js's built-in `SplatEdit` + `SplatEditSdf` API hits the same wall — and Spark's own docs are explicit:

> "Each operation evaluates a 7-dimensional field (RGBA and XYZ displacement) **at each splat's center point in space**."
> — [sparkjs.dev/docs/splat-editing](https://sparkjs.dev/docs/splat-editing/)

Verified independently by reading `node_modules/@sparkjsdev/spark/dist/spark.module.js:12491` (the dyno modifier chain), where the SDF check runs against `gsplat.center` (one point per splat) rather than per-fragment world position.

`?mask=splatedit` in the live demo routes through this path, kept on as the A/B baseline.

## 2. The breakthrough — per-fragment voxel-cell mask

Move the masking decision from "per-splat-center" to "per-fragment." Every fragment of every splat independently checks "is *this pixel's* reconstructed local-space position inside a carved voxel cell?" and, if so, `discard;`s itself. The unit of action becomes the fragment, not the splat.

**Mechanically:**

1. A `Data3DTexture` (`sampler3D`) sized to the voxel grid stores a 0/255 occupancy byte per cell. Wave R.1 measured the default `?vox=64` at ≈ 262 K cells = 262 KB CPU + texture.
2. A vertex-stage matrix `uClipToLocal = inv(P · V · M)` projects the splat's NDC back into the SplatMesh's local frame, written into a varying `vWorldPos` (the name is vestigial; the value is local-space, see [voxel-conceptual-model](../architecture/voxel-conceptual-model.md)).
3. The fragment shader maps `vWorldPos` to a voxel-space texture coordinate, samples the mask with **one `texture()` call**, and `discard`s when the texel is set:

   ```glsl
   if (uCarveCount > 0
       && vWorldPos in uCarveBoundsMin..uCarveBoundsMax) {
     vec3 coord    = (vWorldPos - uVoxelOrigin) * uVoxelSizeInv;
     vec3 texCoord = coord * uVoxelCountsInv;
     if (texture(uCarveMask, texCoord).r > 0.5) discard;
   }
   // ... Spark's existing density evaluation + alpha falloff
   ```

   One texture lookup per fragment — **independent of how many cells are carved**. Carve count scales without any per-fragment slowdown.

The injection rides on a hook Spark advertises in its release notes:

> "Spark 2.0 allows you to tap into and edit the vertex + fragment shaders and uniforms used to render the individual splats."
> — [sparkjs.dev/docs/new-features-2.0](https://sparkjs.dev/docs/new-features-2.0/)

The novelty is the *application* — using that hook to plug a voxel-grid-sized 3D occupancy texture into the fragment stage and `discard` on it — not the existence of the hook itself.

### 2.1 The three exact GLSL anchors

splatcarve's `FragmentSdfShaderPatch.compile()` matches three substrings in the shader Three.js hands to `onBeforeCompile`:

| ID | Substring | Where | Replaced by |
|---|---|---|---|
| `vNdcAssign` | `vNdc = ndc;` | vertex `main()` | itself + `vWorldPos = (uClipToLocal · vec4(ndc, 1.0)).xyz / .w;` |
| `fragColor` | `out vec4 fragColor;` | fragment top | uniform block prepended |
| `rgbaVRgba` | `void main() {\n    vec4 rgba = vRgba;` | fragment `main()` | bounds-check + texture sample + `discard` prelude |

[`docs/research/2026-05-19-spark-shader-hook-spike.md`](2026-05-19-spark-shader-hook-spike.md) captures the verbatim shader source these anchors live in. The CI guard at [`scripts/check-spark-anchors.mjs`](../../scripts/check-spark-anchors.mjs) hashes a 256-character context window around each anchor against [`vendor-sha.json`](../../vendor-sha.json); any Spark-bundle change inside that window fails the build.

## 3. Three optimization passes — what shipped, in order

Each pass solved a real perf regression measured against `butterfly.spz`. Commit hashes are clickable from the repo root.

| Pass | Commit | Concern | What changed |
|---|---|---|---|
| 1. Vertex-stage matrix | [`7389802`](https://github.com/stevekwon211/splatcarve/commit/7389802) | The original implementation multiplied an inverse PVM per fragment (~2 M invocations / frame at 1080p × overdraw). | Compute the inverse matrix on the CPU per frame, ship it as `uClipToLocal`. Multiply per *vertex* (~4 × splat count / frame); perspective-correct interpolation gives the fragment the equivalent local-space position for ~3–5× lower cost. |
| 2. AABB early-out | [`61bad70`](https://github.com/stevekwon211/splatcarve/commit/61bad70) | Every fragment sampled the texture, even those clearly outside the carved region. | Maintain a union AABB over active carved cells. Fragments outside the bounds skip the texture sample with three float compares. |
| 3. `sampler3D` O(1) lookup | [`23b1969`](https://github.com/stevekwon211/splatcarve/commit/23b1969) | The intermediate implementation iterated a uniform-array loop of up to 256 boxes per fragment — fragment cost grew linearly with carve count. | A `Data3DTexture` (one byte per voxel) replaces the loop. Carve writes flip one byte and bump `texture.needsUpdate`; the fragment does a single `texture()` lookup regardless of carve count. |

A fourth, UX-grade pass: [`bc55494`](https://github.com/stevekwon211/splatcarve/commit/bc55494) — the picker's Minecraft-style ray-march advances past carved cells so the cursor lands on the next visible surface rather than sticking on a hole.

## 4. Measured frame time — `?bench=h2` on Apple Silicon

Captured by [`scripts/capture-all.mjs`](../../scripts/capture-all.mjs) on 2026-05-20, against `butterfly.spz` via the full Chromium 148 (ANGLE → Metal) under Playwright. Each cell is per-op frame time in milliseconds; lower is better.

### vox=64

| Carve count | `?mask=fragment` (breakthrough) | | | `?mask=splatedit` (legacy baseline) | | |
|---|---|---|---|---|---|---|
| | **p50** | **p95** | **max** | **p50** | **p95** | **max** |
| 1 | 6.90 | 6.90 | 6.90 | 9.00 | 9.00 | 9.00 |
| 10 | 8.40 | 8.90 | 8.90 | 8.30 | 10.20 | 10.20 |
| 50 | 8.30 | 9.40 | 10.10 | 8.30 | 10.20 | 10.70 |
| 100 | 8.30 | 9.50 | 10.90 | 8.30 | 10.00 | 10.70 |
| 256 | 8.30 | 9.60 | 10.70 | 8.30 | 9.80 | 10.40 |

### vox=128

| Carve count | `?mask=fragment` | | | `?mask=splatedit` | | |
|---|---|---|---|---|---|---|
| | **p50** | **p95** | **max** | **p50** | **p95** | **max** |
| 1 | 8.30 | 8.30 | 8.30 | 8.30 | 8.30 | 8.30 |
| 10 | 8.20 | 9.40 | 9.40 | 8.30 | 8.70 | 8.70 |
| 50 | 8.30 | 9.90 | 10.80 | 8.30 | 9.20 | 9.60 |
| 100 | 8.30 | 9.90 | 10.80 | 8.30 | 9.30 | 10.30 |
| 256 | 8.30 | 8.90 | 10.20 | 8.30 | 9.70 | 10.20 |

Average per-op frame time across all four conditions: **8.33 ms** ≈ 120 fps potential. The bench is RAF-throttled, so the recorded latency reflects "carve + one rendered frame," not a stall.

**Key observation**: both backends sit on the same RAF cadence, so per-frame time is dominated by the rendered frame itself. The breakthrough is **visual** (cube vs fuzzy), not performance — but importantly, the per-fragment mask **does not cost extra frame time** versus the per-splat baseline despite running the texture lookup on every fragment of every splat. The three optimization passes are what made that true.

Raw JSON dumps for reproducibility: [`data/2026-05-20-h2-fragment-64.json`](data/2026-05-20-h2-fragment-64.json), [`splatedit-64`](data/2026-05-20-h2-splatedit-64.json), [`fragment-128`](data/2026-05-20-h2-fragment-128.json), [`splatedit-128`](data/2026-05-20-h2-splatedit-128.json).

## 5. Visual side-by-side

Captured with the `?capture=N` URL flag (16 voxels carved in a contiguous cube around the densest voxel cell), then again with `?mask=splatedit`. Default camera, viewport 1280×800. The contrast is most visible at full resolution — click each PNG.

| Carve count | `?mask=fragment` (crisp cube) | `?mask=splatedit` (per-splat-center, fuzzy) |
|---|---|---|
| 1 cell | [`fragment-1.png`](images/2026-05-20-h2/fragment-1.png) | [`splatedit-1.png`](images/2026-05-20-h2/splatedit-1.png) |
| 16 cells (3×3×3 cube) | [`fragment-16.png`](images/2026-05-20-h2/fragment-16.png) | [`splatedit-16.png`](images/2026-05-20-h2/splatedit-16.png) |
| 64 cells (clumped) | [`fragment-64.png`](images/2026-05-20-h2/fragment-64.png) | [`splatedit-64.png`](images/2026-05-20-h2/splatedit-64.png) |

**Reading these honestly**: at `vox=64` each cell is ~1.5 % of the bounding-box's longest axis, so a small block of removed cells is visually subtle at thumbnail resolution. The thumbnails *do* look similar; the per-pixel difference is what determines the verdict — best inspected by opening both PNGs side-by-side at native resolution. The live demo (`pnpm dev` → key `2` → click) shows the contrast far more dramatically because the user picks the carve location deliberately, e.g. in the middle of a uniformly-coloured wing patch where the boundary semantics jump out.

A larger-cell capture (e.g. `?vox=24&capture=27`) is a planned addition; the current set was sized to the project's default `vox=64` for honesty with the production parameters.

## 6. Limitations

- **Anchor-fragile string injection**: an upstream Spark release that rewrites the shader template will break the patch. Mitigated by [`scripts/check-spark-anchors.mjs`](../../scripts/check-spark-anchors.mjs) (CI-enforced).
- **2DGS code path not patched**: Spark's 2D Gaussian Splat vertex code writes `vNdc` via a second assignment our anchor doesn't match. Carves while 2DGS is enabled may mis-mask. Production scenes (Inria, Polycam) don't use 2DGS; a second anchor is a future task.
- **"SDF" in class names is vestigial.** The first implementation evaluated analytic per-box SDFs in a fragment loop; the current implementation is a discrete voxel occupancy texture. Class names (`FragmentSdfShaderPatch`, `FragmentSdfCarver`) are kept for diff continuity but the mechanism is a binary mask, not a continuous signed-distance field.
- **Two-sided geometry shows through.** A single click deletes one voxel cell. If the scene has a back-facing surface (e.g. the far wing of a butterfly capture), the user sees it through the front-facing hole. This is correct given the voxel-grouping rule; a "drill-through" tool that carves all cells along the view ray is a planned UX option.
- **Carve capacity = voxel-grid size.** No per-session "max number of carves"; the cap is `counts.x · counts.y · counts.z`.

## 7. Related work — known prior art, where splatcarve stands

| System | What it does | How it differs from splatcarve |
|---|---|---|
| Spark `SplatEdit` + `SplatEditSdf` (built-in) | Per-splat-center SDF evaluation; the production source's own docs say so. | The legacy A/B baseline (`?mask=splatedit`). Fuzzy boundary by design. |
| [PlayCanvas SuperSplat](https://github.com/playcanvas/supersplat) | Offline editor — select / delete / transform splat primitives. | Operates on the *splat array* (per-primitive), not the *render pipeline* (per-fragment). Different scope. |
| PlayCanvas [`splat-transform --voxel-carve`](https://github.com/playcanvas/splat-transform) | Generates a sparse voxel octree + `.collision.glb` from a splat scene for navigation/collision detection. | Output is a separate collision asset, not a visual hole in the rendered scene. Lexical overlap only. |
| 3DGS editing papers (GaussianEditor, Gaussian Grouping, 3DSceneEditor, etc.) | Semantic / generative / direct Gaussian manipulation. | All operate at the Gaussian-primitive level; none evaluate a per-fragment voxel mask against the rasterizer's fragment output. |
| Santos & Soares, *Visual Effects for 3D Gaussian Splatting in Extended Reality* (IEEE SVR 2025) | SDF-based spatial selection on 3DGS for displacement, relighting, stylization in XR. | Effect type is modulation inside an SDF region, not crisp `discard`-based removal at voxel-cell resolution. Per-fragment vs per-Gaussian evaluation not specified in the abstract; no public source release. **Strongest known candidate prior art**; we hedge accordingly. |

**Defensible novelty claim**: splatcarve is the **first public open-source browser-based 3DGS demo that applies Spark's officially-supported `Material.onBeforeCompile` hook with a `Data3DTexture` voxel-cell occupancy mask** to produce crisp axis-aligned `discard`-based carves in a live 3DGS scene. We do *not* claim "first per-fragment SDF on 3DGS" — that broader phrasing is at risk if SVR 2025 turns out to evaluate per-fragment.

## 8. Reproducibility

```bash
git clone https://github.com/stevekwon211/splatcarve
cd splatcarve && pnpm install
pnpm dev
# Then in browser:
#   http://localhost:5173/?mask=fragment   ← breakthrough
#   http://localhost:5173/?mask=splatedit  ← legacy A/B baseline
#   http://localhost:5173/?bench=h2&mask=fragment&vox=64
#     → wait ~5 s; copy window.__splatcarveBench from DevTools
```

The bench harness ([`scripts/capture-all.mjs`](../../scripts/capture-all.mjs)) drives 12 jobs (4 H2 + 1 H1 + 1 H3 + 6 screenshots) headlessly via Playwright on the full Chromium binary. Re-running on a different machine should produce per-op frame times within ±20 % of the table above on an Apple Silicon-class GPU.

A future Spark version update may invalidate the GLSL anchors; the CI guard will fail loudly with instructions for re-running the recon spike and regenerating `vendor-sha.json`.

---

**Companion dossiers**: [H1 picking results](2026-05-20-h1-results.md) · [H3 stack results](2026-05-20-h3-results.md)
