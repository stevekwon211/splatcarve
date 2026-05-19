import { Color, Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BufferedPackedSplatsWriter,
  type PackedSplatsLike,
} from './packed-splats-writer.ts';
import type { SplatParams } from './stack-op.ts';

interface StoredSplat {
  center: Vector3;
  scales: Vector3;
  quaternion: Quaternion;
  opacity: number;
  color: Color;
}

class FakePackedSplats implements PackedSplatsLike {
  numSplats = 0;
  needsUpdate = false;
  ensureSplatsCalls: number[] = [];
  splats = new Map<number, StoredSplat>();

  ensureSplats(n: number): Uint32Array {
    this.ensureSplatsCalls.push(n);
    return new Uint32Array(0);
  }

  setSplat(
    idx: number,
    center: Vector3,
    scales: Vector3,
    quaternion: Quaternion,
    opacity: number,
    color: Color,
  ): void {
    this.splats.set(idx, {
      center: center.clone(),
      scales: scales.clone(),
      quaternion: quaternion.clone(),
      opacity,
      color: color.clone(),
    });
  }

  getSplat(idx: number): StoredSplat {
    const s = this.splats.get(idx);
    if (!s) {
      return {
        center: new Vector3(),
        scales: new Vector3(),
        quaternion: new Quaternion(),
        opacity: 0,
        color: new Color(),
      };
    }
    return {
      center: s.center.clone(),
      scales: s.scales.clone(),
      quaternion: s.quaternion.clone(),
      opacity: s.opacity,
      color: s.color.clone(),
    };
  }
}

describe('BufferedPackedSplatsWriter', () => {
  let fake: FakePackedSplats;
  let writer: BufferedPackedSplatsWriter;

  beforeEach(() => {
    fake = new FakePackedSplats();
    writer = new BufferedPackedSplatsWriter(fake);
  });

  it('delegates setSplat to the underlying PackedSplats', () => {
    writer.setSplat(
      42,
      new Vector3(1, 2, 3),
      new Vector3(0.1, 0.2, 0.3),
      new Quaternion(0, 0, 0, 1),
      0.5,
      new Color(1, 0, 0),
    );
    const stored = fake.splats.get(42);
    expect(stored).toBeTruthy();
    expect(stored?.center).toEqual(new Vector3(1, 2, 3));
    expect(stored?.opacity).toBe(0.5);
  });

  it('does NOT touch needsUpdate on a setSplat call', () => {
    writer.setSplat(
      42,
      new Vector3(),
      new Vector3(1, 1, 1),
      new Quaternion(),
      1,
      new Color(),
    );
    expect(fake.needsUpdate).toBe(false);
  });

  it('readSplat populates the provided out and returns it', () => {
    fake.splats.set(7, {
      center: new Vector3(9, 9, 9),
      scales: new Vector3(1, 1, 1),
      quaternion: new Quaternion(),
      opacity: 0.75,
      color: new Color(0, 1, 0),
    });
    const out: SplatParams = {
      center: new Vector3(),
      scales: new Vector3(),
      quaternion: new Quaternion(),
      opacity: 0,
      color: new Color(),
    };
    const returned = writer.readSplat(7, out);
    expect(returned).toBe(out);
    expect(out.center).toEqual(new Vector3(9, 9, 9));
    expect(out.opacity).toBe(0.75);
    expect(out.color).toEqual(new Color(0, 1, 0));
  });

  it('readSplat allocates a fresh SplatParams when no out is provided', () => {
    fake.splats.set(1, {
      center: new Vector3(1, 0, 0),
      scales: new Vector3(1, 1, 1),
      quaternion: new Quaternion(),
      opacity: 1,
      color: new Color(1, 1, 1),
    });
    const p = writer.readSplat(1);
    expect(p.center).toEqual(new Vector3(1, 0, 0));
  });

  it('flushIfDirty returns false and leaves needsUpdate alone when no writes happened', () => {
    expect(writer.flushIfDirty()).toBe(false);
    expect(fake.needsUpdate).toBe(false);
  });

  it('flushIfDirty returns true and sets needsUpdate once after at least one setSplat', () => {
    writer.setSplat(0, new Vector3(), new Vector3(1, 1, 1), new Quaternion(), 1, new Color());
    expect(writer.flushIfDirty()).toBe(true);
    expect(fake.needsUpdate).toBe(true);
  });

  it('many writes + one flush = one GPU-relevant signal', () => {
    fake.needsUpdate = false;
    for (let i = 0; i < 100; i++) {
      writer.setSplat(i, new Vector3(i, 0, 0), new Vector3(1, 1, 1), new Quaternion(), 1, new Color());
    }
    expect(fake.needsUpdate).toBe(false); // not yet flushed
    writer.flushIfDirty();
    expect(fake.needsUpdate).toBe(true);
    // Second flush after no writes: idempotent no-op.
    fake.needsUpdate = false;
    expect(writer.flushIfDirty()).toBe(false);
    expect(fake.needsUpdate).toBe(false);
  });

  it('preallocate ensures capacity, sets numSplats, and zeros opacity across the stack region', () => {
    writer.preallocate(100, 50);
    expect(fake.ensureSplatsCalls).toEqual([150]);
    expect(fake.numSplats).toBe(150);
    // Slots [100, 150) are zero-opacity.
    for (let s = 100; s < 150; s++) {
      expect(fake.splats.get(s)?.opacity).toBe(0);
    }
    // Flushed so the renderer picks up the new payload.
    expect(fake.needsUpdate).toBe(true);
  });

  it('preallocate with zero stack count is a no-op besides ensureSplats(baseCount)', () => {
    writer.preallocate(100, 0);
    expect(fake.ensureSplatsCalls).toEqual([100]);
    expect(fake.numSplats).toBe(100);
    expect(fake.splats.size).toBe(0);
  });
});
