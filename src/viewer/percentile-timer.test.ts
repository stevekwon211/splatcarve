import { describe, expect, it } from 'vitest';

import { PercentileTimer } from './percentile-timer.ts';

describe('PercentileTimer', () => {
  it('reports zero stats before any samples', () => {
    const timer = new PercentileTimer();
    expect(timer.sampleCount).toBe(0);
    expect(timer.p50).toBe(0);
    expect(timer.p95).toBe(0);
    expect(timer.max).toBe(0);
  });

  it('treats a single sample as p50 = p95 = max', () => {
    const timer = new PercentileTimer();
    timer.record(7);
    expect(timer.sampleCount).toBe(1);
    expect(timer.p50).toBe(7);
    expect(timer.p95).toBe(7);
    expect(timer.max).toBe(7);
  });

  it('computes percentiles via nearest-rank on a small sample', () => {
    const timer = new PercentileTimer();
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) timer.record(v);
    // 10 samples: ceil(0.5 * 10) = 5 → index 4 → value 5
    //             ceil(0.95 * 10) = 10 → index 9 → value 10
    expect(timer.sampleCount).toBe(10);
    expect(timer.p50).toBe(5);
    expect(timer.p95).toBe(10);
    expect(timer.max).toBe(10);
  });

  it('drops the oldest samples once the window is full', () => {
    const timer = new PercentileTimer(5);
    for (const v of [100, 200, 300, 400, 500]) timer.record(v);
    // Now record five small values; the slow ones should age out.
    for (const v of [1, 2, 3, 4, 5]) timer.record(v);
    expect(timer.sampleCount).toBe(5);
    expect(timer.max).toBe(5);
    expect(timer.p50).toBe(3);
  });

  it('resets to its empty state', () => {
    const timer = new PercentileTimer();
    timer.record(1);
    timer.record(2);
    timer.reset();
    expect(timer.sampleCount).toBe(0);
    expect(timer.p50).toBe(0);
    expect(timer.p95).toBe(0);
    expect(timer.max).toBe(0);
  });

  it('rejects non-positive window size', () => {
    expect(() => new PercentileTimer(0)).toThrow();
    expect(() => new PercentileTimer(-1)).toThrow();
  });

  it('ignores non-finite samples (NaN / Infinity / -Infinity)', () => {
    const timer = new PercentileTimer();
    timer.record(Number.NaN);
    timer.record(Number.POSITIVE_INFINITY);
    timer.record(Number.NEGATIVE_INFINITY);
    expect(timer.sampleCount).toBe(0);
  });
});
