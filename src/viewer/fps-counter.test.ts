import { describe, expect, it } from 'vitest';

import { FpsCounter } from './fps-counter.ts';

describe('FpsCounter', () => {
  it('reports 0 fps before any tick', () => {
    const counter = new FpsCounter();
    expect(counter.fps).toBe(0);
  });

  it('reports 0 fps after a single tick (need 2 samples for a delta)', () => {
    const counter = new FpsCounter();
    counter.tick(0);
    expect(counter.fps).toBe(0);
  });

  it('reports ~60 fps for two ticks 16.667 ms apart', () => {
    const counter = new FpsCounter();
    counter.tick(0);
    counter.tick(1000 / 60);
    expect(counter.fps).toBeCloseTo(60, 0);
  });

  it('reports ~30 fps for a sequence of 33.333 ms ticks', () => {
    const counter = new FpsCounter();
    for (let i = 0; i <= 10; i++) counter.tick(i * (1000 / 30));
    expect(counter.fps).toBeCloseTo(30, 0);
  });

  it('limits its averaging window to the configured size', () => {
    const counter = new FpsCounter(5);
    // 6 slow frames (200 ms each), then 6 fast frames (10 ms each)
    let t = 0;
    for (let i = 0; i < 6; i++) {
      counter.tick(t);
      t += 200;
    }
    for (let i = 0; i < 6; i++) {
      counter.tick(t);
      t += 10;
    }
    // The window holds the 5 most recent deltas, all ~10 ms → ~100 fps.
    expect(counter.fps).toBeCloseTo(100, 0);
  });

  it('resets to 0 fps', () => {
    const counter = new FpsCounter();
    counter.tick(0);
    counter.tick(16);
    expect(counter.fps).toBeGreaterThan(0);
    counter.reset();
    expect(counter.fps).toBe(0);
  });

  it('rejects a non-positive window size', () => {
    expect(() => new FpsCounter(0)).toThrow();
    expect(() => new FpsCounter(-1)).toThrow();
  });
});
