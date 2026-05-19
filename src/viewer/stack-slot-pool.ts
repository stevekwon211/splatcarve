import type { StackSlotPool as StackSlotPoolInterface } from './stack-op.ts';

export interface StackSlotPoolOptions {
  /** Lowest slot index this pool manages — typically `mesh.packedSplats.numSplats` at load. */
  baseSlot: number;
  /** How many slots the pool owns. Pre-allocated; not grown dynamically. */
  capacity: number;
}

/**
 * Free-list slot allocator over `[baseSlot, baseSlot + capacity)`.
 *
 * - `acquire()` returns a slot index, preferring slots that were most recently
 *   released (LIFO) for cache locality, then grows into never-acquired
 *   indices before the cursor.
 * - `release(slot)` is idempotent — calling release twice on the same slot
 *   does not corrupt the free-list, and releasing a slot the pool never owned
 *   is silently ignored.
 *
 * Pure module: no Spark, no Three.js. The production wiring in D.4 pairs
 * this with a `PackedSplatsWriter` that zeroes opacity on freshly released
 * slots so the renderer doesn't briefly show ghost geometry from a stale
 * payload.
 */
export class StackSlotPool implements StackSlotPoolInterface {
  private readonly baseSlot: number;
  private readonly capacity_: number;
  /** Bitmap of which slots in [baseSlot, baseSlot+capacity) are currently acquired. */
  private readonly acquired: Uint8Array;
  /** LIFO stack of released slot indices. */
  private readonly freeList: number[] = [];
  /** Next never-acquired slot index in [baseSlot, baseSlot+capacity). */
  private cursor: number;
  private acquiredCount_ = 0;

  constructor(options: StackSlotPoolOptions) {
    if (!Number.isInteger(options.baseSlot) || options.baseSlot < 0) {
      throw new Error(`StackSlotPool: baseSlot must be a non-negative integer, got ${options.baseSlot}`);
    }
    if (!Number.isInteger(options.capacity) || options.capacity < 0) {
      throw new Error(`StackSlotPool: capacity must be a non-negative integer, got ${options.capacity}`);
    }
    this.baseSlot = options.baseSlot;
    this.capacity_ = options.capacity;
    this.acquired = new Uint8Array(this.capacity_);
    this.cursor = this.baseSlot;
  }

  acquire(): number | null {
    if (this.freeList.length > 0) {
      const slot = this.freeList.pop() as number;
      this.acquired[slot - this.baseSlot] = 1;
      this.acquiredCount_++;
      return slot;
    }
    if (this.cursor >= this.baseSlot + this.capacity_) return null;
    const slot = this.cursor++;
    this.acquired[slot - this.baseSlot] = 1;
    this.acquiredCount_++;
    return slot;
  }

  release(slotIdx: number): void {
    const localIdx = slotIdx - this.baseSlot;
    if (localIdx < 0 || localIdx >= this.capacity_) return;
    if (this.acquired[localIdx] !== 1) return;
    this.acquired[localIdx] = 0;
    this.freeList.push(slotIdx);
    this.acquiredCount_--;
  }

  get acquiredCount(): number {
    return this.acquiredCount_;
  }

  get freeCount(): number {
    return this.capacity_ - this.acquiredCount_;
  }

  get capacity(): number {
    return this.capacity_;
  }
}
