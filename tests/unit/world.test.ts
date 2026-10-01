/**
 * The world's texel density and the routing of the things that hang (ADR-0014).
 *
 * Two of the review's findings live here, and both are arithmetic rather than art:
 *
 *  1. **The floor was 97 mm per texel and a crate was 3 mm.** `repeat` is baked into
 *     the shared texture, so a mesh's density was whatever its size happened to be.
 *     The fix is that the geometry authors its UVs in *metres* (`geometry.uvMetres`)
 *     and a surface states how many metres one texture tile covers (`UV_DENSITY`).
 *     `uvUnitMetres` bridges the two, because a UV unit is not a tile on a surface
 *     whose texture repeats 8 times inside it.
 *  2. **A cable ran through the monument.** Spans were strung in map order, and the
 *     poles are listed around the block, so consecutive entries can be opposite sides
 *     of the plaza. `crossesMonument` is why the router can refuse a span.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UV_DENSITY, WEAPON_TILE_METRES, crossesMonument, groundMaterialFor, uvUnitMetres } from '@iron/render';

describe('world-space texel density', () => {
  it('bridges a texture that repeats inside a UV unit', () => {
    const tiled = new THREE.MeshStandardMaterial();
    tiled.map = new THREE.Texture();
    tiled.map.repeat.set(8, 8);
    // One paving tile covering 2.6 m, on a surface whose texture repeats 8 times per
    // UV unit: a UV unit is therefore 20.8 m of world.
    expect(uvUnitMetres(tiled, 2.6)).toBeCloseTo(20.8, 6);
    // A prop whose texture is 1:1 needs no correction.
    const once = new THREE.MeshStandardMaterial();
    once.map = new THREE.Texture();
    expect(uvUnitMetres(once, 0.4)).toBeCloseTo(0.4, 6);
    // A material with no map at all is treated as 1:1 rather than as NaN.
    expect(uvUnitMetres(new THREE.MeshStandardMaterial(), 0.5)).toBeCloseTo(0.5, 6);
  });

  it('keeps the floor within an order of magnitude of the weapon, not 30,000x', () => {
    const weapon = Math.max(...Object.values(WEAPON_TILE_METRES));
    // The measured defect: 97 mm per texel on the floor and 0.3 mm on a crate in the
    // same frame. The floor is still the coarsest surface in the game by design, but
    // it is now 19x denser than it was and well inside an order of magnitude of a
    // prop the player can touch.
    expect(UV_DENSITY.plazaFloor).toBeGreaterThan(weapon * 20);
    expect(UV_DENSITY.crate).toBeLessThan(UV_DENSITY.plazaFloor / 4);
  });

  it('states a physical size for every surface class in the table', () => {
    for (const [surface, metres] of Object.entries(UV_DENSITY)) {
      expect(metres, surface).toBeGreaterThan(0.1);
      expect(metres, surface).toBeLessThan(8);
    }
  });
});

describe('the floor the map asks for', () => {
  const materials = {
    ground: new THREE.MeshStandardMaterial({ name: 'paving' }),
    road: new THREE.MeshStandardMaterial({ name: 'asphalt' }),
    sand: new THREE.MeshStandardMaterial({ name: 'sand' }),
  } as never;

  it('honours groundSurface instead of always drawing the paving', () => {
    expect(groundMaterialFor('concrete', materials).name).toBe('paving');
    expect(groundMaterialFor('paving', materials).name).toBe('paving');
    expect(groundMaterialFor('asphalt', materials).name).toBe('asphalt');
  });

  it('draws a sand map as sand', () => {
    // This test used to assert the opposite — that 'sand' fell back to the paving — which
    // is how a map's ground could be asked for sand and render as mortar-jointed flags.
    // The *cause* was the missing case in `groundMaterialFor`, so the case was added and
    // the assertion follows it (AGENTS.md: fix the cause, not the assertion).
    expect(groundMaterialFor('sand', materials).name).toBe('sand');
  });

  it('falls back to the paving for a surface it does not know', () => {
    expect(groundMaterialFor('gravel', materials).name).toBe('paving');
    expect(groundMaterialFor('', materials).name).toBe('paving');
  });
});

describe('cable routing', () => {
  const monument = new THREE.Vector2(0, 0);

  it('refuses a span that would cross the monument', () => {
    // Straight through the middle: the defect the review photographed.
    expect(crossesMonument(new THREE.Vector3(-30, 6.8, 0), new THREE.Vector3(30, 6.8, 0), monument)).toBe(true);
    // Past it: 20 m of clearance.
    expect(crossesMonument(new THREE.Vector3(-30, 6.8, 20), new THREE.Vector3(30, 6.8, 20), monument)).toBe(false);
  });

  it('measures the footprint, not the endpoints', () => {
    // Both poles are 25 m away from the monument and the span still passes over it.
    expect(crossesMonument(new THREE.Vector3(-25, 6.8, 0), new THREE.Vector3(25, 6.8, 1), monument)).toBe(true);
    // An endpoint inside the footprint is a span that crosses it.
    expect(crossesMonument(new THREE.Vector3(0, 6.8, 0), new THREE.Vector3(30, 6.8, 30), monument)).toBe(true);
  });

  it('is safe when there is no monument, or a degenerate span', () => {
    const a = new THREE.Vector3(5, 6.8, 5);
    expect(crossesMonument(a, new THREE.Vector3(9, 6.8, 9), null)).toBe(false);
    expect(crossesMonument(a, a.clone(), monument)).toBe(false);
  });
});
