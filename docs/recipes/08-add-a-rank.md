# Recipe 08 — Add a rank

**Time:** ~15 minutes · **Risk:** low · **Touches:** `packages/content/src/pickups.ts`,
`packages/sim/src/statehash.ts` (stats), `packages/ui/src/screens.ts`

Ranks are a strictly descending table in `RANKS` (`packages/content/src/pickups.ts`),
evaluated best-first by `rankFor(score, accuracyPercent)`. The results screen and the
mission report both use it, so a rank change is visible in tests and in the harness.

## Steps

1. **Insert a `RankDef`** with `id`, `label`, `minScore` and optional `minAccuracy`.
   Keep `minScore` values strictly descending — the content validator fails the build
   if they are not.

2. **Use `minAccuracy` when the rank is meant to reward skill, not volume.** The
   prototype's `S` rank required ≥ 32% accuracy (`parity:` in the comment); that is the
   pattern for a rank you cannot grind out by spraying.

3. **Watch the range of scores the game can actually produce.** A rank whose threshold
   is above the best possible run is dead content; the harness `run` report prints
   score, accuracy and kills so you can check. A comfortable benchmark on `regular` is
   in `docs/BALANCE.md`.

4. **Label.** `label` is the line above the letter on the results screen (e.g.
   `COMBAT RATING`); only change it if the whole screen's vocabulary changes.

## Verify

```bash
npm run content:validate
npm test                                  # content tests assert descending thresholds
npm run sim -- --seed=7 --quiet=false --seconds=600   # prints the awarded rank
```

To check a threshold empirically, sweep and read the scores:

```bash
npm run sweep -- --seeds=8 --difficulty=regular
```

## Traps we have hit

- **The last rank must always match.** Whatever the score, `rankFor` must return
  something — keep a bottom row at `minScore: 0, minAccuracy: 0` or a bad run crashes
  the results screen.
- **`minAccuracy` is a percentage, `score` is points.** Mixing them up produces a rank
  nobody ever earns, which is invisible until you look at the numbers.
