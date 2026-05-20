import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_PARAMS, parseAppParams } from './app-params.ts';

describe('parseAppParams', () => {
  it('returns the defaults when no query string is present', () => {
    expect(parseAppParams(new URL('http://localhost/'))).toEqual(DEFAULT_APP_PARAMS);
  });

  it('reads a positive integer voxel resolution', () => {
    expect(parseAppParams(new URL('http://localhost/?vox=128')).voxResolution).toBe(128);
  });

  it('falls back to the default voxResolution when the value is non-numeric', () => {
    expect(parseAppParams(new URL('http://localhost/?vox=abc')).voxResolution).toBe(
      DEFAULT_APP_PARAMS.voxResolution,
    );
  });

  it('falls back to the default voxResolution when the value is zero or negative', () => {
    expect(parseAppParams(new URL('http://localhost/?vox=0')).voxResolution).toBe(
      DEFAULT_APP_PARAMS.voxResolution,
    );
    expect(parseAppParams(new URL('http://localhost/?vox=-5')).voxResolution).toBe(
      DEFAULT_APP_PARAMS.voxResolution,
    );
  });

  it('falls back to the default voxResolution when the value is non-integer', () => {
    expect(parseAppParams(new URL('http://localhost/?vox=1.5')).voxResolution).toBe(
      DEFAULT_APP_PARAMS.voxResolution,
    );
  });

  it('captures an override splat URL when provided', () => {
    const url = new URL('http://localhost/?splat=https%3A%2F%2Fexample.com%2Ffoo.spz');
    expect(parseAppParams(url).splatUrl).toBe('https://example.com/foo.spz');
  });

  it('leaves splatUrl as undefined when the query parameter is empty', () => {
    expect(parseAppParams(new URL('http://localhost/?splat=')).splatUrl).toBeUndefined();
  });

  it('defaults `mask` to "fragment" — the per-fragment SDF breakthrough', () => {
    expect(parseAppParams(new URL('http://localhost/')).mask).toBe('fragment');
  });

  it('accepts mask=splatedit as the legacy per-splat fallback', () => {
    expect(parseAppParams(new URL('http://localhost/?mask=splatedit')).mask).toBe('splatedit');
  });

  it('accepts mask=fragment explicitly', () => {
    expect(parseAppParams(new URL('http://localhost/?mask=fragment')).mask).toBe('fragment');
  });

  it('falls back to the default mask when the value is unknown', () => {
    expect(parseAppParams(new URL('http://localhost/?mask=nope')).mask).toBe('fragment');
  });

  it('leaves `bench` undefined by default', () => {
    expect(parseAppParams(new URL('http://localhost/')).bench).toBeUndefined();
  });

  it('accepts bench=h1 and bench=h2 for the V.1 measurement harness', () => {
    expect(parseAppParams(new URL('http://localhost/?bench=h1')).bench).toBe('h1');
    expect(parseAppParams(new URL('http://localhost/?bench=h2')).bench).toBe('h2');
  });

  it('falls back to undefined bench when the value is unknown', () => {
    expect(parseAppParams(new URL('http://localhost/?bench=nope')).bench).toBeUndefined();
  });

  it('defaults `mode` to "edit" — the original orbit-camera demo', () => {
    expect(parseAppParams(new URL('http://localhost/')).mode).toBe('edit');
  });

  it('accepts mode=game for the Wave G first-person play mode', () => {
    expect(parseAppParams(new URL('http://localhost/?mode=game')).mode).toBe('game');
  });

  it('falls back to "edit" when the mode value is unknown', () => {
    expect(parseAppParams(new URL('http://localhost/?mode=nope')).mode).toBe('edit');
  });
});
