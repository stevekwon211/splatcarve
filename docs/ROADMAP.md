# splatcarve Roadmap

## Current Focus

- Keep the public demo stable and easy to reproduce.
- Maintain the per-fragment voxel mask as the primary technical contribution.
- Make the README and launch materials understandable in the first 30 seconds.

## Near-Term

- Add a drill-through carve option for scenes with layered/back-facing surfaces.
- Add a shader-anchor CI guard for any Spark version drift that affects the injection points.
- Improve launch docs with a compact before/after visual for per-splat versus per-fragment carving.

## Later

- Test with more walkable 3DGS scenes beyond the default butterfly capture.
- Clarify stack mode as a research prototype unless visual coherence improves.
- Explore a cleaner naming pass around the remaining `SDF` class names now that the live mechanism is a discrete voxel occupancy texture.
