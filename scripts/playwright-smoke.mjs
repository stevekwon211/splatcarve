/**
 * Smoke test: can a headless Chromium load the demo + run the bench harness?
 * Used once during Wave V.2 set-up. Not part of CI.
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/?bench=h2&mask=fragment&vox=64';
const TIMEOUT_MS = 180_000;

// playwright `chromium.launch({headless:true})` defaults to the
// chromium-headless-shell binary which lacks GPU acceleration —
// SwiftShader CPU rendering can't keep up with Spark's 6 MB texture
// uploads (WebGL context loss). Point executablePath at the full
// "Google Chrome for Testing" binary so ANGLE → Metal kicks in.
const FULL_CHROME =
  '/Users/doeonkwon/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/' +
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const browser = await chromium.launch({
  headless: false,
  executablePath: FULL_CHROME,
  args: ['--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text().slice(0, 240)));
page.on('pageerror', (err) => console.error('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'load', timeout: TIMEOUT_MS });
console.log('--- page loaded, waiting for bench result ---');

const result = await page.waitForFunction(
  () => globalThis.__splatcarveBench,
  null,
  { timeout: TIMEOUT_MS, polling: 1000 },
);
const value = await result.jsonValue();
console.log('--- bench result keys:', Object.keys(value));
console.log('--- total carves:', value.totalCarves, 'snapshots:', value.snapshots?.length);
console.log('--- first 200 chars:', JSON.stringify(value).slice(0, 200));

await browser.close();
