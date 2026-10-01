# ADR-0006 — The prototype is frozen; parity is a target, not a constraint

**Status:** accepted · **Date:** 2026-09-20

## Context

The prototype's *feel* is its most valuable asset: someone tuned those numbers. Its
*structure* is its biggest liability. Copying the first without the second is the
whole game, and copying the second would have doomed the port.

There is also a real hazard in copying a prototype too faithfully: it had bugs. A
faithful port reproduces them — and then a test encodes them as expected behaviour.

## Decision

- `legacy/callofduty.r128.html` is **frozen**: never edited, never imported, never a
  build input. It is the reference document.
- Behaviour is extracted into `legacy/MECHANICS_SPEC.md` (the rules, with numbers) and
  the numbers themselves are lifted into `packages/content` tagged `// parity:`.
- `legacy/PARITY_NOTES.md` records every value that defines feel, and numbers every
  **intentional deviation** with a reason. Fourteen exist today; several are bug
  fixes.
- `tests/unit/content.test.ts` pins the parity values (M4 magnetism: 30 rounds,
  0.098 s, 34 damage, 2.1× headshot; player: 6.4/10.5 m/s, 4.2 s regen; hostiles:
  100/70/260 hp; waves 6/8+2/9+3+1/10+4+2/12+5+3). Changing one fails a test.
- Parity is judged on **feel**, not on code shape. When the prototype's structure and
  a better design conflict, the better design wins — with a numbered deviation.

## Consequences

- A regression in feel is a failing test, not a playtest discovery.
- Balance work has an anchor: `regular` difficulty is the parity baseline, so a sweep
  change is comparable across the whole project's life.
- Deviations must be justified in writing. This is deliberate friction: it prevents
  "parity" from meaning "whatever the port happened to do".
- Bugs in the prototype are *documented* rather than ported (see `PARITY_NOTES.md`
  §3–§9: wave dead air, `setTimeout` timers, axis-aligned rotated footprints,
  shoot-proof barrels, inert headshot multipliers, sight-line-free bursts, permanent
  wedges, melee crowding).

## Alternatives rejected

- **Fork the prototype in place, refactoring as we go.** Every step mixes a
  refactor with a behaviour change, which is exactly how a feel regression becomes
  unattributable.
- **Ignore the prototype and design fresh.** Throws away the tuned feel, which is the
  one thing we cannot re-derive cheaply.
- **Port everything faithfully, fix bugs later.** Encodes the bugs in tests, and
  "later" means a golden-hash churn on top of an art pass.
