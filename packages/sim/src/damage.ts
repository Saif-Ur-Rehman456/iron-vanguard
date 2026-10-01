/**
 * Damage, death and explosion resolution.
 * parity: enemy kills give 100/120/250 points plus a 50 point headshot bonus,
 * combos chain inside 2.5 s, corpses clear after 4.2 s, explosions deal
 * `damage * (1 - distance / radius) + 30` to enemies and chain into barrels.
 */
import { clamp, TICK_DT, weightedIndex, type Vec3 } from '@iron/core';
import { PICKUPS } from '@iron/content';
import { onEnemyKilled } from './mission';
import type { EnemyState, World } from './types';

export const COMBO_WINDOW_SECONDS = 2.5; // parity
export const CORPSE_LIFETIME_SECONDS = 4.2; // parity
export const EXPLOSION_ENEMY_BONUS = 30; // parity
export const BARREL_CHAIN_DAMAGE = 90; // parity

export function damageEnemy(
  world: World,
  enemy: EnemyState,
  amount: number,
  head: boolean,
): void {
  if (!enemy.alive) return;
  enemy.health -= amount;
  enemy.flashT = 0.12; // parity: 120 ms hit flash
  world.events.push({ type: 'enemyDamaged', enemyId: enemy.id, head, damage: amount });
  world.events.push({
    type: 'audio',
    cue: enemy.def.audio.hurt,
    pos: { ...enemy.pos },
    volume: 0.7,
  });
  if (enemy.health <= 0) killEnemy(world, enemy, head);
}

export function killEnemy(world: World, enemy: EnemyState, head: boolean): void {
  if (!enemy.alive) return;
  enemy.alive = false;
  enemy.mode = 'dead';
  enemy.deathTicks = 0;
  enemy.health = 0;

  const p = world.player;
  p.kills++;
  let points = enemy.def.score;
  if (head) {
    p.headshots++;
    points += 50; // parity: headshot bonus
  }
  p.score += points;

  const sinceLastKill = (world.tick - p.lastKillTick) * TICK_DT;
  p.combo = sinceLastKill < COMBO_WINDOW_SECONDS ? p.combo + 1 : 1;
  p.lastKillTick = world.tick;

  world.events.push({
    type: 'enemyKilled',
    enemyId: enemy.id,
    archetype: enemy.archetype,
    displayName: enemy.def.displayName,
    head,
    score: points,
    combo: p.combo,
  });
  world.events.push({ type: 'audio', cue: enemy.def.audio.death, pos: { ...enemy.pos } });
  if (p.combo >= 2) {
    world.events.push({
      type: 'banner',
      title: `×${p.combo} MULTI-KILL`,
      subtitle: '',
      small: true,
    });
  }

  if (world.rng.loot.chance(enemy.def.dropChance)) spawnPickupDrop(world, enemy.pos);
  onEnemyKilled(world, enemy);
}

export function damagePlayer(world: World, amount: number, from: Vec3 | null): void {
  const p = world.player;
  if (!p.alive) return;
  p.health -= amount;
  p.lastDamageTick = world.tick;
  if (from) {
    const dx = from.x - p.pos.x;
    const dz = from.z - p.pos.z;
    p.damageIndicatorAngle = Math.atan2(dx, dz) * (180 / Math.PI) - p.yaw * (180 / Math.PI) + 180;
    p.damageIndicatorT = 1;
  }
  world.events.push({
    type: 'playerDamaged',
    amount,
    fromX: from?.x ?? p.pos.x,
    fromZ: from?.z ?? p.pos.z,
  });
  world.events.push({ type: 'audio', cue: 'player_hurt' });
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    world.missionFailed = true;
    world.events.push({ type: 'playerDied' });
    world.events.push({ type: 'missionFailed' });
  }
}

interface QueuedExplosion {
  pos: Vec3;
  radius: number;
  damage: number;
  hurtPlayer: boolean;
}

export function explode(
  world: World,
  pos: Vec3,
  radius: number,
  damage: number,
  hurtPlayer: boolean,
): void {
  const queue: QueuedExplosion[] = [{ pos: { ...pos }, radius, damage, hurtPlayer }];
  let guard = 0;

  while (queue.length > 0 && guard++ < 32) {
    const blast = queue.shift()!;
    world.events.push({ type: 'explosion', pos: { ...blast.pos }, radius: blast.radius, damage: blast.damage });
    world.events.push({
      type: 'audio',
      cue: 'explosion',
      pos: { ...blast.pos },
      volume: clamp(1 - distanceXZ(blast.pos, world.player.pos) / 70, 0.15, 1),
    });

    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const d = distanceXZ(enemy.pos, blast.pos);
      if (d < blast.radius) {
        const scaled = blast.damage * (1 - d / blast.radius) + EXPLOSION_ENEMY_BONUS; // parity
        damageEnemy(world, enemy, scaled, false);
      }
    }

    if (blast.hurtPlayer) {
      const d = distanceXZ(blast.pos, world.player.pos);
      if (d < blast.radius) {
        damagePlayer(world, blast.damage * (1 - d / blast.radius) * 0.8, blast.pos); // parity
      }
    }

    for (const barrel of world.barrels) {
      if (!barrel.alive) continue;
      const d = distanceXZ({ x: barrel.x, y: 0.6, z: barrel.z }, blast.pos);
      if (d < blast.radius * 1.15) {
        barrel.health -= BARREL_CHAIN_DAMAGE; // parity
        if (barrel.health <= 0) {
          barrel.alive = false;
          queue.push({ pos: { x: barrel.x, y: 1, z: barrel.z }, radius: 6, damage: 130, hurtPlayer: true });
        }
      }
    }
  }
}

export function spawnPickupDrop(world: World, pos: Vec3): void {
  const rng = world.rng.loot;
  const index = weightedIndex(rng, PICKUPS.map((p) => p.weight));
  const def = PICKUPS[index]!;
  world.pickups.push({
    id: world.nextEntityId++,
    kind: def.id,
    pos: { x: pos.x + rng.range(-0.6, 0.6), y: 0.2, z: pos.z + rng.range(-0.6, 0.6) },
    ageTicks: 0,
    alive: true,
  });
  world.events.push({
    type: 'audio',
    cue: 'pickup_drop',
    pos: { x: pos.x, y: 0.3, z: pos.z },
    volume: 0.4,
  });
}

export function updatePickups(world: World): void {
  const p = world.player;
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const pickup = world.pickups[i]!;
    if (!pickup.alive) {
      world.pickups.splice(i, 1);
      continue;
    }
    pickup.ageTicks++;
    const def = PICKUPS.find((d) => d.id === pickup.kind)!;
    if (pickup.ageTicks * TICK_DT > def.lifetimeSeconds) {
      pickup.alive = false;
      world.pickups.splice(i, 1);
      continue;
    }
    const dx = pickup.pos.x - p.pos.x;
    const dz = pickup.pos.z - p.pos.z;
    if (Math.hypot(dx, dz) <= def.pickupRadius) {
      if (pickup.kind === 'medkit') {
        p.health = Math.min(p.maxHealth, p.health + def.amount);
      } else {
        p.weapon.reserve = Math.min(world.weaponDef.reserveMax, p.weapon.reserve + def.amount);
      }
      world.events.push({ type: 'pickupCollected', kind: pickup.kind, amount: def.amount });
      world.events.push({ type: 'audio', cue: 'pickup_collect' });
      pickup.alive = false;
      world.pickups.splice(i, 1);
    }
  }
}

/** Async damage from enemy fire, applied when its scheduled tick arrives. */
export function updatePendingShots(world: World): void {
  for (let i = world.pendingShots.length - 1; i >= 0; i--) {
    const shot = world.pendingShots[i]!;
    if (shot.dueTick > world.tick) continue;
    world.pendingShots.splice(i, 1);
    if (world.player.alive) {
      damagePlayer(world, shot.amount, { x: shot.fromX, y: 1.2, z: shot.fromZ });
    }
  }
}

export function updateCorpses(world: World): void {
  const limit = Math.round(CORPSE_LIFETIME_SECONDS * 60);
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const enemy = world.enemies[i]!;
    if (enemy.alive) continue;
    enemy.deathTicks++;
    // Note: corpses are removed here but never gate wave completion — the
    // prototype delayed wave end by up to 4.2 s because of this (PARITY_NOTES #3).
    if (enemy.deathTicks > limit) world.enemies.splice(i, 1);
  }
}

export function aliveEnemyCount(world: World): number {
  let count = 0;
  for (const enemy of world.enemies) if (enemy.alive) count++;
  return count;
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
