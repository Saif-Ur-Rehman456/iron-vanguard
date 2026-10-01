/**
 * The sight picture (AGENTS.md entry 27).
 *
 * The report was exact: *"open the scope and the screen is black — it does not work
 * like a real sight, the way COD shows the world through the optic."* It was not a
 * shading problem. Three pieces of geometry stood on the sight line, and the sight
 * line is one ray:
 *
 *  1. `optic_tube` and `optic_bezel` were built from `CylinderGeometry`, which is
 *     *capped*, so the rear cap of the sight tube was a 3.8 cm disc of opaque metal
 *     12 cm in front of the eye. That disc was the black screen;
 *  2. `lens_rear`/`lens_front` were dark glass at 0.4 opacity, stacked twice on that
 *     same axis — a 60% black filter over everything;
 *  3. the elevation turret and windage knob were centred on the tube's axis, so they
 *     stood inside the aperture it is impossible to aim through.
 *
 * The fix is geometry, so the check is geometric: build every weapon the way the view
 * model builds it (`partGeometry`/`partMaterial`, the real transforms, the real ADS
 * pose) and cast rays along the sight line. No GPU is involved — `THREE.Raycaster` is
 * pure matrix and triangle arithmetic — which is the whole reason the defect survived
 * as long as it did: it is invisible in a code review and needs one ray to prove.
 *
 * The sixth report (AGENTS.md entry 31) is the same complaint one step further on, and
 * every part of it is a number too: the optic was **39% of the frame's height** at 12 cm
 * of eye relief, its lenses were a **grey wash** (0.16 x 2 in front of the eye, with a
 * 1.7-intensity sky reflection on top), and its reticle was a **12 mm disc** — a ~50 px
 * pink blob centred on the aim point but useless for it. So the tests below are as much
 * about the *sizes* as about the ray: the aperture is a window, the rim is thin, the
 * reticle is small and centred, and the flash cannot stand in front of any of it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEAPONS, type WeaponDef } from '@iron/content';
import {
  ADS_FOV,
  HIP_FOV,
  createDotMaterial,
  createLensMaterial,
  handInCameraSpace,
  partGeometry,
  partMaterial,
  posePosition,
  weaponLayout,
  type WeaponMaterials,
  type WeaponPart,
} from '@iron/render';

/**
 * A material library with no textures in it.
 *
 * `partMaterial` cares about two things — which key is glass and which is a wall — so a
 * stub is enough to exercise it exactly as the renderer does. That is the point: the
 * test goes through the same function the game does rather than re-stating its rules.
 */
function stubMaterials(): WeaponMaterials {
  const tile = (): WeaponMaterials['gunmetal'] => ({
    material: new THREE.MeshStandardMaterial(),
    metresPerTile: 0.08,
    owned: [],
  });
  return {
    gunmetal: tile(),
    steel: tile(),
    polymer: tile(),
    wood: tile(),
    leather: tile(),
    sleeve: tile(),
    skin: tile(),
    lens: createLensMaterial(),
    dot: createDotMaterial(),
    opticWall: () => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
    dispose: () => {},
  };
}

/** Everything that is not glass or a reticle: what must not be in the way. */
function isOpaque(part: WeaponPart): boolean {
  return part.material !== 'lens' && part.material !== 'dot';
}

interface Built {
  layout: ReturnType<typeof weaponLayout>;
  pose: { x: number; y: number; z: number };
  parts: { mesh: THREE.Mesh; part: WeaponPart }[];
  /** Distance from the eye to the muzzle at this pose, in metres. */
  muzzle: number;
}

function build(def: WeaponDef, adsT: number): Built {
  const layout = weaponLayout(def);
  const materials = stubMaterials();
  const pose = posePosition(def, layout, adsT);
  const parts: Built['parts'] = [];
  for (const part of layout.parts) {
    const mesh = new THREE.Mesh(partGeometry(part, 0.08), partMaterial(materials, part));
    mesh.position.set(part.at[0] + pose.x, part.at[1] + pose.y, part.at[2] + pose.z);
    if (part.rot) mesh.rotation.set(...part.rot);
    mesh.updateMatrixWorld(true);
    parts.push({ mesh, part });
  }
  return { layout, pose, parts, muzzle: Math.abs(pose.z + layout.anchors.muzzle.z) };
}

const raycaster = new THREE.Raycaster();
const FORWARD = new THREE.Vector3(0, 0, -1);

/** Cast a ray from a point in camera space (the eye is the origin) down the bore line. */
function shoot(built: Built, x = 0, y = 0): { id: string; opaque: boolean; distance: number }[] {
  raycaster.set(new THREE.Vector3(x, y, 0), FORWARD);
  return raycaster.intersectObjects(built.parts.map((p) => p.mesh), false).map((hit) => {
    const entry = built.parts.find((p) => p.mesh === hit.object);
    const part = entry?.part;
    return {
      id: part?.id ?? '?',
      opaque: part ? isOpaque(part) : false,
      distance: hit.distance,
    };
  });
}

/** How far off the camera axis a point sits, as a fraction of the frame's half-height. */
function frameRatio(point: THREE.Vector3, fovDegrees: number): number {
  const half = Math.tan((fovDegrees / 2) * (Math.PI / 180));
  return Math.abs(point.y) / (Math.abs(point.z) * half);
}

describe('the sight picture', () => {
  it('is open: nothing opaque stands on the sight line', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      const hits = shoot(built);
      const opaque = hits.filter((hit) => hit.opaque);
      const optic = built.layout.parts.some((part) => part.material === 'lens');

      if (optic) {
        // The defect, stated as a number: the sight tube's own rear cap used to be here.
        expect(opaque.map((h) => `${h.id}@${h.distance.toFixed(3)}`), def.id).toEqual([]);
        // ...and the glass is still there: an optic with no lenses is not a sight.
        expect(hits.filter((h) => h.id.startsWith('lens_')).length, def.id).toBeGreaterThanOrEqual(2);
      } else {
        // Iron sights aim *at* the front post; everything else on the line is a defect.
        for (const hit of opaque) {
          expect(hit.id, `${def.id}: ${hit.id} is on the sight line`).toMatch(/front_sight|front_post/);
          expect(hit.distance, `${def.id}: ${hit.id}`).toBeGreaterThan(0.4);
        }
      }
    }
  });

  it('is open across the whole aperture, not just at the crosshair', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      const optic = built.layout.parts.some((part) => part.material === 'lens');
      if (!optic) continue;
      // Out to 0.0175 of the 0.0185 aperture: 95% of the hole, because a turret or a
      // mount that clears the centre and dips into the edge is still a sight you cannot
      // use at 4x — it is a smudge at the bottom of the glass.
      for (const radius of [0.003, 0.008, 0.013, 0.0175]) {
        for (let step = 0; step < 8; step++) {
          const angle = (step / 8) * Math.PI * 2;
          const hits = shoot(built, Math.cos(angle) * radius, Math.sin(angle) * radius);
          const blocked = hits.filter((hit) => hit.opaque);
          expect(
            blocked.map((h) => `${h.id}@${h.distance.toFixed(3)}`),
            `${def.id} at radius ${radius} / angle ${step}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('reads as a ring of optic with the world inside it', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      const lens = built.layout.parts.find((part) => part.id.startsWith('lens_rear'));
      if (!lens) continue;
      // The aperture's angular size against the aimed field of view. Half the frame is
      // not a sight picture, and an aperture under a sixth of it is a pinprick.
      const eyeToLens = Math.abs(built.pose.z + (lens.at[2] ?? 0));
      const aperture = 2 * Math.atan2(lens.radius ?? 0.0175, eyeToLens) * (180 / Math.PI);
      const fraction = aperture / ADS_FOV;
      // Under a fifth is a pinprick you cannot see a target in; over a third is the
      // shipped optic, which was a large object the player looked *at*.
      expect(fraction, `${def.id}: the aperture is ${(fraction * 100).toFixed(0)}% of the frame`)
        .toBeGreaterThan(0.17);
      expect(fraction, `${def.id}: the aperture is ${(fraction * 100).toFixed(0)}% of the frame`)
        .toBeLessThan(0.34);
    }
  });

  it('frames the sight picture in a thin rim rather than in a housing', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      const bezel = built.layout.parts.find((part) => part.id === 'optic_bezel');
      const lens = built.layout.parts.find((part) => part.id.startsWith('lens_rear'));
      if (!bezel || !lens) continue;
      const eyeToLens = Math.abs(built.pose.z + (lens.at[2] ?? 0));
      const angle = (radius: number): number =>
        (2 * Math.atan2(radius, eyeToLens) * (180 / Math.PI)) / ADS_FOV;
      const housing = angle(bezel.radius ?? 0.0205);
      const aperture = angle(lens.radius ?? 0.0175);
      // The whole optic, not just its glass: 39% of the frame height shipped, and with
      // the receiver under it the weapon owned half the picture. A quarter is an optic
      // you look through.
      expect(housing, `${def.id}: the housing is ${(housing * 100).toFixed(0)}% of the frame`)
        .toBeLessThan(0.3);
      // ...and most of that circle is a hole. The shipped rim was 5.5 mm of metal around
      // an 18.5 mm aperture (30% of the diameter); 2 mm is 11%.
      expect(
        aperture / housing,
        `${def.id}: the rim is ${((1 - aperture / housing) * 100).toFixed(0)}% of the optic`,
      ).toBeGreaterThan(0.7);
    }
  });

  it('puts a small reticle exactly on the point of aim', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      const reticle = built.layout.parts.filter((part) => part.material === 'dot');
      // Iron sights aim by a notch and a post rather than by an illuminated mark, and the
      // test above is what holds *them* to the line (nothing but the front post may be on
      // the ray, and it must be a hand's length out). An optic aims by its reticle, and an
      // optic with no reticle is not an aiming system.
      if (reticle.length === 0) continue;
      for (const part of reticle) {
        // Centred on the optic's own axis, which the ADS solve has already put on the
        // camera axis — so the reticle *is* the point of aim rather than near it.
        expect(part.at[0], `${def.id}/${part.id} is off the axis in x`).toBe(0);
        expect(part.at[1], `${def.id}/${part.id} is off the axis in y`).toBe(
          built.layout.anchors.optic.height,
        );
      }
      const outer = Math.max(...reticle.map((part) => part.radius ?? 0));
      const eyeToReticle = Math.abs(built.pose.z + (reticle[0]?.at[2] ?? 0));
      const size = (2 * Math.atan2(outer, eyeToReticle) * (180 / Math.PI)) / ADS_FOV;
      // The shipped reticle was a 12 mm disc: a ~50 px pink blob, which is a reticle the
      // player reads as light rather than as a mark. Between 0.8% (visible) and 4% (~31 px
      // at 1080p) is a dot you can put on a head.
      expect(size, `${def.id}: the reticle is ${(size * 100).toFixed(1)}% of the frame`).toBeLessThan(0.04);
      expect(size, `${def.id}: the reticle is ${(size * 100).toFixed(1)}% of the frame`).toBeGreaterThan(
        0.008,
      );
    }
  });

  it('keeps the muzzle flash behind the optic, so firing cannot cover the sight picture', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      // From the eye, the flash sits further away than the optic's own rear glass, and
      // the flash sprite is additive *and* depth-tested while the optic is opaque. So the
      // part of a burst the housing covers is depth-tested away, and the sight picture
      // survives sustained fire — which is the difference between "firing is loud" and
      // "firing makes the player blind".
      const flash = built.pose.z + built.layout.anchors.muzzleFlash.z;
      const optic = built.pose.z + built.layout.anchors.optic.rear.z;
      expect(
        flash,
        `${def.id}: the flash is at ${flash.toFixed(3)} m and the optic at ${optic.toFixed(3)} m`,
      ).toBeLessThan(optic);
    }
  });

  it('keeps the weapon and the support hand in the frame when aiming', () => {
    for (const def of WEAPONS) {
      const built = build(def, 1);
      const hands = handInCameraSpace(def, built.layout, 1);
      // The support hand is the one a player reads as "the man is holding this", and at
      // ADS it is the only one that can be shown: the trigger hand sits below the sight
      // line by the height of an optic, which at 12 cm of eye relief is off the bottom
      // edge of any field of view a human would call aimed.
      expect(frameRatio(hands.left, ADS_FOV), `${def.id} support hand`).toBeLessThan(1);
      expect(frameRatio(hands.right, ADS_FOV), `${def.id} trigger hand`).toBeLessThan(1.4);
    }
  });

  it('keeps the weapon and both hands in the frame at the hip', () => {
    for (const def of WEAPONS) {
      const built = build(def, 0);
      const hands = handInCameraSpace(def, built.layout, 0);
      // The shipped pistol low-ready put its own grip 2x outside the frustum: the player
      // saw a sliver of muzzle at the bottom of the screen and called it an incomplete
      // pistol with no hands. Both holds are in frame now, for every weapon.
      expect(frameRatio(hands.right, HIP_FOV), `${def.id} trigger hand`).toBeLessThan(1);
      expect(frameRatio(hands.left, HIP_FOV), `${def.id} support hand`).toBeLessThan(1);
    }
  });

  it('is opaque where the layout says it is, and glass where it says glass', () => {
    const materials = stubMaterials();
    for (const def of WEAPONS) {
      const layout = weaponLayout(def);
      for (const part of layout.parts) {
        const material = partMaterial(materials, part);
        if (part.material === 'lens' || part.material === 'dot') {
          expect(material.transparent, `${def.id}/${part.id} must be see-through`).toBe(true);
        } else {
          expect(material.transparent, `${def.id}/${part.id} must not be see-through`).not.toBe(true);
        }
        if (part.open) {
          // A tube the player looks down has to be drawn from both sides, or its own
          // inner wall is a hole through the weapon.
          expect(material.side, `${def.id}/${part.id} must be double-sided`).toBe(THREE.DoubleSide);
        }
      }
    }
  });
});
