# splatcarve Distribution Plan

## Positioning

splatcarve is a browser 3D Gaussian Splatting experiment that demonstrates crisp voxel-cell carving with a per-fragment mask.

## Launch Channels

- Hacker News Show HN after CI is green and the demo URL is stable.
- Three.js, WebGPU, Spark, and Gaussian Splatting communities with a technical note rather than a generic launch post.
- X thread with the before/after visual: per-splat baseline versus per-fragment carve.

## Launch Notes

### Hacker News

Do not paste generated copy into HN. Use these notes to write a short first
comment by hand.

Recommended link target:

```text
https://stevekwon211.github.io/splatcarve/
```

Title shape to write by hand:

```text
Show HN: A browser 3D Gaussian Splat editor with voxel carving
```

Facts worth mentioning in a first comment:

- This is an editing experiment, not a general-purpose 3D editor yet.
- The interesting part is the carve unit: per-fragment voxel mask instead of
  deleting whole splats by center position.
- That makes cube-shaped holes much cleaner.
- It runs in the browser and uses Three.js/Spark without forking the renderer.
- Keyboard: press `2` for carve mode, then click/drag in the scene.
- Ask for feedback on the interaction model and technical approach, not stars.

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
