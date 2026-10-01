# ADR-0008 — The scripted player is a first-class citizen

**Status:** accepted · **Date:** 2026-09-20

## Context

Balance work on a shooter normally happens by playing it. That does not scale: a
five-wave mission is four minutes, a tuning change needs twenty runs, and "it felt
harder" is not evidence. Worse, a human player cannot be put in CI.

Meanwhile the architecture already gives us something better than a human: the
simulation is deterministic and has no platform dependencies, so a *script* can play
a full mission in Node at ~140× realtime.

## Decision

`packages/tools/src/bot.ts` implements a scripted player that drives the simulation
through the same `InputState` a human produces — it has no privileged access to
world state. `apps/harness` runs it headless:

```
run / sweep / hash / replay / bench / diagnose
```

Anything we claim about difficulty or balance must be reproducible with one of those
commands. A tuning PR that cannot show a before/after sweep is not finished.

The bot is deliberately *not* superhuman: it aims with the real spread model, has to
reload, sprints and holds a preferred range. It completes the prologue on recruit
and regular and dies on veteran with some seeds, which is the honest shape of a
difficulty curve.

## Consequences

- **Bug-finding is automated.** The stall traces (`apps/harness/src/stall.ts`,
  `traceEnemy.ts`) found the wedged-enemy defect that no unit test would have: a
  whole wave blocked behind a lamp post.
- **Balance is a table, not an opinion.** `docs/BALANCE.md` records sweep results
  per difficulty and seed count.
- **The bot becomes a QA contract.** `npm run sweep` failing (a seed that cannot
  complete) is a regression signal, not a flake.
- **Cost:** bot behaviour is now a thing to maintain. It is ~200 lines and it is
  allowed to know the mission (goals, extraction point) — it is a test harness, not
  a shippable AI.

## Alternatives rejected

- **Record-and-replay a human session.** Only tests the paths a human already took,
  and any gameplay change invalidates the recording.
- **Random-input fuzzing only.** Finds crashes, never finds "this wave cannot be
  cleared".
- **God-mode bot that sees the world directly.** Would pass through doors the player
  cannot and hide exactly the bugs we need to see.
