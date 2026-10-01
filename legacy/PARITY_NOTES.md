# Parity notes

`legacy/callofduty.r128.html` is the original 1,324-line single-file prototype. It is
**frozen**: never edit it, never import from it. It is the reference for *feel* —
movement, weapon handling, enemy behaviour, wave pacing — and this file is the record
of where the project matches it and where it deliberately does not.

## How to read this file

- **parity:** values in the code carry this marker meaning "lifted from the
  prototype". `tests/unit/content.test.ts` pins the important ones, so a change to a
  parity value fails a test rather than slipping through.
- **deviation:** an intentional difference, numbered below. Every one is a decision,
  not an oversight. If you add one, number it, explain it, and mention whether it
  moves the golden hash.

## Parity: the numbers that define the feel

| System | Value |
| --- | --- |
| Player walk / sprint | 6.4 / 10.5 m/s |
| Movement acceleration | rate 10 (exponential `damp`) |
| ADS movement penalty | 45% |
| Pitch clamp | ±1.45 rad |
| Health regen | 16 hp/s after a 4.2 s damage-free window |
| Eye height | 1.7 m, player radius 0.5 m |
| M4 Vanguard | 30 rounds, 360 reserve, 1.85 s reload, 0.098 s interval, 34 damage, 2.1× headshot |
| M4 spread | 0.012 hip, 0.0025 ADS, +0.02 moving, +0.018/heat, max 0.075 |
| M4 recoil | pitch +0.012 (+0–0.006 random), yaw ±0.0035 |
| Recoil/FX FOV | 75 hip, 42 ADS |
| Rifleman | 100 hp, 3.2 m/s, 3–4 round bursts, 0.13 s interval, 0.45 s laser telegraph, 6–10 damage, 26 m engage |
| Rusher | 70 hp, 5.4 m/s, 24 damage melee at 2.6 m, 0.3 s lunge, 1.1 s cooldown |
| Heavy | 260 hp, 2.1 m/s, 4 round bursts, 10–14 damage, 30 m engage |
| Enemy accuracy | base 0.42, −0.008/m, −0.14 evasion, clamped 0.07–0.5 |
| Waves | 6 / 8+2 / 9+3+1 / 10+4+2 / 12+5+3 = 65 hostiles, 0.75 s spawn interval, 4.5 s intermission |
| Spawn geometry | four gates at ±60 with a ±8 gap, spawns placed at ±65 and jittered ±2.5 |
| Barrels | 30 hp, chain-explode, radius 6, 130 damage, 0.8× to the player |
| Grenade | 16 m/s, 4.5 lift, 22 gravity, 2.1 s fuse, radius 7, 150 damage |
| Explosion falloff | `damage * (1 - d/radius) + 30` against enemies |
| Scoring | 100 / 120 / 250 per archetype, +50 headshot, ×N combo inside 2.5 s |
| Pacing | corpses persist 4.2 s; 900 ms pre-mission delay; 240 starting reserve |

## Deviations

### 1. Architecture: one file becomes packages

The prototype is a single IIFE with ~40 module-level mutable globals and CDN
scripts. The project splits it into `core`/`content`/`sim`/`render`/`audio`/`ui`
with lint-enforced boundaries. Not a gameplay change; the reason every other
deviation below is *checkable*.

### 2. Determinism: seeded RNG streams replace `Math.random`

The prototype called `Math.random()` from spawns, AI, ballistics and FX alike, so
adding a particle effect could change which gate an enemy spawned from. Now each
system draws from a named stream. Same distribution, reproducible results. **Moves
golden hashes by design — that is the point.**

### 3. Wave completion counts living hostiles only

The prototype waited for corpses to be removed (4.2 s) before ending a wave, so
every wave boundary had dead air and the intermission clock started late. The
spawner now checks living enemies only. Covered by
`awards resupply between waves and never stalls on corpses`.

### 4. Timed effects are tick-scheduled, not `setTimeout`

Enemy damage landed via `setTimeout(..., 70)`; reload audio was scheduled with
timers. Both are now tick queues (`pendingShots`, `pendingCues`). Same 70 ms delay
(4 ticks), but replayable.

### 5. Rotated props block the space they appear to block

The prototype registered an axis-aligned square for rotated barriers, so a jersey
barrier rotated 90° blocked a square three times its visible footprint. Footprints
now use the rotated extent. Covered by `accounts for rotation instead of using an
axis-aligned square`.

### 6. Barrel collision volume matches the barrel you can shoot

The prototype's barrel used a 0.6 half-extent collider against a 0.42 radius
cylinder for shooting. In this project that mismatch made every round hit the
barrel's own collider, so shooting a fuel barrel dealt no damage and chain
explosions only triggered from grenades. `BARREL_RADIUS` (0.45) is now shared by
collision and ballistics. Covered by `lets the player shoot a fuel barrel and blow
it up`. **This is the kind of bug parity copying produces; the test is the fix.**

### 7. Headshots apply the weapon multiplier

The prototype's `shoot()` multiplied by the headshot multiplier; the first port of
it defined `hitGroupMultiplier` but never called it, making headshots worth exactly
a bodyshot. The mission brief says "aim for the head", so this was a fidelity bug,
not a balance choice. Covered by `deals flat M4 damage across the plaza and doubles
it on a headshot`.

### 8. Breaking line of sight stops the attack

The prototype telegraphed with a laser and then fired a burst regardless of whether
the player had broken line of sight — the brief promised a dodge that did not
exist. Now a blind enemy aborts the telegraph or the burst and repositions; rounds
already in flight still land (parity: the 70 ms delay). Covered by
`sees the player across open ground and does not see through buildings`.

### 9. Local steering: enemies go *around* cover

The prototype walked hostiles straight at a target position and ground against
anything in the way; several runs ended with an enemy wedged behind a lamp post,
stalling the wave permanently. The port now uses two-probe local steering
(immediate step + lookahead) with wall-following hysteresis and a stuck watchdog
that re-picks a firing position. Still not a path graph — that is M2 work
(`docs/ROADMAP.md`) — but a wave can no longer stall. Covered by
`walks around a lamp post instead of grinding into its corner`.

### 10. Ranged enemies back off from melee range

Rushers close to melee; riflemen and heavies keep their preferred band (10–16 m /
12–20 m) and reposition instead of standing inside the player's face. The prototype
let them crowd, which made the plasma-telegraph unreadable at close range.

### 11. Victory requires extraction

The prototype ended the instant wave 5 was cleared. The campaign slice adds an
`extract` objective (zone at 0, 56, radius 6 — inside the north gate) so the
objective system has a real sequence: survive 5 waves → reach extraction → complete.

### 12. Difficulty is data

The prototype had one difficulty. Four are now defined as data
(`recruit`/`regular`/`hardened`/`veteran`); `regular` is the parity baseline, and
the others scale enemy health/damage/accuracy, player health, regen and resupply.
Balance claims are checked by sweeps, not vibes (`docs/BALANCE.md`).

### 13. Settings and saves exist

Sensitivity, invert-Y, FOV scale, three volume buses, motion scale, quality tier,
subtitles, colour-blind crosshair and difficulty persist to `localStorage` behind a
tolerant loader (unknown fields fall back to defaults). Checkpoint snapshots exist
in `packages/sim/src/save.ts` and are recorded at wave 3.

### 14. Recognised, not fixed, from the prototype

- The prototype's HUD was hard-coded English strings; here the display copy comes
  from content data (a prerequisite for localisation, not a localisation).
- The prototype's audio was a single convolver-free graph; the port adds buses,
  ducking and 3D panning. Per-cue synthesis is preserved.
- The prototype's `hud.feed` killfeed kept 6 rows with 3.4 s life; the port keeps the
  same numbers but drives them from events.

### 15. The key light is a moon, not a sunset

The prototype lit the plaza with a warm sun (`0xffd9a0`, 4.6 lux) at 47° elevation, under
a warm beige gradient sky with warm fog. The night-scene brief (Phase 02) asked for a
**cool** environment and **warm** local sources, which is impossible while the key and the
sky are both warm — the sky is the ambient, the reflections and the background, so a warm
sky makes every material warm no matter what the lamps do.

Deviations from the prototype, each deliberate (ADR-0013):

- Key colour `0xffd9a0` (sunset) → `0xbdd0f0` (moonlight); intensity 4.6 → 2.2–2.9 by tier
  (a third of the old sun on a lit surface at the lower elevation).
- Key **elevation 47° → 33°**, azimuth unchanged (`55, -35` in x/z). A lower key throws
  shadow lines across the street instead of lighting every roof equally, which is what
  "lighting reveals form" needs. Shadows fall in the same direction as before, so every
  shadow assertion in the probe suite still holds.
- Sky gradient cooled (`#1c2733…e0a55c` → `#0a1220…#5a5445`, with a thin warm city-glow
  band kept at the horizon); the sun disc sprite became a cool moon disc.
- Fog colour `#8b8f96` → `#4b5567` and density ×0.85 — the haze is the aerial perspective,
  so it has to desaturate distance toward the night sky, not toward beige, and it has to be
  *dimmer* than the near scene or the horizon becomes the brightest band in the frame.
- Exposure 1.35 → 1.24 and the bloom threshold 0.85 → 0.88–0.95, so lamp lenses and the
  muzzle flash read as sources instead of clipping to flat white.
- Lamp lights 12 cd → ~300 cd (varied per lamp). The old value was ~0.4 lux on the
  pavement 5.4 m below the lamp, i.e. 25× too dim to see: the lamps were objects with a
  glow sprite, not light sources.

The gameplay numbers are untouched: no simulation or content code changed for this, and the
golden replay is byte-identical.

### 16. The view model's pose is solved, not copied

The prototype's `viewModel.hip`/`ads` z values (-0.62, -0.44) were kept as-is in the data
and are still there, but the render layer no longer places the weapon from them: a 0.66 m
receiver on a 44 cm weapon put the muzzle 1.36 m from the eye, and `ads[1] = -0.178` put
the optic 10 cm *below* the crosshair, so the player aimed off the top of the receiver.
The pose is now solved from the layout — sight line on the camera axis, 12 cm of eye
relief, the hip depth from the support arm's reach — and `tests/unit/weaponRig.test.ts`
asserts it. Content's four numbers stay for the record and for parity comparison; nothing
reads x, y or z from them except the ADS x, which is 0 on every weapon. (ADR-0015)

### 17. The enemy body faces -z, and always did in every other system

The weapon, the muzzle, the aim laser and the death fall all point along local -z, which is
what `yawFromDirection(dx, dz) = atan2(-dx, -dz)` means. The *kit* — goggles, NVG mount,
chest pouches, knife, hip pouches, kneepads, toes, holster, pack, antenna — was authored at
+z, and the arms rested at a negative pitch, so the prototype's squad faced the player
while wearing its vest backwards and carried its rifle behind its back. All of that is now
named by `front()`/`back()`/`KIT` and tested. Kit *positions* deviate from the prototype
by a mirror; no gameplay number changes. (ADR-0015)

### 18. Quality tiers no longer change the look

The prototype's quality switch traded art direction for frame rate: shadows off, AO zeroed,
the lighting ratios cut, FXAA instead of SMAA, the dust off. Every tier now shares one look
rig and spends samples, sizes and counts instead, and the adaptive floor went from 0.7 to
0.8+ with a 60 fps target instead of 71. A machine that cannot afford the look loses
resolution and the HUD says so. (ADR-0014)

### 19. The floor is concrete, and its texel size is a decision

The prototype tiled one texture per 50 m of plaza (97 mm per texel) and let every prop's
density fall out of its own dimensions. Surfaces now state how many metres one tile covers
(`UV_DENSITY`), and `MapDef.groundSurface` — until now read by the simulation and the editor
and ignored by the renderer — selects the floor material. `'concrete'` and `'paving'` both
resolve to the plaza paving, `'asphalt'` to the road, and anything unknown falls back to the
paving. (ADR-0014)

---

All four are presentation-only: `packages/render` and `packages/ui`, no simulation or
content code, and the golden replay stays byte-identical.

## What "parity" means for future work

Parity is about *feel*, not about re-implementing the prototype's structure. When a
parity value and a better design conflict, prefer the better design, add a numbered
deviation here, and add a test that pins the new behaviour. Two rules survive all of
that:

1. `regular` difficulty, the M4, and the enemy archetypes stay within a few percent
   of the prototype's numbers — that is the baseline every balance sweep compares to.
2. Anything a player can feel is either parity or listed above.

### 20. Two more weapons, and a loadout

The prototype had one weapon (the M4, `CFG` parity values unchanged). The review asked for
three, selectable with **1/2/3**: a Desert Eagle, the M4, and an AK-47.

- The M4 keeps every parity number it had, including the 240-round opening reserve, and slot
  2 is the mission's opening weapon — which is why the golden trace is unaffected: a replay
  that never presses 1 or 3 never touches the other two slots. Verified with
  `npm run replay` at every step of the change.
- The Desert Eagle and the AK-47 are *new* weapons, so there is no parity to preserve and
  their numbers are set from the real firearms (7 + 21 rounds of .50 AE at 68 damage per
  shot with the worst recovery in the game; 30 + 90 rounds of 7.62 at 44 damage, a 2.55 s
  rock-in reload and a 0.887 m overall length).
- Deviating from "one weapon" is a gameplay change, so it is listed here: the loadout is
  content (`LOADOUT`), the swap is a recorded command (`weapon1..3`), and the ammo lives per
  slot in `PlayerState` — a swap is a swap, not a reload.

### 21. The morning scene is selectable, and the night is still the default

The prototype's fixed scene was a morning (the sunset/morning rig in `legacy/`), and the
prototype-parity build that replaced it was a night: a moon key, street lamps, lit windows
and stars. The review asked for **both**, chosen before deploying.

`level/timeOfDay.ts` now states the atmosphere as data and ships two presets: `dusk` (the
tuned night rig, ADR-0013, and the default, because it is what every number in
`docs/ART_BIBLE.md` describes) and `dawn` (a high warm sun, blue sky, no lamps, no lit
windows, no stars, thin warm haze, lower exposure, stronger sky reflection). Atmosphere is
presentation only — it cannot change the simulation, and the golden replay is unaffected.

### 22. Visual deviations in the same pass

- **Windows are geometry.** The facade texture no longer bakes rows of windows (including
  randomly "lit" ones) into its albedo; `arena.buildWindowRow` builds a reveal, a glass pane
  and a sill per opening, and the lit panes register the anchors the window-light pool
  follows.
- **Buildings author per-face UVs** (`geometry.boxUvMetres`) instead of stretching one UV
  square over all six faces.
- **A view-model light** (1.2 cd, 2 m reach, on the camera) exists so the weapon and the
  hands are lit. The prototype had no such thing; without it, at night, a first-person rig
  measured as one black silhouette.

### 23. Crouch and jump exist (the prototype had neither)

This one cannot be parity: the prototype has no crouch at all, and its `Space` did nothing.
The fifth review asked for **C = crouch, Space = jump**, realistically rather than robotically,
so this is a gameplay addition rather than a match — and it is listed here because a new
*capability* is a bigger deviation than a changed number.

- It is simulation state, not a camera offset: `STANCE` and `playerEyeHeight` in
  `packages/sim/src/player.ts`, because the eye height the AI aims at and the player's own
  shot origin have to be one number rather than two opinions.
- `crouch` is a **held command** and `jump` an **action**, both consumed in the existing
  actions step, so the canonical tick order (invariant 2) is unchanged and a jump replays like
  any other command.
- A grounded body's `pos.y`/`vel.y` are **zeroed rather than integrated**, so a replay that
  never presses C or Space hashes byte-identically to the previous golden. Verified with
  `npm run replay` (162 samples match): **this deviation does not move the hash.**
- **Sprint (Shift) is parity** — 6.4 / 10.5 m/s with a 7° FOV punch, all unchanged. What is new
  is only how a run *looks* from the player's own eyes: the weapon comes in across the chest
  (parity's 0.07 m drop left the rifle shouldered, i.e. running while aiming).

### 24. Visual deviations in the same pass

- **The sight picture is geometry.** A red-dot's tube is open-ended and double-sided, its bezel
  is a ring, the lenses are thin rings around a clear aperture and the turret and knob are
  off-axis, so the sight line is a hole through the weapon rather than a cap in front of the
  eye. No previous build in this project *saw through* the optic.
- **The walk is solved, not a sine.** The prototype (and every build since) rotated each leg
  from a single joint — `sin(phase) * 0.8`. The legs are a three-segment chain whose cadence,
  stride and knee flexion come from ground speed and from the clearance the foot must have
  (`GAIT` in `characters/uniform.ts`). The prototype's *feel* is preserved (every speed is
  untouched, as is the golden trace); a walk that reads as a walk needs a knee.
- **Every weapon is built from its archetype.** The prototype had one weapon; deviation 20 added
  the loadout, and this pass gave the pistol and the AK their own part sets (slide, grip,
  notch sight; gas system, wooden furniture, rocking magazine) instead of the carbine's.

### 25. The weapon's exposure and the aimed eye relief are ours, not the prototype's

The sixth review was about how the weapon *reads* on screen (a washed-out, glowing first-person
weapon and an optic that acted like an object), so every number it moved is presentation. They
deviate from earlier decisions in this repository rather than from `legacy/` — the prototype had
no view-model light at all and no optic to speak of — and they are listed because that is what
this file is for:

- **The view-model light is 1.1 cd** (was 2.6, born at 1.2): 7 lux on a receiver 40 cm away,
  about 2.7x the moon key (2.6 lux). The prototype had no such light, so there is no parity
  value to keep — only the rule this file records: a presentation light is measured against the
  scene's own level, because that is what the tone map is exposed for.
- **Bloom is 0.42 / 0.36 / 1.0** (strength / radius / threshold; was 0.55 / 0.5 / 0.9) and the
  muzzle light is **26 cd** (was 60, i.e. one stop). The flash's *duration* (40 ms), its
  position and its depth-tested sprite are unchanged: only its magnitude is ours.
- **The aimed FOV stays 55°** — the deviation from the prototype's 42 recorded in deviation 16 —
  and this pass did not touch it. The optic was re-sized to fit *it*, not the other way round.
- **The optic sits 17 cm from the eye** rather than a mechanical 12, because apparent size is
  what the player reads: at 55° a 46 mm housing at 12 cm is 39% of the frame's height. The
  sight *line* is unchanged and still solved onto the camera axis, so the rail the player aims
  along is the same rail.
- **Nobody moved the simulation.** Every number above is presentation; `npm run replay` still
  reports 162 samples matching `tests/golden/prologue.seed7.hash`, and the loadout's gameplay
  numbers (damage, spread, recoil, ammo, equip time) are untouched.

### 26. Surfaces are physical identities, and the hour changes them

The prototype had one response per surface, driven by whatever the first texture pass wrote -
no cleancoat, no weathering, no metalness reading mode — and the seventh review's first finding was
precisely that nothing read as a *different physical thing* (AGENTS.md entry 32, ADR-0020). This
pass replaces that with a table of physical identities per surface class, so the deviations from
`legacy/` are no longer per-surface and are worth stating once:

- **A surface now states what it is made of**: family, roughness and how far its relief and its
  painted field move that roughness, metalness *and how it is to be read* (`0` or `>= 0.9`, with a
  `coating` mode whose number is the substrate), environment intensity, and the amplitudes of
  three storytelling scales. The prototype's *colours* are kept; only the response is ours.
- **`dusk` is now a damp night and `dawn` a dry morning.** The default hour the whole lighting pass
  was tuned against (ADR-0013) therefore looks different from the prototype's flat dusk: the road
  is glossier (0.9 → ~0.63 at the preset's 0.45 wetness) and every exposed surface reflects more
  sky, while the morning hour is duller and dustier. The key, the sky, the haze, the exposure and
  the grade are untouched — this is the ground, not the light.
- **The prototype had no `grime`, `roadPatch` or `scorch` material**, and no weathering at all. A
  surface cannot be un-weathered back to the prototype by a setting: the two hours' `{wetness,
  dust}` pairs are the closest thing, and a dry clean hour (`{0, 0}`) restores the authored numbers
  exactly.
- **The prototype's one tiled car, road and terrace are now placed rather than tiled** (edge sand,
  repairs, burn marks, contact grime, a grime band and a drainpipe on walls, a UV window per
  building). Every one of those is additional geometry in the arena, which is presentation: the
  simulation's collision, its props and its golden trace are untouched, and `npm run replay` still
  reports the same 162 samples.
- **A surface's gloss and metalness are authored differently from the prototype's flat materials**
  (ADR-0022, deviation 27). The prototype had no roughness maps at all, so its surfaces shaded at
  exactly the value in the material. This build's maps carried an *absolute* roughness and three
  multiplies the two, so every mapped surface shaded at its own square — car paint 0.34 as 0.12,
  water 0.06 as 0.004 — which means the prototype's numbers and ours were never in the same unit.
  The map is a signed swing now and the material is the value, so the *authored* numbers in
  `SURFACE_SPEC` mean what they say; but a scene compared against the prototype's flat materials
  will still differ wherever a map moved, and that is ours, not a regression. The road's aggregate
  texture is also 1024² over a 3 m tile where the prototype's asphalt was a 128 px tile stretched
  across the whole surface — the density is ours, the colour is closer to the prototype's than the
  0.027-linear version this pass replaced.
- **The occlusion term is calibrated against a flat road, not against a screenshot.** `bias` 0.25 and
  `thickness` 0.12 (ADR-0022) are chosen so the flattest surface in the build reads 95.6% of
  unoccluded, which is a *measurement* the prototype could not have made and this build's ninth
  review demanded. If a comparison against the prototype reads as "less occlusion in the creases",
  that is the trade and it is deliberate: the previous bias darkened a flat plane, and its false
  occlusion was visible as speckle on the road in the report's own frame.
