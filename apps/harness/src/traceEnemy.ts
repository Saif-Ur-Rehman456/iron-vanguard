/** Trace one enemy's position and mode per second, to diagnose a wedge. */
import { TICK_HZ } from '@iron/core';
import { createWorld, stepWorld } from '@iron/sim';
import { ScriptedBot } from '@iron/tools';

const seed = Number(process.argv[2] ?? 185);
const seconds = Number(process.argv[3] ?? 400);
const everySeconds = Number(process.argv[4] ?? 1);
const world = createWorld({ seed, missionId: 'm00_prologue', difficultyId: 'regular' });
const bot = new ScriptedBot();

for (let tick = 0; tick < seconds * TICK_HZ; tick++) {
  const { input, actions } = bot.tick(world);
  stepWorld(world, input, actions);
  if (tick % (everySeconds * TICK_HZ) !== 0) continue;
  const alive = world.enemies.filter((e) => e.alive);
  if (alive.length === 0 || alive.length > 2) continue;
  const p = world.player;
  for (const e of alive) {
    console.log(
      `t=${String(tick / TICK_HZ).padStart(3)}s player=(${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)}) ` +
        `${e.archetype}#${e.id} pos=(${e.pos.x.toFixed(2)},${e.pos.z.toFixed(2)}) mode=${e.mode} ` +
        `target=(${e.moveTargetX.toFixed(1)},${e.moveTargetZ.toFixed(1)}) stuck=${e.stuckTicks} ` +
        `sign=${e.unstickSign} los=${e.hasLineOfSight ? 1 : 0} d=${e.distance.toFixed(1)}`,
    );
  }
}
