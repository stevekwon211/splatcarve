# Wave-A research agent report — Splat picking & editing prior art

> **Generated**: 2026-05-19. Verbatim output from an Explore-type subagent given the focused mission of investigating the state of art for mouse-hover splat picking and splat editing.
>
> Treat this as a time-stamped snapshot.

## 1. Picking architecture options for splatcarve

### Option A — Screen-space render-to-texture (IMPLEMENTED in SuperSplat)

- **How it works**: Render two off-screen textures: one with per-pixel splat IDs, one with accumulated depth. On mouse move, read pixel(s) at screen coordinate, decode splat ID from RGBA bytes (`playcanvas/supersplat/src/picker.ts`: `readIds(x, y, width, height)` reads `colorBuffer` texture and unpacks UINT32 from 4 bytes).
- **Pros**: Production-tested, millisecond latency, handles translucency natively (blending mode: `ONE + ONE_MINUS_SRC_ALPHA` for depth accumulation), no CPU-side spatial data structures needed.
- **Cons**: Requires GPU render pass per selection mode (set/add/remove); depth is "expected depth with transmittance" not true first-hit; can't easily intersect dense regions or ask "which 5 nearest splats."
- **Latency**: ~1–2 ms per readback (WebGL texture.read() is async).
- **Code**: `/playcanvas/supersplat/src/picker.ts` (half-float conversion, blend states, async readback).

### Option B — CPU-side ray-ellipsoid intersection with BVH

- **How it works**: Precompute bounding ellipsoid for each splat (mean μ, covariance Σ). Build BVH over ellipsoid bounds. On click, unproject mouse to ray in world space, intersect ray against BVH, refine hit with analytical ray-ellipsoid intersection (solve `(ray(t) − μ)^T Σ^−1 (ray(t) − μ) = threshold`).
- **Pros**: Per-splat certainty, can query "k-nearest splats" and density ordering, works offline for remeshing, supports non-spherical filtering.
- **Cons**: BVH recomputation if splats move; ray-ellipsoid solving is ~O(log n) per query but high constant; requires reading splat parameters (means, covariances) to CPU; slower than Option A (~5–20 ms for large scenes > 1M splats).
- **Implementation difficulty**: Moderate. Analytical ray-ellipsoid is a quartic; stable solvers exist in PBRT, Intersection.jl, or custom GLSL.

### Option C — Hybrid GPU compute + texture readback

- **How it works**: Dispatch GPU compute shader per mouse ray; each thread tests 1–N splats for intersection, writes closest splat ID + depth to small (e.g., 64×64) output texture. Readback 1 pixel.
- **Pros**: Scales to millions of splats without BVH overhead; can integrate density along ray for probabilistic picking.
- **Cons**: GPU-CPU sync cost; requires splat data in GPU buffer; vendor-specific compute (WGSL vs GLSL vs Metal); ~3–5 ms latency due to dispatch + readback.

**Recommendation for MVP**: **Option A** (screen-space render-to-texture). SuperSplat proves it ships production code; latency is acceptable; translucency handling is automatic; no offline precomputation.

## 2. State of art: what's already solved vs novel

### Already solved (production or near-production)

- **Individual splat picking**: SuperSplat's ID render target (`readId`/`readIds`) and mouse-screen coordinate unprojection (`camera.focalPointPicked` event).
- **Multi-splat selection**: SuperSplat `sphere-selection.ts` queries all splats within a 3D sphere, fires `select.bySphere` event. Undo/redo via `edit-ops.ts` (SelectOp, DeleteSelectionOp, etc.).
- **Transform & color edit**: SuperSplat `SplatsTransformOp`, `SetSplatColorAdjustmentOp`. Splat parameters are mutable in-memory.
- **Depth-aware picking**: SuperSplat's `depthRenderTarget` with blend state `ONE + ONE_MINUS_SRC_ALPHA` accumulates depth while tracking transmittance (half-float, unpacked to float32). Result: expected depth at mouse.
- **Undo/redo model**: SuperSplat's `edit-history.ts` + do/undo pattern on all operations (complete, reversible).
- **Instance-level grouping**: Gaussian Grouping (arXiv) adds per-Gaussian "identity encoding," enabling object-level selection and removal/inpainting/style transfer, but not voxel-resolution carving.

### Not solved / splatcarve's novel claim

- **Voxel-resolution stacking/carving**: The hypothesis is "pick a splat → edit at voxel resolution (delete/add splats within a voxel cell)." Neither SuperSplat nor any OSS project implements this. Existing splat editing is Gaussian-per-Gaussian or geometry-per-geometry; it does not discretize space into voxels and track occupancy/additions.
- **Voxel grid hierarchy**: No published approach carves/stacks in a sparse voxel octree while maintaining differentiable or real-time splat rendering.
- **Carving constraints**: How to ensure voxel carving doesn't violate 3D consistency (e.g., don't delete splats that are critical for unoccluded regions)? Splatcarve's voxel-level topology is orthogonal to splat density.

**Honest assessment**: Splat picking is solved. Voxel-resolution subdivision on top of splats is novel territory. Risk: splats are anisotropic (covariance Σ is not axis-aligned), translucent, and ordered by depth — voxel discretization may conflict with these assumptions.

## 3. Risks & gotchas

1. **Translucency & order ambiguity**: Splats blend with `ONE + ONE_MINUS_SRC_ALPHA`. At a voxel boundary, which splats "belong" to the voxel? Depth integration (SuperSplat's expected-depth) is path-dependent. Carving one splat may cascade opacity changes behind it.
2. **Anisotropic stretch**: Covariance Σ is not identity; a single splat occupies an ellipsoid, not a voxel. Mapping ellipsoids to voxel grid is lossy. Inverse problem: if you carve voxel V, do you delete splats whose ellipsoid overlaps V, or only those with mean in V?
3. **Sort & depth discontinuity**: Splats are sorted by depth at render time. If you carve splats, the sort order may change; silhouettes shift. Require re-rendering to detect discontinuities.
4. **No analytic density on carving**: 3D Gaussians have infinite support (decay ~`exp(-d²/2σ²)`). Voxel carving is a hard boundary. Aliasing / popping artifacts at carve edges.
5. **Unprojection errors at silhouettes**: Screen-space picking (Option A) reads depth at exact mouse pixel. If splats are thin or fuzzy at silhouette, depth readback may be stale or inaccurate (half-float precision, ~5–6 bits exponent, 10 bits mantissa ≈ 1:1024 relative error at typical depths).

## 4. Concrete citations & sources

### SuperSplat picking implementation

- File: https://github.com/playcanvas/supersplat/blob/main/src/picker.ts
  - `readId(x, y)` → `readIds(x, y, width, height)` → async texture readback via `colorBuffer.read()`.
  - Blend state for depth: `new BlendState(...BLENDMODE_ONE, BLENDMODE_ONE_MINUS_SRC_ALPHA...)`.
  - Half-float ↔ float32 conversion: bit-shift logic, lines ~40–65.
- File: https://github.com/playcanvas/supersplat/blob/main/src/camera.ts
  - Mouse event unprojection to world ray, `focalPointPicked` event fired on hit.
- File: https://github.com/playcanvas/supersplat/blob/main/src/tools/sphere-selection.ts
  - Multi-splat selection within 3D radius: fires `select.bySphere(op, [x, y, z, radius])`.

### Gaussian Grouping (instance segmentation)

- https://github.com/lkeab/gaussian-grouping
- Paper describes "local Gaussian editing," but no code for voxel-level operations.

### 3DSceneEditor (semantic editing)

- https://arxiv.org/abs/2412.01583
- Object-level add/remove/recolor; uses CLIP + instance segmentation. No voxel discretization.

### GaussianSplats3D (three.js integration)

- https://github.com/mkkellogg/GaussianSplats3D
- Mentions "mesh cursor" (pressing 'C') for ray-intersection visualization, but no programmatic picking API published.

### Original 3DGS & rasterization

- https://github.com/graphdeco-inria/gaussian-splatting
- No interactive editing; rendering pipeline (CUDA) writes composited color, not per-pixel ID/depth for web consumption.

## Summary

splatcarve's core novelty is **voxel-resolution carving atop a real-time, editable splat scene**. Picking is solved (SuperSplat's render-to-texture + async readback). The hard part: reconciling voxel-grid discretization with continuous, anisotropic, translucent Gaussian geometry. Start with SuperSplat's picking pattern (clean-room adapted, not copied), then add a sparse voxel octree overlay and carving constraints to avoid silhouette popping.
