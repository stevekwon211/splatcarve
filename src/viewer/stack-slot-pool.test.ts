import { describe, expect, it } from 'vitest';

import { StackSlotPool } from './stack-slot-pool.ts';

describe('StackSlotPool', () => {
  it('acquires slots within [baseSlot, baseSlot + capacity)', () => {
    const pool = new StackSlotPool({ baseSlot: 1000, capacity: 4 });
    const slots = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()];
    for (const slot of slots) {
      expect(slot).not.toBeNull();
      expect(slot).toBeGreaterThanOrEqual(1000);
      expect(slot).toBeLessThan(1004);
    }
  });

  it('returns null when exhausted', () => {
    const pool = new StackSlotPool({ baseSlot: 1000, capacity: 2 });
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
  });

  it('reuses released slots before allocating new ones (LIFO)', () => {
    const pool = new StackSlotPool({ baseSlot: 1000, capacity: 4 });
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a as number);
    pool.release(b as number);
    // LIFO: b is released last, so it should come back first.
    expect(pool.acquire()).toBe(b);
    expect(pool.acquire()).toBe(a);
  });

  it('release() of an already-free slot is a no-op (idempotent)', () => {
    const pool = new StackSlotPool({ baseSlot: 1000, capacity: 4 });
    const a = pool.acquire() as number;
    pool.release(a);
    pool.release(a); // duplicate — must not corrupt the free-list.
    expect(pool.acquire()).toBe(a);
  });

  it('release() of an unowned slot is silently ignored', () => {
    const pool = new StackSlotPool({ baseSlot: 1000, capacity: 4 });
    pool.release(9999);
    expect(pool.acquire()).toBe(1000);
  });

  it('counts acquired vs free correctly', () => {
    const pool = new StackSlotPool({ baseSlot: 0, capacity: 8 });
    expect(pool.acquiredCount).toBe(0);
    expect(pool.freeCount).toBe(8);
    const a = pool.acquire() as number;
    expect(pool.acquiredCount).toBe(1);
    expect(pool.freeCount).toBe(7);
    pool.release(a);
    expect(pool.acquiredCount).toBe(0);
    expect(pool.freeCount).toBe(8);
  });

  it('handles zero capacity by always returning null', () => {
    const pool = new StackSlotPool({ baseSlot: 1000, capacity: 0 });
    expect(pool.acquire()).toBeNull();
  });

  it('throws for invalid construction args', () => {
    expect(() => new StackSlotPool({ baseSlot: 0, capacity: -1 })).toThrow(/capacity/);
    expect(() => new StackSlotPool({ baseSlot: -1, capacity: 4 })).toThrow(/baseSlot/);
    expect(() => new StackSlotPool({ baseSlot: 1.5, capacity: 4 })).toThrow(/baseSlot/);
  });
});
