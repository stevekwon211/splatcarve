import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Camera, Color } from 'three';
import { Vector3 } from 'three';

import { makeCubePrefab } from './block-prefab.ts';
import type { EditHistory, EditOp } from './edit-history.ts';
import { PlaceBlockOp, PlaceBlockCapacityError } from './place-block-op.ts';
import { PlayerController, type PlayerInput } from './player-controller.ts';
import type { PackedSplatsWriter, StackSlotPool, StackedSplatsHashWriter } from './stack-op.ts';
import type { VoxelGrid } from './voxel-grid.ts';
import { castVoxelRay } from './voxel-raycast.ts';

export interface GameModeDeps {
  canvas: HTMLCanvasElement;
  camera: Camera;
  /** Mesh-local "is this voxel solid?" predicate, combining centerHash + carver + stackedHash. */
  isOccupied: (key: string) => boolean;
  /** Pre-constructed player physics. */
  player: PlayerController;
  /** Mesh whose local frame the player lives in (for camera world↔local transforms). */
  mesh: import('@sparkjsdev/spark').SplatMesh;
  /** Voxel grid for the loaded scene. */
  grid: VoxelGrid;
  /**
   * Carve backend (FragmentSdfCarver or SplatEditCarve). Game-mode left-click
   * breaks via this; the EditHistory wrapper makes ⌘Z work the same way the
   * editor's carve mode does.
   */
  carver: {
    carve(key: string, localCenter: Vector3): boolean;
    uncarve(key: string): boolean;
    has(key: string): boolean;
    readonly count: number;
  };
  history: EditHistory;
  /** Stack writer + pool + hash for PlaceBlockOp. Same instances the editor uses. */
  writer: PackedSplatsWriter;
  pool: StackSlotPool;
  stackedHash: StackedSplatsHashWriter;
  /** Camera-ray reach in mesh-local units (typically `voxelSize * REACH_CELLS`). */
  maxReach: number;
  /** Colour of placed block prefabs for the MVP single-block-type build. */
  blockColor: Color;
  /** Notify the host when EditHistory changes so the stats panel can refresh. */
  onHistoryChange?: () => void;
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
  private readonly mouseDownHandler: (e: MouseEvent) => void;
  private readonly contextMenuHandler: (e: MouseEvent) => void;
  private readonly lockChangeHandler: () => void;
  private readonly forwardScratchWorld = new Vector3();
  private readonly forwardScratchLocal = new Vector3();
  private readonly localCameraPos = new Vector3();
  private readonly eyeLocalScratch = new Vector3();
  private readonly eyeWorldScratch = new Vector3();
  private readonly targetCenterScratch = new Vector3();

  constructor(deps: GameModeDeps) {
    this.deps = deps;
    this.controls = new PointerLockControls(deps.camera, deps.canvas);

    this.keyDownHandler = (e) => this.applyKey(e.code, true);
    this.keyUpHandler = (e) => this.applyKey(e.code, false);
    this.clickHandler = () => {
      if (!this.controls.isLocked) this.controls.lock();
    };
    this.mouseDownHandler = (e) => {
      if (!this.controls.isLocked) return; // first click only acquires lock
      e.preventDefault();
      if (e.button === 0) this.tryBreak();
      else if (e.button === 2) this.tryPlace();
    };
    this.contextMenuHandler = (e) => {
      // Suppress browser context menu so right-click can be a place verb.
      if (this.controls.isLocked) e.preventDefault();
    };
    this.lockChangeHandler = () => this.updateCrosshair();

    document.addEventListener('keydown', this.keyDownHandler);
    document.addEventListener('keyup', this.keyUpHandler);
    deps.canvas.addEventListener('click', this.clickHandler);
    deps.canvas.addEventListener('mousedown', this.mouseDownHandler);
    deps.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    document.addEventListener('pointerlockchange', this.lockChangeHandler);
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
    document.removeEventListener('pointerlockchange', this.lockChangeHandler);
    this.deps.canvas.removeEventListener('click', this.clickHandler);
    this.deps.canvas.removeEventListener('mousedown', this.mouseDownHandler);
    this.deps.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    this.controls.disconnect();
  }

  private tryBreak(): void {
    const hit = this.castFromCamera();
    if (!hit) return;
    const { i, j, k } = hit.hitVoxel;
    const key = this.deps.grid.voxelKey(i, j, k);
    if (this.deps.carver.has(key)) return;
    const centre = new Vector3();
    this.deps.grid.voxelToWorldCenter(i, j, k, centre);
    const captured = centre.clone();
    const op: EditOp = {
      do: () => {
        this.deps.carver.carve(key, captured);
      },
      undo: () => {
        this.deps.carver.uncarve(key);
      },
    };
    op.do();
    this.deps.history.record(op);
    this.deps.onHistoryChange?.();
    console.info(`[game] broke voxel ${key} (carved count = ${this.deps.carver.count})`);
  }

  private tryPlace(): void {
    const hit = this.castFromCamera();
    if (!hit) return;
    const { i, j, k } = hit.prevEmptyVoxel;
    const targetKey = this.deps.grid.voxelKey(i, j, k);
    if (this.deps.isOccupied(targetKey)) return; // already-solid cell — no place
    this.deps.grid.voxelToWorldCenter(i, j, k, this.targetCenterScratch);
    const prefab = makeCubePrefab(this.deps.grid.voxelSize, this.deps.blockColor);
    const op = new PlaceBlockOp({
      writer: this.deps.writer,
      pool: this.deps.pool,
      stackedHash: this.deps.stackedHash,
      targetKey,
      targetCenter: this.targetCenterScratch.clone(),
      prefab,
    });
    try {
      op.do();
    } catch (err) {
      if (err instanceof PlaceBlockCapacityError) {
        console.warn(`[game] place blocked: ${err.message}`);
        return;
      }
      throw err;
    }
    this.deps.history.record(op);
    this.deps.onHistoryChange?.();
    console.info(`[game] placed block at ${targetKey}`);
  }

  private castFromCamera(): ReturnType<typeof castVoxelRay> {
    // Camera position + direction → mesh-local frame.
    this.deps.camera.getWorldDirection(this.forwardScratchWorld);
    this.deps.mesh.worldToLocal(this.localCameraPos.copy(this.deps.camera.position));
    this.forwardScratchLocal
      .copy(this.deps.camera.position)
      .add(this.forwardScratchWorld);
    this.deps.mesh.worldToLocal(this.forwardScratchLocal);
    this.forwardScratchLocal.sub(this.localCameraPos).normalize();

    return castVoxelRay({
      origin: this.localCameraPos,
      direction: this.forwardScratchLocal,
      maxReach: this.deps.maxReach,
      grid: this.deps.grid,
      isOccupied: this.deps.isOccupied,
    });
  }

  private updateCrosshair(): void {
    const el = document.querySelector<HTMLElement>('#game-crosshair');
    if (!el) return;
    el.hidden = !this.controls.isLocked;
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
