# Recipes

Short, concrete procedures for the changes this project makes most often. Each recipe
names the files it touches, what to run to prove it works, and the trap that has
actually bitten us before.

If you are doing something not listed here, the closest recipe plus
`docs/ARCHITECTURE.md` is usually enough — and if it is a *new kind* of change,
`docs/recipes/20-write-an-adr.md` is the one to follow.

## Content

| # | Recipe | Touches |
| --- | --- | --- |
| 01 | [Add a weapon](01-add-a-weapon.md) | `content/weapons.ts` |
| 02 | [Add an enemy archetype](02-add-an-enemy-archetype.md) | `content/enemies.ts`, `sim/ai.ts` |
| 03 | [Add a wave](03-add-a-wave.md) | `content/missions/*` |
| 04 | [Add an objective](04-add-an-objective.md) | `content/missions/*`, `sim/mission.ts` |
| 05 | [Add a map](05-add-a-map.md) | `content/maps/*`, `sim/collision.ts` |
| 06 | [Add a pickup](06-add-a-pickup.md) | `content/pickups.ts`, `sim/spawn.ts` |
| 07 | [Add a difficulty](07-add-a-difficulty.md) | `content/difficulty.ts` |
| 08 | [Add a rank](08-add-a-rank.md) | `content/pickups.ts` |
| 09 | [Add a surface](09-add-a-surface.md) | `content/surfaces.ts`, `render`, `audio` |

## Art

| # | Recipe | Touches |
| --- | --- | --- |
| 10 | [Author a Blender prop](10-author-a-blender-prop.md) | `assets_src/blender`, `tools/blender` |
| 11 | [Import a Mixamo rig](11-import-a-mixamo-rig.md) | `tools/blender/mixamo_retarget.py` |
| 12 | [Bake a texture set](12-bake-a-texture-set.md) | `tools/blender/conform.py`, `assets/` |
| 21 | [Import a downloaded model](21-import-a-downloaded-model.md) | `assets/models`, `assets/manifest.json`, ledger |

## Presentation

| # | Recipe | Touches |
| --- | --- | --- |
| 13 | [Add a particle effect](13-add-a-particle-fx.md) | `render/fx/*`, `sim` events |
| 14 | [Add a sound](14-add-a-sound.md) | `audio/sfx.ts`, content audio ids |
| 15 | [Add a quality setting](15-add-a-quality-setting.md) | `render/quality.ts`, `game/settings.ts` |

## Workflow

| # | Recipe | Touches |
| --- | --- | --- |
| 16 | [Record a golden replay](16-record-a-golden-replay.md) | `tests/golden/*` |
| 17 | [Run a balance sweep](17-run-a-balance-sweep.md) | `docs/BALANCE.md` |
| 18 | [Debug a stuck wave](18-debug-a-stuck-wave.md) | `apps/harness/src/*` |
| 19 | [Profile a frame](19-profile-a-frame.md) | `render`, `docs/PERF_BUDGET.md` |
| 20 | [Write an ADR](20-write-an-adr.md) | `docs/decisions/*` |

## The three rules every recipe obeys

1. **Data over code.** If the change can be expressed as a row in `packages/content`,
   it is a row, not a branch.
2. **Prove it with a command.** Every recipe ends with something to run —
   `npm run content:validate`, a sweep, a golden re-record, `npm run verify`.
3. **Say it in writing.** A deviation from the prototype goes in
   `legacy/PARITY_NOTES.md`; a boundary change goes in an ADR.
