/**
 * Diagnostic: why is the bot not engaging? Prints enemy position, distance,
 * mode and line of sight every 10 simulated seconds.
 */
import { TICK_HZ } from '@iron/core';
import { createWorld, stepWorld } from '@iron/sim';
import { ScriptedBot } from '@iron/tools';

const world = createWorld({ seed: Number(process.argv[2] ?? 7), missionId: 'm00_prologue', difficultyId: 'regular' });
const bot = new ScriptedBot();
const seconds = Number(process.argv[3] ?? 120);

for (let tick = 0; tick < seconds * TICK_HZ; tick++) {
  const { input, actions } = bot.tick(world);
  stepWorld(world, input, actions);

  if (tick % (10 * TICK_HZ) === 0) {
    const p = world.player;
    const enemies = world.enemies
      .filter((e) => e.alive)
      .map((e) => {
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        return `${e.archetype[0]}${e.id}@(${e.pos.x.toFixed(0)},${e.pos.z.toFixed(0)}) d=${d.toFixed(0)} m=${e.mode} los=${e.hasLineOfSight ? 1 : 0}`;
      })
      .join('  ');
    console.log(
      `t=${String(tick / TICK_HZ).padStart(3)}s  wave=${world.wave}  queue=${world.spawnQueue.length}  ` +
        `player=(${p.pos.x.toFixed(0)},${p.pos.z.toFixed(0)})  hp=${p.health.toFixed(0)}  ammo=${p.weapon.ammo}/${p.weapon.reserve}  ` +
        `kills=${p.kills}  shots=${p.shotsFired}/${p.shotsHit}\n    ${enemies || '(none alive)'}`,
    );
  }
}
