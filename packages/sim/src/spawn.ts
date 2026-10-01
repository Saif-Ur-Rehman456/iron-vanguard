/**
 * Wave spawner — prototype parity.
 * parity: waves spawn staggered by 0.75 s + up to 0.4 s jitter, enter through one
 * of the four gates at +/-65, and the next wave starts 4.5 s after the previous
 * one is cleared. Wave completion counts only *living* enemies, which fixes the
 * prototype's 4.2 s dead air at every wave boundary (PARITY_NOTES #3).
 */
import { shuffle } from '@iron/core';
import { getEnemy, type EnemyArchetype, type WaveDef } from '@iron/content';
import { spawnEnemyState } from './ai';
import { onWaveComplete } from './mission';
import type { SpawnEntry, World } from './types';

const SPAWN_OFFSET = 65; // parity: enemies appear outside the walls
const JITTER_SECONDS = 0.4; // parity

/** Ticks the player waits before wave 1 begins (parity: 900 ms in startGame). */
export const MISSION_START_DELAY_TICKS = 54;

export function startWave(world: World, waveIndex: number): void {
  const wave: WaveDef | undefined = world.waves[waveIndex - 1];
  if (!wave) return;

  world.wave = waveIndex;
  world.waveActive = true;
  world.spawnQueue.length = 0;

  const list: EnemyArchetype[] = [];
  for (let i = 0; i < wave.composition.rifleman; i++) list.push('rifleman');
  for (let i = 0; i < wave.composition.rusher; i++) list.push('rusher');
  for (let i = 0; i < wave.composition.heavy; i++) list.push('heavy');
  shuffle(world.rng.spawn, list);

  const interval = wave.spawnIntervalSeconds * 60;
  for (let i = 0; i < list.length; i++) {
    const jitter = world.rng.spawn.range(0, JITTER_SECONDS) * 60;
    const entry: SpawnEntry = {
      type: list[i]!,
      dueTick: world.tick + Math.round(i * interval + jitter),
    };
    world.spawnQueue.push(entry);
  }

  world.events.push({
    type: 'waveStart',
    wave: waveIndex,
    label: wave.label,
    subtitle: wave.subtitle,
  });
  world.events.push({ type: 'banner', title: wave.label, subtitle: wave.subtitle, small: false });
}

function spawnEnemy(world: World, type: EnemyArchetype): void {
  const gate = world.map.gates[world.rng.spawn.int(0, world.map.gates.length)]!;
  const offset = world.rng.spawn.range(-2.5, 2.5); // parity
  let x = gate.x;
  let z = gate.z;
  if (gate.axis === 'x') {
    x += offset;
    z = z > 0 ? SPAWN_OFFSET : -SPAWN_OFFSET;
  } else {
    z += offset;
    x = x > 0 ? SPAWN_OFFSET : -SPAWN_OFFSET;
  }
  const def = getEnemy(type);
  world.enemies.push(spawnEnemyState(world, def, x, z));
  world.events.push({ type: 'audio', cue: 'enemy_radio', volume: 0.3 });
}

export function updateSpawner(world: World): void {
  // Intermission countdown (also covers the pre-mission delay before wave 1).
  if (!world.waveActive && !world.missionComplete && !world.missionFailed) {
    if (world.intermissionTicks > 0) {
      world.intermissionTicks--;
      if (world.intermissionTicks === 0) startWave(world, world.wave + 1);
    }
    return;
  }

  for (let i = world.spawnQueue.length - 1; i >= 0; i--) {
    const entry = world.spawnQueue[i]!;
    if (entry.dueTick <= world.tick) {
      world.spawnQueue.splice(i, 1);
      spawnEnemy(world, entry.type);
    }
  }

  const wave = world.wave;
  if (wave <= 0 || !world.waveActive) return;
  if (world.spawnQueue.length > 0) return;

  // Only living enemies gate the wave — corpses must never stall progression.
  for (const enemy of world.enemies) {
    if (enemy.alive) return;
  }

  world.waveActive = false;
  onWaveComplete(world, wave);
}
