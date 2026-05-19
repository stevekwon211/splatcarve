/**
 * Wave V.2 + D.6 capture orchestrator.
 *
 * Drives a real Chromium (full GPU via ANGLE → Metal on Apple Silicon)
 * through every measurement + screenshot the dossiers + verdict table
 * need. Stores JSON under docs/research/data/2026-05-20-* and PNGs
 * under docs/research/images/2026-05-20-h2/.
 *
 * Prereq: `pnpm dev` running at http://localhost:5173/.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DATA_DIR = join(REPO_ROOT, 'docs/research/data');
const IMG_DIR = join(REPO_ROOT, 'docs/research/images/2026-05-20-h2');
const BASE = 'http://localhost:5173/';
const TIMEOUT_MS = 240_000;

const FULL_CHROME =
  '/Users/doeonkwon/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/' +
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const jobs = [
  // Bench captures — JSON measurement records.
  { kind: 'bench', mode: 'h2', mask: 'fragment', vox: 64, file: 'h2-fragment-64' },
  { kind: 'bench', mode: 'h2', mask: 'splatedit', vox: 64, file: 'h2-splatedit-64' },
  { kind: 'bench', mode: 'h2', mask: 'fragment', vox: 128, file: 'h2-fragment-128' },
  { kind: 'bench', mode: 'h2', mask: 'splatedit', vox: 128, file: 'h2-splatedit-128' },
  { kind: 'bench', mode: 'h1', mask: 'fragment', vox: 64, file: 'h1-vox64' },
  { kind: 'bench', mode: 'h3', mask: 'fragment', vox: 64, file: 'h3-vox64' },
  // Side-by-side screenshots at carve counts 1, 16, 64 — production vox=64.
  { kind: 'shot', count: 1, mask: 'fragment', vox: 64, file: 'fragment-1.png' },
  { kind: 'shot', count: 1, mask: 'splatedit', vox: 64, file: 'splatedit-1.png' },
  { kind: 'shot', count: 16, mask: 'fragment', vox: 64, file: 'fragment-16.png' },
  { kind: 'shot', count: 16, mask: 'splatedit', vox: 64, file: 'splatedit-16.png' },
  { kind: 'shot', count: 64, mask: 'fragment', vox: 64, file: 'fragment-64.png' },
  { kind: 'shot', count: 64, mask: 'splatedit', vox: 64, file: 'splatedit-64.png' },
  // Chunky-cell captures — vox=24 cells are ~6× larger by volume so the
  // fragment vs splatedit contrast is obvious at thumbnail resolution.
  { kind: 'shot', count: 27, mask: 'fragment', vox: 24, file: 'fragment-vox24-27.png' },
  { kind: 'shot', count: 27, mask: 'splatedit', vox: 24, file: 'splatedit-vox24-27.png' },
];

function urlFor(job) {
  const params = new URLSearchParams();
  if (job.kind === 'bench') {
    params.set('bench', job.mode);
  } else {
    params.set('capture', String(job.count));
  }
  params.set('mask', job.mask);
  params.set('vox', String(job.vox));
  return `${BASE}?${params.toString()}`;
}

await mkdir(DATA_DIR, { recursive: true });
await mkdir(IMG_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  executablePath: FULL_CHROME,
  args: ['--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});

console.log(`[capture-all] running ${jobs.length} jobs against ${BASE}`);
const summary = [];

for (const [n, job] of jobs.entries()) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const url = urlFor(job);
  console.log(`\n[${n + 1}/${jobs.length}] ${job.kind} ${job.file} ← ${url}`);
  page.on('pageerror', (err) => console.error(`  [pageerror] ${err.message}`));

  try {
    await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT_MS });

    if (job.kind === 'bench') {
      const handle = await page.waitForFunction(
        () => globalThis.__splatcarveBench,
        null,
        { timeout: TIMEOUT_MS, polling: 1000 },
      );
      const value = await handle.jsonValue();
      const outPath = join(DATA_DIR, `2026-05-20-${job.file}.json`);
      await writeFile(outPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
      const sizeKb = ((JSON.stringify(value).length / 1024) | 0);
      const head =
        value.type === 'h2'
          ? `${value.totalCarves} carves, ${value.snapshots.length} snapshots`
          : value.type === 'h1'
            ? `${value.totalSamples} samples, latency p95=${value.latency.p95.toFixed(2)}ms`
            : value.type === 'h3'
              ? `${value.totalCommitted}/${value.totalAttempted} ops committed, ${value.totalSplatsStacked} splats`
              : 'unknown';
      console.log(`  ✓ ${sizeKb} KB — ${head}`);
      summary.push({ file: outPath, ok: true, head });
    } else {
      await page.waitForFunction(
        () => globalThis.__splatcarveReady === true,
        null,
        { timeout: TIMEOUT_MS, polling: 500 },
      );
      // Frame margin so the carve mask render is fully on screen.
      await page.waitForTimeout(300);
      const canvas = page.locator('#splatcarve-canvas');
      const outPath = join(IMG_DIR, job.file);
      await canvas.screenshot({ path: outPath, type: 'png' });
      console.log(`  ✓ saved ${outPath}`);
      summary.push({ file: outPath, ok: true, head: `carve_count=${job.count} mask=${job.mask}` });
    }
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    summary.push({ file: job.file, ok: false, head: err.message });
  } finally {
    await page.close();
    await ctx.close();
  }
}

await browser.close();

console.log('\n[capture-all] summary:');
for (const row of summary) console.log(`  ${row.ok ? '✓' : '✗'} ${row.file} — ${row.head}`);

const failed = summary.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n[capture-all] ${failed.length} job(s) failed.`);
  process.exit(1);
}

console.log('\n[capture-all] all good. Dossiers V.3 + D.6 can now reference real numbers.');
