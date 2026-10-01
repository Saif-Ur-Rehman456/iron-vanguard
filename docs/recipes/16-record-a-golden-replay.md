# Recipe 16 — Record a golden replay

**Time:** ~10 minutes · **Risk:** high to *do by accident*, low to do deliberately ·
**Touches:** `tests/golden/prologue.seed7.hash`, `legacy/PARITY_NOTES.md`

The golden trace is the project's most valuable test: one hash per simulated second of a
whole mission, produced by the scripted player. If a change moves a single tick of
gameplay, it moves.

## When you must re-record

- a gameplay change (weapon numbers, AI, collision, spawn timing, objectives);
- a new system in the tick (tick order is the game's spine — `AGENTS.md` invariant 2);
- a content change that affects balance;
- deliberately fixing a bug that changes outcomes.

**Not** a reason: refactors that must be behaviour-preserving, presentation changes,
audio, UI. If one of those moves the hash, you have found a real bug — investigate
before re-recording.

```bash
npm test -- tests/golden/replay.test.ts
```

Mismatches print the tick, expected and actual hash. The first differing tick is where
the behaviour changed; work backwards from there.

## Re-recording

```bash
npm run hash -- --seed=7 --seconds=420 --out=tests/golden/prologue.seed7.hash
npm run replay                 # verifies a fresh run against the file
npm test -- tests/golden/replay.test.ts
```

Then, in the same commit:

1. **Say why.** The commit message must name the gameplay decision, not "update golden".
2. **Update `legacy/PARITY_NOTES.md`** if the change moves the game away from the
   prototype, with a note on which prototype value changed and why.
3. **Update `docs/BALANCE.md`** if the change is tuning.
4. **Re-run a sweep** (recipe 17) so the recorded trace and the balance numbers agree.

## Rules that keep the gate useful

- **One reason per re-record.** Bundling three gameplay changes into one trace update
  destroys the ability to bisect a future regression.
- **Never edit the `.hash` file by hand.** It is generated; a hand-edited trace is a test
  that asserts nothing.
- **The trace is a *contract*, not a snapshot of intent.** A trace that changes without
  a stated reason means either an accidental gameplay change or a lie in the commit
  message — both worth catching.

## Seeded, not random

The trace uses `--seed=7` because the bot and the spawner are deterministic. A seed whose
run is *atypical* (a stall, a near-death) is more valuable than a smooth one, so the
golden seed was chosen deliberately: it exercises the full five-wave mission plus the
extraction beat.
