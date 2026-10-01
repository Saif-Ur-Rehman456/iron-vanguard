/**
 * Material library.
 *
 * Every mesh asks for a *named* material, and every material is built from a named
 * PBR surface (materials/pbr.ts). That indirection is the point: replacing the
 * procedural set with scanned KTX2 maps for one surface is a one-line edit here,
 * with no call sites to chase.
 *
 * Roughness/metalness live on the material and are *modulated* by the maps, so the
 * numbers below read as "what this thing is made of": plaster is rough, gunmetal is
 * not, rubber is rough but not metal, wet asphalt is in between.
 *
 * "Modulated" is load-bearing, and it took a defect to mean it. three's stock shader
 * *multiplies* a material's roughness by its roughness map, so while the map carried an
 * absolute roughness the pair were multiplied together and every surface shaded at its own
 * roughness *squared* — car paint at 0.12, the view model's receiver at 0.23, water at
 * 0.004. The maps now carry the local *swing* and the material carries the value
 * (`applySurfaceMaps`, pbr.ts), so a number here is the gloss the surface actually has.
 */
import * as THREE from 'three';
import { applySurfaceMaps } from './pbr';
import type { SurfaceMaps, SurfaceLibrary } from './textures';
import type { TextureLibrary } from './textures';
import { SURFACE_SPEC, weathered, type SurfaceClass, type Weathering } from './surfaces';

export interface Materials {
  ground: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  roadLine: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  concreteClean: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  sandbag: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  steelPainted: THREE.MeshStandardMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  bush: THREE.MeshStandardMaterial;
  barrels: THREE.MeshStandardMaterial[];
  burnt: THREE.MeshStandardMaterial;
  buildings: THREE.MeshStandardMaterial[];
  puddle: THREE.MeshStandardMaterial;
  banner: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  /** The same tyre's sidewall: a separate material because it is a separate surface. */
  tireSidewall: THREE.MeshStandardMaterial;
  /**
   * A car body: a clearcoat over a base coat.
   *
   * `MeshPhysicalMaterial` rather than `MeshStandardMaterial` because a painted panel is a
   * coat over a coat, and the clearcoat model is how a standard material says that. One
   * coat, one reflection, one controlled highlight instead of a matte panel with a bright
   * rim (ADR-0020).
   */
  /**
   * Cast brass: the monument's cap.
   *
   * A library material rather than the inline one that shipped (`new MeshStandardMaterial({
   * color: 0xd8b45c, metalness: 1, … })` built inside the arena's monument builder), because a
   * material made at the call site is outside the physical table, outside the weather and
   * outside every check in this file — and two of them disagreeing is what "cheezon ka colour
   * galat hai" looks like from the player's chair. A metal, tinted, and reachable.
   */
  brass: THREE.MeshStandardMaterial;
  carPaint: THREE.MeshPhysicalMaterial;
  /** A car body that has burned: the same coat, charred matte. */
  burntPaint: THREE.MeshPhysicalMaterial;
  /** Car glazing: tinted, reflective at grazing angles, and thin enough to see through. */
  carGlass: THREE.MeshStandardMaterial;
  /**
   * Contact grime: what a surface collects where it meets the ground.
   *
   * A *material*, not a darker copy of the thing under it, because dirt is a substance:
   * the same granular film sits under a car, along a wall's base and inside a wheel arch,
   * and it is the same film in all three places. Dark sand rather than dark asphalt, so it
   * reads as dust and oil that has settled rather than as a hole in the surface — and it is
   * placed (below a car, along a plinth) rather than tiled over everything, which was the
   * review's "dirt is uniform, so it means nothing".
   */
  grime: THREE.MeshStandardMaterial;
  /**
   * A repaired patch of asphalt: the same road, darker and *smoother*.
   *
   * Repairs are the cheapest large-scale break in a road's repetition, and the two ways a
   * patch differs from the road around it are both physical: the new binder is darker and
   * it has not been worn rough by traffic yet.
   */
  roadPatch: THREE.MeshStandardMaterial;
  /**
   * A burn or blast mark on a surface.
   *
   * `transparent` with `depthWrite: false` and a polygon offset, because it is a *stain on*
   * the ground rather than an object standing on it: a decal that writes depth fights its
   * own host surface at a distance. Deliberately dim (the map is the crack/blast sprite) so
   * it stays a mark and never becomes a light source of its own.
   */
  scorch: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  lampBulb: THREE.MeshBasicMaterial;
  gateLamp: THREE.MeshBasicMaterial;
  kioskSign: THREE.MeshBasicMaterial;
  /**
   * Glass behind a barred window that has a light on inside.
   *
   * Unlit on purpose (a `MeshBasicMaterial`): a lit window is a *source*, and a
   * source does not get darker because a wall shadows it. The colour is kept well
   * under 1.0 so it stays a dim warm pane rather than a neon sign, and the light
   * it appears to cast comes from the window-light pool in level/lighting.ts.
   */
  windowGlow: THREE.MeshBasicMaterial;
}

/**
 * How many metres one texture tile covers, per surface class.
 *
 * This is the world's half of the texel-density contract; the weapon's half is
 * `WEAPON_TILE_METRES` in materials/weapon.ts. Before it existed, `repeat` was set
 * once on the shared maps, for the ground, so a mesh's density was whatever its
 * size happened to be: ~100 mm per texel on the 400 m plaza floor and ~3 mm on a
 * crate, in the same frame.
 *
 * A surface's density is now a property of the surface. Big, smooth things read as
 * themselves at several metres per tile; something you can touch needs centimetres,
 * and a crate or a sandbag is where the difference is obvious (their slats and
 * weave have to be slats and weave, not paint).
 */
export const UV_DENSITY = {
  /** 4x4 paving flags per tile, so one flag is 65 cm — a civic plaza's flag size. */
  plazaFloor: 2.6,
  road: 3,
  sidewalk: 2,
  facade: 3,
  /**
   * A building shell: 1.2 m per tile, i.e. 2.3 mm per texel at the facade map's 512².
   *
   * It used to be 2.5 m, on the theory that the tile was "a little over one storey"
   * — because the storey's slab band was baked into the map. The band is geometry now
   * (`arena.buildBuilding`), so the map is free to be what it always should have
   * been: a wall material at a density a wall is looked at from (ADR-0017). This is
   * the single change that fixes "the buildings are blurry".
   */
  building: 1.2,
  crate: 0.4,
  sandbag: 0.35,
  /** Wind-blown sand: 1.4 m per tile, so the grain is a grain rather than a speckle. */
  sand: 1.4,
  /** A car's panel: 1.6 m per tile, i.e. about a door — the scale a defect is read at. */
  carPaint: 1.6,
  metalPanel: 0.6,
  barrier: 0.8,
  rock: 1.5,
  /* Cloth is authored coarse: a banner at 4 m reads as cloth from a distance. */
  banner: 1.2,
  water: 2,
} as const;

export interface SurfaceParams {
  /** Colour tint multiplied over the surface's albedo (white = unchanged). */
  color?: number;
  roughness: number;
  metalness?: number;
  normalScale?: number;
  aoIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  emissive?: number;
  emissiveIntensity?: number;
  /**
   * Clearcoat: a second, smooth reflective layer over the base surface.
   *
   * Setting this is what turns the material into a `MeshPhysicalMaterial`, and it exists
   * for the surfaces that are *coated* rather than made — a car's paint, a varnished panel.
   * A clearcoat is not extra gloss on the same lobe: it is the coat sitting above the base
   * coat, which is why a car's reflection stays sharp over paint that is dull (ADR-0020).
   */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /**
   * How much of the sky environment this surface is entitled to reflect.
   *
   * Reflected sky is the only bounce in the rig (ADR-0013), so this is what keeps a
   * black-polymer weapon from going detail-less in shadow: it stays dark, but its
   * edges pick up a cool sheen, which is how the eye reads a surface it cannot
   * light directly. Defaults are per-material-class rather than one number for
   * everything — a metal and a sandbag do not reflect the same amount of sky.
   */
  envIntensity?: number;
}

/**
 * Texture edge, in pixels, for each surface class — the other half of the density
 * contract above.
 *
 * Density is `pixels / metresPerTile`, and `metresPerTile` is the size the *art* has
 * (a paving flag is 65 cm, a crate slat is a slat). So the only free variable is the
 * map's resolution, and this table is it.
 *
 * `tests/unit/texel.test.ts` divides the two and fails below a stated floor per class,
 * which is the GPU-free half of "nothing is blurry": a recipe in
 * `materials/textures.ts` whose `size` is lowered here without a compensating tile
 * change cannot reach the frame without a red test first. Keep the two in step — a
 * surface's flat colour, its roughness and its texel size are the same kind of
 * decision, and the review that produced this table was "everything is blurry at every
 * graphics level" (ADR-0017).
 */
export const UV_PIXELS = {
  ground: 1024,
  /**
   * 1024, like the paving, and for the same reason: this is a surface the camera looks down
   * at from two metres. At 512² over `UV_DENSITY.road` = 3 m a texel was 5.9 mm while the
   * aggregate the map was drawing is 5-15 mm — a stone smaller than the pixel it is drawn on,
   * which comes out as noise and (because it also carried relief) as sparkle. 2.9 mm per texel
   * makes the stones stones (ADR-0022).
   */
  asphalt: 1024,
  concrete: 512,
  plaster: 512,
  stone: 512,
  wood: 512,
  sandbag: 256,
  sand: 512,
  carPaint: 512,
  steel: 256,
  /**
   * 512, not 256. The view model is the most-inspected surface in the game — 40 cm
   * from the eye for the whole mission — and its 8 cm tile at 256² put a texel at
   * 310 µm, coarser than the display's ~60 µm pixels at that distance, so the metal
   * was the softest object on screen. 512² halves that and lets the machining marks
   * be drawn above the texel floor (see `machinedMetal`).
   */
  gunmetal: 512,
  /** 512: the grip sits under the player's thumb at the same 40 cm. */
  polymer: 512,
  rubber: 256,
  /**
   * 512: the sleeve's weave is drawn 96 lines per 12 cm tile — 1.28 texels apart at
   * 256², which is a sub-texel stripe field and read as corrugation on the forearm
   * (the view model is 40 cm from the eye). Same defect and cure as the weapon metal.
   */
  fabric: 512,
  leather: 256,
  skin: 256,
  rust: 256,
  /** The building facade set (materials/textures.ts `facade`). */
  building: 512,
} as const;

/** The surface classes the density contract covers (keys of `UV_PIXELS`). */
export type SurfaceSpecKey = keyof typeof UV_PIXELS;

/**
 * How many metres one UV unit spans, if one texture tile should cover
 * `metresPerTile` of world.
 *
 * The shared surface maps were authored before world-space UVs existed, so their
 * tiling is baked into the *texture* (`repeat`, 8 on the paving, 6 on the asphalt, 1
 * on the props). A UV unit is therefore not a tile: it is `repeat` tiles. This
 * converts the physical quantity the density table is written in into the parameter
 * `geometry.uvMetres` wants, so a caller states "one tile of paving is 2.6 m" and does
 * not have to remember which surface happens to be tiled 8 times.
 *
 * The alternative — cloning every surface's maps to reset `repeat` — costs one GPU
 * texture upload per surface, because a texture clone is a separate upload of the
 * same canvas. Bridging the two here is free.
 */
export function uvUnitMetres(
  material: THREE.MeshStandardMaterial,
  metresPerTile: number,
): number {
  const repeat = material.map?.repeat.x ?? 1;
  return metresPerTile * Math.max(1, repeat);
}

/**
 * Turn a surface set into a standard material. `aoMap` needs no extra pass here:
 * `geometry.ts` mirrors the first UV set into `uv1` for every cached geometry.
 */
export function material(set: SurfaceMaps, params: SurfaceParams): THREE.MeshStandardMaterial {
  const options = {
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    aoMap: set.aoMap,
    aoMapIntensity: params.aoIntensity ?? 0.85,
    color: params.color ?? 0xffffff,
    roughness: params.roughness,
    metalness: params.metalness ?? 0,
    side: params.side ?? THREE.FrontSide,
    transparent: params.transparent ?? false,
    opacity: params.opacity ?? 1,
    emissive: params.emissive ?? 0x000000,
    emissiveIntensity: params.emissiveIntensity ?? 1,
  } as const;
  // A coated surface gets the physical model, because a clearcoat is a second layer and
  // the standard model has nowhere to put it. Everything else stays on the standard
  // material, which is the cheaper one — this is a per-material decision, not a setting.
  const material =
    params.clearcoat === undefined
      ? new THREE.MeshStandardMaterial(options)
      : new THREE.MeshPhysicalMaterial({
          ...options,
          clearcoat: params.clearcoat,
          clearcoatRoughness: params.clearcoatRoughness ?? 0.12,
        });
  const scale = params.normalScale ?? 1;
  material.normalScale = new THREE.Vector2(scale, scale);
  if (set.metalnessMap) material.metalnessMap = set.metalnessMap;
  // The roughness map carries a *swing* around the material's own roughness, and three's stock
  // shader multiplies it. Wiring the swing in here — in the single factory both the level and
  // the view model build through — is what keeps `roughness` meaning the same thing at every
  // call site: the surface's gloss, not a factor the map is applied to. See `applySurfaceMaps`.
  applySurfaceMaps(material);
  // Stone and fabric are not electrical conductors; leaving these on would make
  // every highlight read as chrome. The 0.6 default is the floor for matte
  // mineral surfaces; the dark technical materials raise it explicitly (below).
  material.envMapIntensity = params.envIntensity ?? (params.metalness ? 1 : 0.6);
  // The authored pair, kept so the weather can move a material *and put it back*.
  // On the material rather than in a side table because the values have to travel with
  // the object: `applyWeathering` is handed the library, not the recipe, and a table
  // keyed by name would be a second place for the same numbers to live (ADR-0020).
  material.userData.baseRoughness = material.roughness;
  material.userData.baseEnvIntensity = material.envMapIntensity;
  return material;
}

/**
 * The parameters a surface class's spec implies, so a material states only its *variant*.
 *
 * This is the join between the physical table (`SURFACE_SPEC`) and the material library: a
 * road is asphalt and says so in one word, and the numbers that make asphalt asphalt live
 * in one place (ADR-0020). A material that wants to differ — a road marking, a wet puddle, a
 * rusted barrel — overrides the specific terms it disagrees with.
 */
function specFor(key: SurfaceClass, extra: Partial<SurfaceParams> = {}): SurfaceParams {
  const spec = SURFACE_SPEC[key];
  const base: SurfaceParams = {
    roughness: spec.roughness,
    metalness: spec.metalness,
    normalScale: spec.normalScale,
    envIntensity: spec.envIntensity,
  };
  // A variant overrides what it disagrees with, and nothing else.
  return Object.assign(base, extra);
}

export function createMaterials(textures: TextureLibrary): Materials {
  const s: SurfaceLibrary = textures.surfaces;

  return {
    ground: material(s.ground, specFor('ground', { aoIntensity: 0.9 })),
    road: material(s.asphalt, specFor('asphalt', { aoIntensity: 0.9 })),
    // Painted markings sit on the road, so they get the road's relief underneath:
    // a flat unlit quad is the classic "decal floating on the ground" tell.
    roadLine: material(s.asphalt, {
      color: 0xc9b26a,
      roughness: 0.75,
      normalScale: 0.6,
      emissive: 0x2a2415,
      emissiveIntensity: 0.35,
    }),
    // Sand: the one surface in the build whose character is *granular and loose*, so it is
    // the roughest thing outdoors and reflects the least sky. It is also the surface the
    // atmosphere can move the most, which is why it is in `WEATHERED_CLASSES`.
    sand: material(s.sand, specFor('sand', { aoIntensity: 0.9 })),
    concrete: material(s.concrete, specFor('concrete', { aoIntensity: 1 })),
    concreteClean: material(s.concrete, specFor('concrete', {
      color: 0x9a9285,
      roughness: 0.88,
      normalScale: 0.8,
    })),
    plaster: material(s.plaster, specFor('plaster')),
    crate: material(s.wood, specFor('wood')),
    sandbag: material(s.sandbag, specFor('sandbag')),
    // Painted steel, both of them: the *substrate* is steel and the metalness map is the
    // paint, which is why the value is 1 rather than a compromise in the middle. A gate
    // and a car's trim are the same material at different paints.
    metal: material(s.steel, specFor('steel', { roughness: 0.55 })),
    steelPainted: material(s.steel, specFor('steel')),
    gunmetal: material(s.gunmetal, specFor('gunmetal')),
    polymer: material(s.polymer, specFor('polymer')),
    rubber: material(s.rubber, specFor('rubber')),
    tireSidewall: material(s.tireSidewall, specFor('rubber', {
      roughness: 0.88,
      normalScale: 0.8,
    })),
    fabric: material(s.fabric, specFor('fabric')),
    leather: material(s.leather, specFor('leather')),
    skin: material(s.skin, specFor('skin', { aoIntensity: 0.5 })),
    // Rust: iron oxide (a dielectric) over steel, with the metalness map carrying which is
    // which. `0.35` used to sit here as "a bit metal", which is not a material.
    rust: material(s.rust, specFor('rust')),
    dark: material(s.polymer, { color: 0x4a4740, roughness: 0.85, envIntensity: 0.9 }),
    stone: material(s.stone, specFor('stone', { aoIntensity: 1 })),
    bush: material(s.fabric, { color: 0x2f3d18, roughness: 1, normalScale: 1.4 }),
    barrels: [
      material(s.rust, specFor('rust', { color: 0xa03526, roughness: 0.62 })),
      material(s.rust, specFor('rust', { color: 0x4a5d23, roughness: 0.68 })),
    ],
    burnt: material(s.rust, specFor('rust', { color: 0x2a2521, roughness: 0.95 })),
    buildings: textures.buildings.map((set, index) =>
      material(set, specFor('building', {
        color: index === 1 ? 0xd8cfc0 : 0xffffff,
        aoIntensity: 1,
      })),
    ),
    // Standing water: dark, and *reflective* rather than black. Two earlier versions got
    // this wrong in opposite ways — metalness 0.5 at roughness 0.08 with a 0.6 env intensity
    // had nothing to reflect and rendered as a black disc, and the 0.35 that replaced it
    // made water *grey metal*, which is not what water is. Water is a dielectric: metalness
    // 0, a high environment intensity, and its own Fresnel doing the rest — weak head-on,
    // strong at grazing (ADR-0020).
    puddle: material(s.asphalt, specFor('water', {
      color: 0x1b2630,
      aoIntensity: 0.25,
    })),
    banner: material(s.fabric, { color: 0x7a2a1a, roughness: 0.92, side: THREE.DoubleSide }),
    tire: material(s.rubber, specFor('rubber')),
    // A car body: the clearcoat is the whole point. The base coat's roughness varies (the
    // map's field: dirt, scuffs, oxidised patches) and the *coat* above it stays glossy, so
    // the reflection survives the dirt — which is what a dusty car actually looks like, and
    // what a single-roughness panel cannot do.
    brass: material(s.steel, specFor('steel', {
      color: 0xd8b45c,
      roughness: 0.28,
      metalness: 1,
      envIntensity: 1.15,
      normalScale: 0.5,
    })),
    carPaint: material(s.carPaint, specFor('carPaint', {
      aoIntensity: 0.7,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
    })) as THREE.MeshPhysicalMaterial,
    burntPaint: material(s.carPaint, specFor('carPaint', {
      color: 0x2b2622,
      roughness: 0.86,
      envIntensity: 0.7,
      aoIntensity: 0.8,
      clearcoat: 0.25,
      clearcoatRoughness: 0.5,
    })) as THREE.MeshPhysicalMaterial,
    // Car glazing. Thin tint, a reflection that arrives with the angle (that is what the
    // env intensity is for), and transparent rather than translucent-and-opaque: the cabin
    // behind it is geometry now (arena.ts), so there is something to see through it.
    carGlass: material(s.carPaint, {
      color: 0x7d93a0,
      roughness: 0.05,
      metalness: 0,
      normalScale: 0.15,
      transparent: true,
      opacity: 0.34,
      envIntensity: 1.7,
      side: THREE.DoubleSide,
      aoIntensity: 0.2,
    }),
    // Grime: the film at a surface's contact line. Rough, dull, and darker than anything it
    // sits on, which is the whole job — it has to look like a *layer* over the ground.
    grime: material(s.sand, {
      color: 0x241d14,
      roughness: 0.98,
      metalness: 0,
      normalScale: 0.6,
      envIntensity: 0.3,
      aoIntensity: 0.4,
    }),
    roadPatch: material(s.asphalt, {
      color: 0x555044,
      roughness: 0.7,
      normalScale: 0.55,
      envIntensity: 0.9,
      aoIntensity: 0.5,
    }),
    scorch: new THREE.MeshStandardMaterial({
      map: textures.decal,
      color: 0x120e0c,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      envMapIntensity: 0.2,
    }),
    rock: material(s.stone, { color: 0x6b6357, roughness: 1, normalScale: 1.6 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fc4d8,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.28,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide,
    }),
    lampBulb: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    gateLamp: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    kioskSign: new THREE.MeshBasicMaterial({ color: 0xffb043 }),
    windowGlow: new THREE.MeshBasicMaterial({ color: 0x3d2c17 }),
  };
}

/**
 * Which library material answers to which surface class.
 *
 * A class is a physical identity (materials/surfaces.ts); a library entry is a *variant*
 * of it — painted steel and bare steel are both steel, and both get weathered as steel.
 * The list is explicit rather than `key === class` because the mapping is genuinely
 * many-to-one, and because a material that must *not* move (a lit pane, a lamp lens) is
 * then simply absent from it.
 */
export const WEATHERED_MATERIALS: ReadonlyArray<
  readonly [SurfaceClass, ReadonlyArray<keyof Materials>]
> = [
  ['ground', ['ground']],
  ['asphalt', ['road', 'roadLine']],
  ['sand', ['sand']],
  ['concrete', ['concrete', 'concreteClean']],
  ['plaster', ['plaster']],
  ['stone', ['stone', 'rock']],
  ['building', ['buildings']],
  ['wood', ['crate']],
  ['sandbag', ['sandbag']],
  ['steel', ['metal', 'steelPainted', 'brass']],
  ['gunmetal', ['gunmetal']],
  ['rust', ['rust', 'burnt', 'barrels']],
  ['rubber', ['rubber', 'tire', 'tireSidewall']],
  ['carPaint', ['carPaint', 'burntPaint', 'carGlass']],
  ['water', ['puddle']],
  // Polymer is indoor furniture in the weapon set and outdoor props here, so it is listed:
  // a crate's mouldings and a barrier's panels are exposed to the same air as the road.
  ['polymer', ['polymer', 'dark']],
  ['fabric', ['fabric', 'banner', 'bush']],
  ['leather', ['leather']],
];

/**
 * Put the outdoor materials into the atmosphere's weather.
 *
 * The seventh review asked for the material pass in *both* atmospheres, and this is the
 * join: an atmosphere declares a `Weathering` (timeOfDay.ts) and every exposed surface
 * answers it. Materials do not change with the hour — but a wet surface is a different
 * surface, and water is the great equaliser of roughness: the same asphalt is glossier at
 * 0400 after rain than at 0900, while settled dust does the opposite.
 *
 * Idempotent on purpose. The arithmetic runs against the values the recipe *authored*
 * (`userData.baseRoughness`), not against the values currently on the material, so
 * applying a preset twice is the same as applying it once and a dry, clean weather
 * restores the library exactly. That is what makes this checkable without a GPU, and it
 * is also what stops an atmosphere switch from drifting the whole scene a little duller
 * every time the player visits the menu.
 */
export function applyWeathering(materials: Materials, weather: Weathering): void {
  for (const [cls, keys] of WEATHERED_MATERIALS) {
    const spec = SURFACE_SPEC[cls];
    for (const key of keys) {
      const value = materials[key] as
        | THREE.MeshStandardMaterial
        | THREE.MeshStandardMaterial[]
        | THREE.MeshBasicMaterial;
      const list = Array.isArray(value) ? value : [value];
      for (const entry of list) {
        if (!(entry instanceof THREE.MeshStandardMaterial)) continue;
        const baseRoughness = (entry.userData.baseRoughness as number | undefined) ?? entry.roughness;
        const baseEnv =
          (entry.userData.baseEnvIntensity as number | undefined) ?? entry.envMapIntensity;
        const moved = weathered(
          { ...spec, roughness: baseRoughness, envIntensity: baseEnv },
          weather,
        );
        entry.roughness = moved.roughness;
        entry.envMapIntensity = moved.envIntensity;
      }
    }
  }
}

export function disposeMaterials(materials: Materials): void {
  for (const value of Object.values(materials)) {
    if (Array.isArray(value)) {
      for (const m of value) m.dispose();
    } else if (value instanceof THREE.Material) {
      value.dispose();
    }
  }
}
