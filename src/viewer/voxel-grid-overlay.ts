import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from 'three';

import type { VoxelGrid } from './voxel-grid.ts';

/**
 * Three.js overlay that visualises a `VoxelGrid`:
 *
 * - An AABB wireframe outlines the full grid extent.
 * - A "cursor" wireframe cube the size of one voxel highlights the cell the user
 *   is currently hovering. Moves on every `setCursorVoxel(i, j, k)` call.
 *
 * The overlay carries no voxel state of its own. It is a display layer over the
 * grid; the authoritative data is in `VoxelHash`.
 */
export class VoxelGridOverlay {
  readonly root: Group;

  private readonly aabb: LineSegments;
  private readonly cursor: LineSegments;
  private readonly grid: VoxelGrid;

  constructor(grid: VoxelGrid) {
    this.grid = grid;
    this.root = new Group();
    this.root.matrixAutoUpdate = true;

    this.aabb = makeAabbWireframe(grid);
    this.root.add(this.aabb);

    this.cursor = makeCursorWireframe(grid);
    this.cursor.visible = false;
    this.root.add(this.cursor);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  isVisible(): boolean {
    return this.root.visible;
  }

  setCursorVoxel(i: number, j: number, k: number): void {
    this.grid.voxelToWorldCenter(i, j, k, this.cursor.position);
    this.cursor.visible = true;
  }

  hideCursor(): void {
    this.cursor.visible = false;
  }

  setCursorColor(hex: number): void {
    (this.cursor.material as LineBasicMaterial).color.setHex(hex);
  }

  dispose(): void {
    this.aabb.geometry.dispose();
    (this.aabb.material as LineBasicMaterial).dispose();
    this.cursor.geometry.dispose();
    (this.cursor.material as LineBasicMaterial).dispose();
  }
}

function makeAabbWireframe(grid: VoxelGrid): LineSegments {
  const sizeX = grid.counts.x * grid.voxelSize;
  const sizeY = grid.counts.y * grid.voxelSize;
  const sizeZ = grid.counts.z * grid.voxelSize;

  const box = new BoxGeometry(sizeX, sizeY, sizeZ);
  const edges = new EdgesGeometry(box);
  box.dispose();

  const material = new LineBasicMaterial({
    color: 0x4d4d59,
    transparent: true,
    opacity: 0.7,
  });
  const mesh = new LineSegments(edges, material);

  const center = new Vector3(
    grid.origin.x + sizeX / 2,
    grid.origin.y + sizeY / 2,
    grid.origin.z + sizeZ / 2,
  );
  mesh.position.copy(center);
  return mesh;
}

function makeCursorWireframe(grid: VoxelGrid): LineSegments {
  const s = grid.voxelSize;
  const box = new BoxGeometry(s, s, s);
  const edges = new EdgesGeometry(box);
  box.dispose();

  const material = new LineBasicMaterial({ color: 0x98e0c0 });
  return new LineSegments(edges, material);
}
