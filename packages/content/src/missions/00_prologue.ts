import type { MissionDef, WaveDef } from '../types';

/**
 * Mission 1 — the prototype's five-wave plaza defence, promoted to a campaign
 * mission with real objectives and an extraction beat.
 *
 * Intentional deviations from the prototype (tracked in legacy/PARITY_NOTES.md):
 *  - Victory requires reaching the extraction zone instead of ending the instant
 *    wave 5 is cleared, so the objective sequence is real.
 *  - Wave subtitles/labels are data, so the HUD copy is no longer hard-coded.
 */

/** Wave composition parity: WAVES[1..5] = rifle/rush/heavy counts. */
const WAVE_COMPOSITIONS: readonly [number, number, number][] = [
  [6, 0, 0],
  [8, 2, 0],
  [9, 3, 1],
  [10, 4, 2],
  [12, 5, 3],
];

const SUBTITLES: readonly string[] = [
  'HOSTILES INBOUND — HOLD THE PLAZA',
  'RUSHERS INBOUND',
  'HEAVY UNITS DETECTED',
  'MULTIPLE CONTACTS — ALL GATES',
  'FINAL ASSAULT',
];

export const WAVES: readonly WaveDef[] = WAVE_COMPOSITIONS.map(([rifleman, rusher, heavy], i) => ({
  index: i + 1,
  label: i + 1 === WAVE_COMPOSITIONS.length ? 'FINAL ASSAULT' : `WAVE ${i + 1} / ${WAVE_COMPOSITIONS.length}`,
  subtitle: SUBTITLES[i] ?? '',
  composition: { rifleman, rusher, heavy },
  spawnIntervalSeconds: 0.75, // parity
  intermissionSeconds: 4.5, // parity
  resupply: { reserveAmmo: 120, grenades: 1 }, // parity
}));

export const TOTAL_HOSTILES = WAVES.reduce(
  (sum, w) => sum + w.composition.rifleman + w.composition.rusher + w.composition.heavy,
  0,
);

export const MISSION_00_PROLOGUE: MissionDef = {
  id: 'm00_prologue',
  chapter: 'CHAPTER I — BLACKOUT',
  title: 'IRON VANGUARD',
  codename: 'OPERATION BLACKOUT',
  subtitle: 'DEFEND THE PLAZA',
  brief: [
    'The plaza is the last defensible position. Hostile infantry is massing at the four perimeter gates.',
    'Enemy teams fire in bursts — a red targeting laser telegraphs every attack: break line of sight or strafe when you see it.',
    'RUSHERS close for melee — keep distance. HEAVIES absorb punishment — aim for the head.',
    'Red fuel barrels are volatile. Medkits and ammo drop from kills. Resupply between waves. Hold the plaza, Sergeant.',
  ],
  mapId: 'plaza_alpha',
  startingWeapon: 'm4_vanguard',
  startingGrenades: 2, // parity
  objectives: [
    {
      id: 'obj_hold_plaza',
      kind: 'survive',
      label: 'HOLD THE PLAZA',
      hudText: 'ELIMINATE ALL HOSTILES',
      optional: false,
      params: { waves: WAVES.length },
    },
    {
      id: 'obj_extract',
      kind: 'extract',
      label: 'REACH EXTRACTION',
      hudText: 'REACH THE EXTRACTION POINT — NORTH GATE',
      optional: false,
      params: { zone: { x: 0, z: 56, radius: 6 } },
    },
  ],
  waves: WAVES,
  checkpoints: [3], // snapshot after wave 3
  musicCues: ['music_combat_low', 'music_combat_high', 'music_victory'],
};

export const MISSIONS: readonly MissionDef[] = [MISSION_00_PROLOGUE];

export function getMission(id: string): MissionDef {
  const mission = MISSIONS.find((m) => m.id === id);
  if (!mission) throw new Error(`unknown mission id: ${id}`);
  return mission;
}
