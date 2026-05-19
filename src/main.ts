import './style.css';

import { Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';

import { parseAppParams } from './viewer/app-params.ts';
import type { EditOp } from './viewer/edit-history.ts';
import { EditHistory } from './viewer/edit-history.ts';
import { FpsCounter } from './viewer/fps-counter.ts';
import { PercentileTimer } from './viewer/percentile-timer.ts';
import { SplatPicker } from './viewer/picker.ts';
import { createViewer } from './viewer/scene.ts';
import { SplatCenters } from './viewer/splat-centers.ts';
import { SplatEditCarve } from './viewer/splat-edit-carve.ts';
import { forEachLocalCenter, loadSplat } from './viewer/splat.ts';
import { StatsPanel, type CarveMode } from './viewer/stats-panel.ts';
import { VoxelGrid } from './viewer/voxel-grid.ts';
import { VoxelGridOverlay } from './viewer/voxel-grid-overlay.ts';
import { VoxelHash } from './viewer/voxel-hash.ts';

const DEFAULT_SPLAT_URL = 'https://sparkjs.dev/assets/splats/butterfly.spz';

const CURSOR_COLOR_PICK = 0x98e0c0;
const CURSOR_COLOR_CARVE = 0xff5c5c;

async function main(): Promise<void> {
  const params = parseAppParams(new URL(window.location.href));

  const canvas = requireElement<HTMLCanvasElement>('#splatcarve-canvas');
  const statsRoot = requireElement<HTMLElement>('#stats');
  const pickInfoRoot = requireElement<HTMLElement>('#pick-info');

  const viewer = createViewer(canvas);
  const stats = new StatsPanel(statsRoot, pickInfoRoot);
  const fps = new FpsCounter();
  const pickLatency = new PercentileTimer();
  const history = new EditHistory();

  let mode: CarveMode = 'pick';
  stats.setMode(mode);
  stats.setHistory(0, false, false);

  const splatUrl = params.splatUrl ?? DEFAULT_SPLAT_URL;
  console.info(`[splatcarve] loading splat from ${splatUrl}`);
  const { mesh, bbox, splatCount } = await loadSplat(splatUrl);
  viewer.scene.add(mesh);
  stats.setSplatCount(splatCount);

  const grid = VoxelGrid.fromAABB(bbox, params.voxResolution);
  const centerHash = VoxelHash.build(grid, forEachLocalCenter(mesh));
  stats.setVoxelInfo(centerHash.stats, params.voxResolution, grid.voxelSize);

  const splatCenters = buildSplatCenters(mesh, splatCount);
  const carver = new SplatEditCarve(mesh, grid.voxelSize);

  console.info(
    `[splatcarve] center hash — ${centerHash.stats.voxelCount.toLocaleString()} ` +
      `occupied voxels max=${centerHash.stats.maxSplatsInAnyVoxel} ` +
      `mean=${centerHash.stats.meanSplatsPerVoxel.toFixed(2)}`,
  );

  const overlay = new VoxelGridOverlay(grid);
  mesh.add(overlay.root);

  const splatMarker = makeSplatMarker(grid.voxelSize);
  splatMarker.visible = false;
  mesh.add(splatMarker);

  const picker = new SplatPicker(viewer.camera, mesh, {
    pointsThreshold: Math.max(grid.voxelSize, 0.01),
  });

  const localPoint = new Vector3();
  const splatCenter = new Vector3();

  function refreshHistoryStats(): void {
    stats.setHistory(history.size, history.canUndo, history.canRedo);
  }

  function setMode(next: CarveMode): void {
    mode = next;
    overlay.setCursorColor(mode === 'carve' ? CURSOR_COLOR_CARVE : CURSOR_COLOR_PICK);
    splatMarker.visible = mode === 'pick' && splatMarker.visible;
    stats.setMode(mode);
    console.info(`[splatcarve] mode → ${mode}`);
  }

  const voxelCenter = new Vector3();

  function carveAtVoxel(key: string, i: number, j: number, k: number): boolean {
    if (carver.has(key)) return false;
    grid.voxelToWorldCenter(i, j, k, voxelCenter);
    const center = voxelCenter.clone();
    const op: EditOp = {
      do: (): void => {
        carver.carve(key, center);
      },
      undo: (): void => {
        carver.uncarve(key);
      },
    };
    op.do();
    history.record(op);
    refreshHistoryStats();
    console.info(
      `[splatcarve] carved voxel=${key} carvedCount=${carver.count} ` +
        `historySize=${history.size}`,
    );
    return true;
  }

  canvas.addEventListener('pointermove', (event) => {
    const t0 = performance.now();
    const hit = picker.pick(event, canvas);
    const elapsedMs = performance.now() - t0;
    pickLatency.record(elapsedMs);

    if (!hit) {
      overlay.hideCursor();
      splatMarker.visible = false;
      stats.showPicked(null);
      return;
    }

    mesh.worldToLocal(localPoint.copy(hit.worldPoint));
    const { i, j, k } = grid.worldToVoxel(localPoint);
    overlay.setCursorVoxel(i, j, k);
    const key = grid.voxelKey(i, j, k);
    const inBounds = grid.contains(i, j, k);

    const centerSplats = centerHash.splatsIn(key);

    let nearest: { splatId: number; distanceSq: number } | null = null;
    if (mode === 'pick' && centerSplats && centerSplats.length > 0) {
      nearest = splatCenters.nearestTo(centerSplats, localPoint);
    }

    if (nearest && mode === 'pick') {
      splatCenters.getCenter(nearest.splatId, splatCenter);
      splatMarker.position.copy(splatCenter);
      splatMarker.visible = true;
    } else {
      splatMarker.visible = false;
    }

    const tail =
      mode === 'carve'
        ? carver.has(key)
          ? 'already carved'
          : 'click to carve (SDF box)'
        : nearest
          ? `nearest splat #${nearest.splatId} d=${Math.sqrt(nearest.distanceSq).toFixed(4)}`
          : 'no nearest splat';
    stats.showPicked(
      `voxel ${key}  •  ${inBounds ? 'in-bounds' : 'out-of-bounds'}  •  ` +
        `${centerSplats?.length ?? 0} centers  •  ${tail}`,
    );
  });

  canvas.addEventListener('click', (event) => {
    const hit = picker.pick(event, canvas);
    if (!hit) return;
    mesh.worldToLocal(localPoint.copy(hit.worldPoint));
    const { i, j, k } = grid.worldToVoxel(localPoint);
    const key = grid.voxelKey(i, j, k);

    if (mode === 'carve') {
      carveAtVoxel(key, i, j, k);
      return;
    }

    const splats = centerHash.splatsIn(key);
    const nearest = splats ? splatCenters.nearestTo(splats, localPoint) : null;
    console.info(
      `[splatcarve] click(pick) voxel=${key} ` +
        `local=(${localPoint.x.toFixed(3)}, ${localPoint.y.toFixed(3)}, ${localPoint.z.toFixed(3)}) ` +
        `centers=${splats?.length ?? 0} ` +
        `nearest=${nearest ? `#${nearest.splatId} d=${Math.sqrt(nearest.distanceSq).toFixed(4)}` : 'none'}`,
    );
  });

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (history.undo()) {
          refreshHistoryStats();
          console.info(`[splatcarve] undo — historySize=${history.size}`);
        }
        return;
      }
      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        if (history.redo()) {
          refreshHistoryStats();
          console.info(`[splatcarve] redo — historySize=${history.size}`);
        }
        return;
      }
    }
    if (event.key === '1') setMode('pick');
    else if (event.key === '2') setMode('carve');
    else if (event.key === 'g' || event.key === 'G') {
      overlay.setVisible(!overlay.isVisible());
    } else if (event.key === 'r' || event.key === 'R') {
      pickLatency.reset();
      console.info('[splatcarve] pick latency stats reset');
    }
  });

  viewer.renderer.setAnimationLoop((timeMs) => {
    fps.tick(timeMs);
    stats.setFps(fps.fps);
    stats.setPickLatency(
      pickLatency.p50,
      pickLatency.p95,
      pickLatency.max,
      pickLatency.sampleCount,
    );
    viewer.controls.update(viewer.camera);
    viewer.renderer.render(viewer.scene, viewer.camera);
  });
}

function buildSplatCenters(
  mesh: import('@sparkjsdev/spark').SplatMesh,
  splatCount: number,
): SplatCenters {
  const data = new Float32Array(splatCount * 3);
  forEachLocalCenter(mesh)((index, center) => {
    const base = index * 3;
    data[base + 0] = center.x;
    data[base + 1] = center.y;
    data[base + 2] = center.z;
  });
  return new SplatCenters(data);
}

function makeSplatMarker(voxelSize: number): Mesh {
  const radius = Math.max(voxelSize * 0.08, 0.0015);
  const geometry = new SphereGeometry(radius, 12, 8);
  const material = new MeshBasicMaterial({ color: 0xffcf5e });
  return new Mesh(geometry, material);
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
