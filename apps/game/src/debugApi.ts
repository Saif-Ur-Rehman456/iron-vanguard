/**
 * Debug / test API.
 *
 * Exposed as `window.__IV__` so Playwright (and a human with devtools) can drive
 * and interrogate real gameplay — query the state instead of pixel-hunting.
 * Includes a deterministic scripted bot so a test can fast-forward a mission.
 */
import {
  createInputState,
  currentObjective,
  hashWorld,
  spawnEnemyState,
  stepWorld,
  switchWeapon,
  throwGrenade,
  startReload,
  yawToPoint,
  type World,
} from '@iron/sim';
import { getEnemy, getWeapon, type EnemyArchetype } from '@iron/content';
import type { AoOptions, AoOutput, GameRenderer, LightGroup, ModelLibrary } from '@iron/render';
import type * as THREE from 'three';
import type { QualityTier, ResolutionMode, TimeOfDay } from '@iron/render';

export interface DebugApiContext {
  getWorld: () => World;
  getRenderer: () => GameRenderer;
  getGameState: () => string;
  getSeed: () => number;
  setQuality: (tier: QualityTier) => void;
  /** Change the atmosphere (and persist it), exactly as the menu's selector does. */
  setTimeOfDay: (next: TimeOfDay) => void;
  /** Change the resolution mode (and persist it), exactly as the settings row does. */
  setResolutionMode: (next: ResolutionMode) => void;
  restart: (options?: { seed?: number }) => void;
  setFrozen?: (frozen: boolean) => void;
  getModels?: () => ModelLibrary;
}

function nearestEnemy(world: World): { x: number; z: number; distance: number } | null {
  let best: { x: number; z: number; distance: number } | null = null;
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;
    const distance = Math.hypot(enemy.pos.x - world.player.pos.x, enemy.pos.z - world.player.pos.z);
    if (!best || distance < best.distance) best = { x: enemy.pos.x, z: enemy.pos.z, distance };
  }
  return best;
}

/**
 * One tick of "competent player" input: face the nearest hostile, fire in
 * range, reload when dry, and walk toward the active objective when the arena
 * is clear. Deterministic, so it can back golden replay tests.
 */
function botTick(world: World): { input: ReturnType<typeof createInputState>; actions: string[] } {
  const input = createInputState();
  const actions: string[] = [];
  const player = world.player;
  const target = nearestEnemy(world);

  if (target) {
    const desiredYaw = yawToPoint(world, target.x, target.z);
    let delta = desiredYaw - player.aimYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    input.dYaw = delta * 0.25;
    input.dPitch = -player.aimPitch * 0.3;
    input.aiming = target.distance > 22;
    input.firing = target.distance < 40;
    // Keep the bot moving so enemy accuracy penalties apply, like a real player.
    input.forward = 0.4;
    input.right = Math.sin(world.tick * 0.05) * 0.5;
    if (player.weapon.ammo <= 2 && player.weapon.reserve > 0) actions.push('reload');
  } else {
    const objective = currentObjective(world);
    const zone = objective?.def.params.zone;
    if (zone) {
      const dx = zone.x - player.pos.x;
      const dz = zone.z - player.pos.z;
      const distance = Math.hypot(dx, dz);
      const desiredYaw = yawToPoint(world, zone.x, zone.z);
      let delta = desiredYaw - player.aimYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      input.dYaw = delta * 0.2;
      if (distance > zone.radius * 0.5) {
        input.forward = 1;
        input.sprinting = true;
      }
    }
    if (player.weapon.ammo < world.weaponDef.magazine && player.weapon.reserve > 0) actions.push('reload');
  }

  return { input, actions };
}

export function installDebugApi(context: DebugApiContext): void {
  const api = {
    version: '0.1.0',
    /** Current high-level game state. */
    gameState: (): string => context.getGameState(),
    seed: (): number => context.getSeed(),

    /** Full simulation snapshot for assertions. */
    state: () => {
      const world = context.getWorld();
      return {
        tick: world.tick,
        wave: world.wave,
        waveActive: world.waveActive,
        intermissionTicks: world.intermissionTicks,
        missionComplete: world.missionComplete,
        missionFailed: world.missionFailed,
        objective: currentObjective(world)?.def.id ?? null,
        objectiveState: currentObjective(world)?.state ?? null,
        player: {
          x: world.player.pos.x,
          z: world.player.pos.z,
          health: world.player.health,
          ammo: world.player.weapon.ammo,
          reserve: world.player.weapon.reserve,
          grenades: world.player.grenades,
          kills: world.player.kills,
          score: world.player.score,
          shotsFired: world.player.shotsFired,
          shotsHit: world.player.shotsHit,
          alive: world.player.alive,
          slot: world.player.slot,
          weaponId: world.player.weapon.defId,
          /** Every slot, in order, so a test can prove the loadout is three weapons. */
          loadout: world.player.loadout.map((entry) => ({
            defId: entry.defId,
            ammo: entry.ammo,
            reserve: entry.reserve,
          })),
        },
        enemiesAlive: world.enemies.filter((e) => e.alive).length,
        spawnQueue: world.spawnQueue.length,
        barrelsAlive: world.barrels.filter((b) => b.alive).length,
        events: world.events.length,
      };
    },

    /** Deterministic gameplay hash (same contract as the golden tests). */
    hash: (): string => hashWorld(context.getWorld()),
    stats: () => ({ ...context.getWorld().stats }),
    renderer: () => context.getRenderer().info,

    /** Run the simulation headlessly with the scripted bot for N seconds. */
    fastForward: (seconds = 5): { ticks: number; state: unknown } => {
      const world = context.getWorld();
      const renderer = context.getRenderer();
      const ticks = Math.round(seconds * 60);
      for (let i = 0; i < ticks; i++) {
        const { input, actions } = botTick(world);
        renderer.capturePrevious(world);
        stepWorld(world, input, actions);
        renderer.consumeEvents(world);
      }
      return { ticks, state: api.state() };
    },

    /**
     * Which downloaded models actually loaded. Empty is the normal, shipped state:
     * the procedural baseline is the product, models are an upgrade.
     */
    models: (): { count: number; loaded: string[]; failed: string[]; issues: string[] } => {
      const library = context.getModels?.();
      if (!library) return { count: 0, loaded: [], failed: [], issues: [] };
      return {
        count: library.count,
        loaded: [...library.report.loaded],
        failed: [...library.report.failed],
        issues: [...library.report.issues],
      };
    },

    /**
     * Draw-call sources, grouped by the nearest named ancestor. Read-only on
     * purpose: the devtools panel and the shots tool need the breakdown, not a
     * handle they could mutate the scene with.
     */
    sceneCensus: (): { total: number; top: string[] } => {
      const counts = new Map<string, number>();
      let total = 0;
      const label = (object: THREE.Object3D | null): string => {
        let current = object;
        while (current) {
          if (current.name) return current.name.replace(/[-_]\d+$/g, '');
          current = current.parent;
        }
        return 'unnamed';
      };
      context.getRenderer().scene.traverseVisible((object) => {
        const drawable = object as THREE.Mesh & { isSprite?: boolean; isLine?: boolean; isPoints?: boolean };
        if (!drawable.isMesh && !drawable.isSprite && !drawable.isLine && !drawable.isPoints) return;
        const key = drawable.isPoints ? 'points' : label(object);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
      });
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => `${name}:${count}`);
      return { total, top };
    },

    setQuality: (tier: QualityTier): void => context.setQuality(tier),
    /** The atmosphere currently running, and the way to change it (and persist it). */
    timeOfDay: (): TimeOfDay => context.getRenderer().timeOfDay,
    setTimeOfDay: (next: TimeOfDay): void => context.setTimeOfDay(next),
    /**
     * The material library as the frame is shading it, plus both hours' weather (ADR-0020).
     *
     * The surface pass has to be *measurable* to be reviewable: "the car is cleaner, the road
     * has a history, the two atmospheres leave different surfaces" are claims about numbers,
     * and this is where a capture reads them.
     */
    materials: () => context.getRenderer().renderDebug.materials,
    /** The resolution trade, and the switch for it (ADR-0017). */
    resolution: (): ResolutionMode => context.getRenderer().resolution,
    setResolutionMode: (next: ResolutionMode): void => context.setResolutionMode(next),
    motionScale: (scale: number): void => context.getRenderer().setMotionScale(scale),
    restart: (options?: { seed?: number }): void => context.restart(options),

    giveAmmo: (reserve = 300): void => {
      const world = context.getWorld();
      world.player.weapon.reserve = reserve;
      world.player.weapon.ammo = world.weaponDef.magazine;
    },
    grenade: (): void => throwGrenade(context.getWorld()),
    reload: (): void => startReload(context.getWorld()),

    /**
     * Select a loadout slot (1, 2 or 3).
     *
     * The same call the 1/2/3 keys make, so a capture of "each weapon" cannot be a
     * capture of a state the game cannot reach: the equip time, the ammo carry-over
     * and the event the renderer rebuilds from are all the simulation's.
     */
    equip: (slot: number): { weaponId: string; slot: number } => {
      const world = context.getWorld();
      switchWeapon(world, slot);
      // Rebuilt here rather than left to the app's event handler: a capture probe runs
      // with the simulation frozen, which skips the tick loop *and* its event pass, so
      // the view model would otherwise still be the weapon the probe replaced.
      context.getRenderer().setWeapon(getWeapon(world.player.weapon.defId));
      context.getRenderer().consumeEvents(world);
      return { weaponId: world.player.weapon.defId, slot: world.player.slot };
    },

    /** Spawn an enemy near the player for FX/AI checks. */
    spawn: (archetype: EnemyArchetype = 'rifleman', distance = 12): number => {
      const world = context.getWorld();
      const def = getEnemy(archetype);
      const angle = (world.enemies.length % 8) * (Math.PI / 4);
      const x = world.player.pos.x + Math.cos(angle) * distance;
      const z = world.player.pos.z + Math.sin(angle) * distance;
      // Goes through the sim factory so debug spawns carry the same fields as
      // scripted wave spawns — the two cannot drift apart.
      const enemy = spawnEnemyState(world, def, x, z);
      world.enemies.push(enemy);
      return enemy.id;
    },

    teleport: (x: number, z: number): void => {
      const world = context.getWorld();
      world.player.pos.x = x;
      world.player.pos.z = z;
    },

    /**
     * Put the player at a fixed pose *and* snap the render rig to it, in one call.
     *
     * The shots tool needs every probe frame to be the same pixels, and `teleport`
     * alone cannot do that: the camera is interpolated between the previous and
     * current tick, and it only follows the world pose while a frame is stepping
     * the simulation. Snapping the rig here makes a probe independent of tick
     * timing, which is the difference between an A/B you can trust and one you
     * have to re-run.
     */
    pose: (x: number, z: number, yaw = 0, pitch = 0): void => {
      const world = context.getWorld();
      const renderer = context.getRenderer();
      world.player.pos.x = x;
      world.player.pos.z = z;
      world.player.yaw = yaw;
      world.player.aimYaw = yaw;
      world.player.pitch = pitch;
      world.player.aimPitch = pitch;
      world.player.speed = 0;
      renderer.capturePrevious(world);
      renderer.syncWorld(world, 1, 0);
    },

    /** What the image pipeline is actually running (MSAA, AO, shadows, grade). */
    renderDebug: (): unknown => context.getRenderer().renderDebug,

    /**
     * The weapon as built and as posed: archetype, receiver/overall length, the optic's eye
     * relief and sight-line height, the part count, the tiling of each weapon surface in
     * metres, and the rig's joints in world space.
     *
     * This is the readout for the "is a man holding it" question: `handRight` must
     * sit on the grip, `elbowRight` behind and below the shoulder-hand line, and
     * `muzzle` about 0.9 m from the camera at ADS.
     */
    weapon: (): unknown => context.getRenderer().weaponDebug,

    /**
     * Hold the weapon's pose for a capture: `{ adsT: 1 }` aims, `{ reloadProgress:
     * 0.5 }` is mid-magazine, `{ sprintK: 1 }` is the lowered sprint carry. Pass
     * `null` to hand the pose back to the simulation.
     */
    weaponPose: (override: { adsT?: number; sprintK?: number; reloadProgress?: number } | null): void =>
      context.getRenderer().setViewModelOverride(override),

    /**
     * Hide or show the weapon, hands and arms.
     *
     * Debug/test mutation, through the one greppable surface (invariant 4). Probe
     * use: shoot the same pose twice, once hidden, and the difference is the view
     * model and nothing else — which is how a shape statistic about a hand stops
     * being a statistic about the building behind it.
     */
    viewModel: (visible = true, weaponToo = true): void =>
      context.getRenderer().setViewModelVisible(visible, weaponToo),

    /**
     * Stop (or resume) the simulation while rendering continues.
     *
     * Capture probes need this: sample offsets are centimetres, and an enemy
     * covering two metres per second would walk out of the sample between the
     * pose being set and the screenshot being taken.
     */
    freeze: (frozen = true): void => context.setFrozen?.(frozen),
    /**
     * Hold the renderer's own transients still (particles, casings, ambient fire).
     * A capture pair compared with live particles measures the particles.
     */
    freezeFx: (frozen = true): void => context.getRenderer().setFxFrozen(frozen),

    /** Debug toggles for the grade, the AO pass, MSAA and the shadow map, for A/B captures. */
    setGrade: (enabled: boolean): void => context.getRenderer().setGradeEnabled(enabled),
    setMsaa: (samples: 0 | 2 | 4): void => context.getRenderer().setMsaaSamples(samples),
    setShadows: (enabled: boolean): void => context.getRenderer().setShadowsEnabled(enabled),
    /**
     * Switch one lighting group off or on: `key`, `ambient`, `lamps`, `windows`,
     * `fire` or `reflections`.
     *
     * The lighting A/B captures are pairs of frames taken at one frozen pose with
     * a group toggled, which is the only way "these lamps light their pavement" is
     * a measurement rather than an impression (see apps/harness/src/shots.ts,
     * probe `lighting`).
     */
    setLighting: (group: LightGroup, enabled: boolean): void =>
      context.getRenderer().setLightingEnabled(group, enabled),
    setAo: (enabled: boolean, output?: AoOutput): void => {
      context.getRenderer().setAoEnabled(enabled);
      if (output) context.getRenderer().setAoOutput(output);
    },
    /**
     * Pin the adaptive resolution while a capture pair is taken (null releases).
     * Without it an effect A/B compares two different render resolutions.
     */
    lockResolution: (scale: number | null = 1): void =>
      context.getRenderer().setResolutionLock(scale),
    /** AO sample count (0 removes the pass and its depth texture entirely). */
    setAoQuality: (samples: number): void => context.getRenderer().setAoQuality(samples),
    /** Live AO parameters, for the tuning sweep in apps/harness/src/shots.ts. */
    setAoParams: (params: Partial<AoOptions>): void => context.getRenderer().setAoParams(params),

    /** Where a world point lands on screen (CSS px) — used by the capture probes. */
    project: (x: number, y: number, z: number): { x: number; y: number; visible: boolean } =>
      context.getRenderer().projectToScreen(x, y, z),

    /** Live hostiles with positions — probe points for contact-shadow checks. */
    enemies: (): { id: number; x: number; z: number; yaw: number; alive: boolean }[] =>
      context.getWorld().enemies.map((enemy) => ({
        id: enemy.id,
        x: enemy.pos.x,
        z: enemy.pos.z,
        yaw: enemy.yaw,
        alive: enemy.alive,
      })),
    killAll: (): void => {
      const world = context.getWorld();
      for (const enemy of world.enemies) enemy.alive = false;
      world.spawnQueue.length = 0;
    },
    /** Force the mission outcome for UI/flow tests. */
    win: (): void => {
      const world = context.getWorld();
      world.missionComplete = true;
      world.events.push({ type: 'missionComplete', stats: world.stats });
    },
    die: (): void => {
      const world = context.getWorld();
      world.player.health = 0;
      world.player.alive = false;
      world.missionFailed = true;
      world.events.push({ type: 'playerDied' });
      world.events.push({ type: 'missionFailed' });
    },
  };

  (window as unknown as { __IV__: typeof api }).__IV__ = api;
}
