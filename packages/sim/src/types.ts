import type { RngStreams, Vec3 } from '@iron/core';
import type {
  DifficultyDef,
  EnemyArchetype,
  EnemyDef,
  MapDef,
  MissionDef,
  ObjectiveDef,
  WeaponDef,
  WaveDef,
} from '@iron/content';
import type { CollisionWorld } from './collision';

export type EnemyMode = 'move' | 'aim' | 'burst' | 'lunge' | 'dead';

export interface WeaponRuntime {
  defId: string;
  ammo: number;
  reserve: number;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  /** Smoothed view angles actually used for movement and aim. */
  yaw: number;
  pitch: number;
  /** Raw aim target the smoothed angles chase (mouse/touch input lands here). */
  aimYaw: number;
  aimPitch: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Aim-down-sights blend, 0..1. */
  adsT: number;
  /**
   * Stance: 0 = standing, 1 = crouched.
   *
   * The prototype had no crouch at all, so this is a *feature* rather than parity:
   * the shipped build bound C to nothing and Space to a `jump` action no system
   * consumed (AGENTS.md entry 28). `eyeHeight` is the derived eye above the feet, and
   * `pos.y`/`vel.y` carry a jump — the three things every aiming system reads.
   */
  crouchK: number;
  crouching: boolean;
  /** Eye height above the feet, in metres: 1.70 standing, 1.19 crouched. */
  eyeHeight: number;
  /** True while the feet are on the ground. A jump is only legal from here. */
  grounded: boolean;
  /** Ticks since take-off. 0 while grounded. */
  airTicks: number;
  /** Landing impulse, 1 at touchdown and decaying to 0: the presentation reads it. */
  landT: number;
  /** Sprint blend, 0..1. */
  sprintK: number;
  sprintOutT: number;
  aiming: boolean;
  sprinting: boolean;
  speed: number;
  bobPhase: number;
  heat: number;
  /** The weapon in hand. Always the same object as `loadout[slot - 1]`. */
  weapon: WeaponRuntime;
  /**
   * Every weapon the squad carries, in slot order (1 = pistol, 2 = rifle, 3 = the
   * second rifle). Ammo lives here, per weapon, so a swap is a swap and not a
   * reload: the magazine you left in the M4 is the magazine you come back to.
   */
  loadout: WeaponRuntime[];
  /** 1-based slot of `weapon`. */
  slot: number;
  /**
   * Ticks left before the weapon in hand can fire (the equip animation).
   *
   * A counter rather than a timer, and a *player* field rather than a system, so the
   * canonical tick order is untouched (AGENTS.md invariant 2).
   */
  equipTicks: number;
  reloading: boolean;
  reloadTicks: number;
  fireCooldownTicks: number;
  grenades: number;
  grenadeCooldownTicks: number;
  lastDamageTick: number;
  damageIndicatorT: number;
  damageIndicatorAngle: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  kills: number;
  score: number;
  combo: number;
  lastKillTick: number;
}

export interface EnemyState {
  id: number;
  archetype: EnemyArchetype;
  def: EnemyDef;
  pos: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  mode: EnemyMode;
  /** Ticks since death, drives the death animation and corpse cleanup. */
  deathTicks: number;
  /** Seconds remaining in the current mode. */
  timer: number;
  shotsLeft: number;
  fireTimer: number;
  cooldown: number;
  moveTargetX: number;
  moveTargetZ: number;
  animPhase: number;
  flashT: number;
  lungeCooldown: number;
  lungeHit: boolean;
  screamCooldown: number;
  /** Distance to the player at the last perception update. */
  distance: number;
  hasLineOfSight: boolean;
  spawnTick: number;
  /** Ticks spent pressed against geometry, used to re-path instead of wedging. */
  stuckTicks: number;
  lastX: number;
  lastZ: number;
  /** Ticks without line of sight, used to push toward the player. */
  noLosTicks: number;
  /** Which way the agent has committed to go around obstacles (-1 / 0 / 1). */
  unstickSign: number;
}

export interface PendingShot {
  /** Tick at which the shot will land — replaces the prototype's setTimeout. */
  dueTick: number;
  amount: number;
  fromX: number;
  fromZ: number;
}

export interface PickupState {
  id: number;
  kind: 'medkit' | 'ammo';
  pos: Vec3;
  ageTicks: number;
  alive: boolean;
}

export interface GrenadeState {
  id: number;
  pos: Vec3;
  vel: Vec3;
  fuseTicks: number;
  alive: boolean;
  armTicks: number;
}

export interface BarrelState {
  id: number;
  x: number;
  z: number;
  variant: number;
  health: number;
  alive: boolean;
}

export interface SpawnEntry {
  type: EnemyArchetype;
  /** Tick at which this enemy enters the arena. */
  dueTick: number;
}

export type ObjectiveState = 'pending' | 'active' | 'complete' | 'failed';

export interface ObjectiveRuntime {
  def: ObjectiveDef;
  state: ObjectiveState;
  /** Enemies eliminated (eliminate), waves survived (survive), seconds held (defend). */
  progress: number;
}

export interface MissionStats {
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  score: number;
  accuracyPercent: number;
  elapsedTicks: number;
  wavesCleared: number;
}

export type SimEvent =
  | { type: 'shot'; weaponId: string; origin: Vec3; end: Vec3; hit: boolean }
  | { type: 'impact'; point: Vec3; normal: Vec3; surface: string; entityId: number }
  | { type: 'enemyShot'; enemyId: number; origin: Vec3; end: Vec3 }
  | { type: 'enemyDamaged'; enemyId: number; head: boolean; damage: number }
  | {
      type: 'enemyKilled';
      enemyId: number;
      archetype: EnemyArchetype;
      displayName: string;
      head: boolean;
      score: number;
      combo: number;
    }
  | { type: 'playerDamaged'; amount: number; fromX: number; fromZ: number }
  | { type: 'playerDied' }
  | { type: 'resupply'; reserveAmmo: number; grenades: number }
  | { type: 'waveStart'; wave: number; label: string; subtitle: string }
  | { type: 'waveComplete'; wave: number }
  | { type: 'objective'; id: string; state: ObjectiveState; label: string; hudText: string }
  | { type: 'checkpoint'; wave: number }
  | { type: 'missionComplete'; stats: MissionStats }
  | { type: 'missionFailed' }
  | { type: 'explosion'; pos: Vec3; radius: number; damage: number }
  | { type: 'pickupCollected'; kind: 'medkit' | 'ammo'; amount: number }
  | { type: 'grenadeThrown' }
  | { type: 'reloadStarted' }
  | { type: 'reloadFinished' }
  /** The player swapped weapons: the renderer rebuilds the view model from this. */
  | { type: 'weaponChanged'; weaponId: string; slot: number }
  | { type: 'dryFire' }
  | { type: 'banner'; title: string; subtitle: string; small: boolean }
  | { type: 'audio'; cue: string; pos?: Vec3; volume?: number }
  | { type: 'announce'; text: string; small: boolean };

export interface WorldConfig {
  seed: number;
  missionId: string;
  difficultyId: string;
}

export interface World {
  config: WorldConfig;
  mission: MissionDef;
  map: MapDef;
  difficulty: DifficultyDef;
  weaponDef: WeaponDef;
  waves: readonly WaveDef[];
  rng: RngStreams;
  colliders: CollisionWorld;
  tick: number;
  player: PlayerState;
  enemies: EnemyState[];
  pickups: PickupState[];
  grenades: GrenadeState[];
  barrels: BarrelState[];
  spawnQueue: SpawnEntry[];
  pendingShots: PendingShot[];
  wave: number;
  waveActive: boolean;
  intermissionTicks: number;
  objectives: ObjectiveRuntime[];
  activeObjective: number;
  missionComplete: boolean;
  missionFailed: boolean;
  stats: MissionStats;
  events: SimEvent[];
  /** Tick-scheduled audio cues (replaces the prototype's setTimeout calls). */
  pendingCues: { dueTick: number; cue: string }[];
  nextEntityId: number;
  /** Waves cleared, used by survive objectives and the results screen. */
  wavesCleared: number;
}
