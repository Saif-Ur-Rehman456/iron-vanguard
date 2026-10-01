# Recipe 04 — Add an objective

**Time:** ~30 minutes · **Risk:** medium · **Touches:** `packages/content/src/missions/*`,
`packages/sim/src/mission.ts`, `packages/ui/src/hud.ts`

Objectives are the mission's spine: the HUD shows the active one, the spawner reacts to
them, and the mission ends when the last one completes. The *kinds* exist already
(`eliminate`, `survive`, `reach`, `defend`, `escort`, `destroy`, `extract`), so most new
objectives are data.

## Steps

1. **Add an `ObjectiveDef`** to the mission's `objectives` array, in the order it should
   be attempted. Fields:

   - `id` — unique within the mission (validated)
   - `kind` — one of the kinds above
   - `label` — short, e.g. `REACH EXTRACTION`
   - `hudText` — the line under the objective marker; write it as an instruction
   - `optional` — optional objectives must never block mission completion
   - `params` — `count` for `eliminate`/`destroy`, `waves` for `survive`,
     `zone: {x, z, radius}` for `reach`/`extract`/`defend`, `holdSeconds` for `defend`,
     `archetype` to filter which kills count

2. **Check the activation gate.** `updateObjectives` activates the next objective when
   the previous one completes; an objective that depends on a wave gate needs its
   condition wired there. Read the existing `survive` → `reach` → `extract` chain in
   `packages/sim/src/mission.ts` before adding anything exotic.

3. **Make failure possible and legible.** If an objective can fail, the player must be
   told (HUD event `objective` with `state: 'failed'`, plus a subtitle). Silent failure
   is the worst outcome in the whole game.

4. **HUD.** The active `hudText` is rendered through `objectiveText()` in
   `apps/game/src/main.ts` and the objective event. If you invent a new `kind`, add a
   branch there so it does not render as `undefined`.

5. **Zone objectives need somewhere real to stand.** Take the centre from the map's
   prop data, not from imagination — put the extraction zone in open ground with at
   least 3 m of clearance, or hostiles will body-block the player out of their own
   victory condition.

## Verify

```bash
npm run content:validate                  # needs zone for reach/extract/defend, waves for survive
npm test -- tests/integration/mission.test.ts
npm run sim -- --seed=7 --seconds=600     # the report prints objective progression
```

Write an integration test that drives the mission to the new objective and asserts
both the completion event and the mission-end behaviour — the existing tests around
the extraction beat are the template.

## Traps we have hit

- **A `survive` objective counting more waves than the mission defines** is caught by
  the validator; a `survive` objective counting *fewer* is not, and silently ends the
  mission early.
- **Two objectives completing in the same tick.** The progression loop advances one
  step per tick, so simultaneous completion resolves in declaration order — if that
  matters for your mission, say so in a comment.
- **The `extract` zone is inside geometry.** The player can then never win. Check with
  the map validator, not by walking there.
