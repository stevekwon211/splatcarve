import type { SplatMesh } from '@sparkjsdev/spark';
import { Raycaster, Vector2, type Vector3, type Camera } from 'three';

export interface PickResult {
  /** Hit point in world space. */
  worldPoint: Vector3;
  /** Distance from camera origin to the hit. */
  distance: number;
}

/**
 * Wraps `THREE.Raycaster` so that mouse events on the canvas produce world-space
 * hit points against a target `SplatMesh`.
 *
 * Spark's `SplatMesh` already integrates with `THREE.Raycaster` (see
 * https://github.com/sparkjsdev/spark/tree/main/examples/raycasting). The picker
 * uses points-style raycasting under the hood, which is approximate (sphere
 * around each splat center, threshold = `pointsThreshold`) but adequate for the
 * Wave A goal of "snap the cursor to a voxel."
 *
 * Wave B will refine this with a per-pixel splat-ID buffer if H1 reveals
 * unacceptable error rates here.
 */
export class SplatPicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly camera: Camera;
  private readonly target: SplatMesh;

  constructor(
    camera: Camera,
    target: SplatMesh,
    options: { pointsThreshold?: number } = {},
  ) {
    this.camera = camera;
    this.target = target;
    this.raycaster.params.Points = { threshold: options.pointsThreshold ?? 0.05 };
  }

  pick(event: PointerEvent | MouseEvent, canvas: HTMLCanvasElement): PickResult | null {
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.target, false);
    const hit = hits[0];
    if (!hit) return null;
    return { worldPoint: hit.point.clone(), distance: hit.distance };
  }
}
