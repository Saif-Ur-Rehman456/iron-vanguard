# ADR-0004 — Strict TypeScript, no framework in the game

**Status:** accepted · **Date:** 2026-09-20

## Context

The prototype: JavaScript, no build step, global scripts, no types, no tests. It was
fast to write and impossible to change safely. The project is meant to be edited
often, in short sessions, by agents that cannot hold 85 KB in working memory.

Two separate questions: (a) how much type safety, (b) how much framework.

## Decision

**(a) Strict TypeScript everywhere.** `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals/Parameters`,
`verbatimModuleSyntax`, `isolatedModules`. Type-checking is a required CI step and
the first thing `npm run verify` runs, because it fails in seconds.

**(b) No framework.** The game is a canvas + a DOM HUD driven by an explicit frame
loop. The UI screens (`packages/ui`) build elements imperatively. No React, no
state-management library, no ECS, no DI container.

## Consequences

- `noUncheckedIndexedAccess` means every array access is `T | undefined`, so hot
  loops use `!` with a comment or a local. This is noisy in physics code and worth it
  everywhere else: it caught real out-of-range reads while porting.
- Explicit types mean a rename across content and simulation is a compile error list
  rather than a runtime surprise.
- Imperative UI is verbose but has no lifecycle rules to get wrong and no dependency
  to break. The HUD updates only the numbers that changed (`lastAmmo`, `lastHealth`,
  …), so it does not thrash the DOM at 60 Hz.
- No framework means no virtual DOM diffing for free: a new HUD element is a few
  lines of DOM construction. At this scale that is cheaper than the framework.

## Alternatives rejected

- **Plain JS with JSDoc types.** Weaker guarantees, and nobody enforces JSDoc.
- **React for the menus.** The menus are static panels with a handful of callbacks;
  a framework buys nothing and adds a build/bundle cost.
- **An ECS.** With one player, ≤ 20 hostiles and ~12 systems, an ECS would trade
  readable explicit code for indirection. Revisit if entity counts grow by an order
  of magnitude.
