/**
 * The first-person weapon rig's contract.
 *
 * The art review's first complaint was that the weapon was "not held by a man",
 * and the reason was arithmetic rather than art: the old view model's receiver was
 * 0.66 m long (`body[2] * 1.5`), the muzzle sat 1.36 m from the eye, the stock
 * never reached the shoulder, and both gloves were built on the weapon's centre
 * line with four finger boxes each. No shader fixes that.
 *
 * So the numbers live in `packages/render/src/weapon/layout.ts`, where they can be
 * checked with no GPU and no DOM, and this file is the check. The three things it
 * proves:
 *
 *  1. the weapon is carbine-sized, because `MM` is a real armourer's table;
 *  2. the pose is solved — sight line on the camera axis, muzzle a carbine-length
 *     from the eye — rather than copied from the prototype's parity numbers;
 *  3. both hands are inside both arms at every aim blend, which is the actual
 *     meaning of "a man is holding it". `solveElbow` clamps, so an unreachable
 *     hand shows up as an arm that stops short of its glove.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WEAPONS } from '@iron/content';
import {
  ARM_LENGTH,
  ARMS,
  MM,
  armReaches,
  eyeToMuzzle,
  layoutProblems,
  posePosition,
  solveElbow,
  supportAnchor,
  weaponLayout,
} from '@iron/render';

const BLENDS = [0, 0.25, 0.5, 0.75, 1];

/**
 * The real-world size range a weapon's build has to land in, per archetype.
 *
 * A pistol is 19-36 cm and a rifle is 50-98 cm, and the fact that those are different
 * numbers is the reason the contract is per archetype rather than one range for
 * "a weapon": asserting a rifle's 80-90 cm against a Desert Eagle is how a test
 * rejects a correct handgun, and the first version of this file did exactly that.
 */
const LENGTH: Record<string, readonly [number, number]> = {
  pistol: [0.19, 0.36],
  carbine: [0.5, 0.98],
  ak: [0.5, 0.98],
};

describe('first-person weapon rig', () => {
  it('builds each weapon at the size the real one is', () => {
    for (const weapon of WEAPONS) {
      const layout = weaponLayout(weapon);
      const [minLength, maxLength] = LENGTH[layout.archetype]!;
      // The defect: 66 cm of receiver on a 44 cm body.
      expect(layout.receiverLength).toBeGreaterThan(MM.receiver * 0.6);
      expect(layout.receiverLength).toBeLessThanOrEqual(MM.receiver * 1.35);
      // A carbine is 80-90 cm overall and a Desert Eagle is 27 cm; the old model was
      // 1.0 m of box plus a stock that pointed the wrong way.
      expect(layout.totalLength, weapon.id).toBeGreaterThan(minLength);
      expect(layout.totalLength, weapon.id).toBeLessThan(maxLength);
      expect(layout.anchors.muzzle.z).toBeLessThan(layout.anchors.butt.z);
      // Everything is authored at metre scale: nothing is a metre wide or long.
      for (const part of layout.parts) {
        expect(part.size[0], `${weapon.id}/${part.id} width`).toBeLessThan(0.2);
        expect(Math.abs(part.at[0]), `${weapon.id}/${part.id} x`).toBeLessThan(0.2);
        expect(Math.abs(part.at[1]), `${weapon.id}/${part.id} y`).toBeLessThan(0.5);
        expect(Math.abs(part.at[2]), `${weapon.id}/${part.id} z`).toBeLessThan(1);
      }
    }
  });

  it('solves the pose: sight line on the axis, muzzle a weapon-length away', () => {
    for (const weapon of WEAPONS) {
      const layout = weaponLayout(weapon);
      const pistol = layout.archetype === 'pistol';
      const ads = posePosition(weapon, layout, 1);
      // The defect the review could not see directly: the sight (or the rear notch, on
      // iron sights) is the aim point, so its height has to be the camera axis.
      // (Content's `ads[1]` is -0.178, which put the sight line 10 cm below the
      // crosshair.)
      expect(Math.abs(ads.y + layout.anchors.optic.height)).toBeLessThan(0.002);

      // Presented, the muzzle is a carbine's 0.69-0.8 m or a pistol's half-metre from
      // the eye. The old model was 1.36 m, i.e. a weapon nobody could be holding.
      const adsMuzzle = eyeToMuzzle(weapon, layout, 1);
      expect(adsMuzzle, weapon.id).toBeGreaterThan(pistol ? 0.32 : 0.5);
      expect(adsMuzzle, weapon.id).toBeLessThan(pistol ? 0.62 : 0.85);

      const hipMuzzle = eyeToMuzzle(weapon, layout, 0);
      expect(hipMuzzle, weapon.id).toBeLessThan(pistol ? 0.9 : 1.05);
      const hip = posePosition(weapon, layout, 0);
      if (pistol) {
        // A pistol inverts one thing about a rifle's hold: the low-ready is *nearer*
        // the body than the presentation, because presenting it is what extends the
        // arm. (A rifle's hip hold is further out, because the support arm is out on
        // the handguard rather than folded under the grip.)
        expect(hipMuzzle, weapon.id).toBeLessThan(adsMuzzle);
        expect(hipMuzzle, weapon.id).toBeGreaterThan(0.3);
        // ...and with no stock, the whole weapon is in front of the eye.
        expect(hip.z + layout.anchors.muzzle.z).toBeLessThan(-0.3);
        expect(hip.z + layout.anchors.butt.z).toBeLessThan(-0.15);
      } else {
        expect(hipMuzzle, weapon.id).toBeGreaterThan(adsMuzzle);
        expect(hip.z + layout.anchors.muzzle.z).toBeLessThan(-0.5);
        expect(hip.z + layout.anchors.butt.z).toBeGreaterThan(-0.2);
      }

      // The blend is monotone: nothing about the pose doubles back mid-transition.
      const direction = pistol ? 1 : -1;
      let previous = eyeToMuzzle(weapon, layout, 0);
      for (const t of BLENDS.slice(1)) {
        const now = eyeToMuzzle(weapon, layout, t);
        expect(
          direction * now,
          `${weapon.id} muzzle at adsT=${t}`,
        ).toBeGreaterThanOrEqual(direction * previous - 1e-6);
        previous = now;
      }
    }
  });

  it('keeps both hands inside both arms at every aim blend', () => {
    for (const weapon of WEAPONS) {
      const layout = weaponLayout(weapon);
      for (const adsT of BLENDS) {
        for (const arm of armReaches(weapon, layout, adsT)) {
          const label = `${weapon.id} ${arm.side} hand at adsT=${adsT}`;
          // Reaching past the arm is a gap between glove and sleeve. The clamp in
          // `solveElbow` hides it in a render, so it has to fail here.
          expect(arm.distance, label).toBeLessThan(ARM_LENGTH - 0.005);
          // ...and an arm cannot be folded shorter than its bones.
          expect(arm.distance, label).toBeGreaterThan(Math.abs(ARMS.upper - ARMS.fore) + 0.02);
          // A hold that is 100% locked straight reads as a mannequin, so the rig
          // keeps some bend at every blend.
          expect(arm.extension, label).toBeLessThan(0.99);
          expect(arm.extension, label).toBeGreaterThan(0.35);
        }
      }
    }
  });

  it('slides the support hand from the magazine well to the handguard', () => {
    for (const weapon of WEAPONS) {
      const layout = weaponLayout(weapon);
      const hip = supportAnchor(layout, 0);
      const ads = supportAnchor(layout, 1);
      // Shouldered, the support hand is up on the handguard...
      expect(ads.distanceTo(layout.anchors.handguardLeft)).toBeLessThan(1e-6);
      // ...and at the hip it is back by the magazine well, which is both what a
      // shooter does and what keeps the support arm inside its length.
      expect(hip.distanceTo(layout.anchors.magWell)).toBeLessThan(
        hip.distanceTo(layout.anchors.handguardLeft),
      );
      expect(hip.z).toBeGreaterThan(layout.anchors.handguardLeft.z);
      let previous = hip.z;
      for (const t of BLENDS.slice(1)) {
        const now = supportAnchor(layout, t).z;
        expect(now, `${weapon.id} support hand at adsT=${t}`).toBeLessThanOrEqual(previous + 1e-9);
        previous = now;
      }
    }
  });

  it('reports no structural problems for any weapon', () => {
    for (const weapon of WEAPONS) {
      const layout = weaponLayout(weapon);
      const problems = layoutProblems(weapon, layout).map((p) => `${p.id}: ${p.detail}`);
      expect(problems, weapon.id).toEqual([]);
    }
  });

  it('solves an elbow that reaches the hand, and folds rather than detaching', () => {
    const shoulder = new THREE.Vector3(...ARMS.shoulderRight);
    const pole = new THREE.Vector3(...ARMS.poleRight);

    // A comfortable target: both bones at their true length, no clamping.
    const comfortable = shoulder.clone().add(new THREE.Vector3(0.05, -0.16, -0.42));
    const elbow = solveElbow(shoulder, comfortable, ARMS.upper, ARMS.fore, pole);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(ARMS.upper, 3);
    expect(elbow.distanceTo(comfortable)).toBeCloseTo(ARMS.fore, 3);
    // The pole decides which way the elbow falls, which is what keeps the left and
    // right arms from solving into each other.
    expect(elbow.clone().sub(shoulder).dot(pole)).toBeGreaterThan(0);

    // Out of reach: the limb stays whole and points at the hand instead of
    // stretching to meet it — which is exactly why an unreachable hold has to be
    // caught by `armReaches` rather than left to the IK.
    const far = shoulder.clone().add(new THREE.Vector3(0.4, -0.5, -0.9));
    const stretched = solveElbow(shoulder, far, ARMS.upper, ARMS.fore, pole);
    expect(stretched.distanceTo(shoulder)).toBeCloseTo(ARMS.upper, 3);
    const toElbow = stretched.clone().sub(shoulder).normalize();
    const toHand = far.clone().sub(shoulder).normalize();
    expect(toElbow.dot(toHand)).toBeGreaterThan(0.99);
    // The wrist cannot get closer than ARM_LENGTH to the shoulder, so the glove
    // sits beyond it: a visible gap between glove and sleeve.
    expect(stretched.distanceTo(far)).toBeGreaterThan(ARM_LENGTH);

    // Too close: a fold, not a NaN. (The old rig's degenerate-direction bug.)
    const folded = solveElbow(shoulder, shoulder.clone().add(new THREE.Vector3(0, 0, -0.01)), ARMS.upper, ARMS.fore, pole);
    expect(Number.isFinite(folded.x + folded.y + folded.z)).toBe(true);
    expect(folded.distanceTo(shoulder)).toBeCloseTo(ARMS.upper, 3);

    // Straight down the pole is the degenerate case for the axis cross product.
    const alongPole = solveElbow(shoulder, shoulder.clone().addScaledVector(pole, 0.4), ARMS.upper, ARMS.fore, pole);
    expect(Number.isFinite(alongPole.x + alongPole.y + alongPole.z)).toBe(true);
  });
});
