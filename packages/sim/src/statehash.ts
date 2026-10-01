/**
 * Deterministic state hashing (ADR-0002).
 *
 * The golden tests record a hash per simulated second; any accidental gameplay
 * change moves the trace and forces a deliberate re-record. Only gameplay-visible
 * state is hashed — never particles, camera smoothing or audio.
 */
import { StateHasher, type RngStreams } from '@iron/core';
import type { World } from './types';

export function hashWorld(world: World): string {
  const h = new StateHasher();
  const p = world.player;

  h.push('tick', world.tick);
  h.pushVec('player.pos', p.pos);
  h.pushVec('player.vel', p.vel);
  h.push('player.yaw', p.yaw);
  h.push('player.pitch', p.pitch);
  h.push('player.health', p.health);
  h.push('player.alive', p.alive);
  h.push('player.ammo', p.weapon.ammo);
  h.push('player.reserve', p.weapon.reserve);
  h.push('player.grenades', p.grenades);
  h.push('player.shotsFired', p.shotsFired);
  h.push('player.shotsHit', p.shotsHit);
  h.push('player.kills', p.kills);
  h.push('player.headshots', p.headshots);
  h.push('player.score', p.score);
  h.push('player.combo', p.combo);

  // Enemies are hashed in id order so array churn cannot change the hash.
  const enemies = [...world.enemies].sort((a, b) => a.id - b.id);
  h.push('enemyCount', enemies.length);
  for (const enemy of enemies) {
    h.push('enemy.id', enemy.id);
    h.pushString('enemy.type', enemy.archetype);
    h.pushVec('enemy.pos', enemy.pos);
    h.push('enemy.yaw', enemy.yaw);
    h.push('enemy.health', enemy.health);
    h.push('enemy.alive', enemy.alive);
    h.pushString('enemy.mode', enemy.mode);
    h.push('enemy.shotsLeft', enemy.shotsLeft);
  }

  h.push('barrels', world.barrels.filter((b) => b.alive).length);
  h.push('pickupCount', world.pickups.length);
  for (const pickup of world.pickups) {
    h.push('pickup.kind', pickup.kind === 'medkit' ? 1 : 2);
    h.pushVec('pickup.pos', pickup.pos);
  }
  h.push('grenadeCount', world.grenades.length);
  h.push('pendingShots', world.pendingShots.length);
  h.push('spawnQueue', world.spawnQueue.length);
  h.push('wave', world.wave);
  h.push('waveActive', world.waveActive);
  h.push('intermissionTicks', world.intermissionTicks);
  h.push('wavesCleared', world.wavesCleared);
  h.push('missionComplete', world.missionComplete);
  h.push('missionFailed', world.missionFailed);
  for (const objective of world.objectives) {
    h.pushString('objective.id', objective.def.id);
    h.pushString('objective.state', objective.state);
    h.push('objective.progress', objective.progress);
  }

  return h.hex();
}

export interface HashSample {
  tick: number;
  hash: string;
}

export class HashTrace {
  readonly samples: HashSample[] = [];

  /** Sample once per simulated second (tick % 60 === 0). */
  maybeSample(world: World): void {
    if (world.tick % 60 !== 0) return;
    this.samples.push({ tick: world.tick, hash: hashWorld(world) });
  }

  get final(): string {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1]!.hash : '';
  }

  toLines(): string[] {
    return this.samples.map((s) => `${s.tick} ${s.hash}`);
  }
}

/** Fingerprint of the RNG streams, so a seed change is visible in reports. */
export function hashSeed(seed: number, streams: RngStreams): string {
  const h = new StateHasher();
  h.push('seed', seed);
  for (const [name, rng] of Object.entries(streams)) {
    h.pushString('stream', name);
    h.push('first', rng.next());
  }
  return h.hex();
}
