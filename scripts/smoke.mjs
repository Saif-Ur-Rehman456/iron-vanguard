/**
 * Boot smoke test for a deployed URL — the deployment twin of tests/e2e.
 *
 *   node scripts/smoke.mjs https://iron-vanguard-marhman02-5363.vercel.app
 *
 * Exits non-zero if the build does not boot to `playing` with a live renderer,
 * and drops a screenshot of the first deployed frame into .captures/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base.startsWith('http')) {
  console.error('usage: node scripts/smoke.mjs <deployed-url>');
  process.exit(2);
}

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(`${base}/?lock=off&seed=7`, { timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.__IV__), null, { timeout: 60_000 });
  // The menu entrance animates; dispatch the click rather than waiting for
  // Playwright's actionability "stable" check to accept an animated button.
  await page.evaluate(() => document.querySelector('#deployBtn').click());
  await page.waitForFunction(
    () => window.__IV__.gameState() === 'playing',
    null,
    { timeout: 60_000 },
  );

  const state = await page.evaluate(() => {
    window.__IV__.fastForward(3);
    return {
      tick: window.__IV__.state().tick,
      wave: window.__IV__.state().wave,
      enemiesAlive: window.__IV__.state().enemiesAlive,
    };
  });

  if (state.tick <= 0) throw new Error('simulation is not ticking');

  // On a software rasteriser a single detailed frame can take most of a second;
  // the fps counter only updates once a frame lands (same wait the e2e suite
  // does). drawCalls > 0 proves the first frame; fps > 0 proves the loop repeats.
  await page.waitForFunction(
    () => {
      const r = window.__IV__.renderer();
      return r.drawCalls > 0 || r.fps > 0;
    },
    null,
    { timeout: 60_000 },
  );
  const render = await page.evaluate(() => window.__IV__.renderer());
  if (render.drawCalls <= 0) throw new Error('renderer issues no draw work');

  mkdirSync('.captures', { recursive: true });
  try {
    await page.screenshot({ path: '.captures/smoke-deployed.png', timeout: 45_000 });
  } catch {
    // A screenshot is evidence, not a gate: software rendering can make the
    // capture slower than the smoke itself.
    console.log('screenshot skipped (too slow)');
  }

  console.log('SMOKE OK', JSON.stringify({ ...state, fps: render.fps, drawCalls: render.drawCalls }));
  if (errors.length) console.log('page errors (non-fatal):', errors.join(' | '));
  process.exit(0);
} catch (error) {
  console.error('SMOKE FAILED:', error.message);
  if (errors.length) console.error('page errors:', errors.join(' | '));
  process.exit(1);
} finally {
  await browser.close();
}
