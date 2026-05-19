/**
 * Running average FPS over a sliding window of frame deltas.
 *
 * Caller drives the clock by passing `performance.now()` (or any monotonic ms timestamp)
 * to `tick()` once per rendered frame. The counter is intentionally driven externally
 * rather than wiring to `requestAnimationFrame` itself — that keeps it deterministic
 * and trivially testable.
 */
export class FpsCounter {
  private readonly deltas: number[] = [];
  private readonly windowSize: number;
  private lastTimestamp: number | undefined;
  private sum = 0;

  constructor(windowSize = 60) {
    if (!Number.isFinite(windowSize) || windowSize <= 0) {
      throw new Error(`FpsCounter window size must be > 0, got ${windowSize}`);
    }
    this.windowSize = windowSize;
  }

  tick(timestampMs: number): void {
    if (this.lastTimestamp !== undefined) {
      const delta = timestampMs - this.lastTimestamp;
      if (delta > 0) {
        this.deltas.push(delta);
        this.sum += delta;
        if (this.deltas.length > this.windowSize) {
          const dropped = this.deltas.shift() as number;
          this.sum -= dropped;
        }
      }
    }
    this.lastTimestamp = timestampMs;
  }

  get fps(): number {
    if (this.deltas.length === 0) return 0;
    const avgMs = this.sum / this.deltas.length;
    return avgMs > 0 ? 1000 / avgMs : 0;
  }

  reset(): void {
    this.deltas.length = 0;
    this.sum = 0;
    this.lastTimestamp = undefined;
  }
}
