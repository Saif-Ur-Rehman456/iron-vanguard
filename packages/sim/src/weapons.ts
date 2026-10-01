/**
 * Weapon handling — prototype parity (legacy/PARITY_NOTES.md).
 * The prototype drove these from raw booleans and setTimeout; here everything is
 * tick-scheduled data so it can be replayed.
 */
import { clamp, TICK_DT, type Vec3 } from '@iron/core';
import { getWeapon } from '@iron/content';
import { damageAtDistance, hitGroupMultiplier, traceShot } from './ballistics';
import { damageEnemy, explode } from './damage';
import { MOVEMENT, playerEyeHeight } from './player';
import type { World } from './types';

const GRENADE = {
  speed: 16, // parity
  lift: 4.5, // parity
  gravity: 22, // parity
  drag: 0.4, // parity
  bounce: 0.35, // parity
  friction: 0.6, // parity
  fuseSeconds: 2.1, // parity
  radius: 7, // parity
  damage: 150, // parity
  cooldownTicks: 36, // parity: 0.6 s throw cooldown
  groundY: 0.09, // parity
} as const;

/** Are we in a state that permits firing? (parity: not reloading, not sprinting out) */
export function canFire(world: World): boolean {
  const p = world.player;
  // `equipTicks` is the one addition to the parity gate: a weapon that has just come
  // up must not fire on the tick it arrived, or a player can swap to the pistol and
  // get a shot off inside the equip animation.
  return p.alive && !p.reloading && p.equipTicks <= 0 && p.sprintK < 0.4 && p.sprintOutT <= 0;
}

/**
 * Select a loadout slot (1-based). No-op for the weapon already in hand.
 *
 * Deliberately small. It swaps the runtime the *existing* systems read (so aim,
 * spread, recoil, headshot multipliers, falloff, reload timing and audio all change
 * with it, because all of them are read from `world.weaponDef` and `p.weapon`), and
 * it plays the weapon's own equip time as a fire lockout. Anything more — per-weapon
 * handling quirks — belongs in a system, not here.
 *
 * The ammo is *not* reset: `p.loadout` holds one runtime per slot for the whole
 * mission, which is what makes a swap a weapon change rather than a reload.
 */
export function switchWeapon(world: World, slot: number): void {
  const p = world.player;
  if (!p.alive) return;
  const index = Math.round(slot) - 1;
  if (index < 0 || index >= p.loadout.length) return;
  if (p.slot === index + 1) return;
  const next = p.loadout[index]!;
  const def = getWeapon(next.defId);

  p.slot = index + 1;
  p.weapon = next;
  world.weaponDef = def;
  // A swap cancels a reload in progress (you cannot finish seating a magazine in a
  // weapon you have put down) and locks fire for the weapon's equip time. The heat
  // clears with the weapon: it is a property of the barrel, not of the soldier.
  p.reloading = false;
  p.reloadTicks = 0;
  p.heat = 0;
  p.equipTicks = Math.max(1, Math.round(def.handling.equipSeconds * 60));
  world.events.push({ type: 'weaponChanged', weaponId: def.id, slot: p.slot });
  world.events.push({ type: 'audio', cue: 'wpn_equip' });
}

/**
 * Current cone half-angle in radians.
 * parity: base 0.012 hip / 0.0025 ADS, movement adds up to 0.02 (0.007 when
 * aiming), heat adds 0.018 per unit, sprinting adds a flat 0.02.
 */
export function spreadNow(world: World): number {
  const p = world.player;
  const s = world.weaponDef.spread;
  const adsActive = p.adsT > 0.5;
  const base = adsActive ? s.ads : s.hip;
  const movement = clamp(p.speed / MOVEMENT.sprintSpeed, 0, 1);
  const movePenalty = adsActive ? s.movePenalty * 0.35 : s.movePenalty;
  const sprintPenalty = p.sprintK > 0.5 ? s.sprintPenalty : 0;
  return clamp(base + movement * movePenalty + p.heat * s.heatPenalty + sprintPenalty, 0, s.maxSpread);
}

function aimDirection(world: World, spread: number, out: Vec3, right: Vec3): Vec3 {
  const p = world.player;
  const cosPitch = Math.cos(p.pitch);
  const forwardX = -Math.sin(p.yaw) * cosPitch;
  const forwardY = Math.sin(p.pitch);
  const forwardZ = -Math.cos(p.yaw) * cosPitch;
  right.x = Math.cos(p.yaw);
  right.y = 0;
  right.z = -Math.sin(p.yaw);

  const rng = world.rng.ballistics;
  const jitterX = (rng.next() - 0.5) * 2 * spread;
  const jitterY = (rng.next() - 0.5) * 2 * spread;
  out.x = forwardX + right.x * jitterX;
  out.y = forwardY + jitterY;
  out.z = forwardZ + right.z * jitterX;
  const len = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  return out;
}

const dirTmp: Vec3 = { x: 0, y: 0, z: 0 };
const rightTmp: Vec3 = { x: 0, y: 0, z: 0 };
const originTmp: Vec3 = { x: 0, y: 0, z: 0 };

export function fireShot(world: World): void {
  const p = world.player;
  const def = world.weaponDef;
  if (p.weapon.ammo <= 0) {
    world.events.push({ type: 'dryFire' });
    world.events.push({ type: 'audio', cue: def.audio.dryFire });
    startReload(world);
    return;
  }

  p.weapon.ammo--;
  p.shotsFired++;
  p.heat = Math.min(1, p.heat + def.spread.heatPerShot);
  p.fireCooldownTicks = Math.max(1, Math.round(def.shotInterval * 60));

  const spread = spreadNow(world);
  aimDirection(world, spread, dirTmp, rightTmp);
  originTmp.x = p.pos.x;
  // The shot leaves the player's *eye*, stance included: crouching is lower and
  // jumping is higher, which is what makes both of them a decision (AGENTS.md 28).
  originTmp.y = playerEyeHeight(world);
  originTmp.z = p.pos.z;

  const hit = traceShot(world, originTmp, dirTmp, 300);
  const end: Vec3 = hit
    ? { x: hit.point.x, y: hit.point.y, z: hit.point.z }
    : {
        x: originTmp.x + dirTmp.x * 220,
        y: originTmp.y + dirTmp.y * 220,
        z: originTmp.z + dirTmp.z * 220,
      };

  world.events.push({
    type: 'shot',
    weaponId: def.id,
    origin: { x: originTmp.x, y: originTmp.y, z: originTmp.z },
    end,
    hit: hit !== null,
  });
  world.events.push({ type: 'audio', cue: def.audio.fire, pos: { ...originTmp }, volume: 1 });

  if (hit) {
    if (hit.enemy) {
      p.shotsHit++;
      // Range falloff first, then the hit-group multiplier. Forgetting the
      // second half left every headshot worth exactly a bodyshot, which quietly
      // deleted the skill expression the campaign is balanced around ("aim for
      // the head" is in the mission brief).
      const damage =
        damageAtDistance(def, def.damage, hit.distance) * hitGroupMultiplier(def, hit.head);
      damageEnemy(world, hit.enemy, damage, hit.head);
    } else if (hit.group === 'barrel') {
      const barrel = world.barrels.find((b) => -(b.id + 1) === hit.entityId);
      if (barrel && barrel.alive) {
        barrel.health -= def.damage;
        if (barrel.health <= 0) {
          explode(world, { x: barrel.x, y: 1, z: barrel.z }, 6, 130, true); // parity
        }
      }
      world.events.push({
        type: 'impact',
        point: hit.point,
        normal: hit.normal,
        surface: hit.surface,
        entityId: hit.entityId,
      });
    } else {
      world.events.push({
        type: 'impact',
        point: hit.point,
        normal: hit.normal,
        surface: hit.surface,
        entityId: 0,
      });
      world.events.push({
        type: 'audio',
        cue: `impact_${hit.surface}`,
        pos: { ...hit.point },
        volume: 0.6,
      });
    }
  }

  // Recoil (parity: pitch += .012 + random*.006, yaw jitter .007, both snap aim).
  const rng = world.rng.ballistics;
  p.pitch += def.recoil.pitch + rng.next() * 0.006;
  p.aimPitch = p.pitch;
  p.yaw += (rng.next() - 0.5) * (def.recoil.yaw * 2);
  p.aimYaw = p.yaw;
}

export function startReload(world: World): void {
  const p = world.player;
  const def = world.weaponDef;
  if (p.reloading || p.weapon.ammo >= def.magazine || p.weapon.reserve <= 0) return;
  p.reloading = true;
  p.reloadTicks = Math.round(def.reloadSeconds * 60);
  world.events.push({ type: 'reloadStarted' });
  // parity: three-stage reload audio at 0 / 45% / 80% of the animation
  const total = p.reloadTicks;
  world.events.push({ type: 'audio', cue: `${def.audio.reload}_01` });
  scheduleReloadCue(world, total, 0.45, `${def.audio.reload}_02`);
  scheduleReloadCue(world, total, 0.8, `${def.audio.reload}_03`);
}

function scheduleReloadCue(world: World, total: number, fraction: number, cue: string): void {
  world.pendingCues.push({ dueTick: world.tick + Math.round(total * fraction), cue });
}

/**
 * Reload cues are scheduled through a per-world queue instead of setTimeout, so
 * replay stays exact (the prototype used wall-clock timers — PARITY_NOTES #4).
 */
export function updateScheduledCues(world: World): void {
  for (let i = world.pendingCues.length - 1; i >= 0; i--) {
    const entry = world.pendingCues[i]!;
    if (entry.dueTick <= world.tick) {
      world.events.push({ type: 'audio', cue: entry.cue });
      world.pendingCues.splice(i, 1);
    }
  }
}

export function updateReload(world: World): void {
  const p = world.player;
  if (!p.reloading) return;
  p.reloadTicks--;
  if (p.reloadTicks > 0) return;
  const def = world.weaponDef;
  const need = def.magazine - p.weapon.ammo;
  const take = Math.min(need, p.weapon.reserve);
  p.weapon.ammo += take;
  p.weapon.reserve -= take;
  p.reloading = false;
  p.reloadTicks = 0;
  world.events.push({ type: 'reloadFinished' });
}

export function throwGrenade(world: World): void {
  const p = world.player;
  if (!p.alive || p.grenades <= 0 || p.grenadeCooldownTicks > 0) return;
  p.grenades--;
  p.grenadeCooldownTicks = GRENADE.cooldownTicks;
  aimDirection(world, 0, dirTmp, rightTmp);
  const id = world.nextEntityId++;
  world.grenades.push({
    id,
    pos: { x: p.pos.x + dirTmp.x * 0.5, y: 1.5, z: p.pos.z + dirTmp.z * 0.5 },
    vel: {
      x: dirTmp.x * GRENADE.speed,
      y: dirTmp.y * GRENADE.speed + GRENADE.lift,
      z: dirTmp.z * GRENADE.speed,
    },
    fuseTicks: Math.round(GRENADE.fuseSeconds * 60),
    alive: true,
    armTicks: 6,
  });
  world.events.push({ type: 'grenadeThrown' });
  world.events.push({ type: 'audio', cue: 'grenade_pin' });
}

export function updateGrenades(world: World): void {
  const dt = TICK_DT;
  for (let i = world.grenades.length - 1; i >= 0; i--) {
    const g = world.grenades[i]!;
    if (!g.alive) {
      world.grenades.splice(i, 1);
      continue;
    }
    g.vel.y -= GRENADE.gravity * dt;
    g.vel.x *= Math.max(0, 1 - GRENADE.drag * dt);
    g.vel.z *= Math.max(0, 1 - GRENADE.drag * dt);
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;

    if (g.pos.y < GRENADE.groundY) {
      g.pos.y = GRENADE.groundY;
      if (Math.abs(g.vel.y) > 1.5) world.events.push({ type: 'audio', cue: 'grenade_bounce', pos: { ...g.pos } });
      g.vel.y *= -GRENADE.bounce;
      g.vel.x *= GRENADE.friction;
      g.vel.z *= GRENADE.friction;
    }
    world.colliders.resolve(g.pos, 0.1);

    g.armTicks = Math.max(0, g.armTicks - 1);
    g.fuseTicks--;
    if (g.fuseTicks <= 0) {
      g.alive = false;
      explode(world, { x: g.pos.x, y: g.pos.y, z: g.pos.z }, GRENADE.radius, GRENADE.damage, true);
    }
  }
}
