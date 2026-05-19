# Wave-A research agent report — Splat web renderer ecosystem

> **Generated**: 2026-05-19. Verbatim output from an Explore-type subagent given the focused mission of identifying the best open-source 3DGS renderer to build on for `splatcarve` (TypeScript + WebGPU, browser target).
>
> Treat this as a time-stamped snapshot. Library versions and maintenance signals will rot; the decisions and reasoning are durable.

## Library shortlist

**Recommended:** **Spark** (World Labs)
**Strong Alternative:** **SuperSplat** (PlayCanvas)
**Specialized Use:** **web-splat** (KeKsBoTer, WebGPU-focused)

## Depth handling table

| Library | Depth Write | Per-Pixel Depth | Rasterizer Notes |
|---------|-------------|-----------------|------------------|
| **Spark** | Optional (`depthWrite?: boolean`, default false) | Front-to-back blending with logarithmic depth support (logdepthbuf) via shader. No depth texture output native, but extensible via custom render targets. | Fragment shader applies Gaussian falloff; logdepth fragment shader available. Splats don't write to WebGL depth by default — integrates via alpha blending (premultiplied). |
| **SuperSplat** | Not explicitly exposed (PlayCanvas engine handles) | Unknown via public API — editor-focused, not designed for programmatic depth access. PlayCanvas depth buffer management is internal. | Render pipeline opaque; depth per-pixel not directly accessible for raycasting. |
| **web-splat** | No explicit depth write | Front-to-back blending, no depth texture output. Radix-sorted CPU-side; GPU rasterizer uses `unclipped_depth: false`. No per-pixel depth isolation. | WGPU-based, tile-sorted; depth_stencil: None. Prioritizes visual accuracy over depth isolation for picking. |
| **GaussianSplats3D** | Not exposed; CPU-sorted | No native per-pixel depth output. Three.js material doesn't write depth. WASM-sorted, tile-based, ~32 bytes per .splat. | Octree culling + CPU sort; no depth pass available. Known limitations on fast movement. |
| **antimatter15/splat** | No | None. WebGL 1.0; CPU-sorted in WebWorker, depth computed only for sort order (camera-space z). Splats blended via stochastic transparency experiments (rejected as grainy). | Deprecated; author recommends Spark. |

**Critical insight:** None of the mainstream web splat renderers expose per-pixel depth as a texture or buffer. Spark's optional `depthWrite` and logdepth shader support is the most flexible for future voxel grid editing.

## File format recommendation

**For MVP, support in this order:**

1. **`.spz`** — Niantic's compressed PLY (gzip-based); fast to load on slow networks. Spark/GaussianSplats3D both support; widely used in Polycam, RealityCapture exports.
2. **`.ply`** — INRIA standard (3DGS reference format). Fields: `x, y, z, scale_0/1/2, rot_0/1/2/3, opacity, f_dc_0/1/2, f_rest_0..44` (45 floats/uints per splat). All libraries read this.
3. **`.ksplat`** (fallback) — mkkellogg's compressed format; 32 bytes/splat (center 12B + scale 12B + color 4B + rotation 4B). Smaller than PLY; good for web.

**Why not others:**
- `.splat` (antimatter15): 32-byte packed; outdated, no SH support.
- `.sog` (PlayCanvas) / `.rad` (Spark v2+): Format-locked to their ecosystems; `.rad` still maturing (v2.1 release April 2026).

**Free-redistributable scenes:**
- Polycam exports (.spz, .ply) — check licensing per capture
- Inria official samples: https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/ (Apache 2.0)
- Nerfstudio dataset samples (gsplat reference)
- Spark examples repo: `/examples` directory (MIT)

## Justification: Why Spark

| Criterion | Spark | SuperSplat | web-splat |
|-----------|-------|-----------|----------|
| **WebGPU readiness** | YES (optional in v2.0+, LoD tree uses custom encoding). Rust/WASM for LoD algorithms | NO (PlayCanvas engine, WebGL 2 only) | YES (pure WebGPU/Rust/WASM) but no LoD |
| **Per-splat data exposure** | YES. `SplatMesh`, `forEachSplat()`, `getBoundingBox()`, `setPackedSplat()` extensible | YES (through PlayCanvas scene API, but editor-centric) | NO public API; Rust internals only |
| **Per-pixel depth** | PARTIAL. Optional depthWrite + logdepth shader; extensible custom render targets. *Best option for future raycast* | NO (opaque internal) | NO (front-to-back only, no texture) |
| **TypeScript + three.js** | YES. v2.1 (Apr 2026) requires three.js r179+; full TS types. CDN available | YES. Full TS, PlayCanvas ecosystem | NO (Rust/WASM, no TS bindings) |
| **License** | MIT | MIT | Apache 2.0 |
| **Maintenance 2025–2026** | **Active.** Latest release Apr 18, 2026 (v2.1.0, post-v2.0 LoD release). Last commit May 18, 2026. SOG v2 support, SPZ v3, multiple VP rendering, virtual paging | **Active.** v2.26.1 (latest May 2026). Recent render pipeline work, editor-focused | **Stale.** Single commit since 2024-06 (`f122319` "upgraded to wgpu 29, switched to front-to-back blending"). No releases; R&D quality |
| **Voxel editing readiness** | **BEST**. LoD system, dynamic transforms, skeletal animation, shader graph, SplatMesh modifiers (`objectModifiers`, `worldModifiers`). Custom render targets enable custom picking passes | **PARTIAL**. Full editor exists but not a library for 3rd-party voxel integration. Editing API unstable for external use | **POOR**. No editing API; view-only renderer |

## Open Questions / Could not confirm

1. **Spark's custom render target depth output**
   - `SparkRenderer` docs mention `renderTarget` override (v2.0), but no public examples of depth-texture binding. Source in `/src/SparkRenderer.ts` confirms the option exists; need to prototype.

2. **Per-splat picking via raycaster**
   - Spark's `SplatMesh` integrates into THREE.js scene, but does `Raycaster.intersectObject()` work? Likely requires custom `raycast()` method on SplatMesh (not yet implemented). Three.js-based GaussianSplats3D has similar gap.

3. **GaussianSplats3D end-of-life timeline**
   - Author explicitly deferred to Spark (Oct 2024 in README), but repo still receives occasional PRs. Last commit Oct 19, 2025. Usable but not recommended for new greenfield projects.

4. **SuperSplat editor → exportable voxel grid format**
   - Editor has brush, transform, and optimization tools, but export options unclear. PlayCanvas native format only, or does it support standard formats on save?

5. **web-splat performance on < 16M splats**
   - Claims "130 FPS on AMD hardware," but no mobile benchmarks. Tile sort implementation (Fuchsia RadixSort port) untested vs. CPU radix on real-world mobile GPUs.

## Recommended path forward for splatcarve

1. **Build on Spark's PackedSplats / ExtSplats APIs** — use `.spz` / `.ply` loader, customize via `SplatMesh.setPackedSplat()` and `objectModifiers`.
2. **Prototype depth pass** — extend `SparkRenderer` with a custom render target encoding per-pixel depth (log-linear or world-space), enabling raycasting.
3. **Implement voxel grid as overlay object** — separate THREE.js mesh or billboard grid; raycaster queries for both splats (via depth texture) and voxel grid.
4. **License:** MIT (Spark) ✓ compatible with open-source splatcarve.

This avoids reinventing the rasterizer and exploits Spark's LoD and dynamic transform infrastructure already built for animation/editing.

## Confirmed during integration (post-research)

- The actual npm package name is **`@sparkjsdev/spark`** (not `@worldlabs/spark` as initially guessed). v2.1.0, MIT, published 2026-05-18.
- Pulls three.js as a peer dependency requirement (r179+). Installing alongside `three` 0.184.0 + `@types/three` works cleanly.
