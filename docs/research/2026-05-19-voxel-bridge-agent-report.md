# Wave-A research agent report — Voxel ↔ splat bridge & spatial indexing

> **Generated**: 2026-05-19. Verbatim output from an Explore-type subagent given the focused mission of investigating voxel-splat bridges and spatial indexing options.
>
> Treat this as a time-stamped snapshot.

## Voxel ↔ Splat bridge options for splatcarve

Based on investigation of SuperSplat, VolSplat, Scaffold-GS, Octree-GS, SplatVoxel, VS-Splat, and related systems, here are **3 concrete approaches**:

### Option A — Hash-grid over splat centers (naive, immediate)

- **How**: Quantize each splat's center position to voxel (i,j,k). Store splat IDs in a hash map keyed by (i,j,k).
- **Pros**: Simple to implement, O(1) insertion/deletion, no training required.
- **Cons**: Splats spanning multiple voxels cause ambiguity (assign to center cell only? all overlapped?). Anisotropic ellipsoid Gaussians don't align to axis-aligned voxels — discontinuous covariance at boundaries.
- **Visual quality**: Acceptable for rough editing; splat seams visible if voxel cells are large.

### Option B — SplatVoxel-style feature deposition + sparse decoder (learned, sophisticated)

- **How**: Deposit splat features (position, scale, rotation, SH coeffs) onto a coarse-to-fine voxel grid (e.g., 8³ → 16³ → 32³). Run a sparse voxel transformer to refine and predict final Gaussian parameters per occupied voxel. (See: [SplatVoxel: Learning Efficient Fuse-and-Refine](https://19reborn.github.io/SplatVoxel/), NeurIPS 2025.)
- **Pros**: Handles multi-voxel splats gracefully via learned fusion. Preserves fine detail in reconstruction. Octree LOD-aware.
- **Cons**: Requires training on your scene data or fine-tuning. Adds inference latency (~350ms for streaming). Complex to implement.
- **For editing**: Adding a splat into an empty voxel means training/inferring the decoder on the modified grid — expensive for interactive tools.

### Option C — Pre-baked "splat brick" material library (authoring-friendly)

- **How**: Pre-capture or generate small clusters of Gaussians (e.g., 3–5 splats) that represent 1 voxel's worth of "material" (e.g., a grass clump, stone chip, moss patch). Store as `.ply` snippets indexed by material ID. On edit: stamp material cluster into target voxel cell, scaled/rotated to fit.
- **Pros**: Interactive, no inference, visually coherent, artist-friendly (like Minecraft textures). Fast iteration.
- **Cons**: Limited to discrete material set. Doesn't generalize to novel scene content. Requires pre-capture/synthesis pipeline.
- **Novel approach**: No published precedent; conceptually grounded in game voxel engines.

## Recommended approach for MVP

**Hybrid: Option A + material library prototype.**

- **Phase 1 (Week 1–2)**: Implement hash-grid deletion (Option A). Use splat's 3D bounding-sphere to determine voxel occupancy (count overlapping voxels, assign to majority). Store voxel → splat-ID mappings.
- **Phase 2 (Week 3)**: Build a minimal material library: capture 2–3 hand-curated "splat bricks" (e.g., a grassy patch, a sandy spot) by manually selecting coherent splat clusters from your input scene. Stamp-on-click to fill voxels.
- **Rationale**: Deletion is immediate and satisfying. Library stacking is "cheap enough" for MVP and visually plausible because users see the same materials repeated (familiar from voxel games). No training required; works offline.
- **Honest risk**: Repeated materials will feel repetitive in open-world scenarios. If scenes demand unique content per voxel, defer to post-MVP SplatVoxel integration.

## Stack mechanism for MVP

**Cheapest visually-meaningful approach: nearest-neighbor cluster + scale-to-fit.**

1. User voxel-clicks empty cell `(i, j, k)`.
2. Fetch nearest occupied voxel in 3×3×3 neighborhood. Extract its splat cluster (presorted by connectivity or spatial proximity in preprocessing).
3. Copy cluster, translate to target cell center, scale/jitter slightly (±10% scale, ±5° rotation) to break uniformity.
4. Optional: if scene has pre-tagged material zones (via segmentation or manual markup), prefer neighbor in same zone.

**Alternatives ranked:**

- **Procedural fuzzy ellipsoid**: Generate ~5 random Gaussians in a loose ellipsoid shape. Fast, but visually incoherent unless constrained by learned priors. Risk: looks like noise.
- **Baked material library**: Best coherence, but requires up-front curation.
- **Test-time optimization (SplatPainter-style)**: Optimize a new Gaussian to match rendered image of neighbors. Elegant but too slow for interactive voxel-grid workflows (100s of ms per edit).

**Pick**: Nearest-neighbor cluster for MVP. Pre-bake library in post-MVP if user feedback demands tiling variety.

## Risks & open challenges

1. **Splat multi-voxel occupancy rule**: A Gaussian's 3σ extent can span 2–4 voxels. Assigning to center cell only leaves gaps; assigning to all overlapped cells causes duplication. **Unsolved**: Need a principled volumetric weight function (Gaussian-weighted assignment?) or conservative approximation (only assign if center lies in voxel).

2. **Covariance discontinuities**: Voxel boundaries don't respect Gaussian ellipsoid orientations. At voxel edges, splat opacity/color can be discontinuous. **Mitigation**: Use smaller voxels (< 1/3 splat mean radius) or require splats to fit within single voxels during authoring.

3. **Density collapse at voxel boundaries**: If many splats map to the same voxel, deletion leaves sudden holes. **Mitigation**: Keep a min-density threshold per voxel; don't fully delete if < N splats remain.

4. **Scene-dependent voxel resolution**: No universal scale. Inria Mip-NeRF360 scenes ~10–100m world units; Tanks & Temples ~5–50m. **Recommendation**: Infer from scene bounding-box; default 128 voxels along longest axis (0.078m–0.78m voxels). Expose as parameter.

5. **No spatial-index published for 3DGS**: Unlike game engines, 3DGS research hasn't exposed a standard KD-tree or BVH. **Workaround**: Pre-compute BVH once at load time (e.g., using [gsplat](https://arxiv.org/pdf/2409.06765) library), then query efficiently.

6. **Material library design problem**: How to capture representative splat clusters without manual work? **Open**: ML-based cluster extraction (e.g., k-means on splat feature space) is researched but non-standard.

## Architecture sketch for MVP

```
Input: scene.ply (3DGS), voxel resolution (default: infer from bounds)
1. Parse splats → compute 3D AABB, voxelize grid
2. Hash-grid: for each splat, assign to voxels overlapped by 3σ ellipsoid
3. Save index: voxel(i,j,k) → [splat_id, ...]
4. On delete(i,j,k): remove splat_ids from hash, write new .ply
5. On stamp(i,j,k, material): copy pre-baked cluster, translate, write .ply
6. Export edited.ply
```

**No ML, no training. Outputs standard `.ply` for immediate use in SuperSplat, PlayCanvas, or any renderer.**

## Citations

- [VolSplat: Feed-Forward 3D Gaussian Splatting](https://arxiv.org/abs/2509.19297) (Wang et al., 2025) — voxel-aligned Gaussian prediction from sparse 3D decoder.
- [Scaffold-GS: CVPR 2024](https://github.com/city-super/Scaffold-GS) — anchor-based view-adaptive Gaussians with MLPs.
- [Octree-GS: TPAMI 2025](https://arxiv.org/abs/2403.17898) — multi-resolution octree LoD anchors.
- [SplatVoxel: NeurIPS 2025](https://19reborn.github.io/SplatVoxel/) — coarse-to-fine voxel grid feature deposition + sparse voxel transformer.
- [VS-Splat: Voxel-Selective Feed-Forward GS](https://vs-splat.github.io/) — learnable voxel selection for sparse-view reconstruction.
- [SplatTransform](https://github.com/playcanvas/splat-transform) — PlayCanvas open-source voxel octree + collision GLB generation.
- [SplatPainter: Interactive Authoring via Test-Time Training](https://arxiv.org/pdf/2512.05354) (Zheng et al., 2025) — 2D-guided 3D GS editing.
- [3D Gaussian Splatting for Real-Time Radiance Field Rendering](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) (Kerbl et al., SIGGRAPH 2023) — foundational paper; scene scales via Mip-NeRF360, Tanks & Temples.
- [A Hierarchical 3D Gaussian Representation for Real-Time Rendering of Very Large Datasets](https://arxiv.org/html/2406.12080v1) — BVH for spatial indexing of 3DGS.
- [gsplat: An Open-Source Library for Gaussian Splatting](https://arxiv.org/pdf/2409.06765) — reference implementation with spatial structures.
