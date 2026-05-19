# Wave A acceptance — splatcarve

> **Date:** 2026-05-19.
> **Status:** Wave A 12/12 tasks complete on the implementation side. **Visual verification by the user is the final gate** — see §3 below.

## 1. Wave A definition-of-done (from `docs/plan.md` §1)

> **Wave A**: `pnpm dev` opens a live page where a sample .ply scene renders at >60 FPS on the user's laptop, voxel grid wireframe overlay can be toggled and resolution adjusted, console logs splat count per voxel. Repo public on GitHub under `stevekwon211/splatcarve`.

## 2. Automated verification — all green

| Gate | Command | Result |
|------|---------|--------|
| Type safety (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) | `pnpm typecheck` | ✅ clean |
| Unit tests | `pnpm test` | ✅ 37/37 passing across 4 modules |
| Production build | `pnpm build` | ✅ 643 ms, dist ready |
| Dev server boot | `pnpm dev` | ✅ ready in 138 ms at `http://localhost:5173/` |
| Module resolution | `curl http://localhost:5173/src/main.ts` | ✅ 200 OK |
| Spark bundling | `curl http://localhost:5173/node_modules/.vite/deps/@sparkjsdev_spark.js` | ✅ 200 OK |

### Unit test breakdown

| Module | Tests | Concern |
|---|---|---|
| `VoxelGrid` | 15 | AABB → grid, worldToVoxel, voxelToWorldCenter round-trip, contains, error guards |
| `VoxelHash` | 8 | Single splat, same-voxel grouping, out-of-bounds keys, stats |
| `AppParams` | 7 | `?vox=N`, `?splat=URL`, invalid/negative/float fallback |
| `FpsCounter` | 7 | 0 fps before two ticks, ~60 fps at 16.67 ms, window-size enforcement |

## 3. Manual visual verification (user-driven)

The dev server is currently running. Open `http://localhost:5173/` in Chrome/Edge/Safari Tech Preview and confirm:

| # | What to check | Expected |
|---|---|---|
| 1 | Page loads | Dark canvas, top-left stats panel ("fps —", "splats —", "voxels —", "occupancy —"), bottom-left hint legend |
| 2 | Stats populate within ~1–2 s | "splats N,NNN", "voxels res=64 size=… occupied=…", "occupancy max=… mean=…", "fps ~60" |
| 3 | The butterfly splat scene is visible | A small 3DGS butterfly rendered, free to orbit by mouse drag |
| 4 | Voxel grid wireframe is visible by default | Light-gray cube outline tightly enclosing the butterfly |
| 5 | Press `G` | Wireframe toggles off; press again, toggles on |
| 6 | Move the mouse over the butterfly | A cyan cube cursor appears at the voxel under the cursor; the bottom-right `pick-info` panel shows `voxel i\|j\|k • in-bounds • N splats` |
| 7 | Click on the butterfly | Browser console logs `[splatcarve] pick voxel=… world=(…) splats=N` |
| 8 | Append `?vox=32` to the URL and reload | "voxels res=32" appears in stats panel, the cursor cube is larger, fewer occupied voxels |
| 9 | FPS counter stays at ≥30 (target ≥60) during interaction | Smooth pointermove tracking, no stutter |

If any of those fails, the failure mode and a screenshot belong in a follow-up dossier; that becomes a Wave A blocker.

## 4. Notable decisions captured during execution

- Default scene is **`https://sparkjs.dev/assets/splats/butterfly.spz`** (MIT, Spark's CDN). Inria sample scenes (650 MB bundled zip) are deferred — we will host or stream them per-scene when Wave C needs a "real captured scene" to carve into.
- **Three.js Raycaster on `SplatMesh` works directly** (per `docs/research/2026-05-19-spark-picker-spike.md`). The screen-space-RT picker from the picking research is now a Wave B *refinement option*, not a Wave A foundation.
- The bbox + voxel hash are computed in the **SplatMesh local frame** (the same frame `forEachSplat` reports centers in). The picker's world-space hit is `mesh.worldToLocal`'d into this frame before snapping. The overlay is a child of the SplatMesh so its world position tracks any future mesh transform.
- Voxel grid resolution defaults to **64** along the longest AABB axis, override with `?vox=N`.
- We deliberately do **not** apply `mesh.rotation.x = Math.PI` (a pattern from Spark's `interactive-holes` example) because `butterfly.spz` looks correct in its native orientation. The `worldToLocal → flip y/z` pattern from that example was avoided by keeping all voxel math in the native local frame.

## 5. Bundle size note

Production build is **5.5 MB raw / 1.9 MB gzip** in a single JS chunk. This is heavy — Spark + Three.js bundled together. We accept it for Wave A (this is a research demo, not a CDN-bound product). Wave E will tackle code-splitting (`build.rolldownOptions.output.codeSplitting`) and lazy-loading the splat data.

## 6. Repository state at end of Wave A

```
git log --oneline:
417abe9 feat: hello-splat viewer with raycaster picker, voxel grid overlay, voxel hash
57e55f5 test: TDD-build the pure modules (voxel-grid, voxel-hash, app-params, fps-counter)
62ea601 docs: preserve research dossier and approved plan
2675224 feat: bootstrap splatcarve repo
```

Repo URL: <https://github.com/stevekwon211/splatcarve>.

## 7. What's next (Wave B preview)

Wave B starts with **H1 measurement**. Concretely:

1. Add a synthetic test harness: lock the camera, raycast 100 sampled pixels with ground-truth splat IDs (sampled by CPU iteration over `forEachSplat`), measure agreement rate. Target ≥95% on non-silhouette pixels.
2. Latency benchmark: measure the 5th–95th percentile mouse-move-to-cursor-update time. Target <10 ms.
3. If H1 holds: build the cursor highlight (tint picked splat red for one frame).
4. If H1 fails: ablate `params.Points.threshold` to find a sweet spot, *then* fall back to the screen-space-RT picker (Spark renderTarget custom pass + readback).

The Wave-B picker-research dossier (`docs/research/2026-05-19-picking-agent-report.md`) is the reference for the screen-space-RT fallback if needed.
