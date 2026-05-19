/**
 * Wave E.5 — scripted 30-second demo recording.
 *
 * Follows docs/launch/demo-script.md beat for beat, driving Playwright
 * through the actual production app at http://localhost:5173/. Playwright
 * records a .webm of the viewport; we then ffmpeg-convert to mp4 alongside.
 *
 * Prereq: `pnpm dev` running. ffmpeg in PATH (optional — webm alone is
 * enough for the README embed).
 */
import { chromium } from 'playwright';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'public/launch');
const BASE = 'http://localhost:5173/';

const FULL_CHROME =
  '/Users/doeonkwon/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/' +
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  executablePath: FULL_CHROME,
  args: ['--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[browser:error]', msg.text());
});

const waitForLoaded = async () => {
  await page.waitForFunction(() => {
    const el = document.querySelector('#stats [data-stat="splats"]');
    return el && el.textContent && !el.textContent.includes('—');
  }, null, { timeout: 60_000 });
};

const canvasCenter = async () => {
  const canvas = page.locator('#splatcarve-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

console.log('[record] beat 0–3 s — scene load');
await page.goto(`${BASE}?mask=fragment`);
await waitForLoaded();
await page.waitForTimeout(2500);

console.log('[record] beat 3–6 s — voxel grid overlay (G)');
await page.keyboard.press('g');
await page.waitForTimeout(2500);

console.log('[record] beat 6–11 s — pick mode (1), hover sweep');
await page.keyboard.press('1');
const c1 = await canvasCenter();
for (const [dx, dy] of [[0, 0], [60, 40], [-60, -30], [90, -50]]) {
  await page.mouse.move(c1.x + dx, c1.y + dy);
  await page.waitForTimeout(900);
}

console.log('[record] beat 11–17 s — carve mode (2), 4 clicks');
await page.keyboard.press('2');
for (const [dx, dy] of [[0, 0], [40, 40], [-40, 0], [40, -40]]) {
  await page.mouse.move(c1.x + dx, c1.y + dy);
  await page.waitForTimeout(250);
  await page.mouse.click(c1.x + dx, c1.y + dy);
  await page.waitForTimeout(900);
}

console.log('[record] beat 17–21 s — A/B switch to splatedit');
await page.goto(`${BASE}?mask=splatedit`);
await waitForLoaded();
await page.waitForTimeout(800);
await page.keyboard.press('2');
const c2 = await canvasCenter();
for (const [dx, dy] of [[0, 0], [40, 40], [-40, 0]]) {
  await page.mouse.move(c2.x + dx, c2.y + dy);
  await page.waitForTimeout(200);
  await page.mouse.click(c2.x + dx, c2.y + dy);
  await page.waitForTimeout(800);
}

console.log('[record] beat 21–27 s — back to fragment, stack mode (3)');
await page.goto(`${BASE}?mask=fragment`);
await waitForLoaded();
await page.waitForTimeout(600);
await page.keyboard.press('3');
const c3 = await canvasCenter();
for (const [dx, dy] of [[0, 0], [40, 30], [-30, 30]]) {
  await page.mouse.move(c3.x + dx, c3.y + dy);
  await page.waitForTimeout(700);
  await page.mouse.click(c3.x + dx, c3.y + dy);
  await page.waitForTimeout(700);
}

console.log('[record] beat 27–30 s — hold');
await page.waitForTimeout(3000);

await page.close();
await ctx.close();
await browser.close();

// Playwright drops the video as a randomly-named .webm. Rename it.
const drops = await readdir(OUT_DIR);
const newest = drops
  .filter((f) => f.endsWith('.webm') && !f.includes('splatcarve'))
  .sort()
  .pop();
if (newest) {
  const target = join(OUT_DIR, 'splatcarve.webm');
  await rename(join(OUT_DIR, newest), target);
  console.log(`[record] saved ${target}`);
} else {
  console.warn('[record] no .webm dropped — Playwright may not have captured the session');
}
