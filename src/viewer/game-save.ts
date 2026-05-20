/**
 * Wave G+.4 — game-mode persistence.
 *
 * Serializes the player's break / place edits for a given scene to a JSON
 * blob under `localStorage` (or any compatible `Storage`). On boot the game
 * mode loads the blob and replays edits in order — carve calls go through
 * the same `carver.carve` API the live click handler uses, and place calls
 * spawn a `PlaceBlockOp` against the same writer / pool / hash.
 *
 * **Scope.** Persists only what the user *did*: a list of voxel keys (for
 * carves) and `{ voxelKey, color }` records (for placed blocks). Does not
 * persist the scene URL, camera position, or any in-flight state. A page
 * reload restarts the player from the scene's spawn point.
 *
 * **Failure modes.** localStorage may be disabled / out of quota / corrupt.
 * Every read returns `null` on any error; every write silently swallows
 * exceptions. The game keeps working with no save state if persistence
 * isn't available.
 */

export interface PersistedEdit {
  type: 'carve' | 'place';
  voxelKey: string;
  /** sRGB linear `[r, g, b]` in [0, 1]. Required for `'place'`, undefined for `'carve'`. */
  color?: [number, number, number];
}

export interface PersistedSave {
  version: number;
  sceneId: string;
  edits: PersistedEdit[];
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VERSION = 1;

export function saveKey(sceneId: string): string {
  return `splatcarve:save:${sceneId}:v${VERSION}`;
}

export function loadSave(sceneId: string, storage: SaveStorage): PersistedSave | null {
  let raw: string | null;
  try {
    raw = storage.getItem(saveKey(sceneId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedSave(parsed)) return null;
    if (parsed.version !== VERSION) return null;
    if (parsed.sceneId !== sceneId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSave(save: PersistedSave, storage: SaveStorage): boolean {
  try {
    storage.setItem(saveKey(save.sceneId), JSON.stringify(save));
    return true;
  } catch {
    // localStorage quota exceeded, disabled by user, or running in a
    // context without a real Storage — caller doesn't care, the game
    // keeps working with in-memory state only.
    return false;
  }
}

export function clearSave(sceneId: string, storage: SaveStorage): void {
  try {
    storage.removeItem(saveKey(sceneId));
  } catch {
    // ignore
  }
}

function isPersistedSave(value: unknown): value is PersistedSave {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'number') return false;
  if (typeof v.sceneId !== 'string') return false;
  if (!Array.isArray(v.edits)) return false;
  for (const e of v.edits) {
    if (!e || typeof e !== 'object') return false;
    const edit = e as Record<string, unknown>;
    if (edit.type !== 'carve' && edit.type !== 'place') return false;
    if (typeof edit.voxelKey !== 'string') return false;
    if (edit.type === 'place') {
      if (!Array.isArray(edit.color) || edit.color.length !== 3) return false;
      for (const c of edit.color) if (typeof c !== 'number') return false;
    }
  }
  return true;
}
