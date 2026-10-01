/**
 * Diagnostic: why does the run stall after the final wave?
 * Prints objective state, player position and hostile count.
 */
import { TICK_HZ } from '@iron/core';
import { aliveEnemyCount, createWorld, currentObjective, stepWorld } from '@iron/sim';
import { ScriptedBot } from '@iron/tools';

const seed = Number(process.argv[2] ?? 100);
const seconds = Number(process.argv[3] ?? 300);
const world = createWorld({ seed, missionId: 'm00_prologue', difficultyId: 'regular' });
const bot = new ScriptedBot();

for (let tick = 0; tick < seconds * TICK_HZ; tick++) {
  const { input, actions } = bot.tick(world);
  stepWorld(world, input, actions);
  if (tick % (20 * TICK_HZ) === 0 || (aliveEnemyCount(world) === 0 && tick % 30 === 0 && tick > 11500)) {
    const p = world.player;
    const obj = currentObjective(world);
    console.log(
      `t=${String(tick / TICK_HZ).padStart(3)}s wave=${world.wave} active=${world.wavesCleared} ` +
        `obj=${obj?.def.id}(${obj?.state}) alive=${aliveEnemyCount(world)} queue=${world.spawnQueue.length} ` +
        `pos=(${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)}) yaw=${p.yaw.toFixed(2)} ` +
        `fwd=${world.missionComplete ? 'COMPLETE' : world.missionFailed ? 'FAILED' : '-'} ` +
        `in=(f=${input.forward.toFixed(2)} r=${input.right.toFixed(2)} s=${input.sprinting ? 1 : 0}) ` +
        `vel=(${p.vel.x.toFixed(2)},${p.vel.z.toFixed(2)})`,
    );
  }
}
