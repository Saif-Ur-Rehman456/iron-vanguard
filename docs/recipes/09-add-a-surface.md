# Recipe 09 — Add a surface

**Time:** ~40 minutes · **Risk:** low · **Touches:** `packages/content/src/surfaces.ts`,
`packages/audio/src/sfx.ts`, `packages/render/src/materials/*`, `packages/sim/src/ballistics.ts`

A surface is a material *class*, not a mesh. Bullets ask the surface what happened —
decals, particles, penetration, ricochet, audio — so art can change without touching
gameplay, and gameplay can be tuned without touching art.

## Steps

1. **Add a `SurfaceDef`** to `SURFACES`: `impactColor`, `decalColor`, `decalOpacity`,
   `decalSize`, `ricochetChance` (0..1), `penetrationLoss` (metres) and `audio`
   (a cue id — see recipe 14).

2. **Give it an impact cue.** Cues of the form `impact_<surfaceId>` are synthesised by
   `SURFACE_IMPACTS` in `packages/audio/src/sfx.ts`. Adding the row there is what makes
   the new surface *sound* different; without it the audio falls back to concrete.

3. **Map props and ground to it.** `MapDef.groundSurface` names the floor surface;
   props carry their material implicitly per kind. If you need a specific prop to use a
   new surface, wire that mapping where the shootable boxes are built
   (`sim/ballistics.ts` / the arena), not in the prop data — surface is a property of
   what a thing *is*, and prop kind already implies that.

4. **Choose numbers with intent:**

   - `penetrationLoss` competes with the weapon's `ballistics.penetration`; a value
     above the weapon's penetration means "never shoots through" (good for concrete).
   - `ricochetChance` above ~0.2 makes a surface feel actively dangerous to the
     player, especially in enclosed spaces.
   - `decalSize` is in metres; too large and bullet holes read as paint.

5. **Check the renderer materials.** `render/materials/materials.ts` builds a material
   per class (roughness/metalness/wear). A surface with no material entry still
   functions but looks default-grey.

## Verify

```bash
npm run content:validate
npm test -- tests/unit/ballistics.test.ts    # penetration + ricochet behaviour
npm run dev                                  # shoot it: decal, spark, sound
```

Add a ballistics test asserting the new surface's penetration loss behaves as
documented — the existing tests for soft cover are the template.

## Traps we have hit

- **A surface id used by a map but missing from `SURFACES`** is caught by validation
  only if it is the ground surface; a bad prop mapping silently falls back.
- **Ricochet needs a stable normal.** Surfaces on thin props can produce a ricochet
  direction the player cannot understand; if it feels random, lower the chance rather
  than adding randomness.
