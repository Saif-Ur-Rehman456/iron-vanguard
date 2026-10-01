/**
 * Shared geometry factory.
 *
 * Two things live here, and both exist for the same reason: an edge that is a
 * perfect 90° corner does not exist on a real object, and nothing tells a viewer
 * "this is a video-game box" faster. A 1.5 cm bevel catches a highlight along the
 * corner and the prop reads as manufactured.
 *
 * Everything is cached by size, so the arena can ask for a hundred differently
 * sized rounded crates and still upload a handful of buffers.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const boxes = new Map<string, THREE.BufferGeometry>();

/** Default corner radius: small enough for a crate, right for a wall too. */
export const BEVEL = 0.025;

/**
 * The most a bevel may take off a part's smallest dimension, as a share of it.
 *
 * A bevel is not "round the corners a bit": it is the *edge* of a real part, and a real
 * part's edge radius is a small fraction of the part. The first version of this clamped the
 * radius to a third of the smallest dimension, which is fine for a crate and a disaster for
 * anything you can hold: a 60 mm detail box came out with a 20 mm radius, i.e. a capsule,
 * and a 30 mm one with 10 mm. Every small man-made form in the arena and on the weapon was
 * being rounded into a lozenge — the seventh-pass frames' "objects are primitive shapes" and
 * the fourth's "the weapon is a plank" are partly this one number, and no amount of detail
 * geometry survives being melted. A share of 0.12 is a machined or moulded edge (a 60 mm
 * part keeps a 7 mm round, a 20 cm bumper keeps its 2.5 cm one) and it can never eat a face.
 */
export const BEVEL_SHARE = 0.12;

/**
 * The radius `roundedBox` will actually use for a part of this size.
 *
 * Exported because it is the geometry pass's one rule, so it can be asserted without a GPU
 * (`tests/unit/detail.test.ts`): never more than a share of the smallest dimension, never
 * more than a third (which is the self-intersection limit), never below the tiny floor that
 * keeps a 4 mm plate from being mathematically sharp.
 */
export function bevelFor(
  width: number,
  height: number,
  depth: number,
  radius = BEVEL,
): number {
  const smallest = Math.min(width, height, depth);
  const share = Math.max(0.0005, Math.min(radius, smallest * BEVEL_SHARE));
  // The third-clamp is applied *after* the floor, not folded into it: on a 4 mm plate a 1.5 mm
  // floor is already a third of the part, and a rule that can violate its own limit near zero
  // is not a rule (`tests/unit/detail.test.ts` checks every size from 4 mm to 2 m).
  return Math.min(share, smallest / 3);
}

/**
 * Rounded box with UVs and (copied) UV1 so `aoMap` works.
 *
 * The radius is `bevelFor`: absolute up to the part's own size, then a share of it, so a
 * 5 m wall and a 5 cm plank are both bevelled *by the same rule* rather than by the same
 * number (see `BEVEL_SHARE` — the same number was the defect).
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = BEVEL,
  segments = 2,
): THREE.BufferGeometry {
  const r = bevelFor(width, height, depth, radius);
  const key = `b:${width.toFixed(3)}:${height.toFixed(3)}:${depth.toFixed(3)}:${r.toFixed(4)}:${segments}`;
  const cached = boxes.get(key);
  if (cached) return cached;
  const geometry = withAoUv(new RoundedBoxGeometry(width, height, depth, segments, r));
  boxes.set(key, geometry);
  return geometry;
}

/**
 * Cylinder with a chamfered top edge (machined parts are never a sharp rim).
 *
 * `openEnded` is not a detail: a `CylinderGeometry` is capped, and a capped tube on
 * the sight line is a solid disc of metal between the eye and the world. That is
 * exactly what the optic was — a 12 cm-long capped tube whose rear cap filled the
 * aim point, which is why opening the sight showed a black disc instead of a sight
 * picture (AGENTS.md, the 2026 optic review). Anything the player is *meant* to look
 * down is built open-ended, and the shader draws its inner wall from the material
 * (see `viewmodel.partMaterial`).
 */
export function chamferedCylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments = 16,
  openEnded = false,
): THREE.BufferGeometry {
  return withAoUv(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, openEnded),
  );
}

/**
 * A true ring: an annulus with a hole in the middle.
 *
 * The weapon layout names a `ring` shape for anything whose whole point is the hole
 * — a sling loop, a sight bezel, a lens retaining ring. `CircleGeometry` cannot be
 * one: it is a *filled* disc, so a part authored as a ring rendered as a solid plate.
 */
export function annulus(
  outerRadius: number,
  innerRadius: number,
  segments = 24,
): THREE.BufferGeometry {
  const inner = Math.max(0.0001, Math.min(innerRadius, outerRadius - 0.0002));
  return withAoUv(new THREE.RingGeometry(inner, outerRadius, segments, 1));
}

/** Lathe a 2D profile (x = radius, y = height) — barrels, rims, lamp housings. */
export function lathe(points: readonly [number, number][], segments = 20): THREE.BufferGeometry {
  const curve = points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return withAoUv(new THREE.LatheGeometry(curve, segments));
}

/**
 * AO sampling needs a second UV set; sharing the first is exactly right for
 * procedural geometry where both are in the same 0..1 box space.
 */
export function withAoUv(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  if (uv && !geometry.getAttribute('uv1')) geometry.setAttribute('uv1', uv);
  return geometry;
}

/**
 * A limb: tapered tube with rounded ends, for arms and legs.
 *
 * A cylinder is a *stick* — the eye reads the flat end cap instantly, and a hand
 * modelled as a box on the end of a stick is the reason the old view model read
 * as a plank someone had taped gloves to. The profile is lathed from a rounded
 * shoulder to a rounded wrist so the silhouette is organic at 30 cm.
 */
export function limb(
  radiusBottom: number,
  radiusTop: number,
  length: number,
  segments = 14,
): THREE.BufferGeometry {
  const cap = 5;
  const h = Math.max(0.002, length / 2 - Math.min(radiusBottom, radiusTop));
  const points: [number, number][] = [];
  for (let i = 0; i <= cap; i++) {
    const t = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    points.push([radiusBottom * Math.cos(t), -h + radiusBottom * Math.sin(t)]);
  }
  const shaft = 4;
  for (let i = 1; i < shaft; i++) {
    const k = i / shaft;
    points.push([radiusBottom + (radiusTop - radiusBottom) * k, -h + k * 2 * h]);
  }
  for (let i = 0; i <= cap; i++) {
    const t = (i / cap) * (Math.PI / 2);
    points.push([radiusTop * Math.cos(t), h + radiusTop * Math.sin(t)]);
  }
  return withAoUv(lathe(points, segments));
}

/**
 * World-space UVs: set a geometry's texture scale from its real size.
 *
 * This is the fix for the defect behind most of the "everything looks like
 * painted cardboard" notes: `repeat` was baked into the *texture*, so a mesh's
 * texel density was `texture pixels / mesh size` — 10 px/m on the plaza floor
 * and 3,400 px/m on a crate, in the same frame. Authoring the UVs in metres
 * instead makes a surface's density a property of the surface, independent of
 * whatever it is applied to.
 *
 * Returns a *clone*: geometries here are cached and shared by size, so scaling
 * the UVs of a cached box in place would corrupt every other user of it.
 *
 * @param uMetres real-world width the U axis spans (circumference on a tube)
 * @param vMetres real-world height the V axis spans (length on a tube)
 * @param metresPerTile how large one texture tile is meant to be, in metres
 */
export function uvMetres(
  geometry: THREE.BufferGeometry,
  uMetres: number,
  vMetres: number,
  metresPerTile: number,
): THREE.BufferGeometry {
  const scaled = geometry.clone();
  const tile = Math.max(0.001, metresPerTile);
  const su = uMetres / tile;
  const sv = vMetres / tile;
  // One attribute may be registered under both names (see `withAoUv`), and scaling it
  // twice squares the density. `clone()` normally splits them, so this guard is about
  // keeping that true rather than fixing a live defect — the live one was in
  // `boxUvMetres`, which builds its geometry instead of cloning it.
  const done = new Set<THREE.BufferAttribute>();
  for (const name of ['uv', 'uv1'] as const) {
    const uv = scaled.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!uv || done.has(uv)) continue;
    done.add(uv);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
  }
  return scaled;
}

/**
 * Slide a geometry's UVs by a fixed amount, in tile units.
 *
 * The cheapest repetition break there is: a tiled wall is a *pattern* because every
 * instance of it starts at the same corner of the same map, and two buildings that
 * sample different windows onto that map are two walls made of one texture. It costs
 * the UV attribute and nothing else — no second map, no second material, no draw call —
 * which matters because "break the repetition" otherwise reads as "ship more art".
 *
 * Wrapping is the caller's: an offset is only a *different window* if the texture repeats,
 * and a clamped map would smear its edge pixel across the far side of the face instead.
 *
 * Returns a *clone* with only the `uv` set moved, for the reason `uvMetres` clones and then
 * some: `withAoUv` hands `uv1` the same attribute *object* as `uv` (right for the shader,
 * wrong for anything that names one of them — the doubling trap of AGENTS.md entry 22), so
 * shifting in place would drag a surface's occlusion into its new texture window. Cloning
 * splits the pair, and the AO set stays where it was.
 */
export function shiftUv(
  geometry: THREE.BufferGeometry,
  offsetU: number,
  offsetV: number,
): THREE.BufferGeometry {
  const shifted = geometry.clone();
  const uv = shifted.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + offsetU, uv.getY(i) + offsetV);
    uv.needsUpdate = true;
  }
  return shifted;
}

/**
 * A box whose six faces are each textured at `metresPerTile`, in real metres.
 *
 * `uvMetres` scales a geometry's *whole* UV set, which is exact on a tube and
 * approximate on a box — and on a large box it is not approximate, it is wrong. A
 * `BoxGeometry` gives every face a 0..1 UV square, so scaling by one pair of numbers
 * stretches the pattern along whichever axes the caller did not name: a 20 x 12 x 18 m
 * building shell was textured as if all three of its dimensions were 18 m, which is
 * how a facade came out as stretched noise *and* as a different density on each of
 * its faces. (The review's frames: the whole building was one smear of grain with no
 * reading of scale at all.)
 *
 * So this authors the UVs per face, from that face's own two real dimensions:
 *
 *   +/-X faces span depth x height
 *   +/-Y faces span width x depth
 *   +/-Z faces span width x height
 *
 * Every face then shows the pattern at the same physical size, and a wall's texture
 * agrees with the wall next to it however the two buildings are proportioned.
 */
export function boxUvMetres(
  width: number,
  height: number,
  depth: number,
  metresPerTile: number,
): THREE.BufferGeometry {
  const geometry = withAoUv(new THREE.BoxGeometry(width, height, depth));
  const tile = Math.max(0.001, metresPerTile);
  // `withAoUv` hands `uv1` the *same* attribute object as `uv` (which is correct for
  // the shader — the AO map must be sampled in the same space), so the two names must
  // not both be scaled or the density is squared: a 20 m wall at 2.5 m per tile came
  // out at 51.8 tiles across instead of 7.2. `uvMetres` never hits this because it
  // clones first, which splits the two attributes; a freshly built box does not.
  const scaled = new Set<THREE.BufferAttribute>();
  // BoxGeometry's face order is +X, -X, +Y, -Y, +Z, -Z, four vertices each, and the
  // default UVs are the unit square, so scaling a face's four UVs by the extents it
  // covers is the whole job.
  const extents: readonly (readonly [number, number])[] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  for (const name of ['uv', 'uv1'] as const) {
    const uv = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!uv || scaled.has(uv)) continue;
    scaled.add(uv);
    for (let face = 0; face < 6; face++) {
      const [u, v] = extents[face]!;
      const su = u / tile;
      const sv = v / tile;
      for (let corner = 0; corner < 4; corner++) {
        const index = face * 4 + corner;
        uv.setXY(index, uv.getX(index) * su, uv.getY(index) * sv);
      }
    }
    uv.needsUpdate = true;
  }
  return geometry;
}

/** A slung cable between two points, hanging with real catenary sag. */
export function cableBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  radius = 0.035,
  segments = 16,
): THREE.BufferGeometry {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return withAoUv(new THREE.TubeGeometry(curve, segments, radius, 5, false));
}

/**
 * A fractured chunk of masonry: an irregular convex hull with flat faces, which
 * is what broken concrete actually looks like (a box with random scale is not).
 */
export function rubbleChunk(seed: number, size = 0.5): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let i = 0; i < 9; i++) {
    const theta = random() * Math.PI * 2;
    const radius = size * (0.55 + random() * 0.45);
    points.push(
      new THREE.Vector3(
        radius * Math.cos(theta),
        radius * (0.2 + random() * 0.8),
        radius * Math.sin(theta),
      ),
    );
  }
  const geometry = new ConvexGeometry(points);
  return withAoUv(geometry);
}

export function disposeGeometryCache(): void {
  for (const geometry of boxes.values()) geometry.dispose();
  boxes.clear();
}
