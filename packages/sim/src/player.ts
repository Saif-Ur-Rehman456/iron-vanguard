/**
 * Player movement and survivability.
 * Feel constants are prototype parity (legacy/PARITY_NOTES.md): walk 6.4,
 * sprint 10.5, accel 10, ADS slowdown 45%, pitch clamp +/-1.45, regen after 4.2 s.
 *
 * Stance (crouch, jump) is *not* parity — the prototype had neither, and the shipped
 * build bound Space to a `jump` action that no system consumed and left C unbound
 * (AGENTS.md entry 28). It lives here rather than in presentation because the eye
 * height is what enemies see and shoot at: a crouch that only moved the camera would
 * be a cosmetic stance, and one that moves the hitbox is a stance.
 */
import { clamp, damp, lerp, TICK_DT, type Vec3, yawFromDirection } from '@iron/core';
import type { InputState } from './commands';
import type { World } from './types';

export const PLAYER_RADIUS = 0.5; // parity
export const EYE_HEIGHT = 1.7; // parity

export const MOVEMENT = {
  walkSpeed: 6.4, // parity: CFG.walk
  sprintSpeed: 10.5, // parity: CFG.sprint
  accelRate: 10, // parity
  adsSlowdown: 0.45, // parity
  adsRate: 10, // parity
  sprintRate: 8, // parity
  sprintOutSeconds: 0.22, // parity
  sprintFovBonus: 7, // parity
  bobRateWalk: 9, // parity
  bobRateSprint: 13, // parity
  pitchClamp: 1.45, // parity
  lookSmoothing: 22, // parity
} as const;

/**
 * The stance the feet are not in charge of: how tall the player stands, and what
 * happens when they leave the ground.
 *
 * The numbers are a soldier in kit, not a gymnast: 0.51 m of crouch (1.70 → 1.19 m of
 * eye, the height difference between standing and a firing crouch), a 4.6 m/s take-off
 * with 20 m/s² of gravity for a 0.52 m hop and 0.46 s of air, and a *damped* stance
 * blend rather than a step so the camera and the weapon settle instead of snapping.
 */
export const STANCE = {
  /** Eye height standing and crouched, in metres above the feet. */
  standEye: EYE_HEIGHT,
  crouchEye: 1.19,
  /** Stance rate: ~0.25 s to change stance, whichever way. */
  crouchRate: 9,
  /** Crouched movement, as a fraction of the walk/sprint speed. */
  crouchSpeed: 0.5,
  /** Downward acceleration while airborne, m/s². */
  gravity: 20,
  /** Take-off speed, m/s: 4.6 here is a 0.53 m hop over 0.46 s. */
  jumpSpeed: 4.6,
  /** How much of the ground acceleration a body in the air still has. */
  airControl: 0.35,
  /** Rate the landing impulse decays at, once the feet are back down. */
  landRate: 7,
} as const;

const wish: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The player's eye, in world metres: the stance height above the feet plus whatever
 * the feet are standing on (a jump, or a crouch).
 *
 * Every system that aims at or *from* the player reads this, because a stance the
 * enemies cannot see is not a stance: the AI's sight targets, its aim point and the
 * player's own shot origin all resolve through here (see `ai.ts`, `weapons.ts`).
 */
export function playerEyeHeight(world: World): number {
  return world.player.eyeHeight + world.player.pos.y;
}

export function playerEye(out: Vec3, world: World): Vec3 {
  out.x = world.player.pos.x;
  out.y = playerEyeHeight(world);
  out.z = world.player.pos.z;
  return out;
}

/**
 * Leave the ground, if the feet are on it. Called as an action (AGENTS.md invariant 2:
 * the step order is untouched), and a no-op in the air so a second Space does not
 * buy a second jump.
 */
export function tryJump(world: World): void {
  const p = world.player;
  if (!p.alive || !p.grounded) return;
  p.grounded = false;
  p.vel.y = STANCE.jumpSpeed;
  p.airTicks = 0;
}

export function updatePlayer(world: World, input: InputState, dt: number = TICK_DT): void {
  const p = world.player;

  // ---- look ---------------------------------------------------------------
  p.aimYaw += input.dYaw;
  p.aimPitch = clamp(p.aimPitch + input.dPitch, -MOVEMENT.pitchClamp, MOVEMENT.pitchClamp);
  const lookT = Math.min(1, MOVEMENT.lookSmoothing * dt);
  p.yaw = lerp(p.yaw, p.aimYaw, lookT);
  p.pitch = lerp(p.pitch, p.aimPitch, lookT);

  // ---- stance -------------------------------------------------------------
  // Crouch first, because the stance decides the walk speed, the sprint gate and the
  // eye the enemies are aiming at.
  p.crouching = input.crouching && p.alive;
  p.crouchK = damp(p.crouchK, p.crouching ? 1 : 0, STANCE.crouchRate, dt);
  p.eyeHeight = STANCE.standEye - (STANCE.standEye - STANCE.crouchEye) * p.crouchK;

  const wantsSprint =
    input.sprinting && input.forward > 0 && !p.reloading && !p.aiming && p.alive && !p.crouching;
  p.sprinting = wantsSprint;
  p.aiming = input.aiming && p.alive;
  p.sprintOutT = wantsSprint ? MOVEMENT.sprintOutSeconds : Math.max(0, p.sprintOutT - dt);
  p.sprintK = damp(p.sprintK, wantsSprint ? 1 : 0, MOVEMENT.sprintRate, dt);
  const adsTarget = p.aiming && !wantsSprint && p.sprintOutT <= 0 ? 1 : 0;
  p.adsT = damp(p.adsT, adsTarget, MOVEMENT.adsRate, dt);

  // ---- planar velocity ----------------------------------------------------
  const stance = lerp(1, STANCE.crouchSpeed, p.crouchK);
  const speed =
    lerp(MOVEMENT.walkSpeed, MOVEMENT.sprintSpeed, p.sprintK) *
    (1 - MOVEMENT.adsSlowdown * p.adsT) *
    stance;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  wish.x = -sin * input.forward + cos * input.right;
  wish.z = -cos * input.forward - sin * input.right;
  const wishLen = Math.hypot(wish.x, wish.z);
  if (wishLen > 1e-6) {
    wish.x /= wishLen;
    wish.z /= wishLen;
  } else {
    wish.x = 0;
    wish.z = 0;
  }
  const targetX = wish.x * speed;
  const targetZ = wish.z * speed;
  // Air control is *reduced*, never removed: a jump keeps its momentum and can be
  // steered, which is what separates a jump from a rocket strafe.
  const accel = MOVEMENT.accelRate * (p.grounded ? 1 : STANCE.airControl);
  p.vel.x = damp(p.vel.x, targetX, accel, dt);
  p.vel.z = damp(p.vel.z, targetZ, accel, dt);

  if (p.alive) {
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    world.colliders.resolve(p.pos, PLAYER_RADIUS);
  }

  // ---- vertical: gravity, take-off, landing -------------------------------
  // Zero exactly on the ground, so the ground state is a *bit-identical* one: the
  // golden trace is recorded from a bot that never jumps, and a resting player must
  // hash to the same `pos`/`vel` it always did (ADR-0002).
  if (p.grounded) {
    p.pos.y = 0;
    p.vel.y = 0;
    p.airTicks = 0;
  } else {
    p.vel.y -= STANCE.gravity * dt;
    p.pos.y += p.vel.y * dt;
    p.airTicks++;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      // The landing impulse is the *fall* speed, so stepping off nothing reads as a
      // step and a full hop reads as a landing.
      p.landT = Math.min(1, Math.max(p.landT, Math.abs(p.vel.y) / STANCE.jumpSpeed));
      p.vel.y = 0;
      p.grounded = true;
    }
  }
  p.landT = Math.max(0, p.landT - STANCE.landRate * dt);

  p.speed = Math.hypot(p.vel.x, p.vel.z);

  // ---- head bob + footsteps (audio events, no wall-clock timers) ----------
  const moving = p.speed > 0.6;
  if (moving) {
    const rate = p.sprintK > 0.5 ? MOVEMENT.bobRateSprint : MOVEMENT.bobRateWalk;
    p.bobPhase += dt * rate * clamp(p.speed / MOVEMENT.walkSpeed, 0.4, 1.4);
    const before = Math.sin(p.bobPhase - dt * rate);
    if (Math.sin(p.bobPhase) > 0 && before <= 0) {
      world.events.push({
        type: 'audio',
        cue: world.tick % 2 === 0 ? 'step_left' : 'step_right',
        pos: { x: p.pos.x, y: 0.2, z: p.pos.z },
        volume: 0.5,
      });
    }
  }

  updateRegen(world, dt);

  p.damageIndicatorT = Math.max(0, p.damageIndicatorT - dt * 1.4);
  p.fireCooldownTicks = Math.max(0, p.fireCooldownTicks - 1);
  // The equip counter lives here because this is the one system that already runs
  // before the actions are applied, and a swap that could be outrun by the frame it
  // arrived on would let a player fire the weapon they just put away.
  p.equipTicks = Math.max(0, p.equipTicks - 1);
  p.grenadeCooldownTicks = Math.max(0, p.grenadeCooldownTicks - 1);
  p.heat = Math.max(0, p.heat - world.weaponDef.spread.heatDecayPerSecond * dt);
}

/** Health regeneration, gated on a damage-free window (parity: 4.2 s, 16 hp/s). */
function updateRegen(world: World, dt: number): void {
  const p = world.player;
  if (!p.alive) return;
  const sinceDamage = (world.tick - p.lastDamageTick) * TICK_DT;
  if (sinceDamage <= world.difficulty.regenDelaySeconds) return;
  if (p.health >= p.maxHealth) return;
  p.health = Math.min(p.maxHealth, p.health + world.difficulty.regenPerSecond * dt);
}

/** Yaw the player would need to face a world position (used by bot players). */
export function yawToPoint(world: World, x: number, z: number): number {
  return yawFromDirection(x - world.player.pos.x, z - world.player.pos.z);
}
