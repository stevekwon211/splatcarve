import type { Vector3 } from 'three';

/**
 * Cached, contiguous splat-center array (3 floats per splat).
 *
 * Built once at scene load by iterating `PackedSplats.forEachSplat`. After that
 * `getCenter` and `nearestTo` are O(1) and O(N) over the *candidate* list only —
 * no full-scene scans on the picker hot path.
 */
export class SplatCenters {
  private readonly data: Float32Array;
  readonly count: number;

  constructor(data: Float32Array) {
    if (data.length % 3 !== 0) {
      throw new Error(`SplatCenters data length must be a multiple of 3, got ${data.length}`);
    }
    this.data = data;
    this.count = data.length / 3;
  }

  getCenter(splatId: number, out: Vector3): Vector3 {
    if (!Number.isInteger(splatId) || splatId < 0 || splatId >= this.count) {
      throw new Error(`SplatCenters splatId out of range: ${splatId} (count=${this.count})`);
    }
    const base = splatId * 3;
    out.set(this.data[base] as number, this.data[base + 1] as number, this.data[base + 2] as number);
    return out;
  }

  /**
   * Returns the candidate whose center is closest to `worldPoint`, plus the squared
   * distance to it. Returns `null` if the candidate list is empty.
   *
   * Ties: the first candidate at the minimum distance wins (caller observes a
   * deterministic but order-dependent result).
   */
  nearestTo(
    candidateIds: ArrayLike<number>,
    worldPoint: Vector3,
  ): { splatId: number; distanceSq: number } | null {
    if (candidateIds.length === 0) return null;

    const px = worldPoint.x;
    const py = worldPoint.y;
    const pz = worldPoint.z;

    let bestId = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (let n = 0; n < candidateIds.length; n++) {
      const id = candidateIds[n] as number;
      if (!Number.isInteger(id) || id < 0 || id >= this.count) {
        throw new Error(`SplatCenters candidate id out of range: ${id} (count=${this.count})`);
      }
      const base = id * 3;
      const dx = (this.data[base] as number) - px;
      const dy = (this.data[base + 1] as number) - py;
      const dz = (this.data[base + 2] as number) - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestId = id;
      }
    }

    return { splatId: bestId, distanceSq: bestDistSq };
  }
}
