/**
 * Shared test helpers.
 *
 * The important idea here is `quietWorld`: most unit tests want to study one
 * system, not fight the wave spawner. Pushing the intermission far into the
 * future gives a world where only the thing under test happens.
 */
import { createInputState, createWorld, spawnEnemyState, stepWorld, type World } from '@iron/sim';
import { getEnemy, type EnemyArchetype } from '@iron/content';

export interface QuietWorldOptions {
  seed?: number;
  difficultyId?: string;
  /** Place the player before simulating. */
  playerAt?: { x: number; z: number };
}

export function quietWorld(options: QuietWorldOptions = {}): World {
  const world = createWorld({
    seed: options.seed ?? 1,
    missionId: 'm00_prologue',
    difficultyId: options.difficultyId ?? 'regular',
  });
  // No waves for the duration of the test.
  world.intermissionTicks = Number.MAX_SAFE_INTEGER;
  if (options.playerAt) {
    world.player.pos.x = options.playerAt.x;
    world.player.pos.z = options.playerAt.z;
  }
  return world;
}

/** Place an archetype at an exact position and return it. */
export function placeEnemy(world: World, archetype: EnemyArchetype, x: number, z: number) {
  const enemy = spawnEnemyState(world, getEnemy(archetype), x, z);
  world.enemies.push(enemy);
  return enemy;
}

/** Run the world forward with no player input. */
export function idle(world: World, ticks: number): void {
  const input = createInputState();
  for (let i = 0; i < ticks; i++) stepWorld(world, input);
}

export function distanceToPlayer(world: World, x: number, z: number): number {
  return Math.hypot(x - world.player.pos.x, z - world.player.pos.z);
}
