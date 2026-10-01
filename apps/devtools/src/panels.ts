/**
 * Dev-tools panels.
 *
 * Each panel is a pure function from data to DOM, so the same code can be
 * rendered in the browser app and asserted in a test. Nothing here mutates game
 * content: these are read-only views of the same modules the game ships.
 */
import {
  DIFFICULTIES,
  ENEMIES,
  MAPS,
  MISSIONS,
  PICKUPS,
  RANKS,
  TOTAL_HOSTILES,
  WEAPONS,
  getMission,
} from '@iron/content';
import { TICK_HZ, createRngStreams } from '@iron/core';
import { createWorld, hashSeed, hashWorld, stepWorld } from '@iron/sim';
import { ScriptedBot, sweep, validateAll, type BalanceReport } from '@iron/tools';

export interface Panel {
  id: string;
  title: string;
  description: string;
  render: (host: HTMLElement) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function table(headers: string[], rows: (string | number)[][]): HTMLElement {
  const node = el('table', 'iv-table');
  node.innerHTML =
    `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows
      .map((row) => `<tr>${row.map((cell) => `<td>${String(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody>`;
  return node;
}

// ---------------------------------------------------------------------------
// Content audit
// ---------------------------------------------------------------------------

export const contentPanel: Panel = {
  id: 'content',
  title: 'CONTENT AUDIT',
  description: 'Every weapon, hostile, wave and map issue in one table set.',
  render(host) {
    const summary = validateAll();
    const status = el('div', summary.ok ? 'iv-ok' : 'iv-bad');
    status.textContent = summary.ok
      ? `PASS — ${WEAPONS.length} weapons, ${ENEMIES.length} hostiles, ${MAPS.length} maps, ${MISSIONS.length} missions`
      : `FAIL — ${summary.content.length} content issues, ${summary.maps.filter((m) => m.severity === 'error').length} map errors`;
    host.append(status);

    if (summary.content.length > 0) {
      host.append(
        el('h3', undefined, 'Content issues'),
        table(
          ['where', 'message'],
          summary.content.map((issue) => [issue.where, issue.message]),
        ),
      );
    }
    if (summary.maps.length > 0) {
      host.append(
        el('h3', undefined, 'Map issues'),
        table(
          ['map', 'severity', 'message'],
          summary.maps.map((issue) => [issue.mapId, issue.severity, issue.message]),
        ),
      );
    }

    host.append(
      el('h3', undefined, 'Weapons'),
      table(
        ['id', 'class', 'mag', 'dmg', 'head', 'rpm', 'falloff'],
        WEAPONS.map((w) => [
          w.id,
          w.class,
          w.magazine,
          w.damage,
          `${w.headshotMultiplier}x`,
          Math.round(60 / w.shotInterval),
          `${w.ballistics.falloffStart}–${w.ballistics.falloffEnd} m`,
        ]),
      ),
      el('h3', undefined, 'Hostiles'),
      table(
        ['id', 'hp', 'speed', 'burst', 'dmg/shot', 'accuracy', 'score'],
        ENEMIES.map((e) => [
          e.id,
          e.health,
          e.speed,
          e.burst.burstMax > 0 ? `${e.burst.burstMin}–${e.burst.burstMax}` : 'melee',
          e.burst.burstMax > 0 ? `${e.burst.damageMin}–${e.burst.damageMax}` : e.melee?.damage ?? 0,
          e.burst.burstMax > 0 ? e.burst.accuracyBase.toFixed(2) : '—',
          e.score,
        ]),
      ),
      el('h3', undefined, 'Waves'),
      table(
        ['mission', 'wave', 'rifleman', 'rusher', 'heavy', 'total'],
        getMission('m00_prologue').waves.map((w) => [
          w.index,
          w.label,
          w.composition.rifleman,
          w.composition.rusher,
          w.composition.heavy,
          w.composition.rifleman + w.composition.rusher + w.composition.heavy,
        ]),
      ),
      el('h3', undefined, 'Difficulty & ranks'),
      table(
        ['difficulty', 'enemy hp', 'enemy dmg', 'accuracy', 'player hp', 'regen'],
        DIFFICULTIES.map((d) => [
          d.id,
          `${d.enemyHealthMultiplier}x`,
          `${d.enemyDamageMultiplier}x`,
          `${d.enemyAccuracyMultiplier}x`,
          d.playerHealth,
          `${d.regenPerSecond}/s after ${d.regenDelaySeconds}s`,
        ]),
      ),
      table(
        ['rank', 'min score', 'min accuracy'],
        RANKS.map((r) => [r.label, r.minScore, `${r.minAccuracy}%`]),
      ),
      table(
        ['pickup', 'amount', 'lifetime', 'weight'],
        PICKUPS.map((p) => [p.id, p.amount, `${p.lifetimeSeconds}s`, p.weight]),
      ),
      el('p', 'iv-note', `Total hostiles across the campaign slice: <b>${TOTAL_HOSTILES}</b>`),
    );
  },
};

// ---------------------------------------------------------------------------
// Balance sweep
// ---------------------------------------------------------------------------

function outcomeClass(report: BalanceReport): string {
  return report.outcome === 'COMPLETE' ? 'iv-ok' : report.outcome === 'FAILED' ? 'iv-bad' : 'iv-warn';
}

export const balancePanel: Panel = {
  id: 'balance',
  title: 'BALANCE SWEEP',
  description:
    'Runs the scripted player headlessly across seeds and difficulties. The bot is the baseline: if it cannot finish, a human probably cannot either.',
  render(host) {
    const controls = el('div', 'iv-controls');
    const difficulty = el('select');
    for (const d of DIFFICULTIES) {
      const option = el('option');
      option.value = d.id;
      option.textContent = d.displayName;
      difficulty.append(option);
    }
    const seedCount = el('input');
    seedCount.type = 'number';
    seedCount.min = '1';
    seedCount.max = '24';
    seedCount.value = '6';
    const seconds = el('input');
    seconds.type = 'number';
    seconds.min = '60';
    seconds.max = '900';
    seconds.value = '400';
    const run = el('button', 'iv-btn');
    run.textContent = 'RUN SWEEP';

    const label = (text: string, input: HTMLElement): HTMLElement => {
      const wrap = el('label', 'iv-field');
      wrap.append(document.createTextNode(text), input);
      return wrap;
    };
    controls.append(
      label('DIFFICULTY', difficulty),
      label('SEEDS', seedCount),
      label('SECONDS', seconds),
      run,
    );

    const output = el('div');
    host.append(controls, output);

    run.addEventListener('click', () => {
      output.replaceChildren(el('p', 'iv-note', 'Running… (this blocks the main thread; that is fine for a tool)'));
      const started = performance.now();
      const summary = sweep({
        // `sweep` derives one seed per run from the base seed it is given.
        seed: 100,
        missionId: 'm00_prologue',
        difficultyId: difficulty.value,
        seeds: Number(seedCount.value),
        seconds: Number(seconds.value),
      });
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      output.replaceChildren(
        el(
          'p',
          'iv-note',
          `completion <b>${(summary.completion * 100).toFixed(0)}%</b> · avg time ` +
            `<b>${summary.averageSeconds.toFixed(1)}s</b> · avg accuracy <b>${summary.averageAccuracy.toFixed(1)}%</b> · ` +
            `avg end health <b>${summary.averageEndHealth.toFixed(1)}</b> · swept in ${elapsed}s`,
        ),
        table(
          ['seed', 'outcome', 'seconds', 'waves', 'kills', 'head', 'accuracy', 'score', 'health', 'ammo spent'],
          summary.reports.map((r) => [
            r.seed,
            `<span class="${outcomeClass(r)}">${r.outcome}</span>`,
            r.seconds.toFixed(0),
            `${r.wavesCleared}/5`,
            r.kills,
            r.headshots,
            `${r.accuracy.toFixed(0)}%`,
            r.score,
            r.endHealth.toFixed(0),
            r.ammoSpent,
          ]),
        ),
      );
    });
  },
};

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

export const determinismPanel: Panel = {
  id: 'determinism',
  title: 'DETERMINISM',
  description:
    'Hashes two identical runs and compares them sample by sample. This is the property the golden replay test defends.',
  render(host) {
    const controls = el('div', 'iv-controls');
    const seedInput = el('input');
    seedInput.type = 'number';
    seedInput.value = '7';
    const secondsInput = el('input');
    secondsInput.type = 'number';
    secondsInput.value = '120';
    const run = el('button', 'iv-btn');
    run.textContent = 'COMPARE RUNS';
    const label = (text: string, input: HTMLElement): HTMLElement => {
      const wrap = el('label', 'iv-field');
      wrap.append(document.createTextNode(text), input);
      return wrap;
    };
    controls.append(label('SEED', seedInput), label('SECONDS', secondsInput), run);
    const output = el('div');
    host.append(controls, output);

    run.addEventListener('click', () => {
      const seed = Number(seedInput.value) || 1;
      const ticks = Math.round((Number(secondsInput.value) || 60) * TICK_HZ);
      const runOnce = (): string[] => {
        const world = createWorld({ seed, missionId: 'm00_prologue', difficultyId: 'regular' });
        const bot = new ScriptedBot();
        const hashes: string[] = [];
        for (let tick = 0; tick < ticks; tick++) {
          const { input, actions } = bot.tick(world);
          stepWorld(world, input, actions);
          // Exactly the hash the golden replay test records — not a lookalike.
          if (world.tick % TICK_HZ === 0) hashes.push(hashWorld(world));
        }
        return hashes;
      };
      const a = runOnce();
      const b = runOnce();
      const firstDivergence = a.findIndex((hash, i) => hash !== b[i]);
      const streams = createRngStreams(seed);
      output.replaceChildren(
        el(
          'p',
          firstDivergence === -1 ? 'iv-ok' : 'iv-bad',
          firstDivergence === -1
            ? `IDENTICAL — ${a.length} samples match across two full runs`
            : `DIVERGED at sample ${firstDivergence}: ${a[firstDivergence]} vs ${b[firstDivergence]}`,
        ),
        el('p', 'iv-note', `Stream fingerprint for seed ${seed}: <b>${hashSeed(seed, streams)}</b>`),
        table(
          ['second', 'hash'],
          a.slice(0, 40).map((hash, i) => [i + 1, hash]),
        ),
      );
    });
  },
};

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export const perfPanel: Panel = {
  id: 'perf',
  title: 'SIM PERFORMANCE',
  description:
    'Simulation throughput with the scripted player. The budget in docs/PERF_BUDGET.md requires 60x realtime of headroom.',
  render(host) {
    const run = el('button', 'iv-btn');
    run.textContent = 'BENCH 60s';
    const output = el('div');
    host.append(run, output);

    run.addEventListener('click', () => {
      const world = createWorld({ seed: 3, missionId: 'm00_prologue', difficultyId: 'regular' });
      const bot = new ScriptedBot();
      const warmup = 300;
      for (let i = 0; i < warmup; i++) {
        const { input, actions } = bot.tick(world);
        stepWorld(world, input, actions);
      }
      const iterations = TICK_HZ * 60;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const { input, actions } = bot.tick(world);
        stepWorld(world, input, actions);
      }
      const elapsed = performance.now() - start;
      const ticksPerSecond = iterations / (elapsed / 1000);
      const ratio = ticksPerSecond / TICK_HZ;
      output.replaceChildren(
        el(
          'p',
          ratio >= 60 ? 'iv-ok' : 'iv-bad',
          `${iterations} ticks in ${elapsed.toFixed(0)}ms · ${Math.round(ticksPerSecond)} ticks/s · ` +
            `<b>${ratio.toFixed(0)}x realtime</b> ${ratio >= 60 ? '(within budget)' : '(BELOW BUDGET)'}`,
        ),
        el(
          'p',
          'iv-note',
          `hostiles alive <b>${world.enemies.filter((e) => e.alive).length}</b> · ` +
            `spawn queue <b>${world.spawnQueue.length}</b> · wave <b>${world.wave}</b> · ` +
            `props <b>${world.map.props.length}</b>`,
        ),
      );
    });
  },
};

export const PANELS: Panel[] = [contentPanel, balancePanel, determinismPanel, perfPanel];
