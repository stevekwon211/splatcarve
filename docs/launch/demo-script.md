# 30-second demo script (Wave E.5)

The video accompanies the README and the launch posts. It is shot once,
unedited beyond a single trim, with a static camera (no zooming, no
pan). The goal is "stranger watches 30 seconds and understands what
splatcarve does and why it matters."

## Recording paths

Two options:

1. **Scripted (preferred, no human in the loop)** — `node scripts/record-demo.mjs`
   drives Playwright headed against the live `pnpm dev` server. Produces
   `public/launch/splatcarve.webm` automatically; convert to mp4 with
   `ffmpeg -i public/launch/splatcarve.webm -c:v libx264 -crf 28 -movflags +faststart -an public/launch/splatcarve.mp4`.
2. **Manual screen capture** — follow the timing below with `Cmd+Shift+5`.

## Pre-flight (manual path)

- Reset the dev server with a clean Chromium / Safari Tech Preview window.
- URL: `http://localhost:5173/` (default — `?mask=fragment`, vox=64,
  butterfly.spz). No URL flags during recording.
- DevTools closed. Stats panel + hints panel visible.
- Capture region: just the canvas + the two side panels (no browser chrome).
- macOS: `Cmd+Shift+5` → "Record Selected Portion" → record to `~/Movies`.

## Timing

| t (s) | What is on screen | Voice-over caption (silent video; on-screen text) |
|---|---|---|
| 0.0 – 3.0 | Static butterfly load. Stats panel shows splat count + voxels. | "**splatcarve** — voxel-resolution carve & stack on 3D Gaussian Splat scenes" |
| 3.0 – 6.0 | Press `G` once. Voxel grid wireframe overlays the scene. | "voxel grid overlay (`G`)" |
| 6.0 – 11.0 | Press `1`. Slowly orbit + hover; yellow splat marker tracks the cursor. | "**H1** ✅ partial — hover-pick a specific splat" |
| 11.0 – 17.0 | Press `2`. Click 4 voxels on the wing, one second apart. Sharp cube holes appear. | "**H2′** ✅ — clean per-fragment voxel-cell carve (`?mask=fragment`)" |
| 17.0 – 21.0 | Append `?mask=splatedit` to the URL (visible in address bar). Reload. Click the same 4 voxel positions again. The result is fuzzy. | "vs. per-splat baseline `?mask=splatedit` — fuzzy by design" |
| 21.0 – 27.0 | Reload back to `?mask=fragment`. Press `3`. Hover over the wing edge — ghost cluster preview floats. Click 3 times to commit. | "**H3** — stack a splat cluster (commit on click)" |
| 27.0 – 30.0 | Camera holds steady. Caption overlay: hypothesis result table. | "H1 ✅ partial · H2 ✗ (deliberate) · H2′ ✅ · H3 [verdict pending]" |

## Export

- Format: `splatcarve.mp4` (H.264) and `splatcarve.webm` (VP9) for the
  GitHub README embed fallback.
- Target size: under 5 MB per file (use `ffmpeg -crf 32` if Cmd+Shift+5
  output is larger).
- Save under `public/launch/`. Update README:
  ```html
  <video autoplay loop muted playsinline width="640">
    <source src="public/launch/splatcarve.webm" type="video/webm" />
    <source src="public/launch/splatcarve.mp4" type="video/mp4" />
  </video>
  ```

## Captions

Captions are rendered as static text overlays during edit, not as a
separate `.vtt` track — keeps the README embed self-contained. Use the
Cmd+Shift+5 quick-edit panel or a one-pass ffmpeg `drawtext` filter.

## When to re-shoot

- H3 verdict changes (i.e., Wave D.6 lands)
- Visual UX changes meaningfully (cursor color, ghost timing, new
  keybinding)
- Spark drops a release that re-renders the breakthrough differently
