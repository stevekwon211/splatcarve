import { describe, expect, it } from 'vitest';

import {
  loadSave,
  storeSave,
  clearSave,
  saveKey,
  type PersistedSave,
  type SaveStorage,
} from './game-save.ts';

class FakeStorage implements SaveStorage {
  private readonly data = new Map<string, string>();
  throwOnSet = false;
  throwOnGet = false;

  getItem(key: string): string | null {
    if (this.throwOnGet) throw new Error('storage read failed');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error('quota exceeded');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  has(key: string): boolean {
    return this.data.has(key);
  }
}

const goodSave: PersistedSave = {
  version: 1,
  sceneId: 'butterfly',
  edits: [
    { type: 'carve', voxelKey: '5|5|5' },
    { type: 'place', voxelKey: '5|6|5', color: [0.5, 0.5, 0.5] },
  ],
};

describe('game-save', () => {
  it('round-trips a save through storeSave + loadSave', () => {
    const storage = new FakeStorage();
    expect(storeSave(goodSave, storage)).toBe(true);
    const loaded = loadSave('butterfly', storage);
    expect(loaded).toEqual(goodSave);
  });

  it('uses a per-scene key (no cross-talk between scenes)', () => {
    const storage = new FakeStorage();
    storeSave(goodSave, storage);
    expect(loadSave('butterfly', storage)).toEqual(goodSave);
    expect(loadSave('raspberry', storage)).toBeNull();
  });

  it('returns null when nothing has been saved', () => {
    const storage = new FakeStorage();
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    const storage = new FakeStorage();
    storage.setItem(saveKey('butterfly'), '{not valid json');
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('returns null on wrong version', () => {
    const storage = new FakeStorage();
    storage.setItem(
      saveKey('butterfly'),
      JSON.stringify({ ...goodSave, version: 999 }),
    );
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('returns null when sceneId mismatches the lookup key', () => {
    const storage = new FakeStorage();
    storage.setItem(saveKey('butterfly'), JSON.stringify({ ...goodSave, sceneId: 'evil' }));
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('rejects edits with missing colour on a place op', () => {
    const storage = new FakeStorage();
    storage.setItem(
      saveKey('butterfly'),
      JSON.stringify({
        ...goodSave,
        edits: [{ type: 'place', voxelKey: '5|6|5' }],
      }),
    );
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('rejects edits with non-numeric voxelKey', () => {
    const storage = new FakeStorage();
    storage.setItem(
      saveKey('butterfly'),
      JSON.stringify({
        ...goodSave,
        edits: [{ type: 'carve', voxelKey: 12345 }],
      }),
    );
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('returns false (not throw) when setItem throws (quota exceeded)', () => {
    const storage = new FakeStorage();
    storage.throwOnSet = true;
    expect(storeSave(goodSave, storage)).toBe(false);
  });

  it('returns null (not throw) when getItem throws', () => {
    const storage = new FakeStorage();
    storage.throwOnGet = true;
    expect(loadSave('butterfly', storage)).toBeNull();
  });

  it('clearSave removes the per-scene key', () => {
    const storage = new FakeStorage();
    storeSave(goodSave, storage);
    expect(storage.has(saveKey('butterfly'))).toBe(true);
    clearSave('butterfly', storage);
    expect(storage.has(saveKey('butterfly'))).toBe(false);
  });
});
