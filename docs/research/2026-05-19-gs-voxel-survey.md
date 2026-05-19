# Background — Gaussian Splatting + Voxel hybrid landscape (2020 → 2026)

> **Generated**: 2026-05-19. A condensed summary of the literature survey that prompted splatcarve. The full survey came from a separate research pass (not reproduced here verbatim because it is ~10k words and most of its content is upstream of splatcarve's specific question); this document preserves the *load-bearing* conclusions.

## TL;DR

Voxel ↔ Gaussian-splat hybrids are no longer a fringe idea. By May 2026 they appear in four technically distinct forms:

1. **Voxel-conditioned splat generation** — a voxel grid or octree provides structure; Gaussians provide rasterized appearance. *Examples: Scaffold-GS, Octree-GS, VolSplat.*
2. **Dual representations** — a volumetric structure (TSDF / SDF / octree / sparse voxel submaps) handles geometry, with a separate Gaussian appearance layer. *Examples: GSFusion, OG-Mapping, VPGS-SLAM.*
3. **Gaussian-to-voxel splatting** — Gaussians are predicted/rendered, then accumulated into voxel occupancies or semantic grids for downstream perception. *Examples: GaussianFormer, GaussianOcc, GaussianWorld, SplatSSC.*
4. **Auxiliary spatial structure around splats** — the visible scene is still Gaussian splats, but voxels/octrees/LoD trees are added for streaming, collision, or hierarchical scheduling. *Examples: Spark 2.0, PlayCanvas SuperSplat (with its sparse voxel octree collision export).*

## Why splatcarve exists at all

The survey enumerated dozens of hybrids — but a specific gap kept showing up:

> No public OSS project demonstrates **voxel-resolution interactive carving + stacking on top of a real splat scene**. The closest production systems (SuperSplat, Spark 2.0) use voxels only for collision or streaming, never as the unit of edit. The closest research papers either (a) use voxels to *generate* splats during reconstruction, or (b) accumulate splats *into* voxels for downstream perception — but neither lets a user *edit* a splat scene voxel-by-voxel.

splatcarve targets exactly that gap. The plan is to validate, with three falsifiable hypotheses (H1 picking, H2 carve, H3 stack), whether this kind of editing is feasible at interactive latency in the browser.

## Why we chose splat-native (not voxel-engine)

The survey emphasized that voxel-Gaussian hybrids tend to "treat one side as auxiliary rather than fully first-class," with awkward duplication and synchronization cost. Two viable orientations exist:

- **Voxels for truth, Gaussians for perception** — voxel state is authoritative, Gaussians decorate it. This is the natural fit for games, planning, and robotics. It needs a real voxel engine (Rust+WASM, chunk streaming, greedy meshing).
- **Splats for truth, voxels for indexing** — splats *are* the world, voxels only group them for snapping operations. This is the natural fit for "edit a captured 3DGS scene at voxel resolution" — splatcarve's actual question.

splatcarve commits to the second orientation. The first remains a candidate sibling project (provisional `splatworld`), deferred.

See `docs/architecture/voxel-conceptual-model.md` for the precise mental model.

## Lineage timeline (key works only)

| Year | Work | Why it matters to splatcarve |
|---|---|---|
| 2020 | NeRF | Foundational volumetric baseline. Doesn't appear directly in splatcarve, but every subsequent hybrid is reacting to it. |
| 2021 | PlenOctrees | First taste of "explicit spatial structure can replace big MLPs." Real-time rendering of radiance fields. |
| 2022 | DirectVoxGO, Plenoxels, Instant-NGP | Showed sparse voxel grids and hash grids could match or beat NeRF quality. Established the *radiance-field-explicit* lineage. |
| 2023 | **3D Gaussian Splatting (Kerbl et al., SIGGRAPH)** | The foundation we render on. Anisotropic 3D Gaussians + visibility-aware rasterization, ≥100 FPS at 1080p. |
| 2024 | **Scaffold-GS, Octree-GS** | First "voxel anchors spawn Gaussians" papers. Important conceptual prior even though splatcarve doesn't reuse their decoders. |
| 2024 | GSFusion, OG-Mapping | "TSDF/octree geometry + Gaussian appearance" dual maps. Reference for the GS+voxel SLAM line, not directly used. |
| 2025 | **VolSplat, VS-Splat, SplatVoxel** | "Voxel-aligned Gaussian prediction." Most relevant to the *post-MVP* H4 candidate (learned material generation for stack). |
| 2025 | **GaussianFormer, GaussianOcc, GaussianFormer-2, GaussianWorld** | Gaussian-to-voxel splatting for occupancy. Not in splatcarve's scope; relevant if we ever export to occupancy grids. |
| 2026 | **Spark 2.0**, SuperSplat 2.26, SplatSSC, Voxel-GS, GaussianFormer3D | Current state of art on the production / occupancy axes. Spark and SuperSplat are direct dependencies / references. |

## Concrete implications baked into splatcarve's plan

- **Picking** uses SuperSplat's screen-space render-to-texture pattern (clean-room adapted) — see `2026-05-19-picking-agent-report.md`.
- **Renderer** is `@sparkjsdev/spark` because it's the only actively-maintained, MIT-licensed, three.js-compatible web splat renderer that exposes per-splat APIs and supports custom render targets — see `2026-05-19-ecosystem-agent-report.md`.
- **Voxel quantization** is naive hash-grid over splat centers — see `2026-05-19-voxel-bridge-agent-report.md`. VolSplat-style learned decoders are a post-MVP candidate.
- **Stack** uses nearest-neighbor splat-cluster copy because pre-baked material libraries are nice-to-have, learned generation is too slow for interactive editing.

## Anti-patterns the survey warned about (so we explicitly avoid)

- **Mixing splat rendering with voxel mesh rendering in the same frame at production quality is unsolved.** Spark 2.0 enforces a fixed active-splat budget specifically to side-step this. splatcarve never composites mesh against splats — voxels render only as a debug wireframe overlay.
- **Pure-Gaussian editing breaks once you try to do collision, topology, or destructive editing** — research papers on splat editing (3DSceneEditor, Gaussian Grouping, SuGaR-Editor) focus on object-level operations. Voxel-resolution carving + stacking is its own design problem; we're not extending those papers.
- **Per-splat learning at edit time is too slow for interactive tools.** SplatPainter-style test-time optimization (~100s of ms per edit) is documented but excluded from MVP scope.

## Where this document ends and the others begin

This file is the "why." The three subagent reports (`*-agent-report.md` in the same directory) are the "what" — concrete library choices, picking architectures, voxel-bridge designs. The plan (mirrored to `docs/plan.md` during Wave A) is the "how" — phased execution.
