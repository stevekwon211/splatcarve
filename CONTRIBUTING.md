# Contributing to splatcarve

Thanks for helping improve splatcarve.

## Good First Contributions

- Improve README clarity, screenshots, or demo instructions.
- Add small regression tests for pure carve, voxel, picker, or camera helpers.
- Tighten docs around the per-fragment mask and Spark shader hook.
- Report scenes where scale, picking, carving, or play mode behaves poorly.

## Local Checks

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check-spark-anchors
```

## Pull Request Guidelines

- Keep changes focused and describe the behavior being changed.
- Include a minimal reproduction for bugs when possible.
- Add or update tests for logic changes.
- Do not include private assets, credentials, unreleased Zero material, or large scene files.

## Shader Hook Changes

Changes touching Spark shader injection should explain which shader anchors changed and why. Run `pnpm check-spark-anchors` before opening a PR.
