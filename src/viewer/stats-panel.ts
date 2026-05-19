import type { VoxelHashStats } from './voxel-hash.ts';

interface StatElements {
  fps: HTMLElement;
  splats: HTMLElement;
  voxels: HTMLElement;
  occupancy: HTMLElement;
  pickInfo: HTMLElement;
}

/**
 * Thin updater around the static HTML stats panel. Owns no state; the caller
 * decides what numbers to show.
 */
export class StatsPanel {
  private readonly el: StatElements;

  constructor(statsRoot: HTMLElement, pickInfoRoot: HTMLElement) {
    this.el = {
      fps: query(statsRoot, '[data-stat="fps"]'),
      splats: query(statsRoot, '[data-stat="splats"]'),
      voxels: query(statsRoot, '[data-stat="voxels"]'),
      occupancy: query(statsRoot, '[data-stat="occupancy"]'),
      pickInfo: pickInfoRoot,
    };
  }

  setFps(fps: number): void {
    this.el.fps.textContent = `fps ${Math.round(fps).toString().padStart(3, ' ')}`;
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

  showPicked(info: string | null): void {
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
