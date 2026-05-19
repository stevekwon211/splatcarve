# Launch checklist (Wave E.6)

When the project is ready to go public (verdict table filled in, demo
video embedded, live URL working, CI green), work through this checklist
**in order**. Anything that says "before tag" must land before the
`v0.1.0` tag; anything that says "after tag" can be done on a relaxed
schedule.

## Before tag

- [ ] **CI green on `main`** — last commit's GitHub Actions run for
      both `ci.yml` (typecheck + test + build + spark-anchor-guard)
      AND `pages.yml` (build + deploy) are green.
- [ ] **GitHub Pages live** — visit
      <https://stevekwon211.github.io/splatcarve/>; the butterfly loads,
      keys `1` / `2` / `3` all work, `?bench=h2` prints JSON to the
      console.
- [ ] **All four hypothesis verdicts filled in** in the README's
      "Hypothesis verdict" table — no `(?)` placeholders. Each cell
      links to a real dossier in `docs/research/`:
      - H1 → `2026-05-XX-h1-results.md`
      - H2 → `2026-05-19-h2-partial-results.md`
      - H2′ → `2026-05-XX-h2-breakthrough.md`
      - H3 → `2026-05-XX-h3-results.md`
- [ ] **Demo video embedded** — `public/launch/splatcarve.webm` +
      `splatcarve.mp4` exist, render at the top of the README, autoplay
      muted/loop.
- [ ] **Final grep sweep** — these must all return empty:
      ```bash
      grep -REI 'TODO|FIXME|forthcoming|coming soon' \
        --include='*.{md,ts,tsx,js,mjs,html,css,yml}' .
      git grep -nE '\(\\?\)|placeholder' README.md
      ```
- [ ] **Clean clone test** — on a fresh machine or in `/tmp`:
      ```bash
      git clone https://github.com/stevekwon211/splatcarve.git
      cd splatcarve && pnpm install && pnpm dev
      ```
      Browser loads the demo in <10 minutes including install time.

## Tag the release

```bash
git tag -a v0.1.0 -m "Splat carving + stacking at voxel resolution — full project shipped"
git push origin v0.1.0
```

Then on GitHub, draft a release from the tag with the README's verdict
table as the body. Include:

- 30-second video embed
- Hypothesis results table
- Link to the breakthrough dossier (per-fragment voxel mask)
- Link to the SVR-2025 distinction in "Related work"
- License + how to cite

## After tag — social posts

Run these in **batches over the same day**, not all at once. Watch for
replies; the first hour is when most engagement lands.

### Tweet thread (X / Bluesky)

> 1/ Open-source experiment shipped: splatcarve. Voxel-resolution carve
>     & stack on 3D Gaussian Splat scenes, in the browser, without
>     forking the renderer. 30-second demo + repo below.
>     [video] https://github.com/stevekwon211/splatcarve
>
> 2/ The trick: Spark.js stores its splat fragment shader in a
>     compiled `THREE.ShaderMaterial`. We hook `Material.onBeforeCompile`
>     and inject a `sampler3D` voxel-occupancy mask — per-fragment
>     `discard` produces crisp axis-aligned cube holes that per-splat
>     masking mathematically cannot. (Spark's docs say SplatEdit
>     evaluates at "each splat's center point"; that's why the legacy
>     A/B looks fuzzy.)
>
> 3/ Six commits from spike to current architecture: recon → initial
>     injection (256-box uniform loop) → per-vertex matrix → AABB
>     early-out → `sampler3D` O(1) lookup → Minecraft picker advance.
>     CI guards the Spark anchor strings so the next Spark release
>     can't silently break the patch.
>
> 4/ Stack mode (key 3) drops a nearest-neighbor splat cluster into
>     the empty voxel adjacent to the picked surface. RAF-throttled
>     ghost preview, density cap, full Cmd+Z. Built on the same
>     EditHistory the carve uses.
>
> 5/ MIT, repo at https://github.com/stevekwon211/splatcarve. Live
>     demo at https://stevekwon211.github.io/splatcarve/. Full
>     research dossier under `docs/research/`. PRs welcome.

### HN Show

Title: **Show HN: splatcarve – Voxel-resolution carve & stack on
3D Gaussian Splat scenes**

Body:

> Side project. The interesting bit is the per-fragment voxel-cell mask
> injected into Spark.js's compiled fragment shader via Three.js's
> standard `Material.onBeforeCompile` hook — no Spark fork.
>
> The mask is a `Data3DTexture` sized to the voxel grid; each fragment
> reconstructs its local-space position from a vertex-stage matrix,
> samples the mask, and `discard`s on hit. One texture lookup per
> fragment, O(1) regardless of how many cells are carved. The result is
> crisp axis-aligned cube holes — a side-by-side toggle (`?mask=fragment`
> vs `?mask=splatedit`) shows the contrast with per-splat masking, which
> evaluates the SDF at each splat's center (Spark's docs are explicit
> about this) and produces inherently fuzzy boundaries.
>
> Honest novelty framing: the fragment hook itself is officially
> advertised by Spark 2.0; the novelty is the *application* — voxel-mask
> + sampler3D + discard — and that no public OSS demo does this for
> live 3DGS scenes (surveyed in the README).
>
> Repo: https://github.com/stevekwon211/splatcarve · MIT · written up as
> a hypothesis-driven research log under `docs/research/`.
>
> Closest known prior art is a 2025 IEEE SVR paper from Santos & Soares,
> which targets visual effects (displacement / relighting / stylization)
> rather than discard-based removal, and has no public source. I'd
> happily revise the "first OSS demo" framing if anyone knows of a
> closer example.

### /r/GaussianSplatting

Title: **[OC] splatcarve — voxel-resolution carve & stack via
per-fragment shader injection (no Spark fork)**

Body: paste the HN body with a 30-second clip embedded directly.

### After the first day

- [ ] Watch GitHub Issues for repro requests and "doesn't work on
      machine X" reports. Pin the v0.1.0 release note that says
      "tested on Apple Silicon + Chrome / Safari TP" so expectations
      match.
- [ ] If someone files an issue claiming prior art, evaluate against
      the README's hedged claim and either link/credit, or explain
      the distinction (effect type, code availability).
- [ ] Tweak the README hedge if the SVR 2025 paper becomes accessible
      and the methodology overlaps more than the abstract suggested.

## Known not-doing

- Mobile / iOS — out of scope per plan §9.
- VolSplat-style learned material generation for stack mode —
  post-MVP candidate (H4 / H3-deluxe).
- Multi-scene picker — current bench scene is butterfly.spz only.
