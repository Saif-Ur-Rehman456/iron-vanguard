/**
 * Arena construction.
 *
 * Everything here is generated from `MapDef` props, which in the prototype was
 * hard-coded level code: the editor and the Blender kits replace individual props
 * without touching the renderer.
 *
 * The rule that shapes this file: nothing is a scaled cube. A wall has a plinth and
 * a coping, a barrel is a lathed profile with rolling hoops, a barrier is the real
 * Jersey cross-section extruded along its length, and a wreck is a lofted car hull
 * with wheels that sit *in* arches. Those details are what separate "stylised
 * blocks" from "a place that exists".
 */
import * as THREE from 'three';
import { createRng, type Rng } from '@iron/core';
import type { MapDef, PropDef } from '@iron/content';
import { emptyModelLibrary, type ModelLibrary } from '../assets/models';
import { StaticBatcher, disposeBatched, batchOne } from '../batch';
import {
  BEVEL,
  boxUvMetres,
  cableBetween,
  chamferedCylinder,
  lathe,
  roundedBox,
  rubbleChunk,
  shiftUv,
  uvMetres,
  withAoUv,
} from '../geometry';
import { UV_DENSITY, uvUnitMetres, type Materials } from '../materials/materials';
import { DETAIL } from './detail';
import type { TextureLibrary } from '../materials/textures';
import type { QualitySettings } from '../quality';

export interface ArenaRuntime {
  group: THREE.Group;
  /** Barrel meshes indexed to match `world.barrels`. */
  barrelMeshes: THREE.Group[];
  fireLightAnchor: THREE.Vector3;
  smokeAnchors: THREE.Vector3[];
  bannerAnchors: THREE.Object3D[];
  /**
   * World positions of the lit panes, so a small pool of real lights can follow
   * the player (level/lighting.ts). Every window is emissive at every tier; only
   * the nearest few are ever allowed to shade geometry around them.
   */
  windowAnchors: THREE.Vector3[];
  /** Every street lamp's halo sprite material, for the atmosphere to dim (see `applyGlow`). */
  lampGlows: THREE.SpriteMaterial[];
  /** Ambient animation: banner sway and dust drift. */
  update(playerX: number, playerZ: number, time: number, dt: number): void;
  setBarrelAlive(index: number, alive: boolean): void;
  clearTransient(): void;
  dispose(): void;
}

interface Build {
  group: THREE.Group;
  /** Static geometry: baked into one merged mesh per material at the end. */
  batcher: StaticBatcher;
  materials: Materials;
  textures: TextureLibrary;
  rng: Rng;
  quality: QualitySettings;
  models: ModelLibrary;
  barrelMeshes: THREE.Group[];
  bannerAnchors: THREE.Object3D[];
  windowAnchors: THREE.Vector3[];
  /**
   * Every street lamp's halo sprite material.
   *
   * Exposed so the atmosphere can dim it: the halo is additive and unlit, so unlike a
   * lamp's light it does not care whether the sun is up — a daylight scene with forty
   * glowing lamp halos is a night scene with a bright fog.
   */
  lampGlows: THREE.SpriteMaterial[];
}

/** The lamp halo's opacity at dusk; the atmosphere scales it (see `applyGlow`). */
export const LAMP_GLOW_OPACITY = 0.45;

/** Add a static prop subtree to the batch instead of the live scene graph. */
function place(build: Build, object: THREE.Object3D): void {
  build.batcher.add(object);
}

/**
 * Author a prop's UVs in metres, so its texel density stops depending on its size.
 *
 * Sizes differ per prop — a 0.8 m crate and a 1.6 m crate share this code — and with
 * the tiling baked into the texture the smaller one is tiled twice as finely as the
 * larger. One call per prop, and the density is a property of the *surface*.
 */
function density(mesh: THREE.Mesh, u: number, v: number, tile: number): THREE.Mesh {
  uvMetres(mesh.geometry, u, v, tile);
  return mesh;
}

/**
 * The floor material a map asks for (ADR-0014).
 *
 * `MapDef.groundSurface` was read by the simulation (footsteps, impact decals) and by
 * the editor, and ignored by the renderer, which always drew the paving. That is the
 * kind of declaration that quietly stops meaning anything; the map now decides, and
 * an unknown surface falls back to the paving rather than rendering nothing.
 */
export function groundMaterialFor(surface: string, materials: Materials): THREE.MeshStandardMaterial {
  switch (surface) {
    case 'asphalt':
      return materials.road;
    // A map whose ground is sand was falling back to the plaza paving, so the *one*
    // surface the seventh review asked to be soft, granular and pale was rendering as
    // mortar-jointed flags. A sand map is a different place, and now it looks like one.
    case 'sand':
      return materials.sand;
    case 'concrete':
    case 'paving':
    default:
      return materials.ground;
  }
}

/**
 * Does a cable span pass over the monument?
 *
 * Cables were strung between poles in map order, which strung them *through* the
 * monument. The check is a 2-D point-to-segment distance: if the monument's footprint
 * is under the span, the span is not a span a lineman would run.
 */
export function crossesMonument(
  a: THREE.Vector3,
  b: THREE.Vector3,
  centre: THREE.Vector2 | null,
  radius = 6,
): boolean {
  if (!centre) return false;
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-6) return false;
  const t = Math.max(
    0,
    Math.min(1, ((centre.x - a.x) * abx + (centre.y - a.z) * abz) / lengthSq),
  );
  const px = a.x + abx * t;
  const pz = a.z + abz * t;
  return Math.hypot(px - centre.x, pz - centre.y) < radius;
}

/**
 * What a hanging banner is attached to.
 *
 * A banner in the review's frames was a cloth plane at 5.2 m with nothing above it.
 * A bracket is cheap and answers the question the eye asks first: a crossbar over the
 * top edge, two arms angled back to the wall, and a weight bar at the bottom so the
 * cloth is under tension rather than hanging like paper.
 */
function buildBannerBracket(materials: Materials): THREE.Group {
  const bracket = new THREE.Group();
  bracket.name = 'banner_bracket';
  const part = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rz = 0,
  ): void => {
    const mesh = new THREE.Mesh(roundedBox(w, h, d, 0.006), materials.metal);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    mesh.castShadow = true;
    bracket.add(mesh);
  };
  part(0.86, 0.045, 0.045, 0, 0.03, -0.03); // crossbar over the top edge
  part(0.05, 0.05, 0.42, -0.3, 0.13, -0.24, 0.35); // arm back to the wall
  part(0.05, 0.05, 0.42, 0.3, 0.13, -0.24, 0.35);
  part(0.78, 0.04, 0.03, 0, -1.62, -0.02); // weight bar at the hem
  return bracket;
}

/**
 * A box that belongs to the batch. Built on a throwaway parent so it is never
 * also parented to the live graph (which would render it twice).
 */
function staticBox(
  build: Build,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
): THREE.Mesh {
  const scratch = new THREE.Group();
  const mesh = box(scratch, material, w, h, d, x, y, z);
  mesh.rotation.y = ry;
  place(build, mesh);
  return mesh;
}

function add(parent: THREE.Object3D, mesh: THREE.Mesh, cast = true, receive = true): THREE.Mesh {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

/** Rounded box mesh with an explicit size — the workhorse for man-made shapes. */
function box(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  radius = BEVEL,
): THREE.Mesh {
  const mesh = add(parent, new THREE.Mesh(roundedBox(w, h, d, radius), material), true, true);
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Shape helper: extrude a 2D cross-section along an axis. Used for the Jersey
 * barrier and the car hull, where the profile *is* the object.
 */
function extrudeProfile(
  points: readonly [number, number][],
  depth: number,
  material: THREE.Material,
  bevelSize = 0.012,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(points[0]![0], points[0]![1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 2,
    curveSegments: 2,
  });
  geometry.translate(0, 0, -depth / 2);
  return new THREE.Mesh(withAoUv(geometry), material);
}

// ---------------------------------------------------------------------------
// Prop builders
// ---------------------------------------------------------------------------

function buildWall(build: Build, prop: PropDef, width: number, height: number, depth: number): void {
  const { materials, rng } = build;
  const wall = new THREE.Group();
  wall.position.set(prop.x, 0, prop.z);
  wall.rotation.y = prop.ry ?? 0;

  // Plinth (wider foot) + coping (overhanging cap): two horizontal lines break up
  // an otherwise featureless slab, and they are how walls are actually built.
  box(wall, materials.concrete, width, height, depth, 0, height / 2, 0, 0.04);
  box(wall, materials.concreteClean, width + 0.16, 0.28, depth + 0.16, 0, 0.14, 0, 0.05);
  box(wall, materials.concreteClean, width + 0.22, 0.22, depth + 0.22, 0, height + 0.05, 0, 0.06);

  // Barred windows, so a perimeter wall reads as a compound rather than a box.
  if (width > 5) {
    const count = Math.max(1, Math.floor(width / 6));
    const ry = prop.ry ?? 0;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    for (let i = 0; i < count; i++) {
      const x = (-width / 2 + 1.4) + ((i + 0.5) * (width - 2.8)) / count;
      // Reveal proud of the wall, glass behind it, bars in front: three depths,
      // which is what a real opening looks like from an angle.
      box(wall, materials.concreteClean, 1.5, 0.9, 0.24, x, height * 0.62, depth / 2 - 0.06, 0.02).castShadow = false;
      // Only *some* windows have a light on — a facade where every opening glows
      // is the tell of a game that lit them for symmetry.
      const litInside = (i + (prop.variant ?? 0)) % 3 !== 0;
      box(
        wall,
        litInside ? materials.windowGlow : materials.dark,
        1.28,
        0.7,
        0.06,
        x,
        height * 0.62,
        depth / 2 + 0.07,
        0.01,
      ).castShadow = false;
      if (litInside) {
        // World position of the pane: the light pool follows these, and the pane
        // is offset from the wall's own centre along its facing direction.
        const localZ = depth / 2 + 0.12;
        build.windowAnchors.push(
          new THREE.Vector3(
            prop.x + cos * x + sin * localZ,
            height * 0.62,
            prop.z - sin * x + cos * localZ,
          ),
        );
      }
      for (let bar = -2; bar <= 2; bar++) {
        const rod = add(wall, new THREE.Mesh(chamferedCylinder(0.025, 0.025, 0.84, 6), materials.metal), true, false);
        rod.position.set(x + bar * 0.26, height * 0.62, depth / 2 + 0.11);
      }
      void rng;
    }
  }
  // Spalling near the base: broken concrete, not a clean corner.
  if (prop.tag === 'damaged') {
    for (let i = 0; i < 5; i++) {
      const chunk = add(
        wall,
        new THREE.Mesh(rubbleChunk(0x9e37 + i * 7, rng.range(0.2, 0.45)), materials.concrete),
        true,
        true,
      );
      chunk.position.set(rng.range(-width / 2, width / 2), rng.range(0.05, 0.4), depth / 2 + 0.2);
      chunk.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    }
  }
  place(build, wall);
}

/**
 * One storey of windows on a building's street faces.
 *
 * Windows are the single most legible thing about a building's scale, and the
 * previous build painted them: rows of openings baked into the wall texture's albedo,
 * including the "lit" ones, as flat orange rectangles. Three consequences, all of
 * them in the review's frames — the window pattern was stretched to whatever the wall
 * happened to be, a lit window was a *colour* rather than a source so it could not
 * glow or be occluded, and there was no sill, reveal or recess for the light to catch,
 * so the facade had no depth at all.
 *
 * This builds them instead. Three parts per opening, at three depths: a proud reveal
 * frame on the wall plane, a pane set 5 cm behind it that is either lit glass
 * (`windowGlow`, an unlit material, because a source is a source) or dark glass, and a
 * sill below it. Only some are lit — a facade where every opening glows is the tell of
 * a game that lit them for symmetry — and a lit one registers an anchor, which is what
 * the window-light pool in `level/lighting.ts` snaps to.
 *
 * Two faces (front and back) rather than four: a block's other two walls are seen
 * edge-on or not at all, and each opening is three boxes, so the count matters.
 */
/**
 * An opening as *construction*: a cap, a ledge, and glass set behind both (ADR-0021).
 *
 * The first version of a window was three boxes and none of them made an opening: a concrete
 * ``reveal`` sat on the wall, and the pane was placed 9 cm *in front of* that reveal — so the
 * glass covered its own frame and the assembly was a dark plate standing 15 cm off the facade.
 * The review's "windows ko actual recessed openings ya layered construction do" is exactly
 * that: a window is a hole in a wall with a frame around it, and what the eye reads as the
 * hole is the *shadow* of the reveal, i.e. the distance between the glass and the thing that
 * overhangs it.
 *
 * It cannot be a real hole — a building shell is one solid box, so anything behind its surface
 * is inside the building and invisible. So the construction is the honest approximation: a
 * lintel and a sill that stand proud, and glass whose front face is 1–2 cm off the wall, i.e.
 * **14–18 cm behind the outer edge of its own frame** in normal terms. Pure data, so the
 * geometry can be asserted without a GPU (`tests/unit/detail.test.ts`).
 */
export interface WindowConstruction {
  lintel: { size: [number, number, number]; at: [number, number, number] };
  sill: { size: [number, number, number]; at: [number, number, number] };
  pane: { size: [number, number, number]; at: [number, number, number] };
}

export function windowConstruction(paneW: number, paneH: number): WindowConstruction {
  return {
    // Bottom edge of the lintel is the top edge of the glass: the cap sits *on* the opening.
    lintel: { size: [paneW + 0.3, 0.14, 0.22], at: [0, paneH / 2 + 0.07, 0.07] },
    // The sill is the deepest piece — it is the ledge, and the shadow under it is the line
    // that tells the eye the window is an opening rather than a panel.
    sill: { size: [paneW + 0.3, 0.1, 0.26], at: [0, -(paneH / 2 + 0.05), 0.09] },
    pane: { size: [paneW, paneH, 0.04], at: [0, 0, 0.02] },
  };
}

function buildWindowRow(
  build: Build,
  building: THREE.Group,
  prop: PropDef,
  width: number,
  depth: number,
  y: number,
): void {
  const { materials } = build;
  const variant = prop.variant ?? 0;
  const paneW = 1.15;
  const paneH = 1.3;
  const window = windowConstruction(paneW, paneH);
  const paneTile = uvUnitMetres(materials.dark, UV_DENSITY.metalPanel);
  const columns = Math.max(1, Math.floor((width - 1.6) / 3.2));
  const ry = prop.ry ?? 0;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const anchored: THREE.Vector3[] = [];

  for (const face of [1, -1]) {
    const wall = (face * depth) / 2;
    for (let col = 0; col < columns; col++) {
      const x = -width / 2 + 1.1 + col * ((width - 2.2) / Math.max(1, columns - 1 || 1));
      const lit = (col * 5 + variant * 3 + Math.round(y)) % 4 === 0;
      // Frame first, glass second: the lintel and the sill are proud of the wall and the pane
      // sits behind both, so the reveal is *depth* rather than a plate on a facade.
      for (const piece of [window.lintel, window.sill]) {
        const [sizeW, sizeH, sizeD] = piece.size;
        const cap = add(
          building,
          new THREE.Mesh(
            uvMetres(withAoUv(new THREE.BoxGeometry(sizeW, sizeH, sizeD)), sizeW, sizeD, paneTile),
            materials.concreteClean,
          ),
          false,
          true,
        );
        cap.position.set(x, y + piece.at[1], wall + face * piece.at[2]);
      }
      const pane = add(
        building,
        new THREE.Mesh(
          uvMetres(withAoUv(new THREE.BoxGeometry(paneW, paneH, window.pane.size[2])), paneW, paneH, paneTile),
          lit ? materials.windowGlow : materials.dark,
        ),
        false,
        false,
      );
      pane.position.set(x, y, wall + face * window.pane.at[2]);
      if (lit) anchored.push(new THREE.Vector3(x, y, wall + face * 0.3));
    }
  }

  for (const local of anchored) {
    build.windowAnchors.push(
      new THREE.Vector3(
        prop.x + cos * local.x + sin * local.z,
        local.y,
        prop.z - sin * local.x + cos * local.z,
      ),
    );
  }
}

/**
 * Secondary forms on a facade: the things that make a block a building (ADR-0021).
 *
 * A wall, a plinth, a storey band and a parapet is a *box with lines on it* — the review's
 * first item: "buildings ko sirf large cubes ke taur par mat rakho… balconies, window
 * recesses, ledges, entrances, roof structures, pillars, AC units, vents". The point is not
 * extra polygons for their own sake: an attached form casts its own shadow, and that shadow
 * is what reads as architecture from 20 m, where no texture can.
 *
 * Everything here is deterministic from the arena's RNG and guarded by the *mid* detail
 * budget (`level/detail.ts`), so the cost is one number and the variation is still a
 * variation: two buildings of the same variant get their entrance, their canopy and their
 * utility boxes in different places rather than being one building twice.
 */
function buildFacadeDetail(
  build: Build,
  building: THREE.Group,
  prop: PropDef,
  width: number,
  height: number,
  depth: number,
): void {
  if (!DETAIL.mid.secondary) return;
  const { materials, rng } = build;
  const bevel = DETAIL.mid.bevel;
  const wall = depth / 2;
  const doorW = Math.min(2.8, Math.max(1.6, width * 0.22));
  const doorH = 2.4;
  const x = rng.range(-width / 4, width / 4);

  // ---- entrance: a doorway with jambs, a lintel and a canopy over it ----------
  box(building, materials.dark, doorW, doorH, 0.1, x, doorH / 2, wall - 0.03, 0.01);
  for (const side of [-1, 1]) {
    box(building, materials.concreteClean, 0.24, doorH + 0.1, 0.34, x + side * (doorW / 2 + 0.12), (doorH + 0.1) / 2, wall + 0.09, bevel);
  }
  box(building, materials.concreteClean, doorW + 0.7, 0.28, 0.44, x, doorH + 0.24, wall + 0.12, bevel);
  // The canopy is what makes an entrance read as an entrance: a slab on two braced struts,
  // standing a metre off the facade so it drops a real shadow onto the wall behind it.
  box(building, materials.metal, doorW + 1.3, 0.1, 1.05, x, doorH + 0.72, wall + 0.45, 0.02);
  for (const side of [-1, 1]) {
    const strut = add(
      building,
      new THREE.Mesh(chamferedCylinder(0.028, 0.028, 1.15, 8), materials.metal),
      true,
      false,
    );
    strut.position.set(x + side * ((doorW + 1.3) / 2 - 0.18), doorH + 0.28, wall + 0.62);
    strut.rotation.x = -Math.atan2(0.62, 0.85);
  }

  // ---- service: a sat box and a grille, where a real wall has them -------------
  const serviceY = Math.min(height - 1.6, 3.4 + rng.range(0, 1.4));
  const serviceX = rng.range(-width / 2 + 1.2, width / 2 - 1.2);
  box(building, materials.metal, rng.range(0.7, 1.05), rng.range(0.55, 0.8), 0.42, serviceX, serviceY, wall + 0.14, 0.02);
  // A grille is slats, not a panel: three thin bars read as a louvre from below.
  for (let i = 0; i < 3; i++) {
    box(building, materials.dark, 0.7, 0.05, 0.1, serviceX - 1.1, serviceY - 0.35 + i * 0.18, wall + 0.06, 0.008);
  }

  // ---- one balcony, on some blocks, on one storey -----------------------------
  if ((prop.variant ?? 0) % 2 === 0 && height > 8) {
    const balconyY = 3 + Math.floor(rng.range(1, Math.max(1.2, height / 3 - 1.6))) * 3;
    const balconyX = rng.range(-width / 2 + 2, width / 2 - 2);
    const balconyW = Math.min(3.6, width * 0.34);
    box(building, materials.concreteClean, balconyW, 0.18, 1.5, balconyX, balconyY, wall + 0.7, 0.02);
    box(building, materials.concreteClean, balconyW, 0.1, 0.1, balconyX, balconyY + 1.02, wall + 1.4, 0.02);
    for (const side of [-1, 1]) {
      const rail = add(
        building,
        new THREE.Mesh(chamferedCylinder(0.03, 0.03, 1.0, 8), materials.metal),
        true,
        false,
      );
      rail.position.set(balconyX + side * (balconyW / 2 - 0.08), balconyY + 0.55, wall + 1.4);
      // Bracket under the slab: a slab cantilevered out of a wall with nothing holding it is
      // the tell of geometry that was placed rather than built.
      box(building, materials.metal, 0.1, 0.5, 0.7, balconyX + side * (balconyW / 2 - 0.4), balconyY - 0.3, wall + 0.4, 0.02).rotation.z = side * 0.3;
    }
  }

  // ---- pilasters, on the tall blocks ----------------------------------------
  if (height > 12 && width > 14) {
    for (const side of [-1, 1]) {
      box(building, materials.concreteClean, 0.6, height - 0.8, 0.3, side * (width / 2 - 0.5), (height - 0.8) / 2, wall + 0.1, bevel);
    }
  }
}

function buildBuilding(build: Build, prop: PropDef, width: number, height: number, depth: number): void {
  const { materials, rng } = build;
  const building = new THREE.Group();
  building.position.set(prop.x, 0, prop.z);
  building.rotation.y = prop.ry ?? 0;

  const material = materials.buildings[(prop.variant ?? 0) % materials.buildings.length]!;
  // The shell is the one mesh in the arena whose dimensions vary by tens of metres, so
  // it is the one that has to author its UVs *per face* rather than per mesh: a
  // 20 x 12 x 18 m block was textured as if all three of its dimensions were 18 m, so
  // the plaster was a smear at four different densities on the same building — the
  // review's "the buildings are blurry and the texture is noise".
  // Repetition break: each shell samples its own window onto the facade map.
  //
  // A city block of nine buildings shares three facade maps, so with `variant` alone two
  // walls of the same variant are the same wall — the review's items 7 and 16, and the
  // reason a background tower reads as wallpaper at 40 m. An offset is free (it is the same
  // texture, the same material and the same draw call) and it is per *face* group, so the
  // four sides of one building do not line up into a pattern either.
  const shellGeometry = shiftUv(
    boxUvMetres(width, height, depth, uvUnitMetres(material, UV_DENSITY.building)),
    rng.range(0, 1),
    rng.range(0, 1),
  );
  const shell = new THREE.Mesh(shellGeometry, material);
  shell.position.set(0, height / 2, 0);
  add(building, shell, true, true);
  box(building, materials.concreteClean, width + 0.4, 0.5, depth + 0.4, 0, 0.25, 0, 0); // plinth
  // Floor bands every storey: they scale the building and give the facade relief, and
  // they are also what the windows hang under, so the two have to agree on 3 m.
  for (let y = 3; y < height - 0.5; y += 3) {
    box(building, materials.concreteClean, width + 0.24, 0.22, depth + 0.24, 0, y, 0, 0.02);
    buildWindowRow(build, building, prop, width, depth, y - 1.55);
  }
  box(building, materials.concrete, width + 0.5, 0.55, depth + 0.5, 0, height + 0.27, 0, 0.05); // parapet
  // Ground-level grime: a building gets dirty where it meets the street and where rain
  // runs off it, and nowhere else. Dirt placed by rule rather than tiled over the whole
  // wall is the difference between a material with a history and a noise map (item 13).
  // ...at the *base*, hugging the plinth. The first version of this band was a belt around
  // the middle of every wall at 0.62 m, half a metre wider than the building on each side:
  // a dark ring floating clear of the facade, which is a bug wearing a dirt pass's clothes.
  // Sized from the *plinth* it sits on, not from the shell: the plinth is `+0.4` on each side, so
  // a band at `+0.06` is buried inside the plinth and invisible, and one at `+0.52` (the first
  // version of this) floats a quarter of a metre clear of the facade. `+0.42` is a centimetre
  // proud of the face it belongs to, which is where dirt sits.
  box(building, materials.grime, width + 0.42, 0.34, depth + 0.42, 0, 0.17, 0, 0.01);
  // A drainpipe down one corner: the cheapest thing that stops a facade reading as a
  // texture and starts it reading as a building (items 7 and 8).
  const pipe = add(
    building,
    new THREE.Mesh(chamferedCylinder(0.07, 0.07, height, 8), materials.metal),
    true,
    false,
  );
  // Touching the wall, not floating beside it: a pipe's radius is its distance from the face.
  pipe.position.set(width / 2 - 0.28, height / 2, depth / 2 + 0.07);
  // Parapet lip: an overhanging cap so the roofline casts a line down the facade.
  box(building, materials.concreteClean, width + 0.72, 0.16, depth + 0.72, 0, height + 0.6, 0, 0.04);

  // Rooftop clutter is what makes a silhouette read as a city block.
  const tank = new THREE.Group();
  tank.position.set(rng.range(-width / 4, width / 4), height + 1.9, rng.range(-depth / 4, depth / 4));
  add(tank, new THREE.Mesh(lathe([[0.75, 0], [0.8, 0.5], [0.72, 1.5], [0.6, 1.7]], 16), materials.metal), true, true);
  for (const leg of [-0.5, 0.5]) {
    const beam = add(tank, new THREE.Mesh(chamferedCylinder(0.05, 0.05, 1.05, 6), materials.metal), true, false);
    beam.position.set(leg, -0.5, leg * 0.6);
  }
  building.add(tank);

  const ac = box(building, materials.metal, rng.range(1.1, 1.7), 0.95, rng.range(1.1, 1.7), rng.range(-width / 4, width / 4), height + 1.1, rng.range(-depth / 4, depth / 4), 0.03);
  // Fan grille on top of the unit: a box alone reads as a crate on a roof.
  const fan = add(building, new THREE.Mesh(chamferedCylinder(0.35, 0.35, 0.06, 12), materials.dark), true, false);
  fan.position.copy(ac.position).add(new THREE.Vector3(0, 0.5, 0));

  const mast = add(building, new THREE.Mesh(chamferedCylinder(0.04, 0.06, 3.2, 6), materials.metal), true, false);
  mast.position.set(width / 2 - 0.6, height + 2.2, depth / 2 - 0.6);

  if (prop.tag === 'damaged') {
    // A collapsed corner: rubble on the ground and a hole in the parapet.
    for (let i = 0; i < 7; i++) {
      const chunk = add(
        building,
        new THREE.Mesh(rubbleChunk(0x51ed + i * 13, rng.range(0.35, 0.8)), materials.concrete),
        true,
        true,
      );
      chunk.position.set(
        rng.range(-width / 2, width / 2),
        rng.range(0.15, 1.2),
        rng.range(-depth / 2, depth / 2) + depth / 2 + 0.6,
      );
      chunk.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    }
  }
  buildFacadeDetail(build, building, prop, width, height, depth);
  place(build, building);
}

function buildCrate(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  const size = prop.size ?? 1.2;
  const crate = new THREE.Group();
  crate.position.set(prop.x, size / 2, prop.z);
  crate.rotation.y = prop.ry ?? 0;
  const crateTile = uvUnitMetres(materials.crate, UV_DENSITY.crate);
  density(box(crate, materials.crate, size, size, size, 0, 0, 0, 0.02), size, size, crateTile);
  // Steel banding on every edge: cheap, and it reads instantly as a real crate.
  const band = 0.055 * size;
  for (const y of [-size / 2 + band, size / 2 - band]) {
    box(crate, materials.metal, size * 1.01, band, size * 1.01, 0, y, 0, 0.01);
  }
  for (const x of [-size / 2 + band, size / 2 - band]) {
    box(crate, materials.metal, band, size * 1.01, size * 1.01, x, 0, 0, 0.01);
  }
  for (const z of [-size / 2 + band, size / 2 - band]) {
    box(crate, materials.metal, size * 1.005, size * 1.005, band, 0, 0, z, 0.01);
  }
  // Stencilled placard + a lifting lug.
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.5, size * 0.22), materials.crate);
  density(plate, size * 0.5, size * 0.22, crateTile);
  plate.position.set(0, 0.05, size / 2 + 0.012);
  crate.add(plate);
  const lug = add(crate, new THREE.Mesh(chamferedCylinder(0.03, 0.03, size * 0.5, 6), materials.metal), true, false);
  lug.rotation.z = Math.PI / 2;
  lug.position.y = size / 2 + 0.03;
  void rng;
  place(build, crate);
}

/** A fuel drum: lathed body with rolling hoops, a top rim and a bung. */
function buildBarrel(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  const material = materials.barrels[(prop.variant ?? 0) % materials.barrels.length]!;
  const barrel = new THREE.Group();
  barrel.position.set(prop.x, 0.575, prop.z);
  barrel.rotation.y = prop.ry ?? rng.range(0, 3);

  const profile: [number, number][] = [
    [0.0, -0.575],
    [0.36, -0.575],
    [0.4, -0.55],
    [0.4, -0.38],
    [0.42, -0.3],
    [0.42, -0.14],
    [0.4, -0.06],
    [0.4, 0.06],
    [0.42, 0.14],
    [0.42, 0.3],
    [0.4, 0.38],
    [0.4, 0.55],
    [0.36, 0.575],
    [0.0, 0.575],
  ];
  add(barrel, new THREE.Mesh(lathe(profile, 24), material), true, true);
  // Rolling hoops sit proud of the body — they catch the light and are the single
  // detail that makes a cylinder read as a 200 litre drum.
  for (const y of [-0.28, 0.28]) {
    const hoop = add(barrel, new THREE.Mesh(new THREE.TorusGeometry(0.415, 0.022, 6, 22), material), true, false);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
  }
  const rim = add(barrel, new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 22), materials.metal), true, false);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.575;
  const bung = add(barrel, new THREE.Mesh(chamferedCylinder(0.075, 0.075, 0.04, 8), materials.metal), true, false);
  bung.position.set(0.24, 0.585, 0);
  build.barrelMeshes.push(batchOne(barrel, `barrel_${prop.x}_${prop.z}`));
}

/**
 * Jersey barrier: the real trapezoidal cross-section, extruded along its length.
 *
 * Two of the review's items meet here. Item 4: *"concrete barriers, blocks aur kuch roadside
 * objects basic primitives ki tarah feel dete hain… unke corners ko slightly irregular karo,
 * bevels add karo aur important areas mein chipped/broken geometry do"* — so each barrier now
 * gets its own profile from the RNG (a centimetre of height, a degree of lean, a slightly
 * different waist) plus a chipped top corner where the cast lip has broken, because a row of
 * barriers that are *exactly* the same shape is the tell of a mould rather than of a street.
 * Item 2 is the two bevels the extrusion already carries: the real barrier's chamfered waist
 * and top lip are the highlight lines that read the object's shape at 30 m.
 */
function buildJersey(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  const length = prop.size ?? 2.4;
  const waist = 0.16 + rng.range(-0.015, 0.02);
  const height = 0.95 + rng.range(-0.03, 0.03);
  const barrier = extrudeProfile(
    [
      [-0.55, 0],
      [0.55, 0],
      [waist, 0.28 + rng.range(-0.02, 0.02)],
      [waist - 0.04, height],
      [-(waist - 0.04), height],
      [-waist, 0.28],
    ],
    length,
    materials.concrete,
  );
  barrier.rotation.y = (prop.ry ?? 0) + Math.PI / 2;
  barrier.rotation.z = rng.range(-0.012, 0.012);
  barrier.position.set(prop.x, 0.02, prop.z);
  barrier.castShadow = true;
  barrier.receiveShadow = true;
  place(build, barrier);
  // Cap along the top lip, which is chamfered on a real barrier.
  staticBox(build, materials.concreteClean, 0.3, 0.06, length + 0.02, prop.x, height + 0.01, prop.z, prop.ry ?? 0);
  // A spalled corner: the lip has broken off and the aggregate is showing. One barrier in
  // three, at one end, so a row of them has a broken line to follow.
  if (rng.next() < 0.34) {
    const sign = rng.next() < 0.5 ? -1 : 1;
    const chip = add(
      build.group,
      new THREE.Mesh(rubbleChunk(0x9e21 + Math.round(prop.x * 7 + prop.z * 3), rng.range(0.16, 0.24)), materials.concrete),
      true,
      true,
    );
    const along = (prop.ry ?? 0) + Math.PI / 2;
    chip.position.set(
      prop.x + Math.cos(along) * (length / 2) * sign + Math.sin(along) * 0.06,
      height - 0.04,
      prop.z - Math.sin(along) * (length / 2) * sign + Math.cos(along) * 0.06,
    );
    chip.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
  }
}

function buildPlanter(build: Build, prop: PropDef): void {
  const { materials } = build;
  const planter = new THREE.Group();
  planter.position.set(prop.x, 0, prop.z);
  planter.rotation.y = prop.ry ?? 0;
  box(planter, materials.stone, 1.9, 0.9, 1.9, 0, 0.45, 0, 0.03);
  box(planter, materials.stone, 2.05, 0.14, 2.05, 0, 0.92, 0, 0.03); // coping
  box(planter, materials.burnt, 1.6, 0.12, 1.6, 0, 0.96, 0, 0.02); // soil
  box(planter, materials.stone, 0.32, 0.5, 0.32, 0, 0.7, 1.12, 0.02);
  // Shrub: three overlapping low-poly blobs read as foliage far better than a
  // smooth sphere, because the silhouette is irregular.
  for (const [x, y, z, r] of [
    [0, 1.45, 0, 0.8],
    [-0.42, 1.2, 0.28, 0.55],
    [0.38, 1.3, -0.24, 0.6],
  ] as const) {
    const bush = add(planter, new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), materials.bush), true, true);
    bush.position.set(x, y, z);
    bush.rotation.set(x * 3, y, z * 5);
  }
  place(build, planter);
}

function buildKiosk(build: Build, prop: PropDef): void {
  const { materials } = build;
  const kiosk = new THREE.Group();
  kiosk.position.set(prop.x, 0, prop.z);
  kiosk.rotation.y = prop.ry ?? 0;

  box(kiosk, materials.plaster, 2.4, 2.8, 2, 0, 1.4, 0, 0.04);
  box(kiosk, materials.concreteClean, 2.6, 0.18, 2.2, 0, 2.85, 0, 0.03);
  // Shuttered serving counter with a sill — the reason it reads as a shop.
  box(kiosk, materials.dark, 1.5, 0.85, 0.16, 0, 1.55, 1.0, 0.02);
  box(kiosk, materials.concreteClean, 1.8, 0.1, 0.4, 0, 1.1, 1.14, 0.02);
  for (let i = 0; i < 8; i++) {
    const slat = box(kiosk, materials.metal, 1.44, 0.055, 0.05, 0, 1.25 + i * 0.1, 1.1, 0.01);
    slat.castShadow = false;
  }
  const awning = box(kiosk, materials.banner, 2.9, 0.12, 1.5, 0, 2.55, 1.2, 0.02);
  awning.rotation.x = 0.28;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), materials.kioskSign);
  sign.position.set(0, 2.25, 1.02);
  kiosk.add(sign);
  for (const x of [-1.05, 1.05]) {
    const post = add(kiosk, new THREE.Mesh(chamferedCylinder(0.05, 0.06, 2.5, 8), materials.metal), true, false);
    post.position.set(x, 1.25, 1.35);
  }
  place(build, kiosk);
}

function buildSandbags(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  const stack = new THREE.Group();
  stack.position.set(prop.x, 0, prop.z);
  stack.rotation.y = prop.ry ?? 0;
  // Bags as squashed rounded boxes with per-bag yaw: a real wall is not a grid.
  for (let row = 0; row < 3; row++) {
    const count = row === 0 ? 5 : row === 1 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 1.02;
      const bag = add(
        stack,
        density(
          new THREE.Mesh(roundedBox(1.1, 0.32, 0.62, 0.11, 3), materials.sandbag),
          1.1,
          0.32,
          uvUnitMetres(materials.sandbag, UV_DENSITY.sandbag),
        ),
        true,
        true,
      );
      bag.position.set(x, 0.17 + row * 0.3, rng.range(-0.05, 0.05) + (row % 2) * 0.06);
      bag.rotation.y = rng.range(-0.09, 0.09);
      bag.rotation.z = rng.range(-0.04, 0.04);
      bag.scale.setScalar(rng.range(0.94, 1.06));
    }
  }
  // Sand does not stop at the bags (item 11): a stack is where the ground has been disturbed,
  // so it carries a drift on its windward side and a scuffed hollow in front of it. Two low
  // lathes — 1.6 cm and 2.4 cm proud — are enough for the *ground* to look like ground rather
  // than like a plane with props on it, which is the whole of what the review asked for.
  for (const [dx, dz, size] of [
    [-0.6, 0.9, 1.3],
    [1.1, 0.7, 0.9],
    [0.1, -0.8, 1.1],
  ] as const) {
    const mound = add(
      stack,
      new THREE.Mesh(
        lathe(
          [
            [0, 0],
            [size * 0.35, 0.012],
            [size * 0.7, 0.022],
            [size, 0.004],
            [size * 1.02, -0.02],
          ],
          18,
        ),
        materials.sand,
      ),
      false,
      true,
    );
    mound.position.set(dx, 0.002, dz);
    mound.scale.set(1, 1, rng.range(0.7, 1));
  }
  place(build, stack);
}

/**
 * A car's panels and hardware: what separates a *vehicle* from a silhouette (ADR-0021).
 *
 * One depth each of the things every car has — door shut lines, a handle, a mirror on a
 * stalk, a lip rolled over each wheel arch, lamps in real housings, a grille of slats, tail
 * lamps — because that is the list the review was pointing at ("proper panel separation, door
 * seams, handles, mirrors, light housings, grille, bumper details"), and because each of them
 * catches the sun at a different angle from the panel beside it. A single extruded profile,
 * however correct, cannot do that.
 */
function buildCarHardware(
  wreck: THREE.Group,
  materials: Materials,
  trim: THREE.Material,
  length: number,
  bodyHalf: number,
  bevel: number,
): void {
  const beltline = 0.86;
  for (const side of [-1, 1]) {
    const z = side * (bodyHalf + 0.004);
    // Shut lines: 8 mm of shadow at the door's leading and trailing edges.
    for (const seamX of [-length * 0.16, length * 0.14]) {
      box(wreck, materials.dark, 0.012, 0.44, 0.012, seamX, beltline - 0.16, z, 0.002);
    }
    box(wreck, trim, 0.16, 0.035, 0.03, length * 0.06, beltline - 0.06, z + side * 0.012, 0.008);
    // Mirror: a stalk off the A-pillar and a plate on the end of it. A car without mirrors
    // is the single most recognisable "this is a box" tell from ten metres.
    const mirror = add(
      wreck,
      new THREE.Mesh(chamferedCylinder(0.016, 0.016, 0.16, 6), trim),
      true,
      false,
    );
    mirror.position.set(length * 0.17, 1.28, side * (bodyHalf + 0.06));
    mirror.rotation.x = Math.PI / 2;
    box(wreck, trim, 0.1, 0.13, 0.03, length * 0.17, 1.28, side * (bodyHalf + 0.14), 0.012);
    // Arch lip: the rolled edge over the wheel, which is where a car's body stops being one
    // continuous surface and starts being panels.
    for (const wheelX of [-length * 0.3, length * 0.3]) {
      const lip = add(
        wreck,
        new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.028, 6, 16, Math.PI), trim),
        true,
        false,
      );
      lip.position.set(wheelX, 0.5, side * (bodyHalf + 0.01));
    }
  }
  // Lamps in housings, and a grille of slats rather than a painted rectangle.
  for (const side of [-1, 1]) {
    const housingX = length / 2 - 0.22;
    box(wreck, materials.dark, 0.16, 0.2, 0.34, housingX, 0.72, side * (bodyHalf * 0.62), bevel);
    box(wreck, materials.glass, 0.06, 0.15, 0.28, housingX + 0.06, 0.72, side * (bodyHalf * 0.62), bevel);
    const tail = add(
      wreck,
      new THREE.Mesh(roundedBox(0.06, 0.16, 0.3, bevel), materials.rust),
      true,
      false,
    );
    tail.position.set(-length / 2 + 0.06, 0.86, side * (bodyHalf * 0.6));
  }
  for (let i = 0; i < 4; i++) {
    box(wreck, materials.dark, 0.05, 0.16, 0.03, length / 2 - 0.16, 0.66, -0.18 + i * 0.12, 0.006);
  }
}

/** A car hull: extruded side profile, cabin, arches, and wheels that sit in them. */
function buildWreck(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  const wreck = new THREE.Group();
  wreck.position.set(prop.x, 0, prop.z);
  wreck.rotation.y = prop.ry ?? 0;
  wreck.rotation.z = rng.range(-0.04, 0.04);
  // A car is a *painted* object, and this is the review's loudest material finding: the
  // hull was `materials.dark` (a grey polymer at roughness 0.85) and the greenhouse was
  // `materials.glass`, so a parked sedan and a burnt-out one were the same grey box with
  // one noisy map on it. Body and trim now name the substrate: painted panel, dead panel,
  // chrome-or-rust. Whether it burned is a *state*, not a colour (ADR-0020).
  const body = prop.burning ? materials.burntPaint : materials.carPaint;
  const trim = prop.burning ? materials.rust : materials.steelPainted;

  // Side profile (x = length, y = height) with a sloped bonnet and roof.
  const length = (prop.size ?? 4.2) + 0.6;
  const profile: [number, number][] = [
    [-length / 2, 0.42],
    [-length / 2 + 0.25, 0.78],
    [-length * 0.22, 0.92],
    [-length * 0.16, 1.45],
    [length * 0.1, 1.5],
    [length * 0.2, 0.95],
    [length / 2 - 0.2, 0.86],
    [length / 2, 0.62],
    [length / 2, 0.34],
    [-length / 2, 0.34],
  ];
  // Extruded along its width, so the side profile above *is* the car's silhouette.
  const hull = extrudeProfile(profile, (prop.size ?? 4.2) * 0.44, body, 0.05);
  add(wreck, hull, true, true);

  // ---- panels and hardware ---------------------------------------------------
  //
  // The review's item 5 — "car ki geometry expected detail level se neeche hai… proper panel
  // separation, door seams, handles, mirrors, light housings, grille, bumper details" — is
  // about the difference between a *silhouette* and a *vehicle*. The silhouette is the
  // extruded profile above and it is right; what a car has on it is one depth each of: door
  // shut lines, handles, a mirror on a stalk, lamps in housings, a grille, and a lip on every
  // wheel arch. Each is a few centimetres of real geometry, and each one catches the sun
  // differently from the panel beside it, which is what the eye reads as a car rather than as
  // a shape carved from a single billet.
  // The hardware is exactly what the *hero* tier buys (level/detail.ts): a wreck at the far
  // end of the plaza keeps its silhouette and loses its handles, because the player who can
  // see them is the player who is standing at it.
  if (DETAIL.hero.secondary) {
    // The hull's *own* half-width, not one derived from its length: the hardware has to sit on
    // the body it belongs to, and `length` is the profile's length, which is a different
    // number (this was 0.53 m where the body is 0.92 m half-wide, i.e. door handles inside
    // the car).
    const bodyHalf = (prop.size ?? 4.2) * 0.22;
    buildCarHardware(wreck, materials, trim, length, bodyHalf, DETAIL.hero.bevel);
  }

  // Greenhouse: glazing over a cabin, not a solid tinted block.
  //
  // The old version was one `roundedBox` of `materials.glass` with the body's own material
  // around it, so the glass had *nothing behind it*: transparent geometry over no interior
  // is the flat cyan panel the review measured, and it read as paint because there was no
  // depth cue to contradict it. A car's visibility comes from what is inside it — seats
  // under a screen, a dashboard, a steering wheel — so the cabin is geometry now and the
  // glazing is a thin pane over it with the pillars still proud of the panes.
  const cabin = new THREE.Group();
  cabin.position.y = 1.46;
  wreck.add(cabin);
  const halfWidth = (prop.size ?? 4.2) * 0.2;
  // Seats: two full and one rear bench, at the height a seated body puts them.
  for (const [seatX, seatZ] of [
    [-length * 0.05, -halfWidth * 0.55],
    [-length * 0.05, halfWidth * 0.55],
  ] as const) {
    box(cabin, materials.fabric, 0.5, 0.12, 0.46, seatX, -0.14, seatZ, 0.03);
    box(cabin, materials.fabric, 0.12, 0.44, 0.46, seatX + 0.2, -0.36, seatZ, 0.03);
  }
  // Dashboard and wheel: the two shapes that say "car interior" from outside.
  box(cabin, materials.dark, 0.34, 0.22, (prop.size ?? 4.2) * 0.36, length * 0.16, -0.12, 0, 0.03);
  const wheel = add(cabin, new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), materials.dark), false, false);
  wheel.position.set(length * 0.1, -0.2, -halfWidth * 0.55);
  wheel.rotation.set(0, 0, 1.15);
  // Panes: front, rear and two sides, thin and inset, with the pillars left uncovered so
  // the body colour still frames the cabin.
  const paneDepth = (prop.size ?? 4.2) * 0.38;
  const front = add(cabin, new THREE.Mesh(roundedBox(0.03, 0.34, paneDepth, 0.02), materials.carGlass), false, false);
  front.position.set(length * 0.2, 0.02, 0);
  front.rotation.z = -0.42;
  const rear = add(cabin, new THREE.Mesh(roundedBox(0.03, 0.32, paneDepth, 0.02), materials.carGlass), false, false);
  rear.position.set(-length * 0.19, 0.02, 0);
  rear.rotation.z = 0.3;
  for (const side of [-1, 1]) {
    const pane = add(
      wreck,
      new THREE.Mesh(roundedBox(length * 0.36, 0.3, 0.02, 0.02), materials.carGlass),
      false,
      false,
    );
    pane.position.set(-length * 0.02, 1.5, side * ((prop.size ?? 4.2) * 0.19));
  }

  for (const [x, z] of [
    [-length * 0.3, 1],
    [length * 0.3, 1],
    [-length * 0.3, -1],
    [length * 0.3, -1],
  ] as const) {
    const wheelX = x;
    const wheelZ = z * (prop.size ?? 4.2) * 0.22;
    // Arch over the wheel (half torus in the x-y plane) hides the tyre/hull seam.
    const arch = add(wreck, new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 6, 14, Math.PI), body), false, false);
    arch.position.set(wheelX, 0.5, wheelZ);
    if (rng.next() < 0.25) continue; // some wheels are long gone
    // A tyre is three surfaces, not one: tread blocks (rough, and the only part that
    // touches the road), a moulded sidewall (smoother, dusted by the air), and a rim. The
    // torus alone was `materials.tire` all over — the review's "tyres read as textured dark
    // objects" — and the sidewall is the half of a wheel the player actually sees.
    const tire = add(wreck, new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.14, 8, 18), materials.tire), true, false);
    tire.position.set(wheelX, 0.36, wheelZ);
    for (const side of [-1, 1]) {
      const wall = add(
        wreck,
        new THREE.Mesh(chamferedCylinder(0.3, 0.3, 0.03, 20), materials.tireSidewall),
        true,
        false,
      );
      wall.rotation.x = Math.PI / 2;
      wall.position.set(wheelX, 0.36, wheelZ + side * 0.085);
    }
    const rim = add(wreck, new THREE.Mesh(chamferedCylinder(0.17, 0.17, 0.1, 12), trim), true, false);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(wheelX, 0.36, wheelZ);
    // Road grime thrown up inside the arch: dirt belongs where the wheel puts it, not
    // spread evenly over the body (the review's item 13).
    const splash = add(
      wreck,
      new THREE.Mesh(chamferedCylinder(0.22, 0.24, 0.02, 12), materials.grime),
      false,
      false,
    );
    splash.rotation.x = Math.PI / 2;
    splash.position.set(wheelX, 0.42, wheelZ + 0.1);
  }
  const bumper = box(wreck, trim, 0.14, 0.18, (prop.size ?? 4.2) * 0.46, length / 2, 0.42, 0, 0.02);
  bumper.castShadow = true;
  // Dirt builds up low and *stays* low: a band along the rocker panels, where spray lands
  // and where nobody washes, and a contact patch on the ground under the hull, which is
  // the oil-and-dust shadow every parked car leaves. Both are the same material in two
  // places, which is what makes them read as one substance rather than two effects.  // ...and both have to *hug* the car they belong to. The first version of this band was
  // `size * 0.9` wide on a hull whose full width is `size * 0.44` — a dark slab 2× the car's
  // width, i.e. wings, and the contact patch was 0.86 of the length by the same mistake. The
  // hull's own width is the number; a panel's grime stands a centimetre proud of it.
  const hullWidth = (prop.size ?? 4.2) * 0.44;
  box(wreck, materials.grime, length * 0.9, 0.11, hullWidth + 0.02, 0, 0.4, 0, 0.01);
  const contact = new THREE.Mesh(
    uvMetres(
      new THREE.PlaneGeometry(length * 0.94, hullWidth * 1.2),
      length * 0.94,
      hullWidth * 1.2,
      uvUnitMetres(materials.scorch, 1.2),
    ),
    materials.scorch,
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.016;
  contact.renderOrder = 1;
  add(wreck, contact, false, false);
  place(build, wreck);
}

function buildLamp(build: Build, prop: PropDef): void {
  const { materials, textures } = build;
  const lamp = new THREE.Group();
  lamp.position.set(prop.x, 0, prop.z);
  lamp.rotation.y = prop.ry ?? 0;
  add(lamp, new THREE.Mesh(chamferedCylinder(0.16, 0.2, 0.24, 12), materials.metal), true, false).position.y = 0.12;
  add(lamp, new THREE.Mesh(lathe([[0.09, 0.2], [0.11, 0.6], [0.075, 3.4], [0.075, 5.3], [0.11, 5.45], [0.05, 5.6]], 14), materials.metal), true, false);
  // Diagonal brace under the head — the silhouette of every street lamp.
  const brace = add(lamp, new THREE.Mesh(chamferedCylinder(0.045, 0.045, 0.9, 8), materials.metal), true, false);
  brace.position.set(0.32, 5.3, 0);
  brace.rotation.z = -Math.PI / 3.4;
  const head = box(lamp, materials.metal, 0.62, 0.16, 0.34, 0.6, 5.5, 0, 0.03);
  head.rotation.z = -0.12;
  const lens = box(lamp, materials.lampBulb, 0.5, 0.05, 0.26, 0.6, 5.4, 0, 0.01);
  lens.castShadow = false;
  const housing = box(lamp, materials.dark, 0.7, 0.22, 0.4, 0.6, 5.62, 0, 0.04);
  housing.castShadow = true;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textures.soft,
      color: 0xffc46b,
      transparent: true,
      opacity: LAMP_GLOW_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(2.8);
  glow.position.set(prop.x + Math.cos(prop.ry ?? 0) * 0.6, 5.4, prop.z - Math.sin(prop.ry ?? 0) * 0.6);
  build.group.add(glow);
  // Registered so the atmosphere can switch the halo off: a street lamp with a glow
  // sprite at 6 a.m. is a lamp that is on, whatever its light is doing.
  build.lampGlows.push(glow.material as THREE.SpriteMaterial);
  place(build, lamp);
}

function buildPole(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  const pole = new THREE.Group();
  pole.position.set(prop.x, 0, prop.z);
  add(pole, new THREE.Mesh(chamferedCylinder(0.13, 0.17, 0.3, 10), materials.dark), true, false).position.y = 0.15;
  add(pole, new THREE.Mesh(lathe([[0.08, 0.2], [0.1, 0.9], [0.06, 6.8], [0.08, 7]], 12), materials.dark), true, false);
  const arm = box(pole, materials.dark, 0.12, 0.12, 2.2, 0, 6.75, 0, 0.02);
  arm.castShadow = false;
  for (const z of [-0.85, 0.85]) {
    const insulator = add(pole, new THREE.Mesh(chamferedCylinder(0.07, 0.09, 0.22, 8), materials.polymer), false, false);
    insulator.position.set(0, 6.92, z);
  }
  void rng;
  place(build, pole);
}

function buildTireStack(build: Build, prop: PropDef): void {
  const { materials, rng } = build;
  for (let k = 0; k < 3; k++) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.15, 8, 20), materials.tire);
    tyre.castShadow = true;
    tyre.receiveShadow = true;
    place(build, tyre);
    tyre.rotation.x = Math.PI / 2;
    tyre.rotation.z = rng.range(0, 3);
    tyre.position.set(prop.x + rng.range(-0.12, 0.12), 0.17 + k * 0.3, prop.z + rng.range(-0.12, 0.12));
  }
}

function buildMonument(build: Build, prop: PropDef): void {
  const { materials } = build;
  const monument = new THREE.Group();
  monument.position.set(prop.x, 0, prop.z);
  // Fountain basin with a moulded rim, then three steps, then the obelisk.
  add(monument, new THREE.Mesh(lathe([[0, 0], [4, 0], [4, 0.35], [3.5, 0.5], [3.5, 0.85], [4, 1], [4, 1.05]], 28), materials.stone), true, true);
  add(monument, new THREE.Mesh(chamferedCylinder(3.2, 3.2, 0.12, 28), materials.puddle), false, true).position.y = 0.2;
  for (const [size, y] of [
    [2.6, 1.1],
    [2.2, 1.45],
    [1.8, 1.8],
  ] as const) {
    box(monument, materials.concreteClean, size, 0.36, size, 0, y, 0, 0.02);
  }
  const shaft = add(monument, new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 5.6, 4), materials.stone), true, true);
  shaft.rotation.y = Math.PI / 4;
  shaft.position.y = 4.75;
  // Inscribed plaques on two faces.
  for (const ry of [0, Math.PI / 2]) {
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 3.4), materials.rust);
    plaque.position.set(Math.sin(ry) * 0.52, 4.6, Math.cos(ry) * 0.52);
    plaque.rotation.y = ry;
    monument.add(plaque);
  }
  const cap = add(
    monument,
    new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.1, 4), materials.brass),
    true,
    false,
  );
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 8.05;
  for (const [x, z] of [
    [-1.5, -1.5],
    [1.5, -1.5],
    [-1.5, 1.5],
    [1.5, 1.5],
  ] as const) {
    const post = box(monument, materials.stone, 0.24, 1.3, 0.24, x, 2.45, z, 0.02);
    post.castShadow = true;
  }
  // ---- the landmark's own groundstore (item 12) -----------------------------
  //
  // "Monument/landmark ka base simple feel ho raha hai… usay world ka deliberate landmark feel
  // hona chahiye." A landmark is not the object in the middle: it is the *setting* the object
  // was designed to stand in. So the basin gets a paved apron, a ring of bollards around the
  // approach and two benches facing it — the same trick as the facade detail, applied to the
  // one prop the whole plaza is laid out around. Deterministic, and cheap: eleven small forms.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const radius = 5.6 + (i % 3 === 0 ? 0.12 : 0);
    const slab = box(
      monument,
      materials.concreteClean,
      1.5,
      0.08,
      1.4,
      Math.sin(angle) * radius,
      0.04,
      Math.cos(angle) * radius,
      0.02,
    );
    slab.rotation.y = angle;
    slab.receiveShadow = true;
  }
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const radius = 6.8;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const bollard = add(
      monument,
      new THREE.Mesh(chamferedCylinder(0.09, 0.11, 0.78, 10), materials.metal),
      true,
      false,
    );
    bollard.position.set(x, 0.39, z);
    const band = add(
      monument,
      new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 12), materials.dark),
      false,
      false,
    );
    band.rotation.x = Math.PI / 2;
    band.position.set(x, 0.62, z);
  }
  for (const side of [-1, 1]) {
    const bench = new THREE.Group();
    bench.position.set(side * 7.6, 0, 0);
    bench.rotation.y = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      box(bench, materials.crate, 1.7, 0.06, 0.14, 0, 0.44, -0.16 + i * 0.16, 0.01);
    }
    for (const leg of [-0.7, 0.7]) {
      box(bench, materials.metal, 0.09, 0.42, 0.42, leg, 0.21, 0, 0.01);
    }
    place(build, bench);
  }
  place(build, monument);
}

function buildFirepit(build: Build, prop: PropDef): void {
  const { materials } = build;
  const pit = new THREE.Group();
  pit.position.set(prop.x, 0, prop.z);
  add(pit, new THREE.Mesh(lathe([[0.18, 0], [0.62, 0.1], [0.66, 0.5], [0.5, 0.62]], 16), materials.burnt), true, true).position.y = 0.3;
  for (let i = 0; i < 3; i++) {
    const leg = add(pit, new THREE.Mesh(chamferedCylinder(0.035, 0.035, 0.34, 6), materials.metal), true, false);
    leg.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.42, 0.17, Math.sin((i / 3) * Math.PI * 2) * 0.42);
  }
  // Coals: small emissive chunks, so the fire has a source instead of a glow.
  const coalMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a1a0c,
    emissive: 0xff5a14,
    emissiveIntensity: 1.4,
    roughness: 0.9,
  });
  for (let i = 0; i < 9; i++) {
    const coal = add(pit, new THREE.Mesh(rubbleChunk(0x77ab + i * 5, 0.11), coalMaterial), false, false);
    coal.position.set(Math.cos(i * 2.1) * 0.24, 0.42, Math.sin(i * 2.1) * 0.24);
  }
  place(build, pit);
}

// ---------------------------------------------------------------------------
// Arena assembly
// ---------------------------------------------------------------------------

export function buildArena(
  map: MapDef,
  materials: Materials,
  textures: TextureLibrary,
  quality: QualitySettings,
  seed: number,
  models: ModelLibrary = emptyModelLibrary(),
): ArenaRuntime {
  const group = new THREE.Group();
  group.name = 'arena';
  const build: Build = {
    group,
    batcher: new StaticBatcher('arena_static'),
    materials,
    textures,
    rng: createRng(seed ^ 0x5f3759df),
    quality,
    models,
    barrelMeshes: [],
    bannerAnchors: [],
    windowAnchors: [],
    lampGlows: [],
  };
  // Drifting dust is one point cloud, not one sprite per mote: 28 sprites is 28
  // draw calls for something the player is barely aware of.
  const dustVelocities: THREE.Vector3[] = [];
  let dust: THREE.Points | null = null;
  const cablePoints: THREE.Vector3[] = [];

  // ---- ground, roads, markings ---------------------------------------------
  // A single 400 m plane reads as a plastic sheet; the plaza floor is split into
  // the road corridor and the surrounding dirt so the two meet at a real edge.
  //
  // The floor is also the surface whose texel density the review measured: this plane
  // used to be `PlaneGeometry(400, 400)` with the surface's own repeat, i.e. one tile
  // per 50 m — 97 mm per texel, a beige wash across 60% of every frame, while a crate
  // three metres away was tiled at 3,400 px/m. The UVs are in metres now and the
  // density is stated once, in `UV_DENSITY` (ADR-0014).
  const groundMaterial = groundMaterialFor(map.groundSurface, materials);
  const ground = new THREE.Mesh(
    uvMetres(
      new THREE.PlaneGeometry(400, 400, 8, 8),
      400,
      400,
      uvUnitMetres(groundMaterial, UV_DENSITY.plazaFloor),
    ),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  place(build, ground);

  // The two road arms, as data: both the road surface and everything that *wears* the
  // road are laid out from this list, so they cannot drift apart.
  const ROADS: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
  ];
  for (const [rotation, x, z] of ROADS) {
    const rng = build.rng;
    const road = new THREE.Mesh(
      uvMetres(
        new THREE.PlaneGeometry(8, 124),
        8,
        124,
        uvUnitMetres(materials.road, UV_DENSITY.road),
      ),
      materials.road,
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = rotation;
    road.position.set(x, 0.015, z);
    road.receiveShadow = true;
    place(build, road);
    // Kerbs: 15 cm of real edge where the asphalt meets the paving.
    //
    // Built as ten segments per side rather than one 124 m extrusion, because a kerb is the
    // longest man-made *line* in the game and a perfectly straight, perfectly unbroken one is
    // the review's item 3 ("road ek generic textured plane jaisi lagti hai… broken edges,
    // drainage areas, repaired sections") and item 10 ("perfectly aligned and repetitive") read
    // off one number: nothing in a street is cast in a 124 m piece. Each segment gets a
    // centimetre of line variation, and some are chipped or missing. The metres-based UVs are
    // per segment now, so the density is unchanged.
    for (const side of [-1, 1]) {
      const kerbLength = 124;
      const kerbWidth = 0.3;
      const segment = kerbLength / 10;
      for (let i = 0; i < 10; i++) {
        const along = -kerbLength / 2 + segment * (i + 0.5);
        const across = side * (4.15 + rng.range(-0.03, 0.03));
        const drop = rng.range(0, 0.02);
        const [kx, kz] = rotation === 0 ? [across, along] : [along, across];
        // One segment in six is broken: the kerb stone is gone and its foot is showing.
        const broken = rng.next() < 0.17;
        const kerb = box(
          group,
          materials.concreteClean,
          rotation === 0 ? kerbWidth : segment * 0.96,
          broken ? 0.05 : 0.16 - drop,
          rotation === 0 ? segment * 0.96 : kerbWidth,
          kx,
          broken ? 0.02 : 0.08 - drop / 2,
          kz,
          0.02,
        );
        uvMetres(kerb.geometry, segment, 0.16, uvUnitMetres(materials.concreteClean, UV_DENSITY.sidewalk));
        kerb.receiveShadow = true;
        place(build, kerb);
        // A drain along the gutter line: the low, dirty strip at the road's own edge, which
        // is where a real road carries its water and therefore its grime.
        const gutter = box(
          group,
          materials.grime,
          rotation === 0 ? 0.26 : segment, 0.012,
          rotation === 0 ? segment : 0.26,
          rotation === 0 ? side * 3.86 : kx,
          0.021,
          rotation === 0 ? kz : side * 3.86,
          0.006,
        );
        gutter.receiveShadow = true;
        place(build, gutter);
        if (broken) {
          const chip = add(
            build.group,
            new THREE.Mesh(rubbleChunk(0x51b0 + i * 7 + Math.round(side * 11), rng.range(0.17, 0.3)), materials.concrete),
            true,
            true,
          );
          chip.position.set(kx + rng.range(-0.2, 0.2), 0.12, kz + rng.range(-0.2, 0.2));
          chip.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
        }
      }
    }
  }
  // ---- road wear -----------------------------------------------------------
  //
  // A 8 x 124 m asphalt plane with one tiled map is the single most "prototype" thing in
  // the frame: the same nine metres of texture, fifty times, at the same angle, with the
  // same grain (the seventh review's items 5 and 16). Real asphalt is not uniform, it is
  // a surface with a *history* — traffic polished two lanes into it, water carried sand to
  // its edges, someone patched it, and something burned on it. None of that needs a new
  // texture: it needs the two materials that differ from the road placed where the history
  // would put them, with the macro variation in the maps doing the rest (ADR-0020).
  for (const [rotation] of ROADS) {
    const rng = build.rng;
    // Road-local `along`/`across` to world x/z, so one description covers both arms.
    const at = (along: number, across: number): [number, number] =>
      rotation === 0 ? [across, along] : [along, across];
    // Flattening is *baked into the geometry* and the heading is the only rotation left on
    // the mesh, so that a yaw is a yaw. With Euler order XYZ, x = -90° plus y = φ plus
    // z = arm composes three rotations in a different order than the four intended, and the
    // quad comes out tilted out of the road plane — which is a floating patch of sand
    // hovering over the road rather than a drift lying on it.
    const flat = (mesh: THREE.Mesh, y: number, yaw = 0): void => {
      mesh.geometry.rotateX(-Math.PI / 2);
      mesh.rotation.y = rotation + yaw;
      mesh.receiveShadow = true;
      mesh.position.y = y;
      place(build, mesh);
    };
    // Wind-blown sand, banked against both kerbs in drifts of varying depth. The edges
    // are where a road meets the ground it is cut through, so this is also the *transition*
    // the review asked for: asphalt does not stop at a clean line, it thins into dust.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const along = -56 + i * 14 + rng.range(-3.2, 3.2);
        const across = side * (3.55 - rng.range(0, 0.35));
        const width = rng.range(0.45, 1.15);
        const length = rng.range(4.5, 9.5);
        const drift = new THREE.Mesh(
          uvMetres(new THREE.PlaneGeometry(width, length), width, length, uvUnitMetres(materials.sand, UV_DENSITY.sand)),
          materials.sand,
        );
        const [wx, wz] = at(along, across);
        drift.position.set(wx, 0, wz);
        flat(drift, 0.019, rng.range(-0.25, 0.25));
      }
    }
    // Repairs: three patches of newer, darker, smoother binder. They are the largest
    // tonal event on the road, which is exactly what breaks fifty identical tiles.
    for (let i = 0; i < 3; i++) {
      const length = rng.range(2.2, 4.4);
      const width = rng.range(1.5, 3.2);
      const patch = new THREE.Mesh(
        uvMetres(new THREE.PlaneGeometry(width, length), width, length, uvUnitMetres(materials.roadPatch, UV_DENSITY.road)),
        materials.roadPatch,
      );
      const [wx, wz] = at(rng.range(-48, 48), rng.range(-2.4, 2.4));
      patch.position.set(wx, 0, wz);
      flat(patch, 0.017, rng.range(-0.4, 0.4));
    }
    // Burn marks: a car fire and a blast, placed once per arm. The one thing that gives a
    // road a story rather than a pattern, and it costs two quads.
    for (let i = 0; i < 2; i++) {
      const size = rng.range(1.7, 3);
      const mark = new THREE.Mesh(
        uvMetres(new THREE.PlaneGeometry(size, size), size, size, uvUnitMetres(materials.scorch, UV_DENSITY.road)),
        materials.scorch,
      );
      const [wx, wz] = at(rng.range(-46, 46), rng.range(-3.1, 3.1));
      mark.position.set(wx, 0, wz);
      mark.renderOrder = 1;
      flat(mark, 0.021, rng.range(0, Math.PI * 2));
    }
  }

  for (let i = -7; i <= 7; i++) {
    if (Math.abs(i) < 1) continue;
    const dashA = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.2), materials.roadLine);
    dashA.rotation.x = -Math.PI / 2;
    dashA.position.set(0, 0.02, i * 8);
    place(build, dashA);
    const dashB = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.22), materials.roadLine);
    dashB.rotation.x = -Math.PI / 2;
    dashB.position.set(i * 8, 0.02, 0);
    place(build, dashB);
  }

  // ---- props ---------------------------------------------------------------
  for (const prop of map.props) {
    // A downloaded model can take over any prop kind by name (`prop.wreck`), one
    // kind at a time, with no change to this switch.
    const override = build.models.instantiate('prop', prop.kind);
    if (override) {
      override.position.set(prop.x, 0, prop.z);
      override.rotation.y = prop.ry ?? 0;
      if (prop.kind === 'barrel') {
        build.group.add(override);
        build.barrelMeshes.push(override as THREE.Group);
      } else if (prop.kind === 'banner') {
        build.group.add(override);
        build.bannerAnchors.push(override);
      } else {
        place(build, override);
      }
      continue;
    }
    switch (prop.kind) {
      case 'wall':
        buildWall(build, prop, prop.size ?? 2, prop.height ?? 5, prop.depth ?? 2);
        break;
      case 'building':
        buildBuilding(build, prop, prop.size ?? 12, prop.height ?? 12, prop.depth ?? 12);
        break;
      case 'crate':
        buildCrate(build, prop);
        break;
      case 'barrel':
        buildBarrel(build, prop);
        break;
      case 'jersey':
        buildJersey(build, prop);
        break;
      case 'planter':
        buildPlanter(build, prop);
        break;
      case 'kiosk':
        buildKiosk(build, prop);
        break;
      case 'sandbags':
        buildSandbags(build, prop);
        break;
      case 'wreck':
        buildWreck(build, prop);
        break;
      case 'lamp':
        buildLamp(build, prop);
        break;
      case 'pole':
        buildPole(build, prop);
        cablePoints.push(new THREE.Vector3(prop.x, 6.8, prop.z));
        break;
      case 'tire':
        buildTireStack(build, prop);
        break;
      case 'monument':
        buildMonument(build, prop);
        break;
      case 'firepit':
        buildFirepit(build, prop);
        break;
      case 'puddle': {
        // `prop.size` is the puddle's *diameter* now, and the shape is an irregular
        // polygon rather than a circle: standing water finds the low spots in paving,
        // it is not a 3-5 m black disc dropped on the ground (which is what the
        // review's frames showed). Same area budget, a shape the eye accepts.
        const radius = (prop.size ?? 2) * 0.5;
        const shape = new THREE.Shape();
        const points = 14;
        for (let i = 0; i < points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const r = radius * (0.62 + build.rng.range(0, 0.5));
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) shape.moveTo(px, py);
          else shape.lineTo(px, py);
        }
        const puddleGeometry = withAoUv(new THREE.ShapeGeometry(shape));
        // `ShapeGeometry` emits its UVs in shape units, so they arrive in metres and
        // centred on zero: normalise them to 0-1 before stating the tile size, or the
        // density comes out as a function of the puddle's radius.
        const uv = puddleGeometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) / (radius * 2) + 0.5, uv.getY(i) / (radius * 2) + 0.5);
        }
        const puddle = new THREE.Mesh(
          uvMetres(
            puddleGeometry,
            radius * 2,
            radius * 2,
            uvUnitMetres(materials.puddle, UV_DENSITY.water),
          ),
          materials.puddle,
        );
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(prop.x, 0.012, prop.z);
        puddle.receiveShadow = true;
        place(build, puddle);
        break;
      }
      case 'banner': {
        const geometry = new THREE.PlaneGeometry(0.7, 1.6, 1, 4);
        geometry.translate(0, -0.8, 0);
        const banner = new THREE.Mesh(
          uvMetres(geometry, 0.7, 1.6, uvUnitMetres(materials.banner, UV_DENSITY.banner)),
          materials.banner,
        );
        banner.position.set(prop.x, prop.height ?? 5.2, prop.z);
        banner.rotation.y = prop.ry ?? 0;
        banner.castShadow = true;
        // A bracket. A banner pinned to nothing at 5.2 m was the second "object
        // floating in the air" in the review, and the fix is what a real banner hangs
        // from: a crossbar over its top edge, two arms back to the wall it is mounted
        // on, and a bottom weight bar so the cloth reads as taut rather than papery.
        banner.add(buildBannerBracket(materials));
        group.add(banner);
        build.bannerAnchors.push(banner);
        break;
      }
      case 'skyline':
      case 'rock':
        break; // handled below from ambient settings
    }
  }

  // ---- cables between poles: real catenary tubes, not a single line ---------
  //
  // Routed by nearest neighbour rather than in map order. In map order the poles are
  // listed around the block, so consecutive entries can be on opposite sides of the
  // plaza: the review's frames contain a 17 m cable running diagonally *through* the
  // monument, which is exactly what connecting index i to index i+1 produces. The
  // routing is also what a lineman would do — span to the nearest pole that is not
  // across the square — and any span that would cross the monument is dropped.
  const monument = map.props.find((prop) => prop.kind === 'monument');
  const monumentAt = monument ? new THREE.Vector2(monument.x, monument.z) : null;
  const unvisited = cablePoints.slice();
  const chained: THREE.Vector3[] = [];
  let current = unvisited.shift();
  while (current) {
    chained.push(current);
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const candidate = unvisited[i]!;
      const distance = current.distanceTo(candidate);
      if (distance < bestDistance && !crossesMonument(current, candidate, monumentAt)) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    current = unvisited.splice(bestIndex, 1)[0];
  }
  for (let i = 0; i < chained.length - 1; i++) {
    const a = chained[i]!;
    const b = chained[i + 1]!;
    if (a.distanceTo(b) > 40) continue;
    const cable = new THREE.Mesh(cableBetween(a, b, 1.2, 0.035), materials.dark);
    cable.castShadow = true;
    place(build, cable);
  }

  // ---- rocks and distant skyline (procedural scatter) ----------------------
  const rng = build.rng;
  for (let i = 0; i < map.ambient.rockCount; i++) {
    const rock = add(
      group,
      new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 1), materials.rock),
      true,
      true,
    );
    rock.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    rock.scale.set(rng.range(0.5, 1.7), rng.range(0.3, 0.7), rng.range(0.5, 1.7));
    // Seated, not floating: a 0.45 m dodecahedron scaled on three axes and *rotated*
    // has a lowest point somewhere between 0.3 and 1.0 of its height, so a fixed
    // 2-16 cm of lift left most of the fifty rocks hovering. The centre is placed at
    // a fraction of the rock's own half-height instead, which buries the bottom
    // third whatever the rotation is — a rock half out of the dirt is a rock.
    const halfHeight = 0.45 * rock.scale.y;
    rock.position.set(
      rng.range(-55, 55),
      halfHeight * rng.range(0.55, 0.85),
      rng.range(-55, 55),
    );
    place(build, rock);
  }
  // Distant blocks: silhouette only, but they get a parapet and a tank so the
  // horizon does not look like a bar chart.
  for (let i = 0; i < map.ambient.skylineCount; i++) {
    const angle = (i / map.ambient.skylineCount) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const radius = rng.range(130, 180);
    const w = rng.range(10, 26);
    const h = rng.range(14, 48);
    const material = materials.buildings[i % materials.buildings.length]!;
    const ry = rng.range(0, 3);
    staticBox(build, material, w, h, w, Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius, ry);
    staticBox(
      build,
      materials.burnt,
      w * 0.3,
      rng.range(1.5, 4),
      w * 0.3,
      Math.cos(angle) * radius,
      h + 1,
      Math.sin(angle) * radius,
      rng.range(0, 3),
    );
  }

  // ---- gate marker lamps (parity: red glow at each gate) -------------------
  for (const gate of map.gates) {
    for (const side of [-1, 1]) {
      let px = gate.x;
      let pz = gate.z;
      if (gate.axis === 'x') px += side * 4.5;
      else pz += side * 4.5;

      const base = new THREE.Mesh(chamferedCylinder(0.12, 0.16, 0.22, 10), materials.metal);
      base.position.set(px, 0.11, pz);
      base.receiveShadow = true;
      place(build, base);
      const pole = new THREE.Mesh(lathe([[0.07, 0.2], [0.09, 0.5], [0.06, 3.3]], 10), materials.metal);
      pole.position.set(px, 0, pz);
      place(build, pole);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), materials.gateLamp);
      lens.position.set(px, 3.36, pz);
      place(build, lens);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: textures.soft,
          color: 0xff3020,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      glow.scale.setScalar(1.8);
      glow.position.set(px, 3.36, pz);
      group.add(glow);
    }
  }

  // ---- drifting dust motes -------------------------------------------------
  if (quality.dust) {
    const dustCount = quality.tier === 'high' || quality.tier === 'cinematic' ? 28 : 14;
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] = rng.range(-35, 35);
      positions[i * 3 + 1] = rng.range(0.4, 6);
      positions[i * 3 + 2] = rng.range(-35, 35);
      dustVelocities.push(
        new THREE.Vector3(rng.range(0.3, 0.9), rng.range(-0.05, 0.05), rng.range(-0.2, 0.2)),
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        map: textures.soft,
        color: 0xbfae8f,
        size: 1.1,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    dust.frustumCulled = false;
    dust.name = 'dust_motes';
    group.add(dust);
  }

  // Everything static is now one mesh per material: the arena costs a couple of
  // dozen draw calls no matter how many props the map declares.
  group.add(build.batcher.build());

  const fireLightAnchor = new THREE.Vector3(...map.ambient.fireLight);
  const smokeAnchors = map.ambient.smokeColumns.map((c) => new THREE.Vector3(c[0], c[1], c[2]));

  return {
    group,
    barrelMeshes: build.barrelMeshes,
    fireLightAnchor,
    smokeAnchors,
    bannerAnchors: build.bannerAnchors,
    windowAnchors: build.windowAnchors,
    lampGlows: build.lampGlows,
    update(playerX: number, playerZ: number, time: number, dt: number): void {
      for (let i = 0; i < build.bannerAnchors.length; i++) {
        const banner = build.bannerAnchors[i]!;
        banner.rotation.x = Math.sin(time * 1.2 + i) * 0.06;
      }
      if (dust) {
        const attribute = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
        const positions = attribute.array as Float32Array;
        for (let i = 0; i < dustVelocities.length; i++) {
          const velocity = dustVelocities[i]!;
          const x = i * 3;
          positions[x] = positions[x]! + velocity.x * dt;
          positions[x + 1] = positions[x + 1]! + velocity.y * dt;
          positions[x + 2] = positions[x + 2]! + velocity.z * dt;
          if (Math.abs(positions[x]! - playerX) > 38) positions[x] = playerX + (rng.next() * 70 - 35);
          if (Math.abs(positions[x + 2]! - playerZ) > 38) positions[x + 2] = playerZ + (rng.next() * 70 - 35);
        }
        attribute.needsUpdate = true;
      }
    },
    setBarrelAlive(index: number, alive: boolean): void {
      const mesh = build.barrelMeshes[index];
      if (mesh) mesh.visible = alive;
    },
    clearTransient(): void {
      // Explosions/scorches are owned by the FX systems; nothing to reset here.
    },
    dispose(): void {
      disposeBatched(group);
      dust?.geometry.dispose();
      group.clear();
    },
  };
}
