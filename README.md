# splatcarve

[![CI](https://github.com/stevekwon211/splatcarve/actions/workflows/ci.yml/badge.svg)](https://github.com/stevekwon211/splatcarve/actions/workflows/ci.yml)

> Carve 3D Gaussian Splat scenes at voxel resolution with **per-fragment** SDF masking — in the browser, without forking the renderer.

**Status**: 🟢 All four hypotheses evaluated against `butterfly.spz` (177 K splats). 163/163 unit tests across 15 modules; CI green; per-fragment carve and per-cluster stack both shipped in-browser.

## Hypothesis verdicts

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **H1 — Picking.** Identify a specific splat under the cursor at < 10 ms p95. | ✅ partial — latency met, snap-to-voxel works | [`2026-05-20-h1-results.md`](docs/research/2026-05-20-h1-results.md) · p95 **5.30 ms**, 49 / 200 NDC samples produced a unique-splat hit |
| **H2 — Per-splat carve.** Delete splats grouped by voxel to produce a clean hole. | ✗ deliberately — motivated H2′ | [`2026-05-19-h2-partial-results.md`](docs/research/2026-05-19-h2-partial-results.md) · per-splat-center masking can't make a sharp cube, by construction. Kept as `?mask=splatedit` A/B baseline. |
| **H2′ — Per-fragment voxel-cell mask.** Inject a `sampler3D` carve mask into Spark's compiled fragment shader without forking. | ✅ shipped | [`2026-05-20-h2-breakthrough.md`](docs/research/2026-05-20-h2-breakthrough.md) · p95 **9.6 ms** at 256 carves; O(1) per-fragment cost via `Data3DTexture` lookup |
| **H3 — Stack.** Copy a nearest-neighbour splat cluster into an empty adjacent voxel; FPS holds. | ✅ partial — mechanics work, visual coherence subjective | [`2026-05-20-h3-results.md`](docs/research/2026-05-20-h3-results.md) · p95 **10.6 ms** across 200-op session; 121 / 200 ops committed; 4 735 splats stacked |

Wave C+ commits behind H2′: [`a343bd9`](https://github.com/stevekwon211/splatcarve/commit/a343bd9) (spike) → [`98680d4`](https://github.com/stevekwon211/splatcarve/commit/98680d4) (initial injection) → [`7389802`](https://github.com/stevekwon211/splatcarve/commit/7389802) (vertex matrix) → [`61bad70`](https://github.com/stevekwon211/splatcarve/commit/61bad70) (AABB early-out) → [`23b1969`](https://github.com/stevekwon211/splatcarve/commit/23b1969) (`sampler3D` O(1) lookup, current architecture).

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

## Technical breakthrough — per-fragment voxel-cell mask on a 3DGS rasterizer

### The problem

3D Gaussian Splatting renders a scene as millions of anisotropic 3D Gaussian "splats." Each splat is a continuous, view-dependent contribution to many screen pixels — there is no surface to clip against, and the splat's footprint can be larger than any one voxel cell. As a result, the obvious approach to "carve a voxel cell" — *delete every splat whose center lies inside that cell* — is mathematically incapable of producing a clean cube-shaped hole:

- Splats whose center sits in the cell get fully removed, but their ellipsoid was also contributing to *neighboring* cells. Result: collateral darkening around the cube.
- Splats whose center is in a neighbor cell but whose 3σ ellipsoid extends *into* the carved cell are unaffected. Result: visible wisps inside the cube.

This is not a tuning problem. No σ multiplier (1σ, 3σ, 5σ) can make per-splat masking produce a sharp cube boundary, because the unit of action is wrong: splat-grained instead of pixel-grained. Spark.js's built-in `SplatEdit` + `SplatEditSdf` API hits the same wall — and Spark's own docs say so: *"Each operation evaluates a 7-dimensional field (RGBA and XYZ displacement) at each splat's center point in space"* ([sparkjs.dev/docs/splat-editing](https://sparkjs.dev/docs/splat-editing/)). Verified independently by reading Spark's dyno modifier chain at `spark.module.js:12491`, where the SDF check operates on `gsplat.center` (one point per splat) rather than on per-fragment world position.

### The breakthrough

splatcarve moves the masking decision from "per-splat-center" to "per-fragment." Every fragment of every splat independently checks "is *this pixel's* reconstructed local-space position inside a carved voxel cell?" and, if so, `discard;`s itself. The unit of action becomes the fragment, not the splat.

Mechanically: a `Data3DTexture` (`sampler3D`) sized to the voxel grid stores a 0/255 occupancy byte per cell. The fragment shader reconstructs its per-fragment local position from a vertex-stage `uClipToLocal` matrix, maps it to a voxel-space texture coordinate, samples the mask with one `texture()` call, and `discard`s when the texel is set. One texture lookup per fragment — no per-cell loop, no recompilation when carves change. ("SDF" survives in some class names from the design lineage; the live implementation is a discrete voxel occupancy mask, not a continuous signed-distance field.)

The injection itself rides on a hook Spark advertises: *"Spark 2.0 allows you to tap into and edit the vertex + fragment shaders and uniforms used to render the individual splats"* ([sparkjs.dev/docs/new-features-2.0](https://sparkjs.dev/docs/new-features-2.0/)). The novel part is the *application* — using that hook to plug a voxel-grid-sized 3D occupancy texture into the fragment stage and `discard` on it for crisp axis-aligned removal — not the existence of the hook itself. No Spark fork; no custom rasterizer.

Visual result: axis-aligned cube-shaped holes with crisp edges at pixel resolution, zero wisps inside, zero collateral darkening outside. The mathematical limitation of per-splat masking is bypassed by changing the *level of the rendering pipeline* at which the mask is evaluated, not by changing splat granularity.

A side-by-side comparison is built into the demo: `?mask=fragment` (default, the breakthrough) vs `?mask=splatedit` (legacy per-splat baseline) — same scene, same clicks, dramatically different output.

### How it works

The implementation is split into a pure, TDD'd shader-patch class and a thin Spark integration wrapper:

| File | Role |
|---|---|
| `src/viewer/fragment-sdf-shader-patch.ts` | Owns the carve state (a `Uint8Array`-backed `Data3DTexture` plus a union AABB over the active cells) and the GLSL-string injection. Pure, 16 tests, no Three.js mocks needed. |
| `src/viewer/fragment-sdf-carver.ts` | Hooks `SparkRenderer.material.onBeforeCompile`, maintains the per-frame `uClipToLocal` matrix, exposes the same `carve / uncarve / has / count` API as the legacy `SplatEditCarve`. |
| `src/main.ts` | Picks the carver based on the `?mask=` URL parameter so the A/B comparison stays one URL edit away. |

The injected GLSL adds a `sampler3D` carve mask (sized exactly to the voxel grid), a union AABB for early-out, and the local-space reconstruction matrix:

```glsl
// vertex shader — prepended
uniform mat4 uClipToLocal;
out vec3 vWorldPos;
// after the existing `vNdc = ndc;`
{
    vec4 vp = uClipToLocal * vec4(ndc, 1.0);
    vWorldPos = vp.xyz / vp.w;   // local-space; name kept for diff readability
}

// fragment shader — inserted before `out vec4 fragColor;`
uniform int       uCarveCount;
uniform sampler3D uCarveMask;       // 0/255 occupancy, one byte per voxel
uniform vec3      uCarveBoundsMin;  // union AABB over active cells (early-out)
uniform vec3      uCarveBoundsMax;
uniform vec3      uVoxelOrigin;
uniform float     uVoxelSizeInv;
uniform vec3      uVoxelCountsInv;
in vec3 vWorldPos;

// fragment shader — at the start of main(), before `vec4 rgba = vRgba;`
if (uCarveCount > 0
    && vWorldPos.x >= uCarveBoundsMin.x && vWorldPos.x <= uCarveBoundsMax.x
    && vWorldPos.y >= uCarveBoundsMin.y && vWorldPos.y <= uCarveBoundsMax.y
    && vWorldPos.z >= uCarveBoundsMin.z && vWorldPos.z <= uCarveBoundsMax.z) {
    vec3 coord    = (vWorldPos - uVoxelOrigin) * uVoxelSizeInv;
    vec3 texCoord = coord * uVoxelCountsInv;
    if (texture(uCarveMask, texCoord).r > 0.5) discard;
}
```

A carve flips one byte in the backing `Uint8Array`, sets `uCarveMask.needsUpdate = true`, and expands the union AABB. No shader recompilation per carve; the texture's `version` bump is the only GPU-visible change. Carve count scales without any per-fragment slowdown.

The string-injection anchors (`vNdc = ndc;`, `out vec4 fragColor;`, and `void main() {\n    vec4 rgba = vRgba;`) were discovered by a one-day recon spike documented in `docs/research/2026-05-19-spark-shader-hook-spike.md`, which captures the verbatim shaders Spark hands to the WebGL compiler. The patch class throws loudly if any anchor disappears — a future Spark version drift fails fast rather than silently degrading.

### Performance design

The current implementation arrived after three perf passes against measured FPS regressions in real carve sessions:

| Concern | Naive version | Current version (in order shipped) |
|---|---|---|
| Local-space reconstruction | Per fragment — invert the camera+model matrix and multiply by NDC at every fragment | Per vertex via `uClipToLocal · vec4(ndc, 1.0)` + perspective-correct interpolation. ~4 × splat count / frame instead of ~pixels / frame. ([`7389802`](https://github.com/stevekwon211/splatcarve/commit/7389802)) |
| Fragments outside any carved region | Always pay the mask test | Union AABB over active cells; fragments outside the AABB skip the texture sample entirely with three float compares. ([`61bad70`](https://github.com/stevekwon211/splatcarve/commit/61bad70)) |
| Carve count scaling | `for (i = 0; i < uCarveCount; i++) { box test }` — fragment cost grows with `uCarveCount` | Single `texture(uCarveMask, texCoord).r > 0.5` lookup against a `sampler3D` sized to the voxel grid. **O(1) per fragment regardless of carve count.** ([`23b1969`](https://github.com/stevekwon211/splatcarve/commit/23b1969)) |
| Per-carve GPU work | Recompile the shader on each new carve | One byte written into the backing `Uint8Array`; `texture.needsUpdate = true` triggers Three.js's incremental upload. `material.needsUpdate` fires exactly once, at `attach()`. |
| Picker UX past carved cells | Cursor sticks on already-carved voxels | Minecraft-style ray-march in `findFirstSurfaceVoxel` advances past carved cells onto the next visible surface. ([`bc55494`](https://github.com/stevekwon211/splatcarve/commit/bc55494)) |

### Limitations (honest)

- **Carve capacity = voxel-grid size.** The `Data3DTexture` is `counts.x · counts.y · counts.z` bytes — 262 K cells at the default `?vox=64`, scaling cubically with resolution. Each cell is independently carve-able. There is no per-session "max number of carves" cap; the cap is the grid resolution itself.
- **Two-sided geometry shows through.** A single click deletes one voxel cell. If the scene has a back-facing surface (e.g. the far wing of a butterfly capture), the user sees it through the front-facing hole. This is *correct* behavior given the voxel-grouping rule, not a bug; a "drill-through" tool that carves all cells along the view ray is a planned UX option.
- **Spark's 2DGS path is unpatched.** Spark's 2D Gaussian splat code path writes `vNdc` via a different assignment form not matched by our anchor. Carves while 2DGS is enabled may mis-mask. Production scenes (Inria, Polycam) don't use 2DGS; a second anchor is a future task if it ever matters.
- **Anchor-based string injection is fragile to upstream Spark changes.** A planned CI guard hashes the relevant shader region in `node_modules/@sparkjsdev/spark/dist/spark.module.js` and fails the build if it changes, forcing a recon refresh.
- **"SDF" in class names is a vestigial name.** The first implementation evaluated analytic per-box SDFs in a fragment loop; the current implementation is a discrete voxel occupancy texture. Class names (`FragmentSdfShaderPatch`, `FragmentSdfCarver`) are kept for diff continuity but the mechanism is a binary mask, not a continuous signed-distance field.

### Why this is novel (as far as we can tell)

**Defensible claim.** To the best of our knowledge, splatcarve is the **first public open-source browser-based 3DGS demo that applies Spark's officially-supported `Material.onBeforeCompile` hook with a `Data3DTexture` voxel-cell occupancy mask** to produce crisp axis-aligned `discard`-based carves in a live 3DGS scene. The hook itself is advertised by Spark 2.0 ([release notes](https://sparkjs.dev/docs/new-features-2.0/)); the novelty is the *application* — plugging a voxel-grid-sized 3D occupancy texture into the fragment stage and `discard`ing on it — not the existence of a fragment-stage extension point.

**Surveyed OSS — none do the same thing.** Wave A enumerated every public OSS 3DGS web renderer / editor we could find — Spark's built-in `SplatEdit` (per-splat-center evaluation, [docs](https://sparkjs.dev/docs/splat-editing/)), PlayCanvas SuperSplat (offline splat-primitive selection + delete/gizmo), PlayCanvas `splat-transform --voxel-carve` (sparse voxel octree / `.collision.glb` for navmesh, not visual rendering), mkkellogg/GaussianSplats3D, antimatter15/splat, KeKsBoTer/web-splat, plus the relevant 2024–2026 papers (VolSplat, GaussianOcc, GaussianFormer, GaussianEditor, Gaussian Grouping, 3DSceneEditor, SuGaR-Editor). All splat-editing systems we found operate at *splat granularity* — they select/delete/edit Gaussian primitives, or transform splat attributes, or generate auxiliary collision meshes. None evaluate a per-fragment voxel mask against the splat rasterizer's fragment output.

**Closest known prior art — distinguished but not fully ruled out.** Santos & Soares, *"Visual Effects for 3D Gaussian Splatting in Extended Reality"* (SVR 2025) describes an SDF-based spatial-selection framework for 3DGS on both game-engine and web platforms, validated on consumer XR. We were only able to access the [published abstract](https://sol.sbc.org.br/index.php/svr/article/view/40652) (IEEE Xplore PDF was inaccessible at the time of writing). On the abstract's evidence the system targets *modulation effects inside an SDF region* (displacement, relighting, stylization), not crisp axis-aligned `discard`-based removal at voxel-cell resolution; per-fragment vs. per-Gaussian evaluation is not specified; and we found no public source release. We flag it as the strongest candidate prior art and would happily revise this section if the full paper turns out to overlap more than the abstract suggests.

The narrow word we *do not* use is unqualified "first per-fragment SDF on 3DGS." The right phrasing for our contribution is "first public OSS demonstration of a voxel-cell-resolution `discard` mask for crisp carving in a live 3DGS rasterizer."

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

- [`2026-05-19-spark-shader-hook-spike.md`](docs/research/2026-05-19-spark-shader-hook-spike.md) — the one-day recon that confirmed `onBeforeCompile` fires and captured the GLSL anchors.
- [`2026-05-19-h2-partial-results.md`](docs/research/2026-05-19-h2-partial-results.md) — the per-splat path being falsified.
- [`2026-05-20-h2-breakthrough.md`](docs/research/2026-05-20-h2-breakthrough.md) — the full H2′ writeup with side-by-side captures, FPS tables (vox=64 + vox=128), GLSL diffs, related work, and reproducibility.
- [`2026-05-20-h1-results.md`](docs/research/2026-05-20-h1-results.md) — H1 picking results, Plan §7 Q2 decision (stick with Option A).
- [`2026-05-20-h3-results.md`](docs/research/2026-05-20-h3-results.md) — H3 stack results, density cap behaviour, visual-coherence subjective rating.

---

## Architecture

End-to-end data + control flow — from `.spz` on disk through the
`SparkRenderer.material.onBeforeCompile` patch to the per-fragment
`discard` — is in [`docs/architecture/render-pipeline.txt`](docs/architecture/render-pipeline.txt).
The conceptual clarification "voxel = coordinate quantization, **not** a voxel
engine" is in [`docs/architecture/voxel-conceptual-model.md`](docs/architecture/voxel-conceptual-model.md).

---

## Stack

- TypeScript + WebGPU + [@sparkjsdev/spark](https://sparkjs.dev/) 2.1 + three.js 0.184
- Vite for bundling, Vitest for tests (163/163 green), Prettier for formatting
- MIT license

## Keyboard / URL controls

| Action | Input |
|---|---|
| Orbit / zoom | drag / scroll |
| Pick mode (hover-snap to nearest splat) | `1` |
| Carve mode (click to carve a voxel) | `2` |
| Stack mode (hover-preview ghost cluster, click to commit) | `3` |
| Toggle voxel grid wireframe | `G` |
| Reset pick-latency stats | `R` |
| Undo / redo | `⌘Z` / `⌘⇧Z` (or `Ctrl+Y`) |
| Voxel resolution along longest AABB axis | `?vox=N` (default 64) |
| Carve backend (fragment = breakthrough, splatedit = legacy A/B) | `?mask=fragment` (default) / `?mask=splatedit` |
| Override splat URL | `?splat=https://…/scene.spz` |
| One-shot shader-hook diagnostic | `?spike=1` |
| Deterministic bench harness (H1 picking / H2 carving / H3 stacking) | `?bench=h1` / `?bench=h2` / `?bench=h3` |
| Side-by-side screenshot capture (carves N clumped cells around densest voxel, then sets `__splatcarveReady = true`) | `?capture=N` |

## Why this exists

The motivation, the literature survey of GS + voxel hybrid approaches, and the three Wave-A research-agent reports that informed the architecture all live under `docs/research/`. The conceptual clarification "voxel ≠ voxel engine" is in `docs/architecture/voxel-conceptual-model.md` — read that first.

## Plan & progress

The full phased plan with hypotheses, success criteria, risks, and verification is in the working plan referenced by the agent — eight waves total.

| Wave | Goal | Status |
|---|---|---|
| A | Foundations & first light | ✅ shipped |
| B | Picking (H1) | ✅ partial — H1 dossier closed by Wave V |
| C | Carve (H2) — per-splat baseline | 🟡 deliberately falsified, motivated C+ |
| **C+** | **Per-fragment SDF mask breakthrough (H2′)** | **✅ shipped — the centerpiece** |
| R | Architecture cleanup & hot-path polish | ✅ shipped |
| V | Validation evidence capture (bench + dossiers) | ✅ shipped |
| D | Stack (H3) | ✅ partial — D.1–D.6 shipped |
| E | Polish, CI, Pages, demo video, launch | ✅ partial — CI / Pages / architecture / dossier links shipped; 30 s video pending screen-record session |

## License

MIT — see [LICENSE](LICENSE).
