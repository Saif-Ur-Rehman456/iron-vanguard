# ADR-0002 — Deterministic simulation: fixed timestep, seeded streams, commands, state hashing

**Status:** accepted · **Date:** 2026-09-20

## Context

We want replay, golden regression tests, headless balance sweeps, reproducible bug
reports and devtools that can *prove* a refactor changed nothing. All five need the
same property: the same inputs must produce the same state, on any machine.

The prototype had none of it: `Math.random()` for spawns and AI, `setTimeout` for
damage and reload audio, variable `dt` from frame timing, and no way to look at the
world except through the renderer.

## Decision

1. **Fixed timestep.** 60 Hz, `TICK_DT = 1/60`. The app accumulates frame time and
   runs 0–5 ticks per frame; the simulation never sees wall time.
2. **Named RNG streams.** `spawn`, `ai`, `fx`, `ballistics`, `loot`, `world`, each
   seeded by `fnv1a32(streamName) ^ imul(runSeed, 0x9e3779b1)`. Streams are
   independent, so adding FX randomness cannot shift a spawn roll. `Math.random()` is
   banned in `core`/`sim` by lint.
3. **Commands are the only input.** `CommandQueue` accumulates `move`/`look`/`fire`/
   `aim`/`sprint`/`action`, can record a log, and the tick consumes a plain
   `InputState`. A recorded log is therefore sufficient to replay a mission.
4. **Timed effects are tick queues.** `pendingShots` (the 70 ms enemy damage delay)
   and `pendingCues` (reload audio stages) replace `setTimeout`.
5. **Quantised state hashing.** `hashWorld()` hashes gameplay-visible state only,
   with floats quantised to 1e-3 to absorb cross-platform float noise.
   `tests/golden/prologue.seed7.hash` stores one hash per simulated second; the
   replay test compares sample by sample.

## Consequences

- `npm run replay` verifies the whole simulation in ~1.5 s.
- A balance sweep is reproducible, so a distribution change is attributable.
- Every animation and camera effect must interpolate between ticks (`alpha`) rather
  than stepping the simulation — that is why `capturePrevious()` exists.
- Presentation randomness (dust drift, muzzle variation) must draw from the `fx`
  stream, never `Math.random`, or it will not reproduce.
- Adding a system to the tick order moves every hash. That is intended: it forces a
  deliberate re-record with a reason in the commit.

## Alternatives rejected

- **Float-exact determinism (no quantisation).** Fails across engines and platforms
  for trig; the golden test would be flaky rather than meaningful.
- **Snapshotting whole worlds.** Large, unreadable diffs. A per-second hash plus
  targeted assertions tells you *where* a change happened in one comparison.
- **Recording input and replaying through the browser.** Slow, and it makes the game
  the only test harness. The headless CLI does the same job in milliseconds.
