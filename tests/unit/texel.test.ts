/**
 * Texel density, and the UV contract that keeps it constant.
 *
 * The most-reported visual problem in the review was the least visible in a
 * screenshot's metadata: `repeat` was baked into the *texture*, so a mesh's texel
 * density was `texture pixels / mesh size`. Measured on the shipped content that
 * is ~100 mm per texel on the plaza floor and ~3 mm on a crate — a 34,000× spread
 * in the same frame, which is why concrete read as flat paint and every prop read
 * as cardboard.
 *
 * The fix is that a surface declares how many *metres* one texture tile covers and
 * the geometry authors its own UVs in metres (`geometry.uvMetres`). These are the
 * checks that say so without a GPU: the tile sizes are real-world sizes, and
 * `uvMetres` scales UVs by (size / metresPerTile) — exactly, on every attribute
 * set it finds, and without touching the geometry it was given.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  UV_DENSITY,
  UV_PIXELS,
  WEAPON_TILE_METRES,
  boxUvMetres,
  limb,
  uvMetres,
  type SurfaceSpecKey,
} from '@iron/render';

/**
 * The world's density contract: pixels per metre, per surface class.
 *
 * This is the half of the review's *everything is blurry at every graphics level* that
 * a resolution setting cannot reach. A resolution change moves how many pixels are on
 * screen; this table is how many texels are on the surface, and the two are only
 * comparable if you divide them: a wall is read at about 1.7 mm per screen pixel from
 * two metres, so a wall texture at 11.7 mm per texel (a 256² map over a 3 m storey)
 * cannot look like anything but a smear, however many pixels the frame has (ADR-0017).
 *
 * The floors are "dense enough for the distance the player gets to it", and they are
 * deliberately tight — within 15% of the shipped value — so that lowering a texture's
 * resolution, or enlarging the tile it is stretched over, fails here first.
 */
const DENSITY_CONTRACT: { surface: SurfaceSpecKey; tile: number; minPxPerMetre: number; why: string }[] = [
  {
    surface: 'ground',
    tile: UV_DENSITY.plazaFloor,
    minPxPerMetre: 350,
    why: 'the plaza floor, looked down at from 2 m and walked on',
  },
  { surface: 'building', tile: UV_DENSITY.building, minPxPerMetre: 380, why: "a facade at arm's length" },
  { surface: 'wood', tile: UV_DENSITY.crate, minPxPerMetre: 1000, why: 'an ammo crate at 1 m' },
  { surface: 'sandbag', tile: UV_DENSITY.sandbag, minPxPerMetre: 600, why: 'hessian weave at 1 m' },
  { surface: 'steel', tile: UV_DENSITY.metalPanel, minPxPerMetre: 400, why: 'a gate, a lamp post, a plate' },
  { surface: 'polymer', tile: UV_DENSITY.metalPanel, minPxPerMetre: 400, why: 'stippled furniture' },
  { surface: 'concrete', tile: UV_DENSITY.sidewalk, minPxPerMetre: 250, why: 'a kerb at 3 m' },
  { surface: 'stone', tile: UV_DENSITY.rock, minPxPerMetre: 300, why: 'a rock at 1 m' },
  { surface: 'asphalt', tile: UV_DENSITY.road, minPxPerMetre: 150, why: 'a road, seen at distance' },
  { surface: 'plaster', tile: UV_DENSITY.facade, minPxPerMetre: 150, why: 'a weathered wall' },
  { surface: 'fabric', tile: UV_DENSITY.banner, minPxPerMetre: 200, why: 'cloth' },
];

/** Which map a weapon surface comes from, and how big it is (materials/textures.ts). */
const WEAPON_SURFACE_MAP = {
  gunmetal: 'gunmetal',
  steel: 'steel',
  polymer: 'polymer',
  wood: 'wood',
  leather: 'leather',
  sleeve: 'fabric',
  skin: 'skin',
} as const satisfies Record<keyof typeof WEAPON_TILE_METRES, SurfaceSpecKey>;

const maxOf = (geometry: THREE.BufferGeometry, name: 'uv' | 'uv1'): { u: number; v: number } => {
  const uv = geometry.getAttribute(name) as THREE.BufferAttribute;
  let u = 0;
  let v = 0;
  for (let i = 0; i < uv.count; i++) {
    u = Math.max(u, uv.getX(i));
    v = Math.max(v, uv.getY(i));
  }
  return { u, v };
};

describe('texel density', () => {
  it('gives every weapon surface a real-world tile size', () => {
    for (const [surface, metres] of Object.entries(WEAPON_TILE_METRES)) {
      // A tile is a physical size: no surface is tiled at 1 m (which is a smear on
      // a 7 cm receiver) or at 5 mm (which is noise).
      expect(metres, surface).toBeGreaterThanOrEqual(0.02);
      expect(metres, surface).toBeLessThanOrEqual(0.2);
      // ...and the resulting texel is sub-millimetre, which is what makes metal
      // read as metal at 40 cm from the eye. The map's own size comes from
      // `UV_PIXELS`, not from a constant here: a weapon surface shares the world's
      // map, so lowering that map lowers the weapon's density too, and this is the
      // assertion that notices.
      const pixels = UV_PIXELS[WEAPON_SURFACE_MAP[surface as keyof typeof WEAPON_TILE_METRES]];
      const millimetresPerTexel = (metres / pixels) * 1000;
      expect(millimetresPerTexel, `${surface} (${pixels}²)`).toBeLessThan(0.5);
    }
  });

  it('keeps every world surface above its measured density floor', () => {
    for (const row of DENSITY_CONTRACT) {
      const pixels = UV_PIXELS[row.surface];
      const pxPerMetre = pixels / row.tile;
      expect(
        pxPerMetre,
        `${row.surface}: ${pixels}² over ${row.tile} m (${row.why})`,
      ).toBeGreaterThanOrEqual(row.minPxPerMetre);
    }
  });

  it('keeps a building wall denser than a quarter of a millimetre per texel', () => {
    // The specific defect of the third review: the facade map was 256² stretched over
    // `UV_DENSITY.building` = 2.5 m, i.e. 9.8 mm per texel, and the map also carried the
    // storey slab band so the tile *had* to be a storey. The band is geometry now
    // (`arena.buildBuilding`), which is what lets the tile come down to 1.2 m and the
    // map go up to 512² — 2.3 mm per texel, 4.2x denser than it was.
    const millimetresPerTexel = (UV_DENSITY.building / UV_PIXELS.building) * 1000;
    expect(millimetresPerTexel).toBeLessThan(2.5);
  });

  it('keeps the weapon far denser than the world it is drawn against', () => {
    // The ground and the props are the comparison the review was making: whatever
    // the world's density ends up as, an object in the hand has to beat it by an
    // order of magnitude or it reads as a toy.
    const weapon = Math.max(...Object.values(WEAPON_TILE_METRES));
    expect(UV_DENSITY.plazaFloor).toBeGreaterThan(weapon * 20);
  });

  it('beats every world surface in the frame at 40 cm', () => {
    // The other direction of the same argument: if a wall is now 2.3 mm per texel, the
    // metal in the player's hands has to be finer still, or the weapon is the softest
    // object on screen — which is exactly how a detailed receiver reads as a plank.
    const worldDensest = Math.max(
      UV_PIXELS.wood / UV_DENSITY.crate,
      UV_PIXELS.sandbag / UV_DENSITY.sandbag,
      UV_PIXELS.building / UV_DENSITY.building,
      UV_PIXELS.ground / UV_DENSITY.plazaFloor,
    );
    const weaponDensest = Math.max(
      UV_PIXELS.gunmetal / WEAPON_TILE_METRES.gunmetal,
      UV_PIXELS.steel / WEAPON_TILE_METRES.steel,
      UV_PIXELS.polymer / WEAPON_TILE_METRES.polymer,
      UV_PIXELS.leather / WEAPON_TILE_METRES.leather,
      UV_PIXELS.skin / WEAPON_TILE_METRES.skin,
    );
    expect(weaponDensest).toBeGreaterThan(worldDensest * 3);
  });

  it('authors UVs in metres, not in tiles', () => {
    const width = 0.078;
    const height = 0.062;
    const length = 0.21;
    const tile = 0.08;
    const geometry = uvMetres(new THREE.BoxGeometry(width, height, length), length, height, tile);
    const { u, v } = maxOf(geometry, 'uv');
    // A 21 cm receiver at 8 cm per tile is 2.6 tiles across: 262 texels of an
    // 8 cm tile, which is what "a receiver is metal at arm's length" means.
    expect(u).toBeCloseTo(length / tile, 5);
    expect(v).toBeCloseTo(height / tile, 5);
  });

  it('gives every face of a box its own real-world density', () => {
    // The defect this exists for: a `BoxGeometry` gives all six faces the same 0..1 UV
    // square, so a building shell scaled by one pair of numbers was textured at a
    // different density on every face — a 20 x 12 x 18 m block was smeared as if all
    // three dimensions were 18 m, which is the review's "the buildings are blurry and
    // the wall is noise". `boxUvMetres` authors each face from its own two dimensions,
    // and this checks all six.
    const width = 20;
    const height = 12;
    const depth = 18;
    const tile = 2.5; // UV_DENSITY.building
    const geometry = boxUvMetres(width, height, depth, tile);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    // BoxGeometry's face order: +X, -X, +Y, -Y, +Z, -Z, four corners each.
    const extents: readonly (readonly [number, number])[] = [
      [depth, height],
      [depth, height],
      [width, depth],
      [width, depth],
      [width, height],
      [width, height],
    ];
    for (let face = 0; face < 6; face++) {
      let u = 0;
      let v = 0;
      for (let corner = 0; corner < 4; corner++) {
        const index = face * 4 + corner;
        u = Math.max(u, uv.getX(index));
        v = Math.max(v, uv.getY(index));
      }
      const [faceU, faceV] = extents[face]!;
      expect(u, `face ${face} u`).toBeCloseTo(faceU / tile, 5);
      expect(v, `face ${face} v`).toBeCloseTo(faceV / tile, 5);
    }
    // ...and the AO set is authored the same way, because `aoMap` needs a second UV
    // channel and a box that had one would render its occlusion at the wrong scale.
    const ao = geometry.getAttribute('uv1') as THREE.BufferAttribute;
    const last = 23; // six faces of four corners: the final vertex
    expect(ao.getX(last)).toBeCloseTo(uv.getX(last), 5);
    expect(ao.getY(last)).toBeCloseTo(uv.getY(last), 5);
  });

  it('scales every UV set it finds, including the AO set', () => {
    const plain = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    plain.setAttribute('uv1', plain.getAttribute('uv').clone());
    const scaled = uvMetres(plain, 0.2, 0.2, 0.05);
    expect(maxOf(scaled, 'uv').u).toBeCloseTo(4, 5);
    expect(maxOf(scaled, 'uv1').v).toBeCloseTo(4, 5);
  });

  it('clones, because geometries are cached and shared by size', () => {
    const original = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const before = maxOf(original, 'uv').u;
    const scaled = uvMetres(original, 0.2, 0.2, 0.05);
    // The source is untouched — the defect this prevents is a scaled-in-place
    // cached box corrupting every other user of the same size.
    expect(maxOf(original, 'uv').u).toBe(before);
    expect(scaled).not.toBe(original);
  });

  it('survives a zero or absurd tile size', () => {
    const geometry = uvMetres(new THREE.BoxGeometry(1, 1, 1), 1, 1, 0);
    expect(Number.isFinite(maxOf(geometry, 'uv').u)).toBe(true);
  });

  it('makes a limb a tapered tube of the requested length, with UVs per metre', () => {
    const length = 0.29;
    const geometry = uvMetres(limb(0.048, 0.056, length, 12), 2 * Math.PI * 0.052, length, 0.12);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Authored along +Y, thick end at -Y: that is the contract `viewmodel.ts`
    // relies on when it rotates a limb onto a shoulder-to-elbow segment.
    expect(box.max.y - box.min.y).toBeGreaterThan(length * 0.9);
    expect(box.max.y - box.min.y).toBeLessThan(length * 1.2);
    expect(box.max.x - box.min.x).toBeGreaterThan(0.09);
    // Circumference × length, in tiles.
    const { u, v } = maxOf(geometry, 'uv');
    expect(u).toBeCloseTo((2 * Math.PI * 0.052) / 0.12, 3);
    expect(v).toBeCloseTo(length / 0.12, 3);
  });
});
