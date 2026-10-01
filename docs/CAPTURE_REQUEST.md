# Capture request — Phase 02 lighting evidence

The lighting pass is **static-verified** (typecheck, lint, 94 tests including the lighting
contract, build, budget) but its visual claims need frames from a machine with a GPU
browser. The automated harness for this exists (`npm run shots --probe=lighting`) and is
the preferred path; where Playwright is not viable, this is the manual equivalent, written
so every frame is reproducible rather than a wander around the level.

Two minutes of setup, then eight frames.

## 0. Setup

1. Terminal A: `npm run dev` (Vite on <http://localhost:5173>).
2. Terminal B (optional, but this is the cheapest evidence of all):
   ```bash
   curl -s http://localhost:5173/ >/dev/null && echo "dev server up"
   ```
3. Open **Chrome**, then <http://localhost:5173/?autostart=1&lock=off&seed=7>
   - `autostart=1` skips the menu and starts mission 1 immediately.
   - `lock=off` disables pointer-lock capture, which is what makes the browser console
     usable for the pose commands below.
4. Open DevTools → Console **once** and run:
   ```js
   window.__IV__.setQuality('high');
   window.__IV__.freeze(true);      // the simulation stops; the renderer keeps drawing
   window.__IV__.freezeFx(true);    // particles/casings/ash hold still: comparisons are clean
   ```
   `freeze(true)` is what makes these frames comparable between captures and to the probe,
   and it stops a hostile walking out of frame mid-screenshot. `freeze(false)` when you want
   to play again (frames 6).
5. Save everything to **`.captures/phase02/`** (create the folder), with the **exact file
   names below** — the review reads them by name.

Controls, for the parts you play by hand: `W A S D` move, `Shift` sprint, mouse look,
**left mouse** fire, **right mouse** aim down sights, `R` reload, `G` grenade, `Esc` pause.

**Frame 0 (do this first, it is 5 seconds).** In the console:
```js
copy(JSON.stringify(window.__IV__.renderDebug(), null, 2));
```
then paste into `.captures/phase02/phase02-00-renderdebug.json`.
*Demonstrates:* the rig that actually shipped — key intensity/colour/elevation, ambient
colour split, lamp count and one lamp's real intensity and range, window pool size, muzzle
peak/range, bloom threshold, fog colour and density, and the composer pass list. If a
number here disagrees with `docs/ART_BIBLE.md`, the doc is wrong and I need to know.

---

## 1. `phase02-01-lamp-pool.png` — the lamp lights its own pavement

Console:
```js
window.__IV__.pose(19.67, 9.07, 0.785, -0.119);
```
(Standing 10 m from the street lamp at `(12, 2)`, looking at the ground under its head.)

*Demonstrates:* a warm pool of light on the pavement directly under the lamp, getting
darker with distance; the lamp lens bright but **not** a flat white disc; the surrounding
ground still cool/moonlit. This is the shot the review said was missing ("lamps are objects,
not light sources").

## 2. `phase02-02-lamp-off.png` — the same frame with the lamps off

Same pose, console:
```js
window.__IV__.setLighting('lamps', false);
```
screenshot, then `window.__IV__.setLighting('lamps', true);` to restore.

*Demonstrates:* the difference between 1 and 2 **is** the lamp. The pavement in frame 2
should look moonlight-flat; in frame 1 it has a hot middle and a soft edge. Keep both.

## 3. `phase02-03-car-contact.png` — the car sits on the ground

Console:
```js
window.__IV__.pose(8.32, 4.78, -2.575, -0.217);
```
(Low angle on the wreck at `(11, 9)`, looking along the tarmac at its tyres.)

*Demonstrates:* tyres meeting the road with contact darkening under the body, the cast
shadow falling the same way as every other shadow, and the car's **form** readable from the
key light (one flank lit, one dark) rather than from an outline. If the car looks pasted on,
this frame is the failure and I need it.

## 4. `phase02-04-npc-contact.png` — a body meets the ground

Console:
```js
window.__IV__.spawn('rifleman', 7);
const e = window.__IV__.enemies().at(-1);
const px = e.x - 0.5369 * 4.5, pz = e.z - 0.8437 * 4.5;
window.__IV__.pose(px, pz, Math.atan2(-(e.x - px), -(e.z - pz)), -0.15);
```
*Demonstrates:* boots contacting the ground, a subtle contact darkening and the body
shadow; the hostile reads against the background without a health bar (bars only appear once
damaged) and is not a silhouette lost in shadow.

## 5. `phase02-05-weapon-dark.png` (and `-05b`) — darks keep their detail

Console:
```js
window.__IV__.pose(-6, 22, 2.9, -0.08);   // a darker corner of the plaza
```
Hold **right mouse** for ADS, then screenshot. Then, at the same pose:
```js
window.__IV__.setLighting('key', false);
window.__IV__.setLighting('reflections', false);
```
screenshot as `phase02-05b-weapon-no-fill.png`, then restore both to `true`.

*Demonstrates:* in `05`, the black polymer and gunmetal of the weapon keep edge highlights
and surface variation — dark, but not a black blob. In `05b` (key + reflected sky off) the
same areas go flat and dead. The pair proves the fill is doing something *without* turning
black into grey.

## 6. `phase02-06-muzzle-flash.png` — the flash is a source, not a blob

Console:
```js
window.__IV__.freeze(false);
window.__IV__.giveAmmo(300);
```
Then hold **left mouse** and capture several frames during a burst (or fire in short bursts
and capture during a burst). Pick the one with the flash lit and keep it as
`phase02-06-muzzle-flash.png`.

*Demonstrates:* the muzzle flash lighting the weapon's own handguard and the ground in front
of the player, with the flash centre bright but not clipped into a featureless white disc,
and no haze left over a frame later. Also worth a second copy 3–4 frames after the shot as
`phase02-06b-muzzle-freeze-frame.png` to show the light gone: the flash is ~40 ms and
**nothing** should stay lit.

## 7. `phase02-07-window-wall.png` — a lit window warms its own wall

Console:
```js
window.__IV__.freeze(true);
const w = window.__IV__.renderDebug().lighting.windows.nearest;
const L = Math.hypot(w.x, w.z) || 1;
const inx = -w.x / L, inz = -w.z / L;
const fx = w.x + inx * 5, fz = w.z + inz * 5;
window.__IV__.pose(fx, fz, Math.atan2(-(w.x - fx), -(w.z - fz)), -0.05);
```
*Demonstrates:* the wall and ground beside the lit window carrying a faint warm response,
some windows lit and some dark (only 2 in 3 are), and the distant windows emissive without
lighting the map. This is "window lighting affects the environment" at the scale it can
actually be seen.

## 8. `phase02-08-plaza-wide.png` — the whole rig in one frame

Console:
```js
window.__IV__.pose(0, 34, 0, 0.0425);
window.__IV__.freezeFx(false);   // let the ash, fire and smoke move: this is the mood shot
```
*Demonstrates:* cool moonlight across the plaza with warm lamp pools and the firepit inside
it, foreground crisp and background atmospheric (the haze doing the depth), darks that still
carry detail, and no single brown wash. If the frame reads as one brightness band, this
frame is the failure.

---

## 9. Optional, if you have it in you: the probe numbers

If Playwright is viable on your machine after all, this replaces frames 1–8 with hard
numbers plus images in one run:

```bash
npm run shots -- --probe=lighting
```

It prints, per lighting group, the relative darkening and the colour warmth at fixed world
points and checks them against the targets in `docs/QUALITY_BAR.md`. Paste the console table
into `.captures/phase02/phase02-09-probe.txt`. **Not** required, and not run automatically
by CI — it needs a GPU browser and a dev server.

## What I will do with the frames

Compare 1 vs 2 (lamps), 5 vs 5b (fill), and 8 (the whole rig) against the values in
`docs/ART_BIBLE.md`, then fix the rig rather than the description. Frame 0 tells me whether
the shipped configuration is what the docs claim; frames 3, 4, 6 and 7 are the four asks
(contact, dark detail, controlled emitters, local window light) that a screenshot can settle
faster than an argument.

---

# Capture request — Phase 03 rigs and presets

Same setup as above (`npm run dev`, `?autostart=1&lock=off&seed=7`, DevTools console,
`freeze(true)` + `freezeFx(true)`, save to **`.captures/phase03/`**). The rigs are
static-verified (typecheck, lint, 141 tests including the rig and preset contracts, both
builds, the budget) but every claim below is about what a person *sees*, so these are the
asks.

## 3.0 `phase03-00-renderdebug.json` — the shipped configuration

```js
copy(JSON.stringify(window.__IV__.renderDebug(), null, 2));
copy(JSON.stringify(window.__IV__.weapon(), null, 2));
```
Paste both into one file. *Demonstrates:* the tier's real numbers (lighting, AO, shadows,
bloom, resolution scale) and the weapon as built — id, receiver length, overall length, the
tile size of each surface, and the world-space joints. If a number here disagrees with
`docs/ART_BIBLE.md`, the doc is wrong.

## 3.1 `phase03-01-weapon-hip.png` and `phase03-02-weapon-ads.png`

```js
window.__IV__.pose({ yaw: 0.6 });
window.__IV__.weaponPose({ adsT: 0, sprintK: 0, reloadProgress: 0 });
// ...screenshot...
window.__IV__.weaponPose({ adsT: 1, sprintK: 0, reloadProgress: 0 });
// ...screenshot...
```
*Demonstrates:* a carbine at 21 cm of receiver with the muzzle ~0.74 m from the eye and the
sight line *on* the crosshair, both hands on the weapon, and — the thing no test can see —
whether the arms read as arms rather than as slabs. If the gun looks like it is floating in
front of the camera in 3.1, the hip solve is wrong and I need to know.

## 3.3 `phase03-03-weapon-reload.png` — mid-reload

```js
window.__IV__.weaponPose({ adsT: 0.4, reloadProgress: 0.45, sprintK: 0 });
```
*Demonstrates:* the magazine out of the well, the support hand on it, the weapon dipped.

## 3.4 `phase03-04-weapon-flash.png` — a shot, frozen

```js
window.__IV__.weaponPose(null);
window.__IV__.freeze(false);
// fire one round with the left mouse button, then immediately:
window.__IV__.freeze(true);
```
*Demonstrates:* the flash depth-tested (it must not draw through the wall or the fence in
front of the muzzle), the cone inside the sprite, and the weapon lit by its own flash.

## 3.5 `phase03-05-soldier-front.png` and `phase03-06-soldier-aiming.png`

```js
window.__IV__.spawn('rifleman', 1);
window.__IV__.pose({ yaw: 0.0 });   // look at a hostile 8 m away, eye level
```
Let it walk up, then wait for its aim telegraph (`mode: 'aim'`, the laser on) and shoot in
both states.
*Demonstrates:* whether the hostile reads as a soldier at 8 m — the face and goggles toward
you, the pack on the far side, the vest and pouches on the near side, both hands on the
weapon, the muzzle coming up to point at you when it aims, and enough value separation that
its jacket, carrier, pouches and helmet are four different greys rather than one black
shape. If it is still a cut-out, the palette ladder needs to go higher.

## 3.7 `phase03-07-squad.png` — three of them, low light

```js
window.__IV__.spawn('rifleman', 2);
window.__IV__.spawn('heavy', 1);
```
*Demonstrates:* whether a squad reads as figures with rim light rather than silhouettes,
and whether the three archetypes are distinguishable by value and colour.

## 3.8 `phase03-08-preset-low.png` / `3.9 phase03-09-preset-high.png` — the same frame twice

```js
window.__IV__.setQuality('low');
window.__IV__.freeze(true);
```
Then again with `'high'`, from the same pose, and put them side by side.
*Demonstrates:* the whole of ADR-0014. The two frames must differ in **sharpness and shadow
resolution only** — same brightness, same contrast, same colours, same dust, same shadows
present. If one is obviously darker, flatter or hazier, a tier is still changing the look
and the invariant test is not catching something.

## 3.10 `phase03-10-floor.png` and `3.11 phase03-11-crate.png` — density

Look at the paving under your feet (aim at the ground 2 m ahead) and at a crate at 1 m.
*Demonstrates:* the floor at 5.1 mm per texel instead of 97 mm, and a crate whose texture
is wood grain rather than noise. If the paving reads as flat paint, the tile size in
`UV_DENSITY` is too large.

## 3.12 `phase03-12-rocks-cables.png` — the world's floating objects

Find a rock cluster on the edge of the plaza and a run of poles, and frame both.
*Demonstrates:* rocks sitting *in* the ground rather than on it, no cable passing through
the monument, banners hanging from a bracket rather than from the air, and puddles that are
irregular and reflect something instead of being black discs.

## What I will do with these

Frames 3.8/3.9 are the honest test of the preset fix: if they match in look, ADR-0014 is
done. 3.1 and 3.5 are the two rigs — the ones where "a test says the arm reaches the hand"
and "a person says it looks like a man holding a rifle" can still disagree, and where I
would rather be told than assume. 3.10–3.12 are the density and the seated objects, both of
which are visible in one glance and invisible in every automated check.

---

# Phase 04 — lag, blur, hands, the three weapons and the two times of day

Everything here is a claim this repository cannot check by itself: the frame rate is the
reporter's machine, the softness is the reporter's eyes, and the two things I am least
able to verify without pixels are the hands and the AK. All four frames use
`window.__IV__.freeze(true)` and `freezeFx(true)`, and save to **`.captures/phase04/`**.

## 4.0 `phase04-00-renderdebug.json` — what the pipeline is actually running

```js
JSON.stringify({
  render: window.__IV__.renderDebug(),
  info: window.__IV__.renderer(),
  timeOfDay: window.__IV__.timeOfDay(),
  state: window.__IV__.state(),
}, null, 2);
```
*Demonstrates:* since ADR-0017 there is no `SharpenShader` pass — the upscale
compensation is a uniform of the look pass — so the chain should read
`RenderPass, UnrealBloomPass, OutputPass, LookShader, FXAAPass` at `low` (4 whole-buffer
passes) and `RenderPass, AoPass, UnrealBloomPass, OutputPass, LookShader, SMAAPass` at
`high`/`cinematic` (6). `fullResPasses` should be **4** or **6**, `resolutionMode` should
be `native`, `resolutionScale` **1**, and `sharpen` **false**. This file is the receipt for
the pass budget; a longer `passes` array than the table in `docs/PERF_BUDGET.md` means the
budget was spent again.

## 4.1 The frame rate, at the tier you play on

Stand still, then fight a wave, then throw a grenade into the car, and watch the FPS
readout (or `window.__IV__.renderer().fps`) through all three. Then do it again one tier
*up* and one tier *down*.*Demonstrates:* whether the lag is gone. In the shipped mode (`native`) `resolutionScale`
must sit at **1** and never move: the picture cannot get softer to buy frames, so if the
counter is still short of 60 the answer is the next effect down, not a resolution cut
(§4.1 in `docs/PERF_BUDGET.md` lists the order). The three numbers that decide it are
`fps`, `frameMs` and `drawCalls`, one tier apart. If you would rather have the frames than
the pixels, the RESOLUTION row in SETTINGS switches to DYNAMIC — and *then* watching
`resolutionScale` fall and the frame rate rise is the point.

## 4.2 `phase04-01-wall.png` — a facade at arm's length

Walk up to a *building* (not a compound wall) and aim at the plaster about 1.5 m away,
with a lit and an unlit window in frame.
*Demonstrates:* the two changes of ADR-0017 that this frame exists for. **Density:** the
facade map went from 256² over 2.5 m (9.8 mm per texel) to 512² over 1.2 m (2.3 mm per
texel), so a 10 cm feature on the wall should now be ~40 texels instead of ~10 — masonry,
formwork and spalling, not a light-and-dark mottle. **Structure:** the storey slab line is
*geometry* now (a 0.22 m band on every storey), so it is the same thickness on every
building and it casts and catches a shadow; windows are recesses with a sill, a reveal and a
pane. If the wall is still "noise", say so with the distance you were standing at — the
density contract is `UV_PIXELS / UV_DENSITY` and it is a number I can raise.

## 4.3 `phase04-02-plaza.png` — the ground, near and far

Stand at one end of the plaza and look along it, then aim at the paving 2 m in front.
*Demonstrates:* the floor at a real flag size (65 cm) with the joints legible at distance
instead of a speckle carpet, and no shimmer while walking.

## 4.4 `phase04-03-weapon-hip.png` / `4.5 phase04-04-weapon-ads.png` — the hands

```js
window.__IV__.weaponPose(0);   // hip
window.__IV__.weaponPose(1);   // ADS
```
*Demonstrates:* whether a **man** is holding the weapon. Both **gloves**, both **sleeves**
and both **arms** should be visible and lit — if the frame is still a floating gun against a
dark background, the view-model light is not doing its job and the answer is a brighter
fill, not a bigger model. This is the frame the review was about.

## 4.6 `phase04-05-deagle.png`, `4.7 phase04-06-m4.png`, `4.8 phase04-07-ak47.png` — the loadout

```js
window.__IV__.equip(1); window.__IV__.renderDebug();   // Desert Eagle
window.__IV__.equip(2);                                // M4
window.__IV__.equip(3);                                // AK-47
```
Then, in gameplay, press **1 / 2 / 3** and watch the weapon swap: the ammo in the magazine
is the *weapon's* (a pistol has 7 + 21, not 30 + 240), the HUD line changes, and firing is
locked out for the weapon's equip time.
*Demonstrates:* three weapons that are three guns. The pistol should read as a pistol
(slide, serrations, iron sights, no stock) and the AK as an AK (gas block and tube **above**
the barrel, wooden furniture, a rocking magazine, a slanted brake). If the AK looks like the
M4 with different colours, the archetype is not being applied.

## 4.9 `phase04-08-dawn.png` / `4.10 phase04-09-dusk.png` — the same pose, two scenes

Pick the time of day on the deploy screen (or `window.__IV__.setTimeOfDay('dawn')`), then
`window.__IV__.setTimeOfDay('dusk')` from the same pose.
*Demonstrates:* the two atmospheres the review asked for. Morning: a high warm sun, blue
sky, **no star field, no lamp pools, dark window glass**, long thin shadows. Dusk: the
moon, the lamps and the lit windows, stars, cool haze. If the morning is the night frame
with a blue fog, the key's direction is not being applied.

## What I will do with these

4.1 is the one the review was written about and it is the one I cannot test: if the frame
rate is still short of 60 with `resolutionScale` at 1, the honest answer is a further 20-30%
out of the post chain (bloom's radius down, the draw-call model in `docs/PERF_BUDGET.md`)
— not another resolution cut. 4.2 and 4.4 are the two "does it look like the thing"
questions — a wall at arm's length and a man holding a gun — and both are one glance. 4.6 is
the feature: three weapons that behave like three weapons.

---

# Phase 05 — "still laggy and blurry": the pixel count, the density and the haze

Phase 04 asked for the same things again and got the same answer, which is itself the
finding: the *pipeline* was leaving softness and milliseconds on the table that no amount of
retuning the tier ladder could recover. ADR-0017 changed three things that only a frame can
confirm, and all of them are visible in the *existing* Phase 04 frames. Re-run **4.0, 4.1,
4.2, 4.3, 4.4** and save them to **`.captures/phase05/`**; there is no new pose to set.

## 5.0 `phase05-00-renderdebug.json` — the pixel count is not a setting any more

```js
const r = window.__IV__.renderDebug();
({
  pixelRatio: r.pixelRatio,                       // must be window.devicePixelRatio (or 2, capped)
  drawingBuffer: r.drawingBuffer,                 // must be innerWidth x innerHeight x pixelRatio
  resolutionMode: r.resolutionMode,               // 'native'
  resolutionScale: r.resolutionScale,             // 1
  fullResPasses: r.fullResPasses,                 // 4 at low/medium, 6 at high/cinematic
  passes: r.passes,                               // no 'SharpenShader'
  sharpen: r.sharpen,                             // false
});
```
*Demonstrates:* the single most likely cause of "dhundla at every graphics level" is now
measurable in one object. **`drawingBuffer` must equal your window's CSS size times
`pixelRatio` and that ratio must equal `devicePixelRatio`** — if it is smaller, something is
still undersampling the display, and no other change in this phase matters until that is
fixed. Compare it across all four tiers: it must be identical at every one.

## 5.1 The tier ladder, as a picture rather than as a number

Set GRAPHICS to LOW, then CINEMATIC, without moving or changing the pose.
*Demonstrates:* LOW is the **sharpest** frame in the build now (it is native, and it has no
AO to soften a contact edge). What it changes is grounding — no shadow across the plaza, no
occlusion under a barrel — and that is what a lower tier should cost. If CINEMATIC looks
*sharper* than LOW, the pixel count is still being scaled somewhere and 5.0 will say where.

## 5.2 The haze, in the same frame as the distance

Stand at one end of the plaza and look at the far buildings (this is Phase 04's 4.2/4.3
pose), morning and dusk.
*Demonstrates:* ADR-0017 item 7. `LOOK.fogDensityScale` came down 27% and the dusk fog colour
is `0x39404f` rather than `0x4b5567`. The far buildings should read as **dark silhouettes
losing contrast**, not as the brightest thing in the frame. The fog colour is a single
number (`timeOfDay.ts`) and the density another (`post/look.ts`), so "still too milky" or
"now too flat" are both one-line changes — say which, and at what distance.

## 5.3 "Absolutely 100% verify that it is fixed"

This repository cannot verify its own frame rate or its own softness; what it *can* do is
put a number on every claim and check it in CI, which is what the following already do:

| Claim | Checked by | Runs where |
| --- | --- | --- |
| every tier renders at the display's pixel count | `tests/unit/quality.test.ts` (`pixelRatioCap >= 2`) | `npm test` |
| the frame's pass count per tier | `tests/unit/quality.test.ts` (`fullResPasses` 4/4/6/6) | `npm test` |
| the tier ladder's effects, as one table | `tests/unit/quality.test.ts` (EXPECTED) | `npm test` |
| no world surface below its density floor | `tests/unit/texel.test.ts` (`UV_PIXELS / UV_DENSITY`) | `npm test` |
| a wall denser than 2.5 mm per texel | `tests/unit/texel.test.ts` | `npm test` |
| the weapon denser than everything in the world | `tests/unit/texel.test.ts` | `npm test` |
| the two atmospheres are two pictures | `tests/unit/timeOfDay.test.ts` | `npm test` |
| the three-weapon loadout and the swap rules | `tests/unit/loadout.test.ts` | `npm test` |
| the simulation is unchanged by any of it | `tests/golden/replay.test.ts` | `npm test` |
| the product still builds and fits the budget | `npm run verify` | CI |

The three that cannot be a test are in this file: **frame rate** (5.1), **sharpness as
your eyes see it** (5.0 and 5.2), and **whether the hands and the AK look like a man
holding an AK** (Phase 04, 4.4 and 4.6).

---

# Phase 06 — the sight picture, the two weapons, the walk and the stance

Six asks, and the repository can answer three of them with a ray and a test (ADR-0018). What
is left is exactly the part a test cannot see: whether the optic *frames* the world the way a
real one does, whether a pistol reads as a pistol in the hand, and whether a walk reads as a
walk. Same setup as Phase 05 (`npm run dev`, `?autostart=1&lock=off&seed=7`, DevTools console),
save to **`.captures/phase06/`**.

## 6.0 `phase06-00-renderdebug.json` — what is on the sight line

```js
JSON.stringify({
  render: window.__IV__.renderDebug(),
  weapon: window.__IV__.weapon(),
  state: window.__IV__.state(),
}, null, 2);
```
*Demonstrates:* the shipped layout for the weapon in hand — archetype, receiver and overall
length, `eyeRelief`, the optic anchor's height, the part count — next to the pose the ADS solve
produces. If `weapon().layout.archetype` says `carbine` for a Desert Eagle, the archetype
switch is not reaching the build and nothing below matters.

## 6.1 `phase06-01-ads-m4.png` — **the frame the review was about**

```js
window.__IV__.equip(2);                 // M4
window.__IV__.freeze(true);
window.__IV__.pose({ yaw: 0.35 });      // anything with a lit wall ~15 m out
window.__IV__.weaponPose(1);            // ADS
```
*Demonstrates:* **the world through the optic.** A clear circular aperture with the tube's own
inner wall around it, a red dot at the centre, nothing black and nothing standing in the
middle. If the frame is still an opaque ellipse, the one thing I need is this file and the
value of `weapon().layout.parts.length` from 6.0. This is the single frame the whole pass
exists for.

## 6.2 `phase06-02-deagle.png`, `6.3 phase06-03-deagle-ads.png` — the pistol

```js
window.__IV__.equip(1);
window.__IV__.weaponPose(0);   // then 1 for ADS
```
*Demonstrates:* whether a **pistol** is in the player's hands and in frame. A slide with front
and rear serrations, an ejection port, a trigger and guard, a raked grip with panels and a
magazine inside it, and a **rear notch** you can see the front post through (not a full-width
blade across the aim point). The hip hold should sit at chest height, inboard — the shipped
one was 0.17 m right and 0.31 m down on a 75° camera, i.e. the whole weapon below the bottom
of the frame, which is what "the pistol is tiny and incomplete and has no hands" was.

## 6.4 `phase06-04-ak47.png` — the AK-47

```js
window.__IV__.equip(3);
window.__IV__.weaponPose(0);
```
*Demonstrates:* a rifle that is not the M4 in different colours: a gas tube and gas block
**above** the barrel and visible over the handguard, walnut handguard and stock, a magazine
that rocks forward, a right-side bolt handle, a slanted brake, and **iron sights** — a leaf at
the receiver's front and a post on the gas block, with the sight line 5 cm over the bore rather
than a red dot's 3 cm. If it reads as an M4 with wood-coloured parts, the archetype is not
reaching the part set.

## 6.5 `phase06-05-walk.png` — the walk

```js
window.__IV__.spawn('rifleman', 1);
window.__IV__.freeze(false);
window.__IV__.giveAmmo(0);              // let it walk without shooting back
```
Stand 15–20 m away, side-on, and capture **a sheet of 4–6 frames across one stride** (or
record it).
*Demonstrates:* a walk rather than a skate. The planted foot on the ground and not in it, the
swing foot visibly lifting and the knee bending to lift it, a heel strike and a toe-off, the
hips rising and falling twice per stride, and the arms swinging opposite the legs. All of that
is asserted as numbers in `tests/unit/gait.test.ts`; what only you can judge is whether it
*reads* as a man walking, so the useful answer is "still looks like a glide at speed X".

## 6.6 `phase06-06-sprint.png` / `6.7 phase06-07-crouch.png` / `6.8 phase06-08-jump.png`

Play these by hand, no console needed:

- **Shift + W** for a run: the weapon comes in across the chest, the muzzle drops and swings
  left, the bob gets faster and larger, the FOV punches (7°, parity). Holding **left mouse**
  while sprinting should *not* look like running while aiming.
- **C** held: the camera drops, the weapon drops and shifts inboard, and movement slows.
- **Space**: a take-off, an air hold and a landing dip — **blended**, not snapped. A jump is
  0.46 s, so a frame from the middle is the one that proves it.

*Demonstrates:* the three controls the report asked for, as *feel*. The two things a test can
tell you are already asserted (a jump leaves the ground and lands at exactly zero; a crouch
changes the eye height the simulation resolves), so what is wanted here is whether they look
robotic — a snap at take-off or landing is the failure mode to name.

## 6.9 LOW, played as a game (the standing ask)

Set **GRAPHICS = LOW**, `RESOLUTION = NATIVE`, and play a full wave. Then `CINEMATIC` on the
same wave.
*Demonstrates:* the whole request in one session — *ultra smooth at every graphics level*
without the picture going soft. LOW must be sharp (see 5.0/5.1: same pixel count as every
other tier) and short of shadows and AO; CINEMATIC must be the same picture with more
grounding, not a darker or hazier one. If LOW is still not smooth, the answer is the next
effect down (the order is §4.1 in `docs/PERF_BUDGET.md`) and never a resolution cut, and the
numbers that say which are `renderer().fps`, `frameMs` and `drawCalls`, one tier apart.

## What is already a test, so you do not have to look

| Claim | Checked by | Runs where |
| --- | --- | --- |
| nothing opaque stands on the sight line, every weapon | `tests/unit/sightPicture.test.ts` (rays) | `npm test` |
| the sight line is on the camera axis at ADS | `layoutProblems` → `sight_line_off_axis` | `npm test` |
| a pistol is pistol-sized and a rifle rifle-sized | `layoutProblems` (per-archetype range) | `npm test` |
| both hands reach the weapon in every pose | `layouts`/`uniform` → `armReaches` at 0/0.5/1 | `npm test` |
| the lens and dot materials let light through | `tests/unit/weaponMaterials.test.ts` | `npm test` |
| a jump leaves the ground and lands at zero | `tests/unit/stance.test.ts` | `npm test` |
| the stance does not move the golden trace | `npm run replay` (162 samples) | CI |
| the planted foot is on the ground; no foot goes through it | `tests/unit/gait.test.ts` | `npm test` |
| the swing foot clears, the knee only flexes | `tests/unit/gait.test.ts` | `npm test` |

The three that cannot be a test are 6.1 (**does the optic frame the world**), 6.2/6.4 (**does
the weapon read as the weapon**) and 6.5 (**does the walk read as a walk**) — which is the
whole list in this file.

---

# Phase 07 — "the weapon is glowing and the optic is an object": controlled light, a real sight

Phase 07 exists because Phase 06's frames came back and two of them were measurements rather
than opinions: a weapon whose highlights clipped and then bloomed across the whole scene, and an
optic that was 39% of the frame's height with a grey wash inside it (ADR-0019). Both fixes are
arithmetic and both are now asserted without a GPU — but *controlled* and *useful* are
judgements, so:

Same setup as Phase 05/06 (`npm run dev`, `?autostart=1&lock=off&seed=7`, DevTools console),
save to **`.captures/phase07/`**. `freeze(true)` + `freezeFx(true)` for every frame except 7.4.

## 7.0 `phase07-00-renderdebug.json` — the numbers this pass moved

```js
const r = window.__IV__.renderDebug();
({
  bloom: r.lighting.bloom,              // must be 0.42 / 1.0 / 0.36
  muzzle: r.lighting.muzzle,            // peak must be 26, range 11
  weapon: window.__IV__.weapon(),       // archetype, eyeRelief, part count
});
```
*Demonstrates:* the three numbers that decide whether a highlight stays on its surface.
`lighting.bloom` at **strength 0.42, threshold 1.0, radius 0.36** and `lighting.muzzle.peak` at
**26** — if they are the old 0.55 / 0.9 / 0.5 and 60, the build in front of you is not the one
this phase is about.

## 7.1 `phase07-01-hip.png` — the frame that was glowing

Stand in the plaza at night with the M4 up (report frame one: `25/240`, a building on the left
and the wreck on the right). Fire a short burst, let it settle, capture.
*Demonstrates:* **lit, not glowing.** The receiver, the rail and the optic each want a highlight
and a *shape*; there must be no white ball on the optic and no white streaks along the rail, and
nothing on the weapon may light the pavement around it. The scene behind must be exactly as
bright as it was before this pass — that is the whole point of fixing the light rather than the
exposure.

## 7.2 `phase07-02-ads.png` — the sight picture (the report's second frame)

```js
window.__IV__.freeze(true);
window.__IV__.pose({ yaw: 0.35 });
window.__IV__.weaponPose(1);
```
*Demonstrates:* an optic that is a **sight**. The housing should be about a quarter of the
frame's height (it was 39%) with a thin rim; the world inside the glass should be *the world* —
paving joints, a building, a hostile at range — rather than a grey disc; and the weapon should
read as carried rather than worn. If the glass is still milky, the lens is the number to check:
two lenses at 0.06 opacity transmit 88% of the light.

## 7.3 `phase07-03-reticle-dark.png` / `7.3b phase07-03b-reticle-bright.png` — the reticle on both backgrounds

Same pose, aimed at a **dark** wall for one and at the **pale pavement** ~15 m out for the
other.
*Demonstrates:* the dot is a *mark*, not light. A 2.4 mm dot inside a 5.2 mm ring, **centred on
the screen centre**, 27 px across at 1080p against the ~50 px pink blob it replaces. It must be
legible on both backgrounds (the ring is there for the pale one), it must have no glow or halo,
and its centre must be the point of aim rather than near it.

## 7.4 `phase07-04-burst.png` — sustained fire with the optic up

```js
window.__IV__.freeze(false);
window.__IV__.giveAmmo(300);
```
Hold **left mouse** for a full magazine at ADS and capture several frames *during* the burst.
*Demonstrates:* the sight picture survives the burst. The flash must read *beyond* the optic (it
is additive and depth-tested; the optic is opaque and nearer), the target area must stay
legible, and the reticle must stay approximately on the point of aim — at ADS the weapon's drift
scales to a third, so the dot should wobble by pixels rather than by degrees.

## 7.5 `phase07-05-lamp.png` — the weapon beside a lamp it did not make

Walk under a street lamp and aim at it, so the weapon is lit by the lamp *and* by its own light.
*Demonstrates:* two requirements at once. The weapon must still respond to the world (a
controlled highlight, not a dark one), and the lamp's pool must still be local — a pool with an
edge rather than a wash over the block behind it.

## 7.6 `phase07-06-low.png` / `7.6b phase07-06b-cinematic.png` — the look is not a tier

The same pose as 7.2 at GRAPHICS **LOW**, then **CINEMATIC**.
*Demonstrates:* bloom, the weapon's surfaces and the optic are identical at both settings — a
tier buys AO, shadows, sample counts and SMAA-versus-FXAA, never the look (ADR-0014, ADR-0017).
If LOW is hazier, darker or flatter in this frame, a tier is still changing the picture.

## What I will do with these (phase 07)

7.1 and 7.2 are the two frames the review was written about, and each is now one number (the
view light at 17→7 lux; the eye relief at 12→17 cm). If they are still wrong, those are the two
numbers to argue with rather than the art direction. 7.3 and 7.4 are the two things an aiming
system has to survive and a ray cannot judge: a mark that reads against any background, and a
burst that does not blind its own shooter. 7.5 is the requirement that is easy to lose: the fix
must not have made the weapon stop responding to the world.

# Phase 08 — the surface pass: "materials all answer the same light"

The seventh review was eighteen items about materials — the car, the road, the sand, the
concrete, the dirt, the scale, the distance — and every one of them resolved to the same cause:
what a surface *is* lived in three places at once, so nothing was a different physical thing
(ADR-0020). The fix is one table of physical identities, three named scales per recipe, and
weathering that belongs to the atmosphere. All of that is asserted without a GPU in
`tests/unit/surfaces.test.ts` — so what is left is the half a table cannot answer: **do the
surfaces now read as different substances?**

Same setup as Phase 05–07 (`npm run dev`, `?autostart=1&lock=off&seed=7`, DevTools console),
save to **`.captures/phase08/`**. `freeze(true)` + `freezeFx(true)` for every frame.

## 8.0 `phase08-00-materials.json` — the live numbers

```js
const m = window.__IV__.materials();
({
  weather: m.weather,                 // dawn 0.5 dust / 0.1 wetness · dusk 0.45 wetness / 0.12 dust
  road: m.live.road,                  // DUSK: roughness ≈ 0.63 (was 0.9)
  sand: m.live.sand,                  // DUSK: roughness ≈ 0.69 (was 1.0)
  carPaint: m.live.carPaint,          // roughness 0.34, metalness 1, env 1.3
  steel: m.live.steel,
  tire: m.live.tire, tireSidewall: m.live.tireSidewall,
})
```
*Demonstrates:* the weather is on. In `dusk` the road's roughness must be **below its authored
0.9** (a damp night) and in `dawn` at **or above it** (settled dust); `tire` and `tireSidewall`
must differ; nothing unlit (a lamp lens) may appear in `live` at all. If every `roughness` equals
its authored value, the weather is not being applied — `renderDebug().materials` is read from the
*materials*, so this frame cannot be faked by the table.

## 8.1 `phase08-01-road.png` — the road, because it was "a generic textured plane"

Stand on the plaza looking down the road corridor at a low angle, about 20 m of asphalt in frame.
*Demonstrates:* **a road with a history.** The tiling must not be countable: there should be **sand
banked along both kerbs** (where the road meets the ground — the transition the report asked for),
**darker and smoother repair patches**, **burn marks**, and a wear pattern that changes as you look
down it. What it must not be is one 8 × 124 m plane with the same nine metres of texture at the
same angle, fifty times.

## 8.2 `phase08-02-walls.png` — a terrace of buildings from ~30 m

Stand back so three or four buildings are in one frame, and capture.
*Demonstrates:* **repetition broken without a new texture.** The three facade maps are shared, so the
walls must not line up into a pattern: each shell samples its own window onto the map, and each
building has a **darker band at its foot** and, on some, a **drainpipe** down a corner. If the
windows and the plaster still form a grid across the whole terrace, the offset is not being
applied.

## 8.3 `phase08-03-car.png` — the wreck, up close, from outside

Walk to the wreck and frame it so the body, the greenhouse and a wheel are all visible.
*Demonstrates:* the three things the report named by name. **The body is painted, not noisy** — a
coat over a coat, so there is a reflection that survives the dust and *panels and scuffs rather
than grain*. **The glazing is glass** — you should be able to see the **seats, the bench and the
dashboard** through it, and the pillars should be proud of the panes; a flat cyan panel is the
defect. **The tyre is three surfaces** — tread, sidewall and rim — with **road grime inside the
arch** and a **darker band along the rocker panel**.

## 8.4 `phase08-04-dirt.png` — where the dirt is

One frame each (or one frame if it fits): a wall's base, a car's wheel arch, and the kerb line.
*Demonstrates:* **dirt as an environmental event rather than a texture layer.** Grime should appear
where something meets the ground or throws spray — not evenly distributed over every surface. This
is the report's item 13, and the way to fail it is a uniform film everywhere.

## 8.5 `phase08-05-dawn-vs-dusk.png` / `8.5b phase08-05b-dawn.png` — the same place, two hours

```js
window.__IV__.setTimeOfDay('dusk');   // capture, then:
window.__IV__.setTimeOfDay('dawn');   // capture from the same pose
```
Use `__IV__.pose()` for both so it really is the same pose, and stand where the road and some sand
are both visible.
*Demonstrates:* **two worlds, not two skies.** At dusk the ground holds a lamp's reflection and the
road reads damp; at dawn the same surfaces are duller and dustier, and the key is hard. The
material differences must survive the lighting change (a wet road at dawn would mean the weather is
a lighting trick). Keep the frames side by side: if the *surfaces* look identical and only the
colour changes, this pass has not landed.

## 8.6 `phase08-06-sand.png` — the ground the map asked for

The plaza's ground material comes from the map's `groundSurface`. Find the sandy area (or start a
map whose ground is sand) and look at it at ~3 m and at ~15 m.
*Demonstrates:* **sand is sand** — granular and loose, with macro-scale compaction and drift
variation that survives at distance — rather than mortar-jointed paving flags, which is what it
rendered as before (the map's request was falling through to the default material).

# Phase 09 — geometry: construction, edges, and where the detail is spent

The eighth report was PHASE 04: eighteen items about *shapes*. Its own framing is the point —
"material improve karne ke baad bhi kuch objects low-quality nazar aa sakte hain" — and the pass
that answered it also had to fix four defects the previous pass had introduced (a grime belt
floating around every building, a car's dirt sized twice the car's width, small parts melted round
by the bevel rule, and a window whose glass stood in front of its own frame). Every one of those is
visible in an *existing* capture, so if you have Phase 08 frames, **re-run 8.2, 8.3 and 8.6 first**:
the building ring, the black wings on the car and the window plates are all in them.

Same setup as Phase 05–08 (`npm run dev`, `?autostart=1&lock=off&seed=7`, DevTools console), save
to **`.captures/phase09/`**. `freeze(true)` + `freezeFx(true)` for every frame.

## 9.0 `phase09-00-detail.json` — the budget and the bevel rule

```js
({
  cost: window.__IV__.renderer(),        // drawCalls, triangles, frameMs, resolutionScale
  census: window.__IV__.sceneCensus(),   // what the extra geometry actually is
});
```
*Demonstrates:* the cost is stated rather than assumed. Quote the triangle count with these frames;
the devtools overlay asserts it against the runtime budget. Then, for the rule itself: a 60 mm part
should have a **~7 mm** round, not the 20 mm one the shipped build gave it — the frames that show
it are 9.4 (the optic and the receiver) and 9.5 (a barrier's chamfer and a kerb's edge).

## 9.1 `phase09-01-facade.png` — one building, from the street, at ~12 m

Walk up to a facade and frame one storey plus the entrance.
*Demonstrates:* **construction.** The entrance must have jambs, a lintel and a **canopy on
struts** standing a metre off the wall; there must be a service box and a louvred grille somewhere
on the wall; a balcony on some blocks (slab, rail, brackets). Each of those has to drop its own
shadow onto the wall behind it — if the facade is a wall with rectangles on it, this item is not
landed.

## 9.2 `phase09-02-window.png` — a window, as close as you can get

Stand under one window and look up, so the sill and the glass are both in frame.
*Demonstrates:* the review's item 7. The **glass must be recessed behind the frame** with the sill
and lintel standing proud of it — there should be a visible shadow line along the top of the
glass. The shipped build had the pane 9 cm *in front of* its own reveal, so the window was a dark
plate glued to the wall; if it still looks like one, this is the frame that says so.

## 9.3 `phase09-03-kerb.png` — the kerb line, looking along it

Stand on the paving and look down the road at a low angle, 30 m of kerb in frame.
*Demonstrates:* items 3 and 10. The kerb must **not** be one perfect 124 m line: segments with a
centimetre of wobble, one in six broken with its foot showing, a grime gutter alongside, and sand
banked against it. A perfectly straight, unbroken kerb is the prototype tell this frame exists to
catch.

## 9.4 `phase09-04-car-close.png` — the wreck from three metres, side on

Frame the car so a door, a wheel arch and a headlamp are all visible.
*Demonstrates:* item 5. Door **shut lines and a handle**, a **mirror on a stalk**, a **rolled arch
lip** over each wheel, **lamps in housings** with glass, a **grille of slats**, tail lamps. Two
existing-frame checks while you are here: the arch lips must sit *on* the body (they were buried
inside it), and the dark grime band must be the car's own width, not a slab sticking out both sides.

## 9.5 `phase09-05-barriers.png` — a row of Jersey barriers

Frame four or five barriers in a row from about 8 m.
*Demonstrates:* item 4 and item 2. They must **not** be five identical extrusions: a centimetre of
height, a degree of lean, a slightly different waist, and **one in three with a spalled corner**
where the lip has broken. And the bevels — the chamfered waist, the top lip, the rounded corner on
the chip — are what catch the light along their edges.

## 9.6 `phase09-06-monument.png` — the landmark, from the plaza

Stand 15 m back and frame the monument with its base in shot.
*Demonstrates:* item 12. A landmark should look *designed*: the paved apron and its slab ring, the
**ring of bollards** around the approach, and benches facing it. The brass cap must read as brass
(it is a library material now, so it takes the sky and the weather like everything else).

## 9.7 `phase09-07-ground.png` — the ground around a sandbag stack

Frame the base of a sandbag wall from ~2 m, low.
*Demonstrates:* item 11, in the one place this pass does it: the ground must show **drift and
disturbance** around the stack — low mounds of sand with the stack's own dirt — rather than a plane
with a prop standing on it. Away from props the paving is still paving, which is honest: the
report's terrain variation is present where something disturbed the ground and absent across open
plaza.

## What I will do with these (phase 09)

9.1, 9.2 and 9.4 are the frames the report was written about — a facade, a window and a car — and
each of them is now a construction with a stated invariant behind it, so if one is still wrong the
argument is with a number (`windowConstruction`, `DETAIL`, `bevelFor`) rather than with taste. 9.3,
9.5 and 9.6 are the repetition items: they are the frames where "procedural" shows, and the fix
for them is variation, which only a human can confirm reads as variation rather than as noise.

## What I will do with these (phase 08)

8.3 and 8.5 are the two frames these eighteen items were written about: a car body, a pane of
glass and a wheel on one side, and the same road under two hours on the other. Everything else in
this pass is *placement* — where the dirt is, where the sand banks, which window each wall samples
— and placement is the one thing that has to be looked at. If a frame is still wrong, the number to
quote is in 8.0: `__IV__.materials()` reports the live roughness, metalness and reflection of every
outdoor material, so "the road is too shiny" becomes "the road is 0.63 at dusk and I expected
0.75" rather than an argument about art direction.

---

# Phase 10 — the lighting, at every place, and the ground in the second image

The ninth report carries its own frame: a road that is near-black, speckled like television
static, and stitched with bright glints. **None of it is art direction** — it is five
arithmetical defects (ADR-0022), and the pass that fixed them was measured with the probe in
`.captures/` before and after. These are the frames a human should look at, and they are written
so that the *same* frame can be compared against the before-captures, not so that the level can be
wandered around.

## 10.0 Setup — the two commands that make a capture comparable

Autostart, unlocked, seed 7 (`http://localhost:5173/?autostart=1&lock=off&seed=7`), then:

```js
window.__IV__.setQuality('high');
window.__IV__.freeze(true);
window.__IV__.freezeFx(true);
window.__IV__.lockResolution(1);   // NOT optional — see below
```

**`lockResolution(1)` is the one that matters.** The adaptive resolution controller drifts between
captures, so without it two frames of "the same" pose are two different pixel counts and every
metric you take of them is a comparison of two renderings, not of two states. With it locked, two
runs of the same pose agree to four decimals. Save to `.captures/phase10/`.

## 10.0b `phase10-00-renderdebug.json` — the numbers this pass moved

```js
copy(JSON.stringify({
  ao: window.__IV__.renderDebug().ao,
  fog: window.__IV__.renderDebug().fog,
  materials: window.__IV__.materials(),
}, null, 2));
```

*Demonstrates:* `ao.bias` and `ao.thickness` are reported now because the pass is an argument about
two numbers — expect **0.25** and **0.12** (they were 0.06 and 0.3, and a flat road carried
occlusion at that bias). `materials` gives every surface's *live* roughness after the hour's
weather, and asphalt must **not** read as its own square: authored 0.9 with the dusk preset is
~0.63, where the old pipeline shaded it at ~0.4.

## 10.1 `phase10-01-road-dusk.png` — **the frame the report was about** (image 2)

```js
window.__IV__.setTimeOfDay('dusk');
window.__IV__.pose(0.6, 26, 0, -0.32);
```

The ground filling the lower half of the frame.
*Demonstrates:* the road is a **surface**, not a field of mirrors. What to look for, in order: no
speckle crawling between frames (the aggregate was drawn smaller than a texel — 5.9 mm against a
2.9 mm texel now), no white glints scattered across it (7,000 relief-embossed stones at relief
0.06), and a mean luminance in the 0.15–0.25 band rather than the 0.147 the old build measured.
Compare against `.captures/before-road.png`; the pass measured hf 0.0285 → 0.0110, glints 0.0597 →
0.0113, sub-0.02 pixels 20.7% → 3.5% on this pose.

## 10.2 `phase10-02-road-dawn.png` — the same pose, the other hour

```js
window.__IV__.setTimeOfDay('dawn');
```

*Demonstrates:* the fix is a material property and not an exposure trick. Dawn's road should read
bright and dry (measured mean 0.435, 1.5% clipped); dusk's the same surface damp and dark (0.208).
If dawn also looked dim, the pass would have made the game darker rather than the road correct.

## 10.3 `phase10-03-road-close.png` — the aggregate at arm's length

Pose over the road, pitch ~-1.0, so one square metre fills the frame.
*Demonstrates:* the defect in one image. The stones are now *smaller than* the texture is sampled
at — a mineral grain you can see the shape of — rather than a 30–45° normal perturbation every two
texels. There should be no pixel on this surface that is brighter than the fog.

## 10.4 `phase10-04-road-far.png` — **the part that is still wrong**

Same pose as 10.1, pitch ~-0.12, so the far ground is in frame.
*Demonstrates:* the honest open finding. Rows 240–300 of a 768-row frame are 66% below luma 0.02 at
dusk while the fog colour `0x39404f` (luma 0.24) is nowhere near them: **the fog does not appear to
reach ~60 m**, and the reporting of it is the point. If this frame is black-graded with a clean haze
at the far end, the finding is real and the next pass starts here; if it is *not* black, say so,
because then the measurement is at fault and both need to be reconciled.

## 10.5 `phase10-05-weapon.png` — the receiver under the view light

Hip pose, `freeze(true)`, any time of day.
*Demonstrates:* the value of the squared-roughness bug, in the place it did the most damage. The
view-model receiver is authored at `roughness` 0.56 and the old pipeline shaded it at 0.235 — a
mirror — so ADR-0019's own fix (1.1 cd, 0.56) was being undone by the map. At 0.56 the light should
read as *form* on the receiver and the glove; at 0.235 it read as a white smear 45 cm from the eye.

## 10.6 `phase10-06-ao-on.png` / `10.6b phase10-06b-ao-off.png` — the same frame twice

```js
window.__IV__.setAo(true, 'frame');   // then '.captures/phase10-06-ao-on.png'
window.__IV__.setAo(false);           // then '.captures/phase10-06b-ao-off.png'
```

*Demonstrates:* the false-occlusion finding, and it is the cheapest frame in this list to read —
**toggle between the two images and the road must not change.** At the shipped bias the fixed AO
moves the near ground's mean by 1.3% and its high-frequency energy by 0.7% (measured live); at the
old bias the term read 0.80 of unoccluded **on a flat plane**, and that false occlusion *was* the
speckle in 10.1.

## 10.7 The probe command, if the harness is available

```bash
npm run shots
python .captures/regions.py --compare .captures/phase10-06b-ao-off.png .captures/phase10-06-ao-on.png
```

`regions.py` takes the same measurement as the pass did (mean / high-frequency energy / relative hf
/ glint share / sub-0.02 share / over-0.5 share, per region), so the numbers in the report can be
re-derived from a new frame rather than trusted.

## What I will do with these (phase 10)

10.1, 10.4 and 10.6 are the whole argument. 10.1 is the frame the report was written about and it
has a before-image to sit beside it; 10.6 is the *mechanism* of that frame's noise, readable by
toggling two images; and 10.4 is the one thing this pass found and did not fix, deliberately, with
a number attached so the next pass does not have to rediscover it. 10.5 exists because the same bug
that made the road a mirror made the weapon a highlight — one defect, two frames, and if only one
of them is fixed the diagnosis was wrong.

---

# Phase 11 — the hand, the arm and the enemy (ADR-0023)

The report: *"our own hand and arm are still not realistic, their shapes are not real"*, and
*"the enemies' 3D models are rubbish shapes — use real 3D models, download them, animate them"*.

Same method as phase 10: three things per finding — the frame, the number, and the check. The
one thing this phase adds is a pair of switches that make a hand measurable at all, because
the two obvious instruments do not work on it (the weapon is a bigger axis-aligned mass than a
hand, and a crop around a hand at a hip carry comes back `fill = 0.98` with no silhouette in it).

## 11.0 — the setup

```
window.__IV__.freeze(true)
window.__IV__.freezeFx(true)
window.__IV__.lockResolution(1)      // non-negotiable: the adaptive controller drifts
window.__IV__.setQuality('high')
window.__IV__.setTimeOfDay('dusk')
window.__IV__.pose(0.6, 26, 0, -0.32)
```

Then, per pose, shoot the pair **in this order** — hidden first, then shown, with no other
change between them:

```
window.__IV__.weaponPose({ adsT: 0, sprintK: 0, reloadProgress: 0 })
window.__IV__.viewModel(false, false)   // weapon hidden, hands and arms shown
… screenshot → hands-off.png
window.__IV__.viewModel(true, false)
… screenshot → hands-on.png
```

`viewModel(visible, weaponToo)` is the second argument's whole purpose. `viewModel(false)`
hides everything (the phase-10 usage); `viewModel(false, false)` leaves the hands and arms on
their own, which is the only configuration in which a shape statistic is about a hand.

## 11.1 — hands only, all four poses

`hip`, `ads`, `reloadProgress: 0.45`, `sprintK: 1`. The reload and the sprint are the poses
where both hands leave the weapon, so they are where a wrong finger shows.

Measure:

```
python .captures/mask.py .captures/handsonly-hip-off.png .captures/handsonly-hip-on.png --ascii 120
```

**What I measured on this pass** (1366x768, Brave, locked resolution), for the record so the
next pass has a baseline: `hip` axis 0.287 / diag 0.410 / curve 0.303; `ads` 0.332 / 0.376 /
0.293; `reload` 0.279 / 0.439 / 0.282; `sprint` 0.283 / 0.436 / 0.281. Two caveats that
matter: the difference mask also catches the **view-model light**, which is on the camera and
lights the world within 2 m, so hiding the view model changes the frame everywhere and the
mask's raw *area* is not a clean measure of coverage — the orientation shares and the lobe
are. And the **ASCII view** of the biggest lobe is the readable part; the numbers only say
whether it got less box-shaped.

## 11.2 — the hand at reading distance

One frame with the weapon **shown**, ADSed, cropped to the support hand. `handbox.mjs` reports
where each hand projects (via `weapon().joints`, which is true world space as of this pass),
so the crop is aimed rather than guessed:

```
node .captures/handbox.mjs
python .captures/mask.py OFF ON --crop <x0>,<y0>,<x1>,<y1> --ascii 120
```

At a 1366x768 viewport the support hand sits near 683,476 at ADS and the trigger hand near
845,717 at the hip carry. 11.1 says whether the hand has the right *shape*; this one says
whether it reads as a glove at the distance the player sees it.

## 11.3 — the enemy, head to toe

`.captures/brave.mjs` stages this already: it spawns each archetype 3.6 m in front of the
player, looking at it, and reports where the head and the feet project so the frame can be
cropped to the body. Three frames — `rifleman`, `rusher`, `heavy` — and the same question
the first-person hand answers: is it one box, or is it a man.

**Known and not yet fixed at the time of writing:** all three archetypes still build their
hands from `enemyView.ts`'s own boxes rather than from `characters/hand.ts`, so the frames
will show the same mitten the first-person hand had. That is the next pass's first item, and
the shared module exists precisely so that the fix is a mount and not a second hand.

## 11.4 — the live loop

A real gameplay burst in Brave — hold `W`, fire, throw, jump, crouch — because the standing
request is to *play* the game and not only to pose it. `.captures/brave.mjs` does this and
reports `errors`, which on this pass was **zero**. One number from it is worth carrying
forward: standing still in the open at wave 1, the player's health went **100 → 0 in 5.1 s**
with 6 hostiles alive. That is a playability datum for real testers, not a rendering one, and
it belongs with the balance sweeps rather than here.

## What I will do with these

11.1 and 11.2 decide whether the hand is finished; 11.3 starts the enemy-model work the same
way, with the same module; 11.4 is the loop's own check that playing the game still works.
Every one of them has a check behind it now — `tests/unit/hand.test.ts` for the shape,
`npm run verify` for everything else — so a frame can disagree with the code and the code
wins the argument only if it has the numbers.

