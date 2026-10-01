# Recipe 17 — Run a balance sweep

**Time:** minutes (the sweep itself is faster than reading this) · **Risk:** none ·
**Touches:** `docs/BALANCE.md`

A sweep runs the scripted player (ADR-0008) across several seeds on one difficulty and
reports the shape of the result: completion rate, time, kills, accuracy, end health. It
is how this project makes claims about difficulty without hand-waving.

## Run it

```bash
npm run sweep -- --seeds=8 --difficulty=regular
npm run sweep -- --seeds=8 --difficulty=veteran --seconds=600
npm run sweep -- --seeds=8 --difficulty=hardened --out=reports/hardened.json
```

Flags: `--seeds`, `--difficulty` (`recruit|regular|hardened|veteran`), `--seconds`
(simulated seconds per run), `--mission`, `--out` (JSON report).

The seeds are fixed (`100 + i * 17`), so two sweeps on the same commit are comparable and
a diff means a real change.

## Reading the output

```
completion 8/8  avg time 251.3s  avg accuracy 34.8%  avg end health 61.2
```

| Signal | Means |
| --- | --- |
| `completion < seeds` | **a regression or a wave that cannot be cleared** — treat as a bug, run recipe 18 |
| completion 100% at low end health | the tier is at its limit, which is the intent for veteran |
| avg accuracy far from ~30–40% | the bot's engagement model changed, or spreads/timing moved |
| avg time drifting up | waves are being cleared more slowly: spawn interval, AI pathing or TTK |
| end health near max everywhere | the difficulty is not being felt at all |

## Recording results

Add or update the table in `docs/BALANCE.md` with: commit subject, difficulty, seeds,
completion, avg time, avg accuracy, avg end health. Then state the *intent* the numbers
support ("hardened should complete but leave the player under 50% health on average").

## What a sweep cannot tell you

- **Whether it is fun.** A wave can be clearable and tedious.
- **Whether it feels fair.** Only a human notices a telegraph that is too short.
- **Whether a specific player path works.** The bot has one strategy; if the map supports
  flanking, the sweep will not exercise it.

So: sweep before *and after* a tuning change, then play it yourself.

## Making a sweep a test

If a number matters enough to defend, assert it — but assert the *invariant*, not one
seed's outcome. `tests/integration/mission.test.ts` follows that rule: it asserts that
the hardest tier is strictly harsher than the easiest rather than hard-coding "the bot
dies on seed X", because a literal assertion about a specific seed's doom breaks the
moment anything upstream improves.
