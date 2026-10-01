/**
 * The walk (AGENTS.md entry 29).
 *
 * The report was "the enemies' walk animation has to be realistic, like COD", and the
 * shipped walk was one line: `leftLeg.rotation.x = sin(phase) * 0.8`, mirrored. One
 * joint per leg means the legs are *sticks*, and arithmetic says why that cannot walk:
 *
 *  - a straight 0.96 m leg swung 26 degrees puts its sole 10 cm above the ground, and
 *    nothing corrected for it, so the squad skated with its feet in the air;
 *  - no knee means no swing phase: the foot never lifts and never plants;
 *  - no ankle means no heel strike and no toe-off, which is most of what the eye reads;
 *  - a phase advanced by the *clock* slides the feet whenever the animation's cadence
 *    and the simulation's speed disagree, and they always disagree somewhere.
 *
 * Every one of those is a statement about numbers, so this file checks numbers: the
 * stance foot's sole is on the ground and never below it, the swing foot clears by the
 * authored height, the knee only ever flexes, the right leg is the left leg half a
 * cycle later, and one cycle covers exactly the distance the body travelled.
 */
import { describe, expect, it } from 'vitest';
import { GAIT, legReach, soleHeight, strideFor, swingClearance, walkPose } from '@iron/render';

/** Sample the whole cycle densely: a gait invariant has to hold everywhere, not once. */
const PHASES = Array.from({ length: 240 }, (_, i) => (i / 240) * Math.PI * 2);
const SPEEDS = [0, 0.6, 1.4, 2.2, 2.6, 3.2, 4.4, 5.2, 7];

describe('the walk cycle', () => {
  it('plants the stance foot and never pushes a foot through the ground', () => {
    for (const speed of SPEEDS) {
      const { hipSwing } = strideFor(speed);
      let lowest = Infinity;
      for (const phase of PHASES) {
        const pose = walkPose(phase, hipSwing);
        const left = soleHeight(pose, 'left');
        const right = soleHeight(pose, 'right');
        // No foot below the contact height, at any phase, whichever leg is leading.
        expect(Math.min(left, right), `speed ${speed} phase ${phase.toFixed(2)}`)
          .toBeGreaterThanOrEqual(GAIT.contactY - 1e-9);
        lowest = Math.min(lowest, left, right);
      }
      // ...and a foot is *always* on the ground: a walk where both feet hover has no
      // stance leg, and the eye reads that as floating.
      expect(lowest, `speed ${speed} never touches down`).toBeCloseTo(GAIT.contactY, 6);
    }
  });

  it('lifts the swing foot by the clearance the gait is authored for', () => {
    for (const hipSwing of [GAIT.hipMin, GAIT.referenceHipSwing, 0.5, GAIT.hipMax]) {
      const target = swingClearance(hipSwing);
      let highest = -Infinity;
      for (const phase of PHASES) {
        const pose = walkPose(phase, hipSwing);
        highest = Math.max(highest, soleHeight(pose, 'left'), soleHeight(pose, 'right'));
      }
      const achieved = highest - GAIT.contactY;
      expect(achieved, `hipSwing ${hipSwing.toFixed(2)}: clears ${(achieved * 100).toFixed(1)} cm`)
        .toBeGreaterThan(target - 0.025);
      expect(achieved, `hipSwing ${hipSwing.toFixed(2)}: clears ${(achieved * 100).toFixed(1)} cm`)
        .toBeLessThan(target + 0.035);
      // And within a human range: nothing lifts a foot half a metre off the ground,
      // which is what an unsolved knee amplitude did.
      expect(achieved).toBeLessThan(0.2);
    }
  });

  it('bends the knee, and only ever the wrong way round', () => {
    for (const speed of SPEEDS) {
      const { hipSwing } = strideFor(speed);
      let deepest = 0;
      for (const phase of PHASES) {
        const pose = walkPose(phase, hipSwing);
        for (const knee of [pose.leftKnee, pose.rightKnee]) {
          // Knee flexion is negative: a shin that swings *forward* under the thigh is a
          // knee bending backwards, and a rig that does it once does it every step.
          expect(knee, `speed ${speed} phase ${phase.toFixed(2)}`).toBeLessThanOrEqual(1e-9);
          expect(Math.abs(knee)).toBeLessThan(1.7);
          deepest = Math.min(deepest, knee);
        }
      }
      // A walk bends the knee; a straight-legged glide is the defect this replaced.
      expect(deepest, `speed ${speed} barely bends a knee`).toBeLessThan(-0.18);
    }
  });

  it('is a stride, not a limp: the right leg is the left leg half a cycle later', () => {
    for (const hipSwing of [0.2, 0.4, 0.62]) {
      for (const phase of PHASES) {
        const now = walkPose(phase, hipSwing);
        const later = walkPose(phase + Math.PI, hipSwing);
        expect(later.leftHip).toBeCloseTo(now.rightHip, 10);
        expect(later.rightHip).toBeCloseTo(now.leftHip, 10);
        expect(later.leftKnee).toBeCloseTo(now.rightKnee, 10);
        expect(later.leftAnkle).toBeCloseTo(now.rightAnkle, 10);
      }
    }
  });

  it('is periodic, and never produces a NaN', () => {
    for (const phase of PHASES) {
      const a = walkPose(phase, 0.42);
      const b = walkPose(phase + Math.PI * 2, 0.42);
      expect(b.leftHip).toBeCloseTo(a.leftHip, 10);
      expect(b.bob).toBeCloseTo(a.bob, 10);
      expect(Number.isFinite(a.bob + a.leftHip + a.rightKnee + a.roll + a.yaw)).toBe(true);
    }
  });

  it('does not skate: one cycle covers exactly the ground the body covered', () => {
    for (const speed of SPEEDS.slice(1)) {
      const { cadence, stride, hipSwing } = strideFor(speed);
      // The phase is driven by distance, so this identity *is* the no-skate property:
      // the distance the feet cover per second equals the speed the body moves at.
      expect((stride * cadence) / 2, `speed ${speed}`).toBeCloseTo(speed, 9);
      // ...and the hips' swing is the step the stride asks for, when it fits: a step is
      // two shoulder-to-sole lengths times the sine of the hip's angle.
      const step = 2 * GAIT.legLength * Math.sin(hipSwing);
      if (hipSwing < GAIT.hipMax - 1e-9) {
        expect(step, `speed ${speed}`).toBeCloseTo(stride / 2, 9);
      }
      expect(cadence).toBeGreaterThanOrEqual(GAIT.cadenceMin - 1e-9);
      expect(hipSwing).toBeLessThanOrEqual(GAIT.hipMax + 1e-9);
      expect(hipSwing).toBeGreaterThanOrEqual(GAIT.hipMin - 1e-9);
    }
  });

  it('stands still rather than marching on the spot when idle', () => {
    const idle = strideFor(0);
    const pose = walkPose(0, idle.hipSwing);
    expect(Math.abs(pose.leftHip)).toBeLessThan(0.02);
    expect(Math.abs(pose.leftKnee)).toBeLessThan(0.35);
    // A standing soldier still has weight on the ground: within a millimetre, which is
    // as exact as a pose with a soft knee in both legs can be.
    expect(Math.max(soleHeight(pose, 'left'), soleHeight(pose, 'right')))
      .toBeCloseTo(GAIT.contactY, 3);
  });

  it('measures the leg chain as the body was built', () => {
    // The three joints are placed at exactly these offsets in `enemyView.buildBody`;
    // if one moves, the feet stop landing and this says which number is wrong.
    expect(GAIT.segments[0] + GAIT.segments[1] + GAIT.segments[2]).toBeCloseTo(GAIT.legLength, 9);
    expect(legReach(0, 0, 0)).toBeCloseTo(GAIT.legLength, 9);
    // A knee bent 90 degrees lays the shin (and the foot on the end of it) out
    // horizontally, so the sole hangs exactly the thigh's length below the hip.
    expect(legReach(0, -Math.PI / 2, 0)).toBeCloseTo(GAIT.segments[0], 6);
    // The angles accumulate down the chain, which is what makes the ankle's roll move
    // the *foot* rather than the whole leg.
    expect(legReach(0, 0, Math.PI / 2)).toBeCloseTo(GAIT.segments[0] + GAIT.segments[1], 6);
  });
});
