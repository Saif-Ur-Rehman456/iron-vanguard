/**
 * What each surface *is*, as data (ADR-0020).
 *
 * The seventh review's core finding was that the materials were different colours of the
 * same response: road, sand, concrete, a car body and a weapon all answered the same light
 * the same way, so nothing read as a different *physical thing*. The cause was where the
 * numbers lived — a surface's roughness, metalness and normal strength were spread across
 * the recipe's draw function, the `SurfaceOptions` beside it, and a per-material override in
 * `materials.ts`, with no single place that said "this is what asphalt is".
 *
 * This module is that place, and it is deliberately *data*: no canvas, no three.js, no DOM.
 * That means a test can read it in Node and assert the things a reviewer would otherwise
 * have to see:
 *
 *  - **metals are metals and dielectrics are not.** A `metalness` of 0.35 is not a physical
 *    material, it is a compromise, and it is what makes a surface read as dirty plastic.
 *  - **the roughness spread is real.** Asphalt and glass are 0.9 and 0.06 apart; if two
 *    classes land within a few hundredths of each other, the player cannot tell them apart
 *    and the review's first complaint is back.
 *  - **every surface tells its story at three scales.** `macro` (stains, polish, repairs,
 *    compaction), `mid` (scuffs, panels, small damage) and `micro` (grain and pores). A
 *    surface with only `micro` is noise, which is exactly the car body's problem.
 *  - **the scale is real-world.** `UV_DENSITY` / `UV_PIXELS` (materials.ts) hold the metres
 *    per tile and the pixels, so a grain's physical size is a division, not an opinion.
 */
import { saturate } from '@iron/core';

/** The surface classes the world's materials are built from. */
export type SurfaceClass =
  | 'ground'
  | 'asphalt'
  | 'sand'
  | 'concrete'
  | 'plaster'
  | 'stone'
  | 'building'
  | 'wood'
  | 'sandbag'
  | 'steel'
  | 'carPaint'
  | 'water'
  | 'gunmetal'
  | 'polymer'
  | 'rubber'
  | 'fabric'
  | 'leather'
  | 'skin'
  | 'rust';

/**
 * Relative amplitudes of the three storytelling scales, 0..1.
 *
 * Not a texture detail budget: a *statement* about which scale the surface's character
 * lives at. A wall's is macro (formwork stains, weathering spans); a sandbag's is micro
 * (weave); a car body's is mid (panel scuffs, chips) with almost no micro, because a
 * painted panel is smooth — and that is the number the review's "the car is a repeated
 * noise texture" is about.
 */
export interface SurfaceLayers {
  macro: number;
  mid: number;
  micro: number;
}

/** The physical identity of one surface class. */
export interface SurfaceSpec {
  /**
   * What it is made of, in one word. Kept because it is the check that catches a fudge:
   * a `metal` with a metalness under 0.5 or a `coated` surface with the roughness of
   * stone is a mistake the family makes visible.
   */
  family:
    | 'mineral'
    | 'aggregate'
    | 'granular'
    | 'organic'
    | 'textile'
    | 'elastomer'
    | 'metal'
    | 'coated'
    | 'glass'
    | 'liquid';
  /** Base roughness the map is authored around, 0..1. */
  roughness: number;
  /** How much the relief field moves roughness (worn edges vs recessed pits). */
  roughnessVariation: number;
  /** How much the painted roughness field moves it (dirt, polish, water, wear). */
  roughnessField: number;
  /**
   * Metalness, and the field it is read against.
   *
   * `'material'` means the number *is* the surface's metalness: 0 for a dielectric, >= 0.9
   * for a metal, and nothing in between, because nothing in the world is 35% metal — a
   * middling value is how a surface ends up reading as dirty plastic (the review's "metal
   * aur non-metal clearly differentiate nahi ho rahe").
   *
   * `'coating'` means the number is the *substrate* and the metalness field holds the
   * coating: painted steel is 1.0 with a field of ~0.12, so a chip through the paint to
   * bare steel is a change of material rather than a change of colour. The test asserts
   * that a `'coating'` class is exactly 1.0, which is what keeps the two readings from
   * quietly becoming the fudge the mode exists to forbid.
   */
  metalness: number;
  /** Absent means `'material'`: only the coated classes need to declare it. */
  metalnessMode?: 'material' | 'coating';
  /** Relief strength for the derived normal map. */
  relief: number;
  /** Normal-map strength the material uses. */
  normalScale: number;
  /** How much of the sky this surface may reflect. */
  envIntensity: number;
  layers: SurfaceLayers;
}

/**
 * The table. Every number here is a material *property*, so the comments say what the
 * surface is rather than what it should look like — the looking-after is `materials.ts`.
 */
export const SURFACE_SPEC: Record<SurfaceClass, SurfaceSpec> = {
  // Granite flags and mortar. A mineral: matte, non-metallic, and its character is in the
  // joints and the weathering spans, not in its grain.
  ground: {
    family: 'mineral',
    roughness: 0.94,
    roughnessVariation: 0.2,
    roughnessField: 0.35,
    metalness: 0,
    relief: 1.1,
    normalScale: 0.9,
    envIntensity: 0.7,
    layers: { macro: 0.55, mid: 0.35, micro: 0.3 },
  },
  // Asphalt: an aggregate bound in bitumen. Rough and dark when dry; the aggregate is
  // read at the micro scale, the repairs and wheel tracks at macro and mid.
  //
  // The swing terms are the road's *weather*, and both came down from a report. At
  // `variation` 0.3 and `field` 0.6 a texel could move the gloss by ±0.75 — and since the
  // dusk preset already pulls asphalt from 0.9 to 0.63 (it is a damp night), the low tail
  // landed at 0.03: a mirror patch on the one surface that fills the bottom half of every
  // frame. The road still has its polished wheel tracks and its dull patches; they are a
  // sheen at 0.3 now rather than a hole in the light.
  asphalt: {
    family: 'aggregate',
    roughness: 0.9,
    roughnessVariation: 0.2,
    roughnessField: 0.4,
    metalness: 0,
    relief: 0.9,
    normalScale: 0.8,
    envIntensity: 0.75,
    layers: { macro: 0.6, mid: 0.5, micro: 0.45 },
  },
  // Sand: granular, and the *only* class whose macro layer is the point of it — dunes,
  // compaction and tyre/foot traffic are all large-scale stories, and a sand texture
  // without them is beige paint with a grain.
  sand: {
    family: 'granular',
    roughness: 1,
    roughnessVariation: 0.12,
    roughnessField: 0.45,
    metalness: 0,
    relief: 0.7,
    normalScale: 1.1,
    envIntensity: 0.55,
    layers: { macro: 0.7, mid: 0.4, micro: 0.5 },
  },
  // Poured concrete: matte to the point of being chalky, with formwork seams and chipped
  // corners. Deliberately the least reflective wall in the build.
  concrete: {
    family: 'mineral',
    roughness: 0.92,
    roughnessVariation: 0.18,
    roughnessField: 0.4,
    metalness: 0,
    relief: 1.2,
    normalScale: 1.1,
    envIntensity: 0.6,
    layers: { macro: 0.5, mid: 0.45, micro: 0.3 },
  },
  plaster: {
    family: 'mineral',
    roughness: 0.95,
    roughnessVariation: 0.15,
    roughnessField: 0.35,
    metalness: 0,
    relief: 1.1,
    normalScale: 1,
    envIntensity: 0.6,
    layers: { macro: 0.55, mid: 0.4, micro: 0.25 },
  },
  stone: {
    family: 'mineral',
    roughness: 0.92,
    roughnessVariation: 0.2,
    roughnessField: 0.35,
    metalness: 0,
    relief: 1.25,
    normalScale: 1.2,
    envIntensity: 0.6,
    layers: { macro: 0.5, mid: 0.45, micro: 0.35 },
  },
  // A building wall: the same family as concrete, at the density a wall is looked at from.
  building: {
    family: 'mineral',
    roughness: 0.9,
    roughnessVariation: 0.14,
    roughnessField: 0.4,
    metalness: 0,
    relief: 0.9,
    normalScale: 1.4,
    envIntensity: 0.6,
    layers: { macro: 0.55, mid: 0.45, micro: 0.25 },
  },
  wood: {
    family: 'organic',
    roughness: 0.85,
    roughnessVariation: 0.25,
    roughnessField: 0.4,
    metalness: 0,
    relief: 1.3,
    normalScale: 1.2,
    envIntensity: 0.7,
    layers: { macro: 0.5, mid: 0.5, micro: 0.3 },
  },
  sandbag: {
    family: 'textile',
    roughness: 1,
    roughnessVariation: 0.12,
    roughnessField: 0.3,
    metalness: 0,
    relief: 0.9,
    normalScale: 1.1,
    envIntensity: 0.55,
    layers: { macro: 0.45, mid: 0.4, micro: 0.45 },
  },
  // Painted steel: a dielectric *coating* over a conductor. The substrate is steel (1.0)
  // and the field is the paint, so a chip through it is a different material — and the
  // chips are the point of the material.
  steel: {
    family: 'coated',
    roughness: 0.5,
    roughnessVariation: 0.25,
    roughnessField: 0.5,
    metalness: 1,
    metalnessMode: 'coating',
    relief: 0.8,
    normalScale: 0.7,
    envIntensity: 1,
    layers: { macro: 0.5, mid: 0.55, micro: 0.3 },
  },
  // Car paint: a clearcoat over a base coat over steel. The lowest relief in the build and
  // the lowest micro amplitude — a car body is *smooth*, and the review's "it is a repeated
  // noise texture" was a stippled polymer map carrying its grain onto a painted panel.
  // Metalness 1 with mode `'coating'`: the *substrate* is steel and the metalness map is the
  // paint, so a chip through the coat is a change of material. (This comment said "0.3
  // stands in for metallic flake", which is the exact fudge `metalnessMode` exists to
  // forbid — and the test that requires a coating class to be exactly 1.0 is why the number
  // and the sentence cannot drift apart again.)
  carPaint: {
    family: 'coated',
    roughness: 0.34,
    roughnessVariation: 0.12,
    roughnessField: 0.5,
    metalness: 1,
    metalnessMode: 'coating',
    relief: 0.5,
    normalScale: 0.45,
    envIntensity: 1.3,
    layers: { macro: 0.5, mid: 0.5, micro: 0.2 },
  },
  // Water: a *dielectric*. Metalness 0 with a high environment intensity is how Fresnel is
  // said with a standard material — weak head-on, strong at grazing — and it is why a
  // puddle reflects the sky instead of being a grey disc.
  water: {
    family: 'liquid',
    roughness: 0.06,
    roughnessVariation: 0.1,
    roughnessField: 0.3,
    metalness: 0,
    relief: 0.3,
    normalScale: 0.2,
    envIntensity: 1.9,
    layers: { macro: 0.3, mid: 0.3, micro: 0.2 },
  },
  // Weapon-grade metal: oiled, machined, and the shiniest thing the player owns. Its
  // roughness is *declared* here and modulated by the field, which is what lets a worn
  // edge read differently from a fresh face on the same part.
  gunmetal: {
    family: 'metal',
    roughness: 0.42,
    roughnessVariation: 0.3,
    roughnessField: 0.5,
    metalness: 0.95,
    relief: 0.4,
    normalScale: 0.6,
    envIntensity: 1.25,
    layers: { macro: 0.4, mid: 0.4, micro: 0.3 },
  },
  polymer: {
    family: 'organic',
    roughness: 0.8,
    roughnessVariation: 0.15,
    roughnessField: 0.35,
    metalness: 0,
    relief: 0.8,
    normalScale: 1.1,
    envIntensity: 0.95,
    layers: { macro: 0.4, mid: 0.4, micro: 0.45 },
  },
  rubber: {
    family: 'elastomer',
    roughness: 0.96,
    roughnessVariation: 0.15,
    roughnessField: 0.4,
    metalness: 0,
    relief: 1.2,
    normalScale: 1.2,
    envIntensity: 0.85,
    layers: { macro: 0.45, mid: 0.45, micro: 0.4 },
  },
  fabric: {
    family: 'textile',
    roughness: 0.96,
    roughnessVariation: 0.12,
    roughnessField: 0.3,
    metalness: 0,
    relief: 0.7,
    normalScale: 0.9,
    envIntensity: 0.75,
    layers: { macro: 0.4, mid: 0.35, micro: 0.5 },
  },
  leather: {
    family: 'organic',
    roughness: 0.72,
    roughnessVariation: 0.3,
    roughnessField: 0.45,
    metalness: 0,
    relief: 0.9,
    normalScale: 1,
    envIntensity: 0.85,
    layers: { macro: 0.5, mid: 0.45, micro: 0.35 },
  },
  skin: {
    family: 'organic',
    roughness: 0.62,
    roughnessVariation: 0.2,
    roughnessField: 0.4,
    metalness: 0,
    relief: 0.5,
    normalScale: 0.6,
    envIntensity: 0.65,
    layers: { macro: 0.35, mid: 0.3, micro: 0.5 },
  },
  // Iron oxide is not a metal: rust is a dielectric, and modelling it as one is why rusted
  // sheet reads as *corrosion* rather than as dark grey metal. The raw steel shows through
  // the metalness *field*, which is what a flake of rust falling off actually reveals.
  rust: {
    family: 'coated',
    roughness: 0.88,
    roughnessVariation: 0.3,
    roughnessField: 0.5,
    metalness: 1,
    metalnessMode: 'coating',
    relief: 1.2,
    normalScale: 1.2,
    envIntensity: 0.65,
    layers: { macro: 0.6, mid: 0.5, micro: 0.4 },
  },
};

/** Every class, in a stable order (so a report reads the same twice). */
export const SURFACE_CLASSES = Object.keys(SURFACE_SPEC) as SurfaceClass[];

/** The layer amplitude at which a recipe's own authored numbers are used unchanged. */
export const LAYER_BASELINE = 0.5;

/**
 * The three scales' amplitudes as multipliers on what a recipe authored.
 *
 * The declaration in `layers` would be a second place for the same statement if nothing read
 * it, which is the *exact* sin this whole system exists to undo — so it is consumed: the
 * recipe decides the *shape* of a layer (how many patches, what radius, what colour) and the
 * class decides how strongly that layer speaks, relative to `LAYER_BASELINE`.
 *
 * A class at 0.5 is a class whose recipe numbers are already right, which is most of them.
 * The two ends are the interesting ones, and both are reports: sand's macro is 0.7, because
 * "sand is beige with a grain" was a surface whose large-scale story did not exist (gain
 * 1.4), and car paint's micro is 0.2, because a painted panel carrying a stippled polymer's
 * grain at full strength is what the seventh review measured as "a repeated noise texture"
 * (gain 0.4).
 */
export function layerGain(layers: SurfaceLayers): SurfaceLayers {
  return {
    macro: layers.macro / LAYER_BASELINE,
    mid: layers.mid / LAYER_BASELINE,
    micro: layers.micro / LAYER_BASELINE,
  };
}

/**
 * Weathering: the atmosphere's effect on a surface, as two numbers.
 *
 * The seventh review asked for the material work in *both* atmospheres, and this is where
 * that is decided. Materials themselves are physical and do not change with the hour — but
 * a *wet* surface is a different surface: water is the great equaliser of roughness, so the
 * same asphalt is glossier at 0400 after rain than at 0900, and settled dust does the
 * opposite, roughening and dulling whatever it lands on.
 *
 * Kept as a pure function rather than a set of per-material overrides because the test then
 * does not need a GPU: `weathered()` is arithmetic, so "the wet preset is glossier than the
 * dry one and no two classes collapse into each other" is a check, not a screenshot.
 */
export interface Weathering {
  /** 0 = dry, 1 = standing water and a sheen on every hard surface. */
  wetness: number;
  /** 0 = clean air, 1 = a dust storm's worth of settled dust. */
  dust: number;
}

export const WEATHER = {
  /**
   * The roughness standing water pulls a rough surface toward, at full wetness.
   *
   * A target rather than a delta, and the difference is the whole physics. The first version
   * of this moved a surface by `pull * wet * (1 - roughness)` — i.e. in proportion to how
   * *smooth* it already was — so sand at 1.0 did not move at all when wet while the road at
   * 0.9 barely did, and the only surface the rain could touch was one that was already
   * glossy. `tests/unit/surfaces.test.ts` caught it as "sand wet: expected 1 to be less than
   * 1". Water does not polish what is already polish: it fills the *pits* that made a rough
   * surface rough, so a wet surface approaches this value from above and a surface already
   * smoother than it does not move (smooth water stays smooth).
   */
  wetRoughness: 0.3,
  /**
   * How much more sky a wet surface reflects.
   *
   * 0.35 rather than the 0.55 the first version used. Every outdoor surface gains this at
   * dusk, and a *quarter* more sky on the ground, the walls and every barrier is a visible
   * brightening of the whole scene — which is a lighting change wearing a material pass's
   * clothes. A sheen has to be a property of the surface, not a raise on the world's
   * exposure.
   */
  wetEnvGain: 0.35,
  /** How much rougher a fully dusted surface gets. */
  dustRoughnessGain: 0.05,
  /** How much duller, as a share of the surface's own reflection. */
  dustEnvLoss: 0.3,
} as const;

export interface WeatheredSurface {
  roughness: number;
  envIntensity: number;
}

/**
 * The surface as the weather leaves it.
 *
 * Note that a *rough* surface gains the most gloss and a smooth one does not move: sand at
 * 1.0 comes down to 0.3 when wet, while water at 0.06 stays at 0.06. That asymmetry is the
 * physical statement — water fills the pits that made the surface rough — and it is also
 * what keeps the classes apart under both atmospheres.
 */
export function weathered(spec: SurfaceSpec, weather: Weathering): WeatheredSurface {
  const wet = saturate(weather.wetness);
  const dust = saturate(weather.dust);
  const wetTarget = Math.min(spec.roughness, WEATHER.wetRoughness);
  const roughness = saturate(
    spec.roughness +
      (wetTarget - spec.roughness) * wet +
      WEATHER.dustRoughnessGain * dust,
  );
  const envIntensity = Math.max(
    0,
    spec.envIntensity * (1 + WEATHER.wetEnvGain * wet - WEATHER.dustEnvLoss * dust),
  );
  return { roughness, envIntensity };
}

/** The surface classes the weather is allowed to touch: everything outdoors. */
export const WEATHERED_CLASSES: SurfaceClass[] = [
  'ground',
  'asphalt',
  'sand',
  'concrete',
  'plaster',
  'stone',
  'building',
  'wood',
  'sandbag',
  'steel',
  'carPaint',
  'water',
  'rubber',
  'rust',
];
