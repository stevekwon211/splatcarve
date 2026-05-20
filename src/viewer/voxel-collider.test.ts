import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { sweepAabb, type SweepInput } from './voxel-collider.ts';
import { VoxelGrid } from './voxel-grid.ts';

/* -------------------------------------------------------------------------- */
/* Test grid + helpers                                                         */
/* -------------------------------------------------------------------------- */

// A 10×10×10 unit grid: each cell is 1 m on a side, voxel keys [0..9] per axis.
const grid = VoxelGrid.fromAABB(new Box3(new Vector3(0, 0, 0), new Vector3(10, 10, 10)), 10);

function occupiedSet(...keys: string[]): (key: string) => boolean {
  const s = new Set(keys);
  return (k) => s.has(k);
}

const HALF = new Vector3(0.3, 0.85, 0.3); // 0.6 × 1.7 × 0.6 m player

function input(
  position: [number, number, number],
  velocity: [number, number, number],
  isOccupied: (k: string) => boolean,
): SweepInput {
  return {
    position: new Vector3(...position),
    velocity: new Vector3(...velocity),
    halfExtents: HALF,
    grid,
    isOccupied,
  };
}

/* -------------------------------------------------------------------------- */

describe('sweepAabb — free movement', () => {
  it('moves to (pos + vel) when no cells are occupied', () => {
    const r = sweepAabb(input([5, 5, 5], [1, 0, 0], () => false));
    expect(r.position.x).toBeCloseTo(6, 5);
    expect(r.position.y).toBeCloseTo(5, 5);
    expect(r.position.z).toBeCloseTo(5, 5);
    expect(r.velocity.equals(new Vector3(1, 0, 0))).toBe(true);
    expect(r.onGround).toBe(false);
  });

  it('returns identity when velocity is zero', () => {
    const r = sweepAabb(input([5, 5, 5], [0, 0, 0], () => false));
    expect(r.position.equals(new Vector3(5, 5, 5))).toBe(true);
    expect(r.velocity.equals(new Vector3(0, 0, 0))).toBe(true);
    expect(r.onGround).toBe(false);
  });

  it('handles sub-epsilon velocity by leaving position effectively unchanged', () => {
    const r = sweepAabb(input([5, 5, 5], [1e-6, 0, 0], () => false));
    // No collision, so we move by exactly the small delta.
    expect(r.position.x).toBeCloseTo(5 + 1e-6, 8);
  });
});

describe('sweepAabb — walking into walls', () => {
  it('clamps +X when a wall is in the way, leaves Y/Z untouched, zeros velocity.x', () => {
    // Player at (5, 5, 5), HALF = (0.3, 0.85, 0.3) → AABB leading edge at x=5.3.
    // Wall at i=6 (occupies x ∈ [6,7]). Moving +X by 1 → leading edge wants 6.3, blocks.
    const r = sweepAabb(input([5, 5, 5], [1, 0, 0], occupiedSet('6|5|5')));
    expect(r.position.x).toBeLessThan(6);
    expect(r.position.x).toBeGreaterThan(5.6); // clamped close to the wall
    expect(r.position.y).toBeCloseTo(5, 5);
    expect(r.position.z).toBeCloseTo(5, 5);
    expect(r.velocity.x).toBe(0);
  });

  it('clamps -X when a wall is in the way', () => {
    // Player at (5, 5, 5), trailing X edge at 4.7. Wall at i=3 (x ∈ [3, 4]).
    // Move -X by 1 → trailing edge wants 3.7, blocks.
    const r = sweepAabb(input([5, 5, 5], [-1, 0, 0], occupiedSet('3|5|5')));
    expect(r.position.x).toBeGreaterThan(4);
    expect(r.position.x).toBeLessThan(4.4); // clamped close to the wall
    expect(r.velocity.x).toBe(0);
  });

  it('clamps +Y when ceiling is above', () => {
    // Top edge at 5.85; ceiling cell at j=7 (y ∈ [7, 8]). Move +Y by 2 → wants 7.85.
    const r = sweepAabb(input([5, 5, 5], [0, 2, 0], occupiedSet('5|7|5')));
    expect(r.position.y).toBeLessThan(7);
    expect(r.velocity.y).toBe(0);
    expect(r.onGround).toBe(false);
  });

  it('lands on ground and reports onGround=true', () => {
    // Bottom edge at 4.15; floor at j=3 (y ∈ [3, 4]). Move -Y by 2 → wants 2.15.
    // After clamp the AABB bottom face touches y=4; centre = 4 + halfY = 4.85.
    const r = sweepAabb(input([5, 5, 5], [0, -2, 0], occupiedSet('5|3|5')));
    expect(r.position.y).toBeGreaterThan(4.8);
    expect(r.position.y).toBeLessThan(4.9);
    expect(r.velocity.y).toBe(0);
    expect(r.onGround).toBe(true);
  });

  it('falls freely through air with no floor', () => {
    const r = sweepAabb(input([5, 5, 5], [0, -2, 0], () => false));
    expect(r.position.y).toBeCloseTo(3, 5);
    expect(r.velocity.y).toBe(-2);
    expect(r.onGround).toBe(false);
  });
});

describe('sweepAabb — sliding along surfaces', () => {
  it('slides along +X wall while moving (+X, 0, +Z) — X blocked, Z free', () => {
    const r = sweepAabb(input([5, 5, 5], [1, 0, 1], occupiedSet('6|5|5')));
    expect(r.velocity.x).toBe(0);
    expect(r.position.z).toBeCloseTo(6, 5);
    expect(r.velocity.z).toBe(1);
  });

  it('clamps both X and Z when both walls present', () => {
    // Walls at (+X, +Z) corner around player.
    const r = sweepAabb(input([5, 5, 5], [1, 0, 1], occupiedSet('6|5|5', '5|5|6')));
    expect(r.velocity.x).toBe(0);
    expect(r.velocity.z).toBe(0);
    expect(r.position.x).toBeLessThan(6);
    expect(r.position.z).toBeLessThan(6);
  });
});

describe('sweepAabb — robustness', () => {
  it('does not oscillate when AABB starts touching a face', () => {
    // After a +X clamp, the next zero-velocity sweep must leave position unchanged.
    const first = sweepAabb(input([5, 5, 5], [1, 0, 0], occupiedSet('6|5|5')));
    const second = sweepAabb({
      position: first.position,
      velocity: new Vector3(0, 0, 0),
      halfExtents: HALF,
      grid,
      isOccupied: occupiedSet('6|5|5'),
    });
    expect(second.position.equals(first.position)).toBe(true);
  });

  it('repeated wall pushes leave the player just outside the wall, not jittering', () => {
    let pos = new Vector3(5, 5, 5);
    for (let n = 0; n < 5; n++) {
      const r = sweepAabb({
        position: pos,
        velocity: new Vector3(1, 0, 0),
        halfExtents: HALF,
        grid,
        isOccupied: occupiedSet('6|5|5'),
      });
      pos = r.position;
    }
    // 5 attempts to push into the wall — still on the safe side.
    expect(pos.x).toBeLessThan(6);
    expect(pos.x).toBeGreaterThan(5.69);
  });

  it('handles a thin gap (1-cell-wide corridor) without false collision', () => {
    // Player centred in cell i=5 (x ∈ [5.2, 5.8], one voxel wide), with walls
    // on both sides (i=4 and i=6) but not overlapping the player. Walking
    // straight up should resolve as Y-only motion — no false X/Z clamps.
    const r = sweepAabb(
      input([5.5, 5, 5], [0, 1, 0], occupiedSet('4|5|5', '4|6|5', '6|5|5', '6|6|5')),
    );
    expect(r.position.y).toBeCloseTo(6, 5);
    expect(r.position.x).toBeCloseTo(5.5, 5);
    expect(r.position.z).toBeCloseTo(5, 5);
  });

  it('zeros velocity for axes that did not collide are untouched', () => {
    // No collision at all — all three velocities should round-trip.
    const v = new Vector3(0.4, 0.3, 0.2);
    const r = sweepAabb({
      position: new Vector3(5, 5, 5),
      velocity: v,
      halfExtents: HALF,
      grid,
      isOccupied: () => false,
    });
    expect(r.velocity.equals(v)).toBe(true);
  });
});
