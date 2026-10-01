# Recipe 05 — Add a map

**Time:** ~half a day · **Risk:** high (collision, spawn gates, perf all meet here) ·
**Touches:** `packages/content/src/maps/*`, `packages/sim/src/collision.ts`,
`packages/render/src/level/arena.ts`

A map is a `MapDef`: bounds, a player spawn, ground surface, a prop list, spawn gates
and an ambient block. Collision, the editor overlay and map validation all derive from
the same prop data via `footprintOf()`, so a map cannot be "solid in-game but empty in
the editor".

## Start from the editor

`npm run dev:editor` opens a top-down view of a `MapDef`. Place props, drag zones,
then **export** — paste-safe JSON for `packages/content/src/maps/`. The editor knows
`footprintOf`, so the footprint overlay it draws is what the simulation will collide
against. Authoring by hand is fine too; the editor is a convenience, not a mandate.

## Steps

1. **Create `packages/content/src/maps/<name>.ts`** exporting your `MapDef` and adding
   it to that file's `MAPS` array (re-exported through `content/index.ts`). Follow
   `plaza.ts`: props first as a `const`, then the map, then the registry.

2. **Bounds and spawn.** `bounds` is the hard clamp for movement and the arena for
   hostiles. `playerSpawn` should have clear space around it — spawning inside a
   crate footprint is a bad first second.

3. **Gates.** Hostiles enter at `gates` (`{x, z, axis}`), which sit on or just outside
   the perimeter. Gate count and `spawnIntervalSeconds` together determine how fast a
   wave can actually arrive. Two gates on the same side is a legitimate design choice
   ("they come from the east") — three hundred hostiles through one gate is a bug.

4. **Props are the level.** Use the existing `PropKind`s. Each kind has fixed
   footprint semantics in `footprintOf` (`size` = width/radius/cube size depending on
   kind — read the switch before tuning). Decorative kinds (`tire`, `puddle`,
   `banner`, `rock`, `skyline`) return `null` and never block.

5. **A new prop kind** needs: a `PropKind` union member, a case in `footprintOf`, and
   a build recipe in `arena.ts`. If a prop blocks movement but has no shootable box
   (or vice versa) you will rediscover bug #1 in `AGENTS.md` — the barrel whose
   movement box was wider than its hitbox, which made it unshootable.

6. **Ambient.** `fireLight`, `smokeColumns`, `dustEnabled`, `skylineCount`,
   `rockCount`, `fogDensity` are all read by the renderer. `skylineCount`/`rockCount`
   are procedural dressing; keep them inside `docs/PERF_BUDGET.md`.

7. **Surfaces.** `groundSurface` must be a `SURFACES` id (recipe 09) — it drives
   decals and impact audio for the floor.

## Verify

```bash
npm run content:validate
npm run assets:validate            # prop/footprint sanity
npm run sim -- --mission=<id> --seed=7 --seconds=600
npm run sweep -- --seeds=4         # a new map must be completable by the bot
```

Then walk it yourself in `npm run dev`. Automated checks prove the map is *solvable*;
only you can tell whether the sightlines are interesting. Add the map's intent and
tuning constraints to `docs/LEVEL_DESIGN.md`.

## Traps we have hit

- **Rotation only helps rectangular props.** `rotatedFootprint` handles `jersey`,
  `sandbags`, `kiosk`, `wreck`; some kinds ignore `ry`, so a rotated wall may not block
  where it looks like it does. Check the switch.
- **Hostile pathing is local steering, not pathfinding.** Long walls with no gap can
  make a wave pile up on the far side (bug #4 in `AGENTS.md`). Prefer gaps and
  staggered cover to solid perimeter walls.
- **A prop list is data, so a typo is silent at compile time.** A misspelled `kind`
  falls through `footprintOf`'s default and becomes decoration — validate *and* look
  at the collision overlay in the editor before you trust it.
