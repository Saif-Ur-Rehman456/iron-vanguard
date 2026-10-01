# Recipe 18 — Debug a stuck wave

**Time:** 20–90 minutes · **Risk:** you will want to change the test, do not ·
**Touches:** the diagnostic scripts in `apps/harness/src/`, then usually `sim/ai.ts` or
`sim/spawn.ts`

The failure mode: a sweep seed reports `INCOMPLETE`, or the player stands in an empty
arena with a wave that will not end. Almost always, a hostile is alive somewhere and
cannot reach the fight.

## 1. Confirm the symptom and get a seed

```bash
npm run sweep -- --seeds=8
```

Take a failing seed. Then get a coarse timeline:

```bash
npx tsx apps/harness/src/stall.ts <seed> 260
```

That prints, every 20 seconds, the objective and its state, alive hostiles, spawn queue
depth, player position and the objective's completion condition. The signature of a
wedged hostile is `alive=1` (or 2) forever while `queue=0`.

## 2. Find the wedge

```bash
npx tsx apps/harness/src/diagnose.ts <seed> 400
```

Every 10 seconds: each hostile's archetype, id, position, distance, AI mode and
line-of-sight flag. A hostile that has not moved between two samples while `los=0` is
wedged.

Then trace it at one-second resolution, including the steering internals:

```bash
npx tsx apps/harness/src/traceEnemy.ts <seed> 400 1
```

That prints `pos`, `mode`, `target`, `stuck` ticks, `unstickSign` and distance per
second for up to two hostiles. Read it left to right: is `stuck` climbing? is `target`
inside a prop footprint? is `sign` pinned?

## 3. Classify the cause

| What you see | Likely cause | Where to fix |
| --- | --- | --- |
| `stuck` climbs, position oscillates | steering probe accepts a direction blocked one step later | `sim/ai.ts` probe distances (bug #4 in `AGENTS.md`) |
| position outside the arena, never returns | spawn/gate placement put the hostile behind geometry | map gates or `spawn.ts` |
| `los=0` forever, never moves | perception gate stops the AI from ever re-acquiring | `ai.ts` search/advance behaviour |
| hostile inside a prop footprint | prop footprint vs. spawn point mismatch | map data (recipe 05) |
| `target` never changes | the steering target is inside cover and never re-picked | `ai.ts` target selection |

## 4. Fix the cause, add a regression test

The fix belongs in the system that misbehaved, and it needs a test that would have
failed before it. Existing examples on exactly this class of bug:
`walks around a lamp post instead of grinding into its corner` and the two-probe
steering change in `ai.ts`.

## 5. Re-verify, then update the golden

```bash
npm run sweep -- --seeds=8          # all seeds must complete
npm test
npm run hash -- --seed=7 --seconds=420 --out=tests/golden/prologue.seed7.hash
```

An AI pathing fix changes gameplay, so the trace moves. Record it deliberately
(recipe 16) and note the fix in the commit.

## The rule that matters here

**A seed that stalls is a bug report, not a flaky test.** Never "fix" it by changing the
seed set, adding a timeout or skipping the seed: the same wedge will hit a real player,
who will experience it as a wave that never ends.
