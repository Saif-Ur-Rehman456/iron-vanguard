# Recipe 07 — Add a difficulty

**Time:** ~30 minutes · **Risk:** medium (it is the game's fairness contract) ·
**Touches:** `packages/content/src/difficulty.ts`, `packages/ui/src/screens.ts`,
settings persistence, CI

Difficulty is the most player-visible tuning in the project, so it gets the strictest
process: data, sweep evidence, and a documented target.

## Steps

1. **Add a row** to `DIFFICULTIES` with `id`, `displayName` and the six dials:

   | Dial | Effect |
   | --- | --- |
   | `enemyHealthMultiplier` | hostile time-to-kill |
   | `enemyDamageMultiplier` | incoming damage per landed burst |
   | `enemyAccuracyMultiplier` | hit chance at range and while you move |
   | `playerHealth` | your pool (only `recruit` differs from parity) |
   | `regenDelaySeconds`, `regenPerSecond` | how forgiving a mistake is |
   | `resupplyMultiplier` | ammo/grenades between waves |

2. **`id` is part of a union** (`'recruit' | 'regular' | 'hardened' | 'veteran'`) so
   the compiler enumerates every place that must know about a new tier: difficulty
   tables, save/settings validation and the menu.

3. **Keep `regular` at parity.** The prototype's numbers live on `regular`
   (`legacy/MECHANICS_SPEC.md`); the golden hash and the parity record assume it. New
   tiers move *around* it, they do not redefine it.

4. **Change one dial at a time when tuning** and re-run the sweep after each. Two
   simultaneous changes cannot be attributed.

5. **Say what it is for.** Add a one-line intent to `docs/BALANCE.md` (e.g. "hardened:
   mistakes are punished, positioning still forgives; veteran: the bot dies, that is
   the point").

## Verify

```bash
npm run sweep -- --seeds=8 --difficulty=<new>
```

The result you are looking for is a *shape*, not a percentage: the hardest tier should
be expected to kill a competent player sometimes, and the easiest should be completable
on every seed. Record the sweep table in `docs/BALANCE.md`.

## Traps we have hit

- **Difficulty and the scripted player interact.** The bot's behaviour is fixed, so a
  tier that only inflates accuracy punishes *movement*, not skill — check the sweep
  before adding another multiplier.
- **`playerHealth` other than 100 is a wider change than it looks**: HUD bar
  fractions, damage maths and the low-health cue all assume a max. Prefer multipliers
  unless you specifically want a larger pool.
- **Do not hide the difference.** The menu shows the tier name; the player should never
  wonder which one they are on.
