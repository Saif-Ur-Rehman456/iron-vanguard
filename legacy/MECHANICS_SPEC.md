# MECHANICS_SPEC — extracted from `legacy/callofduty.r128.html`

A behavioural specification of the prototype, written so it can be re-implemented
(which it has been — this is the reference used to build `@iron/sim`) or extended
without re-reading 1,324 lines of 2021-era IIFE. Numbers here are the prototype's;
`legacy/PARITY_NOTES.md` records where the project deviates and why.

## 1. Loop and constants

- Fixed simulation step: **60 Hz**. The prototype used a variable `dt` clamped to
  0.05 s; the port runs a fixed step with an accumulator (max 5 ticks per frame to
  avoid spiral-of-death after a tab suspend).
- Three phases: **menu → playing → (paused | dead | victory)**.
- 900 ms pre-mission delay before wave 1.

## 2. Player

```
walk 6.4 m/s          sprint 10.5 m/s        accel rate 10 (exponential)
ADS: 45% slower, FOV 75 → 42, sensitivity ×0.55, 120 ms transition
sprint-out 220 ms     hurt while sprinting stops the sprint
pitch clamp ±1.45 rad look smoothing 22/s
eye 1.7 m             radius 0.5 m          bounds ±58 (clamped)
regen 16 hp/s, 4.2 s after the last damage
head bob 9/s walking, 13/s sprinting; footstep audio on bob zero-crossings
```

Damage feedback: a directional indicator whose angle is
`atan2(dx, dz) * RAD2DEG - yaw * RAD2DEG + 180`, decaying at 1.4/s.

## 3. Weapon (M4 Vanguard)

| Property | Value |
| --- | --- |
| Magazine / reserve | 30 / 240 starting, 360 max |
| Fire | full auto, 0.098 s between shots |
| Reload | 1.85 s, three audio stages at 0 / 45% / 80% |
| Damage | 34, ×2.1 head, ×0.85 limbs |
| Falloff | full to 45 m, ×0.7 at 90 m |
| Spread (half-angle) | 0.012 hip / 0.0025 ADS, +up to 0.02 movement (×0.35 when aiming), +0.018 per heat, +0.02 sprinting, cap 0.075 |
| Heat | +0.14 per shot, decay 1.1/s |
| Recoil | pitch +0.012 + U(0, 0.006); yaw ±0.0035; both snap `aim` to the new value |
| Hitscan | yes, 300 m trace, ground/geometry/barrel/enemy priority by distance |

Firing is blocked while reloading, while sprinting out, or dead. Empty magazine
triggers a dry-fire cue and an automatic reload.

## 4. Enemies

Common: face the player every tick, see only within 50 m, keep 2.2 m separation
from each other, reposition inside a preferred range band, never stand still
forever.

| | Rifleman | Rusher | Heavy |
| --- | --- | --- | --- |
| Health | 100 | 70 | 260 |
| Speed | 3.2 | 5.4 | 2.1 |
| Preferred range | 10–16 | melee | 12–20 |
| Attack | 3–4 round burst | lunge + melee | 4 round burst |
| Interval in burst | 0.13 s | — | 0.18 s |
| Telegraph | 0.45 s laser | — | 0.45 s |
| Damage | 6–10 | 24 | 10–14 |
| Cooldown between bursts | 0.9–1.7 s | 1.1 s | 1.4–2.2 s |
| Engage range | 26 m | 2.6 m | 30 m |
| Accuracy | 0.42 base | — | 0.40 base |
| Score / drop | 100 / 30% | 120 / 30% | 250 / 30% |

Accuracy model: `clamp(base - 0.008·distance - 0.14·(playerSpeed/10.5), 0.07, 0.5)`.
Damage lands **70 ms** after the shot leaves the barrel. Misses produce visible
impact geometry and a whiz-by cue when they pass within 2.2 m.

Rusher lunge: 0.3 s at 9 m/s toward the player, damage window closes 0.14 s before
the lunge ends, 1.1 s cooldown, screams inside 10 m every 3 s while closing.

## 5. Waves

| Wave | Riflemen | Rushers | Heavies | Subtitle |
| --- | --- | --- | --- | --- |
| 1 | 6 | 0 | 0 | HOSTILES INBOUND — HOLD THE PLAZA |
| 2 | 8 | 2 | 0 | RUSHERS INBOUND |
| 3 | 9 | 3 | 1 | HEAVY UNITS DETECTED |
| 4 | 10 | 4 | 2 | MULTIPLE CONTACTS — ALL GATES |
| 5 | 12 | 5 | 3 | FINAL ASSAULT |

- Spawn order is shuffled; spawns are staggered 0.75 s ± up to 0.4 s of jitter.
- Spawn placement: pick one of four gates at ±60, offset ±2.5 along the wall, then
  place the body at ∓65 on the other axis so it walks in through the gap.
- After a wave: 4.5 s intermission with resupply (+120 reserve, +1 frag, ×difficulty
  multiplier). Total: **65 hostiles**.

## 6. Explosives

Grenade: thrown along the aim direction at 16 m/s with 4.5 m/s of lift, gravity 22,
drag 0.4, bounce 0.35, friction 0.6, 2.1 s fuse, 6-tick arm delay.

Blast: radius 7 (grenade) / 6 (barrel), 150 (grenade) / 130 (barrel) damage to
enemies scaled `damage · (1 − d/radius) + 30`, ×0.8 to the player. Barrels have 30
hp, take 90 damage from a nearby blast, and chain (a chain reaction is queued, so
barrel → barrel propagation is breadth-first with a 32-blast safety cap).

## 7. Map: Al Kadim Plaza

- 120 × 120 m playable (±58 bounds inside ±60 walls), 5 m perimeter walls with a
  ±8 m gap at each of four gates.
- 10 buildings (10–14 m tall, two tagged `damaged` for rubble), a central monument
  (8.5 m, 4.2 m half-extent), 10 barrels, 16 cover props, crates, wrecks, planters,
  kiosks, lamps, cable poles, banners, puddles, tires and a firepit.
- Player spawn (0, 30) facing −Z; extraction zone (0, 56) r6.
- Ambience: fire light at (−21, 1.2, 16.5), 5 smoke columns, dust, 16 skyline blocks,
  50 rocks, fog density 0.0125.
- Two puddles/wreck surfaces are `metal`/`wood` so impact FX and audio differ by
  material — the surface table drives both.

## 8. Scoring and results

Kill points 100 / 120 / 250, +50 for a headshot, combo multiplier for kills within
2.5 s of each other. Results screen: kills, headshots, accuracy, score, elapsed
time, waves cleared, rank. Ranks from score thresholds with an accuracy gate on the
top rank.

## 9. HUD

Canvas-based compass with cardinal letters and objective markers; wave label and
pips; hostiles remaining; score; FPS; killfeed (6 rows, 3.4 s); banner (large/small);
hitmarker (kill variant); damage-direction dial; health bar with integrity label;
ammo counter with a reload bar; grenade pips; objective line; subtitle line; toasts.
Crosshair spread is derived from the same `spreadNow()` value the ballistics use, so
what the reticle shows is what the gun does.

## 10. Audio

Around 20 synthesised cues (no audio files): rifle/enemy fire, reload stages, dry
fire, impacts by surface, footsteps, hurt, pickup, grenade pin/bounce, explosion,
whiz-by, heartbeat below 25 hp, ambient rumble, radio chatter, three stingers.
Each is built from oscillators + noise buffers with per-cue envelopes; the port
keeps the synthesis and adds buses, ducking and 3D panning.

## 11. Known prototype defects (fixed in the port)

This is the list the port's tests were written against — see `PARITY_NOTES.md` §3–§9
for what each fix was:

1. Wave completion waited on corpse removal (4.2 s of dead air per wave).
2. Damage and reload audio used `setTimeout`, so they were unreplayable.
3. Rotated props blocked axis-aligned squares.
4. `Math.random()` everywhere (spawns could shift when FX changed).
5. Barrels were shoot-proof (collider larger than the shootable volume).
6. Headshot multipliers were defined but never applied.
7. Breaking line of sight did not stop a burst.
8. Enemies wedged on cover and stalled waves forever.
9. Enemies crowded into melee range and made telegraphs unreadable.
