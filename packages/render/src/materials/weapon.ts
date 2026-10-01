/**
 * Weapon materials.
 *
 * The shared material library tiles by baking `repeat` into the *texture*, which
 * works for a whole plaza and fails badly on a 7 cm receiver: the same map then
 * covers the entire mesh, so a rail slot is a smear of texture and the metal
 * reads as stripes. (That striping is visible in the review's weapon close-ups —
 * it is a UV-density bug, not a texture bug.)
 *
 * The weapon set therefore owns its own tiled copies of the six surfaces it uses,
 * each declared with the real-world size of one tile in metres, and the geometry
 * authoring the UVs from `geometry.uvMetres`. Now "anodised aluminium with fine
 * machining marks" is 8 cm of texture per tile whether it lands on a receiver, a
 * magazine release or a charging handle.
 */
import * as THREE from 'three';
import type { SurfaceMaps, TextureLibrary } from './textures';
import { material, type SurfaceParams } from './materials';

export interface WeaponTile {
  material: THREE.MeshStandardMaterial;
  /** Real-world size one texture tile covers, in metres. */
  metresPerTile: number;
  /** Textures cloned for this set, so they can be released with it. */
  owned: THREE.Texture[];
}

/**
 * One texture tile per surface, in metres.
 *
 * These are the numbers the review's weapon close-ups were about. The shared
 * library's maps are authored for a whole plaza and their `repeat` was set once,
 * for the ground; on a 7 cm receiver that is a smear, so a receiver looked like
 * brushed stripes. Declaring the physical size of a tile per surface is what makes
 * the density the same on a receiver, a magazine release and a handguard — and it
 * is data, so `tests/unit/texel.test.ts` can check it without a GPU.
 *
 * The reference sizes: a receiver's machining marks are sub-millimetre (8 cm of
 * texture per tile reads as metal, not as weave), leather is a fine grain (5 cm),
 * and a sleeve's weave is coarse enough to need 12 cm before it looks like fabric
 * rather than noise.
 */
export const WEAPON_TILE_METRES = {
  gunmetal: 0.08,
  steel: 0.06,
  polymer: 0.07,
  // Walnut: the grain runs inches, not millimetres, so a tile is a hand's width and
  // the figure reads on a forearm-sized part rather than looking like noise.
  wood: 0.12,
  leather: 0.05,
  sleeve: 0.12,
  skin: 0.1,
} as const;

export interface WeaponMaterials {
  gunmetal: WeaponTile;
  steel: WeaponTile;
  polymer: WeaponTile;
  /** Oiled walnut, for the AK's furniture. */
  wood: WeaponTile;
  leather: WeaponTile;
  sleeve: WeaponTile;
  skin: WeaponTile;
  /** Optic glass: a thin lens, not a tinted window. */
  lens: THREE.MeshPhysicalMaterial;
  /** The illuminated dot itself. Unlit on purpose: a reticle is a source. */
  dot: THREE.MeshBasicMaterial;
  /**
   * The inside of a tube the player looks down, built once per opaque surface.
   *
   * Same maps, same colour, same roughness as the surface it belongs to, only
   * double-sided: an open-ended cylinder's far wall faces away from the eye, and with
   * single-sided material the inside of the sight tube would render as a hole in the
   * weapon rather than as a tube.
   */
  opticWall(key: 'gunmetal' | 'steel' | 'polymer'): THREE.MeshStandardMaterial;
  dispose(): void;
}

/**
 * Clone a surface's maps so their tiling can be authored per world metre.
 *
 * `repeat` is reset to 1 — from here on the geometry's UVs are already in tile
 * units, and a texture that scaled them again would undo the whole point.
 */
function tilesAt(maps: SurfaceMaps, metresPerTile: number, params: SurfaceParams): WeaponTile {
  const owned: THREE.Texture[] = [];
  const clone = (texture: THREE.Texture | null): THREE.Texture | null => {
    if (!texture) return null;
    const copy = texture.clone();
    copy.wrapS = THREE.RepeatWrapping;
    copy.wrapT = THREE.RepeatWrapping;
    copy.repeat.set(1, 1);
    copy.needsUpdate = true;
    owned.push(copy);
    return copy;
  };
  const tiled: SurfaceMaps = {
    map: clone(maps.map) as THREE.CanvasTexture,
    normalMap: clone(maps.normalMap) as THREE.CanvasTexture,
    roughnessMap: clone(maps.roughnessMap) as THREE.CanvasTexture,
    metalnessMap: clone(maps.metalnessMap) as THREE.CanvasTexture | null,
    aoMap: clone(maps.aoMap) as THREE.CanvasTexture,
  };
  const built = material(tiled, params);
  built.map = tiled.map;
  built.normalMap = tiled.normalMap;
  built.roughnessMap = tiled.roughnessMap;
  built.aoMap = tiled.aoMap;
  if (tiled.metalnessMap) built.metalnessMap = tiled.metalnessMap;
  return { material: built, metresPerTile, owned };
}

/**
 * What each weapon surface *is*, as data.
 *
 * A table rather than seven object literals inside the factory, because these numbers
 * are the answer to a complaint rather than a taste: the view model is lit by one 2.6 cd
 * light 45 cm away and by a night sky, so `metalness` decides whether a receiver comes
 * back as metal or as a black silhouette, and `envIntensity` decides whether the glove
 * reads at all. `tests/unit/weaponMaterials.test.ts` checks the pair, the way
 * `texel.test.ts` checks the density contract.
 */
export const WEAPON_SURFACE: Record<
  'gunmetal' | 'steel' | 'polymer' | 'wood' | 'leather' | 'sleeve' | 'skin',
  SurfaceParams
> = {
  gunmetal: {
    // Anodised aluminium: metal, but *rough* metal, and the sky is the only
    // thing in the rig that puts a highlight on it. Worn edges come from the
    // surface's own height field, which is why the density had to be right.
    //
    // `metalness` is 0.66 rather than a physical 0.92 because of what the *view
    // model* is lit by: one small point light ~40 cm away. A near-pure metal under a
    // point light returns a specular highlight and no diffuse term, so the receiver
    // came back as a black silhouette at 40 cm — the review's "the gun has no hands"
    // was partly this. 0.66 keeps the material metal and gives the view light
    // something to land on.
    //
    // `roughness` 0.56 and `envIntensity` 0.9 are the *other* half of that story, from
    // the sixth report: at 0.44 the specular lobe is narrow enough that a 7 lux source
    // 40 cm away pushed the rail, the optic's tube and the flash hider past 1.0 in the
    // HDR buffer, and everything above the bloom threshold smears across the frame.
    // A broader lobe at a lower gain spreads the same energy over ten times the area:
    // the metal still reads as metal, and the highlight stays on the surface that
    // received the light instead of becoming a screen-wide glow.
    roughness: 0.56,
    metalness: 0.66,
    normalScale: 0.7,
    aoIntensity: 0.9,
    envIntensity: 0.9,
  },
  steel: {
    // Blued and phosphated parts: darker and less reflective than the receiver,
    // which is what separates the barrel from the handguard in silhouette.
    roughness: 0.62,
    metalness: 0.55,
    normalScale: 0.8,
    color: 0x8d8f92,
    envIntensity: 0.85,
  },
  polymer: {
    roughness: 0.74,
    normalScale: 1.15,
    color: 0x53514c,
    envIntensity: 0.85,
  },
  // Oiled walnut: dark, warm, low sheen, with the grain's relief the only thing
  // that catches the weapon light. `normalScale` is low on purpose — a handguard
  // is a sanded part, not a log. The oil is a *gloss* on a matte surface, so the
  // roughness stays high enough that no single facet becomes a mirror.
  wood: {
    roughness: 0.62,
    normalScale: 0.55,
    color: 0x6a4526,
    envIntensity: 0.75,
  },
  // The glove is the object the review kept saying was missing, so it is the one the
  // view light has to win: given the sky at *more* than full strength, so that its
  // fingers, cuff and knuckle seams each hold an edge under a single point light
  // ~40 cm away (ADR-0017). The metals came down by a third in the sixth pass and the
  // view light halved with them; the dielectric surfaces are the ones that take the
  // difference, because a matte surface is where the sky reads as form rather than as
  // a highlight — and a hand lit by the sky cannot blow out.
  leather: {
    roughness: 0.64,
    normalScale: 1.05,
    color: 0x746b5f,
    envIntensity: 1.2,
  },
  // The sleeve is the only soft, matte, non-metal object in view, so it is what tells
  // the eye the gloves belong to a person.
  sleeve: {
    roughness: 0.96,
    normalScale: 1,
    color: 0x6a684e,
    envIntensity: 1.05,
  },
  skin: {
    roughness: 0.5,
    normalScale: 0.6,
    aoIntensity: 0.45,
    envIntensity: 1,
  },
};

/**
 * Optic glass: a thin AR-coated lens you can see through, not a tinted window and not a
 * mirror.
 *
 * Exported separately from the factory so the properties that make a sight picture
 * possible can be tested with no GPU. Three numbers, each one a report:
 *
 *  - `opacity` is **0.06**. The shipped 0.4 over a *dark* colour stacked twice in front
 *    of an eye 12 cm away is a 60% black filter (AGENTS entry 27); the 0.16 that
 *    replaced it was still a visible veil, and the two lenses stack — so the sight
 *    picture was a grey wash with a faint image behind it. Two per cent of nothing is
 *    glass: you see the tint at the lens's edge and the world through its middle.
 *  - `envMapIntensity` is **0.45**. At 1.7 on a 0.04-roughness surface the lens was a
 *    two-way mirror for a night sky: a bright sheen across the whole aperture, which is
 *    the one thing a sight picture cannot afford.
 *  - `depthWrite` is false, because glass must never occlude the reticle or the world
 *    behind it.
 */
export function createLensMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x9fb6bd,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.06,
    depthWrite: false,
    envMapIntensity: 0.45,
    side: THREE.DoubleSide,
  });
}

/**
 * The illuminated reticle.
 *
 * Unlit `MeshBasicMaterial` on purpose: a red dot is a *source*, and a source is the
 * one thing in the frame that does not dim when the sun goes down. `toneMapped: false`
 * keeps it at its own colour through the AgX tone map, which is also why the dot is
 * deliberately *below* the bloom threshold: a reticle that bloomed would be a soft
 * pink blob whose centre is not where you are aiming, and the one thing an aiming
 * system cannot trade away is the exact position of its centre.
 */
export function createDotMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xff2a12,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
}

export function createWeaponMaterials(textures: TextureLibrary): WeaponMaterials {
  const s = textures.surfaces;
  const params = WEAPON_SURFACE;

  const gunmetal = tilesAt(s.gunmetal, WEAPON_TILE_METRES.gunmetal, params.gunmetal);
  const steel = tilesAt(s.steel, WEAPON_TILE_METRES.steel, params.steel);
  const polymer = tilesAt(s.polymer, WEAPON_TILE_METRES.polymer, params.polymer);
  const wood = tilesAt(s.wood, WEAPON_TILE_METRES.wood, params.wood);
  const leather = tilesAt(s.leather, WEAPON_TILE_METRES.leather, params.leather);
  const sleeve = tilesAt(s.fabric, WEAPON_TILE_METRES.sleeve, params.sleeve);
  const skin = tilesAt(s.skin, WEAPON_TILE_METRES.skin, params.skin);

  const lens = createLensMaterial();
  const dot = createDotMaterial();

  const tiles = [gunmetal, steel, polymer, wood, leather, sleeve, skin];
  // One double-sided clone per opaque surface, on demand: an open-ended tube shows
  // its own inner wall, and a single-sided wall is invisible from inside.
  const walls = new Map<string, THREE.MeshStandardMaterial>();
  const wallTiles: WeaponTile[] = [];
  const opticWall = (key: 'gunmetal' | 'steel' | 'polymer'): THREE.MeshStandardMaterial => {
    const cached = walls.get(key);
    if (cached) return cached;
    const source =
      key === 'gunmetal'
        ? ([s.gunmetal, WEAPON_TILE_METRES.gunmetal, params.gunmetal] as const)
        : key === 'steel'
          ? ([s.steel, WEAPON_TILE_METRES.steel, params.steel] as const)
          : ([s.polymer, WEAPON_TILE_METRES.polymer, params.polymer] as const);
    const tile = tilesAt(source[0], source[1], source[2]);
    wallTiles.push(tile);
    const built = tile.material as THREE.MeshStandardMaterial;
    built.side = THREE.DoubleSide;
    built.name = `weapon_${key}_wall`;
    walls.set(key, built);
    return built;
  };
  return {
    gunmetal,
    steel,
    polymer,
    wood,
    leather,
    sleeve,
    skin,
    lens,
    dot,
    opticWall,
    dispose(): void {
      for (const tile of tiles) {
        for (const texture of tile.owned) texture.dispose();
        tile.material.dispose();
      }
      for (const tile of wallTiles) {
        for (const texture of tile.owned) texture.dispose();
        tile.material.dispose();
      }
      wallTiles.length = 0;
      walls.clear();
      lens.dispose();
      dot.dispose();
    },
  };
}
