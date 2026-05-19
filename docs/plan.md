# splatcarve — Research-Driven Plan

> **One-line thesis**: Validate, in the browser with WebGPU, whether a 3D Gaussian Splat scene can be **hover-raycast at the splat level** and **carved or stacked at voxel resolution** — and open-source the experiment under `stevekwon211/splatcarve` (MIT).

---

## 0. Context

The user is starting a personal, curiosity-driven OSS side project at the intersection of 3D Gaussian Splatting (3DGS) and voxel-grid editing. This project is fully separate from the user's `Zero` voxel sandbox; no shared code, no shared scope. The prior conversation produced an extensive literature survey of the GS+voxel landscape (Scaffold-GS, Octree-GS, VolSplat, GaussianFormer, GaussianOcc, Spark 2.0, SuperSplat, etc.). That survey concluded that **production GS+voxel hybrids exist for collision/streaming/occupancy, but no public OSS project demonstrates voxel-resolution interactive carving + stacking on top of a real splat scene.** That gap is `splatcarve`'s target.

The user's specific intuition — *"호버해서 raycast 되고 복셀 해상도 만큼 스플랫 일부가 파거나 쌓을 수 있는가?"* — translates to a sharp, falsifiable research question. This plan is designed to answer it the way real research does: hypothesis-by-hypothesis, with explicit verification criteria.

Three parallel research agents (Explore subagent type) have already canvassed the ecosystem. Their concentrated findings are integrated below.

### 0.1 Critical conceptual clarification — "voxel" ≠ "voxel engine"

To prevent future confusion: **splatcarve does not build or use a voxel engine.** The word "voxel" in this plan denotes only a *coordinate quantization* — i.e., a snap-to-grid math function plus a hash map. The world state is the splat array; the voxel grid is an invisible overlay used to *group* splats for editing.

| | This project's "voxel" | A real voxel engine's voxel |
|---|---|---|
| What is stored | `Map<"i\|j\|k", SplatId[]>` | per-cell material, occupancy, etc. |
| What is rendered | nothing (wireframe overlay optional) | meshed cells via greedy mesher etc. |
| Source of carving | delete splats whose centers fall in cell | remove cell from grid |
| Source of stacking | duplicate splats from neighbor cell | place material in cell |
| World authority | splats | voxel grid |

A separate, larger project (provisional name `splatworld`) would be needed to do the *voxel-native, splat-skinned* approach. That is **out of scope** here and explicitly listed in §9.

---

## 1. Objective & Success Criteria

### Real objective

> Build a single-page WebGPU demo, hosted on GitHub Pages, where a user can:
> 1. Load a publicly-available 3D Gaussian Splat scene (.ply / .spz),
> 2. **Hover** any pixel and have the system identify the splat under the cursor at sub-frame latency,
> 3. **Snap** that hit to a configurable voxel grid and visualize the target voxel cell,
> 4. **Carve** (click-and-drag) — delete all splats whose centers lie in the brushed voxel cells, producing visible holes,
> 5. **Stack** (click-and-drag with a different tool) — add new splats into empty voxel cells adjacent to occupied ones, using a nearest-neighbor cluster copy mechanism.

This is enough for a community-grade OSS demo with a 30-second video that says something nobody else has shown publicly.

### Definition of "done" per wave

| Wave | Done = |
|------|--------|
| **A** | `pnpm dev` opens a live page where a sample .ply scene renders at >60 FPS on the user's laptop, voxel grid wireframe overlay can be toggled and resolution adjusted, console logs splat count per voxel. Repo public on GitHub under `stevekwon211/splatcarve`. |
| **B** | Hovering any pixel highlights one specific splat (color tint) within 5ms of mouse move; the voxel cell containing that splat's center is wireframe-highlighted. H1 evaluated. |
| **C** | Click-and-drag carves voxel-sized chunks; deleted splats vanish from render; undo/redo works on a stack of ≥20 ops; FPS stays >30. H2 evaluated. |
| **D** | Click-and-drag in stack mode adds splat clusters to empty voxel cells adjacent to the scene; clusters look like coherent material (copied from neighbor); FPS stays >30 even after 200 stack ops. H3 evaluated. |
| **E** | Demo URL live at `stevekwon211.github.io/splatcarve`, README explains architecture + hypotheses + results, MIT license, CI passing, social-shareable 30-second video. |

### Success criteria for the project as a whole

- All three hypotheses (H1, H2, H3 below) are answered **yes / partial / no**, with measured evidence.
- The repo is reproducible by a stranger in <10 minutes (`git clone && pnpm i && pnpm dev`).
- The README contains an honest "what worked, what didn't" section — falsified hypotheses are kept visible, not buried.

---

## 2. Constraints & Assumptions

### Constraints

- **Solo developer**, evenings + weekends, 6–12 weeks total wall-clock.
- **Public from day 1**, MIT license, no proprietary dependencies.
- **Target platforms**: latest Chrome / Edge / Safari Tech Preview on desktop. Mobile is a stretch goal, not a constraint.
- **Identity (durable)**: repo owned by `stevekwon211` GitHub account; all commits authored by `stevekwon211 <stevekwon211@gmail.com>`. Git author config is already in place for `~/OpenSource/` via `includeIf` (set in a prior session). The `gh` CLI identity is enforced by a **PreToolUse hook on Bash** added in Wave A — when `cwd` is under `~/OpenSource/`, the hook ensures the active `gh` account is `stevekwon211`. Decision recorded; no per-command discipline needed.
- **Stack (durable)**: TypeScript + WebGPU on top of **Spark.js** (World Labs, MIT), bundled with Vite. **No Rust, no WASM in the MVP.** Rust+WASM remains an option for post-MVP hotpath optimization only if profiling shows the JS hash-grid build / brush iteration is a bottleneck — measurement before optimization. The "voxel engine" concept (Rust+WASM, voxel-as-world-state) is a *different project* (see §9).
- **No model training in MVP** — we consume splat scenes produced by other tools (Polycam, Inria, Spark gallery).

### Assumptions (and their risk grade)

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Spark.js (`@worldlabs/spark`) is the right base — actively maintained (v2.1.0 Apr 2026, MIT), TypeScript, three.js-compatible, exposes per-splat data via `forEachSplat`/`setPackedSplat`. | Medium — fallback is `mkkellogg/GaussianSplats3D` (older but battle-tested) or building on a fork of `KeKsBoTer/web-splat`. |
| A2 | We can extend Spark's `SparkRenderer` with a custom render target that writes per-splat ID + expected depth — the same pattern SuperSplat uses successfully in production. | **High** — this is Wave B's central technical bet. If Spark resists this customization, we either fork Spark or fall back to CPU BVH (Option B in research). |
| A3 | Splat scenes of typical interest (Inria mip-NeRF360, Polycam captures) sit in a coordinate system with bounded scale, so a single uniform voxel grid (e.g., 128 voxels along the longest AABB axis) gives a sensible default. | Low — easily parameterized. |
| A4 | "Stack at voxel resolution" can produce a *visually plausible* result via nearest-neighbor splat-cluster copy, without any learned material model. | Medium — visual quality may be unsatisfying; falsifying H3 is itself a publishable finding. |
| A5 | The user has sufficient local GPU (Apple Silicon or equivalent) to render scenes up to ~1.5M splats at interactive rates. | Low. |

---

## 3. Knowledge Base — Synthesized Research

This section integrates the three parallel research agents. The full agent reports are saved verbatim under `docs/research/` (see Wave A). Highlights only here.

### 3.1 Library landscape (Agent: ecosystem)

| Library | License | WebGPU | TS + three.js | Per-splat API | Per-pixel depth | Maintenance | Fit |
|---|---|---|---|---|---|---|---|
| **Spark.js** (World Labs) | MIT | optional in v2.0+ | yes (r179+ from v2.1) | yes (`forEachSplat`, `setPackedSplat`, `objectModifiers`) | optional `depthWrite`, custom render targets | active (v2.1 Apr 2026, commits May 2026) | **primary base** |
| **SuperSplat** (PlayCanvas) | MIT | no (WebGL2) | yes | yes (editor) | not via public API | active (v2.26 May 2026) | **reference for picking logic** |
| `mkkellogg/GaussianSplats3D` | MIT | no | yes | partial | none | mostly maintenance | fallback |
| `antimatter15/splat` | MIT | no (WebGL1) | minimal | no | none | deprecated — author defers to Spark | reference only |
| `KeKsBoTer/web-splat` | Apache-2.0 | yes (pure WGPU/Rust) | no (Rust/WASM, no TS bindings) | no | no | stale | not viable |

**Key finding**: None of these expose a per-pixel depth texture by default. Spark is the most extensible — its `SparkRenderer` supports custom render targets, which is the door we need to open.

### 3.2 Picking architecture options (Agent: picking)

**Option A — Screen-space render-to-texture (SuperSplat's pattern, production-proven):**
- Two off-screen render targets: (1) **splat ID** packed into RGBA8 (32-bit ID per pixel), (2) **expected depth** in half-float with blend state `ONE + ONE_MINUS_SRC_ALPHA` to accumulate transmittance-weighted depth.
- On mouse move: async `texture.read(x, y, 1, 1)` for both targets → 4-byte → uint32 ID + half-float → float32 depth.
- Unproject `(x, y, depth)` through inverse camera matrix → world-space hit point.
- Reference implementation: `playcanvas/supersplat/src/picker.ts` (`readId`, `readIds`, blend setup, half-float conversion at lines ~40–65).
- **Latency**: ~1–2 ms per pixel readback (WebGL2). WebGPU compute-based readback is slightly faster.
- **Pros**: handles translucency natively, no CPU spatial structure needed, production-validated.
- **Cons**: expected depth is *transmittance-weighted*, not first-hit — at translucent silhouettes this can read "behind" the visible splat by tens of percent of voxel size.

**Option B — CPU ray-ellipsoid + BVH:**
- Treat each splat as an ellipsoid at 3σ isodensity. Build BVH over ellipsoid AABBs once at load. Ray-ellipsoid is a quadratic in `t`: solve `(o + t·d − μ)^T Σ^{−1} (o + t·d − μ) = c`.
- **Pros**: deterministic per-splat hit, supports k-NN density queries.
- **Cons**: BVH rebuild cost on edits, ~5–20 ms per query on >1M splat scenes, more code to write and verify.

**Option C — GPU compute readback:**
- Dispatch a compute shader per mouse ray; each thread tests N splats; writes (id, t) to a small output. Read 1 pixel.
- **Pros**: scales without BVH; supports density integration.
- **Cons**: WGSL boilerplate, GPU↔CPU sync cost (~3–5 ms).

**Recommendation**: **Option A** for MVP. Same pattern as SuperSplat, lowest implementation complexity. Keep B in our back pocket if silhouette imprecision blocks H2.

### 3.3 Voxel-splat bridge (Agent: voxel bridge)

**The MVP rule for splat-to-voxel assignment** (the heart of the voxel quantization):

> A splat is assigned to the voxel containing its **center** μ. Multi-voxel coverage (a splat whose 3σ ellipsoid spans neighboring voxels) is **ignored** for MVP — we accept some visual leakage at carve boundaries as the cost of simplicity. Mitigation is deferred to a post-MVP "conservative deletion" experiment (a candidate H4 in §7).

**Data structure**: a JavaScript `Map<MortonCode, Set<SplatId>>` or, for slightly better cache behavior in TS, a `Map<string, Uint32Array>` keyed by `${i}|${j}|${k}`. Both are O(1) for our scales (~1M splats × 128³ voxels at worst, but voxel occupancy is sparse in practice).

**Carve mechanism**: lookup splat IDs in target voxel(s) → flip a per-splat `deleted` flag → push deletion to GPU via Spark's per-splat opacity write (set `opacity = 0` *or* move μ to `NaN` / outside frustum). Re-sort happens on next frame automatically.

**Stack mechanism (MVP)**: on click in empty voxel cell:
1. Find the nearest occupied voxel in a 3×3×3 (later 5×5×5) neighborhood.
2. Extract its splat cluster (all splats whose centers lie in that voxel).
3. Copy the cluster, translate by `(target_center − source_center)`, optionally jitter scale ±10% / rotation ±5°.
4. Insert into a pre-allocated "stack region" of the splat buffer.
5. Update the voxel hash.

**Why not learned (VolSplat-style) generation in MVP**: inference latency (~350 ms) breaks interactivity; training requires data we don't have. The nearest-neighbor copy is the cheapest visually-coherent baseline. Falsifying H3 with this baseline is still a useful research result.

### 3.4 File formats and sample scenes

- **Input formats (MVP order)**: `.ply` (Inria standard — 45 floats per splat) → `.spz` (Niantic compressed, gzip over PLY) → `.ksplat` (mkkellogg's 32-byte format, fallback only).
- **Export format**: `.ply` (universal, opens in SuperSplat / Spark / PlayCanvas).
- **Sample scenes** (free for OSS use):
  - Inria official samples (Apache-2.0): https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
  - Spark examples repo (MIT)
  - We will check in 1–2 small scenes (~30–80 MB) directly to `public/scenes/` for zero-config demo.

### 3.5 Risks identified across the research

1. **Expected-depth ≠ first-hit depth.** At translucent edges, readback can lie "inside" the visible surface. Mitigation: voxel size set conservatively to 2–3× the typical splat radius; offer a depth-bias slider.
2. **Anisotropic splats vs axis-aligned voxels.** A single large splat may belong, by center, to one voxel but visibly contribute to four. Carving leaves wisps. Accepted for MVP; documented as known limitation.
3. **Sort order changes after edits.** Splats are alpha-blended back-to-front. Removing a splat can shift the visible silhouette of the splats *behind* it. Visually mostly fine, occasionally pops. We instrument FPS variance, not just mean.
4. **Spark's render-target customization may not allow ID/depth packing without a fork.** This is A2 above — the single biggest unknown. Wave A includes a 1-day spike to confirm before committing to Wave B.
5. **Half-float depth precision** is ~1:1024 relative — fine at typical voxel sizes (≥1 cm in world units), bad at sub-cm. Document the constraint.

---

## 4. Hypotheses (falsifiable, mapped to waves)

| ID | Statement | Falsifies if | Maps to |
|----|---|---|---|
| **H1 — Picking is feasible** | A web-based 3DGS renderer can be extended to write a per-pixel splat-ID + expected-depth pair, enabling mouse-hover to identify a specific splat at <10 ms latency on a 1M-splat scene. | Latency >50 ms median, or splat ID readback returns visibly wrong splats >20% of the time at non-silhouette pixels. | Wave B |
| **H2 — Voxel-resolution carve is feasible** | Given H1, deleting all splats whose centers lie in a brushed voxel cell produces a visually clean hole at interactive latency, with FPS >30 on a 1M-splat scene during continuous brushing. | Holes are not visually recognizable (wisps remain) at voxel sizes ≥ 2× mean splat radius; OR FPS drops below 30 during a 100-stroke session; OR re-sort artifacts are visually disqualifying. | Wave C |
| **H3 — Voxel-resolution stack is feasible** | Given H1–H2, copying a nearest-neighbor splat cluster into an empty voxel cell produces a visually coherent "added material" effect at interactive latency. | Stacked clusters look obviously wrong (seam artifacts, scale mismatch) >50% of the time in user judgment; OR cumulative buffer growth slows the renderer below 30 FPS after 200 stack ops. | Wave D |

A *partial* outcome (e.g., "H2 holds at voxel size ≥ 3× mean splat radius but not below") is a valid research result and is reported as such.

---

## 5. Phased Plan

Five waves, each substantial enough to be a single complete implementation session of ~1–3 weeks of evening work. Each wave has its own goal, hypothesis (if any), inspection/research targets, build steps, risks, and verification.

---

### Wave A — Foundations & First Light (~1 week evenings)

**Goal**: Repo exists publicly on `stevekwon211/splatcarve`. A sample .ply renders in the browser. A configurable voxel-grid wireframe overlays the scene. Splat→voxel hash is computed and inspectable. **No editing yet.** Research dossier is checked in.

#### Inspect / read (external)

- `https://github.com/worldlabs/spark` — primary base library. Specifically:
  - `src/SparkRenderer.ts` — confirm the `renderTarget` extension point exists and is usable from app code without a fork.
  - `src/SplatMesh.ts` — confirm `forEachSplat`, `setPackedSplat`, and `objectModifiers` semantics.
  - `examples/` directory — pick the closest starter example (likely a vanilla three.js loader).
- `https://github.com/playcanvas/supersplat/blob/main/src/picker.ts` — read in full now (don't write code yet) so the Wave B mental model is loaded.
- `https://github.com/playcanvas/supersplat/blob/main/src/camera.ts` — mouse → ray unprojection pattern.
- Inria sample scene list at `https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/` — pick one scene <100 MB.

#### Build

1. **Install gh-auth hook** (one-time, durable for all `~/OpenSource/` work):
   - Add a PreToolUse hook on `Bash` to `~/.claude/settings.json` (use the `update-config` skill).
   - Hook script (lives at `~/.claude/hooks/scripts/opensource-gh-auth.sh`): if `$PWD` starts with `/Users/doeonkwon/OpenSource/` and the active `gh` account is not `stevekwon211`, run `gh auth switch --user stevekwon211 --silent` and emit a one-line stderr notice. Idempotent and silent on the happy path.
   - Verify by running `gh auth status` from inside `~/OpenSource/splatcarve/` after the hook is installed — must show `stevekwon211` as Active.
2. **Identity fix-up (one shot, in case hook not yet taken effect)**: `gh auth switch --user stevekwon211`. Confirm with `gh auth status`.
3. **Repo bootstrap** under `/Users/doeonkwon/OpenSource/splatcarve/`:
   - `pnpm create vite splatcarve --template vanilla-ts`
   - Install: `pnpm add three @types/three @worldlabs/spark` (exact package name TBD on Spark's npm registry).
   - Add: `vitest`, `eslint`, `prettier`, `typescript` (latest).
   - Configure `tsconfig.json` for strict mode (per the user's global preferences).
4. **License & README skeleton**:
   - `LICENSE` — MIT, copyright `Doeon Kwon (stevekwon211)`.
   - `README.md` — placeholder with goal, status badge, "🚧 work in progress".
   - `.gitignore` — Vite/Node defaults + `public/scenes/*.ply` if large (use Git LFS or skip large scenes).
5. **GitHub repo creation**:
   - `gh repo create stevekwon211/splatcarve --public --description "Voxel-resolution carve & stack on 3D Gaussian Splat scenes (WebGPU experiment)"` — verify owner before running.
   - First commit: `feat: bootstrap splatcarve repo` (conventional commit per global prefs).
   - Push.
6. **Research dossier preservation**:
   - Save the original survey report from the prior conversation to `docs/research/2026-05-19-gs-voxel-survey.md`.
   - Save the three Wave-A research-agent reports verbatim to `docs/research/2026-05-19-{ecosystem,picking,voxel-bridge}-agent-report.md`.
   - Add a `docs/research/README.md` index.
   - Also save the conceptual "voxel ≠ voxel engine" clarification (§0.1 of this plan) to `docs/architecture/voxel-conceptual-model.md` so contributors see it before reading code.
7. **Spark render-target spike** (1-day budget, gate for Wave B):
   - Single-file spike: instantiate a `SparkRenderer`, override `renderTarget`, attempt to write to a dummy R8G8B8A8 texture, read back one pixel. Goal is *not* picking yet — just confirming the extension point works without a Spark fork.
   - Outcome → `docs/research/2026-05-XX-spark-render-target-spike.md`. If the spike fails, surface to the user before Wave B (open question Q1).
8. **"Hello splat"**:
   - Load one Inria sample .ply via Spark + three.js.
   - OrbitControls. Pure-camera demo.
   - Verify FPS counter shows ≥60 on the user's laptop.
9. **Voxel grid overlay**:
   - Compute scene AABB from splat positions.
   - Default voxel resolution: 64 along longest axis (parameterizable via URL query, e.g., `?vox=128`).
   - Render wireframe cube grid as a single InstancedMesh or LineSegments.
   - Toggle key: `G`.
10. **Splat→voxel hash, console-only**:
    - On load, iterate splats, compute voxel index `(i, j, k) = floor((p − origin) / voxelSize)`.
    - Build `Map<string, Uint32Array>` keyed by `${i}|${j}|${k}`.
    - Log: total splats, occupied voxel count, max splats-per-voxel, mean splats-per-voxel.

#### Risks

- **Spark's renderTarget customization may not be exposed cleanly.** Spike *immediately* in Wave A (1-day budget) — try writing a single dummy render target via `SparkRenderer.renderTarget = ...`. If it requires a fork, surface to the user before continuing to Wave B.
- **Inria scene licensing**: confirm Apache-2.0 (or per-scene CC); if any scene requires non-OSS license, swap it out.
- **Bundle size**: Spark + three.js can push initial JS payload past 500 KB. Acceptable for an experiment; document.

#### Verify

- `pnpm dev` opens a page showing the loaded scene + (toggleable) voxel grid wireframe.
- Console prints sane occupancy stats (e.g., "1,043,920 splats, 38,221 occupied voxels, max 1,847 splats/voxel").
- `gh repo view stevekwon211/splatcarve` shows the repo public with at least the README, LICENSE, `src/`, `docs/research/`.
- A 1-day spike report on Spark's render-target extensibility is committed to `docs/research/2026-05-XX-spark-render-target-spike.md`.

---

### Wave B — Picking (H1) (~2–3 weeks evenings)

**Goal**: Validate H1. Hovering any pixel highlights one specific splat in the rendered scene; the voxel cell containing that splat's center is wireframe-highlighted in a contrasting color.

#### Inspect / read

- `playcanvas/supersplat/src/picker.ts` in full — adapt its rendering pattern, not copy line-for-line (license differs in spirit even though both are MIT — be a clean-room reimplementation in style).
- The Spark `SparkRenderer.ts` source for the precise render-target API surface.
- WebGPU spec on async readback (`copyTextureToBuffer`, `mapAsync`).
- three.js `Raycaster` source for camera unprojection math (we don't use `Raycaster` directly, but its math is the reference).

#### Build

1. **Custom render targets**:
   - Add a second render pass on Spark's renderer that writes:
     - **RT0 — splat ID**: RGBA8 texture. Each splat's `gl_InstanceID` (or equivalent Spark internal ID) packed into the four bytes.
     - **RT1 — depth**: R16F texture, accumulated with `blendEquation = ADD`, `blendSrc = ONE`, `blendDst = ONE_MINUS_SRC_ALPHA` — exactly SuperSplat's expected-depth recipe.
   - Both rendered at full canvas resolution. Pass is gated behind a `pickerEnabled` flag so it only runs when the mouse moves.
2. **Async readback**:
   - On `mousemove`, schedule a readback at the cursor pixel (`gl.readPixels` for WebGL2, `device.queue.copyTextureToBuffer` + `buffer.mapAsync` for WebGPU).
   - Decode 4 bytes → uint32 splat ID.
   - Decode 2 bytes → float32 depth.
3. **Unproject to world**:
   - `(ndc_x, ndc_y, depth) → world` via `inverse(viewProjMatrix)`.
   - Sanity check: distance from camera ≈ depth ✓.
4. **Visualize**:
   - Picked splat: outline by inflating its scale 1.1× and tinting `f_dc` red for one frame (or render a billboard ring around its mean).
   - Picked voxel cell: render the single cube wireframe in a contrasting color (cyan) replacing that index in the grid overlay.
5. **Measure H1**:
   - FPS counter and per-frame readback latency timer.
   - Synthetic test: lock the camera, jiggle the mouse over 100 sampled pixels with known ground-truth splat IDs (sampled by CPU iteration), measure agreement rate.
   - Record results in `docs/research/2026-05-XX-h1-results.md`.

#### Risks

- **Splat ID overflow**: scenes with >2^24 splats need 4-byte packing exactly — verify with the largest test scene.
- **Sort order vs ID render**: splats must be drawn back-to-front for the ID texture *too*, otherwise an opaque-front splat's ID may be overwritten by an occluded-back splat in unfortunate frame orderings. We render the ID pass with depth-test set to write only when alpha >0.5 to bias toward the visually-front splat.
- **Half-float depth precision** at scenes with large camera distance: switch to R32F if H1 measurements show >5% mis-snap rate.
- **Spark forking**: if Spark resists the render-target injection cleanly, fork it under `vendor/spark/` and patch. Document the fork.

#### Verify

- Manual: hover over a recognizable object in the scene; visually-front splat lights up. Move mouse smoothly across the scene; highlights track without lag.
- Quantitative: agreement rate >95% on non-silhouette pixels.
- Latency: 5th–95th percentile mouse-move-to-highlight time <10 ms.
- H1 evaluated. If falsified, write up *why* (e.g., "expected depth is too noisy at translucent surfaces — switching to CPU BVH"), then either pivot to Option B/C from §3.2 or pause and discuss with user.

---

### Wave C — Carve (H2) (~2–3 weeks evenings)

**Goal**: Validate H2. The user holds a mouse button and drags; voxel-sized chunks of the splat scene are deleted as the brush sweeps; visible holes appear cleanly; undo/redo works.

#### Inspect / read

- `playcanvas/supersplat/src/tools/sphere-selection.ts` and `playcanvas/supersplat/src/edit-ops.ts` — for the undo/redo `do`/`undo` pattern and the sphere-region splat query.
- Spark's `setPackedSplat` / `objectModifiers` source — confirm we can mutate per-splat opacity without re-uploading the entire buffer.

#### Build

1. **Per-splat deletion flag** (GPU side):
   - Pre-allocate an additional storage buffer indexed by splat ID containing a `deleted` bit (or use opacity = 0 as a sentinel — simpler).
   - Modify Spark's fragment shader (or, if a fork, the shader graph) to early-out when `deleted` is set. Confirm this works without breaking existing animation modifiers.
2. **Brush UI**:
   - Cursor mode toggle keys: `1` = none, `2` = carve, `3` = stack (Wave D).
   - Brush radius (in voxels), controlled by scroll wheel. Default radius 1 (single voxel).
   - Brush shape: sphere of voxels (all voxels within radius `r` of the picked voxel center).
3. **Carve operation**:
   - On `mousedown` in carve mode + at each `mousemove` while held:
     - Use Wave-B picker to find the target voxel `(i, j, k)`.
     - Compute the set of voxels within brush radius.
     - For each voxel: lookup splat IDs from the hash → push to a deletion batch.
   - Flush the deletion batch once per frame (not per mouse event) — set `deleted = true` for all batched IDs.
4. **Undo/redo**:
   - `CarveOp` data: list of deleted splat IDs. `do()` deletes them, `undo()` restores them.
   - Keys: `Cmd+Z` / `Cmd+Shift+Z`.
   - Stack capacity: 100 ops (then oldest pops).
5. **Measure H2**:
   - Visual: capture 30-second screen recording of a continuous carving session.
   - FPS distribution recorded during the session.
   - Voxel-size ablation: run the same carve session at voxel sizes {0.5×, 1×, 2×, 4×} mean splat radius; record at which size holes look "clean" (subjective judgment + screenshots in dossier).

#### Risks

- **Wisps at boundary** (multi-voxel splats whose center is outside the brushed voxel but whose ellipsoid extends in): expected; document with screenshots. Possible mitigation experiment (post-MVP, candidate H4): conservative deletion where any splat overlapping the voxel by ≥X% is also marked.
- **Mass mutation performance**: brushing 1000 splats/frame requires us to *not* rebuild the entire GPU buffer. Per-splat opacity write must be a partial buffer update.
- **Sort-order popping**: after deletion, some far-back splats become visible; this is correct but visually surprising. Capture but accept.
- **Undo overflow**: if the user carves 50,000 splats in one stroke, the `CarveOp` payload is 200 KB of IDs — fine in memory, fine to log, just keep the stack capped.

#### Verify

- Carving 20 voxels' worth produces visible, recognizable holes from multiple angles.
- FPS >30 throughout a continuous 30-second carve stroke on a 1M-splat scene.
- Undo restores splats exactly (pixel-diff a screenshot before/after a `do→undo`).
- Ablation table committed to `docs/research/2026-05-XX-h2-results.md`.

---

### Wave D — Stack (H3) (~2–3 weeks evenings)

**Goal**: Validate H3. In stack mode, click-and-drag *adds* splat clusters to empty voxel cells adjacent to occupied ones, using nearest-neighbor cluster copy. Clusters look visually coherent with the surrounding material.

#### Inspect / read

- Wave-C's `edit-ops` pattern — `StackOp` mirrors `CarveOp` (do = add splats; undo = remove).
- Spark's mechanism for *adding* splats at runtime — `SplatMesh.setPackedSplat(index, …)` likely writes into a pre-allocated slot. Confirm via Spark source.
- Voxel-bridge agent's "nearest-neighbor cluster + scale-to-fit" recipe.

#### Build

1. **Pre-allocated stack region**:
   - At load time, allocate an additional buffer slot of `N_stack = 200_000` empty splats appended to the scene's splat array. These slots have `deleted = true` until used.
   - Maintain a free-list of unused stack slots.
2. **Stack operation**:
   - On `mousedown` in stack mode at empty-voxel hit:
     - Resolve the target voxel `(i, j, k)` adjacent to an occupied voxel (snap rule: target is the voxel face the camera is "looking through"; if user clicks into open air, target is the empty voxel sharing the most faces with occupied neighbors).
     - Find the nearest occupied voxel in a 3×3×3 neighborhood. If none, expand to 5×5×5. If still none, the click is a no-op (visual: cursor turns gray).
     - Extract the source splat IDs from the source voxel.
     - For each source splat:
       - Allocate a stack slot.
       - Copy the source splat's parameters.
       - Translate μ by `(target_center − source_center)`.
       - Optional jitter: scale ×= 0.9–1.1, rotation += ±5° around a random axis.
       - Clear the `deleted` flag.
       - Add the new splat ID to the voxel hash under target voxel.
   - All within a single `StackOp`.
3. **Visual feedback**:
   - Show a "ghost preview" of the cluster at the target voxel while the mouse is held but not yet released.
   - Confirm placement on `mouseup`.
4. **Undo/redo** symmetric with carve.
5. **Measure H3**:
   - Stack 20 cells along a flat surface (e.g., extending a wall outward). Visually inspect for seams.
   - Stack 200 cells over a session. FPS stays >30.
   - User subjective rating per scene: "does the stacked material look like it belongs?" (1–5 Likert, recorded honestly even if low).

#### Risks

- **Visual seam between source and target voxel** — most likely failure mode. If clusters reveal grid-aligned tiling, H3 falsifies. Mitigation options to try in order:
  - Increase jitter range.
  - Sample from a *region* of nearest occupied voxels, not a single one.
  - Blend boundary opacity with a sigmoid.
- **Cluster orientation mismatch** at curved surfaces: nearest-neighbor copy at the back of a curved wall, applied to an extending position, may rotate awkwardly. Document.
- **Splat buffer growth past pre-allocated capacity** — fall back to "free oldest stacked splats first" or refuse new stacks with a UI warning.
- **Density runaway**: stacking next to an already-stacked region doubles density. Add a density cap per voxel (e.g., 200 splats max).

#### Verify

- Stack a recognizable "extension" (e.g., extend a stone bench by 3 voxels) and screenshot it from multiple angles.
- FPS >30 after 200 stack ops on a 1M-splat scene.
- Subjective coherence rating recorded with screenshots in `docs/research/2026-05-XX-h3-results.md`.

---

### Wave E — Polish, Demo, Open Source (~1–2 weeks evenings)

**Goal**: A stranger can find the project, understand what it shows in 30 seconds, run it locally in <10 minutes, and form an opinion on each hypothesis.

#### Build

1. **Live demo URL**:
   - GitHub Actions: build on push to `main`, deploy `dist/` to `gh-pages`.
   - URL: `https://stevekwon211.github.io/splatcarve/`.
   - Include a bundled small scene (~30 MB) for zero-config first impression.
2. **Demo video**: 30 seconds, screen-recorded:
   - Load scene → toggle voxel grid → hover-to-pick → carve a chunk → stack a chunk → close.
   - Soundtrack-free, captioned with hypothesis names ("H1 ✓", "H2 partial", etc.).
3. **README rewrite** (the most important deliverable):
   - One-line pitch.
   - 30-second video embed.
   - "What this is" + "What this is not".
   - Hypotheses + result for each (✓ / partial / ✗) with one-paragraph evidence.
   - "Try it" instructions: deployed URL + local clone.
   - "Architecture" diagram (one image, ASCII art is fine).
   - "Known limitations" section — explicitly listing the multi-voxel-occupancy issue, half-float depth issue, sort-order popping, density cap, etc.
   - "Why this exists" — short paragraph, link to the research dossier under `docs/research/`.
   - License, citation, related work.
4. **CI**:
   - GitHub Actions: `pnpm i && pnpm typecheck && pnpm test && pnpm build`.
5. **Social**:
   - Post-launch checklist (user runs themselves): tweet thread, HN Show, /r/GaussianSplatting.

#### Verify

- A friend (or yourself one week later) can land on the repo cold and run the demo locally in <10 minutes.
- The README is short enough to read in 3 minutes but answers every "wait, but…" question a curious engineer would ask.

---

## 6. Critical External References

Files to read (not modify — they are in other people's repos) before Wave B and Wave C:

| Purpose | URL | What to study |
|---|---|---|
| Splat picker reference | `https://github.com/playcanvas/supersplat/blob/main/src/picker.ts` | Render targets, blend states, async readback, half-float decode |
| Mouse → ray unprojection | `https://github.com/playcanvas/supersplat/blob/main/src/camera.ts` | `focalPointPicked` event, NDC math |
| Sphere region selection | `https://github.com/playcanvas/supersplat/blob/main/src/tools/sphere-selection.ts` | Brush region query patterns |
| Edit-op pattern | `https://github.com/playcanvas/supersplat/blob/main/src/edit-ops.ts` | Undo/redo do/undo pattern |
| Renderer to extend | `https://github.com/worldlabs/spark` → `src/SparkRenderer.ts`, `src/SplatMesh.ts` | renderTarget override, per-splat write APIs |
| Rasterizer math reference | `https://github.com/nerfstudio-project/gsplat` | Forward kernel, expected-depth derivation |
| Foundational paper | `https://arxiv.org/abs/2308.04079` | Splat parameterization and projection math |
| Voxel quantization rule of art | `https://arxiv.org/abs/2509.19297` (VolSplat) | One-Gaussian-per-voxel decoder pattern (for post-MVP H4) |
| Sample scenes | `https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/` | Inria-licensed scenes |

---

## 7. Open Questions

These are flagged for decision *during* the work, not before:

1. **Q1 (Wave A spike outcome)**: Does Spark's `SparkRenderer` accept a custom render-target without a fork? If no, fork-and-patch vs swap to GaussianSplats3D? Decision: end of Wave A.
2. **Q2 (H1 outcome)**: If expected-depth precision is too low at silhouettes, do we fall back to CPU BVH (Option B) or GPU compute (Option C)? Decision: end of Wave B.
3. **Q3 (multi-voxel splat assignment)**: Post-MVP, do we promote "splat assigned to all voxels its 3σ ellipsoid touches" to a candidate H4? Likely yes if H2 wisps are perceptible.
4. **Q4 (stack material library)**: Post-MVP, do we add a pre-baked material library (Option C in voxel-bridge research) as a separate tool mode? Depends on H3 outcome.
5. **Q5 (input scene size cap)**: Do we cap to 1.5M splats for the live demo? Probably yes; document.
6. **Q6 (mobile)**: Stretch only. Not in MVP definition of done.

---

## 8. Verification — End-to-End

### 8.1 Pre-flight checks (Wave A)

```bash
# 1) Install the gh-auth hook into ~/.claude/settings.json (via update-config skill).
#    Hook script at ~/.claude/hooks/scripts/opensource-gh-auth.sh runs on every
#    Bash PreToolUse and silently switches gh active account to stevekwon211
#    whenever PWD is under /Users/doeonkwon/OpenSource/.

# 2) Verify the hook works
cd /Users/doeonkwon/OpenSource
gh auth status                              # must show stevekwon211 as Active
                                            # (hook should switch it from kwondoeon
                                            #  automatically if it isn't already)

# 3) Verify git author is correct under OpenSource/ (set in prior session)
mkdir -p /tmp/test-author && cd /tmp/test-author && git init -q \
  && git config user.email                  # not stevekwon211 here — control
cd /Users/doeonkwon/OpenSource && mkdir -p _verify && cd _verify && git init -q \
  && git config user.email                  # MUST print stevekwon211@gmail.com
cd /Users/doeonkwon/OpenSource && rm -rf _verify
```

### 8.2 Per-wave verification

Each wave's "Verify" subsection (above) defines its acceptance gate. The user reviews the wave's results dossier in `docs/research/` and signs off before moving to the next wave.

### 8.3 End-of-project verification

```bash
# Clean clone test
cd /tmp && rm -rf splatcarve-clean-test
gh repo clone stevekwon211/splatcarve splatcarve-clean-test
cd splatcarve-clean-test
pnpm i && pnpm dev
# → Should open browser to a working demo within 2 minutes

# CI parity
pnpm typecheck && pnpm test && pnpm build
# → All green
```

### 8.4 Honest reporting

The final README **must** include results for H1, H2, H3 — even if any of them is falsified. Falsified hypotheses with thoughtful root-cause analysis are part of the project's research value.

---

## 9. Out of Scope (for this MVP — listed to keep us honest)

- **Voxel-engine world (voxel-as-world-state) with splat material library.** This is the *other* project (`splatworld` — provisional). Rust+WASM, full chunk system, place/break voxels that own splat clusters. **Different repo, deferred.**
- Photorealistic hole-filling after carving (the exposed surface is empty, not regenerated). Deferred.
- Mesh + splat compositing in the same scene. Different project.
- Multiplayer / collaborative editing. Not now.
- Physics simulation on splats (PhysGaussian-style). Different project.
- AI-generated material stacking (VolSplat-style decoder). Post-MVP candidate.
- Mobile / iOS. Stretch only.
- Export to `.glb` / collision mesh / Unity / Unreal. Not now.
- Training a new splat scene from photos. Not in scope — we consume pre-trained scenes.

---

## 10. Estimated total wall-clock

| Wave | Estimate | Cumulative |
|---|---|---|
| A | 1 week | 1 wk |
| B | 2–3 weeks | 3–4 wk |
| C | 2–3 weeks | 5–7 wk |
| D | 2–3 weeks | 7–10 wk |
| E | 1–2 weeks | 8–12 wk |

At evening-and-weekend pace (~8 hours / week), total is ~6–12 weeks. The single biggest variance source is Wave B (the Spark fork question, Q1).
