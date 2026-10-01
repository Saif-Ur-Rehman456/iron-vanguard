# Recipe 03 — Add a wave

**Time:** ~15 minutes · **Risk:** low · **Touches:** `packages/content/src/missions/*`, `docs/BALANCE.md`

A wave is a `WaveDef` row. The spawner reads it, so a new wave needs no code — but it
does need the surrounding mission to stay coherent (indices, checkpoints, objectives).

## Steps

1. **Append a `WaveDef`** to the mission's wave composition table (in
   `00_prologue.ts` the rows come from `WAVE_COMPOSITIONS`, then get labelled). Every
   new row needs: `index` (1-based, contiguous), `label`, `subtitle`,
   `composition` counts, `spawnIntervalSeconds`, `intermissionSeconds`, `resupply`.

2. **Mind `index`.** Validation fails if wave at position *i* does not have
   `index === i + 1`. Inserting a wave in the middle means renumbering the tail and
   updating `mission.checkpoints` — the validator catches a checkpoint pointing at a
   wave that no longer exists.

3. **Design the beat, not just the count.** Each wave should change the question the
   player is answering:

   - introduce the archetype first, then combine it;
   - `spawnIntervalSeconds` is the pressure dial — lower means a fuller arena;
   - `intermissionSeconds` is the recovery dial, and `resupply` is what the player
     gets to spend it on;
   - a wave that only adds hitpoints is a slog; a wave that adds a *position* (heavies
     up the ramp) is a wave.

4. **Update the survive objective** if it counts waves
   (`params.waves`) — otherwise you ship a wave nobody has to clear.

5. **Spawn points.** Hostiles enter through the map's `gates`. A wave with more
   enemies than gate throughput will bunch up at the fence; check
   `spawnIntervalSeconds` against the gate count before blaming the AI.

## Verify

```bash
npm run content:validate
npm run sim -- --seed=7 --seconds=600       # full report: outcome, waves, kills, score
npm run sweep -- --seeds=8                  # every seed must still complete
```

Then play it (`npm run dev`) — sweeps prove a wave is *clearable*, not that it is
*fun*. Record the resulting numbers in `docs/BALANCE.md`.

## Traps we have hit

- **A wave that cannot be cleared** is the most expensive failure mode here; it is
  what the stall traces (recipe 18) exist for. If a seed fails, fix the cause, not the
  seed.
- **Total hostiles blow past the perf budget.** `docs/PERF_BUDGET.md` assumes ≤ 20
  concurrent hostiles; a wave of 40 will not hit 60 fps on the min spec.
- **Golden hash moves.** Adding a wave changes the trace by definition — re-record it
  (recipe 16) in the same commit.
