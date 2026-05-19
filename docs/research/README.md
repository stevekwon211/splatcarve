# Research dossier

This directory preserves the research that informed splatcarve's design. None of these documents are required to use or contribute to the project — but they explain *why* the architecture is the way it is, and they let a future reader (or contributor, or 6-months-from-now me) reason about decisions without having to reconstruct the literature search.

## Documents

| File | What it is |
|---|---|
| [2026-05-19-gs-voxel-survey.md](2026-05-19-gs-voxel-survey.md) | The original literature survey of Gaussian-Splatting + Voxel hybrids (2020 → 2026). Source material that prompted this project. |
| [2026-05-19-ecosystem-agent-report.md](2026-05-19-ecosystem-agent-report.md) | Wave-A research agent on the **web splat renderer ecosystem**. Resulted in the choice of `@sparkjsdev/spark` as the base. |
| [2026-05-19-picking-agent-report.md](2026-05-19-picking-agent-report.md) | Wave-A research agent on **picking architectures** (SuperSplat-style render-to-texture vs CPU BVH vs GPU compute). Resulted in the Option-A recommendation for H1. |
| [2026-05-19-voxel-bridge-agent-report.md](2026-05-19-voxel-bridge-agent-report.md) | Wave-A research agent on **voxel ↔ splat bridges** and **spatial indexing**. Resulted in the hash-grid + nearest-neighbor-cluster choices for H2/H3. |

## Future additions during the build

- `2026-05-XX-spark-render-target-spike.md` — outcome of the 1-day spike on whether `SparkRenderer` accepts a custom render target without forking (Wave A, gate for Wave B).
- `2026-05-XX-h1-results.md` — H1 picking measurements.
- `2026-05-XX-h2-results.md` — H2 carve measurements + voxel-size ablation.
- `2026-05-XX-h3-results.md` — H3 stack measurements + subjective coherence ratings.

## How this was produced

The three Wave-A agent reports were produced by three Explore-type subagents running in parallel during plan-design, each given a focused research mission and instructed to inspect public repos (via `gh api` / `WebFetch`) plus arXiv papers. The reports are reproduced verbatim — they are time-stamped snapshots of state-of-the-art on 2026-05-19 and may rot. Where a finding turns out to be wrong during implementation, the H-results documents will note it.

For the architectural fork between "splat-native voxel editing" (this project) and "voxel engine + splat materials" (deferred sibling project), see [`docs/architecture/voxel-conceptual-model.md`](../architecture/voxel-conceptual-model.md).
