import './style.css';

import { Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';

import { parseAppParams } from './viewer/app-params.ts';
import {
  BenchRunner,
  realClock,
  realScheduler,
  type BenchCarver,
  type BenchEnv,
  type BenchGrid,
  type BenchPicker,
  type H1Sample,
  type H2Target,
} from './viewer/bench-runner.ts';
import type { EditOp } from './viewer/edit-history.ts';
import { EditHistory } from './viewer/edit-history.ts';
import { resolveStackTargeting, type StackTargeting } from './viewer/empty-voxel-targeting.ts';
import { FpsCounter } from './viewer/fps-counter.ts';
import { FragmentSdfCarver } from './viewer/fragment-sdf-carver.ts';
import { BufferedPackedSplatsWriter } from './viewer/packed-splats-writer.ts';
import { PercentileTimer } from './viewer/percentile-timer.ts';
import { SplatPicker } from './viewer/picker.ts';
import { createViewer } from './viewer/scene.ts';
import { runShaderHookSpike } from './viewer/shader-hook-spike.ts';
import { SplatCenters } from './viewer/splat-centers.ts';
import { SplatEditCarve } from './viewer/splat-edit-carve.ts';
import { StackOp, StackOpCapacityError } from './viewer/stack-op.ts';
import { StackSlotPool } from './viewer/stack-slot-pool.ts';
import { StackedSplatsHash } from './viewer/stacked-splats-hash.ts';
import { forEachLocalCenter, loadSplat } from './viewer/splat.ts';
import { StatsPanel, type CarveMode } from './viewer/stats-panel.ts';
import { VoxelGrid } from './viewer/voxel-grid.ts';
import { VoxelGridOverlay } from './viewer/voxel-grid-overlay.ts';
import { VoxelHash } from './viewer/voxel-hash.ts';
import { findFirstSurfaceVoxel } from './viewer/voxel-ray-march.ts';

const STACK_CAPACITY = 200_000;
const DENSITY_CAP = 200;
const GHOST_JITTER_SEED = 0xdec_afe;

type CarveBackend = SplatEditCarve | FragmentSdfCarver;

const DEFAULT_SPLAT_URL = 'https://sparkjs.dev/assets/splats/butterfly.spz';

const CURSOR_COLOR_PICK = 0x98e0c0;
const CURSOR_COLOR_CARVE = 0xff5c5c;
const CURSOR_COLOR_STACK = 0xdaff5c;
const CURSOR_COLOR_FORBIDDEN = 0x6a6a72;

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

  if (new URL(window.location.href).searchParams.has('spike')) {
    runShaderHookSpike(viewer.spark, mesh);
  }

  const grid = VoxelGrid.fromAABB(bbox, params.voxResolution);
  const centerHash = VoxelHash.build(grid, forEachLocalCenter(mesh));
  stats.setVoxelInfo(centerHash.stats, params.voxResolution, grid.voxelSize);

  const splatCenters = buildSplatCenters(mesh, splatCount);

  const carver: CarveBackend =
    params.mask === 'fragment'
      ? new FragmentSdfCarver(viewer.spark, grid)
      : new SplatEditCarve(mesh, grid.voxelSize);
  if (carver instanceof FragmentSdfCarver) carver.attach();

  console.info(
    `[splatcarve] carve backend: ${params.mask} (` +
      `${carver instanceof FragmentSdfCarver ? 'per-fragment SDF, breakthrough' : 'per-splat SDF, legacy'})`,
  );
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

  // Picker threshold doubles as the "snap radius" — points-style raycast
  // treats each splat as a sphere of this size, so a larger value bridges
  // the gaps between adjacent splat centers (less flicker on hover) at the
  // cost of slightly coarser hit accuracy. Tuned empirically in D.5.
  const picker = new SplatPicker(viewer.camera, mesh, {
    pointsThreshold: Math.max(grid.voxelSize * 3, 0.025),
  });

  const localPoint = new Vector3();
  const splatCenter = new Vector3();
  const localCameraPos = new Vector3();
  const localRayDir = new Vector3();

  const isCarved = (key: string): boolean => carver.has(key);

  if (!mesh.packedSplats) {
    throw new Error('splatcarve: SplatMesh has no PackedSplats payload after load');
  }
  const stackWriter = new BufferedPackedSplatsWriter(mesh.packedSplats);
  stackWriter.preallocate(splatCount, STACK_CAPACITY);
  const stackPool = new StackSlotPool({ baseSlot: splatCount, capacity: STACK_CAPACITY });
  const stackedHash = new StackedSplatsHash();
  console.info(
    `[splatcarve] stack region pre-allocated: ` +
      `slots [${splatCount.toLocaleString()}, ${(splatCount + STACK_CAPACITY).toLocaleString()})`,
  );

  if (params.bench) {
    void runBench(params.bench, {
      splatUrl,
      splatCount,
      mask: params.mask,
      voxResolution: params.voxResolution,
      mesh,
      grid,
      centerHash,
      splatCenters,
      carver,
      picker,
    });
  }

  function resolveTargetVoxel(event: PointerEvent | MouseEvent): {
    voxel: import('./viewer/voxel-grid.ts').VoxelIndex;
    worldHit: Vector3;
  } | null {
    const hit = picker.pick(event, canvas);
    if (!hit) return null;

    mesh.worldToLocal(localPoint.copy(hit.worldPoint));
    mesh.worldToLocal(localCameraPos.copy(viewer.camera.position));
    localRayDir.copy(localPoint).sub(localCameraPos).normalize();

    const target = findFirstSurfaceVoxel(grid, localPoint, localRayDir, centerHash, isCarved);
    if (!target) return null;
    return { voxel: target, worldHit: hit.worldPoint };
  }

  function refreshHistoryStats(): void {
    stats.setHistory(history.size, history.canUndo, history.canRedo);
  }

  function setMode(next: CarveMode): void {
    // Always cancel any active stack ghost when leaving stack mode — the
    // preview must not "stick" after the user releases stack mode without
    // committing it.
    if (mode === 'stack' && next !== 'stack') {
      cancelStackGhost();
      stackSuppressKey = null;
    }
    mode = next;
    overlay.setCursorColor(cursorColorForMode(mode));
    splatMarker.visible = mode === 'pick' && splatMarker.visible;
    stats.setMode(mode);
    console.info(`[splatcarve] mode → ${mode}`);
  }

  function cursorColorForMode(m: CarveMode): number {
    if (m === 'carve') return CURSOR_COLOR_CARVE;
    if (m === 'stack') return CURSOR_COLOR_STACK;
    return CURSOR_COLOR_PICK;
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

  /* ----------------------- Stack mode (Wave D.5) ------------------------ */

  let currentGhost: { op: StackOp; targetKey: string; sourceKey: string } | null = null;
  /** Target key just committed via click; the next ghost at the same target is
   *  suppressed so the user doesn't see "I committed AND a duplicate ghost
   *  appeared in the same cell." Cleared on the first pointermove to a
   *  different target. */
  let stackSuppressKey: string | null = null;
  /** Last pointermove that produced a valid stack resolution. Picker hits are
   *  approximate — a single missed frame mid-hover would otherwise cancel the
   *  ghost and flicker the wireframe. We keep the ghost alive for a short
   *  grace window so smooth cursor motion across splat gaps stays visually
   *  continuous. */
  let stackLastHitTime = 0;
  const STACK_MISS_GRACE_MS = 150;
  const stackScratchCamera = new Vector3();
  const stackScratchSourceCenter = new Vector3();
  const stackScratchTargetCenter = new Vector3();

  const statusToast = document.querySelector<HTMLElement>('#status-toast');
  let toastTimer: number | null = null;

  function showStatusToast(message: string): void {
    if (!statusToast) return;
    statusToast.textContent = message;
    statusToast.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      statusToast.hidden = true;
      toastTimer = null;
    }, 3000);
  }

  function isVoxelOccupiedForStack(key: string): boolean {
    const base = centerHash.splatsIn(key);
    if (base && base.length > 0) return true;
    return stackedHash.splatsIn(key).length > 0;
  }

  interface StackResolution {
    surfaceVoxel: import('./viewer/voxel-grid.ts').VoxelIndex;
    targeting: StackTargeting;
    sourceSplats: Uint32Array;
    delta: Vector3;
  }

  function resolveStackEvent(event: PointerEvent | MouseEvent): StackResolution | null {
    const hit = picker.pick(event, canvas);
    if (!hit) return null;

    mesh.worldToLocal(localPoint.copy(hit.worldPoint));
    mesh.worldToLocal(localCameraPos.copy(viewer.camera.position));
    localRayDir.copy(localPoint).sub(localCameraPos).normalize();

    const surface = findFirstSurfaceVoxel(grid, localPoint, localRayDir, centerHash, isCarved);
    if (!surface) return null;

    stackScratchCamera.copy(viewer.camera.position);
    mesh.worldToLocal(stackScratchCamera);

    const targeting = resolveStackTargeting(surface, stackScratchCamera, grid, isVoxelOccupiedForStack);
    if (!targeting) return null;

    const sourceKey = grid.voxelKey(
      targeting.sourceVoxel.i,
      targeting.sourceVoxel.j,
      targeting.sourceVoxel.k,
    );
    const sourceSplats = centerHash.splatsIn(sourceKey);
    if (!sourceSplats || sourceSplats.length === 0) return null;

    grid.voxelToWorldCenter(
      targeting.sourceVoxel.i,
      targeting.sourceVoxel.j,
      targeting.sourceVoxel.k,
      stackScratchSourceCenter,
    );
    grid.voxelToWorldCenter(
      targeting.targetVoxel.i,
      targeting.targetVoxel.j,
      targeting.targetVoxel.k,
      stackScratchTargetCenter,
    );
    const delta = stackScratchTargetCenter.clone().sub(stackScratchSourceCenter);

    return { surfaceVoxel: surface, targeting, sourceSplats, delta };
  }

  function cancelStackGhost(): void {
    if (!currentGhost) return;
    currentGhost.op.undo();
    currentGhost = null;
  }

  function buildStackOp(
    targeting: StackTargeting,
    sourceSplats: Uint32Array,
    delta: Vector3,
  ): StackOp {
    const targetKey = grid.voxelKey(
      targeting.targetVoxel.i,
      targeting.targetVoxel.j,
      targeting.targetVoxel.k,
    );
    return new StackOp({
      writer: stackWriter,
      pool: stackPool,
      stackedHash,
      targetKey,
      sourceSplatIds: Array.from(sourceSplats),
      translationDeltaLocal: delta.clone(),
      jitter: { scaleAmp: 0, rotAmpRad: 0, seed: GHOST_JITTER_SEED },
    });
  }

  function handleStackPointerMove(resolution: StackResolution | null): void {
    if (!resolution) {
      // Miss tolerance: a single-frame picker miss between two hits should
      // not flicker the ghost. Keep the previous preview alive within the
      // grace window; cancel only once the cursor has been off-splat long
      // enough that the user clearly intends to abandon the preview.
      if (currentGhost && performance.now() - stackLastHitTime < STACK_MISS_GRACE_MS) {
        return;
      }
      cancelStackGhost();
      overlay.hideCursor();
      stats.showPicked(null);
      return;
    }

    stackLastHitTime = performance.now();

    const { i, j, k } = resolution.targeting.targetVoxel;
    const targetKey = grid.voxelKey(i, j, k);
    const sourceKey = grid.voxelKey(
      resolution.targeting.sourceVoxel.i,
      resolution.targeting.sourceVoxel.j,
      resolution.targeting.sourceVoxel.k,
    );

    overlay.setCursorVoxel(i, j, k);

    // After a commit, the same target is suppressed until the user moves to a
    // different cell — prevents the "committed AND a ghost duplicate" effect.
    if (stackSuppressKey !== null && stackSuppressKey !== targetKey) {
      stackSuppressKey = null;
    }

    const existingStacked = stackedHash.splatsIn(targetKey).length;
    const projectedDensity = existingStacked + resolution.sourceSplats.length;
    const overCap = projectedDensity > DENSITY_CAP;

    if (stackSuppressKey === targetKey || overCap) {
      cancelStackGhost();
      overlay.setCursorColor(overCap ? CURSOR_COLOR_FORBIDDEN : CURSOR_COLOR_STACK);
      stats.showPicked(
        `stack target ${targetKey}  •  source ${sourceKey}  •  ` +
          `${resolution.sourceSplats.length} src  •  ` +
          (overCap
            ? `density cap (${projectedDensity}/${DENSITY_CAP}) — move elsewhere`
            : 'committed — move cursor to stack another'),
      );
      return;
    }

    overlay.setCursorColor(CURSOR_COLOR_STACK);

    if (currentGhost && currentGhost.targetKey === targetKey) {
      stats.showPicked(
        `stack target ${targetKey}  •  source ${sourceKey}  •  ` +
          `${resolution.sourceSplats.length} src  •  click to commit`,
      );
      return;
    }

    cancelStackGhost();
    const op = buildStackOp(resolution.targeting, resolution.sourceSplats, resolution.delta);
    try {
      op.do();
    } catch (err) {
      if (err instanceof StackOpCapacityError) {
        showStatusToast('stack capacity reached — undo to free slots');
        overlay.setCursorColor(CURSOR_COLOR_FORBIDDEN);
        return;
      }
      throw err;
    }
    currentGhost = { op, targetKey, sourceKey };
    stats.showPicked(
      `stack target ${targetKey}  •  source ${sourceKey}  •  ` +
        `${resolution.sourceSplats.length} src  •  click to commit`,
    );
  }

  function handleStackClick(): boolean {
    if (!currentGhost) return false;
    history.record(currentGhost.op);
    refreshHistoryStats();
    console.info(
      `[splatcarve] stacked ${currentGhost.sourceKey} → ${currentGhost.targetKey} ` +
        `historySize=${history.size}`,
    );
    stackSuppressKey = currentGhost.targetKey;
    currentGhost = null;
    return true;
  }

  // Stack-mode pointermove is heavier than pick/carve (it actually writes to
  // the packed splat buffer to materialise the ghost, marking ~6 MB for GPU
  // reupload). At 120 Hz pointer events that's a long queue of redundant
  // uploads. Coalesce to at most one ghost update per render frame.
  let stackPointerPending = false;
  let stackPointerLatestEvent: PointerEvent | MouseEvent | null = null;

  canvas.addEventListener('pointermove', (event) => {
    if (mode === 'stack') {
      stackPointerLatestEvent = event;
      if (stackPointerPending) return;
      stackPointerPending = true;
      requestAnimationFrame(() => {
        stackPointerPending = false;
        const pending = stackPointerLatestEvent;
        stackPointerLatestEvent = null;
        if (mode !== 'stack' || !pending) return;
        const t0 = performance.now();
        const resolution = resolveStackEvent(pending);
        pickLatency.record(performance.now() - t0);
        splatMarker.visible = false;
        handleStackPointerMove(resolution);
      });
      return;
    }

    const t0 = performance.now();
    const resolved = resolveTargetVoxel(event);
    pickLatency.record(performance.now() - t0);

    if (!resolved) {
      overlay.hideCursor();
      splatMarker.visible = false;
      stats.showPicked(null);
      return;
    }

    const { i, j, k } = resolved.voxel;
    overlay.setCursorVoxel(i, j, k);
    const key = grid.voxelKey(i, j, k);
    const inBounds = grid.contains(i, j, k);
    const centerSplats = centerHash.splatsIn(key);

    let nearest: { splatId: number; distanceSq: number } | null = null;
    if (mode === 'pick' && centerSplats && centerSplats.length > 0) {
      grid.voxelToWorldCenter(i, j, k, localPoint);
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
        ? 'click to carve (next surface)'
        : nearest
          ? `nearest splat #${nearest.splatId} d=${Math.sqrt(nearest.distanceSq).toFixed(4)}`
          : 'no nearest splat';
    stats.showPicked(
      `voxel ${key}  •  ${inBounds ? 'in-bounds' : 'out-of-bounds'}  •  ` +
        `${centerSplats?.length ?? 0} centers  •  ${tail}`,
    );
  });

  canvas.addEventListener('pointerleave', () => {
    if (mode === 'stack') {
      cancelStackGhost();
      stackSuppressKey = null;
      overlay.hideCursor();
      stats.showPicked(null);
    }
  });

  canvas.addEventListener('click', (event) => {
    if (mode === 'stack') {
      handleStackClick();
      return;
    }

    const resolved = resolveTargetVoxel(event);
    if (!resolved) return;
    const { i, j, k } = resolved.voxel;
    const key = grid.voxelKey(i, j, k);

    if (mode === 'carve') {
      carveAtVoxel(key, i, j, k);
      return;
    }

    grid.voxelToWorldCenter(i, j, k, localPoint);
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
    else if (event.key === '3') setMode('stack');
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
    if (carver instanceof FragmentSdfCarver) {
      viewer.camera.updateMatrixWorld();
      mesh.updateMatrixWorld();
      carver.updateMatrix(viewer.camera, mesh);
    }
    stackWriter.flushIfDirty();
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

interface BenchContext {
  splatUrl: string;
  splatCount: number;
  mask: 'fragment' | 'splatedit';
  voxResolution: number;
  mesh: import('@sparkjsdev/spark').SplatMesh;
  grid: VoxelGrid;
  centerHash: VoxelHash;
  splatCenters: SplatCenters;
  carver: CarveBackend;
  picker: SplatPicker;
}

async function runBench(mode: 'h1' | 'h2', ctx: BenchContext): Promise<void> {
  const env: BenchEnv = {
    sceneUrl: ctx.splatUrl,
    splatCount: ctx.splatCount,
    mask: ctx.mask,
    voxResolution: ctx.voxResolution,
    userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
  };

  const benchCarver: BenchCarver = {
    carve: (key, center) => ctx.carver.carve(key, center),
    has: (key) => ctx.carver.has(key),
    get count(): number {
      return ctx.carver.count;
    },
  };

  const benchGrid: BenchGrid = {
    voxelKey: (i, j, k) => ctx.grid.voxelKey(i, j, k),
    voxelToWorldCenter: (i, j, k, out) => ctx.grid.voxelToWorldCenter(i, j, k, out),
  };

  const benchScratch = new Vector3();
  const benchPicker: BenchPicker = {
    pickAtNdc: (ndcX, ndcY) => {
      const hit = ctx.picker.pickAtNdc(ndcX, ndcY);
      if (!hit) return null;
      ctx.mesh.worldToLocal(benchScratch.copy(hit.worldPoint));
      const idx = ctx.grid.worldToVoxel(benchScratch);
      const voxelKey = ctx.grid.voxelKey(idx.i, idx.j, idx.k);
      const candidates = ctx.centerHash.splatsIn(voxelKey);
      const nearest = candidates ? ctx.splatCenters.nearestTo(candidates, benchScratch) : null;
      return { splatId: nearest?.splatId ?? null, voxelKey };
    },
  };

  const runner = new BenchRunner({
    clock: realClock,
    scheduler: realScheduler,
    carver: benchCarver,
    picker: benchPicker,
    grid: benchGrid,
    env,
  });

  if (mode === 'h2') {
    const targets = sampleH2Targets(ctx.centerHash, 256);
    console.info(`[bench:h2] starting — ${targets.length} carve targets, settling 2s`);
    const result = await runner.runH2Carve({
      targets,
      recordAt: [1, 10, 50, 100, 256],
      settleMs: 2000,
      warmupFrames: 5,
    });
    console.log('[bench:h2] result\n' + JSON.stringify(result, null, 2));
    (window as unknown as { __splatcarveBench?: unknown }).__splatcarveBench = result;
  } else {
    const samples = buildH1NdcGrid(20, 10);
    console.info(`[bench:h1] starting — ${samples.length} NDC samples, settling 2s`);
    const result = await runner.runH1Pick({
      samples,
      settleMs: 2000,
      warmupFrames: 5,
    });
    console.log('[bench:h1] result\n' + JSON.stringify(result, null, 2));
    (window as unknown as { __splatcarveBench?: unknown }).__splatcarveBench = result;
  }
}

function sampleH2Targets(hash: VoxelHash, target: number): H2Target[] {
  const keys = hash.keys;
  if (keys.length === 0) return [];
  const stride = Math.max(1, Math.floor(keys.length / target));
  const out: H2Target[] = [];
  for (let n = 0; n < keys.length && out.length < target; n += stride) {
    const key = keys[n];
    if (!key) continue;
    const parts = key.split('|');
    if (parts.length !== 3) continue;
    const i = Number(parts[0]);
    const j = Number(parts[1]);
    const k = Number(parts[2]);
    if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(k)) continue;
    out.push({ i, j, k });
  }
  return out;
}

function buildH1NdcGrid(cols: number, rows: number): H1Sample[] {
  const samples: H1Sample[] = [];
  const xSpan = 0.9;
  const ySpan = 0.9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      samples.push({
        ndcX: cols === 1 ? 0 : -xSpan + (2 * xSpan * c) / (cols - 1),
        ndcY: rows === 1 ? 0 : -ySpan + (2 * ySpan * r) / (rows - 1),
      });
    }
  }
  return samples;
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
