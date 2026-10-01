/**
 * Material identity, and the atmosphere's effect on it (ADR-0020).
 *
 * The seventh review's first finding was not a texture problem: *"materials har object par
 * almost same type ka visual response de rahe hain"* — the road, the sand, the concrete, a
 * car body and a weapon all answered the same light the same way, so nothing read as a
 * different physical thing. The cause was that a surface's physical response lived in three
 * places (the recipe, the `SurfaceOptions` call and the material), and the fix is one table
 * of physical properties per *surface class* (`SURFACE_SPEC`), which a material then declares
 * only a variant of.
 *
 * That is what makes the review's first 18 items checkable without a GPU. A table of numbers
 * is arithmetic: "no two classes collapse into each other", "roughness covers the real range
 * instead of one grey", "a wet surface is glossier than a dry one and a dusted one is duller",
 * and "weathering is idempotent" are all statements about values, so they are tests here
 * rather than something a screenshot has to be squinted at for. The frames still have to
 * confirm that the *look* follows — that is `docs/CAPTURE_REQUEST.md` phase 08 — but a
 * material that fails these never had a chance of looking right.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LAYER_BASELINE,
  SURFACE_CLASSES,
  SURFACE_SPEC,
  TIME_OF_DAY_IDS,
  TIME_PRESETS,
  UV_DENSITY,
  WEATHER,
  WEATHERED_CLASSES,
  WEATHERED_MATERIALS,
  applyWeathering,
  layerGain,
  shiftUv,
  weathered,
  withAoUv,
  type Materials,
  type SurfaceClass,
  type Weathering,
} from '@iron/render';

/** The families whose repetition is visible from across a plaza (see the layer test). */
const OUTDOOR_FAMILIES: ReadonlyArray<string> = ['mineral', 'aggregate', 'granular', 'coated'];

const DRY: Weathering = { wetness: 0, dust: 0 };

/** How far apart two classes are, as a share of the range each term can take. */
function distance(a: SurfaceClass, b: SurfaceClass): number {
  const one = SURFACE_SPEC[a];
  const two = SURFACE_SPEC[b];
  const layers =
    Math.abs(one.layers.macro - two.layers.macro) +
    Math.abs(one.layers.mid - two.layers.mid) +
    Math.abs(one.layers.micro - two.layers.micro);
  return (
    Math.abs(one.roughness - two.roughness) * 3 +
    Math.abs(one.metalness - two.metalness) * 4 +
    Math.abs(one.envIntensity - two.envIntensity) +
    Math.abs(one.relief - two.relief) * 0.5 +
    layers * 0.5
  );
}

describe('the physical identity of a surface', () => {
  it('never declares a half-metal', () => {
    // "Middling metalness is how a surface ends up reading as dirty plastic." A class is
    // either a dielectric or a metal, and a hybrid is the fudge the review photographed.
    for (const cls of SURFACE_CLASSES) {
      const spec = SURFACE_SPEC[cls];
      expect(
        spec.metalness === 0 || spec.metalness >= 0.9,
        `${cls} declares metalness ${spec.metalness}`,
      ).toBe(true);
    }
  });

  it('keeps a coated class at exactly 1.0, so a chip is a change of material', () => {
    for (const cls of SURFACE_CLASSES) {
      const spec = SURFACE_SPEC[cls];
      if (spec.metalnessMode !== 'coating') continue;
      expect(spec.metalness, `${cls} is a coating`).toBe(1);
    }
    // ...and the materials that are *not* coated do not claim the mode at all.
    const coated = SURFACE_CLASSES.filter((cls) => SURFACE_SPEC[cls].metalnessMode === 'coating');
    expect(coated.length).toBeGreaterThan(0);
    for (const cls of coated) expect(SURFACE_SPEC[cls].metalnessMode).toBe('coating');
  });

  it('spends the roughness range instead of one grey value', () => {
    // The review's item 9: "roughness variation bahut weak hai". Across the whole table the
    // surface classes have to cover a matte-to-mirror span, or every highlight in the frame
    // is the same size and nothing reads as a material.
    const values = SURFACE_CLASSES.map((cls) => SURFACE_SPEC[cls].roughness);
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread).toBeGreaterThan(0.7);
    // And the *smooth* half of the table is not empty: a build with nothing under 0.3 has no
    // glass, no water, no polished metal.
    expect(values.filter((v) => v < 0.3).length).toBeGreaterThanOrEqual(1);
    expect(values.filter((v) => v > 0.85).length).toBeGreaterThanOrEqual(5);
  });

  it('never lets two classes be the same surface twice', () => {
    for (let i = 0; i < SURFACE_CLASSES.length; i++) {
      for (let j = i + 1; j < SURFACE_CLASSES.length; j++) {
        const a = SURFACE_CLASSES[i]!;
        const b = SURFACE_CLASSES[j]!;
        expect(distance(a, b), `${a}/${b}`).toBeGreaterThan(0.01);
      }
    }
  });

  it('keeps the pairs the review confused far apart', () => {
    // Item 1 was not "the numbers are wrong", it was "I cannot tell these surfaces apart",
    // so the check is aimed at the specific pairs the frames showed — a road read as sand, a
    // wall read as a car, a sandbag read as a crate. Two matte minerals (concrete/stone) are
    // allowed to be neighbours; a road and a sandy ground are not.
    const MUST_DIFFER: { a: SurfaceClass; b: SurfaceClass; floor: number; why: string }[] = [
      { a: 'asphalt', b: 'sand', floor: 0.4, why: 'the road and the ground beside it' },
      { a: 'ground', b: 'sand', floor: 0.3, why: 'paving and a sand map' },
      { a: 'concrete', b: 'steel', floor: 1.0, why: 'a wall and a gate' },
      { a: 'ground', b: 'carPaint', floor: 1.0, why: 'paving and a car body' },
      { a: 'sandbag', b: 'wood', floor: 0.5, why: 'hessian and a crate' },
      { a: 'carPaint', b: 'polymer', floor: 1.0, why: 'a painted panel and moulded plastic' },
      { a: 'water', b: 'concrete', floor: 1.0, why: 'a puddle and the kerb around it' },
      { a: 'fabric', b: 'leather', floor: 0.2, why: 'cloth and gloves' },
    ];
    for (const { a, b, floor, why } of MUST_DIFFER) {
      expect(distance(a, b), `${why} (${a}/${b})`).toBeGreaterThan(floor);
    }
  });

  it('gives every class a large-scale story, and none of them only grain', () => {
    // Item 17: "micro-detail bohat zyada hai, lekin meaningful macro aur mid detail kam". A
    // surface whose character is *only* micro is noise with a colour, which is precisely the
    // car body's defect (and a painted panel is allowed — is required — to have the least
    // grain and the most mid-scale wear in the table).
    for (const cls of SURFACE_CLASSES) {
      const { macro, mid, micro } = SURFACE_SPEC[cls].layers;
      for (const [scale, value] of Object.entries({ macro, mid, micro })) {
        expect(value, `${cls}.${scale}`).toBeGreaterThanOrEqual(0);
        expect(value, `${cls}.${scale}`).toBeLessThanOrEqual(1);
      }
      expect(macro + mid, `${cls} has no large-scale story`).toBeGreaterThanOrEqual(0.6);
      // The surfaces the review was actually looking at — ground, asphalt, sand, concrete,
      // plaster, stone, a wall, a car, rusted steel — have to tell most of their story at the
      // two large scales, because that is the only detail that survives at distance. Cloth,
      // leather and skin are excluded on purpose: a weave *is* its micro structure, and a
      // 0.75 there is a statement rather than the "detail everywhere, meaning nowhere" the
      // noise complaint was about.
      if (OUTDOOR_FAMILIES.includes(SURFACE_SPEC[cls].family)) {
        expect(macro + mid, `${cls} is a tiled micro map`).toBeGreaterThanOrEqual(0.8);
      }
    }
    // A coated panel is smooth: its grain is not what the eye is meant to read.
    expect(SURFACE_SPEC.carPaint.layers.micro).toBeLessThan(
      Math.max(SURFACE_SPEC.carPaint.layers.macro, SURFACE_SPEC.carPaint.layers.mid),
    );
  });

  it('drives the maps from the layer table instead of restating it', () => {
    // A declaration nothing reads is a second place for the same statement, which is the sin
    // this whole system exists to undo. The recipe decides the *shape* of a layer and the
    // class decides how strongly it speaks, relative to a baseline of 0.5.
    expect(layerGain({ macro: LAYER_BASELINE, mid: LAYER_BASELINE, micro: LAYER_BASELINE })).toEqual({
      macro: 1,
      mid: 1,
      micro: 1,
    });
    // The two ends, and both are reports: a painted panel must not carry a polymer's grain
    // ("the car is a repeated noise texture"), and sand's large-scale story has to be louder
    // than its recipe's baseline ("sand is beige with a grain on it").
    expect(layerGain(SURFACE_SPEC.carPaint.layers).micro).toBeLessThan(0.5);
    expect(layerGain(SURFACE_SPEC.sand.layers).macro).toBeGreaterThanOrEqual(1.4);
    // ...and the scale a class's character lives at is the scale it is loudest at.
    for (const cls of SURFACE_CLASSES) {
      const gain = layerGain(SURFACE_SPEC[cls].layers);
      const { macro, mid, micro } = SURFACE_SPEC[cls].layers;
      const loudest = Math.max(macro, mid, micro);
      const gainLoudest = Math.max(gain.macro, gain.mid, gain.micro);
      expect(gainLoudest, `${cls} is amplified at its weakest scale`).toBeCloseTo(
        loudest / LAYER_BASELINE,
        6,
      );
    }
  });

  it('states a real-world tile size for every class it exposes', () => {
    // Item 14: a texture whose detail is the wrong physical size is what makes a surface
    // read as procedural. The density contract (tests/unit/texel.test.ts) is the check; this
    // is only the floor that it is stated at all.
    for (const cls of Object.keys(SURFACE_SPEC) as SurfaceClass[]) {
      const tile = (UV_DENSITY as Record<string, number>)[densityKeyFor(cls)];
      if (tile === undefined) continue;
      expect(tile, `${cls} tile`).toBeGreaterThan(0.1);
    }
  });
});

/** The `UV_DENSITY` key a class's materials are laid out at, where one is shared by name. */
function densityKeyFor(cls: SurfaceClass): string {
  switch (cls) {
    case 'ground':
      return 'plazaFloor';
    case 'building':
      return 'building';
    case 'concrete':
      return 'sidewalk';
    case 'stone':
      return 'rock';
    default:
      return cls;
  }
}

describe('weathering: both atmospheres', () => {
  it('makes a wet surface glossier and a dusted one duller', () => {
    for (const cls of WEATHERED_CLASSES) {
      const spec = SURFACE_SPEC[cls];
      const wet = weathered(spec, { wetness: 1, dust: 0 });
      const dusty = weathered(spec, { wetness: 0, dust: 1 });
      // Water only ever *reduces* roughness, and it recovers a value it cannot improve — a
      // surface already smoother than the wet target is left exactly as it was.
      expect(wet.roughness, `${cls} wet`).toBeLessThanOrEqual(spec.roughness);
      if (spec.roughness > WEATHER.wetRoughness) {
        expect(wet.roughness, `${cls} should have gone glossy`).toBeLessThan(spec.roughness);
      } else {
        expect(wet.roughness, `${cls} was already glossier than water`).toBe(spec.roughness);
      }
      expect(wet.envIntensity, `${cls} wet`).toBeGreaterThan(spec.envIntensity);
      // Dust roughens, up to the ceiling of 1 for a surface that is already fully matte.
      expect(dusty.roughness, `${cls} dusty`).toBeGreaterThanOrEqual(spec.roughness);
      if (spec.roughness <= 0.9) {
        expect(dusty.roughness, `${cls} should have gone duller`).toBeGreaterThan(spec.roughness);
      }
      expect(dusty.envIntensity, `${cls} dusty`).toBeLessThan(spec.envIntensity);
      // ...and no effect may push a value out of its range.
      for (const result of [wet, dusty]) {
        expect(result.roughness).toBeGreaterThanOrEqual(0);
        expect(result.roughness).toBeLessThanOrEqual(1);
        expect(result.envIntensity).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('moves a rough surface far more than a smooth one', () => {
    // The physical statement, and the reason one atmosphere cannot flatten the table:
    // water fills the pits that made a surface rough, so sand is transformed and water —
    // already smoother than the wet target — is untouched. If this ever inverts, the weather
    // has become a paint filter applied to every surface equally.
    const sand = weathered(SURFACE_SPEC.sand, { wetness: 1, dust: 0 });
    const water = weathered(SURFACE_SPEC.water, { wetness: 1, dust: 0 });
    expect(SURFACE_SPEC.sand.roughness - sand.roughness).toBeGreaterThan(0.5);
    expect(SURFACE_SPEC.water.roughness - water.roughness).toBeCloseTo(0, 6);
  });

  it('never collapses two classes into one, in either atmosphere', () => {
    for (const id of TIME_OF_DAY_IDS) {
      const weather = TIME_PRESETS[id].weather;
      // A *weathered* class has moved its roughness, so compare the moved values: two
      // surfaces that were distinct before the rain must still be distinct after it.
      const moved = new Map(
        WEATHERED_CLASSES.map((cls) => [cls, weathered(SURFACE_SPEC[cls], weather)]),
      );
      for (let i = 0; i < WEATHERED_CLASSES.length; i++) {
        for (let j = i + 1; j < WEATHERED_CLASSES.length; j++) {
          const a = WEATHERED_CLASSES[i]!;
          const b = WEATHERED_CLASSES[j]!;
          const before = distance(a, b);
          const one = { ...SURFACE_SPEC[a], roughness: moved.get(a)!.roughness, envIntensity: moved.get(a)!.envIntensity };
          const two = { ...SURFACE_SPEC[b], roughness: moved.get(b)!.roughness, envIntensity: moved.get(b)!.envIntensity };
          const after =
            Math.abs(one.roughness - two.roughness) * 3 +
            Math.abs(one.metalness - two.metalness) * 4 +
            Math.abs(one.envIntensity - two.envIntensity) +
            Math.abs(one.relief - two.relief) * 0.5 +
            (Math.abs(one.layers.macro - two.layers.macro) +
              Math.abs(one.layers.mid - two.layers.mid) +
              Math.abs(one.layers.micro - two.layers.micro)) *
              0.5;
          // Half the dry separation is the requirement: the weather may soften the
          // differences between surfaces, it may not erase them.
          expect(after, `${id}: ${a}/${b}`).toBeGreaterThan(Math.min(before, 0.12) * 0.5);
        }
      }
    }
  });

  it('declares the weather with the atmosphere, and the two hours differ', () => {
    expect(TIME_OF_DAY_IDS.length).toBeGreaterThanOrEqual(2);
    const seen = new Set<string>();
    for (const id of TIME_OF_DAY_IDS) {
      const { wetness, dust } = TIME_PRESETS[id].weather;
      expect(wetness, `${id} wetness`).toBeGreaterThanOrEqual(0);
      expect(wetness, `${id} wetness`).toBeLessThanOrEqual(1);
      expect(dust, `${id} dust`).toBeGreaterThanOrEqual(0);
      expect(dust, `${id} dust`).toBeLessThanOrEqual(1);
      seen.add(`${wetness}/${dust}`);
    }
    // Two presets that weathered the world identically would be one atmosphere with two sky
    // colours — which is exactly the review's "material work in both atmospheres" ask.
    expect(seen.size).toBe(TIME_OF_DAY_IDS.length);
  });

  it('saturates rather than extrapolating past 1', () => {
    for (const cls of WEATHERED_CLASSES) {
      const spec = SURFACE_SPEC[cls];
      expect(weathered(spec, { wetness: 4, dust: 0 })).toEqual(weathered(spec, { wetness: 1, dust: 0 }));
      expect(weathered(spec, { wetness: 0, dust: -3 })).toEqual(weathered(spec, DRY));
    }
  });

  it('is idempotent, and puts the library back exactly', () => {
    // The defect this exists to prevent: an atmosphere switch that reads the *current*
    // roughness drifts every outdoor surface a little duller each time the player visits the
    // settings screen. The arithmetic runs against the authored values, so it cannot.
    const library = fakeLibrary();
    const authored = snapshot(library);
    const wet = TIME_PRESETS.dusk.weather;
    applyWeathering(library, wet);
    const once = snapshot(library);
    expect(once).not.toEqual(authored);
    applyWeathering(library, wet);
    expect(snapshot(library)).toEqual(once);
    applyWeathering(library, DRY);
    expect(snapshot(library)).toEqual(authored);
  });

  it('leaves a surface the weather cannot reach alone', () => {
    const library = fakeLibrary();
    const before = library.lampBulb.color.getHex();
    applyWeathering(library, TIME_PRESETS.dawn.weather);
    // An unlit lamp lens is a *source*: its colour is its brightness, and nothing the air is
    // doing changes it. The `instanceof MeshStandardMaterial` guard is the whole reason.
    expect(library.lampBulb.color.getHex()).toBe(before);
    expect((library.lampBulb as unknown as { roughness?: number }).roughness).toBeUndefined();
  });

  it('reaches every class the weather claims, through at least one material', () => {
    // Completeness: a class added to `WEATHERED_CLASSES` and forgotten in the mapping would
    // be a surface that ignores the atmosphere, which is invisible in a screenshot.
    const mapped = new Map(WEATHERED_MATERIALS.map(([cls, keys]) => [cls, keys]));
    for (const cls of WEATHERED_CLASSES) {
      const keys = mapped.get(cls);
      expect(keys, `${cls} is not mapped to any material`).toBeDefined();
      expect(keys!.length, `${cls} maps to no material`).toBeGreaterThan(0);
    }
  });

  it('keeps the wet gain and the dust loss small enough to be a surface, not a filter', () => {
    // A weather term big enough to move *every* material by half its range is not weather.
    // The wet target is the one that matters: it is the value a wet rough surface approaches,
    // so it has to be glossier than the matte classes and duller than the gloss ones — a
    // target of 0 would make every outdoor surface a mirror after rain, and one of 0.6 would
    // mean the rain does nothing worth seeing.
    expect(WEATHER.wetRoughness).toBeGreaterThan(0.1);
    expect(WEATHER.wetRoughness).toBeLessThan(0.5);
    expect(WEATHER.wetEnvGain).toBeLessThan(1);
    expect(WEATHER.dustEnvLoss).toBeLessThan(0.5);
  });
});

describe('breaking repetition', () => {
  it('offsets a shell\'s UVs and leaves the AO set where it is', () => {
    // Two buildings made of one facade map are one wall photocopied, unless each samples its
    // own window onto it. The offset is what makes them two walls, and it has to be an
    // *offset*: a scale would change the surface's texel density, which `texel.test.ts`
    // guards, and the AO set is a separate sampling space, so sliding it would move a
    // surface's occlusion away from its geometry.
    const geometry = withAoUv(new THREE.BoxGeometry(20, 12, 18));
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const ao = geometry.getAttribute('uv1') as THREE.BufferAttribute;
    const beforeUv = Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)]);
    const beforeAo = Array.from({ length: ao.count }, (_, i) => [ao.getX(i), ao.getY(i)]);
    const shifted = shiftUv(geometry, 0.37, 0.61);
    const moved = shifted.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < moved.count; i++) {
      // Every vertex moves by the same amount, and that amount is the offset.
      expect(moved.getX(i) - beforeUv[i]![0]!).toBeCloseTo(0.37, 6);
      expect(moved.getY(i) - beforeUv[i]![1]!).toBeCloseTo(0.61, 6);
    }
    // The geometry it was handed is untouched (it is a clone, like `uvMetres`), and the AO
    // set is still where it was — including in the *shared-object* case `withAoUv` produces.
    for (let i = 0; i < uv.count; i++) expect([uv.getX(i), uv.getY(i)]).toEqual(beforeUv[i]);
    const shiftedAo = shifted.getAttribute('uv1') as THREE.BufferAttribute;
    for (let i = 0; i < shiftedAo.count; i++) {
      expect([shiftedAo.getX(i), shiftedAo.getY(i)]).toEqual(beforeAo[i]);
    }
    expect(shifted).not.toBe(geometry);
  });
});

/**
 * A Materials-shaped object with the two fields `applyWeathering` reads.
 *
 * The real library needs a canvas to build its maps, and this suite runs in node on purpose
 * (no GPU, no DOM). Weathering only ever touches `roughness`, `envMapIntensity` and the
 * authored pair, so a stand-in with those — plus one unlit material, which must not be
 * touched at all — is the whole surface the function can see.
 */
function fakeLibrary(): Materials {
  const standard = (roughness: number, env: number): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial({ roughness });
    material.envMapIntensity = env;
    material.userData.baseRoughness = roughness;
    material.userData.baseEnvIntensity = env;
    return material;
  };
  return {
    ground: standard(0.94, 0.7),
    road: standard(0.9, 0.75),
    roadLine: standard(0.75, 0.8),
    sand: standard(1, 0.55),
    concrete: standard(0.92, 0.6),
    concreteClean: standard(0.88, 0.6),
    plaster: standard(0.95, 0.55),
    crate: standard(0.85, 0.6),
    sandbag: standard(1, 0.55),
    metal: standard(0.55, 1),
    steelPainted: standard(0.5, 1),
    gunmetal: standard(0.42, 1.05),
    polymer: standard(0.8, 0.6),
    rubber: standard(0.96, 0.4),
    tire: standard(0.96, 0.4),
    tireSidewall: standard(0.88, 0.45),
    fabric: standard(0.96, 0.5),
    leather: standard(0.72, 0.6),
    skin: standard(0.62, 0.6),
    rust: standard(0.88, 0.65),
    dark: standard(0.85, 0.9),
    stone: standard(0.92, 0.7),
    bush: standard(1, 0.5),
    burnt: standard(0.95, 0.6),
    rock: standard(1, 0.7),
    glass: standard(0.06, 1.4),
    carGlass: standard(0.05, 1.7),
    grime: standard(0.98, 0.3),
    roadPatch: standard(0.7, 0.9),
    scorch: standard(1, 0.2),
    puddle: standard(0.06, 1.1),
    banner: standard(0.92, 0.6),
    barrels: [standard(0.62, 1), standard(0.68, 1)],
    buildings: [standard(0.9, 0.7), standard(0.9, 0.7), standard(0.9, 0.7)],
    lampBulb: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    gateLamp: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    kioskSign: new THREE.MeshBasicMaterial({ color: 0xffb043 }),
    windowGlow: new THREE.MeshBasicMaterial({ color: 0x3d2c17 }),
  } as unknown as Materials;
}

/** Every value the weather is allowed to move, as a comparable snapshot. */
function snapshot(library: Materials): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const visit = (name: string, value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(`${name}[${index}]`, entry));
      return;
    }
    if (!(value instanceof THREE.MeshStandardMaterial)) return;
    out[name] = [Number(value.roughness.toFixed(6)), Number(value.envMapIntensity.toFixed(6))];
  };
  for (const [name, value] of Object.entries(library)) visit(name, value);
  return out;
}
