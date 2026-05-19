import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { SplatCenters } from './splat-centers.ts';

function buildCenters(values: Array<[number, number, number]>): SplatCenters {
  const arr = new Float32Array(values.length * 3);
  values.forEach(([x, y, z], i) => {
    arr[i * 3 + 0] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = z;
  });
  return new SplatCenters(arr);
}

describe('SplatCenters.getCenter', () => {
  it('writes the splat center into the provided out vector', () => {
    const centers = buildCenters([
      [0, 0, 0],
      [1, 2, 3],
      [-1, 0.5, 4],
    ]);
    const out = new Vector3();
    centers.getCenter(1, out);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);
  });

  it('throws for an out-of-range splat index', () => {
    const centers = buildCenters([[0, 0, 0]]);
    expect(() => centers.getCenter(1, new Vector3())).toThrow();
    expect(() => centers.getCenter(-1, new Vector3())).toThrow();
  });
});

describe('SplatCenters.nearestTo', () => {
  const centers = buildCenters([
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [2, 2, 2],
  ]);

  it('returns null when given no candidate IDs', () => {
    expect(centers.nearestTo(new Uint32Array([]), new Vector3(0, 0, 0))).toBeNull();
  });

  it('returns the only candidate when there is one', () => {
    const r = centers.nearestTo(new Uint32Array([2]), new Vector3(0, 1, 0));
    expect(r).toEqual({ splatId: 2, distanceSq: 0 });
  });

  it('picks the closest among multiple candidates', () => {
    const r = centers.nearestTo(new Uint32Array([1, 2, 3]), new Vector3(0, 0, 0.9));
    expect(r?.splatId).toBe(3);
    expect(r?.distanceSq).toBeCloseTo(0.01, 6);
  });

  it('returns the smallest distanceSq when ties are present', () => {
    // splat 1 and splat 2 are equidistant from (0.5, 0.5, 0); both at sqrt(0.5).
    // The implementation is deterministic — the *first* candidate at the min distance wins.
    const r = centers.nearestTo(new Uint32Array([1, 2]), new Vector3(0.5, 0.5, 0));
    expect(r?.splatId).toBe(1);
    expect(r?.distanceSq).toBeCloseTo(0.5, 6);
  });

  it('throws when a candidate id is out of range', () => {
    expect(() => centers.nearestTo(new Uint32Array([999]), new Vector3())).toThrow();
  });
});
