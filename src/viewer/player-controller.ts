import { Vector3 } from 'three';

import { sweepAabb } from './voxel-collider.ts';
import type { VoxelGrid } from './voxel-grid.ts';

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface PlayerOptions {
  position: Vector3;
  halfExtents: Vector3;
  grid: VoxelGrid;
  /** Horizontal walk speed in mesh-local units per second. */
  walkSpeed: number;
  /** Initial vertical velocity from a fresh jump (impulse). */
  jumpSpeed: number;
  /** Gravity acceleration in mesh-local units per second squared. */
  gravity: number;
  /** Camera eye is `position + (0, eyeHeight, 0)` for the renderer's lookAt. */
  eyeHeight: number;
}

/**
 * Wave G.1 — stateful player physics on top of the pure `sweepAabb` collider.
 *
 * Operates entirely in **mesh-local** coordinates (the same frame the
 * VoxelGrid and the carver share). The animation loop is responsible for
 * (a) reading mouse-look from `PointerLockControls`, (b) building a
 * `cameraForward` vector from the resulting Euler angles, (c) calling
 * `step(dt, input, cameraForward, isOccupied)`, and (d) syncing
 * `camera.position` to `eyePosition()` (which is `position + eye height`).
 *
 * "Velocity" here is measured in local-frame units per second. `step()`
 * multiplies by `dt` before invoking the displacement-based `sweepAabb`,
 * and divides resolved displacement back to recover the m/s velocity
 * for the next frame.
 */
export class PlayerController {
  readonly position: Vector3;
  readonly velocity = new Vector3();
  readonly halfExtents: Vector3;
  readonly grid: VoxelGrid;
  readonly walkSpeed: number;
  readonly jumpSpeed: number;
  readonly gravity: number;
  readonly eyeHeight: number;
  onGround = false;

  /**
   * Reusable scratch — every `step()` writes through these and never escapes
   * into the caller, so a high-rate animation loop doesn't churn allocations.
   */
  private readonly wishDir = new Vector3();
  private readonly cameraRight = new Vector3();
  private readonly UP = new Vector3(0, 1, 0);

  constructor(opts: PlayerOptions) {
    this.position = opts.position.clone();
    this.halfExtents = opts.halfExtents.clone();
    this.grid = opts.grid;
    this.walkSpeed = opts.walkSpeed;
    this.jumpSpeed = opts.jumpSpeed;
    this.gravity = opts.gravity;
    this.eyeHeight = opts.eyeHeight;
  }

  /**
   * Camera anchor: the player's eye position in mesh-local. The animation
   * loop syncs `camera.position` to this each frame *after* `step()` resolves
   * collisions.
   */
  eyePosition(out: Vector3 = new Vector3()): Vector3 {
    return out.copy(this.position).add(this.UP.clone().multiplyScalar(this.eyeHeight));
  }

  step(
    dt: number,
    input: PlayerInput,
    cameraForward: Vector3,
    isOccupied: (key: string) => boolean,
  ): void {
    if (dt <= 0) return;

    // Horizontal wish direction from input, projected onto the ground plane.
    this.wishDir.set(0, 0, 0);
    const forwardFlat = cameraForward.clone();
    forwardFlat.y = 0;
    if (forwardFlat.lengthSq() > 1e-6) forwardFlat.normalize();
    this.cameraRight.crossVectors(forwardFlat, this.UP).normalize();

    if (input.forward) this.wishDir.add(forwardFlat);
    if (input.backward) this.wishDir.sub(forwardFlat);
    if (input.right) this.wishDir.add(this.cameraRight);
    if (input.left) this.wishDir.sub(this.cameraRight);
    if (this.wishDir.lengthSq() > 1e-6) this.wishDir.normalize();

    // Horizontal velocity is set directly (snappy stopping, Quake-style),
    // not accelerated, because for an MVP voxel game stopping-on-key-release
    // feels right.
    this.velocity.x = this.wishDir.x * this.walkSpeed;
    this.velocity.z = this.wishDir.z * this.walkSpeed;

    // Jump only if grounded; gravity always applies in air.
    if (input.jump && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }
    if (!this.onGround) {
      this.velocity.y -= this.gravity * dt;
    }

    // Apply this frame's displacement through the collider.
    const displacement = this.velocity.clone().multiplyScalar(dt);
    const sweep = sweepAabb({
      position: this.position,
      velocity: displacement,
      halfExtents: this.halfExtents,
      grid: this.grid,
      isOccupied,
    });

    this.position.copy(sweep.position);
    // Recover m/s velocity from the resolved per-step displacement so
    // gravity continues to accumulate next frame on un-collided axes.
    this.velocity.set(
      sweep.velocity.x / dt,
      sweep.velocity.y / dt,
      sweep.velocity.z / dt,
    );
    this.onGround = sweep.onGround;
  }
}
