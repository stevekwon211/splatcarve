# H2 partial results — splatcarve Wave C, first chunk

> **Date:** 2026-05-19.
> **Status:** Carve mechanism live (single-click); awaiting visual sign-off + FPS measurement under brushing.

## Hypothesis under test (H2)

> Given H1, deleting all splats whose centers lie in a brushed voxel cell produces a visually clean hole at interactive latency, with FPS > 30 on a 1M-splat scene during continuous brushing.

## What this chunk validates (and doesn't)

**Validates:**

- The mechanism: pick → voxel ID → `hash.splatsIn(key)` → `CarveOperation.snapshot` → `do()` → splats vanish on the next frame.
- Reversibility: `Cmd+Z` / `Cmd+Shift+Z` restores them exactly via the snapshotted original opacities.
- A bounded `EditHistory` stack — confirmed by TDD with 9 tests.

**Does NOT validate yet (deferred to next chunk):**

- **Continuous brushing.** This chunk does *single-click* carving only. Drag-stroke (`pointerdown` → `pointermove`-while-pressed → `pointerup`) becomes the next chunk, partly because it changes the snapshot story (we'd need a `StrokeCarveOp` that accumulates originals as new voxels enter the brush, rather than a single fixed-at-construction snapshot).
- **Brush radius > 1 voxel.** The plan calls for scroll-wheel radius; this chunk hard-codes radius = 1.
- **Wisps from multi-voxel splats.** Documented limitation in `docs/architecture/voxel-conceptual-model.md`. Will become visible in carved holes; we capture how bad it looks with screenshots, not fix it.

The reason for the chunk split: a single-click carve is the cleanest end-to-end test of the snapshot/undo path. Drag-brushing layers on a different concern (stroke as a single undo unit). Getting them in separate chunks keeps each H2 sub-claim independently verifiable.

## Built (this session)

### Read first (primary sources)

- `node_modules/@sparkjsdev/spark/dist/types/utils.d.ts` — confirmed `setPackedSplatOpacity(packedSplats, index, opacity)` exists (no encoding arg) and `unpackSplat(packed, index, encoding?)` returns `{ opacity, ... }`.
- `node_modules/@sparkjsdev/spark/dist/types/index.d.ts` — confirmed that `setPackedSplatOpacity` is **only** reachable via the `utils` namespace re-export, not directly. (`unpackSplat` is on both.)
- `node_modules/@sparkjsdev/spark/dist/types/SplatGenerator.d.ts` — confirmed `updateVersion(): void` is the API to mark a `SplatMesh`'s packed array dirty for GPU re-upload.
- `examples/interactive-holes/index.html` — confirmed the in-place-mutate-then-`updateVersion()` pattern. Note: that example does *not* zero opacities; it moves splats off-screen + shrinks them via a dyno shader. We chose the cleaner "set opacity to 0" approach because it's semantically a true "deleted" state and aligns with the plan's H2 wording.

### TDD'd pure modules

- **`EditHistory`** (9 tests) — bounded linear undo/redo, capacity eviction, redo-stack truncation on new record.
- **`CarveOperation`** (6 tests) — snapshot original opacities at construction, `do()` zeroes them + `commit`, `undo()` restores. Tests use a fake `SplatMutator` so no Spark dependency leaks into the unit test layer.

### Integration

- **`SplatMutator`** interface (read/write opacity + commit) — minimal surface needed by carve / future stack.
- **`PackedSplatMutator`** — concrete Spark-backed implementation. `dirty` flag means redundant `commit()` calls are free.
- **`main.ts`**: mode state machine (`pick` / `carve`); `1` and `2` toggle modes; in `carve` mode a click runs `carveAtVoxel(key)` → `CarveOperation.snapshot(mutator, hash.splatsIn(key))` → `op.do()` → `history.record(op)`.
- **Visual feedback**: voxel cursor cube turns red in carve mode; mode + history size + canUndo/canRedo shown in the stats panel.
- **Undo / redo**: `Cmd+Z` (or `Ctrl+Z`) reverses the last carve; `Cmd+Shift+Z` (or `Ctrl+Y`) replays.

## Measurement protocol (manual)

In the browser at <http://localhost:5173/>:

1. Wait for the stats panel to show splat count + voxel stats.
2. Press `2` to enter carve mode. Confirm:
   - Stats panel shows `mode carve`.
   - Voxel cursor cube turns red.
3. Hover over a clearly visible part of the butterfly. Confirm the red cursor cube tracks.
4. Click. Expect:
   - A small visible "hole" appears where the cube was.
   - Console logs `[splatcarve] carved voxel=… splats=N historySize=1`.
   - Stats panel `history n=1  undo:✓  redo:—`.
5. Repeat 5–10 times in different places. FPS line should stay ≥60.
6. Press `Cmd+Z` repeatedly. Each undo should restore one hole. After all undos, the scene matches its pristine state.
7. Press `Cmd+Shift+Z` repeatedly. Each redo should re-carve the same hole.

## Known limitation we expect to see

The "hole" at a single voxel may show **wisps** at its edge — fragments of splats whose centers fall in *neighboring* voxels but whose 3σ ellipsoid extends inside the carved voxel. This is the multi-voxel-occupancy issue documented in `docs/architecture/voxel-conceptual-model.md`. It is *not* a bug to fix now; it is exactly the visual phenomenon that motivates a future H4 ("conservative carve: also delete splats overlapping the voxel by ≥X%").

## Decision criteria for the next chunk

- **If single-click carve looks clean enough** (recognisable holes, undo restores exactly, FPS stays high) → next chunk implements drag-stroke + brush radius + the `StrokeCarveOp` that groups the stroke into one undo unit.
- **If single-click holes look so wispy they're unusable** → take that as a sign that H4 (conservative carve) needs to happen before drag-stroke, because the more area you carve, the more wispy the boundary becomes.

## Test count at end of this chunk

- 66 unit tests across 8 modules (added EditHistory + CarveOperation).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` clean.
- Production build green.
