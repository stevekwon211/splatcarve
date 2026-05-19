import './style.css';

import { parseAppParams } from './viewer/app-params.ts';
import { FpsCounter } from './viewer/fps-counter.ts';
import { SplatPicker } from './viewer/picker.ts';
import { createViewer } from './viewer/scene.ts';
import { forEachLocalCenter, loadSplat } from './viewer/splat.ts';
import { StatsPanel } from './viewer/stats-panel.ts';
import { VoxelGrid } from './viewer/voxel-grid.ts';
import { VoxelGridOverlay } from './viewer/voxel-grid-overlay.ts';
import { VoxelHash } from './viewer/voxel-hash.ts';

const DEFAULT_SPLAT_URL = 'https://sparkjs.dev/assets/splats/butterfly.spz';

async function main(): Promise<void> {
  const params = parseAppParams(new URL(window.location.href));

  const canvas = requireElement<HTMLCanvasElement>('#splatcarve-canvas');
  const statsRoot = requireElement<HTMLElement>('#stats');
  const pickInfoRoot = requireElement<HTMLElement>('#pick-info');

  const viewer = createViewer(canvas);
  const stats = new StatsPanel(statsRoot, pickInfoRoot);
  const fps = new FpsCounter();

  const splatUrl = params.splatUrl ?? DEFAULT_SPLAT_URL;
  console.info(`[splatcarve] loading splat from ${splatUrl}`);
  const { mesh, bbox, splatCount } = await loadSplat(splatUrl);
  viewer.scene.add(mesh);
  stats.setSplatCount(splatCount);

  const grid = VoxelGrid.fromAABB(bbox, params.voxResolution);
  const hash = VoxelHash.build(grid, forEachLocalCenter(mesh));
  stats.setVoxelInfo(hash.stats, params.voxResolution, grid.voxelSize);
  console.info(
    `[splatcarve] voxel hash built — ${splatCount.toLocaleString()} splats / ` +
      `${hash.stats.voxelCount.toLocaleString()} occupied voxels / ` +
      `max=${hash.stats.maxSplatsInAnyVoxel} mean=${hash.stats.meanSplatsPerVoxel.toFixed(2)}`,
  );

  const overlay = new VoxelGridOverlay(grid);
  mesh.add(overlay.root);

  const picker = new SplatPicker(viewer.camera, mesh, {
    pointsThreshold: Math.max(grid.voxelSize, 0.01),
  });

  canvas.addEventListener('pointermove', (event) => {
    const hit = picker.pick(event, canvas);
    if (!hit) {
      overlay.hideCursor();
      stats.showPicked(null);
      return;
    }
    const localPoint = mesh.worldToLocal(hit.worldPoint.clone());
    const { i, j, k } = grid.worldToVoxel(localPoint);
    overlay.setCursorVoxel(i, j, k);
    const key = grid.voxelKey(i, j, k);
    const splatsInVoxel = hash.splatsIn(key);
    const inBounds = grid.contains(i, j, k);
    stats.showPicked(
      `voxel ${key}  •  ${inBounds ? 'in-bounds' : 'out-of-bounds'}  •  ` +
        `${splatsInVoxel?.length ?? 0} splats`,
    );
  });

  canvas.addEventListener('click', (event) => {
    const hit = picker.pick(event, canvas);
    if (!hit) return;
    const localPoint = mesh.worldToLocal(hit.worldPoint.clone());
    const { i, j, k } = grid.worldToVoxel(localPoint);
    const key = grid.voxelKey(i, j, k);
    const splats = hash.splatsIn(key);
    console.info(
      `[splatcarve] pick voxel=${key} ` +
        `world=(${hit.worldPoint.x.toFixed(3)}, ${hit.worldPoint.y.toFixed(3)}, ${hit.worldPoint.z.toFixed(3)}) ` +
        `splats=${splats?.length ?? 0}`,
    );
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'g' || event.key === 'G') {
      overlay.setVisible(!overlay.isVisible());
      console.info(`[splatcarve] voxel grid ${overlay.isVisible() ? 'visible' : 'hidden'}`);
    }
  });

  viewer.renderer.setAnimationLoop((timeMs) => {
    fps.tick(timeMs);
    stats.setFps(fps.fps);
    viewer.controls.update(viewer.camera);
    viewer.renderer.render(viewer.scene, viewer.camera);
  });
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`splatcarve: missing required DOM element "${selector}"`);
  return el;
}

main().catch((err: unknown) => {
  console.error('[splatcarve] failed to start:', err);
  const message = err instanceof Error ? err.message : String(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);` +
      `padding:16px;border:1px solid #ff7070;background:#1a0c0c;color:#ffb0b0;` +
      `font-family:inherit;max-width:60ch;white-space:pre-wrap">` +
      `splatcarve failed to start\n\n${escapeHtml(message)}` +
      `</pre>`,
  );
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
