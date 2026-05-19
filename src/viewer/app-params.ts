export interface AppParams {
  voxResolution: number;
  splatUrl: string | undefined;
}

export const DEFAULT_APP_PARAMS: Readonly<AppParams> = {
  voxResolution: 64,
  splatUrl: undefined,
};

/**
 * Pure mapping from a `URL` to the strongly-typed app config. Invalid values fall
 * back to defaults silently — splatcarve is a demo, not a CLI; we'd rather render
 * with sane defaults than throw on the first paint.
 */
export function parseAppParams(url: URL): AppParams {
  return {
    voxResolution: readPositiveInt(url, 'vox') ?? DEFAULT_APP_PARAMS.voxResolution,
    splatUrl: readNonEmptyString(url, 'splat'),
  };
}

function readPositiveInt(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function readNonEmptyString(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  return raw;
}
