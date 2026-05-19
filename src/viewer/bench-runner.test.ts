import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BenchRunner,
  type BenchCarver,
  type BenchClock,
  type BenchEnv,
  type BenchGrid,
  type BenchPicker,
  type BenchScheduler,
  type H1BenchInput,
  type H2BenchInput,
} from './bench-runner.ts';

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

class FakeClock implements BenchClock {
  private t = 0;
  private readonly step: number;

  constructor(step = 1) {
    this.step = step;
  }
  now(): number {
    const v = this.t;
    this.t += this.step;
    return v;
  }
  reset(): void {
    this.t = 0;
  }
}

class FakeScheduler implements BenchScheduler {
  settleCalls: number[] = [];
  nextFrameCalls = 0;
  async settle(ms: number): Promise<void> {
    this.settleCalls.push(ms);
  }
  async nextFrame(): Promise<void> {
    this.nextFrameCalls += 1;
  }
}

class FakeCarver implements BenchCarver {
  private readonly cells = new Set<string>();
  carved: Array<{ key: string; localCenter: { x: number; y: number; z: number } }> = [];

  carve(key: string, localCenter: Vector3): boolean {
    if (this.cells.has(key)) return false;
    this.cells.add(key);
    this.carved.push({ key, localCenter: { x: localCenter.x, y: localCenter.y, z: localCenter.z } });
    return true;
  }

  has(key: string): boolean {
    return this.cells.has(key);
  }

  get count(): number {
    return this.cells.size;
  }
}

class FakeGrid implements BenchGrid {
  voxelKey(i: number, j: number, k: number): string {
    return `${i}|${j}|${k}`;
  }
  voxelToWorldCenter(i: number, j: number, k: number, out?: Vector3): Vector3 {
    const v = out ?? new Vector3();
    v.set(i + 0.5, j + 0.5, k + 0.5);
    return v;
  }
}

class FakePicker implements BenchPicker {
  results = new Map<string, { splatId: number | null; voxelKey: string | null } | null>();

  setResult(ndcX: number, ndcY: number, splatId: number | null, voxelKey: string | null): void {
    this.results.set(`${ndcX},${ndcY}`, { splatId, voxelKey });
  }
  setMiss(ndcX: number, ndcY: number): void {
    this.results.set(`${ndcX},${ndcY}`, null);
  }
  pickAtNdc(ndcX: number, ndcY: number): { splatId: number | null; voxelKey: string | null } | null {
    return this.results.get(`${ndcX},${ndcY}`) ?? null;
  }
}

const ENV: BenchEnv = {
  sceneUrl: 'https://example.test/butterfly.spz',
  splatCount: 1000,
  mask: 'fragment',
  voxResolution: 64,
  userAgent: 'test-agent/1.0',
};

/* -------------------------------------------------------------------------- */
/* H2                                                                          */
/* -------------------------------------------------------------------------- */

describe('BenchRunner.runH2Carve', () => {
  let clock: FakeClock;
  let scheduler: FakeScheduler;
  let carver: FakeCarver;
  let grid: FakeGrid;
  let runner: BenchRunner;

  beforeEach(() => {
    clock = new FakeClock(1);
    scheduler = new FakeScheduler();
    carver = new FakeCarver();
    grid = new FakeGrid();
    runner = new BenchRunner({
      clock,
      scheduler,
      carver,
      grid,
      picker: new FakePicker(),
      env: ENV,
    });
  });

  const targets = [
    { i: 0, j: 0, k: 0 },
    { i: 1, j: 0, k: 0 },
    { i: 2, j: 0, k: 0 },
    { i: 3, j: 0, k: 0 },
  ];

  it('carves each target voxel in order', async () => {
    const input: H2BenchInput = { targets, recordAt: [], settleMs: 0, warmupFrames: 0 };
    await runner.runH2Carve(input);
    expect(carver.carved.map((c) => c.key)).toEqual(['0|0|0', '1|0|0', '2|0|0', '3|0|0']);
  });

  it('passes voxel-center coordinates derived from the grid', async () => {
    const input: H2BenchInput = { targets: [targets[0]!], recordAt: [], settleMs: 0, warmupFrames: 0 };
    await runner.runH2Carve(input);
    expect(carver.carved[0]!.localCenter).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
  });

  it('honours settleMs by calling the scheduler before the first carve', async () => {
    const input: H2BenchInput = { targets, recordAt: [], settleMs: 1500, warmupFrames: 0 };
    await runner.runH2Carve(input);
    expect(scheduler.settleCalls).toEqual([1500]);
  });

  it('runs warmup frames before measuring', async () => {
    const input: H2BenchInput = { targets, recordAt: [], settleMs: 0, warmupFrames: 3 };
    await runner.runH2Carve(input);
    // 3 warmup + 4 per-op = 7 nextFrame calls.
    expect(scheduler.nextFrameCalls).toBe(3 + targets.length);
  });

  it('records a snapshot only at the specified carve counts', async () => {
    const input: H2BenchInput = { targets, recordAt: [1, 3], settleMs: 0, warmupFrames: 0 };
    const result = await runner.runH2Carve(input);
    expect(result.snapshots.map((s) => s.carveCount)).toEqual([1, 3]);
  });

  it('produces a perOpFrameMs entry per target', async () => {
    const input: H2BenchInput = { targets, recordAt: [], settleMs: 0, warmupFrames: 0 };
    const result = await runner.runH2Carve(input);
    expect(result.perOpFrameMs).toHaveLength(targets.length);
    // Clock advances by 1 per `now()` call; per-op uses 2 calls (before, after-frame).
    // So every entry should be > 0.
    for (const ms of result.perOpFrameMs) expect(ms).toBeGreaterThan(0);
  });

  it('is deterministic — two runs with the same inputs produce identical JSON', async () => {
    const input: H2BenchInput = {
      targets,
      recordAt: [2, 4],
      settleMs: 100,
      warmupFrames: 1,
    };

    clock.reset();
    const r1 = await runner.runH2Carve(input);

    // Fresh state for the second run.
    clock = new FakeClock(1);
    carver = new FakeCarver();
    scheduler = new FakeScheduler();
    runner = new BenchRunner({
      clock,
      scheduler,
      carver,
      grid: new FakeGrid(),
      picker: new FakePicker(),
      env: ENV,
    });
    const r2 = await runner.runH2Carve(input);

    // Strip non-deterministic fields before comparing.
    const norm = (r: typeof r1): unknown => ({ ...r, capturedAt: 'STRIPPED' });
    expect(norm(r1)).toEqual(norm(r2));
  });

  it('skips already-carved voxels but still advances a frame for them', async () => {
    const input: H2BenchInput = {
      targets: [{ i: 0, j: 0, k: 0 }, { i: 0, j: 0, k: 0 }],
      recordAt: [],
      settleMs: 0,
      warmupFrames: 0,
    };
    const result = await runner.runH2Carve(input);
    expect(carver.count).toBe(1); // duplicate skipped
    expect(result.perOpFrameMs).toHaveLength(2); // both attempts recorded
    expect(scheduler.nextFrameCalls).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* H1                                                                          */
/* -------------------------------------------------------------------------- */

describe('BenchRunner.runH1Pick', () => {
  let clock: FakeClock;
  let scheduler: FakeScheduler;
  let picker: FakePicker;
  let grid: FakeGrid;
  let runner: BenchRunner;

  beforeEach(() => {
    clock = new FakeClock(1);
    scheduler = new FakeScheduler();
    picker = new FakePicker();
    grid = new FakeGrid();
    runner = new BenchRunner({
      clock,
      scheduler,
      picker,
      grid,
      carver: new FakeCarver(),
      env: ENV,
    });
  });

  it('records a latency entry for each NDC sample', async () => {
    picker.setResult(0.1, 0.2, 7, '0|0|0');
    picker.setResult(0.3, 0.4, 9, '1|0|0');
    const input: H1BenchInput = {
      samples: [
        { ndcX: 0.1, ndcY: 0.2 },
        { ndcX: 0.3, ndcY: 0.4 },
      ],
      settleMs: 0,
      warmupFrames: 0,
    };
    const result = await runner.runH1Pick(input);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.latencyMs).toBeGreaterThan(0);
  });

  it('records the picked splat id and voxel key for hits', async () => {
    picker.setResult(0.1, 0.2, 42, '0|0|0');
    const input: H1BenchInput = {
      samples: [{ ndcX: 0.1, ndcY: 0.2 }],
      settleMs: 0,
      warmupFrames: 0,
    };
    const result = await runner.runH1Pick(input);
    expect(result.records[0]).toMatchObject({
      ndcX: 0.1,
      ndcY: 0.2,
      pickedSplatId: 42,
      voxelKey: '0|0|0',
    });
  });

  it('records null voxelKey and null pickedSplatId on a picker miss', async () => {
    picker.setMiss(0.5, 0.5);
    const input: H1BenchInput = {
      samples: [{ ndcX: 0.5, ndcY: 0.5 }],
      settleMs: 0,
      warmupFrames: 0,
    };
    const result = await runner.runH1Pick(input);
    expect(result.records[0]!.voxelKey).toBeNull();
    expect(result.records[0]!.pickedSplatId).toBeNull();
  });

  it('summarises latency across the sample list', async () => {
    picker.setResult(0, 0, 1, '0|0|0');
    picker.setResult(0.1, 0.1, 2, '0|0|0');
    picker.setResult(0.2, 0.2, 3, '0|0|0');
    const input: H1BenchInput = {
      samples: [
        { ndcX: 0, ndcY: 0 },
        { ndcX: 0.1, ndcY: 0.1 },
        { ndcX: 0.2, ndcY: 0.2 },
      ],
      settleMs: 0,
      warmupFrames: 0,
    };
    const result = await runner.runH1Pick(input);
    expect(result.latency.samples).toBe(3);
    expect(result.latency.p95).toBeGreaterThanOrEqual(result.latency.p50);
  });

  it('is deterministic — two runs with the same inputs produce identical JSON', async () => {
    const setup = (): { picker: FakePicker } => {
      const p = new FakePicker();
      p.setResult(0, 0, 1, '0|0|0');
      p.setResult(0.5, 0.5, 2, '1|1|0');
      return { picker: p };
    };

    const input: H1BenchInput = {
      samples: [
        { ndcX: 0, ndcY: 0 },
        { ndcX: 0.5, ndcY: 0.5 },
      ],
      settleMs: 500,
      warmupFrames: 2,
    };

    const r1 = await new BenchRunner({
      clock: new FakeClock(1),
      scheduler: new FakeScheduler(),
      picker: setup().picker,
      grid: new FakeGrid(),
      carver: new FakeCarver(),
      env: ENV,
    }).runH1Pick(input);

    const r2 = await new BenchRunner({
      clock: new FakeClock(1),
      scheduler: new FakeScheduler(),
      picker: setup().picker,
      grid: new FakeGrid(),
      carver: new FakeCarver(),
      env: ENV,
    }).runH1Pick(input);

    const norm = (r: typeof r1): unknown => ({ ...r, capturedAt: 'STRIPPED' });
    expect(norm(r1)).toEqual(norm(r2));
  });
});
