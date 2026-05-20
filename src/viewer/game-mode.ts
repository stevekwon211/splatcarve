import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Camera } from 'three';
import { Vector3 } from 'three';

import { PlayerController, type PlayerInput } from './player-controller.ts';

export interface GameModeDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  /** Mesh-local "is this voxel solid?" predicate, combining centerHash + carver + stackedHash. */
  isOccupied: (key: string) => boolean;
  /** Pre-constructed player physics. */
  player: PlayerController;
  /** Mesh whose local frame the player lives in (for camera world↔local transforms). */
  mesh: import('@sparkjsdev/spark').SplatMesh;
}

/**
 * Wave G.1 — first-person glue.
 *
 * Wires `PointerLockControls` (handles mouse-look only) and WASD/Space key
 * listeners (handle horizontal input + jump intent) onto an existing
 * `PlayerController`. The animation loop calls `step(dt)` once per frame —
 * everything else (camera rotation, key state) is event-driven.
 *
 * `step()` does the per-frame plumbing:
 *
 *   1. Read input flags collected by the keydown/keyup listeners.
 *   2. Convert the camera's *world-space* forward direction into the mesh's
 *      *local* frame (because the player walks in mesh-local — see the
 *      "voxel = coordinate quantization" doctrine).
 *   3. Call `PlayerController.step()` which resolves collisions and updates
 *      the local-frame player position.
 *   4. Convert the local-frame eye position back to world space and assign to
 *      `camera.position`.
 */
export class GameMode {
  private readonly deps: GameModeDeps;
  private readonly controls: PointerLockControls;
  private readonly input: PlayerInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
  };
  private readonly keyDownHandler: (e: KeyboardEvent) => void;
  private readonly keyUpHandler: (e: KeyboardEvent) => void;
  private readonly clickHandler: () => void;
  private readonly forwardScratchWorld = new Vector3();
  private readonly forwardScratchLocal = new Vector3();
  private readonly eyeLocalScratch = new Vector3();
  private readonly eyeWorldScratch = new Vector3();

  constructor(deps: GameModeDeps) {
    this.deps = deps;
    this.controls = new PointerLockControls(deps.camera, deps.canvas);

    this.keyDownHandler = (e) => this.applyKey(e.code, true);
    this.keyUpHandler = (e) => this.applyKey(e.code, false);
    this.clickHandler = () => {
      if (!this.controls.isLocked) this.controls.lock();
    };

    document.addEventListener('keydown', this.keyDownHandler);
    document.addEventListener('keyup', this.keyUpHandler);
    deps.canvas.addEventListener('click', this.clickHandler);
  }

  get isLocked(): boolean {
    return this.controls.isLocked;
  }

  step(dt: number): void {
    // Camera forward in WORLD frame. PointerLockControls writes yaw/pitch
    // straight onto camera.quaternion via its own mouse handlers.
    this.deps.camera.getWorldDirection(this.forwardScratchWorld);
    // Convert to MESH-LOCAL frame for player physics. Direction-only — no
    // translation; rotation around mesh.matrixWorld inverts cleanly via
    // `transformDirection` with a normalized basis.
    this.forwardScratchLocal.copy(this.forwardScratchWorld);
    this.deps.mesh.worldToLocal(this.forwardScratchLocal.add(this.deps.camera.position));
    this.deps.mesh.worldToLocal(this.eyeWorldScratch.copy(this.deps.camera.position));
    this.forwardScratchLocal.sub(this.eyeWorldScratch).normalize();

    this.deps.player.step(dt, this.input, this.forwardScratchLocal, this.deps.isOccupied);

    // Sync camera world position from the new local-frame eye position.
    this.deps.player.eyePosition(this.eyeLocalScratch);
    this.deps.mesh.localToWorld(this.eyeWorldScratch.copy(this.eyeLocalScratch));
    this.deps.camera.position.copy(this.eyeWorldScratch);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.keyDownHandler);
    document.removeEventListener('keyup', this.keyUpHandler);
    this.deps.canvas.removeEventListener('click', this.clickHandler);
    this.controls.disconnect();
  }

  private applyKey(code: string, pressed: boolean): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.backward = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = pressed;
        break;
      case 'Space':
        this.input.jump = pressed;
        break;
      default:
        break;
    }
  }
}
