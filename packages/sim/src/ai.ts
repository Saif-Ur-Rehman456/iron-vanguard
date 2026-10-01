/**
 * Enemy archetypes and their state machines — prototype parity
 * (legacy/callr128: `createEnemy`, `updateEnemies`, `enemyFire`).
 *
 * Parity target: rifleman/heavy telegraph with a laser, then fire a burst whose
 * hit chance falls with distance and the player's speed; rushers close to melee
 * and lunge with a short damage window.
 *
 * Two deliberate differences from the prototype:
 *  - shots land on a scheduled tick instead of a 70 ms setTimeout (determinism);
 *  - all randomness comes from the named `ai`/`ballistics` RNG streams.
 */
import { clamp, TICK_DT, type Vec3, yawFromDirection } from '@iron/core';
import type { EnemyDef } from '@iron/content';
import { damagePlayer } from './damage';
import { playerEyeHeight } from './player';
import type { EnemyState, World } from './types';

const PERCEPTION_RANGE = 50; // parity: enemies only "see" you inside 50 m
const SEPARATION_DISTANCE = 2.2; // parity
const MELEE_BACKOFF_RANGE = 2; // parity
/** Ticks without progress before an agent decides it is wedged (0.75 s). */
const STUCK_TICKS = 45;

const eye: Vec3 = { x: 0, y: 0, z: 0 };
const target: Vec3 = { x: 0, y: 0, z: 0 };
const rayDir: Vec3 = { x: 0, y: 0, z: 0 };
const shotOrigin: Vec3 = { x: 0, y: 0, z: 0 };
const aimPoint: Vec3 = { x: 0, y: 0, z: 0 };

export function spawnEnemyState(
  world: World,
  def: EnemyDef,
  x: number,
  z: number,
): EnemyState {
  const hp = def.health * world.difficulty.enemyHealthMultiplier;
  return {
    id: world.nextEntityId++,
    archetype: def.id,
    def,
    pos: { x, y: 0, z },
    yaw: yawFromDirection(world.player.pos.x - x, world.player.pos.z - z),
    health: hp,
    maxHealth: hp,
    alive: true,
    mode: 'move',
    timer: 0,
    shotsLeft: 0,
    fireTimer: 0,
    cooldown: world.rng.ai.range(0.4, 1),
    moveTargetX: x,
    moveTargetZ: z,
    animPhase: world.rng.ai.range(0, 6),
    flashT: 0,
    lungeCooldown: 0,
    lungeHit: false,
    screamCooldown: 0,
    distance: 0,
    hasLineOfSight: false,
    spawnTick: world.tick,
    stuckTicks: 0,
    lastX: x,
    lastZ: z,
    noLosTicks: 0,
    unstickSign: 0,
    deathTicks: 0,
  };
}

function hasLineOfSight(world: World, from: Vec3, to: Vec3): boolean {
  rayDir.x = to.x - from.x;
  rayDir.y = to.y - from.y;
  rayDir.z = to.z - from.z;
  const length = Math.hypot(rayDir.x, rayDir.y, rayDir.z);
  if (length < 1e-6) return true;
  rayDir.x /= length;
  rayDir.y /= length;
  rayDir.z /= length;
  const hit = world.colliders.raycast(from, rayDir, Math.max(1, length - 0.5)); // parity
  return hit === null;
}

/** Offsets tried when the direct line to a target is blocked, in degrees. */
const AVOID_OFFSETS = [0, 35, -35, 70, -70, 110, -110, 145, -145, 180];

/**
 * Local steering with wall-following hysteresis.
 *
 * The prototype walked straight at its target and ground against anything in the
 * way (PARITY_NOTES #9). Probing ahead and picking a deflection — remembering
 * which side worked last so the agent commits to one way around an obstacle — is
 * what turns "stuck behind a building forever" into "flanks the building".
 * The full waypoint-graph navigation planned for M2 replaces this, but this keeps
 * M1 waves completable.
 */
const STEP_PROBE = 0.9;
const LOOKAHEAD_PROBE = 1.8;

function steerMove(
  world: World,
  enemy: EnemyState,
  tx: number,
  tz: number,
  speed: number,
  dt: number,
): void {
  const p = enemy.pos;
  const baseAngle = Math.atan2(tz - p.z, tx - p.x);
  const preferredSide = enemy.unstickSign >= 0 ? 1 : -1;
  const ordered = enemy.unstickSign === 0 ? AVOID_OFFSETS : sortBySide(AVOID_OFFSETS, preferredSide);

  // Two probes, because one is not enough. A single long probe accepts a
  // direction that is clear 1.8 m out but blocked by the very next step, which
  // is how agents used to wedge in the corner of a lamp post (PARITY_NOTES #9).
  // The first candidate that is clear immediately *and* clear ahead wins.
  let chosen = baseAngle;
  let fallback: number | null = null;
  for (const degrees of ordered) {
    const angle = baseAngle + (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (world.colliders.circleCollides(p.x + cos * STEP_PROBE, p.z + sin * STEP_PROBE, 0.55)) continue;
    if (fallback === null) fallback = angle;
    if (world.colliders.circleCollides(p.x + cos * LOOKAHEAD_PROBE, p.z + sin * LOOKAHEAD_PROBE, 0.55)) continue;
    chosen = angle;
    if (degrees !== 0) enemy.unstickSign = degrees > 0 ? 1 : -1;
    break;
  }
  if (chosen === baseAngle && fallback !== null) chosen = fallback;

  stepMove(world, enemy, Math.cos(chosen) * speed, Math.sin(chosen) * speed, dt);
}

function sortBySide(offsets: number[], side: number): number[] {
  return [...offsets].sort((a, b) => {
    const weight = (value: number): number =>
      value === 0 ? 0 : Math.sign(value) === side ? Math.abs(value) : 1000 + Math.abs(value);
    return weight(a) - weight(b);
  });
}

function stepMove(world: World, enemy: EnemyState, mx: number, mz: number, dt: number): void {
  const p = enemy.pos;
  const nx = p.x + mx * dt;
  const nz = p.z + mz * dt;
  const radius = 0.5; // parity
  if (!world.colliders.circleCollides(nx, nz, radius)) {
    p.x = nx;
    p.z = nz;
  } else if (!world.colliders.circleCollides(nx, p.z, radius)) {
    p.x = nx;
  } else if (!world.colliders.circleCollides(p.x, nz, radius)) {
    p.z = nz;
  }
  world.colliders.resolve(p, radius);
}

/**
 * Choose the next repositioning point.
 *
 * parity: a random point in the archetype's preferred band. Two fixes beyond
 * parity, both addressing PARITY_NOTES #9 (enemies wedging on cover forever):
 *  - candidates are scored, and a point with line of sight to the player is
 *    strongly preferred, so enemies press the attack instead of orbiting walls;
 *  - `aggressive` pulls the band toward the player when the enemy is stuck or has
 *    been blind for too long.
 */
function pickMovePoint(world: World, enemy: EnemyState, aggressive = false): void {
  const rng = world.rng.ai;
  const [min, max] = enemy.def.preferredRange;
  const band: [number, number] = aggressive ? [Math.max(2, min * 0.4), Math.max(4, min)] : [min, max];

  // The eye the enemy is looking for is the *player's* eye, stance included: a
  // crouched player drops below cover and a jumping one is briefly in the open
  // (AGENTS.md entry 28 — this line used to be the constant 1.7).
  const targetEye: Vec3 = {
    x: world.player.pos.x,
    y: playerEyeHeight(world),
    z: world.player.pos.z,
  };
  let bestX = enemy.pos.x;
  let bestZ = enemy.pos.z;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 8; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = rng.range(band[0], band[1]);
    let tx = world.player.pos.x + Math.cos(angle) * radius;
    let tz = world.player.pos.z + Math.sin(angle) * radius;
    tx = clamp(tx, world.map.bounds.minX + 4, world.map.bounds.maxX - 4);
    tz = clamp(tz, world.map.bounds.minZ + 4, world.map.bounds.maxZ - 4);
    if (world.colliders.circleCollides(tx, tz, 0.7)) continue;

    const eye: Vec3 = { x: tx, y: 1.6, z: tz };
    const sight = hasLineOfSight(world, eye, targetEye) ? 2 : 0;
    const travel = Math.hypot(tx - enemy.pos.x, tz - enemy.pos.z);
    const score = sight - travel * 0.05;
    if (score > bestScore) {
      bestScore = score;
      bestX = tx;
      bestZ = tz;
    }
  }

  enemy.moveTargetX = bestX;
  enemy.moveTargetZ = bestZ;
}

/**
 * Detect a body that is pushing into geometry and give it a way out, so a wave
 * can never stall behind a sandbag.
 */
function watchStuck(world: World, enemy: EnemyState, moving: boolean): void {
  const moved = Math.hypot(enemy.pos.x - enemy.lastX, enemy.pos.z - enemy.lastZ);
  enemy.lastX = enemy.pos.x;
  enemy.lastZ = enemy.pos.z;

  if (!moving || moved > 0.02) {
    enemy.stuckTicks = 0;
    return;
  }
  enemy.stuckTicks++;
  if (enemy.stuckTicks < STUCK_TICKS) return;
  enemy.stuckTicks = 0;
  // Flip the wall-following side and look for a better position to shoot from.
  enemy.unstickSign = -enemy.unstickSign || world.rng.ai.sign();
  if (enemy.archetype !== 'rusher') pickMovePoint(world, enemy, true);
}

/**
 * Chance that one hostile round connects.
 * parity: base accuracy at point blank, minus distance falloff, minus an
 * evasion term proportional to player speed, clamped to [0.07, 0.5].
 * Exported because balance work needs to reason about it without simulating.
 */
export function enemyHitChance(
  def: EnemyDef,
  accuracyMultiplier: number,
  distance: number,
  playerSpeed: number,
): number {
  const evade = def.burst.accuracyEvadePenalty * clamp(playerSpeed / 10.5, 0, 1);
  return clamp(
    def.burst.accuracyBase * accuracyMultiplier - distance * def.burst.accuracyFalloffPerMetre - evade,
    0.07,
    0.5,
  );
}

function enemyFire(world: World, enemy: EnemyState, distance: number): void {
  const def = enemy.def;
  const cos = Math.cos(enemy.yaw);
  const sin = Math.sin(enemy.yaw);
  // Gun tip: local (+0.22, 1.3, -0.62) rotated by yaw (parity).
  shotOrigin.x = enemy.pos.x + -sin * 0.62 + cos * 0.22;
  shotOrigin.y = 1.3;
  shotOrigin.z = enemy.pos.z + -cos * 0.62 + -sin * 0.22;

  const p = world.player;
  aimPoint.x = p.pos.x;
  aimPoint.y = playerEyeHeight(world); // the stance decides where a burst is aimed
  aimPoint.z = p.pos.z;

  const chance = enemyHitChance(
    def,
    world.difficulty.enemyAccuracyMultiplier,
    distance,
    p.speed,
  );

  const rng = world.rng.ballistics;
  const hit = rng.next() < chance;
  // A hit lands near the player; a miss sprays wide. The three draws happen in the
  // same order on both branches so the event stream stays deterministic.
  const missSpread = 0.5 + distance * 0.035; // parity
  const spreadXZ = hit ? 0.12 : missSpread;
  const minY = hit ? -0.1 : -missSpread * 0.5;
  const maxY = hit ? 0.1 : missSpread;
  const errorX = rng.range(-spreadXZ, spreadXZ);
  const errorY = rng.range(minY, maxY);
  const errorZ = rng.range(-spreadXZ, spreadXZ);

  world.events.push({
    type: 'enemyShot',
    enemyId: enemy.id,
    origin: { ...shotOrigin },
    end: { x: aimPoint.x + errorX, y: aimPoint.y + errorY, z: aimPoint.z + errorZ },
  });
  world.events.push({
    type: 'audio',
    cue: enemy.def.audio.fire,
    pos: { ...shotOrigin },
    volume: clamp(1 - distance / 60, 0.15, 1) * 0.5,
  });

  if (hit) {
    const amount =
      rng.range(def.burst.damageMin, def.burst.damageMax) *
      world.difficulty.enemyDamageMultiplier;
    world.pendingShots.push({
      dueTick: world.tick + def.burst.damageDelayTicks,
      amount,
      fromX: enemy.pos.x,
      fromZ: enemy.pos.z,
    });
  } else if (Math.hypot(errorX, errorY, errorZ) < 2.2) {
    world.events.push({ type: 'audio', cue: 'bullet_whiz', volume: 0.5 });
  }
}

export function updateEnemies(world: World): void {
  const dt = TICK_DT;
  const p = world.player;

  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;

    const dx = p.pos.x - enemy.pos.x;
    const dz = p.pos.z - enemy.pos.z;
    const distance = Math.max(0.001, Math.hypot(dx, dz));
    enemy.distance = distance;
    enemy.yaw = yawFromDirection(dx, dz); // parity: face the player every tick

    if (enemy.flashT > 0) enemy.flashT = Math.max(0, enemy.flashT - dt);
    enemy.cooldown -= dt;
    enemy.screamCooldown -= dt;

    eye.x = enemy.pos.x;
    eye.y = 1.6;
    eye.z = enemy.pos.z;
    target.x = p.pos.x;
    target.y = playerEyeHeight(world);
    target.z = p.pos.z;
    const los = distance < PERCEPTION_RANGE && hasLineOfSight(world, eye, target);
    enemy.hasLineOfSight = los;

    if (!los) enemy.noLosTicks++;
    else enemy.noLosTicks = 0;
    if (enemy.noLosTicks > 120 && enemy.mode === 'move') {
      // Blind for two seconds: press toward the player rather than wander.
      enemy.noLosTicks = 0;
      pickMovePoint(world, enemy, true);
    }

    if (enemy.archetype === 'rusher') {
      updateRusher(world, enemy, distance, dx, dz, dt);
    } else {
      updateRanged(world, enemy, distance, dx, dz, los, dt);
    }

    separateFromOthers(world, enemy, dt);
  }
}

function updateRusher(
  world: World,
  enemy: EnemyState,
  distance: number,
  dx: number,
  dz: number,
  dt: number,
): void {
  const melee = enemy.def.melee;
  if (!melee) return;

  if (enemy.mode === 'lunge') {
    enemy.timer -= dt;
    stepMove(world, enemy, (dx / distance) * melee.lungeSpeed, (dz / distance) * melee.lungeSpeed, dt);
    // parity: the melee damage window closes 0.14 s before the lunge ends
    if (enemy.timer <= 0.14 && !enemy.lungeHit) {
      enemy.lungeHit = true;
      if (distance < 2.1) {
        damagePlayer(world, melee.damage * world.difficulty.enemyDamageMultiplier, enemy.pos);
      }
    }
    if (enemy.timer <= 0) {
      enemy.mode = 'move';
      enemy.lungeCooldown = melee.cooldownSeconds;
    }
    return;
  }

  enemy.lungeCooldown -= dt;
  // A wedged rusher sidesteps for a moment instead of grinding on a corner.
  const wobble = Math.sin(world.tick * TICK_DT * 3 + enemy.animPhase) * 0.5;
  const targetX = enemy.pos.x + (dx / distance) * 12 + (-dz / distance) * wobble * 4;
  const targetZ = enemy.pos.z + (dz / distance) * 12 + (dx / distance) * wobble * 4;
  steerMove(world, enemy, targetX, targetZ, enemy.def.speed, dt);
  enemy.animPhase += dt * enemy.def.speed * 2.6;
  watchStuck(world, enemy, true);

  if (distance < 10 && enemy.screamCooldown <= 0) {
    enemy.screamCooldown = 3; // parity
    world.events.push({
      type: 'audio',
      cue: enemy.def.audio.alert,
      pos: { ...enemy.pos },
      volume: 0.8,
    });
  }
  if (distance < melee.range && enemy.lungeCooldown <= 0) {
    enemy.mode = 'lunge';
    enemy.timer = melee.lungeSeconds; // parity: 0.3 s
    enemy.lungeHit = false;
    world.events.push({ type: 'audio', cue: 'melee_lunge', pos: { ...enemy.pos }, volume: 0.7 });
  }
}

function updateRanged(
  world: World,
  enemy: EnemyState,
  distance: number,
  dx: number,
  dz: number,
  los: boolean,
  dt: number,
): void {
  const burst = enemy.def.burst;
  const rng = world.rng.ai;

  switch (enemy.mode) {
    case 'move': {
      const tx = enemy.moveTargetX - enemy.pos.x;
      const tz = enemy.moveTargetZ - enemy.pos.z;
      const td = Math.max(0.001, Math.hypot(tx, tz));
      const wobble = Math.sin(world.tick * TICK_DT * 2.2 + enemy.animPhase) * 0.45;
      steerMove(
        world,
        enemy,
        enemy.moveTargetX + (-tz / td) * wobble * 2,
        enemy.moveTargetZ + (tx / td) * wobble * 2,
        enemy.def.speed,
        dt,
      );
      enemy.animPhase += dt * enemy.def.speed * 2.6;
      watchStuck(world, enemy, true);

      const reached = td < 1.4;
      const wantsEngage =
        enemy.cooldown <= 0 && los && distance < burst.engageRange && rng.chance(dt * 1.2);
      // Only a hostile that can actually see the player may start a telegraph.
      // The mission brief promises that breaking line of sight stops the attack,
      // so a blind enemy keeps manoeuvring instead of firing at cover.
      if (!los) {
        if (reached) pickMovePoint(world, enemy);
        break;
      }
      if (reached || wantsEngage) {
        enemy.mode = 'aim';
        enemy.timer = burst.telegraphSeconds; // parity: 0.45 s laser telegraph
        world.events.push({ type: 'audio', cue: 'enemy_aim', pos: { ...enemy.pos }, volume: 0.3 });
      }
      break;
    }
    case 'aim': {
      enemy.timer -= dt;
      if (enemy.timer <= 0) {
        if (!los) {
          // The player broke the line during the telegraph: abort and reposition.
          enemy.mode = 'move';
          enemy.cooldown = rng.range(burst.cooldownMin, burst.cooldownMax);
          pickMovePoint(world, enemy);
          break;
        }
        enemy.mode = 'burst';
        enemy.shotsLeft = rng.int(burst.burstMin, burst.burstMax + 1);
        enemy.fireTimer = 0.05; // parity
      }
      break;
    }
    case 'burst': {
      enemy.fireTimer -= dt;
      if (enemy.fireTimer <= 0) {
        if (!los) {
          // Cover breaks the burst: rounds already in flight still land (parity:
          // the 70 ms damage delay), but no new ones leave the barrel.
          enemy.mode = 'move';
          enemy.cooldown = rng.range(burst.cooldownMin, burst.cooldownMax);
          pickMovePoint(world, enemy);
          break;
        }
        enemyFire(world, enemy, distance);
        enemy.shotsLeft--;
        enemy.fireTimer = burst.shotInterval;
        if (enemy.shotsLeft <= 0) {
          enemy.mode = 'move';
          enemy.cooldown = rng.range(burst.cooldownMin, burst.cooldownMax);
          pickMovePoint(world, enemy);
        }
      }
      break;
    }
    case 'lunge':
      enemy.mode = 'move';
      break;
    case 'dead':
      break;
  }

  if (distance < MELEE_BACKOFF_RANGE && enemy.mode === 'move') {
    stepMove(world, enemy, (-dx / distance) * 2, (-dz / distance) * 2, dt);
  }
}

function separateFromOthers(world: World, enemy: EnemyState, dt: number): void {
  for (const other of world.enemies) {
    if (other === enemy || !other.alive) continue;
    const sx = enemy.pos.x - other.pos.x;
    const sz = enemy.pos.z - other.pos.z;
    const d2 = sx * sx + sz * sz;
    if (d2 < SEPARATION_DISTANCE && d2 > 0.001) {
      const d = Math.sqrt(d2);
      enemy.pos.x += (sx / d) * dt * 1.5; // parity
      enemy.pos.z += (sz / d) * dt * 1.5;
    }
  }
}
