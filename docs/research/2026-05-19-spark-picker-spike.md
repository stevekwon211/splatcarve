# Spike outcome — Spark.js picker for H1

> **Wave A task 8 — gate for Wave B.**
> **Date:** 2026-05-19.
> **Status:** ✅ Done — H1 feasibility unblocked; no Spark fork required.

## Question the spike was meant to answer

> Can Spark's `SparkRenderer` be extended with a custom render target (per-pixel splat-ID + expected-depth, SuperSplat-style) without forking the library?

The plan's §3.2 picking research had identified three options — A (screen-space render-to-texture), B (CPU BVH ray-ellipsoid), C (GPU compute readback) — and committed to A for the MVP. The spike's role was to verify *before* Wave B that A is reachable from app code without patching Spark.

## What actually happened

Reading Spark's official examples — specifically
[`examples/raycasting/index.html`](https://github.com/sparkjsdev/spark/tree/main/examples/raycasting)
and [`examples/interactive-holes/index.html`](https://github.com/sparkjsdev/spark/tree/main/examples/interactive-holes)
— revealed that **`THREE.Raycaster` already works against `SplatMesh` out of the box.** The raycasting example does:

```javascript
const raycaster = new THREE.Raycaster();
raycaster.setFromCamera(clickCoords, camera);
const hits = raycaster.intersectObjects(scene.children);
const splatHit = hits.find((h) => h.object instanceof SplatMesh);
```

…and the interactive-holes example uses the same pattern with
`raycaster.params.Points = { threshold: 0.5 }`. The `SplatMesh` class accepts
`raycastable: true` and `minRaycastOpacity` options (see
`node_modules/@sparkjsdev/spark/dist/types/SplatMesh.d.ts`).

This means **Option A's pre-requisite premise was wrong**. We don't need to
inject a custom `SparkRenderer.renderTarget` to identify the splat under the
cursor. Three.js Raycaster integration is already there.

## What we adopted in Wave A

Wave A uses Spark's built-in raycaster directly. See `src/viewer/picker.ts`:

```typescript
this.raycaster.params.Points = { threshold: options.pointsThreshold ?? 0.05 };
// …
const hits = this.raycaster.intersectObject(this.target, false);
const hit = hits[0];
```

This pattern is *adapted* (not copied) from Spark's `raycasting/` example.

## Trade-offs we inherited

Spark's raycast is **Points-style**: each splat is treated as a sphere of
radius `params.Points.threshold` around its center. This means:

- ✅ Cheap (no extra render pass).
- ✅ Returns a world-space hit point we can `worldToLocal` into the splat
  frame for voxel snapping.
- ⚠️ Not exact per-splat. A "hit" is "ray comes within threshold of some
  splat's center," not "ray pierces the splat ellipsoid at its 3σ surface."
  At grazing angles or among dense splats, the wrong splat may be reported.
- ⚠️ The threshold needs scene-dependent tuning. Wave A defaults to
  `max(grid.voxelSize, 0.01)` which is reasonable for typical Spark sample
  scenes (1–5 world-unit extent) and the user's chosen `?vox=N`.

## What this means for Wave B

The H1 measurement protocol from `docs/plan.md` §5 Wave B still applies:

- Lock the camera, jiggle the mouse over 100 sampled pixels with known
  ground-truth splat IDs.
- Measure agreement rate; target ≥95% on non-silhouette pixels.

If the Points-style raycast fails that bar, we **then** implement Option A
(custom render-target, SuperSplat-style screen-space picker) as a Wave B
refinement. The advantage now is that Wave A already gives us a working
end-to-end picker — Wave B becomes an *accuracy improvement* rather than
foundation work.

## Open questions deferred to Wave B

- **Threshold sensitivity**: how does agreement rate change as `threshold`
  varies between 0.001 and 1.0 of `voxelSize`? Worth an ablation.
- **Anisotropic splats**: a stretched ellipsoid still raycast-hits via its
  center. Does this produce visibly-wrong picks at flat surfaces?
- **Translucent edges**: how does `minRaycastOpacity` interact with
  silhouette pixels at low-opacity grass / hair regions?

## Confirmed by inspection

Files read (verbatim, in `node_modules/@sparkjsdev/spark/dist/types/`):

- `index.d.ts` — exported API surface (includes `SparkControls`,
  `SplatEdit`, `SplatEditSdf`, `unpackSplat`, `setPackedSplat*` helpers,
  `toHalf` / `fromHalf`).
- `SplatMesh.d.ts` — confirms `raycastable?: boolean`,
  `minRaycastOpacity?: number`, `worldModifier?: GsplatModifier`,
  `objectModifiers?: GsplatModifier[]`, `packedSplats?: PackedSplats`.
- `PackedSplats.d.ts` — confirms `forEachSplat(cb)`, `getSplat(i)`,
  `setSplat(i, ...)`, `pushSplat(...)`, `packedArray: Uint32Array | null`.
- `utils.d.ts` — confirms `unpackSplat`, `setPackedSplatOpacity`,
  `setPackedSplatCenter`, `toHalf`, `fromHalf` are all exported (so we
  never write our own half-float conversion).
- `defines.d.ts` — confirms `LN_SCALE_MIN = -12`, `LN_SCALE_MAX = 9`,
  `SplatFileType` enum.

GitHub sources read:

- `examples/raycasting/index.html` (the picker pattern we adapted).
- `examples/interactive-holes/index.html` (the dyno + `SplatEdit` + CPU
  packed-array mutation patterns we'll reuse in Wave C).
- `examples/hello-world/index.html` (the minimal scene setup).
