# Recipe 02 — Add an enemy archetype

**Time:** ~1 hour · **Risk:** medium · **Touches:** `packages/content/src/enemies.ts`,
`packages/sim/src/types.ts`, `packages/sim/src/ai.ts`, `packages/render/src/characters/enemyView.ts`

An archetype is a `EnemyDef` row **plus** a place in the AI's behaviour table. Adding
a variant that behaves like an existing one (different health, speed, accuracy) is
data only; a genuinely new behaviour is code.

## Data-only archetype (the common case)

1. **Add the id** to `EnemyArchetype` in `packages/content/src/types.ts`
   (`'rifleman' | 'rusher' | 'heavy' | 'marksman'`).

2. **Add the row** to `ENEMIES` in `packages/content/src/enemies.ts`, copying the
   closest archetype. The fields that change feel most:

   - `health`, `speed`, `scale` — bulk and pace
   - `preferredRange` — where it wants to stand; the AI steers to hold this band
   - `burst.engageRange` — furthest it will open fire
   - `burst.telegraphSeconds` — how long the laser warning is held; this is the
     player's fair warning and the primary fairness dial for a new hostile
   - `burst.accuracyBase`, `accuracyFalloffPerMetre`, `accuracyEvadePenalty`
   - `burst.damageDelayTicks` — damage lands N ticks after the shot (bullets, not
     teleporting hitpoints)
   - `melee` — omit for a shooter, provide for a rusher
   - `render.*` — procedural colours, so no art is required
   - `audio.*` — cue ids

3. **Assign it in waves** (`content/missions/*`). A wave's `composition` is typed with
   the three original keys; when you add an archetype, widen that object type and
   update `spawn.ts` to place it. Missing this is the one compile-time trap.

4. **Check the renderer** builds a body for it: `enemyView.ts` switches on archetype
   for silhouette. Unknown ids fall back to the rifleman shape, which is safe but
   boring.

## New behaviour (rarer, do it deliberately)

1. **Extend the AI state machine**, not the def. `EnemyDef.tactics` carries tags
   (`'hold'`, `'advance'`, `'suppress'`, `'rush'`, `'flank'`, `'anchor'`) that the
   squad layer weighs when positioning; a genuinely new tactic earns its own branch in
   `updateEnemies` with a comment explaining the counterplay it creates.
2. **Keep it deterministic:** any randomness comes from `world.rng.ai`, never
   `Math.random`.
3. **Give the player a tell.** Every archetype must be identifiable at a glance
   (silhouette, colour, or audio) and must telegraph before it hurts you.
4. **Record the change** in `docs/decisions/` if it adds a mechanic the player has to
   learn, and update `docs/BALANCE.md`.

## Verify

```bash
npm run content:validate
npm test -- tests/unit/ai.test.ts          # perception + steering invariants
npm run sim -- --seed=7 --seconds=480 --difficulty=hardened
npm run sweep -- --seeds=8                # a new hostile must not make a wave unclearable
```

Add a targeted test for the new behaviour in `tests/unit/ai.test.ts` — the existing
ones (sees across open ground, does not see through buildings, walks around a lamp
post) are the template.

## Traps we have hit

- **A blinded enemy kept firing.** If your archetype's behaviour bypasses the
  line-of-sight check when starting a burst, you reintroduce bug #3 from `AGENTS.md`.
- **Steering probes are 1.8 m.** An archetype with a very long engagement range will
  happily shoot through a fence gap it cannot walk through — verify pathing, not just
  line of fire.
- **`damageDelayTicks` of 0** makes enemy damage feel instantaneous and unfair at
  range; the existing values exist for a reason.
