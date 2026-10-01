# ADR-0007 — Two build targets from one source: product bundle and `callofduty.html`

**Status:** accepted · **Date:** 2026-09-20

## Context

The prototype's best property was that it was **one file** you could email, host
anywhere, or open from disk. That is genuinely valuable: no build, no server, no
dependency drift. It is also why it became unmaintainable.

The project needs both: a normal product build for a real deployment (code splitting,
hashed assets, source maps) and a single-file artifact that preserves the
"here is the game" property.

## Decision

Two Vite configs over one source:

- `npm run build` → `apps/game/dist/` — product build, source maps, hashed assets.
- `npm run build:single` → `apps/game/dist-single/callofduty.html` — everything inlined
  via `vite-plugin-singlefile`, renamed to `callofduty.html` by a small plugin.

Both are built in CI. The single-file artifact is uploaded as an artifact and subject
to its own size budget (`scripts/budget.mjs`: 20 MiB raw, 8 MiB gzip).

The artifact is self-contained because the procedural baseline means there are no
binaries to inline (ADR-0005). The one external reference is the Google Fonts
stylesheet: offline it degrades to the CSS fallback stack, and the game plays
normally. Inlining fonts is a future improvement, not a correctness issue.

## Consequences

- The game is playable by double-clicking a file, with no server and no network.
- Testing works against the product build (Playwright previews `dist/`) while the
  shareable artifact is verified by the budget script.
- Assets added later (GLB/KTX2 in `assets/`) will *not* be inlined into the artifact;
  they stream from `assets/` beside it. The artifact stays playable without them.
- Two build configs to keep in sync; the single-file config imports the base config so
  aliases and target cannot drift.

## Alternatives rejected

- **Single-file only.** No code splitting or incremental loading for a real
  deployment, and source maps inlined into a file people may publish.
- **Product build only.** Loses the property that made the prototype shareable.
- **A separate build tool for the artifact (esbuild/rollup script).** A second
  bundler with a second resolver is a second class of build bug.
