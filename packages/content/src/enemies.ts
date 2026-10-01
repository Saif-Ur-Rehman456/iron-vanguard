import type { EnemyDef } from './types';

/** Enemy archetypes. `parity:` values come from the prototype's createEnemy(). */
export const ENEMIES: readonly EnemyDef[] = [
  {
    id: 'rifleman',
    displayName: 'RIFLEMAN',
    health: 100, // parity
    speed: 3.2, // parity
    preferredRange: [10, 16], // parity: pickMovePoint(10,16)
    scale: 1,
    score: 100, // parity
    dropChance: 0.3, // parity
    tactics: ['hold', 'advance', 'suppress'],
    burst: {
      burstMin: 3,
      burstMax: 4, // parity: 3 + (random*2|0)
      shotInterval: 0.13, // parity
      telegraphSeconds: 0.45, // parity: aim timer
      cooldownMin: 0.9, // parity
      cooldownMax: 1.7, // parity
      accuracyBase: 0.42, // parity
      accuracyFalloffPerMetre: 0.008, // parity
      accuracyEvadePenalty: 0.14, // parity: sprint evasion
      damageMin: 6, // parity
      damageMax: 10, // parity
      engageRange: 26, // parity
      damageDelayTicks: 4, // parity: 70ms setTimeout → ticks
    },
    render: { bodyColor: 0x4c4a3e, accentColor: 0x22241f, visorColor: 0xff5a2a, nameplateHeight: 2.2 },
    audio: { alert: 'voice_enemy_alert', hurt: 'voice_enemy_hurt', death: 'voice_enemy_death', fire: 'wpn_enemy_fire' },
  },
  {
    id: 'rusher',
    displayName: 'RUSHER',
    health: 70, // parity
    speed: 5.4, // parity
    preferredRange: [0, 2],
    scale: 1,
    score: 120, // parity
    dropChance: 0.3,
    tactics: ['rush', 'flank'],
    burst: {
      burstMin: 0,
      burstMax: 0,
      shotInterval: 0.13,
      telegraphSeconds: 0,
      cooldownMin: 1,
      cooldownMax: 1,
      accuracyBase: 0,
      accuracyFalloffPerMetre: 0,
      accuracyEvadePenalty: 0,
      damageMin: 0,
      damageMax: 0,
      engageRange: 0,
      damageDelayTicks: 0,
    },
    melee: {
      range: 2.6, // parity
      lungeSpeed: 9, // parity
      lungeSeconds: 0.3, // parity
      damage: 24, // parity
      cooldownSeconds: 1.1, // parity
      windupSeconds: 0,
    },
    render: { bodyColor: 0x4a3a30, accentColor: 0x22241f, visorColor: 0xff7a3a, nameplateHeight: 2.2 },
    audio: { alert: 'voice_rusher_scream', hurt: 'voice_enemy_hurt', death: 'voice_enemy_death', fire: 'melee_swish' },
  },
  {
    id: 'heavy',
    displayName: 'HEAVY',
    health: 260, // parity
    speed: 2.1, // parity
    preferredRange: [12, 20], // parity: pickMovePoint(12,20)
    scale: 1.18, // parity
    score: 250, // parity
    dropChance: 0.3,
    tactics: ['hold', 'suppress', 'anchor'],
    burst: {
      burstMin: 4,
      burstMax: 4, // parity
      shotInterval: 0.18, // parity
      telegraphSeconds: 0.45,
      cooldownMin: 1.4, // parity
      cooldownMax: 2.2, // parity
      accuracyBase: 0.4,
      accuracyFalloffPerMetre: 0.007,
      accuracyEvadePenalty: 0.12,
      damageMin: 10, // parity
      damageMax: 14, // parity
      engageRange: 30, // parity
      damageDelayTicks: 4,
    },
    render: { bodyColor: 0x33393c, accentColor: 0x22241f, visorColor: 0xff3c14, nameplateHeight: 2.35 },
    audio: { alert: 'voice_heavy_alert', hurt: 'voice_enemy_hurt', death: 'voice_enemy_death', fire: 'wpn_heavy_fire' },
  },
];

export const ENEMIES_BY_ID: Readonly<Record<string, EnemyDef>> = Object.fromEntries(
  ENEMIES.map((e) => [e.id, e]),
);

export function getEnemy(id: string): EnemyDef {
  const enemy = ENEMIES_BY_ID[id];
  if (!enemy) throw new Error(`unknown enemy id: ${id}`);
  return enemy;
}
