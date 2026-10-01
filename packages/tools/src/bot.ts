/**
 * Scripted player ("the bot").
 *
 * Used by balance sweeps, the headless harness and Playwright fast-forwards. It
 * is deterministic on purpose: a sweep must be reproducible, and a bot that
 * behaves like a competent player is what makes balance numbers meaningful.
 *
 * Design notes (learned the hard way):
 *  - The first version walked straight at the nearest hostile with the weapon
 *    down. Inside 50 m that is suicide: eight riflemen deal ~9 dps each, so the
 *    bot died in wave 2 and nothing downstream was measurable.
 *  - It now fights like a human: hold an 11-20 m standoff band, strafe, withdraw
 *    while shooting when pressured, and only sprint when nothing is visible.
 */
import { clamp } from '@iron/core';
import {
  EYE_HEIGHT,
  createInputState,
  currentObjective,
  yawToPoint,
  type EnemyState,
  type InputState,
  type World,
} from '@iron/sim';

export interface BotDecision {
  input: InputState;
  actions: string[];
}

export interface BotProfile {
  /** Fires in bursts this long, then pauses to let spread cool. */
  burstSeconds: number;
  pauseSeconds: number;
  /** Prefers ADS beyond this range. */
  adsRange: number;
  /** Refuses to fire beyond this range. */
  fireRange: number;
  /** Backs away from a threat closer than this. */
  standoffMin: number;
  /** Advances when every visible threat is farther than this. */
  standoffMax: number;
  /** Below this health fraction the bot fights while withdrawing. */
  retreatFraction: number;
  /** Grenade trigger: this many hostiles bunched inside `grenadeRange`. */
  grenadeRange: number;
  grenadeMinTargets: number;
  /** Fraction of the remaining aim error corrected per tick. */
  aimRate: number;
  /** Seconds before the strafe direction flips. */
  strafeSeconds: number;
}

export const DEFAULT_BOT: BotProfile = {
  burstSeconds: 1.5,
  pauseSeconds: 0.5,
  adsRange: 20,
  fireRange: 55,
  standoffMin: 11,
  standoffMax: 20,
  retreatFraction: 0.55,
  grenadeRange: 22,
  grenadeMinTargets: 3,
  aimRate: 1,
  strafeSeconds: 1.7,
};

/** Aim point: torso centre. Cheaper than head-hunting and connects more often. */
const AIM_HEIGHT = 1.25;
/** How far ahead the bot probes for geometry while moving, in metres. */
const PROBE_DISTANCE = 2.6;
/** Hostiles closer than this contribute to the "back off" pressure vector. */
const PRESSURE_RANGE = 26;
/** Nearest hostiles whose line of sight is resolved each tick (cost control). */
const LOS_CANDIDATES = 8;
/** Ticks a chosen detour around geometry is held before re-evaluating. */
const DETOUR_HOLD_TICKS = 40;

interface Threat {
  enemy: EnemyState;
  distance: number;
  hasLineOfSight: boolean;
}

interface MoveContext {
  profile: BotProfile;
  /** The hostile the bot is aiming at, or null when nothing is visible. */
  aimAt: Threat | null;
  retreating: boolean;
  strafeSign: number;
}

function wrap(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

export class ScriptedBot {
  private cycleTicks = 0;
  private tickCount = 0;
  private readonly profile: BotProfile;
  private readonly threats: Threat[] = [];
  /** Committed detour heading while walking around geometry, and its timer. */
  private seekX = 0;
  private seekZ = 0;
  private seekHoldTicks = 0;

  constructor(profile: Partial<BotProfile> = {}) {
    this.profile = { ...DEFAULT_BOT, ...profile };
  }

  reset(): void {
    this.cycleTicks = 0;
    this.tickCount = 0;
    this.seekHoldTicks = 0;
  }

  /** Line of sight from the player's eye to a hostile's torso. */
  private canSee(world: World, x: number, z: number): boolean {
    const origin = { x: world.player.pos.x, y: EYE_HEIGHT, z: world.player.pos.z };
    const dx = x - origin.x;
    const dy = AIM_HEIGHT - origin.y;
    const dz = z - origin.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const hit = world.colliders.raycast(
      origin,
      { x: dx / length, y: dy / length, z: dz / length },
      Math.max(0.5, length - 0.4),
    );
    return hit === null;
  }

  /** Live hostiles, nearest first, with line of sight resolved for each. */
  private scan(world: World): Threat[] {
    const player = world.player;
    const threats = this.threats;
    threats.length = 0;

    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      threats.push({
        enemy,
        distance: Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.z - player.pos.z),
        hasLineOfSight: false,
      });
    }
    threats.sort((a, b) => a.distance - b.distance);
    // Line-of-sight rays dominate the bot's cost, and only the nearest handful
    // can influence a decision — the rest are simply "somewhere out there".
    const limit = Math.min(threats.length, LOS_CANDIDATES);
    for (let i = 0; i < limit; i++) {
      const threat = threats[i]!;
      threat.hasLineOfSight = this.canSee(world, threat.enemy.pos.x, threat.enemy.pos.z);
    }
    return threats;
  }

  tick(world: World): BotDecision {
    const input = createInputState();
    const actions: string[] = [];
    const player = world.player;
    const { profile } = this;

    this.cycleTicks++;
    this.tickCount++;
    const cycleLength = Math.round((profile.burstSeconds + profile.pauseSeconds) * 60);
    const inBurst = this.cycleTicks % cycleLength < profile.burstSeconds * 60;

    const threats = this.scan(world);
    // Visible hostiles are what the bot fights; the nearest one wins.
    const target = threats.find((t) => t.hasLineOfSight) ?? null;
    const nearest = threats[0] ?? null;
    const aimAt = target ?? nearest;

    // ---- aim ---------------------------------------------------------------
    if (aimAt) {
      const desiredYaw = yawToPoint(world, aimAt.enemy.pos.x, aimAt.enemy.pos.z);
      const desiredPitch = Math.atan2(AIM_HEIGHT - EYE_HEIGHT, Math.max(0.6, aimAt.distance));
      input.dYaw = wrap(desiredYaw - player.aimYaw) * profile.aimRate;
      input.dPitch = (desiredPitch - player.aimPitch) * profile.aimRate;
    }

    // ---- movement ----------------------------------------------------------
    const strafePeriod = Math.max(1, Math.round(profile.strafeSeconds * 60));
    const strafeSign = Math.floor(this.tickCount / strafePeriod) % 2 === 0 ? 1 : -1;
    const move = moveDirection(world, threats, player.pos.x, player.pos.z, {
      profile,
      aimAt,
      retreating: player.health < player.maxHealth * profile.retreatFraction,
      strafeSign,
    });

    if (move) {
      toLocalInput(world, avoidGeometry(world, move.x, move.z), input);
    } else {
      // Nothing to fight: walk the objective.
      const zone = currentObjective(world)?.def.params.zone;
      if (zone) {
        const dx = zone.x - player.pos.x;
        const dz = zone.z - player.pos.z;
        const distance = Math.hypot(dx, dz);
        input.dYaw = wrap(yawToPoint(world, zone.x, zone.z) - player.aimYaw) * profile.aimRate;
        input.dPitch = -player.aimPitch * profile.aimRate;
        if (distance > zone.radius * 0.4) {
          toLocalInput(world, this.seek(world, dx / distance, dz / distance), input);
          input.sprinting = true;
        }
      }
    }

    // ---- trigger -----------------------------------------------------------
    if (target) {
      // Sprinting locks the weapon out, so a bot that wants to shoot stands up.
      input.sprinting = false;
      input.firing = inBurst && target.distance < profile.fireRange;
      input.aiming = target.distance > profile.adsRange;
    }

    // ---- grenades ----------------------------------------------------------
    if (
      player.grenades > 0 &&
      player.grenadeCooldownTicks <= 0 &&
      clusteredTargets(threats, profile) >= profile.grenadeMinTargets
    ) {
      actions.push('grenade');
    }

    // ---- sustain -----------------------------------------------------------
    const magazine = world.weaponDef.magazine;
    if (player.weapon.reserve > 0) {
      if (player.weapon.ammo <= 3) actions.push('reload');
      else if (player.weapon.ammo < magazine * 0.4 && target === null) actions.push('reload');
    }

    return { input, actions };
  }

  /**
   * Heading toward a goal that goes *around* geometry rather than into it.
   * The detour is held for a moment so the bot commits to one way round a
   * building instead of oscillating in front of it.
   */
  private seek(world: World, dirX: number, dirZ: number): { x: number; z: number } {
    if (this.seekHoldTicks > 0) {
      this.seekHoldTicks--;
      return { x: this.seekX, z: this.seekZ };
    }
    if (isClearDirection(world, dirX, dirZ)) return { x: dirX, z: dirZ };
    const detour = avoidGeometry(world, dirX, dirZ);
    this.seekX = detour.x;
    this.seekZ = detour.z;
    this.seekHoldTicks = DETOUR_HOLD_TICKS;
    return detour;
  }
}

/** World-space direction → the movement axes the player actually drives. */
function toLocalInput(world: World, dir: { x: number; z: number }, input: InputState): void {
  const sin = Math.sin(world.player.yaw);
  const cos = Math.cos(world.player.yaw);
  input.forward = clamp(-(dir.x * sin + dir.z * cos), -1, 1);
  input.right = clamp(dir.x * cos - dir.z * sin, -1, 1);
}

/** Hostiles bunched inside grenade range — worth a frag. */
function clusteredTargets(threats: Threat[], profile: BotProfile): number {
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const threat of threats) {
    if (threat.distance > profile.grenadeRange || !threat.hasLineOfSight) continue;
    count++;
    minX = Math.min(minX, threat.enemy.pos.x);
    maxX = Math.max(maxX, threat.enemy.pos.x);
    minZ = Math.min(minZ, threat.enemy.pos.z);
    maxZ = Math.max(maxZ, threat.enemy.pos.z);
  }
  return count > 0 && maxX - minX < 10 && maxZ - minZ < 10 ? count : 0;
}

/**
 * Pick a world-space movement direction: hold the standoff band, withdraw when
 * pressured, advance when everything is far away. Returns null to stand still.
 */
function moveDirection(
  _world: World,
  threats: Threat[],
  x: number,
  z: number,
  ctx: MoveContext,
): { x: number; z: number } | null {
  const { profile, aimAt } = ctx;
  if (threats.length === 0) return null;

  // Pressure vector: away from every hostile inside the pressure radius, so the
  // bot does not stand in the middle of a converging squad.
  let pressureX = 0;
  let pressureZ = 0;
  for (const threat of threats) {
    if (threat.distance > PRESSURE_RANGE) continue;
    const inv = 1 / Math.max(1.5, threat.distance);
    pressureX -= (threat.enemy.pos.x - x) * inv;
    pressureZ -= (threat.enemy.pos.z - z) * inv;
  }
  const pressureLength = Math.hypot(pressureX, pressureZ);
  if (pressureLength > 1e-6) {
    pressureX /= pressureLength;
    pressureZ /= pressureLength;
  }

  const nearest = threats[0]!;
  const tooClose = nearest.distance < profile.standoffMin;
  const withdrawing = ctx.retreating && nearest.distance < profile.standoffMax;

  if (tooClose || withdrawing) {
    if (pressureLength > 1e-6) return { x: pressureX, z: pressureZ };
    // Nothing to push away from (single hostile on top of us): back off directly.
    const dx = x - nearest.enemy.pos.x;
    const dz = z - nearest.enemy.pos.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }

  if (nearest.distance > profile.standoffMax) {
    if (!aimAt) return null;
    const dx = aimAt.enemy.pos.x - x;
    const dz = aimAt.enemy.pos.z - z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }

  // In the band: circle the nearest hostile, drifting with the pack pressure.
  const dx = nearest.enemy.pos.x - x;
  const dz = nearest.enemy.pos.z - z;
  const length = Math.hypot(dx, dz) || 1;
  const perpX = (-dz / length) * ctx.strafeSign;
  const perpZ = (dx / length) * ctx.strafeSign;
  const blend = pressureLength > 0.4 ? 0.45 : 0.15;
  const outX = perpX * (1 - blend) + pressureX * blend;
  const outZ = perpZ * (1 - blend) + pressureZ * blend;
  const outLength = Math.hypot(outX, outZ) || 1;
  return { x: outX / outLength, z: outZ / outLength };
}

/**
 * Steer around geometry instead of grinding into it: probe ahead and, when
 * blocked, rotate the desired direction until a clear one is found.
 */
function avoidGeometry(world: World, dirX: number, dirZ: number): { x: number; z: number } {
  if (isClearDirection(world, dirX, dirZ)) return { x: dirX, z: dirZ };
  const offsets = [0.6, -0.6, 1.2, -1.2, 2, -2, 2.8, -2.8, Math.PI];
  for (const angle of offsets) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = dirX * cos - dirZ * sin;
    const z = dirX * sin + dirZ * cos;
    if (isClearDirection(world, x, z)) return { x, z };
  }
  return { x: -dirX, z: -dirZ };
}

function isClearDirection(world: World, dirX: number, dirZ: number): boolean {
  const origin = { x: world.player.pos.x, y: EYE_HEIGHT, z: world.player.pos.z };
  return world.colliders.raycast(origin, { x: dirX, y: 0, z: dirZ }, PROBE_DISTANCE) === null;
}
