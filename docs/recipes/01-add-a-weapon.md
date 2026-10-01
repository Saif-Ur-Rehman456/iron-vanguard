# Recipe 01 — Add a weapon

**Time:** ~20 minutes · **Risk:** low (data only) · **Touches:** `packages/content/src/weapons.ts`

Weapons are pure data. Nothing in `packages/sim` knows a weapon by name — it reads a
`WeaponDef` and applies it. If you find yourself editing the simulation, you are
building a *new behaviour*, which is a different (bigger) change.

## Steps

1. **Append a `WeaponDef` to `WEAPONS`** in `packages/content/src/weapons.ts`. Copy the
   closest existing entry (`m4_vanguard` for a rifle, `vector9` for an SMG) rather
   than starting from scratch — the field set is large and every field matters.

2. **Fill the required groups.** What each one actually does:

   | Group | What it controls |
   | --- | --- |
   | `magazine`, `reserveMax`, `reloadSeconds`, `shotInterval` | ammo and pacing |
   | `damage`, `headshotMultiplier`, `limbMultiplier` | damage model (`sim/weapons.ts`) |
   | `spread` | cone growth per shot, decay, hip/ADS/moving base |
   | `recoil` | aim kick (`pitch`) and view-model kick (`kick`, `recovery`) |
   | `ballistics` | hitscan vs projectile, range falloff, penetration |
   | `ads` | zoom FOV, transition time, movement penalty |
   | `handling` | sprint-out, equip time, moving-spread weight |
   | `audio` | cue ids (see recipe 14) |
   | `viewModel` | procedural gun shape + hip/ADS placement |

3. **Pick a class.** `class` and `fireMode` are descriptive for the HUD and future
   attachment rules; the simulation reads `shotInterval`, `magazine` and the burst
   handling from the input layer. A new mechanic (burst fire, charge-up) is a
   simulation change — do it deliberately and add an ADR.

3b. **Pick a `viewModel.archetype`** — `carbine` (a handguard and an optic), `ak` (a gas
   system over the barrel, wooden furniture, a rocking magazine, iron sights) or `pistol`
   (a slide, no stock). It defaults to `carbine`, and it selects which build in
   `packages/render/src/weapon/layout.ts` runs. A fourth silhouette is a *layout*, not a
   weapon: add an archetype there, with `MM`-style real dimensions, and the anchors
   (`muzzle`, `butt`, `gripRight`, `handguardLeft`, `magWell`, `optic`) that the pose
   solver and the two-bone arm rig need. `tests/unit/weaponRig.test.ts` then checks your
   weapon is the size the real one is, that the sight line lands on the camera axis, and
   that both hands are inside both arms at every aim blend.

3c. **Decide whether it is in the loadout.** `LOADOUT` in `weapons.ts` is what the soldier
   carries and what keys 1/2/3 select, in slot order; a weapon that is in no loadout needs
   another way to reach the player (a mission's `startingWeapon`, a pickup). The ammo a slot
   starts with is the magazine count times `viewModel.magazineReserve`, except for the
   mission's own weapon, which keeps the prototype's 240-round reserve.

4. **Sanity-check the numbers.** A weapon should not be better than an existing one
   at everything. Write down its intended niche in a comment (`// role: CQB
   corridor-clearer`) so the next person knows which numbers are load-bearing.

5. **Make it reachable.** Either set it as `startingWeapon` in a mission, or hand it
   out via a wave `resupply`/pickup. An unreferenced weapon still validates, but
   `knip`/review will ask why it exists.

## Verify

```bash
npm run content:validate     # schema + duplicate id + cross-reference
npm test                     # weapons tests assert the table shape
npm run sim -- --seed=7 --seconds=420   # mission still completes
```

If you changed an *existing* weapon, also re-run a sweep (recipe 17) and expect the
golden hash to move — re-record it (recipe 16) and note why in the commit.

## Traps we have hit

- **`headshotMultiplier` is now actually applied** (`sim/weapons.ts`). Before the fix
  it was decorative, so a value copied from an old balance sheet may be wrong.
- **Spread is a cone in radians, not degrees.** A `spread.hip` of 0.5 is a shotgun
  blast, not a rifle.
- **`shotInterval` is seconds, not RPM.** 600 RPM ≈ `0.1`.
- **`viewModel.hip`/`ads` are camera-space metres.** Wrong signs put the gun behind
  the camera; `z` is forward-negative. They are also no longer the *whole* pose: `hip` is
  solved so the support arm reaches its grip (see `weaponLayout`), and `ads` is solved so
  the sight line lands on the camera axis — reason about `anchors.optic.height` and the
  archetype's `eyeRelief`, not about the content numbers.
- **Adding a weapon does not move the golden hash** as long as the mission's own weapon and
  its ammo are untouched, because only the weapon *in hand* is hashed
  (`sim/statehash.ts`). Adding a weapon to `LOADOUT` does change what a player can do, so
  re-run `npm run replay` and say so in the commit.
