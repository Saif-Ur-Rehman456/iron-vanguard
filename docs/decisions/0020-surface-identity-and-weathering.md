# ADR-0020 — A surface is a physical identity, and the hour is part of it

Status: accepted (seventh review)

## Context

The seventh report was eighteen items long and every one of them was about the same thing
from a different angle: *"materials har object par almost same type ka visual response de rahe
hain… sirf color change karna enough nahi; roughness, normal, metallic aur reflection
response bhi alag hona chahiye."* The road, the sand, the concrete, the car, the buildings and
the weapon were all answering light the same way.

That is not a texture-resolution problem and it is not an art-direction problem. It was a
**plumbing** problem: what a surface *is* lived in three places at once —

1. the recipe in `materials/textures.ts` (a draw function per surface),
2. the `SurfaceParams` passed at the call site in `materials/materials.ts`,
3. the material's own numbers after it was built,

— and nothing connected them. A constant could be changed in one and contradicted in another,
which is how a car body ended up wearing a stippled polymer map (grain, no panels), how every
outdoor surface ended up between 0.85 and 0.96 roughness (one grey response), and how a
weapon could share the same values as a kerb.

The frames made the individual defects visible, and they were all arithmetic:

| the report said | measured |
| --- | --- |
| "car ka material sab se zyada fake/noisy" | one roughness for the whole panel; the map carried 3,400 px/m of grain onto a painted surface, and mid-scale wear (scuffs, chips, panels) did not exist |
| "car ka glass proper glass jaisa nahi" | a 0.34-opacity tinted box **with no geometry behind it**: a flat panel is what transparency over nothing looks like |
| "tyres rubber ke bajaye textured dark object" | one `materials.tire` for tread, sidewall and rim |
| "road ek generic textured plane jaisi lagti hai" | one 8 × 124 m plane, one map, tiled fifty times at the same angle |
| "buildings ki textures repetitive" | three facade maps for nine buildings, all starting at the same corner of the same map |
| "roughness variation bahut weak" | `UV_DENSITY` and `SURFACE_SPEC` did not exist; every outdoor class was 0.85–0.96 |
| "dirt poori surfaces par uniform" | dirt was a *layer in a texture*, so it was everywhere and therefore meant nothing |
| "far objects mein detail repeat hoti hai" + "macro/mid/micro balance wrong" | micro detail at full strength at every distance, macro detail nowhere |

The requirement that ties the eighteen items together is one sentence: **"Texture ko zyada
detailed nahi banana — material ko zyada believable banana hai."** Believable is a property of
the *material*, not of the map.

## Decision

### 1. One table of physical identities (`materials/surfaces.ts`)

`SURFACE_SPEC` has one row per surface class, and every row is a *property* rather than a
look: `family` (mineral / aggregate / granular / organic / textile / elastomer / metal /
coated / glass / liquid), `roughness`, `roughnessVariation`, `roughnessField`, `metalness` +
`metalnessMode`, `relief`, `normalScale`, `envIntensity`, and the three layer amplitudes.
Nineteen classes.

A material is then a *variant* of a class: `specFor('asphalt', { aoIntensity: 0.9 })` says
"this is asphalt, with its occlusion called out", and it inherits every other number. The
recipe in `textures.ts` draws the class's maps *from the same row*, so the map and the
material cannot disagree — which is the actual fix for item 1, and the reason a change to one
number moves the frame.

This is what makes the whole review checkable without a GPU. `tests/unit/surfaces.test.ts`
asserts the properties that the eighteen items are about, as arithmetic:

- **no half-metals** (item 10): every class is `0` or `≥ 0.9`. Nothing in the world is 35%
  metal, and a middling value is how a surface reads as dirty plastic.
- **a coating declares the substrate** (item 10): `metalnessMode: 'coating'` means the number
  is the *substrate* and the metalness map is the paint — painted steel and car paint are 1.0
  with a field of ~0.12, so a chip through the paint is a change of material, not of colour.
  A coating class must be exactly 1.0, so the two readings can never quietly become the fudge
  the mode exists to forbid.
- **roughness spends its range** (item 9): the table spans matte to mirror (sand 1.0 → water
  0.06) and the smooth half is not empty.
- **no class is another class twice** (item 1), plus a *named* list of the pairs the frames
  confused — asphalt/sand, ground/carPaint, concrete/steel, sandbag/wood, water/concrete —
  each with a floor.
- **every class has a large-scale story** (item 17): macro + mid carries the surface, and for
  the four outdoor families (mineral, aggregate, granular, coated) it is ≥ 0.8, because the
  two large scales are the only detail that survives distance. Car paint is *required* to have
  the least grain and the most mid-scale wear in the table.

### 2. Three scales, and the amplitudes come from the class

`SurfaceLayers { macro, mid, micro }` is the recipe's contract: **macro** is stains, polish,
repairs and compaction; **mid** is scuffs, panels, small damage; **micro** is grain and pores.
The amplitudes are declared per class, so a car body's micro is 0.2 (a painted panel is
smooth) and sand's macro is 0.7 (dunes and traffic are the point of sand). This is item 17's
"abhi tumhare project ko especially macro + mid-level material storytelling ki zarurat hai"
expressed as a number the recipe and the test both read.

### 3. Weathering belongs to the atmosphere (`materials/surfaces.ts`, `level/timeOfDay.ts`)

A time of day is not a filter over a fixed world: 0620 is a **dry, dusty** morning (dust 0.5,
wetness 0.1) and 0437 is the **damp end of a night** (wetness 0.45, dust 0.12). So a preset
declares a `Weathering`, and `applyWeathering` moves the outdoor materials to match —
glossier and more reflective when wet, duller when dusted.

Two properties make this a system rather than a paint:

- **the wet target is absolute, not a delta.** A wet surface approaches
  `WEATHER.wetRoughness` (0.3) *from above* and a surface already smoother than that does not
  move at all. Water fills the pits that made a surface rough, so sand at 1.0 is transformed
  and water at 0.06 is untouched; that asymmetry is also what keeps a street of surfaces from
  homogenising in the rain. (The first implementation got this backwards — see AGENTS.md
  entry 32.)
- **it is idempotent.** The arithmetic runs against the values the recipe *authored*
  (`userData.baseRoughness` / `baseEnvIntensity` on each material), not against the values
  currently on it, so applying an atmosphere twice is the same as applying it once and a dry,
  clean weather restores the library exactly. Without that, every visit to the settings
  screen would drift the world a little duller, and nothing would ever show it.
- **it cannot reach what it must not.** `WEATHERED_MATERIALS` is an explicit class → material
  list, and the `instanceof MeshStandardMaterial` guard is the reason a lamp lens (unlit —
  its colour *is* its brightness) is not dimmed by the air. The test asserts a class the
  weather claims is never mapped to nothing.

### 4. Repetition is broken by placement, not by more art (items 5, 7, 13, 15, 16, 18)

"Break the repetition" otherwise reads as "ship more textures". It does not have to:

- **Road wear** (`arena.ts`): nine sand drifts banked against each kerb at jittered depths,
  three repairs (`roadPatch`: darker and *smoother* binder — new asphalt has not been worn
  rough by traffic), two burn marks (`scorch`), and the road markings themselves. A road is
  read as a surface with a history, at eight quads per arm.
- **The edge is the transition** (item 15): asphalt does not stop at a clean line, it thins
  into dust, and the sand drifts are both the accumulation and the material transition
  between road and ground.
- **Dirt is a material** (`grime`): what a surface collects where it meets the ground, in the
  same film under a car, along a wall's base and inside a wheel arch. Placed by rule rather
  than tiled over a texture, which is the difference between an environmental event and noise.
- **Building shells sample their own window** onto the facade map (`shiftUv`): an offset is
  free — same texture, same material, same draw call — and it is the cheapest break there is.
  Plus a ground-level grime band and a drainpipe, because a facade becomes a building by
  having things attached to it.
- **The car is a painted object**: `carPaint` (clearcoat over base coat, roughness varying
  under a coat that stays glossy, which is what a dusty car actually looks like), `carGlass`
  over a real cabin, tread + sidewall + rim as three surfaces, grime along the rocker panels
  and inside the arches, and an oil-and-dust contact patch on the ground.

### 5. What is *not* done here, on purpose

- **No per-instance material clones for building tone.** A per-building colour would mean a
  cloned material, and a clone is not in `materials.buildings`, so the atmosphere could not
  reach it — the weathering contract would have a hole in it for the largest objects in the
  frame. The three facade tones plus a per-building UV window carry the variation instead.
- **Distance simplification (item 16) is mipmaps and UV density, not geometry LOD.** The
  density contract (`UV_PIXELS` / `UV_DENSITY`, `tests/unit/texel.test.ts`) is what decides
  whether a wall's detail survives to 40 m; a material LOD switch would be a second system
  for the same problem.
- **Visual claims are still visual.** The frames have to confirm that "cleaner paint, a road
  with a history, two different atmospheres" is what the picture now says. That is
  `docs/CAPTURE_REQUEST.md` phase 08, and `__IV__.materials()` reports the live numbers those
  frames are about.

## Consequences

- **Cost:** the surface library is generated at load, once, from data; weathering is a handful
  of scalar writes on an atmosphere change. The pass moved the *number* of materials up (grime,
  roadPatch, scorch, a sidewall, a glazing set) and the number of props up by about 30 quads
  per plaza, which is not a frame-budget item (ADR-0016); the texture memory is unchanged
  because no new maps were authored — the new materials are variants over existing ones.
- **A tier cannot change any of it.** Weathering and the material library are the look, and a
  tier buys samples and counts (ADR-0014, ADR-0017).
- **Rules that now fail the build:** a half-metal, a coating that is not 1.0, two classes that
  collapse, a class with no macro story, a weathered class with no material, a weathering that
  is not idempotent, a wet surface that is not glossier, a sand map that draws paving, and a
  UV offset that moves the AO set. `npm run verify` runs all of them.
