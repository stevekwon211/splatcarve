import { defineConfig } from 'vite';

/**
 * Wave E.2: GitHub Pages serves splatcarve under the `/splatcarve/` subpath,
 * so the production build needs Vite's `base` set to that prefix or every
 * asset URL resolves at `/assets/...` (root) instead of `/splatcarve/
 * assets/...` and the deployed page is blank.
 *
 * `pnpm dev` (no env) keeps `base = '/'` for local development.
 * The Pages workflow sets `VITE_BASE=/splatcarve/` before `pnpm build`.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
});
