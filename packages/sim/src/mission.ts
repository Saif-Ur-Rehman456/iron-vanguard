/**
 * Mission runner: turns objective data into runtime state.
 * Objective kinds are data-driven (eliminate / survive / reach / extract /
 * defend), so a new mission is an authoring task (docs/recipes/add-objective.md),
 * not an engine change.
 */
import { TICK_DT, type Vec3 } from '@iron/core';
import { rankFor, type MissionDef, type ObjectiveDef } from '@iron/content';
import type { MissionStats, ObjectiveRuntime, World } from './types';

/** Local copy so the mission runner never depends on the damage module (no cycles). */
function aliveEnemies(world: World): number {
  let count = 0;
  for (const enemy of world.enemies) if (enemy.alive) count++;
  return count;
}

export function createObjectives(mission: MissionDef): ObjectiveRuntime[] {
  return mission.objectives.map((def, index) => ({
    def,
    state: index === 0 ? 'active' : 'pending',
    progress: 0,
  }));
}

export function currentObjective(world: World): ObjectiveRuntime | null {
  return world.objectives[world.activeObjective] ?? null;
}

function completeObjective(world: World, runtime: ObjectiveRuntime): void {
  runtime.state = 'complete';
  world.events.push({
    type: 'objective',
    id: runtime.def.id,
    state: 'complete',
    label: runtime.def.label,
    hudText: runtime.def.hudText,
  });
  advanceObjective(world);
}

function advanceObjective(world: World): void {
  for (let i = world.activeObjective + 1; i < world.objectives.length; i++) {
    const next = world.objectives[i]!;
    if (next.state !== 'pending') continue;
    next.state = 'active';
    world.activeObjective = i;
    world.events.push({
      type: 'objective',
      id: next.def.id,
      state: 'active',
      label: next.def.label,
      hudText: next.def.hudText,
    });
    world.events.push({ type: 'banner', title: next.def.label, subtitle: next.def.hudText, small: false });
    return;
  }
  finishMission(world);
}

function finishMission(world: World): void {
  if (world.missionComplete) return;
  world.missionComplete = true;
  world.events.push({ type: 'missionComplete', stats: buildStats(world) });
}

/** Called by the spawner when a wave is cleared. Drives survive objectives and intermissions. */
export function onWaveComplete(world: World, wave: number): void {
  world.wavesCleared = Math.max(world.wavesCleared, wave);
  world.events.push({ type: 'waveComplete', wave });

  const total = world.waves.length;
  if (wave < total) {
    const next = world.waves[wave]!;
    world.intermissionTicks = Math.round(next.intermissionSeconds * 60);
    const mult = world.difficulty.resupplyMultiplier;
    const reserveGain = Math.round(120 * mult); // parity: +120 reserve
    const grenadeGain = Math.max(1, Math.round(1 * mult));
    world.player.weapon.reserve = Math.min(
      world.weaponDef.reserveMax,
      world.player.weapon.reserve + reserveGain,
    );
    world.player.grenades = Math.min(4, world.player.grenades + grenadeGain);
    world.events.push({ type: 'resupply', reserveAmmo: reserveGain, grenades: grenadeGain });
    world.events.push({
      type: 'banner',
      title: 'AREA SECURE',
      subtitle: `RESUPPLY: +${reserveGain} RND · +${grenadeGain} FRAG`,
      small: false,
    });
    if (world.mission.checkpoints.includes(wave)) {
      world.events.push({ type: 'checkpoint', wave });
    }
    return;
  }

  // Final wave cleared: hand control to the objective runner.
  const runtime = currentObjective(world);
  if (runtime && runtime.def.kind === 'survive') {
    runtime.progress = Math.max(runtime.progress, wave);
    if (runtime.progress >= (runtime.def.params.waves ?? total)) {
      completeObjective(world, runtime);
    }
  }
}

export function onEnemyKilled(world: World, enemy: { archetype: string }): void {
  const runtime = currentObjective(world);
  if (!runtime) return;
  const def: ObjectiveDef = runtime.def;
  if (def.kind !== 'eliminate' && def.kind !== 'destroy') return;
  if (def.params.archetype && def.params.archetype !== enemy.archetype) return;
  runtime.progress++;
  if (runtime.progress >= (def.params.count ?? 0)) completeObjective(world, runtime);
}

export function updateObjectives(world: World): void {
  const runtime = currentObjective(world);
  if (!runtime || runtime.state !== 'active') return;
  const def = runtime.def;
  const p = world.player;

  switch (def.kind) {
    case 'survive': {
      runtime.progress = Math.max(runtime.progress, world.wavesCleared);
      if (runtime.progress >= (def.params.waves ?? world.waves.length)) {
        completeObjective(world, runtime);
      }
      break;
    }
    case 'eliminate':
    case 'destroy':
      break;
    case 'reach':
    case 'extract':
    case 'defend': {
      const zone = def.params.zone;
      if (!zone) return;
      const inZone = distanceXZ({ x: p.pos.x, y: 0, z: p.pos.z }, { x: zone.x, y: 0, z: zone.z }) <= zone.radius;
      if (def.kind === 'defend') {
        if (inZone) {
          runtime.progress += TICK_DT;
          if (runtime.progress >= (def.params.holdSeconds ?? 30)) completeObjective(world, runtime);
        } else {
          runtime.progress = Math.max(0, runtime.progress - TICK_DT * 0.5);
        }
      } else if (inZone) {
        runtime.progress = 1;
        completeObjective(world, runtime);
      }
      break;
    }
    case 'escort':
      break;
  }
}

export function buildStats(world: World): MissionStats {
  const p = world.player;
  const accuracyPercent = p.shotsFired > 0 ? (p.shotsHit / p.shotsFired) * 100 : 0;
  return {
    kills: p.kills,
    headshots: p.headshots,
    shotsFired: p.shotsFired,
    shotsHit: p.shotsHit,
    score: p.score,
    accuracyPercent,
    elapsedTicks: world.tick,
    wavesCleared: world.wavesCleared,
  };
}

export function rankLabel(stats: MissionStats): string {
  return rankFor(stats.score, stats.accuracyPercent).id;
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Number of hostiles still to appear, for the HUD counter. */
export function hostilesRemaining(world: World): number {
  return world.spawnQueue.length + aliveEnemies(world);
}
