# Balance

Balance claims in this project come with a command and a distribution. This file
records the method, the reference numbers, and the shape of the curve we are aiming
for. Update it whenever a sweep tells you something new.

## The method

```bash
npm run sweep -- --seeds=12 --seconds=420 --difficulty=regular
npm run sim   -- --seed=7 --seconds=420          # a detailed single run
npm run bench:sim                                 # make sure tuning did not cost perf
```

The "player" in every sweep is `ScriptedBot` (`packages/tools/src/bot.ts`): a
deterministic reference player that holds an 11–20 m standoff band, strafes, fires
in bursts, throws frags at clusters of three or more, withdraws under pressure, and
walks around geometry to reach the extraction zone. It is *not* a good player — it
is a consistent one, so a change in the numbers means a change in the game.

Read the distribution, not the average: `completion 8/8` with `avg end health 100`
means the difficulty is not doing anything, and `2/8` with `avg end health 12` means
it is lethal rather than hard.

## Reference measurements

Regular difficulty, scripted player, 8 seeds, 420 s budget:

| Difficulty | Completion | Avg time | Avg accuracy | Avg end health |
| --- | --- | --- | --- | --- |
| recruit | 4/4 | 182 s | 68.5% | 125 (untouched) |
| regular | 4/4 | 171 s | 67.3% | 97.2 |
| hardened | 4/4 | 177 s | 73.5% | 100.0 |
| veteran | 2/4 | 205 s | 72.2% | 50.0 |

The shape is the intent: recruit is a walkthrough, regular is the parity baseline a
competent player clears, hardened punishes sloppiness, veteran is where the
reference player starts losing runs. A *human* should find regular comfortable and
veteran demanding; if a change makes the bot's accuracy jump without the difficulty
changing, something in the ballistics or AI moved by accident.

Single-run report (seed 7, regular): completes in ~250 s / 15,000 ticks, 65/65
hostiles, ~64% accuracy, score ~7,980, ending health 100.

**The fifth review (ADR-0018) reproduced the `regular` row exactly.** Crouch, jump and the
sprint carry are *additive*: the scripted player never presses `C` or `Space`, so nothing it
does can move. `npm run sweep -- --seeds=4` gave `4/4, 170.6 s, 67.3%, 97.2` against the
recorded `4/4, 171 s, 67.3%, 97.2` — and the same additive property is why the golden trace
is untouched (`npm run replay`: 162 samples match). A stance change that *does* move these
numbers is a signal about the AI, not a tuning opportunity.

## Levers and where they live

| Lever | File | Notes |
| --- | --- | --- |
| weapon damage / rate / spread | `packages/content/src/weapons.ts` | changing the M4 moves the parity baseline |
| enemy health / speed / burst / accuracy | `packages/content/src/enemies.ts` | `damageDelayTicks` is the 70 ms parity delay |
| wave size, pacing, resupply | `packages/content/src/missions/00_prologue.ts` | composition, spawn interval, intermission |
| difficulty multipliers, regen | `packages/content/src/difficulty.ts` | `regular` is parity; scale the rest |
| drop rates and weights | `packages/content/src/pickups.ts` | `dropChance` lives on the archetype |
| scoring and ranks | `packages/content/src/pickups.ts` (RANKS) | |

There is no difficulty in `packages/sim`. If balancing requires a code change, that
is a missing data field — add it to content instead.

## What the numbers mean

- **Accuracy 60–75%** for the reference player is healthy. Above 85% means the
  spread/heat model stopped mattering; below 50% means enemies are dying to
  splashes, or the bot is fighting geometry.
- **Time 150–220 s** for a five-wave mission. Under 120 s and the waves are not
  pressing; over 300 s and something is stalling (run `diagnose.ts` before touching
  numbers).
- **End health on the winning difficulty** should not be 100. A clean clear at full
  health means enemy damage never landed.
- **Ammo economy:** a clearing run spends roughly the starting 240 reserve plus
  resupply; running dry before wave 4 means the damage-per-round is too low.

## Regression checks

- `tests/integration/mission.test.ts` asserts the reference player completes seed 7
  on regular, and that veteran is strictly harder than recruit across three seeds.
- `.github/workflows/nightly.yml` sweeps 12 seeds per difficulty and fails if a
  completion rate drops below the agreed floor (recruit 100%, regular 75%,
  hardened 50%, veteran 0%).
- The devtools "Balance sweep" panel runs the same sweep in a browser, for when a
  human wants to see it rather than read CI.

## Changing a number: the ritual

1. Change it in content.
2. `npm run sweep` before and after, same seeds, same budget.
3. Note the distribution change in the PR description.
4. If the change is gameplay-visible, re-record the golden hash and say why.
5. Update the tables above if the reference measurements moved.
