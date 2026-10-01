# ADR-0003 — Content is validated data, not code

**Status:** accepted · **Date:** 2026-09-20

## Context

In the prototype, a weapon was a literal object in the middle of a 400-line render
function, an enemy was a branch inside `updateEnemies`, and a wave was an array
indexed by `wave - 1` in the spawn loop. Adding a second weapon meant editing three
places and hoping. None of it could be validated: a typo produced a silent `NaN` or
a crash mid-wave.

## Decision

- All content lives in `packages/content` as plain data: `weapons.ts`, `enemies.ts`,
  `difficulty.ts`, `pickups.ts`, `surfaces.ts`, `maps/plaza.ts`,
  `missions/00_prologue.ts`.
- Types are explicit (`types.ts`) and the physics of the contract is enforced with
  `zod` schemas (`schema.ts`): positive magazines, drop chance 0..1, integer damage
  delays, non-empty waves.
- A **cross-reference pass** catches what schemas cannot: unknown `mapId` or
  `startingWeapon`, duplicate ids, a `survive` objective with no wave count, a
  checkpoint pointing at a wave that does not exist, rank thresholds that are not
  strictly descending.
- Accessors throw on an unknown id (`getWeapon('nope')` → `unknown weapon id: nope`)
  rather than returning `undefined` and failing 200 lines later.
- `npm run content:validate` runs it in CI, in the devtools app and in tests. The app
  calls `assertContentValid()` at boot so a bad data edit fails loudly and early.

## Consequences

- A new weapon is a data row; a new wave composition is an edit to one array.
- Balance changes are diffs of numbers, which is what makes sweeps meaningful.
- Anything a designer can feel must be expressible as data. When it is not, the fix
  is a new field — not a new `if` in the simulation. If a feature needs new
  *behaviour*, that is a system, and it belongs in `@iron/sim` with its own test.
- Content and behaviour can drift: a new field must be added to the schema, or it
  will not be validated.

## Alternatives rejected

- **JSON/YAML content files.** Losing TypeScript's types, `satisfies` checks and
  refactor support is a poor trade for data-entry ergonomics at this scale.
- **A runtime-loaded content pack (like a mod system).** Real benefit later; the cost
  is a virtual filesystem, cache invalidation and a whole class of "which version of
  the weapon is loaded" bugs. Deferred (see `docs/ROADMAP.md`), not dismissed.
- **Schema-only validation.** It cannot see relationships between tables, which is
  where the expensive mistakes live.
