import type { VoxelHashStats } from './voxel-hash.ts';

interface StatElements {
  mode: HTMLElement;
  fps: HTMLElement;
  splats: HTMLElement;
  voxels: HTMLElement;
  occupancy: HTMLElement;
  latency: HTMLElement;
  history: HTMLElement;
  pickInfo: HTMLElement;
}

export type CarveMode = 'pick' | 'carve' | 'stack';

/**
 * Thin updater around the static HTML stats panel. Owns no state; the caller
 * decides what numbers to show.
 *
 * The per-frame writers (`setFps`, `setPickLatency`) memoize their last
 * rendered string and short-circuit if it hasn't changed — they're called
 * 60× per second from the animation loop, and `textContent` writes trigger
 * style/layout invalidation even when the text is identical.
 */
export class StatsPanel {
  private readonly el: StatElements;
  private lastFpsText = '';
  private lastLatencyText = '';
  private lastPickInfoText = '';

  constructor(statsRoot: HTMLElement, pickInfoRoot: HTMLElement) {
    this.el = {
      mode: query(statsRoot, '[data-stat="mode"]'),
      fps: query(statsRoot, '[data-stat="fps"]'),
      splats: query(statsRoot, '[data-stat="splats"]'),
      voxels: query(statsRoot, '[data-stat="voxels"]'),
      occupancy: query(statsRoot, '[data-stat="occupancy"]'),
      latency: query(statsRoot, '[data-stat="latency"]'),
      history: query(statsRoot, '[data-stat="history"]'),
      pickInfo: pickInfoRoot,
    };
  }

  setMode(mode: CarveMode): void {
    this.el.mode.textContent = `mode ${mode}`;
  }

  setHistory(size: number, canUndo: boolean, canRedo: boolean): void {
    this.el.history.textContent =
      `history n=${size}` +
      `${canUndo ? '  undo:✓' : '  undo:—'}` +
      `${canRedo ? '  redo:✓' : '  redo:—'}`;
  }

  setFps(fps: number): void {
    const text = `fps ${Math.round(fps).toString().padStart(3, ' ')}`;
    if (text === this.lastFpsText) return;
    this.lastFpsText = text;
    this.el.fps.textContent = text;
  }

  setSplatCount(n: number): void {
    this.el.splats.textContent = `splats ${n.toLocaleString()}`;
  }

  setVoxelInfo(stats: VoxelHashStats, resolution: number, voxelSize: number): void {
    this.el.voxels.textContent =
      `voxels res=${resolution} ` +
      `size=${voxelSize.toFixed(3)} ` +
      `occupied=${stats.voxelCount.toLocaleString()}`;
    this.el.occupancy.textContent =
      `occupancy max=${stats.maxSplatsInAnyVoxel} ` +
      `mean=${stats.meanSplatsPerVoxel.toFixed(1)}`;
  }

  setPickLatency(p50Ms: number, p95Ms: number, maxMs: number, samples: number): void {
    const text =
      samples === 0
        ? 'pick —'
        : `pick p50=${p50Ms.toFixed(2)}ms ` +
          `p95=${p95Ms.toFixed(2)}ms ` +
          `max=${maxMs.toFixed(2)}ms ` +
          `n=${samples}`;
    if (text === this.lastLatencyText) return;
    this.lastLatencyText = text;
    this.el.latency.textContent = text;
  }

  showPicked(info: string | null): void {
    const text = info ?? '';
    if (text === this.lastPickInfoText) return;
    this.lastPickInfoText = text;
    if (info === null) {
      this.el.pickInfo.removeAttribute('data-active');
      this.el.pickInfo.textContent = '';
    } else {
      this.el.pickInfo.setAttribute('data-active', 'true');
      this.el.pickInfo.textContent = info;
    }
  }
}

function query(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`StatsPanel: missing required element matching "${selector}"`);
  }
  return el;
}
