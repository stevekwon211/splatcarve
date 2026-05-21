import { describe, expect, it } from 'vitest';

import { resolveSceneConfig, SCENE_CONFIGS, DEFAULT_SCENE_ID } from './scene-config.ts';

describe('resolveSceneConfig', () => {
  it('returns the default scene when no id or url is given', () => {
    expect(resolveSceneConfig(undefined, undefined).id).toBe(DEFAULT_SCENE_ID);
  });

  it('selects a registered scene by id', () => {
    const valley = resolveSceneConfig('valley', undefined);
    expect(valley.id).toBe('valley');
    expect(valley.url).toContain('valley.spz');
  });

  it('falls back to the default for an unknown id', () => {
    expect(resolveSceneConfig('does-not-exist', undefined).id).toBe(DEFAULT_SCENE_ID);
  });

  it('lets ?splat=URL override the url while keeping a base preset for tuning', () => {
    const custom = resolveSceneConfig('valley', 'https://example.test/x.spz');
    expect(custom.id).toBe('custom');
    expect(custom.url).toBe('https://example.test/x.spz');
    // Inherits the valley tuning knobs.
    expect(custom.voxResolution).toBe(48);
  });

  it('every registered scene has sane tuning fields', () => {
    for (const c of SCENE_CONFIGS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.url).toMatch(/^https?:\/\//);
      expect(c.voxResolution).toBeGreaterThan(0);
      expect(c.playerSizeFraction).toBeGreaterThan(0);
      expect(c.playerSizeFraction).toBeLessThan(1);
      expect(c.spawnHeightFraction).toBeGreaterThan(0);
    }
  });
});
