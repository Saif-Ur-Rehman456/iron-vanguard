# Level design — Al Kadim Plaza

The plaza is a **combat arena**: one open middle, four approach corridors, cover that
creates decisions rather than decoration. `plaza_alpha` in
`packages/content/src/maps/plaza.ts` is the data; `apps/editor` is the tool;
`packages/tools/src/mapValidate.ts` is the automated critic.

## Layout

```
                        ▲ NORTH GATE (z = +60)  ← extraction at (0, 56)
        ┌───────────────┬───────────────┬───────────────┐
        │  buildings    │   building    │   buildings   │
        │  (-44,40)(-28,26)   (-2,42)    (28,28)(44,42) │
        ├───────────────┴───────┬───────┴───────────────┤
  WEST  │   cover: jerseys      │      monument (0,0)   │  EAST
 GATE   │   sandbags, planters  │      8.5 m, 4.2 half   │  GATE
(-60,0) │   wrecks, kiosks      │      blocks mid sight │ (60,0)
        ├───────────────┬───────┴───────┬───────────────┤
        │  buildings    │   building    │   buildings   │
        │  (-46,-40)(-30,-26)  (2,-42)   (30,-26)(44,-42)│
        └───────────────┴───────────────┴───────────────┘
                        ▼ SOUTH GATE (z = -60)   player spawn (0, 30)
```

- **Playable bounds** ±58 inside 5 m walls; each wall has a ±8 m gate gap.
- **Player spawn** (0, 30) facing north — the plaza opens up in front of you, with
  the monument as the first piece of cover and the north building screening the
  extraction.
- **Extraction** (0, 56) r6, inside the north gate: after five waves you must cross
  ground you have been fighting over, with the north building forcing a flank.
- **Enemies** spawn at ±65 on one axis and walk in through a gate, so a wave arrives
  as a *flow* through a known choke rather than teleporting into the fight.

## Design rules and how they are enforced

| Rule | Rationale | Enforcement |
| --- | --- | --- |
| Spawn is never inside geometry, and never within 6 m of a barrel | an unfair opener ruins a first impression | `validateMap` (error / warning) |
| Every gate has a clear approach | a blocked gate strands a wave | `validateMap` (warning) |
| At least 10 cover props | fights read as flat without them | `validateMap` (warning) |
| No two props at identical coordinates | stacked props look like bugs | `validateMap` (warning) |
| A prop blocks what it looks like it blocks | players trust the silhouette | rotated footprints (`collision.ts`) |
| Every prop has a surface id | impact FX/audio are chosen by surface | `SURFACE_*` naming + material table |
| Long sight lines are broken by the monument/buildings | 120 m open fire is a coin flip, not a fight | map layout + `mapValidate` density checks |

Run `npm run content:validate` (content + map checks) or use the editor's live
validation panel while moving things.

## Encounter beats

| Beat | Where | Intent |
| --- | --- | --- |
| Opening | spawn → centre | learn the weapon on a handful of riflemen at range |
| First pressure | wave 2 rushers | punish standing still; teaches the standoff band |
| First threat spike | wave 3 heavy | forces target prioritisation and headshots |
| Chaos | wave 4, all gates | tests positioning and cover discipline |
| Climax | wave 5 (20 hostiles) | asks the player to use the whole arena, including barrels |
| Resolution | survive → extraction | a short, exposed walk as a wind-down with a purpose |

An intermission of 4.5 s is enough to reload, reposition and pick up drops but not
enough to fully reset — the pressure should not fully discharge between waves.

## Cover budget

Cover is placed so that no point in the plaza is more than ~12 m from something to
hide behind, and no cover piece is large enough to be a fortress:

| Kind | Footprint | Height | Note |
| --- | --- | --- | --- |
| jersey barrier | 1.2 × 0.28 m half | 0.95 m | crouch-and-shoot height, fires over the top |
| sandbags | 3 × 0.7 m half | 1.0 m | longer, holds a lane |
| crate | 0.65 m half | 1.0–1.3 m | stackable, blocks eye-line at standing height |
| planter | 0.9 m half | 0.8 m | low, breaks sight lines without blocking movement much |
| kiosk | 1.5 × 1.4 m half | 2.6 m | full-height block: a decision, not a hiding spot |
| wreck | 2.3 m half | 1.9 m | soft cover, big silhouette |
| monument | 4.2 m half | 8.5 m | central anchor; the only thing that blocks map-wide |

## Barrels

Ten barrels, alternating red/green variants, 30 hp each, chain-exploding. They are
placed near chokes and cover (`-8,-9`, `12,5`, `-17,9`, `21,-15`, `-6,19`, `15,16`,
`-27,-12`, `31,6`, `-35,26`, `26,-33`) so that a player who notices them gets a free
multi-kill and a player who ignores them is not punished unfairly. Never within 6 m
of spawn — checked by `validateMap`.

## Editing the map

```bash
npm run dev:editor      # top-down editor, live validation
```

1. Drag props; shift-drag locks an axis; wheel zooms; right-drag pans.
2. Watch the validation panel — fix errors before exporting.
3. `EXPORT .TS` writes a module with the same shape as `plaza.ts`; drop it in and
   update the `MAPS` array.
4. `npm run content:validate` and a sweep, because moving cover changes balance.
5. If a prop moved in a way a player can feel, note it here.

## Adding a new map

1. Copy `plaza.ts` as a starting point (it is data, not code).
2. Keep the `MapDef` contract: bounds, spawn, gates, `ambient`, props.
3. Run `validateMap`; a map with no gates cannot spawn anything.
4. Point a mission at it (`mission.mapId`) and add an objective zone.
5. Sweep it — a map is only "good" when the reference player can complete a mission
   on it without stalling.
