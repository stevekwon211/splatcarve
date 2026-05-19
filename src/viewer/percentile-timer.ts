/**
 * Tracks a sliding window of millisecond samples and exposes p50 / p95 / max via
 * nearest-rank percentile (NIST handbook, §1.3.5.6).
 *
 * Built for the H1 latency dashboard: each `pointermove` records the elapsed time
 * of the pick pipeline; the timer surfaces summary stats for the stats panel.
 * Driven externally (no `performance.now()` coupling) so it stays pure and
 * trivially testable.
 */
export class PercentileTimer {
  private readonly samples: number[] = [];
  private readonly windowSize: number;

  constructor(windowSize = 120) {
    if (!Number.isFinite(windowSize) || windowSize <= 0) {
      throw new Error(`PercentileTimer window size must be > 0, got ${windowSize}`);
    }
    this.windowSize = windowSize;
  }

  record(sample: number): void {
    if (!Number.isFinite(sample)) return;
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get p50(): number {
    return this.percentile(0.5);
  }

  get p95(): number {
    return this.percentile(0.95);
  }

  get max(): number {
    if (this.samples.length === 0) return 0;
    let m = -Infinity;
    for (const s of this.samples) if (s > m) m = s;
    return m;
  }

  reset(): void {
    this.samples.length = 0;
  }

  private percentile(p: number): number {
    const n = this.samples.length;
    if (n === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.max(1, Math.min(n, Math.ceil(p * n)));
    return sorted[rank - 1] as number;
  }
}
