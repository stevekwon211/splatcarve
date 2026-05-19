# splatcarve

> Carve and stack 3D Gaussian Splat scenes at voxel resolution — in the browser.

**Status**: 🚧 Wave A in progress. No code yet, no demo yet. Plan is approved, foundations being laid.

## What this is

A research-driven WebGPU experiment that tries to answer three falsifiable questions about Gaussian Splatting:

1. **H1 — Picking.** Can a web-based 3DGS renderer be extended to identify the specific splat under the mouse cursor at sub-frame latency on a ~1M-splat scene?
2. **H2 — Carve.** Given H1, can deleting all splats whose centers fall in a brushed voxel cell produce a visually clean "hole" at interactive latency?
3. **H3 — Stack.** Given H1–H2, can a nearest-neighbor splat-cluster copy fill an empty voxel cell with visually coherent material?

The output is a single-page demo (target: `stevekwon211.github.io/splatcarve`), a 30-second video, and an honest write-up of which hypotheses were confirmed, partial, or falsified.

## What this is NOT

- Not a Minecraft-style voxel engine. The word "voxel" here refers only to a coordinate quantization that snaps edits to a uniform grid — there is no voxel mesh, no chunk system, no greedy mesher. See `docs/architecture/voxel-conceptual-model.md` for the full mental model.
- Not a production tool. Expect rough edges. The goal is to learn whether the technique works, not to ship a polished editor.
- Not an attempt to replace SuperSplat or PlayCanvas's editor — those are excellent at what they do. splatcarve specifically explores **voxel-resolution carve/stack**, which neither does.

## Stack

- TypeScript + WebGPU + [@sparkjsdev/spark](https://sparkjs.dev/) + three.js
- Vite for bundling, Vitest for tests, Prettier for formatting
- MIT license

## Try it

> ⚠️ Not ready yet. Coming after Wave A finishes (~1 week of evenings).

```bash
git clone https://github.com/stevekwon211/splatcarve.git
cd splatcarve
pnpm install
pnpm dev
```

## Why this exists

The motivation, the literature survey of GS + voxel hybrid approaches, and the three research-agent reports that informed the architecture all live under `docs/research/`. See `docs/architecture/voxel-conceptual-model.md` before reading the code.

## Plan & progress

Detailed phased plan with hypotheses, success criteria, risks, and verification per wave is being mirrored from `~/.claude/plans/shimmying-munching-rivest.md` into this repo as `docs/plan.md` during Wave A.

| Wave | Goal | Status |
|---|---|---|
| A | Foundations & first light | 🟡 in progress |
| B | Picking (H1) | ⏸ pending |
| C | Carve (H2) | ⏸ pending |
| D | Stack (H3) | ⏸ pending |
| E | Polish, demo, open source | ⏸ pending |

## License

MIT — see [LICENSE](LICENSE).
