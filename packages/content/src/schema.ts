/**
 * Content contract validation.
 *
 * Types protect us at compile time; this protects us at load time so a bad data
 * edit produces one clear error instead of a black screen mid-mission. The
 * cross-reference pass catches what types cannot: dangling ids.
 */
import { z } from 'zod';
import { ENEMIES } from './enemies';
import { MAPS } from './maps/plaza';
import { MISSIONS } from './missions/00_prologue';
import { PICKUPS, RANKS } from './pickups';
import { DIFFICULTIES } from './difficulty';
import { SURFACES } from './surfaces';
import { LOADOUT, WEAPONS, WEAPONS_BY_ID } from './weapons';

const nonNegative = z.number().nonnegative();
const positive = z.number().positive();

export const WeaponSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  hudName: z.string().min(1),
  magazine: positive,
  reserveMax: positive,
  reloadSeconds: positive,
  shotInterval: positive,
  damage: positive,
  headshotMultiplier: z.number().min(1),
});

export const EnemySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  health: positive,
  speed: positive,
  score: nonNegative,
  dropChance: z.number().min(0).max(1),
  burst: z.object({
    shotInterval: nonNegative,
    telegraphSeconds: nonNegative,
    damageMin: nonNegative,
    damageMax: nonNegative,
    engageRange: nonNegative,
    damageDelayTicks: z.number().int().nonnegative(),
  }),
});

export const MapSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bounds: z.object({ minX: z.number(), maxX: z.number(), minZ: z.number(), maxZ: z.number() }),
  playerSpawn: z.object({ x: z.number(), z: z.number(), yaw: z.number() }),
  props: z.array(z.object({ kind: z.string().min(1), x: z.number(), z: z.number() })).min(1),
  gates: z.array(z.object({ x: z.number(), z: z.number(), axis: z.enum(['x', 'z']) })).min(1),
});

export const MissionSchema = z.object({
  id: z.string().min(1),
  chapter: z.string().min(1),
  title: z.string().min(1),
  codename: z.string().min(1),
  mapId: z.string().min(1),
  startingWeapon: z.string().min(1),
  objectives: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1) })).min(1),
  waves: z.array(z.object({ index: z.number().int().positive() })).min(1),
});

export interface ContentIssue {
  where: string;
  message: string;
}

/** Validate every content table plus the cross-references between them. */
export function validateContent(): ContentIssue[] {
  const issues: ContentIssue[] = [];

  const check = (where: string, schema: z.ZodTypeAny, value: unknown): void => {
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({ where, message: `${issue.path.join('.') || '<root>'}: ${issue.message}` });
      }
    }
  };

  for (const weapon of WEAPONS) check(`weapon:${weapon.id}`, WeaponSchema, weapon);
  for (const enemy of ENEMIES) check(`enemy:${enemy.id}`, EnemySchema, enemy);
  for (const map of MAPS) check(`map:${map.id}`, MapSchema, map);
  for (const mission of MISSIONS) check(`mission:${mission.id}`, MissionSchema, mission);

  // ---- cross-reference pass -------------------------------------------------
  const uniqueIds = (label: string, list: readonly { id: string }[]): void => {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) issues.push({ where: label, message: `duplicate id: ${item.id}` });
      seen.add(item.id);
    }
  };
  uniqueIds('weapons', WEAPONS);
  uniqueIds('enemies', ENEMIES);
  uniqueIds('maps', MAPS);
  uniqueIds('missions', MISSIONS);
  uniqueIds('surfaces', SURFACES);
  uniqueIds('difficulties', DIFFICULTIES);
  uniqueIds('pickups', PICKUPS);
  uniqueIds('ranks', RANKS);

  // The loadout is content, so it is validated like content: a slot that names a
  // weapon nobody defined would throw at world creation, which is a black screen one
  // frame into a mission rather than an error at load.
  for (const id of LOADOUT) {
    if (!WEAPONS_BY_ID[id]) issues.push({ where: 'loadout', message: `unknown weapon id "${id}"` });
  }
  if (LOADOUT.length === 0) issues.push({ where: 'loadout', message: 'the loadout is empty' });

  const mapIds = new Set(MAPS.map((m) => m.id));
  const objectiveIds = new Set<string>();

  for (const mission of MISSIONS) {
    if (!mapIds.has(mission.mapId)) {
      issues.push({ where: `mission:${mission.id}`, message: `unknown mapId "${mission.mapId}"` });
    }
    if (!WEAPONS_BY_ID[mission.startingWeapon]) {
      issues.push({
        where: `mission:${mission.id}`,
        message: `unknown startingWeapon "${mission.startingWeapon}"`,
      });
    }
    for (const objective of mission.objectives) {
      const key = `${mission.id}/${objective.id}`;
      if (objectiveIds.has(key)) {
        issues.push({ where: `mission:${mission.id}`, message: `duplicate objective id ${objective.id}` });
      }
      objectiveIds.add(key);
      if (objective.kind === 'survive' && !objective.params.waves) {
        issues.push({ where: `mission:${mission.id}/${objective.id}`, message: 'survive needs params.waves' });
      }
      if ((objective.kind === 'reach' || objective.kind === 'extract' || objective.kind === 'defend') && !objective.params.zone) {
        issues.push({ where: `mission:${mission.id}/${objective.id}`, message: `${objective.kind} needs params.zone` });
      }
    }
    for (let i = 0; i < mission.waves.length; i++) {
      const wave = mission.waves[i]!;
      if (wave.index !== i + 1) {
        issues.push({ where: `mission:${mission.id}`, message: `wave at position ${i} has index ${wave.index}` });
      }
      const total =
        wave.composition.rifleman + wave.composition.rusher + wave.composition.heavy;
      if (total <= 0) {
        issues.push({ where: `mission:${mission.id}/wave${wave.index}`, message: 'wave has no enemies' });
      }
      if (wave.spawnIntervalSeconds <= 0) {
        issues.push({ where: `mission:${mission.id}/wave${wave.index}`, message: 'spawnIntervalSeconds must be > 0' });
      }
    }
    for (const checkpoint of mission.checkpoints) {
      if (!mission.waves.some((w) => w.index === checkpoint)) {
        issues.push({ where: `mission:${mission.id}`, message: `checkpoint wave ${checkpoint} does not exist` });
      }
    }
    for (const objective of mission.objectives) {
      if (objective.kind === 'survive' && objective.params.waves && objective.params.waves > mission.waves.length) {
        issues.push({
          where: `mission:${mission.id}/${objective.id}`,
          message: `survive asks for ${objective.params.waves} waves but the mission defines ${mission.waves.length}`,
        });
      }
    }
  }

  for (const pickup of PICKUPS) {
    if (pickup.weight <= 0) issues.push({ where: `pickup:${pickup.id}`, message: 'weight must be > 0' });
  }
  for (const difficulty of DIFFICULTIES) {
    if (difficulty.regenDelaySeconds < 0 || difficulty.regenPerSecond < 0) {
      issues.push({ where: `difficulty:${difficulty.id}`, message: 'regen values must be >= 0' });
    }
  }
  for (let i = 1; i < RANKS.length; i++) {
    if (RANKS[i]!.minScore >= RANKS[i - 1]!.minScore) {
      issues.push({ where: 'ranks', message: 'rank thresholds must be strictly descending' });
    }
  }

  return issues;
}

export function assertContentValid(): void {
  const issues = validateContent();
  if (issues.length === 0) return;
  const lines = issues.map((i) => `  - ${i.where}: ${i.message}`).join('\n');
  throw new Error(`content validation failed (${issues.length} issues):\n${lines}`);
}
