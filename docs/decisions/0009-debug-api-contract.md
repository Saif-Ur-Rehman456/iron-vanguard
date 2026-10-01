# ADR-0009 — `window.__IV__` is the automation and debug surface

**Status:** accepted · **Date:** 2026-09-20

## Context

Browser games grow two parallel debugging paths: undocumented keyboard shortcuts that
mutate state, and Playwright tests that poke at internals through brittle selectors
and timers. Both are invisible to each other, and neither survives a refactor.

## Decision

All deliberate out-of-band access to the running game goes through one object:
`window.__IV__`, installed by `apps/game/src/debugApi.ts`. It exposes the world
(read-only-ish), the renderer, the game state, the seed, settings application, a
restart with a chosen seed, spawn/teleport helpers and a forced-outcome hook.

Rules:

1. **Everything debug-shaped is in that file.** No hidden shortcuts in the frame
   loop, no `if (debug)` branches sprinkled through the app.
2. **Tests drive the real game through it.** `tests/e2e/game.spec.ts` reads
   `__IV__.info()` instead of screen-scraping, so an HUD copy change does not break
   a gameplay assertion.
3. **Mutations that the tick would erase are re-applied.** `stepWorld` clears
   `world.events` each tick and rebuilds derived state, so forced outcomes are
   latched through a queue the app drains — the tests found this the hard way.
4. **It ships.** Removing it for production would mean testing a different build than
   we ship; it is small, namespaced and documented here.

## Consequences

- Playwright tests are readable: seed a run, act, assert on `__IV__.info()`.
- The devtools app and the golden-hash tooling use the same surface, so the entry
  points cannot drift.
- A reviewer can reproduce any reported bug with a URL (`?seed=42&autostart=1`) plus
  a console expression.
- The debug API is a public-ish contract: renaming `info()` is a breaking change for
  tests and docs, which is exactly the visibility we want.

## Alternatives rejected

- **Test-only builds with an injected harness.** Ships something other than what CI
  tests; the difference is where the bugs live.
- **Keyboard-shortcut debug menu.** Not addressable by automation, and every shortcut
  is a conflict waiting to happen.
