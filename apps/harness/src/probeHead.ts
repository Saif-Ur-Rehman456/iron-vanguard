/** Probe: replicate the integration test's shot sequence exactly. */
import { createInputState, createWorld, spawnEnemyState, stepWorld } from '@iron/sim';
import { getEnemy } from '@iron/content';

const world = createWorld({ seed: 1, missionId: 'm00_prologue', difficultyId: 'regular' });
world.intermissionTicks = Number.MAX_SAFE_INTEGER;
const target = spawnEnemyState(world, getEnemy('rifleman'), 0, 6);
world.enemies.push(target);
target.health = 1_000_000;

const shoot = (aimY: number, z: number): number => {
  world.player.pos.x = 0;
  world.player.pos.z = z;
  world.player.yaw = 0;
  world.player.aimYaw = 0;
  world.player.pitch = Math.atan2(aimY - 1.7, Math.max(1, z - target.pos.z));
  world.player.aimPitch = world.player.pitch;
  world.player.fireCooldownTicks = 0;
  const before = target.health;
  stepWorld(world, { ...createInputState(), firing: true });
  const shots = world.events.filter((e) => e.type === 'shot').length;
  console.log(
    `aimY=${aimY} from z=${z} target=(${target.pos.x.toFixed(2)},${target.pos.z.toFixed(2)}) ` +
      `enemyYaw=${target.yaw.toFixed(3)} playerPitch=${world.player.pitch.toFixed(4)} ` +
      `shots=${shots} damage=${(before - target.health).toFixed(1)}`,
  );
  return before - target.health;
};

shoot(1.15, 16);
shoot(1.15, 26);
shoot(1.75, 16);
