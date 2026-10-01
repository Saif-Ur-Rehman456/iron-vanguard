/** Probe: how do hostiles behave while the player walks away from / toward them? */
import { TICK_HZ } from '@iron/core';
import { createInputState, createWorld, spawnEnemyState, stepWorld } from '@iron/sim';
import { getEnemy } from '@iron/content';

const forward = Number(process.argv[2] ?? 1);
const sprinting = process.argv[3] === 'sprint';
const world = createWorld({ seed: 1, missionId: 'm00_prologue', difficultyId: 'regular' });
world.intermissionTicks = Number.MAX_SAFE_INTEGER;
const enemy = spawnEnemyState(world, getEnemy('rifleman'), 0, 20);
world.enemies.push(enemy);

const input = createInputState();
input.forward = forward;
input.sprinting = sprinting;

let shots = 0;
let hits = 0;
for (let tick = 0; tick < 6 * TICK_HZ; tick++) {
  stepWorld(world, input);
  for (const event of world.events) {
    if (event.type === 'enemyShot') shots++;
    if (event.type === 'playerDamaged') hits++;
  }
  if (tick % (1 * TICK_HZ) === 0) {
    console.log(
      `t=${tick / TICK_HZ}s player=(${world.player.pos.x.toFixed(1)},${world.player.pos.z.toFixed(1)}) ` +
        `hp=${world.player.health.toFixed(0)} d=${enemy.distance.toFixed(1)} mode=${enemy.mode} ` +
        `los=${enemy.hasLineOfSight ? 1 : 0} target=(${enemy.moveTargetX.toFixed(1)},${enemy.moveTargetZ.toFixed(1)}) ` +
        `shots=${shots} hits=${hits}`,
    );
  }
}
