/**
 * End-to-end smoke tests (ADR-0008).
 *
 * These run the real product build in a real browser and drive it through
 * `window.__IV__` — the same debug contract the golden tests use — so they
 * assert gameplay state instead of pixel-hunting. The point is to catch the
 * class of failure unit tests cannot: the game booting to a black screen.
 */
import { expect, test, type Page } from '@playwright/test';

/** Boot the build with a fixed seed so every assertion below is deterministic. */
async function boot(page: Page, query = '?autostart=1&lock=off&seed=7'): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => Boolean((window as unknown as { __IV__?: unknown }).__IV__), null, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (window as unknown as { __IV__: { gameState(): string } }).__IV__.gameState() === 'playing',
    null,
    { timeout: 30_000 },
  );
}

function call<T>(page: Page, expression: string): Promise<T> {
  return page.evaluate(expression) as Promise<T>;
}

test.describe('iron vanguard', () => {
  test('boots to the menu without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await expect(page.locator('#menu')).toHaveClass(/show/);
    await expect(page.locator('#deployBtn')).toBeVisible();
    // Chapter, sitrep and difficulty options all come from content data.
    await expect(page.locator('#menu')).toContainText('CHAPTER I');
    await expect(page.locator('#menu')).toContainText('SITREP');
    await expect(page.locator('#menu .iv-brief p')).toHaveCount(4);
    await expect(page.locator('#difficulty option')).toHaveCount(4);

    const hasCanvas = await call<boolean>(page, 'Boolean(document.getElementById("viewport"))');
    expect(hasCanvas).toBe(true);
    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('deploys from the menu into gameplay', async ({ page }) => {
    await page.goto('/?lock=off&seed=7');
    await page.locator('#deployBtn').click();
    await page.waitForFunction(
      () => (window as unknown as { __IV__: { gameState(): string } }).__IV__.gameState() === 'playing',
    );
    await expect(page.locator('#menu')).not.toHaveClass(/show/);
    await expect(page.locator('#waveLabel')).toContainText('WAVE');
    await expect(page.locator('#ammo')).toHaveText('30');
  });

  test('starts the first wave and consumes ammunition', async ({ page }) => {
    await boot(page);
    // The live render loop is already ticking, so compare against a baseline
    // rather than assuming a pristine world.
    const before = await call<{ tick: number; player: { shotsFired: number } }>(
      page,
      'window.__IV__.state()',
    );

    // 25 simulated seconds is enough for the pre-mission delay, the first spawns
    // and for the scripted player to engage something.
    const after = await call<{
      enemiesAlive: number;
      player: { shotsFired: number; ammo: number; kills: number };
      tick: number;
      wave: number;
    }>(page, 'window.__IV__.fastForward(25).state');

    expect(after.tick).toBeGreaterThanOrEqual(before.tick + 25 * 60);
    expect(after.wave).toBeGreaterThan(0);
    expect(after.player.shotsFired).toBeGreaterThan(before.player.shotsFired);
    expect(after.player.ammo).toBeLessThanOrEqual(30);
    expect(after.enemiesAlive + after.player.kills).toBeGreaterThan(0);
  });

  test('renders the HUD from live simulation state', async ({ page }) => {
    await boot(page);
    await call(page, 'window.__IV__.fastForward(20)');
    const state = await call<{ player: { health: number; ammo: number; reserve: number } }>(
      page,
      'window.__IV__.state()',
    );
    await expect(page.locator('#ammo')).toHaveText(String(state.player.ammo));
    await expect(page.locator('#reserve')).toHaveText(String(state.player.reserve));
    // FPS counter is fed by the renderer and must be live, not a placeholder.
    await expect(page.locator('#fps')).not.toHaveText('-- FPS');
  });

  test('spawns debug hostiles and registers hits on them', async ({ page }) => {
    await boot(page);
    const id = await call<number>(page, 'window.__IV__.spawn("rifleman", 9)');
    expect(id).toBeGreaterThan(0);

    const state = await call<{ enemiesAlive: number }>(page, 'window.__IV__.state()');
    expect(state.enemiesAlive).toBeGreaterThan(0);

    await call(page, 'window.__IV__.fastForward(4)');
    const after = await call<{ player: { shotsFired: number; shotsHit: number } }>(
      page,
      'window.__IV__.state()',
    );
    expect(after.player.shotsFired).toBeGreaterThan(0);
    expect(after.player.shotsHit).toBeGreaterThan(0);
  });

  test('keeps the simulation hash stable for identical input', async ({ page }) => {
    await boot(page, '?autostart=1&lock=off&seed=4242');

    // Restart, replay and compare inside ONE synchronous evaluation: the render
    // loop only ticks between evaluations, so this is the only way to compare
    // two runs without live frames contaminating one of them.
    const result = await call<{ first: string; second: string }>(
      page,
      `(() => {
        const api = window.__IV__;
        api.restart({ seed: 4242 });
        api.fastForward(6);
        const first = api.hash();
        api.restart({ seed: 4242 });
        api.fastForward(6);
        return { first, second: api.hash() };
      })()`,
    );
    expect(result.second).toBe(result.first);

    // A different seed must land somewhere else, or the hash proves nothing.
    const other = await call<string>(
      page,
      `(() => {
        const api = window.__IV__;
        api.restart({ seed: 99 });
        api.fastForward(6);
        return api.hash();
      })()`,
    );
    expect(other).not.toBe(result.first);
  });

  test('shows the K.I.A. screen when the player dies', async ({ page }) => {
    await boot(page);
    await call(page, 'window.__IV__.die()');
    await call(page, 'window.__IV__.fastForward(1)');
    await page.waitForFunction(
      () => (window as unknown as { __IV__: { gameState(): string } }).__IV__.gameState() === 'dead',
    );
    await expect(page.locator('#dead')).toHaveClass(/show/);
  });

  test('shows the debrief when the mission completes', async ({ page }) => {
    await boot(page);
    await call(page, 'window.__IV__.win()');
    await page.waitForFunction(
      () => (window as unknown as { __IV__: { gameState(): string } }).__IV__.gameState() === 'victory',
    );
    await expect(page.locator('#win')).toHaveClass(/show/);
  });

  test('survives a quality-tier change at runtime', async ({ page }) => {
    await boot(page);
    for (const tier of ['low', 'medium', 'high', 'cinematic'] as const) {
      await call(page, `window.__IV__.setQuality("${tier}")`);
      await call(page, 'window.__IV__.fastForward(1)');
    }
    const info = await call<{ quality: string; drawCalls: number; triangles: number }>(
      page,
      'window.__IV__.renderer()',
    );
    expect(info.quality).toBe('cinematic');
    // The renderer must still be issuing real draw work after the switch.
    expect(info.drawCalls).toBeGreaterThan(0);
    expect(info.triangles).toBeGreaterThan(0);
  });

  test('keeps the frame loop alive with hostiles and effects on screen', async ({ page }) => {
    await boot(page);
    await call(page, 'window.__IV__.spawn("rusher", 6)');
    await call(page, 'window.__IV__.grenade()');
    await call(page, 'window.__IV__.fastForward(3)');
    // Wait for frames rather than for wall-clock time: CI renders this on a software
    // rasteriser, where a single detailed frame can take most of a second.
    await page.waitForFunction(
      () =>
        (window as unknown as { __IV__: { renderer(): { fps: number } } }).__IV__.renderer().fps > 0,
      undefined,
      { timeout: 20_000 },
    );
    const fps = await call<number>(page, 'window.__IV__.renderer().fps');
    expect(fps).toBeGreaterThan(0);
    await expect(page.locator('#hint')).toBeAttached();
  });

  test('renders the procedural baseline when no models are downloaded', async ({ page }) => {
    // The shipped manifest is empty (assets/models/README.md): zero loaded models and
    // zero failures is the expected state, not a degraded one.
    await boot(page);
    const models = await call<{ count: number; loaded: string[]; failed: string[]; issues: string[] }>(
      page,
      'window.__IV__.models()',
    );
    expect(models.count).toBe(0);
    expect(models.loaded).toEqual([]);
    expect(models.failed).toEqual([]);
    expect(models.issues).toEqual([]);
  });

  test('the damage vignette never washes out the screen', async ({ page }) => {
    // Regression: a 1.5 s, 0.88-opacity vignette per hit was the "the screen goes
    // black" report. It is now a short punch capped well below opaque.
    await boot(page);
    const worst = await call<number>(
      page,
      `(() => {
        const overlay = document.querySelector('#damageOv');
        let peak = 0;
        for (let i = 0; i < 40; i++) {
          window.__IV__.fastForward(0.5);
          peak = Math.max(peak, Number(getComputedStyle(overlay).opacity) || 0);
        }
        return peak;
      })()`,
    );
    expect(worst).toBeLessThanOrEqual(0.6);
  });
});
