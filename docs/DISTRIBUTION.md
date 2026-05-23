# splatcarve Distribution Plan

## Positioning

splatcarve is the WebGL/VFX flagship repo for this account: a browser 3D Gaussian Splatting experiment that demonstrates crisp voxel-cell carving with a per-fragment mask.

## Launch Channels

- Three.js forum Showcase first, with the live demo and a short technical note.
- X thread with the before/after visual: per-splat baseline versus per-fragment carve.
- r/GaussianSplatting or r/threejs, one post only, written as a technical demo rather than promotion.
- Hacker News Show HN after the niche channels have reacted and the demo has handled first feedback.
- Personal blog / DEV.to write-up for the shader hook and `Data3DTexture` mask.

## Creative Coding Fit

- WebGL-first: no install, one URL, live scene interaction.
- VFX-oriented: the visual hook is a splat scene being carved at voxel resolution.
- Tool-oriented: the repo exposes a technique other creative coders can fork.
- Future extensions are natural: sound-reactive carve masks, webcam/MediaPipe-driven masks, gesture-based sculpting, and WebXR inspection.

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

### Three.js Forum

Title shape to write by hand:

```text
Voxel carving for Gaussian Splat scenes in Three.js/Spark
```

Facts worth mentioning:

- This is a browser creative-coding experiment, not a finished product.
- The demo uses Spark's Three.js integration, then injects a fragment-stage mask.
- The side-by-side URL flag is useful for reviewers: `?mask=fragment` versus `?mask=splatedit`.
- Ask whether this should become a reusable helper, a shader patch, or remain a standalone experiment.

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
