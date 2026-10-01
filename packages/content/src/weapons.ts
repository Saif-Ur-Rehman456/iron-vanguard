import type { WeaponDef } from './types';

/**
 * Weapon table. Values marked `parity:` are lifted from the prototype
 * (legacy/PARITY_NOTES.md) and must not drift without re-recording goldens.
 *
 * The squad carries three, one per slot, and slot 2 is the rifle the mission opens
 * with: a Desert Eagle (1), the M4 (2), an AK-47 (3). The order is the loadout, so
 * it is content rather than a UI decision — and the *numbers* are what make the
 * three feel like three weapons rather than three skins: the pistol hits hardest per
 * shot with the worst recovery, the AK trades control for damage and a slower
 * magazine change, and the M4 stays the middle.
 */
export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'm4_vanguard',
    displayName: 'M4 Vanguard',
    hudName: 'M4 “VANGUARD” — 5.56 AUTO',
    class: 'rifle',
    fireMode: 'auto',
    magazine: 30, // parity
    reserveMax: 360, // parity
    reloadSeconds: 1.85, // parity
    shotInterval: 0.098, // parity
    damage: 34, // parity
    headshotMultiplier: 2.1, // parity
    limbMultiplier: 0.85,
    spread: {
      hip: 0.012, // parity
      ads: 0.0025, // parity
      movePenalty: 0.02, // parity
      sprintPenalty: 0.02, // parity
      heatPerShot: 0.14, // parity
      heatPenalty: 0.018, // parity
      heatDecayPerSecond: 1.1, // parity
      maxSpread: 0.075,
    },
    recoil: {
      pitch: 0.012, // parity
      yaw: 0.0035,
      kick: 1,
      recovery: 9,
    },
    ballistics: {
      projectile: false,
      muzzleVelocity: 880,
      penetration: 0.25,
      falloffStart: 45,
      falloffEnd: 90,
      falloffMinMultiplier: 0.7,
    },
    ads: {
      fovDeg: 42, // parity
      transitionSeconds: 0.12,
      moveMultiplier: 0.55, // parity: 45% slower while aiming
      sensitivityMultiplier: 0.55, // parity
    },
    handling: {
      sprintOutSeconds: 0.22, // parity
      equipSeconds: 0.5,
      moveSpreadWeight: 1,
    },
    audio: { fire: 'wpn_rifle_fire', reload: 'wpn_rifle_reload', dryFire: 'wpn_rifle_dry' },
    viewModel: {
      hip: [0.27, -0.26, -0.62], // parity
      ads: [0, -0.178, -0.44], // parity
      muzzleOffset: 0.9,
      body: [0.078, 0.105, 0.44],
      barrelLength: 0.36,
      magazineReserve: 3,
    },
  },
  {
    id: 'deagle',
    displayName: 'Desert Eagle',
    hudName: 'DESERT EAGLE — .50 AE SEMI',
    class: 'pistol',
    fireMode: 'semi',
    magazine: 7,
    reserveMax: 49,
    reloadSeconds: 1.95,
    // A .50 AE pistol is a *deliberate* weapon: 0.28 s between shots is the fastest
    // the slide and the sight picture come back, and it is what stops a mag-fed
    // hand-cannon from out-shooting a carbine.
    shotInterval: 0.28,
    damage: 68,
    headshotMultiplier: 2.4,
    limbMultiplier: 0.85,
    spread: {
      hip: 0.02,
      ads: 0.006,
      movePenalty: 0.03,
      sprintPenalty: 0.03,
      heatPerShot: 0.3,
      heatPenalty: 0.03,
      heatDecayPerSecond: 1.7,
      maxSpread: 0.11,
    },
    // Twice the M4's pitch and a heavy kick: the one weapon whose recoil you fight.
    recoil: { pitch: 0.026, yaw: 0.007, kick: 1.9, recovery: 7 },
    ballistics: {
      projectile: false,
      muzzleVelocity: 470,
      penetration: 0.18,
      falloffStart: 18,
      falloffEnd: 45,
      falloffMinMultiplier: 0.5,
    },
    ads: { fovDeg: 52, transitionSeconds: 0.1, moveMultiplier: 0.68, sensitivityMultiplier: 0.62 },
    handling: { sprintOutSeconds: 0.14, equipSeconds: 0.35, moveSpreadWeight: 0.6 },
    audio: { fire: 'wpn_pistol_fire', reload: 'wpn_pistol_reload', dryFire: 'wpn_pistol_dry' },
    viewModel: {
      // A pistol is held out and slightly right of centre, and it is *short*, which
      // is why the pose solver (weapon/layout.ts) is given a 30 cm eye relief: with
      // iron sights the eye is a hand's length behind the notch, not 12 cm.
      hip: [0.2, -0.25, -0.48],
      ads: [0, -0.04, -0.3],
      muzzleOffset: 0.26,
      body: [0.05, 0.155, 0.27],
      barrelLength: 0.06,
      magazineReserve: 3,
      archetype: 'pistol',
    },
  },
  {
    id: 'ak47',
    displayName: 'AK-47',
    hudName: 'AK-47 — 7.62 AUTO',
    class: 'rifle',
    fireMode: 'auto',
    magazine: 30,
    reserveMax: 300,
    // Rock-in magazines are slow: the AK is the weapon you commit to a reload with.
    reloadSeconds: 2.55,
    shotInterval: 0.1,
    damage: 44,
    headshotMultiplier: 2.2,
    limbMultiplier: 0.85,
    spread: {
      hip: 0.016,
      ads: 0.0032,
      movePenalty: 0.028,
      sprintPenalty: 0.026,
      heatPerShot: 0.19,
      heatPenalty: 0.026,
      heatDecayPerSecond: 0.85,
      maxSpread: 0.1,
    },
    recoil: { pitch: 0.018, yaw: 0.006, kick: 1.35, recovery: 7.5 },
    ballistics: {
      projectile: false,
      muzzleVelocity: 715,
      penetration: 0.42,
      falloffStart: 55,
      falloffEnd: 100,
      falloffMinMultiplier: 0.78,
    },
    ads: { fovDeg: 46, transitionSeconds: 0.14, moveMultiplier: 0.55, sensitivityMultiplier: 0.55 },
    handling: { sprintOutSeconds: 0.26, equipSeconds: 0.62, moveSpreadWeight: 1.2 },
    audio: { fire: 'wpn_rifle_heavy_fire', reload: 'wpn_rifle_heavy_reload', dryFire: 'wpn_rifle_dry' },
    viewModel: {
      hip: [0.27, -0.26, -0.6],
      ads: [0, -0.175, -0.42],
      muzzleOffset: 0.71,
      // 0.887 m overall and a 0.34 m barrel: a real AK-47, which is why the model
      // (archetype `ak`) puts a gas block over the barrel rather than a handguard.
      body: [0.084, 0.11, 0.42],
      barrelLength: 0.34,
      magazineReserve: 3,
      archetype: 'ak',
    },
  },
  {
    id: 'kr74',
    displayName: 'KR-74',
    hudName: 'KR-74 — 5.45 AUTO',
    class: 'rifle',
    fireMode: 'auto',
    magazine: 30,
    reserveMax: 300,
    reloadSeconds: 2.05,
    shotInterval: 0.092,
    damage: 32,
    headshotMultiplier: 2.0,
    limbMultiplier: 0.85,
    spread: {
      hip: 0.015,
      ads: 0.0029,
      movePenalty: 0.025,
      sprintPenalty: 0.025,
      heatPerShot: 0.155,
      heatPenalty: 0.022,
      heatDecayPerSecond: 1.0,
      maxSpread: 0.085,
    },
    recoil: { pitch: 0.015, yaw: 0.005, kick: 1.15, recovery: 8 },
    ballistics: {
      projectile: false,
      muzzleVelocity: 880,
      penetration: 0.35,
      falloffStart: 40,
      falloffEnd: 85,
      falloffMinMultiplier: 0.68,
    },
    ads: { fovDeg: 45, transitionSeconds: 0.14, moveMultiplier: 0.55, sensitivityMultiplier: 0.55 },
    handling: { sprintOutSeconds: 0.26, equipSeconds: 0.6, moveSpreadWeight: 1.15 },
    audio: { fire: 'wpn_rifle_heavy_fire', reload: 'wpn_rifle_heavy_reload', dryFire: 'wpn_rifle_dry' },
    viewModel: {
      hip: [0.27, -0.26, -0.6],
      ads: [0, -0.175, -0.42],
      muzzleOffset: 0.88,
      body: [0.082, 0.11, 0.46],
      barrelLength: 0.4,
      magazineReserve: 3,
    },
  },
  {
    id: 'vector9',
    displayName: 'Vector 9',
    hudName: 'VECTOR-9 — 9MM AUTO',
    class: 'smg',
    fireMode: 'auto',
    magazine: 25,
    reserveMax: 275,
    reloadSeconds: 1.55,
    shotInterval: 0.072,
    damage: 24,
    headshotMultiplier: 1.8,
    limbMultiplier: 0.9,
    spread: {
      hip: 0.014,
      ads: 0.0042,
      movePenalty: 0.012,
      sprintPenalty: 0.015,
      heatPerShot: 0.11,
      heatPenalty: 0.02,
      heatDecayPerSecond: 1.4,
      maxSpread: 0.07,
    },
    recoil: { pitch: 0.009, yaw: 0.004, kick: 0.8, recovery: 11 },
    ballistics: {
      projectile: false,
      muzzleVelocity: 400,
      penetration: 0.1,
      falloffStart: 22,
      falloffEnd: 50,
      falloffMinMultiplier: 0.55,
    },
    ads: { fovDeg: 48, transitionSeconds: 0.1, moveMultiplier: 0.62, sensitivityMultiplier: 0.6 },
    handling: { sprintOutSeconds: 0.16, equipSeconds: 0.4, moveSpreadWeight: 0.7 },
    audio: { fire: 'wpn_smg_fire', reload: 'wpn_smg_reload', dryFire: 'wpn_smg_dry' },
    viewModel: {
      hip: [0.25, -0.24, -0.55],
      ads: [0, -0.17, -0.38],
      muzzleOffset: 0.62,
      body: [0.07, 0.11, 0.34],
      barrelLength: 0.22,
      magazineReserve: 3,
    },
  },
];

/**
 * The squad's loadout, in slot order: 1 = Desert Eagle, 2 = M4, 3 = AK-47.
 *
 * Content rather than a UI list, because the simulation builds its weapon runtimes
 * from this (packages/sim/src/world.ts) and a loadout that lived in the app would be
 * a loadout absent from every replay and every headless run.
 */
export const LOADOUT: readonly string[] = ['deagle', 'm4_vanguard', 'ak47'];

/** Slot the mission starts on: the M4, i.e. 1-based slot 2. */
export const DEFAULT_SLOT = 2;

export const WEAPONS_BY_ID: Readonly<Record<string, WeaponDef>> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
);

export function getWeapon(id: string): WeaponDef {
  const weapon = WEAPONS_BY_ID[id];
  if (!weapon) throw new Error(`unknown weapon id: ${id}`);
  return weapon;
}
