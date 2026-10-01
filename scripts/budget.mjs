#!/usr/bin/env node
/**
 * Build-budget gate (docs/PERF_BUDGET.md).
 * Fails loudly when a build grows past its allowance, so "it just got bigger"
 * can never be discovered after ship day.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join } from 'node:path';

const MiB = 1024 * 1024;
const LIMITS = {
  /** Product build: initial JS the browser must parse before first frame. */
  productJsGz: 2.5 * MiB,
  /** Shareable artifact: the whole callofduty.html (code + CSS inlined, assets streamed). */
  artifactHtmlGz: 8 * MiB,
  artifactHtmlRaw: 20 * MiB,
};

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function format(bytes) {
  return `${(bytes / MiB).toFixed(2)} MiB`;
}

const failures = [];
const rows = [];

function gate(label, value, limit, unit = 'gz') {
  const ok = value <= limit;
  rows.push({ label, value, limit, ok });
  if (!ok) failures.push(`${label}: ${unit} ${format(value)} > limit ${format(limit)}`);
}

// 1. Product build — largest single JS chunk, gzipped.
const dist = 'apps/game/dist';
const productJs = walk(dist).filter((f) => extname(f) === '.js');
if (productJs.length === 0) {
  rows.push({ label: 'product build', value: null, limit: LIMITS.productJsGz, ok: true, note: 'not built yet (run `npm run build`)' });
} else {
  let largest = 0;
  let largestFile = '';
  for (const file of productJs) {
    const gz = gzipSync(readFileSync(file)).length;
    if (gz > largest) {
      largest = gz;
      largestFile = file;
    }
  }
  gate(`product JS (largest chunk, ${largestFile})`, largest, LIMITS.productJsGz);
}

// 2. Single-file artifact.
const artifact = 'apps/game/dist-single/callofduty.html';
if (!existsSync(artifact)) {
  rows.push({ label: 'callofduty.html', value: null, limit: LIMITS.artifactHtmlRaw, ok: true, note: 'not built yet (run `npm run build:single`)' });
} else {
  const raw = statSync(artifact).size;
  const gz = gzipSync(readFileSync(artifact)).length;
  gate('callofduty.html raw', raw, LIMITS.artifactHtmlRaw, 'raw');
  gate('callofduty.html gzip', gz, LIMITS.artifactHtmlGz);
}

const width = Math.max(...rows.map((r) => r.label.length), 10);
console.log('\nBuild budget');
console.log('-'.repeat(width + 34));
for (const r of rows) {
  const value = r.value === null ? `${r.note ?? 'n/a'}` : format(r.value);
  console.log(`${r.label.padEnd(width)}  ${value.padStart(12)}  ${r.ok ? 'OK' : 'OVER'}`);
}
console.log('-'.repeat(width + 34));

if (failures.length > 0) {
  console.error('\nBudget exceeded:');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nFix the regression or justify a budget change in docs/PERF_BUDGET.md + an ADR.');
  process.exit(1);
}
console.log('Budgets OK. (Runtime draw-call/triangle budgets are asserted in-app by the devtools overlay.)\n');
