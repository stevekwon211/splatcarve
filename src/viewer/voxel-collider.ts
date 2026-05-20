import { Vector3 } from 'three';

import type { VoxelGrid } from './voxel-grid.ts';

/**
 * Wave G.1 — pure axis-by-axis swept-AABB collision against a voxel grid.
 *
 * The canonical voxel-game pattern (Notch's original Minecraft formulation):
 * try to move the player AABB on each axis in turn, find the closest occupied
 * voxel along that axis, and clamp the position so the AABB just touches the
 * voxel's near face minus a small epsilon. Sliding along walls falls out for
 * free — when X is blocked, Y/Z still apply.
 *
 * The function is pure: no Three.js scene state, no globals; everything flows
 * through {@link SweepInput} and {@link SweepResult}. The production wiring
 * lives in `PlayerController`, which adds gravity, jump, and animation-loop
 * integration on top.
 *
 * Tuning constants:
 *   - `EPSILON = 1e-3` keeps the AABB strictly outside touched faces so the
 *     next sweep doesn't false-positive on the just-clamped surface.
 *   - Velocity must stay under `voxelSize / dt` to avoid tunneling. At
 *     voxel = 0.1 m, 60 fps → max safe velocity 6 m/s; pedestrian (~1.5 m/s)
 *     and jump-peak (~6 m/s) sit at or below the limit.
 */
export interface SweepInput {
  position: Vector3;
  velocity: Vector3;
  halfExtents: Vector3;
  grid: VoxelGrid;
  isOccupied: (key: string) => boolean;
}

export interface SweepResult {
  position: Vector3;
  velocity: Vector3;
  onGround: boolean;
}

const EPSILON = 1e-3;

export function sweepAabb(input: SweepInput): SweepResult {
  const position = input.position.clone();
  const velocity = input.velocity.clone();
  let onGround = false;

  // Axis-by-axis sweep: X (0), Y (1), Z (2). Sliding along walls falls out
  // for free because cleared axes still apply.
  for (let axis = 0; axis < 3; axis++) {
    const delta = velocity.getComponent(axis);
    if (delta === 0) continue;

    const half = input.halfExtents.getComponent(axis);
    const oldCentre = position.getComponent(axis);
    const desired = oldCentre + delta;

    const layer = collisionLayer(position, half, oldCentre, desired, axis, input);
    if (layer === null) {
      position.setComponent(axis, desired);
      continue;
    }

    const voxSize = input.grid.voxelSize;
    const originAxis = originComponent(input.grid, axis);
    let clamped: number;
    if (delta > 0) {
      // The +face of the AABB has hit the near (-side) face of voxel `layer`.
      const nearFace = originAxis + layer * voxSize;
      clamped = nearFace - half - EPSILON;
    } else {
      // The -face of the AABB has hit the far (+side) face of voxel `layer`.
      const farFace = originAxis + (layer + 1) * voxSize;
      clamped = farFace + half + EPSILON;
    }

    position.setComponent(axis, clamped);
    velocity.setComponent(axis, 0);

    if (axis === 1 && delta < 0) {
      onGround = true;
    }
  }

  return { position, velocity, onGround };
}

/**
 * Returns the voxel layer index along `axis` where the AABB's leading face
 * first collides with an occupied cell during the sweep from `oldCentre`
 * to `desired`. Returns `null` for "no collision; full sweep is clear."
 *
 * The cross-section on the OTHER two axes uses the current `position` (which
 * has already been resolved by earlier axes in the sweep loop).
 */
function collisionLayer(
  position: Vector3,
  half: number,
  oldCentre: number,
  desired: number,
  axis: number,
  input: SweepInput,
): number | null {
  const voxSize = input.grid.voxelSize;
  const originAxis = originComponent(input.grid, axis);

  // Voxel index of the AABB's leading face *just before* it begins moving.
  // For delta>0 we use the +face; for delta<0 the -face.
  const delta = desired - oldCentre;
  const dir = delta > 0 ? 1 : -1;
  const leadingNow = oldCentre + dir * half;
  const leadingAfter = desired + dir * half;

  // First layer past the current leading face that the sweep can enter.
  // floor((leadingNow - origin)/voxSize) is the index of the cell the leading
  // face currently sits in (or "below" if delta>0, "above" if delta<0).
  const startLayer = Math.floor((leadingNow - originAxis) / voxSize) + dir;
  const endLayer = Math.floor((leadingAfter - originAxis) / voxSize);

  // Cross-section indices on the other two axes, evaluated at the current
  // (mid-sweep) position. This is what the AABB occupies orthogonally.
  const crossA = (axis + 1) % 3;
  const crossB = (axis + 2) % 3;
  const minA = Math.floor(
    (position.getComponent(crossA) - input.halfExtents.getComponent(crossA) -
      originComponent(input.grid, crossA)) /
      voxSize,
  );
  const maxA = Math.floor(
    (position.getComponent(crossA) + input.halfExtents.getComponent(crossA) -
      originComponent(input.grid, crossA)) /
      voxSize,
  );
  const minB = Math.floor(
    (position.getComponent(crossB) - input.halfExtents.getComponent(crossB) -
      originComponent(input.grid, crossB)) /
      voxSize,
  );
  const maxB = Math.floor(
    (position.getComponent(crossB) + input.halfExtents.getComponent(crossB) -
      originComponent(input.grid, crossB)) /
      voxSize,
  );

  // Walk the swept layers in the direction of motion; first occupied
  // cell wins.
  if (dir > 0) {
    for (let n = startLayer; n <= endLayer; n++) {
      if (anyOccupied(n, axis, minA, maxA, minB, maxB, crossA, crossB, input)) return n;
    }
  } else {
    for (let n = startLayer; n >= endLayer; n--) {
      if (anyOccupied(n, axis, minA, maxA, minB, maxB, crossA, crossB, input)) return n;
    }
  }
  return null;
}

function anyOccupied(
  axisLayer: number,
  axis: number,
  minA: number,
  maxA: number,
  minB: number,
  maxB: number,
  crossA: number,
  crossB: number,
  input: SweepInput,
): boolean {
  for (let a = minA; a <= maxA; a++) {
    for (let b = minB; b <= maxB; b++) {
      const idx: [number, number, number] = [0, 0, 0];
      idx[axis] = axisLayer;
      idx[crossA] = a;
      idx[crossB] = b;
      if (input.isOccupied(input.grid.voxelKey(idx[0], idx[1], idx[2]))) return true;
    }
  }
  return false;
}

function originComponent(grid: VoxelGrid, axis: number): number {
  return axis === 0 ? grid.origin.x : axis === 1 ? grid.origin.y : grid.origin.z;
}
