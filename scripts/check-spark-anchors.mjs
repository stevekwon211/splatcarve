#!/usr/bin/env node
/**
 * Wave E.1 — Spark shader-anchor pin guard.
 *
 * Spark.js ships its splat fragment shader as a JS template baked into
 * `dist/spark.module.js`. splatcarve's per-fragment voxel mask
 * (`src/viewer/fragment-sdf-shader-patch.ts`) injects GLSL via three exact
 * string anchors in that bundle:
 *
 *   1. `out vec4 fragColor;`                       (fragment uniform block insertion point)
 *   2. `void main() {\n    vec4 rgba = vRgba;`     (fragment discard prelude)
 *   3. `vNdc = ndc;`                               (vertex vWorldPos write)
 *
 * If a future Spark release rewrites the shader in a way that changes these
 * strings — or even the lines immediately around them, which our injected
 * code reads / writes — our patch will either fail loudly at runtime or,
 * worse, silently mis-mask fragments. This script runs in CI to catch
 * the drift *before* anyone deploys.
 *
 * Two checks:
 *   - **Existence**: each anchor string must appear in `spark.module.js`.
 *   - **Context hash**: a 256-character window around each anchor is
 *     SHA-256'd and compared against the baseline checked into
 *     `vendor-sha.json`. Changes to the *neighborhood* of the anchor
 *     (which could break our injection while leaving the anchor itself
 *     intact) fail the guard.
 *
 * If the guard fails after a legitimate Spark version bump:
 *   1. Re-run the recon spike: `pnpm dev` + `?spike=1`, confirm the
 *      injection still works visually.
 *   2. Re-generate the baseline: `node scripts/check-spark-anchors.mjs
 *      --write` and commit the resulting `vendor-sha.json`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SPARK_PATH = join(REPO_ROOT, 'node_modules/@sparkjsdev/spark/dist/spark.module.js');
const VENDOR_SHA_PATH = join(REPO_ROOT, 'vendor-sha.json');

// Spark stores its GLSL as JS string *source* with escape sequences — when
// it runs in the browser the runtime parses `\n` into real newlines, but
// when we read `spark.module.js` from disk we still see the two-character
// `\n` literal. The runtime anchors in `fragment-sdf-shader-patch.ts` use
// real newlines (matching what `onBeforeCompile` hands us); the CI guard
// here mirrors them with the escaped form so the substring search finds
// the same content in the source bundle.
const ANCHORS = [
  { id: 'fragColor', text: 'out vec4 fragColor;' },
  { id: 'rgbaVRgba', text: 'void main() {\\n    vec4 rgba = vRgba;' },
  { id: 'vNdcAssign', text: 'vNdc = ndc;' },
];

const CONTEXT_CHARS = 256;
const WRITE = process.argv.includes('--write');

function readSpark() {
  if (!existsSync(SPARK_PATH)) {
    fail(`spark.module.js not found at ${SPARK_PATH} — run pnpm install first.`);
  }
  return readFileSync(SPARK_PATH, 'utf8');
}

function fail(message) {
  console.error(`[spark-anchor-guard] FAIL: ${message}`);
  process.exit(1);
}

function computeHashes(sparkSource) {
  const out = {};
  for (const a of ANCHORS) {
    const idx = sparkSource.indexOf(a.text);
    if (idx === -1) {
      fail(`anchor "${a.id}" not found — Spark's shader source changed.`);
    }
    const start = Math.max(0, idx - CONTEXT_CHARS);
    const end = Math.min(sparkSource.length, idx + a.text.length + CONTEXT_CHARS);
    const window = sparkSource.slice(start, end);
    out[a.id] = createHash('sha256').update(window).digest('hex');
  }
  return out;
}

const sparkSource = readSpark();
const hashes = computeHashes(sparkSource);

if (WRITE || !existsSync(VENDOR_SHA_PATH)) {
  writeFileSync(
    VENDOR_SHA_PATH,
    JSON.stringify(
      {
        $schema: 'vendor-sha-v1',
        $generatedBy: 'scripts/check-spark-anchors.mjs',
        $sparkPackage: '@sparkjsdev/spark',
        anchors: hashes,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`[spark-anchor-guard] wrote baseline to ${VENDOR_SHA_PATH}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(VENDOR_SHA_PATH, 'utf8'));
const expected = baseline.anchors ?? {};

let drifted = false;
for (const a of ANCHORS) {
  if (expected[a.id] !== hashes[a.id]) {
    drifted = true;
    console.error(`[spark-anchor-guard] anchor "${a.id}" context hash drifted`);
    console.error(`  expected ${expected[a.id]}`);
    console.error(`  got      ${hashes[a.id]}`);
  }
}

if (drifted) {
  fail(
    'Spark vendor shader region drifted. If the change is benign:\n' +
      '  1. Confirm fragment-sdf-shader-patch.ts still injects correctly via the ?spike=1 GLSL dump\n' +
      '  2. Re-run with --write to regenerate vendor-sha.json\n' +
      '  3. Commit the new baseline alongside any patch updates',
  );
}

console.log('[spark-anchor-guard] OK — 3 anchors present, context hashes match baseline.');
