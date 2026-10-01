/**
 * Save data for checkpoints and settings.
 *
 * The simulation never touches localStorage (it is not available in headless
 * runs and would break replay determinism) — apps/game owns storage and passes
 * plain objects in and out of here.
 */
import type { Vec3 } from '@iron/core';
import type { World } from './types';

export const SAVE_VERSION = 1;

export interface CheckpointSnapshot {
  version: number;
  missionId: string;
  difficultyId: string;
  wave: number;
  wavesCleared: number;
  player: {
    pos: Vec3;
    yaw: number;
    pitch: number;
    health: number;
    ammo: number;
    reserve: number;
    grenades: number;
    score: number;
    kills: number;
    headshots: number;
    shotsFired: number;
    shotsHit: number;
  };
  objectiveStates: { id: string; state: string; progress: number }[];
  savedAtTick: number;
}

export function snapshotCheckpoint(world: World): CheckpointSnapshot {
  const p = world.player;
  return {
    version: SAVE_VERSION,
    missionId: world.mission.id,
    difficultyId: world.difficulty.id,
    wave: world.wave,
    wavesCleared: world.wavesCleared,
    player: {
      pos: { ...p.pos },
      yaw: p.yaw,
      pitch: p.pitch,
      health: p.health,
      ammo: p.weapon.ammo,
      reserve: p.weapon.reserve,
      grenades: p.grenades,
      score: p.score,
      kills: p.kills,
      headshots: p.headshots,
      shotsFired: p.shotsFired,
      shotsHit: p.shotsHit,
    },
    objectiveStates: world.objectives.map((o) => ({
      id: o.def.id,
      state: o.state,
      progress: o.progress,
    })),
    savedAtTick: world.tick,
  };
}

/** Restore player + progression state. Enemies and spawns reset to the wave start. */
export function restoreCheckpoint(world: World, snapshot: CheckpointSnapshot): void {
  if (snapshot.version !== SAVE_VERSION) {
    throw new Error(`checkpoint version ${snapshot.version} not supported (expected ${SAVE_VERSION})`);
  }
  const p = world.player;
  p.pos.x = snapshot.player.pos.x;
  p.pos.y = snapshot.player.pos.y;
  p.pos.z = snapshot.player.pos.z;
  p.vel.x = 0;
  p.vel.y = 0;
  p.vel.z = 0;
  p.yaw = snapshot.player.yaw;
  p.aimYaw = snapshot.player.yaw;
  p.pitch = snapshot.player.pitch;
  p.aimPitch = snapshot.player.pitch;
  p.health = snapshot.player.health;
  p.alive = true;
  p.weapon.ammo = snapshot.player.ammo;
  p.weapon.reserve = snapshot.player.reserve;
  p.grenades = snapshot.player.grenades;
  p.score = snapshot.player.score;
  p.kills = snapshot.player.kills;
  p.headshots = snapshot.player.headshots;
  p.shotsFired = snapshot.player.shotsFired;
  p.shotsHit = snapshot.player.shotsHit;
  p.reloading = false;
  p.reloadTicks = 0;

  world.wave = snapshot.wave;
  world.wavesCleared = snapshot.wavesCleared;
  world.missionComplete = false;
  world.missionFailed = false;
  world.enemies.length = 0;
  world.spawnQueue.length = 0;
  world.grenades.length = 0;
  world.pickups.length = 0;
  world.pendingShots.length = 0;
  world.waveActive = false;
  world.intermissionTicks = 30;

  for (const saved of snapshot.objectiveStates) {
    const runtime = world.objectives.find((o) => o.def.id === saved.id);
    if (!runtime) continue;
    runtime.state = saved.state as typeof runtime.state;
    runtime.progress = saved.progress;
  }
  const activeIndex = world.objectives.findIndex((o) => o.state === 'active');
  world.activeObjective = activeIndex >= 0 ? activeIndex : 0;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type QualityTier = 'low' | 'medium' | 'high' | 'cinematic';

export interface StoredSettings {
  version: number;
  sensitivity: number;
  invertY: boolean;
  fovScale: number;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  motionScale: number;
  quality: QualityTier;
  /**
   * Which atmosphere the mission is fought in: 'dawn' or 'dusk'.
   *
   * A *setting* rather than a mission parameter, and selected before deploying,
   * because the review asked for both scenes and for the player to choose — the same
   * plaza in the morning and at dusk are two different pictures with one simulation
   * behind them, so this can never be a gameplay difference. `@iron/sim` owns the
   * shape only (ADR-0002): the renderer is what reads it.
   */
  timeOfDay: TimeOfDaySetting;
  /**
   * Whether the frame may trade resolution for frame rate.
   *
   * `native` (shipped) renders at the display's own pixel count and answers a slow
   * frame with fewer effects; `dynamic` lets the resolution scale fall to buy frames,
   * and the renderer puts the micro-contrast back with a sharpen term. It is a
   * *setting* because the trade is the player's to make: the report that produced it
   * was "laggy and blurry at every graphics level", i.e. a resolution cut applied
   * silently, which is indistinguishable from a blurry game (ADR-0017).
   */
  resolutionMode: ResolutionSetting;
  subtitles: boolean;
  difficultyId: string;
  colorBlindCrosshair: boolean;
  showFps: boolean;
}

/** Mirrors `@iron/render`'s `TimeOfDay` without importing it (ADR-0002). */
export type TimeOfDaySetting = 'dawn' | 'dusk';

export const TIME_OF_DAY_SETTINGS: readonly TimeOfDaySetting[] = ['dawn', 'dusk'];

/** Mirrors `@iron/render`'s `ResolutionMode`; `native` is what ships. */
export type ResolutionSetting = 'native' | 'dynamic';

export const RESOLUTION_SETTINGS: readonly ResolutionSetting[] = ['native', 'dynamic'];

export const DEFAULT_SETTINGS: StoredSettings = {
  version: SAVE_VERSION,
  sensitivity: 1,
  invertY: false,
  fovScale: 1, // parity: 75 hip / 42 ADS base FOV
  masterVolume: 0.9, // parity
  sfxVolume: 1,
  musicVolume: 0.7,
  motionScale: 1,
  quality: 'high',
  timeOfDay: 'dusk',
  resolutionMode: 'native',
  subtitles: true,
  difficultyId: 'regular',
  colorBlindCrosshair: false,
  showFps: true,
};

/** Tolerant loader: unknown or malformed fields fall back to defaults. */
export function loadSettings(raw: unknown): StoredSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const data = raw as Partial<StoredSettings>;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  return {
    version: SAVE_VERSION,
    sensitivity: num(data.sensitivity, DEFAULT_SETTINGS.sensitivity),
    invertY: bool(data.invertY, DEFAULT_SETTINGS.invertY),
    fovScale: num(data.fovScale, DEFAULT_SETTINGS.fovScale),
    masterVolume: num(data.masterVolume, DEFAULT_SETTINGS.masterVolume),
    sfxVolume: num(data.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    musicVolume: num(data.musicVolume, DEFAULT_SETTINGS.musicVolume),
    motionScale: num(data.motionScale, DEFAULT_SETTINGS.motionScale),
    quality: (['low', 'medium', 'high', 'cinematic'] as const).includes(data.quality as QualityTier)
      ? (data.quality as QualityTier)
      : DEFAULT_SETTINGS.quality,
    timeOfDay: TIME_OF_DAY_SETTINGS.includes(data.timeOfDay as TimeOfDaySetting)
      ? (data.timeOfDay as TimeOfDaySetting)
      : DEFAULT_SETTINGS.timeOfDay,
    resolutionMode: RESOLUTION_SETTINGS.includes(data.resolutionMode as ResolutionSetting)
      ? (data.resolutionMode as ResolutionSetting)
      : DEFAULT_SETTINGS.resolutionMode,
    subtitles: bool(data.subtitles, DEFAULT_SETTINGS.subtitles),
    difficultyId: typeof data.difficultyId === 'string' ? data.difficultyId : DEFAULT_SETTINGS.difficultyId,
    colorBlindCrosshair: bool(data.colorBlindCrosshair, DEFAULT_SETTINGS.colorBlindCrosshair),
    showFps: bool(data.showFps, DEFAULT_SETTINGS.showFps),
  };
}
