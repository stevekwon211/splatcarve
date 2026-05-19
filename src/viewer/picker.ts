import type { SplatMesh } from '@sparkjsdev/spark';
import { Raycaster, Vector2, Vector3, type Camera } from 'three';

export interface PickResult {
  /**
   * Hit point in world space. **Owned by the picker** — the value is
   * overwritten on the next `pick()` call, so consumers must `.copy()` it
   * if they need to retain it. Treat as read-only inside the
   * pointermove/click handler that received it.
   */
  worldPoint: Vector3;
  /** Distance from camera origin to the hit. */
  distance: number;
}

/**
 * Wraps `THREE.Raycaster` so that mouse events on the canvas produce world-space
 * hit points against a target `SplatMesh`.
 *
 * Spark's `SplatMesh` integrates with `THREE.Raycaster` natively (see
 * https://github.com/sparkjsdev/spark/tree/main/examples/raycasting). The picker
 * uses points-style raycasting under the hood, which is approximate — each splat
 * is treated as a sphere of radius `pointsThreshold` around its center. That's
 * accurate enough to snap onto the right voxel cell, which is the only contract
 * the caller relies on. Per-pixel splat-ID accuracy would require a custom
 * render target pass; if the snap rate ever falls short, see the picker
 * research dossier under `docs/research/`.
 */
export class SplatPicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly hitCache = new Vector3();
  private readonly result: PickResult = { worldPoint: this.hitCache, distance: 0 };
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
    return this.pickResolved();
  }

  /**
   * Pick at a pre-computed NDC coordinate (x, y in [-1, 1]). Skips the
   * `getBoundingClientRect` + event-coord math used by the production
   * `pick(event, canvas)` path. Intended for the V.1 bench harness, which
   * drives the picker over a deterministic NDC sweep without synthesizing
   * `PointerEvent`s.
   */
  pickAtNdc(ndcX: number, ndcY: number): PickResult | null {
    this.ndc.set(ndcX, ndcY);
    return this.pickResolved();
  }

  private pickResolved(): PickResult | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.target, false);
    const hit = hits[0];
    if (!hit) return null;
    this.hitCache.copy(hit.point);
    this.result.distance = hit.distance;
    return this.result;
  }
}
