# Art bible

The look: **late-afternoon dust over a battered desert plaza.** Warm key light,
cool shadows, heavy atmosphere, readable silhouettes. Realism is the *reference*,
not the goal — the goal is that a player can tell at a glance what is cover, what is
lethal and where the enemy is.

M1 ships procedural stand-ins for all of it; this file is what an art pass must
conform to.

## Pillars

1. **Silhouette first.** Every prop, hostile and pickup reads as a distinct shape at
   60 m in fog. Colour is the second signal, never the only one.
2. **Warm/cool split.** Sun is warm (`0xffd9a0`), shadow is cool blue-grey
   (`0x7d8aa0`/`0x3d3628`). Hostile accents are hot orange-red; friendly and objective
   colours are teal/green. Nothing decorative competes with those hues.
3. **Dust in the air.** Fog density 0.0125, dust motes, smoke columns, heat shimmer
   on the horizon. Atmosphere is what makes 120 m of plaza feel like a place.
4. **Grounded damage.** Everything in a war zone looks used: chipped concrete, rusted
   metal, burnt wrecks, tyre and puddle clutter. Clean geometry reads as unfinished.
5. **Readable lethality.** Red barrels are *red*. Lasers are hot and thin. Explosions
   bloom. A player should never say "I did not see that".

## Palette

| Element | Value | Use |
| --- | --- | --- |
| Sky top / horizon | `#7d8aa0` → `#d9c9a8` | gradient dome |
| Ground concrete | `#8b8a83` | plaza |
| Sand | `#b3a179` | approach roads, sandbag fills |
| Building | `#4b5560` | mass, `variant` shifts hue ±6% |
| Barrier jersey | `#9aa5ad` | cover |
| Metal (rust) | `#6b6154` | wrecks, poles, kiosks |
| Wood crate | `#8b6b3f` | crates |
| Barrel red (volatile) | `#c0392b` | the *only* saturated red in the level |
| Barrel green | `#3f7d52` | non-explosive sibling |
| Hostile accent | `#ff5a2a` / `#ff3c14` | visor + nameplate |
| Rusher accent | `#ff7a3a` | warmer, faster read |
| Objective / friendly | `#4fd1c5` | HUD markers, extraction |
| Warning | `#c9a227` | gates, extraction decorations |

Rule: the player's screen should never contain a saturated red that is not lethal.

## Technical conventions (enforced by `tools/blender/conform.py`)

| Rule | Value |
| --- | --- |
| Units | 1 unit = 1 m; 5 m wall = 5 units tall |
| Orientation | +Y up in Blender, exported `+Y up` (glTF), game uses +Z north |
| Origin | at the ground contact point (floor of the prop at Z = 0) |
| Transforms | applied; no leftover scale or rotation |
| Materials | named `SURFACE_<id>` matching `packages/content/src/surfaces.ts` |
| UVs | channel 0 albedo/tiling, channel 1 named `Lightmap`, 4 px gutter |
| Collision | `<asset>_COL` convex proxy, ≤ 15% of LOD0 triangles |
| Textures | KTX2, 2048² for hero assets, 1024² for props, 512² for decals |
| Naming | `snake_case`, no engine suffixes, no `Material.001` |

## Triangle budgets

| Class | LOD0 | LOD1 | LOD2 |
| --- | --- | --- | --- |
| Weapon (first person) | 12,000 | 5,000 | 1,500 |
| Character | 18,000 | 8,000 | 2,500 |
| Prop, large (building, monument) | 8,000 | 3,000 | 900 |
| Kit piece (wall, barrier, crate) | 4,000 | 1,500 | 500 |
| Prop, small (barrel, tire, lamp) | 2,000 | 800 | 300 |

Decals are 2-triangle planes with alpha; particles are sprites. Neither counts
against a budget because they are pooled and instanced.

## Level kit list (M2)

| Kit | Pieces |
| --- | --- |
| Walls | straight (2 m, 5 m), corner, gate jamb, rubble variant |
| Buildings | 3 massing variants × 2 damage states, roof props, awning, doorway |
| Cover | jersey barrier (straight, angled), sandbag short/long, crate stack, planter, wreck |
| Street | lamp, cable pole, kiosk, banner frame, monument base, fire pit, tyre pile |
| Ground | tiling concrete/sand, road strip, painted markings, decal sheet (cracks, stains, casings) |

Everything modular on a 1 m grid with a 2 m module convention, so a designer can
build with it in `apps/editor` without a modeller.

## Characters

Shared skeleton `IK_iron_*` (22 bones, rigged in Blender, animated by Mixamo clips
retargeted by `tools/blender/mixamo_retarget.py`). Silhouette ladder:

| Archetype | Read | Build |
| --- | --- | --- |
| Rifleman | standard, human | 1.8 m, mass 1.0, webbing + helmet |
| Rusher | fast, hunched | 1.75 m, lighter, blade forward, warmer accent |
| Heavy | large, armoured | 2.1 m visual scale, shoulder plates, wide stance |

Scale comes from data (`EnemyDef.scale`) so hitboxes and the render agree — the
simulation scales the head/torso boxes with the same number.

## Audio direction

- Weapons: dry, punchy, no reverb tail (the space provides the tail).
- Impacts by surface: concrete (crack), metal (ring + ricochet), sand (thud), wood
  (splinter), flesh (wet).
- Enemy voice: clipped radio chatter, non-verbal aside from the rusher scream.
- Ambience: distant rumble, wind, occasional radio; the heartbeat plays below 25 hp.
- Music: low-intensity bed during downtime, high-intensity on wave start, stingers on
  mission end. Never duck the weapon cues for music.

## What "good" looks like on screen

A screenshot at wave 3 should be readable when desaturated: cover, hostiles, muzzle
flashes, tracer lines, the player's own weapon and the objective marker all
distinguishable in greyscale. If it fails that test, the fix is contrast and
silhouette, not more effects.

## Realism pass (M2, procedural)

The look target is "photographed, not illustrated", reached without borrowed assets. In
priority order, because this is also the order of what buys the most:

1. **Bevels.** Every hard edge is rounded by 1.5–4 cm (`geometry.ts`). A 90° corner does
   not exist on a manufactured object, and it is the single loudest "video game" tell.
2. **One height field, five maps.** Relief is generated once and split into albedo,
   normal, roughness, AO and metalness (`materials/pbr.ts`), so mortar shadows, worn
   edges and grime all agree. Mismatched map sets are why handmade textures look
   "painted": the shading fights the colour.
3. **Image-based lighting.** The sky is baked into a PMREM environment and every metal
   reflects the horizon (`level/lighting.ts`). Metal with no environment is grey plastic;
   this one change did more for the weapon than any extra polygon.
4. **Silhouette before detail.** A fuel drum is a lathed profile with rolling hoops, a
   barrier is the real Jersey cross-section extruded, a car is a lofted side profile with
   wheels inside arches. Detail that does not change the outline is spent last.
5. **Kit carries identity.** Plate carrier, pouches, helmet with an NVG mount, radio,
   holster: at 20 m a hostile reads as a soldier because of gear and posture, not anatomy.
6. **Less UI on the world.** Health bars appear only once a hostile is damaged. Floating
   full-health bars were the last cartoon element in the frame.
7. **Grimier colour, honest contrast.** AO is baked into albedo *and* applied as a map;
   the vignette clears the middle 55% of the screen and never exceeds 0.6 opacity.

Where it stops: animation is still procedural, so a hostile's limbs move on a walk
cycle rather than a solved rig. That is the line the GLB pipeline exists to cross
(`assets/models/README.md`), and it is deliberately not attempted in code.

## Lighting (Phase 02)

The target image is **a warm pool inside a cool field**. Every decision below serves that
sentence, and the whole rig is data in `packages/render/src/level/lighting.ts`
(`LIGHTING`), unit-tested in `tests/unit/lighting.test.ts` and measured group by group by
`npm run shots --probe=lighting`.

| Role | Colour | Where it is | Behaviour |
| --- | --- | --- | --- |
| Moon key | `#bdd0f0` cool | 33° elevation, azimuth as the prototype | 2.2–2.9 lux by tier; the only shadow caster; decides which facade is lit |
| Sky/ground ambient | `#59709f` / `#6a5636` | everywhere, no direction | 0.4–0.6, always less than half the key |
| Sky reflections | night sky PMREM | every material with `envMapIntensity` | the bounce term, and what makes metal read as metal |
| Street lamps | `#ffa851`→`#ffc98d`, varied per lamp | one `PointLight` per lamp prop, 5.35 m | ~300 cd, inverse-square, no shadow map |
| Windows | `#ffb877` warm | emissive panes + a 4-light pool near the player | warms its own wall; distant windows are emissive only |
| Firepit | `#ff8c3a` | map data | warm, flickering, local |
| Muzzle flash | `#ffc46b` | attached to the camera | 40 ms, 9–12 m, the brightest thing per square metre |

Rules that were violated before this pass and are now asserted in code or by a probe:

1. **The key must beat the ambient by at least 2×.** An ambient that rivals the key is what
   erases the shadow side and turns every surface into the same value.
2. **Local light must be local.** A lamp's own pavement carries ~10 lux against a ~2 lux
   moon; by 6 m the ratio is down to ~2 and by 34 m nothing is measurable. Anything that
   lights the whole map evenly is an ambient, not a lamp.
3. **Artificial is warm, natural is cool**, by a real margin (asserted as a colour-distance
   in the unit test, measured as `warmth` per patch in the probe).
4. **Shadows never reach 1.0.** `shadowIntensity` is 0.84–0.92: dark stays dark, but a
   shadowed surface keeps its edges and material detail. The alternative — a black shadow
   plus a grey fill — is how "dark objects look pasted on" happens.
5. **Emitters bloom above the scene, not in it.** The threshold (**1.0** at every tier since
   ADR-0019) sits above the tone-mapped midtone *and* above anything the player's own weapon
   reaches under its 7-lux view light, so a lamp lens pools light instead of becoming a white
   disc — and a bright rail stays a bright rail instead of a screen-wide glow. An emissive
   prop reads 1.4–1.5, so the emitters still have the whole band above the threshold to
   themselves. The kernel is tight (0.42 strength, 0.36 radius): a pool with an edge, not a
   wash over the scenery behind it.
6. **Distance desaturates.** `FogExp2` mixes toward a dim cool blue-grey (`#4b5567`), so
   contrast *and* saturation fall off together and the background reads as atmosphere
   rather than as a wall of the same brown as the foreground. The haze is deliberately
   *darker than the scene's highlights*: a bright fog in a night frame is a light source
   nobody placed. (`#8b8f96` at dusk made the far end of the plaza the brightest part of
   the image — the same flatness, inverted.)

### Known gap: ambient occlusion at small occluders

The AO pass (`post/ao.ts`) grounds large contacts reliably — a wall base darkens deeply and
is back to unoccluded by 2 m — but it cannot see a *small* occluder well: a barrel base
measures 0–3% against an 8% target (`docs/QUALITY_BAR.md` keeps the target visible rather
than lowering it). This is a property of screen-space AO — an occluder is only found if it
projects into the sample's footprint — and the honest fix is a different term, not a
bigger radius. Tune the pass through the *composite* A/B only: its own debug view is
bloomed and tone-mapped, so AgX turns a linear 0.3 into a displayed 0.65 and the numbers
look wrong when the term is right.

## Phase 03 — the rigs: what is held, and who is holding it

The Phase 03 review's two biggest findings were not about materials at all. *The gun is
not held by a man* and *the enemies do not read as real soldiers* were both rig defects,
and both are now data with invariants a test can check (ADR-0015).

### Sizes, not detail

A weapon is a set of dimensions before it is a mesh. `weapon/layout.ts` authors every
part of the view model at an armourer's real size — a 21 cm receiver, an 8.5 mm rail slot
pitch, a bore 6.8 cm below the sight line, a 6.5 cm flash hider — and the geometry is
built from that table, so "the gun looks wrong" becomes a number to compare:

| | before | after | real carbine |
| --- | --- | --- | --- |
| receiver length | 66 cm | 21–22 cm | 21 cm |
| overall length | ~1.0 m of box | 86–92 cm | 80–94 cm |
| muzzle from the eye, ADS | 1.36 m | 0.74 m | ~0.75 m |
| support hand from its shoulder | — (both gloves on the centre line) | 0.51 m of a 0.57 m arm | straight-ish |

### Two hands, solved

The rule the whole rig now obeys: **the hands belong to the weapon and the arms point at
them.** The player's support hand slides from the magazine well to the handguard as the
weapon comes up, the elbows come from a clamped two-bone IK, and each soldier's support
arm is re-aimed every frame from the weapon's actual pose. Where an arm genuinely cannot
reach — a 0.44 m-shouldered skeleton puts the aiming support grip 0.20 m past a 0.62 m
arm — the glove is a child of the weapon, so the wrist ends *behind* a glove that is
already on the handguard. A gap between glove and sleeve is the tell; an overlap is
invisible.

### Value, not brightness

The archetype colours (dark olive, dark brown, dark grey) render as black cut-outs under
a 2.6 lux moon, so the palette keeps content's hue exactly and lifts each garment's
albedo in linear space: jacket 2.1×, pouches 1.75×, trousers 1.5×, helmet 1.35×, belt
1.25×, carrier 1.15×, boots 1.0×. Every adjacent pair differs by at least a quarter of its
luminance — armour against cloth, pouches against the garment they sit on, a helmet
against the shoulders — and nothing is darkened or allowed above 2.5×. Garments get a cool
`sheen` (`MeshPhysicalMaterial`) so their edges catch the moon; at night a dark figure is
legible mostly by its rim.

### Which way a soldier faces

`front()`/`back()`/`KIT` in `characters/uniform.ts` name the convention: the simulation's
forward is local **-z**, so goggles, NVG mount, chest pouches, knife, hip pouches,
kneepads, boot toes and holster are `front`, and the pack and antenna are `back`. The
squad had all of them the other way round, which is why it read as mannequins wearing
each other's kit.

## Density: the surface decides, not the mesh

`UV_DENSITY` states how many metres one texture tile covers per surface class, and
`geometry.uvMetres` authors UVs in metres. The floor went from 97 mm per texel to 5.1 mm;
a crate's density no longer changes when the crate does.

| surface | metres per tile | map | millimetres per texel |
| --- | --- | --- | --- |
| paving (plaza floor) | 2.6 | 1024² | 2.5 mm |
| building facade | 1.2 | 512² | 2.3 mm |
| concrete (kerb, plinth) | 2.0 | 512² | 3.9 mm |
| asphalt | 3.0 | 512² | 5.9 mm |
| crate | 0.40 | 512² | 0.78 mm |
| sandbag | 0.35 | 256² | 1.4 mm |
| weapon gunmetal | 0.08 | 256² | 0.31 mm |
| weapon steel | 0.06 | 256² | 0.23 mm |

The *ratio* between a surface forty metres away and one in your hand is about 20×, and
every one of those numbers is a physical size someone chose rather than the side effect of
a mesh's dimensions. Props are migrated as they are touched; the ones still tiling by their
own size are listed as a gap in `docs/QUALITY_BAR.md`.

**Why the numbers moved in the fourth review (ADR-0017).** The first version of this table
said 5.1 mm per texel for the floor and did not cover the facades at all, and the review's
frames were the measurement that exposed it: a wall two metres away is about 1.7 mm per
screen pixel, so a *surface* at five to ten millimetres per texel is three to seven times
softer than the monitor and reads as mottle — "the walls are noise" is a density number,
not a texture one. Two rules came out of it:

1. **Density is `UV_PIXELS / UV_DENSITY`, and it is asserted per surface class** in
   `tests/unit/texel.test.ts`. A recipe whose map is lowered, or whose tile is enlarged,
   fails there rather than in a review.
2. **A wall's detail is large and few.** At 2.3 mm per texel a 6 mm speck is 2.6 texels:
   many of them at 0.22 alpha is grain, not damage. Spalling is 12-30 mm at 0.11 alpha now,
   and the per-pixel grain amplitude halved — the same reasoning as the window rewrite, at
   a density where it finally applies.

## Phase 06 — surfaces, hands and the second atmosphere

- **A wall is a storey, and a window is an object.** The facade map is authored one storey
  per tile with the slab band at its top, and windows are geometry: a reveal proud of the
  wall, a pane 5 cm behind it (dark glass, or `windowGlow` when it is lit), a sill under it.
  A lit window is therefore a *source* — it can glow, it can be occluded, it appears in the
  reflection — rather than a colour painted into the albedo, and only some windows are lit:
  a facade where every opening glows is the tell of a game that lit them for symmetry.
- **Surfaces keep their grain small and their damage large.** Small high-contrast dots on a
  3 m tile are noise at 4 m, not spalling; the wall's grain amplitude came down with the
  window rewrite, and anisotropy went to 16 on plaster, paving and asphalt, because a facade
  and a plaza are almost always seen at a grazing angle.
- **The first-person weapon has its own light.** 1.1 cd, 2 m reach, on the camera, above and
  right of the receiver: **~7 lux on a handguard 40 cm away, about 2.7x the moonlight on the
  street beyond it**. The look it buys is the hands — gloves, knuckles, sleeve — reading as
  objects rather than as one black silhouette, and the look it must *not* buy is a highlight
  that clips. This number has been wrong in both directions and both are on the record: 1.2 cd
  (6 lux) is a fill that left a glove reading as part of the weapon, and 2.6 cd (17 lux, 6.5x
  the scene's own key) put every metal surface it touched past 1.0 in the HDR buffer, where
  bloom spread it across the frame (ADR-0019). The rule now: **a light whose job is to reveal
  an object at arm's length is measured against the level the tone map is exposed for.** One
  light and not two, because the forward renderer evaluates every light for every fragment of
  the whole frame.
- **The weapon's highlight lives in its surfaces, not in its light.** Broad and low-gain
  (`roughness` 0.56 / `metalness` 0.66 / `envIntensity` 0.9 on gunmetal) rather than narrow and
  hot, and the soft materials — glove, sleeve — take *more* sky instead of less, because a
  matte surface is where the environment reads as form and a hand lit by the sky cannot blow
  out. A metal surface, a lens and a reticle all respond to controlled light; none of them
  becomes a source.
- **Two atmospheres, one look.** `dawn` inverts the rig's colour story: a warm high key and a
  cool sky, where dusk is a cool key and warm local sources. What must *not* change between
  them is the ratio (the key beats its own ambient at both hours) or the grade.

## Phase 08 — a surface is a physical identity

The seventh review's eighteen items were one problem, and the look of the world is now decided
by three rules rather than by per-material taste (ADR-0020).

**1. A surface class is what a thing is made of, not what it looks like.** Nineteen classes
(`SURFACE_SPEC`), each with a family — mineral, aggregate, granular, organic, textile,
elastomer, metal, coated, glass, liquid — and a physical response: roughness *and* how much the
relief and the painted field move it, metalness *and* how it is to be read, environment
intensity, and the amplitudes of three storytelling scales. A material is a variant. The reason
this is the art bible's business is that it is the difference between "the road is a bit
brighter here" and "the road is a *substance*": asphalt is an aggregate bound in bitumen at 0.9
roughness with a 0.6 macro layer, sand is granular at 1.0 with a 0.7 macro layer, and neither can
be given the other's numbers by a local tweak.

**2. The three scales are named, and the large ones carry the surface.** *Macro* is stains,
polish, repairs, compaction; *mid* is scuffs, panels, small damage; *micro* is grain and pores.
Outdoor surfaces have to tell at least 0.8 of their story at the two large scales, because that
is the only detail that survives ten metres. A painted car panel is the deliberate opposite: the
least grain in the table (0.2) and all of its character in the mid scale, which is what
"the car is a repeated noise texture" was actually measuring.

**3. The hour is part of the material.** Dusk is the damp end of a night — every exposed
surface glossier and more reflective — and dawn is a dry, dusty morning, where settled sand
roughens and dulls what it lands on. A wet surface approaches roughness 0.3 *from above*, so the
rain transforms sand and does nothing to water; the dust is on the bright preset on purpose,
because diffusing a hard low sun is both what a dusty street looks like and the readable choice.
Materials do not change with the hour — a wet surface is a *different surface*.

**4. A map states *where*, the material states *how much* (ADR-0022).** The fourth rule is the one
that made the first three visible, because three multiplies a material's `roughness` by its
roughness map's green channel — so a map that carries an *absolute* roughness is multiplied by an
absolute roughness, and the surface shades at its own gloss **squared**. The damage is proportional
to how smooth the author wanted the surface to be: car paint authored at 0.34 shaded at 0.12, water
at 0.06 shaded at 0.004, and the view model's receiver at 0.56 shaded at 0.235 — a mirror, which is
why a 1.1 cd light at 45 cm came back as a white smear and why "the weapon is glowing" was a
material bug wearing a lighting bug's clothes for two passes. So: **the map says where a surface is
glossier than its material; the material says how glossy the material is.** A texel may swing up or
down from its class's declaration and can never leave it — the class ordering is a checked contract
(sand ≥ asphalt ≥ gunmetal ≥ carPaint ≥ water), and the same rule covers metalness, which was
double-applied the same way. The fifth rule follows from it and belongs here too: **nothing is drawn
below the sampling rate.** The road's aggregate was 1.5–5.6 px of relief per 5.9 mm texel — a field
of miniature mirrors, the "static" in the report's frame — and no post-process fixes a surface whose
detail is smaller than a texel. Detail is authored in metres and the density is asserted
(`UV_PIXELS` / `UV_DENSITY`, `tests/unit/texel.test.ts`).

## Phase 09 — geometry is construction, and the edges are the rule

PHASE 04 of the same report is about shapes, and its three rules are these (ADR-0021).

**1. Anything that changes a silhouette or casts a shadow is geometry.** Grain, stains, wear and
burn marks are maps; a window reveal, a canopy over an entrance, a mirror on a stalk, a rolled arch
lip and a broken kerb are geometry, because what the eye reads as "architecture" at 20 m is a
*shadow* and no texture casts one. A facade therefore carries attached forms — an entrance with
jambs, a lintel and a canopy on braced struts, a service box and a louvred grille, a balcony with a
rail and brackets, pilasters on the tall blocks — and a window is a lintel and a sill standing proud
with the glass **14–18 cm behind their outer edge**. That distance is the opening.

**2. A bevel is an edge, and an edge belongs to its part.** A machined 60 mm part keeps a 7 mm
round, a 2 m cast panel keeps 3 cm, a 4 mm plate is nearly sharp. The shipped rule used a third of
the smallest dimension as an aesthetic clamp, which turned every small form into a capsule — the
fleet version of "the objects look like primitives".

**3. Detail follows what a thing is for.** `hero` (the weapon, a car you can walk up to, the
landmark): real edges, real hardware. `mid` (buildings, barriers, street props): the form and its
attached geometry at a coarser bevel. `far` (the skyline): the silhouette, nothing else. Uniform
detail is a waste at one end and a starvation at the other. A *graphics* tier never touches this:
`low` shows the same world.

**Dirt is placed, never tiled.** Contact grime along rocker panels, wall bases and inside wheel
arches; sand banked against the kerbs where water would carry it; repairs darker and smoother
than the worn road around them; burn marks where something burned. Each of those is a placement
rule rather than a texture layer, which is why the frame reads as a place that has been used
instead of a surface that has been covered.
