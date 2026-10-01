# ADR-0001 — Package boundaries and a lint-enforced dependency direction

**Status:** accepted · **Date:** 2026-09-20

## Context

The prototype is one 85 KB HTML file with ~40 module-level mutable globals and nine
CDN scripts. It works, and it is unmaintainable: every tweak touches the one file,
nothing can be tested in isolation, and "where does the weapon damage number live?"
has no answer. Vibe-coding on that file means re-reading it before every change.

## Decision

Split into workspaces with one direction of dependency:

```
@iron/core  ←  @iron/content  ←  @iron/sim  ←  @iron/render / @iron/audio / @iron/ui
                                        ↖  @iron/tools  ←  apps/*
```

- `@iron/core` has no dependencies at all (maths, rng, hashing, clock, pools).
- `@iron/content` depends only on `core` and `zod`.
- `@iron/sim` depends on `core` + `content`; it is forbidden from touching the DOM,
  `three`, timers or Node APIs.
- `render`/`audio`/`ui` depend on the simulation, never the reverse.
- `apps/*` are the only places allowed to know about more than one layer.

The direction is enforced by `eslint.config.js` (`no-restricted-imports` per glob
over `packages/sim/**` and `packages/core/**`) and by `tsc` project references, so a
violation fails `npm run verify` rather than being caught in review.

## Consequences

- A change to weapon numbers is a one-line content edit, greppable by name.
- The simulation can be run headless (harness, tests, devtools) because it never
  reaches for a browser API.
- More files and more ceremony for small changes. Accepted: the ceremony is one
  import, and it buys the ability to test anything.
- A new system sometimes wants to live in the "wrong" package. The answer is usually
  that it is two systems, one data change and one behaviour change.

## Alternatives rejected

- **One package, folders inside it.** No enforcement, so the boundaries rot within
  weeks — which is exactly what happened in the prototype.
- **A framework (React/ECS) to impose structure.** The structure needed here is a
  dependency direction, not a rendering model; a framework would add indirection to
  a codebase whose main virtue is that its hot path is readable.
