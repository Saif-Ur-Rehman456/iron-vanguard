# Performance budget

Two kinds of budget, both enforced automatically, because "it feels fine on my
machine" is not a measurement.

## 1. Simulation budget (headless, enforced)

```bash
npm run bench:sim
```

Runs the scripted player plus the full simulation and requires **≥ 60× realtime**
headroom (60 ticks/s × 60). The gate exists so the renderer always has room: at 60×
headroom, a frame can spend 16 ms rendering and still be nowhere near the tick cost.

Measured on the reference machine: **~129×** (best of five samples; the harness warms
the JIT for 600 ticks first, because a cold first sample measured anywhere from 85× to
141× on the same commit — a gate that noisy is worse than no gate).

Where the time goes, and what was already done about it:

| Cost | Mitigation |
| --- | --- |
| collision broadphase | uniform 10 m grid, cell-keyed buckets |
| ray casts (AI perception, bot, ballistics) | cheap slab prefilter per obstacle; the bot resolves line of sight for its 8 nearest hostiles only |
| per-tick allocation | pooled FX, scratch vectors for rays, no closures in hot paths |
| enemy steering | two probes per candidate direction, early exit on the first clear one |

## 2. Build budget (enforced)

```bash
npm run budget
```

| Artifact | Limit | Why |
| --- | --- | --- |
| product JS, largest chunk (gzip) | 2.5 MiB | it is the download before first frame |
| `callofduty.html` raw | 20 MiB | one file you can email |
| `callofduty.html` gzip | 8 MiB | what a server actually sends |

Current: product JS ≈ 1.07 MB raw / 314 kB gzip; the single-file artifact inlines
code + CSS only (textures, audio and geometry are procedural, so there are no binaries
to inline).

## 3. Runtime budget (browser, asserted by the devtools panel)

Target **60 fps at 1080p on a 2019-class discrete GPU**, and a playable 30 fps on
integrated graphics at the `medium` tier.

The authoritative numbers live in `packages/render/src/quality.ts`; this table mirrors
`QUALITY_PRESETS` and is what a change must keep in sync.

| Tier | pixel cap | MSAA | AA | Shadow map | Reach | AO samples | Lamp lights | Window lights | Particles | Decals | Whole-buffer passes | Floor (dynamic only) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 2 (native) | 0 | FXAA | off | — | off | 1 | 0 | 180 | 4 | 4 | 0.70 |
| medium | 2 (native) | 0 | FXAA | 1024² | 55 m | off | 2 | 1 | 320 | 8 | 4 | 0.70 |
| high | 2 (native) | 2 | SMAA | 1024² | 70 m | 6 | 3 | 3 | 420 | 12 | 6 | 0.75 |
| cinematic | 2 (native) | 4 | SMAA | 2048² | 90 m | 8 | 4 | 4 | 640 | 20 | 6 | 0.85 |

**Every tier draws at the display's own pixel count** — the cap is a ceiling on
`devicePixelRatio`, not a per-tier target — and the resolution trade is the RESOLUTION
setting, off by default (ADR-0017). What a tier buys is effects: ambient occlusion, the
shadow atlas, which screen-space AA, how many real lights exist, MSAA, particles and
decals. `low` is both the fastest frame and the sharpest picture the renderer can make;
what it gives up is grounding, not detail.

| Stage | Where | Resolution |
| --- | --- | --- |
| scene | `RenderPass`, MSAA here and only here | full |
| ao | `post/ao.ts` | `aoScale` (0.4–0.5), or absent |
| bloom | `UnrealBloomPass` | `BLOOM_SCALE` = 0.5, all tiers |
| output | `OutputPass` (AgX + colour space) | full |
| look | `post/look.ts` (grade + upscale compensation) | full |
| aa | FXAA (1 pass) / SMAA (3) | full |

`postChain()` in `packages/render/src/quality.ts` is the list, `fullResPasses()` is its
count of whole-buffer read/writes, and both are asserted per tier in
`tests/unit/quality.test.ts` (4 / 4 / 6 / 6) and reported live by
`window.__IV__.renderDebug().fullResPasses`.

## 4. Where the frame time goes, and the ceilings that keep it there

The review that produced ADR-0016 was "laggy **and** blurry at every graphics level", and
the two halves had one cause: the adaptive controller's only lever is resolution, so a
frame that costs 22 ms against a 16.7 ms target got 0.9 of the pixels and still cost 18 ms.
A resolution trade is only honest when the frame is already near budget.

| Cost | Was | Is | Why |
| --- | --- | --- | --- |
| MSAA on the composer's write buffer | 4x, half-float | off | MSAA antialiases geometry; a fullscreen pass has none, so it was a resolve per pass (bloom composite, grade, SMAA x3) at the full drawing-buffer size |
| Tier MSAA | 2 / 2 / 4 / 4 | 0 / 0 / 2 / 4 | SMAA or FXAA runs after the grade regardless |
| Shadow atlas (`high`) | 2048² over 95 m | 1024² over 70 m | 4.6 cm per texel was finer than the PCF radius could show, for 4x the fill |
| Shadow atlas (`low`) | 512² | none | the cheapest large allocation in the frame, and the one a weak machine notices first |
| AO samples (`high`) | 8 | 6 | the radii are the term; the sample count is noise the bilateral blur removes |
| AO pass (`low`, `medium`) | 4 samples at 0.4 | off | a multi-tap full-screen read plus a blur, for the least visible term in the frame |
| Real lamp lights (`high`) | 4 (+4 windows) | 3 (+3) | each one is evaluated for every fragment of every material in the frame |
| Real lamp lights (`low`) | 2 (+2) | 1 (+0) | same, at the tier that needs the milliseconds |
| Screen-space AA (`low`) | SMAA (3 full-res passes) | FXAA (1) | two fewer whole-buffer read/writes, and FXAA is no longer a blur on a blur because the frame is native |
| Grade + upscale compensation | two full-res passes | one | they are single-viewport reads of the same buffer; the compensation is a uniform of the look pass now |
| Resolution | 0.90 floor by default | native by default | a frame over budget needs a cheaper frame, not a smaller one — and an unpicked trade is a blur (ADR-0017) |

`tests/unit/quality.test.ts` enforces the ceilings in that table, because a budget that
exists only in prose is a budget that gets spent again. The pass order and the sample counts
are reported at runtime by `window.__IV__.renderDebug()`, which is what
`docs/CAPTURE_REQUEST.md` phase 04 asks for.

Bloom stays on at every tier on purpose: the prototype's amber/teal look depends on it,
and it is cheaper than the shadows it would replace. Shadows are the first thing to go,
not bloom. Its kernel is bounded as well (0.42 strength, 0.36 radius, 1.0 threshold, one
shared rig — ADR-0019), so what the frame pays for is a `BLOOM_SCALE` half-resolution blur
of a tighter region rather than a second scene-wide pass.

### Light budget (Phase 02)

Lights are the *other* cost that does not show up in the draw-call model: each one is
another per-fragment add in the forward pass, and a light that is added to the scene
recompiles every material that sees it. The rig therefore has a fixed shape per tier
(`packages/render/src/quality.ts`) and switches visibility rather than adding lights.

| Tier | key | ambient | lamps | window pool | fire | muzzle/boom | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 1 | 2 (never shadowed) | 0 | 1 | 2 | 7 |
| medium | 1 | 1 | 2 | 2 | 1 | 2 | 9 |
| high | 1 | 1 | 4 | 4 | 1 | 2 | 13 |
| cinematic | 1 | 1 | 8 | 6 | 1 | 2 | 19 |

- **The key is the only shadow caster.** Everything else is unshadowed, so adding a lamp
  costs fragments and nothing else.
- **The lamp budget only decides how many lamp props get a real light**; lamps are emissive
  at every tier, so a tier with 2 lit lamps still shows 2 lit lamps.
- **The window pool follows the player** (re-ranked 4× a second, not per frame) and any
  slot with no window near it is switched off, so an empty corner of the map pays nothing.
- **Cost of spending less, in order**: drop `windowLightBudget` (subtle by design — it is
  the first thing nobody misses), then `lampLightBudget` (visible: an unlit lamp is
  emissive-only and stops lighting its pavement), then `shadowMapSize`.
- Per-tier values are asserted in `tests/unit/lighting.test.ts` (budgets non-decreasing up
  the tiers, key above ambient, bloom threshold above the midtone); the *visual* effect of
  each group is measured by `npm run shots --probe=lighting`.

Adaptive resolution scales 0.7–1.0 of the render target to hold the frame time (it
samples 30 frames before acting, so a single hitch does not change resolution) — and only
in `dynamic` mode; `native` locks it at 1.0 (ADR-0017).
`window.__IV__.renderer()` exposes `fps`, `frameMs`, `drawCalls`, `triangles`,
`programs`, `resolutionScale`, `particles`, `enemies` and `quality` — the devtools
"Sim performance" panel and the e2e quality test read exactly that.

### Measured (realism pass, `high`, 1280×720, headless Chrome / SwiftShader)

`npm run shots -- --url=http://localhost:5173` prints these numbers, the scene census and
the image metrics for every capture:

| Metric | Measured | Notes |
| --- | --- | --- |
| draw calls | 242 (2 hostiles) → 580 (14 hostiles) | the arena's share is flat |
| triangles | 370k (2 hostiles) → 620k (14 hostiles) | ~17k per hostile |
| arena draw calls | 42 batched meshes + 67 live objects | barrels, gate glows, dust, banners |
| particles | 2 draw calls, any count | one point cloud per blend mode |
| frame time | 10–25 ms (SwiftShader software rasteriser) | deliberately *not* a GPU number |

Scene census from the same run (14 hostiles), which is how the table above was derived:

```
scene census: 558 drawable objects
  enemy:393       14 hostiles (bodies, health bars, lasers, corpses still fading)
  arena:95        live objects: dust cloud, gate/street-lamp glows, barrels, banners
  arena_static:42 merged meshes: one per (material, shadow flags) for the whole level
  unnamed:15      ground, sky dome, sun sprite, stars
  viewmodel_m4_vanguard:10
  points:3        particles (additive + normal) and dust
```

### Draw-call model

The arena is batched by material (`packages/render/src/batch.ts`), so its cost is
independent of how many props a map declares. The variable term is hostiles, and each is
**one draw call per material per animated bone** (torso, two arms, two legs) plus its
health bar, aim laser and laser dot:

```
draw calls ≈ 130 (arena + fx + viewmodel, flat)  +  30 × live hostiles
```

That is ≈ 580 at 15 hostiles. It is *the* number to watch, and it is 4× the ≤ 220 this
document used to claim: that figure assumed one merged mesh per *prop*, which detailed
characters cannot honour. Ways to spend less, in order of effort:

1. **Health bars only when damaged** — done, and it reads better too.
2. **Merge the two uniform tones and the two gear materials per bone** — ≈ 6 fewer per
   hostile, at the cost of the value variation that makes the silhouette readable.
3. **Bake per-part material variation into vertex colours** and collapse each bone to a
   single material — ≈ 15 fewer per hostile. This is what modern engine pipelines do, and
   it is the right next step *if* a real character model ever lands.
4. **Corpse cleanup sooner** — a fading corpse still costs its body's draw calls.

The same census run also caught the opposite mistake: 28 dust motes were 28 sprites. They
are one point cloud now, like the particles.

The batching has one visible rule worth remembering: **nothing that moves is batched
into something that does not**. A limb, and the magazine that leaves a weapon during a
reload, are batched only within their own transform.

Per-frame targets at `high`:

| Metric | Target | Notes |
| --- | --- | --- |
| draw calls | ≤ 150 flat + ≤ 30 per hostile | see the census above; the viewmodel is 10 |
| triangles | ≤ 700k | LOD chains from the Blender pipeline |
| particle sprites | ≤ 480 live, 2 draw calls | pooled point clouds; the prototype allocated per particle |
| decals | ≤ 20 live | pooled, oldest-first recycling; the tier cap is 6–20 |

## 4. Asset budget (M2, for the art pipeline)

| Class | LOD0 | LOD1 | LOD2 |
| --- | --- | --- | --- |
| weapon | 12k | 5k | 1.5k |
| character | 18k | 8k | 2.5k |
| prop (small) | 2k | 800 | 300 |
| prop (large) | 8k | 3k | 900 |
| kit piece | 4k | 1.5k | 500 |

Enforced at export time by `tools/blender/conform.py`; a source file over budget
fails the pipeline instead of quietly shipping.

## 5. Changing a budget

Budgets are numbers people agreed on, not laws of nature. If a change genuinely
needs more room:

1. Change the limit in the enforcing script (`scripts/budget.mjs`,
   `apps/harness/src/cli.ts`) — never delete the check.
2. Add an ADR in `docs/decisions/` explaining what it buys.
3. Update the table above, and note the new measurement in the PR description.

What is *not* acceptable: raising a limit because a change went over, without a
reason a reader can evaluate.

## 6. What the surface pass costs (Phase 08, ADR-0020)

Nothing per frame. The material library is built once from data at load, and weathering is a
handful of scalar writes on an atmosphere change — not a per-frame effect, not a shader variant and
not a second pass. The pass added materials and props rather than maps:

| | before | after | cost |
| --- | --- | --- | --- |
| texture maps authored | 20 surface sets + 3 facades | unchanged | **zero** (the new materials are variants over existing maps) |
| materials in the library | 32 | 35 (`grime`, `roadPatch`, `scorch`) | 3 `MeshStandardMaterial`s, no new textures |
| props per plaza | — | +9 sand drifts, +3 repairs, +2 burn marks per road arm | ~28 extra quads in the static batch |
| car per wreck | 1 hull + 1 glazing + 4 tyres | + a cabin (6 boxes), 4 panes, 8 sidewall discs, 4 arch splashes, a grime band | ~25 small meshes, batched |
| per frame | — | — | **no change** |

The rule this keeps is ADR-0014's: a pass may change the *look* freely, and it has to say what it
costs. This one is paid for in geometry that batches and in three materials; a tier cannot change
any of it, because a material is not an effect.

## 7. What the geometry pass costs (Phase 09, ADR-0021)

The triangle budget is the one this pass spends, and it spends it by rule rather than by object
(`DETAIL`): a bevel, a segment count and a yes/no on secondary forms, per asset tier. What it added,
and what it saved:

| | added | saved |
| --- | --- | --- |
| buildings | ~20 attached forms each (entrance, canopy, jambs, service box, grille, balcony, pilasters) | one box per window instead of one and a half — the pane is no longer duplicated by a reveal behind it |
| roads | 10 kerb segments + 10 gutters per side per arm, 1-in-6 broken with a chip | the single 124 m kerb extrusion it replaces |
| barriers | a per-barrier profile and a spalled corner one time in three | — |
| car | ~40 hardware parts per wreck (behind `DETAIL.hero.secondary`) | — |
| monument | 12 apron slabs, 8 bollards with bands, 2 benches | — |
| ground | 3 sand drifts per sandbag stack | — |
| **small parts everywhere** | — | **the bevel rule reduced radii on every part under ~20 cm**, so a 60 mm detail box is a box rather than a 20 mm-radius capsule: less geometry *and* a credible edge |

All of it lands in the existing static batch, so **draw calls do not move** and the per-frame cost is
unchanged for the same set of visible objects; triangles and the resulting vertex cost are what
changed, and the in-app devtools overlay asserts them against the runtime budget
(`docs/PERF_BUDGET.md` §3). Report the pair with any frame: `__IV__.renderer()` gives `drawCalls`,
`triangles`, `frameMs` and `resolutionScale`, and `__IV__.sceneCensus()` says what the geometry is.

## 8. The quality ladder (Phase 03 → Phase 05, ADR-0014 + ADR-0017)

A tier buys *effects*. It does not buy a different look — the lighting ratios, the grade,
the fog, bloom and the AO radii are one shared rig (`LOOK_RIG`) on every tier, and
`tests/unit/quality.test.ts` fails if two tiers disagree about any of them — and, since
ADR-0017, it does not buy a different number of pixels either. The two invariants together
are what make the setting honest: choosing a lower tier cannot make the picture soft, so
the only thing the player is deciding is which effects to spend.

| | low | medium | high | cinematic |
| --- | --- | --- | --- | --- |
| pixel ratio cap | 2 | 2 | 2 | 2 |
| MSAA samples | 0 | 0 | 2 | 4 |
| screen-space AA | FXAA | FXAA | SMAA | SMAA |
| shadow atlas | off | 1024², 55 m | 1024², 70 m | 2048², 90 m |
| ambient occlusion | off | off | 6 @ 0.5 | 8 @ 0.5 |
| real lamp / window lights | 1 / 0 | 2 / 1 | 3 / 3 | 4 / 4 |
| particles / decals | 180 / 4 | 320 / 8 | 420 / 12 | 640 / 20 |
| volumetric fog | no | no | no | yes |
| whole-buffer passes | 4 | 4 | 6 | 6 |
| adaptive floor (dynamic only) | 0.70 | 0.70 | 0.75 | 0.85 |

### The adaptive controller

The target is **16.7 ms (60 fps)**, not the 14 ms (71 fps) it used to be: the controller
was chasing a frame rate no display was showing, sat on its floor on ordinary hardware,
and rendered the whole game at 70% of native resolution to buy frames nobody saw. The
review's frames read 48–58 fps *and* were soft, which is that signature.

**It is off by default.** The controller is locked at 1.0 in `native` mode and only
released by the RESOLUTION setting (`dynamic`), because its single lever is the one thing
the player cannot compensate for and the most damaging thing to spend (ADR-0017). A slow
machine is answered by the tier's effect budget first.

When it *is* released, four guards apply, all of which exist because a resolution change is
visible:

- **Hysteresis**: three over-budget windows to step down 5%, six on-budget windows to step
  back up. A single bad window moves nothing.
- **Hold**: a preset change (3 s), a resize (0.4 s) and a mission load (1.5 s) freeze the
  controller, counted in *frame time* rather than wall clock so a paused tab does not hold
  it for the length of the pause. Without this, rebuilding the composer read as a GPU
  bottleneck, cut the resolution, and left it cut.
- **A floor of 0.70 or better on every tier**, and the HUD reports `58 FPS · 82% RES` when
  the two disagree, so a resolution cut is never mistaken for the game getting softer.
- **Upscale compensation** in the look pass, and only below `SHARPEN_BELOW_SCALE` (0.99):
  at native resolution the term is 0, because sharpening a sharp frame is how a renderer
  grows a halo on every high-contrast edge.

### What the rigs cost

- The soldier's weapon is batched separately from its arm (`enemy_rifle`), because the
  weapon's rotation in the hand is animated and a batch cannot rotate independently of the
  limb it was baked into. That is 3–4 extra draw calls per enemy on screen; the batcher
  would otherwise have merged them into the arm for free, and *then* the aim pose would
  simply not move the weapon.
- The enemy uniforms are `MeshPhysicalMaterial` (the sheen rim) rather than
  `MeshStandardMaterial`. It is a heavier shader, charged to ~9 small materials per enemy —
  not to the world.
- World-space UVs cost nothing: they are a per-geometry attribute edit at build time, and
  the alternative (cloning each surface's maps to reset `repeat`)  would have cost one GPU
  texture upload per surface.

## 9. What the surface-swing pass costs (Phase 10, ADR-0022)

This pass is almost entirely arithmetic, so its cost is almost entirely zero. The table is short
because the honest answer is short:

| | before | after | cost |
| --- | --- | --- | --- |
| roughness / metalness maps | absolute, multiplied by the material's own value | a signed swing the shader adds | **zero** — same maps, same uploads, one uniform-free shader branch |
| shader program | stock `MeshStandardMaterial` | one replaced chunk, `customProgramCacheKey = 'iron-surface-swing'` | **one program per material** instead of the stock one — the cache key is what stops three compiling the injected source and then selecting the stock program |
| asphalt texture | 512² over a 3 m tile (5.9 mm/texel) | **1024²** (2.9 mm/texel) | **one extra 1024² texture**, ~4 MB of canvas, built once at load |
| SSAO | 6 samples, `bias` 0.06 / `thickness` 0.3 | 6 samples, `bias` 0.25 / `thickness` 0.12 | **zero** — two constants; the higher bias *removes* work rather than adding it |
| AO blur | 5×5 taps, tolerance that weighted every tap to zero | 5×5 taps, tolerance from the two axial neighbours, `uBlurScale` 2.6 | **zero** — the same taps, now actually weighted |

The one real cost is stated rather than hidden: **asphalt is the only map in the build that grew**, 512²
→ 1024², and it grew because the defect was a texel-density defect — 7,000 relief-embossed stones at
radius 1.5–5.6 px is a 30–45° normal perturbation every two texels, and no amount of post-processing
fixes a surface drawn below the sampling rate. Everything else in the pass is a constant, a
replacement or a tolerance. A tier still buys none of it, because a material is not an effect
(ADR-0014/0017).
