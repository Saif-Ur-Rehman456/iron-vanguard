# ADR-0022 — A map states *where*, the material states *how much*

Status: accepted (ninth review — "lighting is like this everywhere, and the ground in image 2")

## Context

The ninth report is two complaints with one picture between them: *"ya aesa kyon hai lighting ise fix
karo totally har jagah se"*, and — pointing at a road that is near-black, speckled like television
static, and stitched with bright glints — *"2nd image mein zameen kaise hai is ke tamam problems
analyze karo"*.

That road is not a lighting problem, an art-direction problem, or a matter of taste. It is five
arithmetical defects in the material and post pipeline, and every one of them is measurable in the
frame the player complained about. Four of them are the **same mistake made in four places**: a
number authored in one unit was used in another, and each place did the plausible-looking thing
instead of the consistent one.

The scan found them in this order, and the order matters — the first two made a surface glossy and
metallic by a factor of its own value, the third made the flattest surface in the build carry
occlusion, the fourth made the denoiser a no-op exactly where the noise was, and the fifth put a
field of miniature mirrors on the road.

## Decision

### 1. A roughness map is a signed swing, not an absolute (`materials/pbr.ts`)

three r186's `roughnessmap_fragment` is:

```glsl
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
  roughnessFactor *= texelRoughness.g;      // <- a MULTIPLY
#endif
```

and this build's map was authored with the **absolute** roughness baked in — `roughnessAt(base,
variation, fieldGain, height, field)` — while `MeshStandardMaterial.roughness` *also* held the
absolute. Two absolutes multiplied is the surface's gloss **squared**, at a rate set by its own
smoothness:

| surface | authored | shaded as |
| --- | --- | --- |
| car paint | 0.34 | 0.12 |
| water | 0.06 | 0.004 |
| view-model receiver | 0.56 | 0.235 (a mirror) |

The view model is the one that makes it visible: ADR-0019 set the view light to 1.1 cd and the
receiver to `roughness` 0.56 *to stop it glowing*, and the squared value 0.235 put the glow back —
a mirror is a white smear under any light.

The map is now a **signed delta from the material's own value**: `roughnessSwing(variation,
fieldGain, height, field)` ∈ [-1, 1], centred at 0.5 in the channel (`swingChannel`), and
`applySurfaceMaps()` replaces the stock chunk with an additive one that doubles the offset back out:

```glsl
roughnessFactor = clamp( roughnessFactor + ( texelRoughness.g - 0.5 ) * 2.0, 0.0, 1.0 );
```

`customProgramCacheKey = () => 'iron-surface-swing'` is not optional — without it three caches the
stock program for the injected source and never selects it. The nine-line shader replacement is
chosen over cloning every map per material variant (an extra GPU upload each, ~30 MB of canvas in
this build), and it is the more honest division: **the map states *where* a surface is glossier than
its material; the material states *how much*.** `effectiveRoughness(base, swing)` is the contract and
is exported so a test can hold it without a GPU.

`sheened()` in `characters/uniform.ts` was the second and last place a material is built from surface
maps outside `material()`; it calls `applySurfaceMaps` too, or the squad's kit is squared and the
level is not.

### 2. A metalness map is a fraction, for the same reason

`metalnessAt(base, field)` baked `base * field`, and three multiplies by `material.metalness` in
`metalnessmap_fragment` — so gunmetal authored at 0.95 shaded at 0.90. Same defect, same fix, one
number: `metalnessMapFrom` bakes `clamp01(metal[p])`, a fraction that starts at 1.

### 3. The occlusion term was darkening the flattest surface in the build (`post/ao.ts`)

The SSAO pass's own `ao` debug output — 1.0 is unoccluded — read **0.80 on the flat open road**, and
that false occlusion *is* the speckle in the report's image: a term that darkens a plane is a term
that is shading noise. The calibration is `intensity: 0`, which renders as **0.8633**, not 1.0,
because the same pass is composited through the look's tone curve; every reading below is against
that.

`bias` is a cosine of the occluder's minimum elevation, so 0.06 accepted an occluder barely above the
surface's own plane — on a grazing plane the whole sampler falls inside it. Measured on the road, as
a share of the unoccluded term:

| `bias` | unoccluded share | term hf |
| --- | --- | --- |
| 0.06 (shipped) | 93.5% | 0.0090 |
| 0.12 | 94.3% | — |
| 0.18 | 95.0% | — |
| **0.25 (now)** | **95.6%** | **0.0063** |
| 0.35 | 96.4% | — |

`thickness` 0.3 → 0.12 at the same time (a 0.3 m occluder is a building three metres from a road
sample pretending to be a wall). The sample ramp also moved from `radius * (0.35 + 0.65u)` to
`radius * (0.15 + 0.85u)`, because the nearest sample was 0.28 m and **a contact term that cannot
reach 5 cm cannot ground a tyre**.

`renderDebug().ao` now reports `bias` and `thickness`, so the next person to argue about it is
arguing about a number the app prints.

### 4. The denoise was a no-op exactly where it was needed

The bilateral range tolerance was `max(0.05, distance * 0.02)`. On a grazing plane a metre of ground
falls about a metre per texel, so *every tap* — centre and neighbours alike — fell outside the
tolerance and was weighted to zero: the AO buffer was **byte-identical with the blur on and off**
(hf 0.00924 either way, footprint 1.35 texels).

The tolerance now includes a **footprint** term computed from the two axial neighbours
(`max(slopeX, slopeY) * uBlurScale * 2.0`), and `uBlurScale` is 2.6. On the frame's far ground the
blur now actually removes noise: hf 0.01559/0.01595 off against **0.01218/0.01245** on — about 21%.
(Measure the frame, not the `ao` output: the pass deliberately skips the blur when it is showing the
term, which is how the no-op hid for so long.)

### 5. The road drew its aggregate smaller than a texel

7,000 relief-embossed "stones" of radius 1.5–5.6 px at relief 0.06 on a 512² map over a 3 m tile is
5.9 mm per texel — a 30–45° normal perturbation every ~2 texels, i.e. **a field of miniature
mirrors**, and it is the "static" in the image. Albedo was linear 0.027 against real asphalt's
0.05–0.10.

The map is 1024² (2.9 mm per texel), the base fill is `0x3f3c36` rather than `0x2e2c29`, the
speckles are fewer and gentler (3000 @ alpha 0.1 / relief 0.012 and 1800 @ alpha 0.14 / relief
−0.01), and the micro detail drops from `micro(0.06, relief 0.05)` to `micro(0.03, relief 0.016)`.
`roughnessVariation` 0.3 → 0.2 and `roughnessField` 0.6 → 0.4, because the corrected swing now
actually lands: ±0.75 of swing on a class the dusk preset already pulls to 0.63 reached **0.03** — a
mirror patch on the one surface that fills the bottom half of every frame.

`UV_PIXELS.asphalt` 512 → 1024 is the one cost in this pass: **one extra 1024² texture**, which is
the whole of the density argument, and it is stated rather than hidden.

## Consequences

Measured on the same pose before and after (locked resolution, `__IV__.lockResolution(1)`, so the
two frames are the same pixel count):

| region | metric | before | after |
| --- | --- | --- | --- |
| ground (near) | mean | 0.1473 | **0.2474** (1.68×) |
| ground (near) | high-freq energy | 0.0285 | **0.0110** (0.38×) |
| ground (near) | relative hf | 0.1935 | **0.0443** (0.23×) |
| ground (near) | glint share | 0.0597 | **0.0113** (0.19×) |
| ground (near) | black (<0.02) | 20.7% | **3.5%** |
| whole frame | mean | 0.1765 | **0.2239** |
| whole frame | black | 16.4% | **5.8%** |
| weapon | high-freq energy | 0.0408 | **0.0159** |
| weapon | glint share | 0.0955 | **0.0219** |

- **The look is not a tier and the simulation is not touched.** `npm run replay` still reports its
  162 samples byte-for-byte; all of this is presentation.
- **New rules that fail the build** (`tests/unit/roughness.test.ts`, GPU-free): a neutral channel must
  be exactly the material's roughness and *not* its square; an authored roughness must survive at
  both ends of the table; a texel may never swing past its class's declaration (clamped, and floored
  at three's 0.0525); the swing must round-trip through an 8-bit channel within 1.5/255; and class
  ordering cannot invert (sand ≥ asphalt ≥ gunmetal ≥ carPaint ≥ water, asphalt's glossy gap ≥ 0.05).
- **Open, with a number and no fix yet:** the dusk far ground is *still* near-black — 66% of one band
  (rows 240–300 of a 768-row frame) below luma 0.02 while the fog colour `0x39404f` (luma 0.24) is
  nowhere near it, i.e. the fog does not appear to reach ~60 m. It is recorded in AGENTS.md and owed
  to `docs/TASKS.md`. The next pass starts there.
- **Honest gap:** the instrument cannot resolve a small occluder's contact gain — a barrel base
  measured ≈0.0–0.26% against 1 m away on *both* the old and the new AO settings — so the higher
  `bias` plus the contact ramp are asserted by construction, not by this measurement. `docs/QUALITY_BAR.md`
  says so rather than claiming a number it does not have.
