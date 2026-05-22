# splatcarve Distribution Plan

## Positioning

splatcarve is a browser 3D Gaussian Splatting experiment that demonstrates crisp voxel-cell carving with a per-fragment mask.

## Launch Channels

- Hacker News Show HN after CI is green and the demo URL is stable.
- Three.js, WebGPU, Spark, and Gaussian Splatting communities with a technical note rather than a generic launch post.
- X thread with the before/after visual: per-splat baseline versus per-fragment carve.

## Launch Copy

### Hacker News

Title: `Show HN: A browser 3DGS editor that carves splats at voxel resolution`

Body:

```text
I built splatcarve, a browser experiment for editing 3D Gaussian Splat scenes at voxel resolution.

The core trick is moving the carve decision from per-splat-center edits to a per-fragment voxel mask, so carved cells produce crisp cube-shaped holes without forking the renderer.

Demo: https://stevekwon211.github.io/splatcarve/
GitHub: https://github.com/stevekwon211/splatcarve
```

### Technical Post

Working title: `Per-fragment voxel masks for Gaussian Splatting in Three.js/Spark`

Outline:

- Why per-splat deletion cannot make crisp voxel holes.
- How a 3D occupancy texture changes the masking unit to fragments.
- How the Spark shader hook is used without forking the renderer.
- Limits: 2DGS path, shader-anchor fragility, scene scale, and drill-through UX.

## Metrics to Track

- GitHub stars, views, clones, and referrers.
- Demo page availability and Pages workflow status.
- CI status before posting.
- Issues opened from launch feedback.
