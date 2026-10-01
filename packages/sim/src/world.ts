/**
 * World construction and the canonical tick order (ADR-0002).
 *
 * Keeping the order in exactly one place is what makes replays trustworthy:
 * any system inserted here changes the golden hashes on purpose, not by accident.
 */
import { createRngStreams, TICK_DT } from '@iron/core';
import {
  getDifficulty,
  getMap,
  getMission,
  getWeapon,
  LOADOUT,
  propsOfKind,
} from '@iron/content';
import { updateEnemies } from './ai';
import { createAabbCollisionWorld } from './collision';
import type { InputState } from './commands';
import { updateCorpses, updatePendingShots, updatePickups } from './damage';
import { createObjectives, updateObjectives } from './mission';
import { EYE_HEIGHT, tryJump, updatePlayer } from './player';
import { MISSION_START_DELAY_TICKS, updateSpawner } from './spawn';
import type { BarrelState, PlayerState, World, WorldConfig } from './types';
import {
  canFire,
  fireShot,
  startReload,
  switchWeapon,
  throwGrenade,
  updateGrenades,
  updateReload,
  updateScheduledCues,
} from './weapons';

/** parity: startGame() grants 240 reserve rounds. */
export const STARTING_RESERVE = 240;
export const BARREL_HEALTH = 30; // parity

export function createPlayerState(worldish: {
  missionId: string;
  difficultyId: string;
}): PlayerState {
  const mission = getMission(worldish.missionId);
  const difficulty = getDifficulty(worldish.difficultyId);
  const map = getMap(mission.mapId);
  const weapon = getWeapon(mission.startingWeapon);

  /**
   * The loadout, as runtimes.
   *
   * The mission's own weapon keeps the prototype's 240-round reserve (parity), and
   * the others get their magazine count times their carried-magazine factor — which
   * is how a loadout reads: a pistol carries three magazines of seven, not a
   * rifleman's basic load. Writing this out is also why the golden trace is
   * unaffected: slot 2 is the M4 with the same ammo and reserve it always had, and a
   * replay that never presses 1 or 3 never touches the other two entries.
   */
  const loadout = LOADOUT.map((id, index) => {
    const def = getWeapon(id);
    const isMissionWeapon = def.id === mission.startingWeapon;
    void index;
    return {
      defId: def.id,
      ammo: def.magazine,
      reserve: isMissionWeapon
        ? STARTING_RESERVE
        : Math.min(def.reserveMax, def.magazine * def.viewModel.magazineReserve),
    };
  });
  // Slot 2 unless the mission's weapon says otherwise: the loadout table is content,
  // and the mission opens on the rifle it names.
  const openingSlot = Math.max(
    1,
    Math.min(loadout.length, loadout.findIndex((entry) => entry.defId === weapon.id) + 1),
  );

  return {
    pos: { x: map.playerSpawn.x, y: 0, z: map.playerSpawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: map.playerSpawn.yaw,
    pitch: 0,
    aimYaw: map.playerSpawn.yaw,
    aimPitch: 0,
    health: difficulty.playerHealth,
    maxHealth: difficulty.playerHealth,
    alive: true,
    adsT: 0,
    crouchK: 0,
    crouching: false,
    eyeHeight: EYE_HEIGHT,
    grounded: true,
    airTicks: 0,
    landT: 0,
    sprintK: 0,
    sprintOutT: 0,
    aiming: false,
    sprinting: false,
    speed: 0,
    bobPhase: 0,
    heat: 0,
    weapon: loadout[openingSlot - 1] ?? loadout[0]!,
    loadout,
    slot: openingSlot,
    equipTicks: 0,
    reloading: false,
    reloadTicks: 0,
    fireCooldownTicks: 0,
    grenades: mission.startingGrenades,
    grenadeCooldownTicks: 0,
    lastDamageTick: -9999,
    damageIndicatorT: 0,
    damageIndicatorAngle: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    kills: 0,
    score: 0,
    combo: 0,
    lastKillTick: -9999,
  };
}

export function createWorld(config: WorldConfig): World {
  const mission = getMission(config.missionId);
  const difficulty = getDifficulty(config.difficultyId);
  const map = getMap(mission.mapId);
  const weaponDef = getWeapon(mission.startingWeapon);

  const barrels: BarrelState[] = propsOfKind(map, 'barrel').map((prop, index) => ({
    id: index,
    x: prop.x,
    z: prop.z,
    variant: prop.variant ?? 0,
    health: BARREL_HEALTH,
    alive: true,
  }));

  const player = createPlayerState({
    missionId: config.missionId,
    difficultyId: config.difficultyId,
  });

  return {
    config,
    mission,
    map,
    difficulty,
    weaponDef,
    waves: mission.waves,
    rng: createRngStreams(config.seed),
    colliders: createAabbCollisionWorld(map),
    tick: 0,
    player,
    enemies: [],
    pickups: [],
    grenades: [],
    barrels,
    spawnQueue: [],
    pendingShots: [],
    wave: 0,
    waveActive: false,
    intermissionTicks: MISSION_START_DELAY_TICKS,
    objectives: createObjectives(mission),
    activeObjective: 0,
    missionComplete: false,
    missionFailed: false,
    stats: {
      kills: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      score: 0,
      accuracyPercent: 0,
      elapsedTicks: 0,
      wavesCleared: 0,
    },
    events: [],
    pendingCues: [],
    nextEntityId: 1,
    wavesCleared: 0,
  };
}

/** Simulated seconds since mission start (never the wall clock). */
export function simTime(world: World): number {
  return world.tick * TICK_DT;
}

/** Reset an existing world in place so the renderer can keep its objects. */
export function resetWorld(world: World): void {
  const fresh = createWorld(world.config);
  const keepRngSeed = fresh.config.seed;
  world.tick = 0;
  world.rng = createRngStreams(keepRngSeed);
  world.player = fresh.player;
  world.enemies.length = 0;
  world.pickups.length = 0;
  world.grenades.length = 0;
  world.spawnQueue.length = 0;
  world.pendingShots.length = 0;
  world.pendingCues.length = 0;
  world.barrels.length = 0;
  world.barrels.push(...fresh.barrels);
  world.wave = 0;
  world.waveActive = false;
  world.intermissionTicks = MISSION_START_DELAY_TICKS;
  world.objectives = fresh.objectives;
  world.activeObjective = 0;
  world.missionComplete = false;
  world.missionFailed = false;
  world.wavesCleared = 0;
  world.stats = fresh.stats;
  world.events.length = 0;
  world.nextEntityId = 1;
}

export function stepWorld(world: World, input: InputState, actions: readonly string[] = []): void {
  world.events.length = 0;

  updatePlayer(world, input);

  for (const action of actions) {
    if (action === 'reload') startReload(world);
    else if (action === 'grenade') throwGrenade(world);
    // `jump` was declared in `commands.ts` and consumed by nobody: Space queued an
    // action that no system read, so the player could not leave the ground at all
    // (AGENTS.md entry 28). It is an action rather than a system on purpose — the
    // canonical tick order is untouched (AGENTS.md invariant 2).
    else if (action === 'jump') tryJump(world);
    // Weapon selection is an action, not a system: it changes which weapon the
    // *existing* systems read, so the canonical order is untouched (AGENTS.md
    // invariant 2) and a replay of a loadout swap is exactly as reproducible as a
    // replay of a shot.
    else if (action === 'weapon1') switchWeapon(world, 1);
    else if (action === 'weapon2') switchWeapon(world, 2);
    else if (action === 'weapon3') switchWeapon(world, 3);
  }

  if (input.firing && canFire(world) && world.player.fireCooldownTicks <= 0) {
    fireShot(world);
  }

  updateReload(world);
  updateScheduledCues(world);
  updateGrenades(world);
  updateEnemies(world);
  updatePendingShots(world);
  updatePickups(world);
  updateCorpses(world);
  updateSpawner(world);
  updateObjectives(world);

  world.tick++;
  world.stats = {
    kills: world.player.kills,
    headshots: world.player.headshots,
    shotsFired: world.player.shotsFired,
    shotsHit: world.player.shotsHit,
    score: world.player.score,
    accuracyPercent:
      world.player.shotsFired > 0 ? (world.player.shotsHit / world.player.shotsFired) * 100 : 0,
    elapsedTicks: world.tick,
    wavesCleared: world.wavesCleared,
  };
}
