# H1 partial results — splatcarve Wave B, first chunk

> **Date:** 2026-05-19.
> **Status:** Measurement infrastructure live; awaiting field numbers from the next interactive session.

## Hypothesis under test (H1)

The plan's H1 reads:

> *A web-based 3DGS renderer can be extended to write a per-pixel splat-ID + expected-depth pair, enabling mouse-hover to identify a specific splat at <10 ms latency on a 1M-splat scene.*

After reading Spark's actual sources, this needs a split:

### H1a — voxel-cell identification

> Mouse-hover identifies the **voxel cell** under the cursor at <10 ms latency.

This is what the carve/stack hypotheses (H2, H3) actually depend on. The cell is the unit of edit; the specific splat ID is a nice-to-have label.

### H1b — specific splat identification

> Mouse-hover identifies the **specific splat** (by ID) under the cursor at <10 ms latency.

This is *aspirational* — the plan's literal wording. It is genuinely useful for Wave C ("which splat did I click on?" for debugging carve previews) but not load-bearing for the core editing operations.

## What changed in this chunk

### Read first (primary sources)

- `node_modules/@sparkjsdev/spark/dist/spark.module.js`:
  - `SplatMesh.raycast(raycaster, intersects)` pushes intersection objects with **only `{ distance, point, object }`** — no `index` field. The picked splat ID is **not** exposed by Spark's built-in raycaster.
  - Implementation calls into the WASM `raycast_packed_buffer` / `raycast_ext_buffers` kernels, which fill a `raycastBuffer: Float32Array` with hit distances and (separately) a buffer of corresponding splat indices in `raycast_buffer2` — but only the distances make it back to the JS intersection list.
- `node_modules/@sparkjsdev/spark/dist/types/SplatMesh.d.ts` confirmed the public API: `raycastable?: boolean`, `minRaycastOpacity?: number`, and `raycastIndices?: { ... }` (an internal hint for which splats are eligible).
- `examples/raycasting/index.html` confirmed: the canonical pattern is mesh-level picking (`hit.object instanceof SplatMesh`), not splat-level.

### Built (this session)

1. **`PercentileTimer`** — sliding-window nearest-rank percentile (p50, p95, max). 7 TDD'd tests.
2. **`SplatCenters`** — cached `Float32Array` of decoded splat centers (3 floats per splat). `nearestTo(candidateIds, worldPoint)` answers "of these candidate splat IDs, which one is closest?" in O(K) where K = candidates per query (typically tens, never the whole scene). 7 TDD'd tests.
3. **Picker pipeline upgrade** (`src/main.ts`):
   - Each `pointermove` is timed via `performance.now()` around the picker call.
   - On hit: `VoxelHash.splatsIn(key)` returns the splat IDs in the picked voxel; `SplatCenters.nearestTo(...)` finds the one closest to the world hit point.
   - A small yellow sphere marker is positioned at the nearest splat's center.
   - The stats panel grows a `pick` line showing `p50=… p95=… max=… n=…`.
   - Press `R` to reset the latency stats.

## Measurement protocol

In the browser at <http://localhost:5173/>:

1. Wait for the stats panel to populate (splats > 0).
2. Drag the camera so the butterfly fills most of the canvas.
3. Press `R` to reset latency stats.
4. Slowly sweep the mouse across the butterfly (no fast flicks — we want representative samples, not stress-test).
5. Read the `pick` line. We're looking for:
   - **H1a (voxel cell):** the cyan voxel cursor tracks the cursor smoothly with no visible lag.
   - **H1b (specific splat):** the yellow marker dot lands plausibly *on* the splat under the cursor — not floating off, not stuck.
   - **Latency:** `p95` < 10 ms (the plan's bar) on the user's hardware.

The infrastructure is in place. The numbers come from the field session, not the test runner.

## Expected results (informed guess, to be validated)

On a modern Apple Silicon laptop with `butterfly.spz` (~177k splats):

- **Spark WASM raycast**: sub-millisecond, since the `raycast_packed_buffer` kernel is hand-optimised SIMD.
- **`VoxelHash.splatsIn(key)`**: O(1) Map lookup, sub-µs.
- **`SplatCenters.nearestTo`**: O(K) with K = splats per voxel; from the live stats we saw `max=221 mean=42.6`, so worst case ~221 distance comparisons. Sub-µs.
- **Total pipeline (NDC → Raycaster → voxel snap → nearest-splat → marker move)**: expect p50 < 1 ms, p95 < 3 ms.

If the field numbers blow past 10 ms, the bottleneck is almost certainly Spark's WASM warmup or the canvas readback path — not our voxel layer.

## What this doesn't measure (yet)

The plan's H1 also calls for a **synthetic agreement-rate test** against ground truth:

> Lock the camera, jiggle the mouse over 100 sampled pixels with known ground-truth splat IDs (sampled by CPU iteration), measure agreement rate. Target ≥95% on non-silhouette pixels.

This requires an independent ground-truth picker. Two options:

- **CPU ray-ellipsoid intersection over a BVH** — slow, but gives a defensible reference.
- **Custom render-target picker** (Option A from `docs/research/2026-05-19-picking-agent-report.md`) — fast, but is the very thing we wanted to avoid for Wave A.

This is deferred to the **next Wave B chunk**. The reason: visual sanity ("does the yellow dot land on what I'm pointing at?") is a cheap heuristic for whether the agreement rate is anywhere near 95%. If it visibly fails, we add the synthetic test. If it visibly succeeds, we can probably ship H1 as "partial" and move on.

## Decision criteria for the next chunk

- **If the yellow marker tracks well + p95 < 10 ms** → declare H1a ✅ + H1b ✅ partial (no agreement-rate number yet), and start Wave C (carve).
- **If the yellow marker mis-lands frequently** (>1 in 10 picks at non-silhouette pixels) → build the synthetic agreement test next, then either accept the degradation or switch to the custom render-target picker.
- **If p95 > 10 ms** → profile. Likely Spark WASM warmup; should stabilise after the first few seconds.

## Repo state at end of this chunk

Two new TDD'd pure modules, one integration update, this dossier, this README link. 51 unit tests passing (15 + 8 + 7 + 7 + 7 + 7 by module). Awaiting field measurement.
