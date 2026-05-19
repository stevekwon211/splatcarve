import { Vector3 } from 'three';

import { PercentileTimer } from './percentile-timer.ts';

/* -------------------------------------------------------------------------- */
/* Injectable dependency surface                                                */
/* -------------------------------------------------------------------------- */

export interface BenchClock {
  now(): number;
}

export interface BenchScheduler {
  /** Resolves after the next animation frame in production. */
  nextFrame(): Promise<void>;
  /** Resolves after `ms` milliseconds in production. */
  settle(ms: number): Promise<void>;
}

export interface BenchCarver {
  carve(key: string, localCenter: Vector3): boolean;
  has(key: string): boolean;
  readonly count: number;
}

export interface BenchPicker {
  /**
   * Pure pick at an NDC coordinate. The adapter is responsible for converting
   * NDC → world-space hit → splat-ID + voxel-key resolution; the bench runner
   * records the picker's verdict verbatim and stays grid-math-free.
   */
  pickAtNdc(ndcX: number, ndcY: number): { splatId: number | null; voxelKey: string | null } | null;
}

export interface BenchGrid {
  voxelKey(i: number, j: number, k: number): string;
  voxelToWorldCenter(i: number, j: number, k: number, out?: Vector3): Vector3;
}

export interface BenchEnv {
  sceneUrl: string;
  splatCount: number;
  mask: 'fragment' | 'splatedit';
  voxResolution: number;
  userAgent: string;
}

export interface BenchDeps {
  clock: BenchClock;
  scheduler: BenchScheduler;
  carver: BenchCarver;
  picker: BenchPicker;
  grid: BenchGrid;
  env: BenchEnv;
}

/* -------------------------------------------------------------------------- */
/* H2 contracts                                                                 */
/* -------------------------------------------------------------------------- */

export interface H2Target {
  i: number;
  j: number;
  k: number;
}

export interface H2BenchInput {
  targets: ReadonlyArray<H2Target>;
  /** Carve counts at which to snapshot the rolling latency window. */
  recordAt: ReadonlyArray<number>;
  settleMs: number;
  warmupFrames: number;
}

export interface H2Snapshot {
  carveCount: number;
  p50: number;
  p95: number;
  max: number;
  samples: number;
}

export interface H2BenchResult {
  type: 'h2';
  env: BenchEnv;
  totalCarves: number;
  perOpFrameMs: ReadonlyArray<number>;
  snapshots: ReadonlyArray<H2Snapshot>;
  capturedAt: string;
}

/* -------------------------------------------------------------------------- */
/* H1 contracts                                                                 */
/* -------------------------------------------------------------------------- */

export interface H1Sample {
  ndcX: number;
  ndcY: number;
}

export interface H1BenchInput {
  samples: ReadonlyArray<H1Sample>;
  settleMs: number;
  warmupFrames: number;
}

export interface H1Record {
  ndcX: number;
  ndcY: number;
  latencyMs: number;
  voxelKey: string | null;
  pickedSplatId: number | null;
}

export interface H1BenchResult {
  type: 'h1';
  env: BenchEnv;
  totalSamples: number;
  records: ReadonlyArray<H1Record>;
  latency: { p50: number; p95: number; max: number; samples: number };
  capturedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Pure, deterministic measurement harness for the H1 (picking) and H2 (carving)
 * hypotheses. Every external dependency — clock, scheduler, carver, picker, grid —
 * is injected, so the tests stay GPU-free and the production wiring stays small.
 *
 * Wave V.1 ships the harness; V.2 captures the JSON; V.3 turns it into a dossier.
 */
export class BenchRunner {
  private readonly deps: BenchDeps;

  constructor(deps: BenchDeps) {
    this.deps = deps;
  }

  async runH2Carve(input: H2BenchInput): Promise<H2BenchResult> {
    const { clock, scheduler, carver, grid } = this.deps;

    if (input.settleMs > 0) await scheduler.settle(input.settleMs);
    for (let w = 0; w < input.warmupFrames; w++) await scheduler.nextFrame();

    const window = new PercentileTimer(120);
    const perOpFrameMs: number[] = [];
    const snapshots: H2Snapshot[] = [];
    const recordAt = new Set(input.recordAt);
    const center = new Vector3();

    for (const t of input.targets) {
      grid.voxelToWorldCenter(t.i, t.j, t.k, center);
      const key = grid.voxelKey(t.i, t.j, t.k);

      const tBefore = clock.now();
      carver.carve(key, center);
      await scheduler.nextFrame();
      const tAfter = clock.now();

      const frameMs = tAfter - tBefore;
      perOpFrameMs.push(frameMs);
      window.record(frameMs);

      if (recordAt.has(carver.count)) {
        snapshots.push({
          carveCount: carver.count,
          p50: window.p50,
          p95: window.p95,
          max: window.max,
          samples: window.sampleCount,
        });
      }
    }

    return {
      type: 'h2',
      env: this.deps.env,
      totalCarves: input.targets.length,
      perOpFrameMs,
      snapshots,
      capturedAt: new Date().toISOString(),
    };
  }

  async runH1Pick(input: H1BenchInput): Promise<H1BenchResult> {
    const { clock, scheduler, picker } = this.deps;

    if (input.settleMs > 0) await scheduler.settle(input.settleMs);
    for (let w = 0; w < input.warmupFrames; w++) await scheduler.nextFrame();

    const latency = new PercentileTimer(Math.max(1, input.samples.length));
    const records: H1Record[] = [];

    for (const s of input.samples) {
      const tBefore = clock.now();
      const hit = picker.pickAtNdc(s.ndcX, s.ndcY);
      const tAfter = clock.now();
      const latencyMs = tAfter - tBefore;
      latency.record(latencyMs);

      records.push({
        ndcX: s.ndcX,
        ndcY: s.ndcY,
        latencyMs,
        voxelKey: hit?.voxelKey ?? null,
        pickedSplatId: hit?.splatId ?? null,
      });
    }

    return {
      type: 'h1',
      env: this.deps.env,
      totalSamples: input.samples.length,
      records,
      latency: {
        p50: latency.p50,
        p95: latency.p95,
        max: latency.max,
        samples: latency.sampleCount,
      },
      capturedAt: new Date().toISOString(),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Production adapters — tiny, untested in V.1 (no real scheduler in node)      */
/* -------------------------------------------------------------------------- */

/** `performance.now()` clock for browser/node runtime. */
export const realClock: BenchClock = {
  now: () => performance.now(),
};

/**
 * `requestAnimationFrame` scheduler. Uses `setTimeout` fallback so this module
 * loads in node test workers without exploding (the test path uses a fake).
 */
export const realScheduler: BenchScheduler = {
  nextFrame: () =>
    new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(() => resolve(), 16);
      }
    }),
  settle: (ms) => new Promise<void>((resolve) => setTimeout(() => resolve(), ms)),
};
