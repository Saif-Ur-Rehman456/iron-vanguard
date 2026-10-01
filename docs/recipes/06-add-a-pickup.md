# Recipe 06 — Add a pickup

**Time:** ~45 minutes · **Risk:** medium · **Touches:** `packages/content/src/pickups.ts`,
`packages/content/src/types.ts`, `packages/sim/src/spawn.ts`, `apps/game/src/main.ts`

Pickups today are `medkit` and `ammo`: dropped by enemies with a weighted roll,
collected on proximity, with a lifetime. A new pickup type is data for its *numbers*
plus a small amount of code for its *effect*, because an effect is behaviour.

## Steps

1. **Widen `PickupDef['id']`** in `packages/content/src/types.ts` (e.g. add
   `'armour'`). Everything downstream is keyed off that union, so the compiler tells
   you where the effect has to be handled — including the inline
   `kind: 'medkit' | 'ammo'` on the `pickupCollected` event in
   `packages/sim/src/types.ts`, which is the one place the union is duplicated.

2. **Add the row** to `PICKUPS`: `displayName`, `amount`, `color`,
   `lifetimeSeconds`, `pickupRadius`, `weight`. Weights are relative; the drop roll
   normalises them. A high `weight` is how you make a pickup common.

3. **Apply the effect** in the pickup-collected path (`sim/spawn.ts` +
   `damage.ts`/`player.ts`). Two rules:
   - **Never exceed a cap silently.** Clamp health to max health, ammo to
     `reserveMax`, and emit an event with the *actual* amount granted, not the
     nominal one — otherwise the HUD lies.
   - **Keep it deterministic.** The drop position comes from `world.rng.loot`.

4. **HUD feed.** `pickupCollected` already carries `kind` and `amount`; extend the
   message in `apps/game/src/main.ts` so the new type reads properly instead of
   falling through the medkit branch.

5. **Renderer.** `render/fx` + the arena build a small procedural pickup mesh from
   `color`. If you want a distinct silhouette, add it there rather than in the data.

## Verify

```bash
npm run content:validate         # weight > 0, unique ids
npm test                         # content tests assert drop weights sum sensibly
npm run sim -- --seed=7 --quiet=false --seconds=600   # report shows pickups collected
```

Add a unit test for the clamp: pick up a medkit at full health and assert the event
reports the amount actually applied.

## Traps we have hit

- **`lifetimeSeconds` of 30 is gameplay, not housekeeping.** A pickup that expires
  while the player is reloading feels like theft; check the number against how long
  your waves actually last.
- **`pickupRadius` is measured in the horizontal plane only.** A pickup on a 1 m
  ledge is reachable; one inside a prop footprint is not.
- **`medkit` regen and pickup health interact.** `docs/BALANCE.md` records the
  difficulty-modulated numbers; a new heal effect should be measured with a sweep, not
  by feel.
