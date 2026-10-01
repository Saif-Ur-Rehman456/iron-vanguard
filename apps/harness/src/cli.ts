/**
 * Headless harness.
 *
 * This is the project's ability to *measure* the game without a browser:
 *  - `run`     one deterministic mission with the scripted bot, printing a report
 *  - `hash`    the per-second quantised state hash trace (golden replays)
 *  - `replay`  verify a saved hash trace against a fresh run
 *  - `sweep`   balance sweeps across seeds/difficulties
 *  - `bench`   simulation throughput gate (must sustain >= 100x realtime)
 *  - `validate` content contract check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  HashTrace,
  buildStats,
  createWorld,
  hashWorld,
  stepWorld,
  type World,
  type WorldConfig,
} from '@iron/sim';
import { validateContent } from '@iron/content';
import { ScriptedBot, balanceReport, type BalanceReport } from '@iron/tools';

interface Args {
  command: string;
  mission: string;
  difficulty: string;
  seed: number;
  seconds: number;
  seeds: number;
  out?: string;
  golden?: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command = 'run', ...rest] = argv;
  // Accepts both `--seed 7` and `--seed=7`; a tool that silently ignores half
  // the flags it documents is worse than one that rejects them.
  const get = (name: string, fallback: string): string => {
    const flag = `--${name}`;
    const inline = rest.find((a) => a.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = rest.findIndex((a) => a === flag);
    return index >= 0 && rest[index + 1] ? rest[index + 1]! : fallback;
  };
  const has = (name: string): boolean =>
    rest.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return {
    command,
    mission: get('mission', 'm00_prologue'),
    difficulty: get('difficulty', 'regular'),
    seed: Number(get('seed', '7')),
    seconds: Number(get('seconds', '300')),
    seeds: Number(get('seeds', '8')),
    out: has('out') ? get('out', '') : undefined,
    golden: has('golden') ? get('golden', '') : undefined,
    quiet: has('quiet'),
  };
}

/** The scripted player lives in @iron/tools so sweeps, tests and the CLI share it. */
const bot = new ScriptedBot();
function botInput(world: World): ReturnType<ScriptedBot['tick']> {
  return bot.tick(world);
}

interface RunResult {
  world: World;
  ticks: number;
  completeTick: number | null;
  failedTick: number | null;
  trace: HashTrace;
}

function runMission(config: WorldConfig, seconds: number, sampleTrace: boolean): RunResult {
  const world = createWorld(config);
  const trace = new HashTrace();
  const ticks = Math.round(seconds * 60);
  let completeTick: number | null = null;
  let failedTick: number | null = null;

  for (let i = 0; i < ticks; i++) {
    if (world.missionComplete || world.missionFailed) break;
    const { input, actions } = botInput(world);
    stepWorld(world, input, actions);
    if (sampleTrace) trace.maybeSample(world);
    if (world.missionComplete && completeTick === null) completeTick = world.tick;
    if (world.missionFailed && failedTick === null) failedTick = world.tick;
  }
  return { world, ticks, completeTick, failedTick, trace };
}

function printRunReport(args: Args, result: RunResult): void {
  const stats = buildStats(result.world);
  const seconds = Math.round(stats.elapsedTicks / 60);
  const lines = [
    `mission        ${args.mission}   difficulty ${args.difficulty}   seed ${args.seed}`,
    `outcome        ${result.world.missionComplete ? 'COMPLETE' : result.world.missionFailed ? 'FAILED' : 'TIMEOUT'}`,
    `elapsed        ${seconds}s (${stats.elapsedTicks} ticks)`,
    `waves cleared  ${stats.wavesCleared}/${result.world.waves.length}`,
    `kills          ${stats.kills}   headshots ${stats.headshots}`,
    `accuracy       ${stats.accuracyPercent.toFixed(1)}%  (${stats.shotsHit}/${stats.shotsFired})`,
    `score          ${stats.score}`,
    `player health  ${Math.round(result.world.player.health)}`,
    `state hash     ${hashWorld(result.world)}`,
  ];
  console.log(lines.join('\n'));
}

const args = parseArgs(process.argv.slice(2));
const config: WorldConfig = {
  seed: args.seed,
  missionId: args.mission,
  difficultyId: args.difficulty,
};

switch (args.command) {
  case 'run': {
    const result = runMission(config, args.seconds, true);
    printRunReport(args, result);
    if (args.out) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true });
      writeFileSync(resolve(args.out), JSON.stringify(result.trace.samples, null, 2));
      console.log(`trace written  ${args.out}`);
    }
    process.exit(result.world.missionComplete ? 0 : result.world.missionFailed ? 2 : 3);
    break;
  }

  case 'hash': {
    const result = runMission(config, args.seconds, true);
    const lines = result.trace.toLines();
    if (args.out) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true });
      writeFileSync(resolve(args.out), `${lines.join('\n')}\n`);
      if (!args.quiet) console.log(`wrote ${lines.length} hash samples to ${args.out}`);
    } else {
      console.log(lines.join('\n'));
    }
    break;
  }

  case 'replay': {
    const goldenPath = args.golden ?? args.out ?? 'tests/golden/prologue.seed7.hash';
    if (!existsSync(resolve(goldenPath))) {
      console.error(`golden trace not found: ${goldenPath}`);
      console.error('record one with: npm run hash -- --seed=7 --seconds=400 --out=tests/golden/prologue.seed7.hash');
      process.exit(1);
    }
    const expected = readFileSync(resolve(goldenPath), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [tick, hash] = line.split(' ');
        return { tick: Number(tick), hash: hash ?? '' };
      });
    const result = runMission(config, args.seconds, true);
    const actual = result.trace.samples;
    let mismatches = 0;
    const limit = Math.min(expected.length, actual.length);
    for (let i = 0; i < limit; i++) {
      if (expected[i]!.hash !== actual[i]!.hash) {
        mismatches++;
        if (mismatches <= 5) {
          console.error(
            `mismatch at tick ${expected[i]!.tick}: expected ${expected[i]!.hash}, got ${actual[i]!.hash}`,
          );
        }
      }
    }
    if (expected.length !== actual.length) {
      console.error(`trace length differs: golden ${expected.length} vs run ${actual.length}`);
      mismatches++;
    }
    if (mismatches === 0) {
      console.log(`replay verified: ${limit} samples match ${goldenPath}`);
      process.exit(0);
    }
    console.error(`replay FAILED with ${mismatches} mismatches`);
    console.error('If the gameplay change was intentional, re-record the golden and explain it in the commit.');
    process.exit(1);
    break;
  }

  case 'sweep': {
    const reports: BalanceReport[] = [];
    for (let i = 0; i < args.seeds; i++) {
      const report = balanceReport({
        seed: 100 + i * 17,
        missionId: args.mission,
        difficultyId: args.difficulty,
        seconds: args.seconds,
      });
      reports.push(report);
      console.log(
        `seed ${report.seed}  ${report.outcome.padEnd(8)}  ${String(Math.round(report.seconds)).padStart(4)}s  ` +
          `kills ${String(report.kills).padStart(3)}  acc ${report.accuracy.toFixed(0).padStart(3)}%  ` +
          `score ${String(report.score).padStart(5)}  health ${String(Math.round(report.endHealth)).padStart(3)}`,
      );
    }
    const completed = reports.filter((r) => r.outcome === 'COMPLETE');
    const average = (values: number[]): number =>
      values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    console.log(
      `\ncompletion ${completed.length}/${reports.length}  ` +
        `avg time ${average(completed.map((r) => r.seconds)).toFixed(1)}s  ` +
        `avg accuracy ${average(reports.map((r) => r.accuracy)).toFixed(1)}%  ` +
        `avg end health ${average(reports.map((r) => r.endHealth)).toFixed(1)}`,
    );
    if (args.out) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true });
      writeFileSync(resolve(args.out), JSON.stringify(reports, null, 2));
      console.log(`report written ${args.out}`);
    }
    break;
  }

  case 'bench': {
    // Simulation throughput gate (docs/PERF_BUDGET.md).
    //
    // Method matters more than the number: a single cold run measured anything
    // from 85x to 141x realtime on the same commit because V8 JITs the tick loop
    // for the first second. So: warm up, then take the best of several samples
    // (the fastest sample is the least noisy estimate of steady-state cost).
    const benchWorld = createWorld(config);
    const warmup = 600;
    for (let i = 0; i < warmup; i++) {
      const { input, actions } = botInput(benchWorld);
      stepWorld(benchWorld, input, actions);
    }

    const iterations = 60 * 30; // 30 simulated seconds per sample
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const { input, actions } = botInput(benchWorld);
        stepWorld(benchWorld, input, actions);
      }
      samples.push(iterations / ((performance.now() - start) / 1000));
    }

    const best = Math.max(...samples);
    const median = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
    const ratio = best / 60;
    console.log(
      `bot + simulation: median ${Math.round(median)} ticks/s, best ${Math.round(best)} ticks/s  ` +
        `(${samples.length} samples of ${iterations} ticks)  →  ${ratio.toFixed(0)}x realtime`,
    );
    if (ratio < 60) {
      console.error('simulation budget failed: needs >= 60x realtime headroom');
      process.exit(1);
    }
    console.log('simulation budget OK');
    break;
  }

  case 'validate': {
    const issues = validateContent();
    if (issues.length > 0) {
      for (const issue of issues) console.error(`${issue.where}: ${issue.message}`);
      process.exit(1);
    }
    console.log('content OK');
    break;
  }

  default:
    console.error(`unknown command: ${args.command}`);
    console.error('commands: run | hash | replay | sweep | bench | validate');
    process.exit(1);
}
