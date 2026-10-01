/**
 * Balance sweeps.
 *
 * Every tuning change should ship with a sweep: how long does the mission take,
 * how often does the bot die, how much ammo is left. Numbers like this are the
 * difference between tuning and guessing (docs/BALANCE.md).
 */
import { buildStats, createWorld, stepWorld, type WorldConfig } from '@iron/sim';
import { ScriptedBot } from './bot';

export interface BalanceReport {
  seed: number;
  missionId: string;
  difficultyId: string;
  outcome: 'COMPLETE' | 'FAILED' | 'TIMEOUT';
  seconds: number;
  ticks: number;
  wavesCleared: number;
  kills: number;
  headshots: number;
  accuracy: number;
  score: number;
  endHealth: number;
  ammoSpent: number;
}

/** Starting reserve, used to report ammo consumption per run. */
const STARTING_RESERVE = 240;

export function balanceReport(config: WorldConfig & { seconds?: number }): BalanceReport {
  const world = createWorld({
    seed: config.seed,
    missionId: config.missionId,
    difficultyId: config.difficultyId,
  });
  const bot = new ScriptedBot();
  const ticks = Math.round((config.seconds ?? 300) * 60);

  for (let i = 0; i < ticks; i++) {
    if (world.missionComplete || world.missionFailed) break;
    const { input, actions } = bot.tick(world);
    stepWorld(world, input, actions);
  }

  const stats = buildStats(world);
  return {
    seed: config.seed,
    missionId: config.missionId,
    difficultyId: config.difficultyId,
    outcome: world.missionComplete ? 'COMPLETE' : world.missionFailed ? 'FAILED' : 'TIMEOUT',
    seconds: stats.elapsedTicks / 60,
    ticks: stats.elapsedTicks,
    wavesCleared: stats.wavesCleared,
    kills: stats.kills,
    headshots: stats.headshots,
    accuracy: stats.accuracyPercent,
    score: stats.score,
    endHealth: world.player.health,
    ammoSpent: STARTING_RESERVE - world.player.weapon.reserve,
  };
}

export interface SweepSummary {
  reports: BalanceReport[];
  completion: number;
  averageSeconds: number;
  averageAccuracy: number;
  averageEndHealth: number;
}

/** Sweep several seeds and report the distribution, not just the average. */
export function sweep(
  base: WorldConfig & { seeds?: number; seconds?: number },
): SweepSummary {
  const count = base.seeds ?? 8;
  const reports: BalanceReport[] = [];
  for (let i = 0; i < count; i++) {
    reports.push(balanceReport({ ...base, seed: 100 + i * 17 }));
  }
  const completed = reports.filter((r) => r.outcome === 'COMPLETE');
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    reports,
    completion: reports.length === 0 ? 0 : completed.length / reports.length,
    averageSeconds: mean(completed.map((r) => r.seconds)),
    averageAccuracy: mean(reports.map((r) => r.accuracy)),
    averageEndHealth: mean(reports.map((r) => r.endHealth)),
  };
}
