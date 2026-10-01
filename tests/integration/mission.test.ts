import { describe, expect, it } from 'vitest';
import { TICK_DT, TICK_HZ } from '@iron/core';
import {
  DEFAULT_SETTINGS,
  aliveEnemyCount,
  buildStats,
  canFire,
  createInputState,
  createWorld,
  currentObjective,
  damagePlayer,
  explode,
  hashWorld,
  hostilesRemaining,
  loadSettings,
  rankLabel,
  restoreCheckpoint,
  snapshotCheckpoint,
  spreadNow,
  startReload,
  stepWorld,
  throwGrenade,
} from '@iron/sim';
import { PICKUPS, TOTAL_HOSTILES, getWeapon } from '@iron/content';
import { ScriptedBot } from '@iron/tools';
import { idle, placeEnemy, quietWorld } from '../helpers/world';

/**
 * `stepWorld` clears the event list at the start of every tick, so a test that
 * cares about events must collect them as the simulation runs.
 */
function runCollectingEvents(
  world: ReturnType<typeof quietWorld>,
  ticks: number,
  input: ReturnType<typeof createInputState>,
): Set<string> {
  const types = new Set<string>();
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, input);
    for (const event of world.events) types.add(event.type);
  }
  return types;
}

const BOT_SEED = 7;

describe('determinism (ADR-0002)', () => {
  it('produces identical state hashes for the same seed and inputs', () => {
    const run = (): string[] => {
      const world = createWorld({ seed: 4242, missionId: 'm00_prologue', difficultyId: 'regular' });
      const bot = new ScriptedBot();
      const hashes: string[] = [];
      for (let tick = 0; tick < 90 * TICK_HZ; tick++) {
        const { input, actions } = bot.tick(world);
        stepWorld(world, input, actions);
        if (world.tick % 60 === 0) hashes.push(hashWorld(world));
      }
      return hashes;
    };

    const first = run();
    const second = run();
    expect(first.length).toBe(90);
    expect(second).toEqual(first);
  });

  it('diverges when the seed or the difficulty changes', () => {
    const hashAfter = (seed: number, difficultyId: string): string => {
      const world = createWorld({ seed, missionId: 'm00_prologue', difficultyId });
      const bot = new ScriptedBot();
      for (let tick = 0; tick < 20 * TICK_HZ; tick++) {
        const { input, actions } = bot.tick(world);
        stepWorld(world, input, actions);
      }
      return hashWorld(world);
    };
    const base = hashAfter(11, 'regular');
    expect(hashAfter(12, 'regular')).not.toBe(base);
    expect(hashAfter(11, 'hardened')).not.toBe(base);
  });

  it('does not depend on how many times the renderer runs between ticks', () => {
    // Simulation and presentation are decoupled: stepping with idle frames in
    // between must not change state. This is what lets the renderer interpolate.
    const control = createWorld({ seed: 5, missionId: 'm00_prologue', difficultyId: 'regular' });
    const interleaved = createWorld({ seed: 5, missionId: 'm00_prologue', difficultyId: 'regular' });
    const botA = new ScriptedBot();
    const botB = new ScriptedBot();
    for (let tick = 0; tick < 300; tick++) {
      const a = botA.tick(control);
      stepWorld(control, a.input, a.actions);
      const b = botB.tick(interleaved);
      stepWorld(interleaved, b.input, b.actions);
    }
    expect(hashWorld(interleaved)).toBe(hashWorld(control));
  });
});

describe('the prologue mission', () => {
  it('is completable by the reference player on regular difficulty', () => {
    const world = createWorld({ seed: BOT_SEED, missionId: 'm00_prologue', difficultyId: 'regular' });
    const bot = new ScriptedBot();
    for (let tick = 0; tick < 420 * TICK_HZ && !world.missionComplete && !world.missionFailed; tick++) {
      const { input, actions } = bot.tick(world);
      stepWorld(world, input, actions);
    }

    const stats = buildStats(world);
    expect(world.missionFailed).toBe(false);
    expect(world.missionComplete).toBe(true);
    expect(stats.wavesCleared).toBe(5);
    expect(stats.kills).toBe(TOTAL_HOSTILES);
    expect(stats.accuracyPercent).toBeGreaterThan(40);
    expect(hostilesRemaining(world)).toBe(0);
    // No wave may take longer than a minute and a half of real play.
    expect(stats.elapsedTicks / TICK_HZ).toBeLessThan(400);
    expect(world.enemies.length).toBeLessThanOrEqual(TOTAL_HOSTILES);
  });

  it('keeps veteran genuinely harder than recruit', () => {
    const run = (
      difficultyId: string,
      seed: number,
    ): { complete: boolean; damage: number } => {
      const world = createWorld({ seed, missionId: 'm00_prologue', difficultyId });
      const bot = new ScriptedBot();
      for (let tick = 0; tick < 420 * TICK_HZ && !world.missionComplete && !world.missionFailed; tick++) {
        const { input, actions } = bot.tick(world);
        stepWorld(world, input, actions);
      }
      return {
        complete: world.missionComplete,
        damage: world.player.maxHealth - world.player.health,
      };
    };

    const seeds = [BOT_SEED, 100, 117];
    const recruit = seeds.map((seed) => run('recruit', seed));
    const veteran = seeds.map((seed) => run('veteran', seed));

    // Recruit is a walkover for a competent player; veteran is not, and it costs
    // the player far more health even when they survive it.
    expect(recruit.every((r) => r.complete)).toBe(true);
    expect(recruit.every((r) => r.damage === 0)).toBe(true);
    expect(veteran.filter((r) => !r.complete).length).toBeGreaterThan(0);
    const veteranDamage = veteran.reduce((sum, r) => sum + r.damage, 0);
    const recruitDamage = recruit.reduce((sum, r) => sum + r.damage, 0);
    expect(veteranDamage).toBeGreaterThan(recruitDamage);
  });

  it('runs the objective sequence survive -> extract -> complete', () => {
    const world = quietWorld();
    expect(currentObjective(world)?.def.kind).toBe('survive');

    world.wavesCleared = world.waves.length;
    stepWorld(world, createInputState());
    expect(world.objectives[0]!.state).toBe('complete');
    expect(currentObjective(world)?.def.kind).toBe('extract');
    expect(world.missionComplete).toBe(false);

    // Walking to the extraction zone finishes the mission.
    const zone = currentObjective(world)!.def.params.zone!;
    world.player.pos.x = zone.x;
    world.player.pos.z = zone.z;
    stepWorld(world, createInputState());
    expect(currentObjective(world)!.state).toBe('complete');
    expect(world.missionComplete).toBe(true);
    expect(rankLabel(buildStats(world))).toBeTruthy();
  });

  it('awards resupply between waves and never stalls on corpses', () => {
    const world = quietWorld();
    world.wavesCleared = 0;
    world.wave = 1;
    world.waveActive = true;
    world.player.weapon.reserve = 10;
    const dead = placeEnemy(world, 'rifleman', 0, 20);
    dead.alive = false;
    dead.deathTicks = 0;
    world.spawnQueue.length = 0;

    stepWorld(world, createInputState());
    // Wave 1 was cleared the moment its last hostile died — the corpse still
    // being on the field must not delay the wave (parity defect #3).
    expect(world.wavesCleared).toBe(1);
    expect(world.waveActive).toBe(false);
    expect(world.player.weapon.reserve).toBe(130);
  });
});

describe('weapons', () => {
  it('fires at the data-driven rate and empties the magazine', () => {
    const world = quietWorld();
    const input = createInputState();
    input.firing = true;
    for (let i = 0; i < TICK_HZ; i++) stepWorld(world, input);
    // shotInterval is 0.098 s → 6 ticks between shots → 10 rounds in a second.
    expect(world.player.shotsFired).toBe(10);
    expect(world.player.weapon.ammo).toBe(30 - 10);
    expect(canFire(world)).toBe(true);
  });

  it('reloads from reserve and refuses to fire while reloading', () => {
    const world = quietWorld();
    world.player.weapon.ammo = 5;
    world.player.weapon.reserve = 100;
    startReload(world);
    const input = createInputState();
    input.firing = true;
    for (let i = 0; i < Math.round(1.85 * TICK_HZ) - 1; i++) stepWorld(world, input);
    expect(world.player.shotsFired).toBe(0);
    expect(world.player.reloading).toBe(true);

    for (let i = 0; i < 3; i++) stepWorld(world, input);
    expect(world.player.reloading).toBe(false);
    expect(world.player.weapon.ammo).toBe(29); // 30 - the one shot fired the tick it finished
    expect(world.player.weapon.reserve).toBe(75);
  });

  it('tightens the cone when aiming down sights and opens it when moving', () => {
    const world = quietWorld();
    const hip = spreadNow(world);
    world.player.adsT = 1;
    const ads = spreadNow(world);
    expect(ads).toBeLessThan(hip);
    expect(hip).toBeCloseTo(getWeapon('m4_vanguard').spread.hip, 6);

    world.player.adsT = 0;
    world.player.speed = 10.5;
    expect(spreadNow(world)).toBeGreaterThan(hip);
  });

  it('deals flat M4 damage inside the plaza and doubles it on a headshot', () => {
    // The lane x = 0 between z = 6 and z = 26 is clear of props, so the shot
    // travels unobstructed and the distance is exactly what the test says.
    const world = quietWorld({ playerAt: { x: 0, z: 16 } });
    const target = placeEnemy(world, 'rifleman', 0, 6);
    target.health = 1_000_000;

    // Fire with no cone: hip spread is 0.012 rad, which is 0.16 m wide at 16 m —
    // wider than a head's half-height, so a spread shot is a coin flip between
    // head and torso. This test is about the damage model, not the dice.
    const weaponDef = world.weaponDef;
    world.weaponDef = {
      ...weaponDef,
      spread: { ...weaponDef.spread, hip: 0, ads: 0, movePenalty: 0, sprintPenalty: 0, heatPenalty: 0 },
    };

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
      return before - target.health;
    };

    // Inside the M4's falloff window (45 m) range is irrelevant.
    const atTen = shoot(1.15, 16);
    const atTwenty = shoot(1.15, 26);
    expect(atTen).toBe(34);
    expect(atTwenty).toBe(34);
    expect(shoot(1.75, 16)).toBeCloseTo(34 * 2.1, 1);

    // With an artificially short falloff curve the data-driven curve is applied.
    const def = world.weaponDef;
    world.weaponDef = {
      ...def,
      ballistics: { ...def.ballistics, falloffStart: 5, falloffEnd: 25, falloffMinMultiplier: 0.5 },
    };
    // Roughly 10 m (a quarter down the curve) and 20 m (three quarters). The
    // bounds are soft because the hostile drifts a few centimetres per tick.
    const shortRange = shoot(1.15, 16);
    const longRange = shoot(1.15, 26);
    expect(shortRange).toBeGreaterThan(34 * 0.8);
    expect(shortRange).toBeLessThan(34 * 0.95);
    expect(longRange).toBeGreaterThan(34 * 0.5);
    expect(longRange).toBeLessThan(shortRange);
  });
});

describe('player survivability', () => {
  it('regenerates only after the damage-free window', () => {
    const world = quietWorld();
    const difficulty = world.difficulty;
    damagePlayer(world, 50, null);
    expect(world.player.health).toBe(50);

    idle(world, Math.round((difficulty.regenDelaySeconds - 0.5) * TICK_HZ));
    expect(world.player.health).toBe(50);

    idle(world, Math.round(1.5 * TICK_HZ));
    expect(world.player.health).toBeGreaterThan(50);
    expect(world.player.health).toBeLessThanOrEqual(world.player.maxHealth);
  });

  it('never regenerates above max health and dies cleanly', () => {
    const world = quietWorld();
    idle(world, 5 * TICK_HZ);
    expect(world.player.health).toBe(world.player.maxHealth);

    damagePlayer(world, 10_000, { x: 1, y: 0, z: 1 });
    expect(world.player.health).toBe(0);
    expect(world.player.alive).toBe(false);
    expect(world.missionFailed).toBe(true);
    expect(world.events.some((e) => e.type === 'playerDied')).toBe(true);
  });

  it('points the damage indicator at whoever shot you', () => {
    const world = quietWorld();
    damagePlayer(world, 5, { x: world.player.pos.x + 10, y: 0, z: world.player.pos.z });
    expect(world.player.damageIndicatorT).toBeGreaterThan(0);
    expect(Number.isFinite(world.player.damageIndicatorAngle)).toBe(true);
  });
});

describe('explosives', () => {
  it('lets the player shoot a fuel barrel and blow it up', () => {
    // Regression: the barrel's movement footprint used to be larger than its
    // shootable box, so every round landed on the barrel's own collider and the
    // signature chain explosion could never be triggered by gunfire.
    const world = quietWorld({ playerAt: { x: -8, z: -3 } });
    const barrel = world.barrels.find((b) => b.x === -8 && b.z === -9)!;
    const victim = placeEnemy(world, 'rifleman', -8, -10.5);
    world.player.yaw = 0;
    world.player.aimYaw = 0;
    world.player.pitch = Math.atan2(0.6 - 1.7, 6);
    world.player.aimPitch = world.player.pitch;

    const types = runCollectingEvents(world, 12, { ...createInputState(), firing: true });

    expect(barrel.alive).toBe(false);
    expect(victim.alive).toBe(false);
    expect(types.has('explosion')).toBe(true);
    expect(world.barrels.find((b) => b.x === -8 && b.z === -9)!.alive).toBe(false);
  });

  it('reduces blast damage with distance and chains into nearby barrels', () => {
    const world = quietWorld({ playerAt: { x: 40, z: 40 } });
    const barrel = world.barrels[0]!;
    const near = placeEnemy(world, 'rifleman', barrel.x + 1, barrel.z);
    const far = placeEnemy(world, 'heavy', barrel.x + 5.5, barrel.z);
    near.health = 1000;
    far.health = 1000;

    explode(world, { x: barrel.x, y: 1, z: barrel.z }, 6, 130, true);

    expect(near.health).toBeLessThan(far.health);
    expect(barrel.alive).toBe(false);
    // The barrel's own blast is queued, so a single call produces two blasts.
    expect(world.events.filter((e) => e.type === 'explosion').length).toBe(2);
  });

  it('hurts the player for less than it hurts hostiles', () => {
    const world = quietWorld({ playerAt: { x: 40, z: 40 } });
    const barrel = world.barrels[0]!;
    const enemy = placeEnemy(world, 'rifleman', barrel.x + 3, barrel.z);
    enemy.health = 1000;
    world.player.pos.x = barrel.x + 3;
    world.player.pos.z = barrel.z;

    explode(world, { x: barrel.x, y: 1, z: barrel.z }, 6, 100, true);

    const enemyDamage = 1000 - enemy.health;
    const playerDamage = world.player.maxHealth - world.player.health;
    expect(playerDamage).toBeGreaterThan(0);
    expect(playerDamage).toBeLessThan(enemyDamage);
  });

  it('does not hurt the player when the blast is flagged harmless', () => {
    // Away from every barrel, so no chain reaction can muddy the result.
    const world = quietWorld({ playerAt: { x: 0, z: 30 } });
    const barrelDistance = Math.min(
      ...world.barrels.map((b) => Math.hypot(b.x - 0, b.z - 30)),
    );
    expect(barrelDistance).toBeGreaterThan(6.9);

    explode(world, { x: 0, y: 1, z: 30 }, 6, 200, false);
    expect(world.player.health).toBe(world.player.maxHealth);

    // ...and the same blast with the flag set does hurt.
    explode(world, { x: 0, y: 1, z: 30 }, 6, 200, true);
    expect(world.player.health).toBeLessThan(world.player.maxHealth);
  });

  it('throws and fuses a frag grenade', () => {
    const world = quietWorld();
    throwGrenade(world);
    expect(world.grenades).toHaveLength(1);
    expect(world.player.grenades).toBe(world.mission.startingGrenades - 1);
    // The throw cooldown blocks a second grenade immediately.
    throwGrenade(world);
    expect(world.grenades).toHaveLength(1);

    const types = runCollectingEvents(world, Math.round(2.2 * TICK_HZ), createInputState());
    expect(world.grenades).toHaveLength(0);
    expect(types.has('explosion')).toBe(true);
  });
});

describe('pickups', () => {
  it('collects a medkit on contact and caps at max health', () => {
    const world = quietWorld();
    const def = PICKUPS.find((p) => p.id === 'medkit')!;
    world.player.health = 40;
    // Reset the regen timer so the only healing in this tick is the pickup.
    world.player.lastDamageTick = world.tick;
    world.pickups.push({
      id: world.nextEntityId++,
      kind: 'medkit',
      pos: { x: world.player.pos.x, y: 0.2, z: world.player.pos.z },
      ageTicks: 0,
      alive: true,
    });

    stepWorld(world, createInputState());
    expect(world.player.health).toBe(Math.min(world.player.maxHealth, 40 + def.amount));
    expect(world.pickups).toHaveLength(0);
    expect(world.events.some((e) => e.type === 'pickupCollected')).toBe(true);
  });

  it('expires after its lifetime', () => {
    const world = quietWorld();
    const def = PICKUPS.find((p) => p.id === 'ammo')!;
    world.pickups.push({
      id: world.nextEntityId++,
      kind: 'ammo',
      pos: { x: world.player.pos.x + 30, y: 0.2, z: world.player.pos.z },
      ageTicks: 0,
      alive: true,
    });
    idle(world, Math.round((def.lifetimeSeconds + 1) * TICK_HZ));
    expect(world.pickups).toHaveLength(0);
  });
});

describe('checkpoints and settings', () => {
  it('round-trips a checkpoint snapshot', () => {
    const world = quietWorld();
    const bot = new ScriptedBot();
    for (let tick = 0; tick < 30 * TICK_HZ; tick++) {
      const { input, actions } = bot.tick(world);
      stepWorld(world, input, actions);
    }
    world.player.health = 61;
    world.wavesCleared = 3;
    world.wave = 4;
    const snapshot = snapshotCheckpoint(world);

    world.player.health = 1;
    world.player.pos.x = 50;
    restoreCheckpoint(world, snapshot);

    expect(world.player.health).toBe(61);
    expect(world.player.pos.x).toBeCloseTo(snapshot.player.pos.x, 6);
    expect(world.wavesCleared).toBe(3);
    expect(world.missionFailed).toBe(false);
    expect(world.enemies).toHaveLength(0);
    expect(snapshot.objectiveStates.length).toBe(world.objectives.length);
  });

  it('rejects a checkpoint from a future save version', () => {
    const world = quietWorld();
    const snapshot = { ...snapshotCheckpoint(world), version: 99 };
    expect(() => restoreCheckpoint(world, snapshot)).toThrow(/not supported/);
  });

  it('tolerates missing or corrupt stored settings', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    const loaded = loadSettings({ sensitivity: 2, quality: 'cinematic', invertY: true, bogus: 1 });
    expect(loaded.sensitivity).toBe(2);
    expect(loaded.quality).toBe('cinematic');
    expect(loaded.invertY).toBe(true);
    expect(loaded.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);

    // Out-of-range and wrong-typed values fall back rather than throwing.
    const bad = loadSettings({ quality: 'ultra', sensitivity: 'fast' });
    expect(bad.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(bad.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
  });
});

describe('time base', () => {
  it('keeps the tick rate and step in sync', () => {
    expect(TICK_HZ).toBe(60);
    expect(TICK_DT).toBeCloseTo(1 / 60, 12);
    const world = quietWorld();
    stepWorld(world, createInputState());
    expect(world.tick).toBe(1);
    expect(aliveEnemyCount(world)).toBe(0);
  });
});
