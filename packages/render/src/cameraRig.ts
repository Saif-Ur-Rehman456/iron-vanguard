/**
 * Camera rig — prototype parity for the FOV ladder (75 hip / 42 ADS + 7 sprint
 * punch) and the shake/bob/roll presentation. Motion output is scaled by
 * `motionScale`, which backs the accessibility setting (docs/ACCESSIBILITY.md).
 */
import type * as THREE from 'three';
import { playerEyeHeight, type World } from '@iron/sim';
import { clamp, damp, lerp, shortestAngle, TICK_DT } from '@iron/core';

export const HIP_FOV = 75; // parity
/**
 * Aimed FOV.
 *
 * 42 is the prototype's number and it is the one deviation from it in this file: at
 * 42 degrees *vertical* — 69 horizontal — a red dot 12 cm from the eye occupies half
 * the frame, leaves no sight picture around the optic, and puts everything below the
 * sight line (both hands, the receiver, the support forearm) outside the frustum.
 * 55 is 78 horizontal: a 1.36x aim zoom, the optic at about a third of the frame
 * height with world visible inside and around it, and the hands in shot — which is
 * what "open the sight and see through it, like COD" means numerically.
 * (legacy/PARITY_NOTES.md.)
 */
export const ADS_FOV = 55;

export interface CameraRigState {
  shake: number;
  fovPunch: number;
  roll: number;
  swayX: number;
  swayY: number;
  kick: number;
  flash: number;
}

export class CameraRig {
  readonly state: CameraRigState = {
    shake: 0,
    fovPunch: 0,
    roll: 0,
    swayX: 0,
    swayY: 0,
    kick: 0,
    flash: 0,
  };

  private smoothYaw = 0;
  private smoothPitch = 0;
  private smoothX = 0;
  private smoothZ = 0;
  private smoothEye = 1.7;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private motionScale = 1,
  ) {}

  setMotionScale(scale: number): void {
    this.motionScale = clamp(scale, 0, 2);
  }

  addShake(amount: number): void {
    this.state.shake = Math.min(this.state.shake + amount, 2);
  }

  setFovPunch(value: number): void {
    this.state.fovPunch = value;
  }

  setKick(value: number): void {
    this.state.kick = value;
  }

  setSway(x: number, y: number): void {
    this.state.swayX = x;
    this.state.swayY = y;
  }

  /** Apply view state for a (possibly interpolated) player pose. */
  update(
    world: World,
    dt: number,
    pose: { x: number; z: number; yaw: number; pitch: number },
    fovScale = 1,
  ): void {
    const p = world.player;
    const motion = this.motionScale;

    // Smooth the interpolated pose so tick boundaries never pop.
    this.smoothYaw += shortestAngle(this.smoothYaw, pose.yaw) * Math.min(1, 30 * dt);
    this.smoothPitch = pose.pitch;
    this.smoothX = pose.x;
    this.smoothZ = pose.z;

    const moving = p.speed > 0.6;
    const bobY = moving ? Math.sin(p.bobPhase * 2) * 0.018 * (1 - 0.7 * p.adsT) * motion : 0;
    const bobX = moving ? Math.cos(p.bobPhase) * 0.012 * (1 - 0.7 * p.adsT) * motion : 0;

    // The eye is the *simulation's* stance — a crouch drops it 0.51 m, a jump lifts
    // it — chased rather than snapped, because a jump moves it 8 cm in one 60 Hz tick
    // and a camera that follows the tick grid reads as a stutter. 30/s is a 3 cm
    // lag at sprint speed and no lag you can feel at a stance change.
    this.smoothEye = lerp(this.smoothEye, playerEyeHeight(world), Math.min(1, 30 * dt));
    const eye = this.smoothEye;
    this.camera.position.set(
      this.smoothX + bobX,
      eye + bobY + Math.sin(world.tick * TICK_DT * 1.3) * 0.004 * motion,
      this.smoothZ,
    );

    this.state.shake *= Math.exp(-5 * dt); // parity decay
    this.state.fovPunch *= Math.exp(-8 * dt);
    this.state.kick *= Math.exp(-9 * dt);

    const shake = this.state.shake * motion;
    this.camera.rotation.set(this.smoothPitch, this.smoothYaw, 0, 'YXZ');
    this.state.roll = damp(this.state.roll, -this.strafeRoll(world) * (1 - p.adsT) * motion, 6, dt);
    this.camera.rotation.z = this.state.roll + (shake > 0.002 ? (Math.random() - 0.5) * shake * 0.012 : 0);
    if (shake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * shake * 0.06;
      this.camera.position.y += (Math.random() - 0.5) * shake * 0.06;
    }

    const hipFov = HIP_FOV * fovScale;
    const adsFov = ADS_FOV * fovScale;
    const targetFov =
      lerp(hipFov, adsFov, p.adsT) +
      p.sprintK * 7 * (1 - p.adsT) * motion + // parity sprint FOV punch
      this.state.fovPunch * 1.4 * (1 - p.adsT) * motion;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, 12 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  private strafeRoll(world: World): number {
    // parity: roll is proportional to lateral velocity
    const p = world.player;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const right = p.vel.x * cos - p.vel.z * sin;
    return clamp(right * 0.0025, -0.03, 0.03);
  }

  reset(): void {
    this.smoothYaw = 0;
    this.smoothPitch = 0;
    this.smoothX = 0;
    this.smoothZ = 0;
    this.smoothEye = 1.7;
    this.state.shake = 0;
    this.state.fovPunch = 0;
    this.state.roll = 0;
    this.state.swayX = 0;
    this.state.swayY = 0;
    this.state.kick = 0;
  }
}
