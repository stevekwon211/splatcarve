# Voxel conceptual model

> **Read this before reading any code in this repo. The word "voxel" here does not mean what it usually means.**

## TL;DR

In splatcarve, "voxel" denotes a **coordinate quantization** — a snap-to-grid math function plus a hash map. There is **no voxel engine, no voxel mesh, no greedy mesher, no chunk system, no voxel rendering**.

The world state is the splat array. The voxel grid is an invisible overlay used to *group* splats for editing.

## The two meanings

| | This project's "voxel" | A real voxel engine's voxel |
|---|---|---|
| What is stored | `Map<"i\|j\|k", SplatId[]>` | per-cell material, occupancy, etc. |
| What is rendered | nothing (wireframe overlay optional, debug only) | meshed cells via greedy mesher etc. |
| Source of carving | delete splats whose centers fall in cell | remove cell from grid |
| Source of stacking | duplicate splats from neighbor cell | place material in cell |
| World authority | splats | voxel grid |

## Concrete example

Imagine a 1M-splat scene of a forest. Mouse hovers over the trunk of a tree. World coordinate `(3.2, 1.5, 4.8)`. Voxel size `0.25 m`, so voxel index `(12, 6, 19)`.

**Carve:**

```
1. Picker resolves the hit's world position
2. voxelIndex = floor(pos / 0.25) → (12, 6, 19)
3. voxelHash["12|6|19"] → [splatId 421, 8392, 99102, 200431]
4. Mark those four splats as deleted in the GPU buffer (opacity = 0)
5. Next frame: a ~25 cm cube void appears in the trunk
```

**Stack:**

```
1. Mouse moves to an empty adjacent voxel (13, 6, 19)
2. Find the nearest occupied voxel — (12, 6, 19), with splat cluster of 4
3. Copy those 4 splats into pre-allocated stack slots
4. Translate each by (+0.25, 0, 0) so they sit in the target voxel
5. Jitter scale/rotation slightly to avoid identical tiling
6. Next frame: a new ~25 cm cluster appears next to the trunk, looks like the same wood
```

Neither of these requires a "voxel engine." They are array operations on the splat buffer, snapped to a grid.

## Why this is intentional

Building a voxel engine *and* a splat editing system in the same project would double the scope and re-introduce the mesh-vs-splat depth compositing problem we explicitly chose to avoid. The user's research question is specifically about *what happens when you treat the splat scene as the only world primitive* and edit it at voxel resolution.

A separate, hypothetical project (provisional name `splatworld`) would do the voxel-engine + splat-material variant. That is out of scope here.

## When to reach for a voxel engine (and where to put it)

If a feature genuinely needs voxel-as-world-state semantics — e.g., "place a voxel of material `stone` that owns its own splat cluster," or "stream voxel chunks across a multiplayer world" — it belongs in a sibling repo, not here.

## Risks of the splat-native approach (documented)

The MVP rule is: **a splat is assigned to the single voxel containing its center `μ`.** Multi-voxel coverage (a splat whose 3σ ellipsoid spans neighboring voxels) is ignored. Consequences:

- **Wisps at carve boundaries** — splats with centers just outside the brushed voxel can still visibly contribute color/density inside it.
- **Anisotropic stretch** — a wide, flat ellipsoid still belongs to one voxel even if it visibly spans four.
- **Sort-order popping** — removing front splats can reveal back splats; sometimes surprising but correct.

These are documented limitations, not bugs to fix. A post-MVP candidate hypothesis (H4) is "conservative deletion: also mark splats whose 3σ extent overlaps the voxel by ≥X%." See the plan for details.

## Related

- `docs/plan.md` (the approved plan) §0.1 and §9.
- `docs/research/2026-05-19-voxel-bridge-agent-report.md` — the research agent's analysis of voxel↔splat bridge options.
