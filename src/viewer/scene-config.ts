import { Color } from 'three';

export interface SceneConfig {
  /** Stable identifier — used for localStorage keys + ?scene=ID. */
  id: string;
  /** Direct asset URL (.spz / .ply / etc.) Spark can load. */
  url: string;
  /** Voxel-grid resolution along the longest AABB axis. */
  voxResolution: number;
  /** Player AABB height as a fraction of the scene's bbox diagonal. */
  playerSizeFraction: number;
  /** Spawn height above the bbox top, as a fraction of bbox height. */
  spawnHeightFraction: number;
  /** Default block colour when crosshair sampling isn't available / disabled. */
  blockColor: Color;
}

/**
 * Wave G+.1 — scene presets.
 *
 * Each entry pins the per-scene knobs the game-mode UX depends on:
 * voxel-grid resolution, player-AABB sizing (relative to bbox diagonal),
 * spawn height, default block colour. Adding a scene means appending a
 * config + bundling/fetching its splat asset.
 *
 * The `playerSizeFraction` / `spawnHeightFraction` defaults are tuned for
 * "tiny figurine" scenes like the butterfly; once a real walkable scene
 * (Raspberry, Polycam outdoor, Inria garden) lands in the registry, those
 * fractions drop to ~0.02 (player is much smaller relative to a 5-metre
 * scene than to a 0.7-metre butterfly).
 */
export const SCENE_CONFIGS: ReadonlyArray<SceneConfig> = [
  {
    id: 'butterfly',
    url: 'https://sparkjs.dev/assets/splats/butterfly.spz',
    voxResolution: 64,
    playerSizeFraction: 0.08,
    spawnHeightFraction: 0.6,
    blockColor: new Color(0.85, 0.85, 0.9),
  },
];

export const DEFAULT_SCENE_ID = 'butterfly';

/**
 * Resolve which scene config to use given the URL params.
 *
 *   - `?splat=URL` always wins (custom scene override; uses the default
 *     tuning knobs since we don't know its scale).
 *   - `?scene=ID` selects a registered config.
 *   - Falls back to `DEFAULT_SCENE_ID`.
 */
export function resolveSceneConfig(
  sceneId: string | undefined,
  splatUrl: string | undefined,
): SceneConfig {
  const base =
    SCENE_CONFIGS.find((c) => c.id === sceneId) ??
    SCENE_CONFIGS.find((c) => c.id === DEFAULT_SCENE_ID) ??
    SCENE_CONFIGS[0]!;
  if (splatUrl) {
    return { ...base, id: 'custom', url: splatUrl };
  }
  return base;
}
