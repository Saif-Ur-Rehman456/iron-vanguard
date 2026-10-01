/**
 * Content type surface. Everything the simulation can be told about the world
 * arrives as validated data through these types (docs/ARCHITECTURE.md §3):
 * adding a weapon, an enemy or a mission is a data edit, not an engine change.
 */

export type WeaponClass = 'rifle' | 'smg' | 'pistol' | 'lmg' | 'shotgun' | 'dmr';
export type FireMode = 'auto' | 'burst' | 'semi';

export interface WeaponSpreadDef {
  hip: number;
  ads: number;
  movePenalty: number;
  sprintPenalty: number;
  heatPerShot: number;
  heatPenalty: number;
  heatDecayPerSecond: number;
  maxSpread: number;
}

export interface WeaponRecoilDef {
  /** Radians of upward kick applied to aim per shot. */
  pitch: number;
  /** Random horizontal component in radians. */
  yaw: number;
  /** Visual view-model kick strength, 0..1. */
  kick: number;
  /** Exponential recovery rate. */
  recovery: number;
}

export interface WeaponBallisticsDef {
  /** When false the weapon is hitscan (prototype parity). */
  projectile: boolean;
  muzzleVelocity: number;
  /** How many metres of penetration through soft cover. */
  penetration: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMinMultiplier: number;
}

export interface WeaponAdsDef {
  fovDeg: number;
  transitionSeconds: number;
  moveMultiplier: number;
  sensitivityMultiplier: number;
}

/**
 * Which procedural build the first-person model uses.
 *
 * A carbine, an AK-pattern rifle and a pistol are not the same weapon at three
 * sizes: the AK's gas system sits *above* the barrel and its magazine rocks forward,
 * and a pistol has no stock, no handguard and its slide is the receiver. `carbine` is
 * the default, so a weapon def that predates this field still builds what it built
 * before.
 */
export type WeaponArchetype = 'carbine' | 'ak' | 'pistol';

export interface WeaponViewModelDef {
  /** Hip / ADS offsets in camera space: [x, y, z]. */
  hip: [number, number, number];
  ads: [number, number, number];
  muzzleOffset: number;
  /** Procedural build dimensions so no art is required for per-weapon parity. */
  body: [number, number, number];
  barrelLength: number;
  magazineReserve: number;
  /** The build this weapon's first-person model uses. Defaults to `carbine`. */
  archetype?: WeaponArchetype;
}

export interface WeaponDef {
  id: string;
  /** Slot this weapon holds in the mission loadout, 1-based. Display only. */
  slot?: number;
  displayName: string;
  /** HUD line, e.g. `M4 “VANGUARD” — 5.56 AUTO`. */
  hudName: string;
  class: WeaponClass;
  fireMode: FireMode;
  magazine: number;
  reserveMax: number;
  reloadSeconds: number;
  /** Minimum seconds between shots. */
  shotInterval: number;
  damage: number;
  headshotMultiplier: number;
  limbMultiplier: number;
  spread: WeaponSpreadDef;
  recoil: WeaponRecoilDef;
  ballistics: WeaponBallisticsDef;
  ads: WeaponAdsDef;
  handling: {
    sprintOutSeconds: number;
    equipSeconds: number;
    /** Spread multiplier while moving, applied smoothly. */
    moveSpreadWeight: number;
  };
  audio: {
    fire: string;
    reload: string;
    dryFire: string;
  };
  viewModel: WeaponViewModelDef;
}

export type EnemyArchetype = 'rifleman' | 'rusher' | 'heavy';

export interface EnemyBurstDef {
  burstMin: number;
  burstMax: number;
  /** Seconds between shots inside a burst. */
  shotInterval: number;
  /** Seconds the laser telegraph is held before the burst. */
  telegraphSeconds: number;
  /** Seconds of repositioning between bursts. */
  cooldownMin: number;
  cooldownMax: number;
  /** Hit chance at point-blank, before distance and evasion penalties. */
  accuracyBase: number;
  accuracyFalloffPerMetre: number;
  /** Additional accuracy lost per unit of player speed. */
  accuracyEvadePenalty: number;
  damageMin: number;
  damageMax: number;
  /** Distance at which the archetype is willing to start a burst. */
  engageRange: number;
  /** Delay in ticks between the shot leaving the barrel and damage landing. */
  damageDelayTicks: number;
}

export interface EnemyMeleeDef {
  range: number;
  lungeSpeed: number;
  lungeSeconds: number;
  damage: number;
  cooldownSeconds: number;
  /** Speed penalty applied while winding up. */
  windupSeconds: number;
}

export interface EnemyDef {
  id: EnemyArchetype;
  displayName: string;
  health: number;
  speed: number;
  /** Distance kept from the player while repositioning. */
  preferredRange: [number, number];
  scale: number;
  score: number;
  dropChance: number;
  /** Squad behaviour tags consumed by the M3 squad AI. */
  tactics: readonly string[];
  burst: EnemyBurstDef;
  melee?: EnemyMeleeDef;
  render: {
    bodyColor: number;
    accentColor: number;
    visorColor: number;
    nameplateHeight: number;
  };
  audio: {
    alert: string;
    hurt: string;
    death: string;
    fire: string;
  };
}

export interface SurfaceDef {
  id: string;
  displayName: string;
  /** Particles spawned on impact. */
  impactColor: number;
  decalColor: number;
  decalOpacity: number;
  decalSize: number;
  /** 0..1 chance a hit ricochets off this surface. */
  ricochetChance: number;
  /** Metres of penetration lost when passing through. */
  penetrationLoss: number;
  audio: string;
}

export interface DifficultyDef {
  id: 'recruit' | 'regular' | 'hardened' | 'veteran';
  displayName: string;
  enemyHealthMultiplier: number;
  enemyDamageMultiplier: number;
  enemyAccuracyMultiplier: number;
  playerHealth: number;
  regenDelaySeconds: number;
  regenPerSecond: number;
  /** Multiplies the resupply granted between waves. */
  resupplyMultiplier: number;
}

export interface PickupDef {
  id: 'medkit' | 'ammo';
  displayName: string;
  amount: number;
  color: number;
  lifetimeSeconds: number;
  pickupRadius: number;
  weight: number;
}

export interface RankDef {
  id: string;
  label: string;
  minScore: number;
  /** Optional accuracy gate, e.g. the S rank needs skill, not just volume. */
  minAccuracy: number;
}

export type PropKind =
  | 'building'
  | 'wall'
  | 'crate'
  | 'barrel'
  | 'jersey'
  | 'planter'
  | 'kiosk'
  | 'sandbags'
  | 'wreck'
  | 'lamp'
  | 'pole'
  | 'tire'
  | 'rock'
  | 'puddle'
  | 'monument'
  | 'banner'
  | 'skyline'
  | 'firepit';

export interface PropDef {
  kind: PropKind;
  x: number;
  z: number;
  /** Yaw in radians. */
  ry?: number;
  /** Size meaning depends on kind: width / radius / cube size. */
  size?: number;
  height?: number;
  depth?: number;
  variant?: number;
  burning?: boolean;
  tag?: string;
}

export interface GateDef {
  x: number;
  z: number;
  /** Which axis the wall runs along; the gap opens perpendicular to it. */
  axis: 'x' | 'z';
}

export interface MapDef {
  id: string;
  name: string;
  /** Playable bounds; the simulation clamps movement to these. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  playerSpawn: { x: number; z: number; yaw: number };
  groundSurface: string;
  props: readonly PropDef[];
  gates: readonly GateDef[];
  ambient: {
    /** Campfire / burning wreck light source. */
    fireLight: [number, number, number];
    smokeColumns: readonly [number, number, number][];
    dustEnabled: boolean;
    skylineCount: number;
    rockCount: number;
    fogDensity: number;
  };
}

export type ObjectiveKind =
  | 'eliminate'
  | 'survive'
  | 'reach'
  | 'defend'
  | 'escort'
  | 'destroy'
  | 'extract';

export interface ObjectiveDef {
  id: string;
  kind: ObjectiveKind;
  label: string;
  /** HUD line shown while this objective is active. */
  hudText: string;
  optional: boolean;
  params: {
    /** eliminate/destroy: how many. */
    count?: number;
    /** survive: how many waves. */
    waves?: number;
    /** reach/defend/escort: zone centre + radius. */
    zone?: { x: number; z: number; radius: number };
    /** defend: seconds the zone must be held. */
    holdSeconds?: number;
    /** Optional enemy archetype filter. */
    archetype?: EnemyArchetype;
  };
}

export interface WaveDef {
  /** 1-based. */
  index: number;
  label: string;
  subtitle: string;
  composition: { rifleman: number; rusher: number; heavy: number };
  /** Seconds between individual spawns. */
  spawnIntervalSeconds: number;
  /** Seconds of breathing room before the next wave. */
  intermissionSeconds: number;
  resupply: { reserveAmmo: number; grenades: number };
}

export interface MissionDef {
  id: string;
  /** Chapter grouping for mission select. */
  chapter: string;
  title: string;
  codename: string;
  subtitle: string;
  brief: readonly string[];
  mapId: string;
  startingWeapon: string;
  startingGrenades: number;
  objectives: readonly ObjectiveDef[];
  waves: readonly WaveDef[];
  /** Wave indices that snapshot a checkpoint. */
  checkpoints: readonly number[];
  musicCues: readonly string[];
}
