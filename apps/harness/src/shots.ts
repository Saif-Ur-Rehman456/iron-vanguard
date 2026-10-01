/**
 * shots — capture, probe and image-report the running game.
 *
 * Screenshots the *running* game (dev server or preview), measures each frame,
 * and answers the questions the art review actually asks: are the edges clean,
 * are objects grounded, is there detail in the darks, are the highlights under
 * control, and does the image use more than one brightness band.
 *
 * The measurements are taken at fixed *world* positions (`__IV__.project` maps
 * them to pixels) with the simulation frozen (`__IV__.freeze`), so a "contact
 * shadow at a tyre" is the same pixel every run and two commits can be compared
 * honestly. `--baseline` diffs against a previous report.
 *
 * Usage:
 *   npx tsx apps/harness/src/shots.ts --url=http://localhost:5173 --out=.captures
 *   npx tsx apps/harness/src/shots.ts --probe=car-shadow --json=.captures/baseline.json
 *   npx tsx apps/harness/src/shots.ts --baseline=.captures/baseline.json
 *
 * `--url` is anything serving apps/game (npm run dev / npm run preview).
 * Set PW_CHANNEL=chrome|msedge to reuse an installed browser instead of
 * downloading Chromium (same escape hatch as playwright.config.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { PLAZA_MAP, type MapDef } from '@iron/content';

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const URL_BASE = arg('url', process.env.IV_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const OUT = resolve(arg('out', '.captures'));
const SEED = Number(arg('seed', '7'));
const QUALITY = arg('quality', 'high');
const CHANNEL = process.env.PW_CHANNEL || 'chrome';
const ONLY = arg('probe', '');
const BASELINE = arg('baseline', '');
const JSON_OUT = arg('json', '');
/**
 * `--legacy=1` turns off what this phase added (MSAA, GTAO, the grade) so the same
 * probes can be captured as a "before" column for `--baseline`.
 */
const LEGACY = arg('legacy', '0') === '1';

/**
 * The key light's position, copied from `MOON_POSITION` in
 * packages/render/src/level/lighting.ts (a `SunLight` shines from its position
 * toward the origin). The probes use it to know which side of an object the
 * shadow falls on and which facade the key lights — so if the key moves, this
 * constant moves with it or every shadow assertion silently points the wrong way.
 */
const SUN = { x: 55, y: 42, z: -35 };
const SUN_LENGTH = Math.hypot(SUN.x, SUN.z);
/** Unit direction a shadow extends in, in world (x, z). */
const SHADOW_DIR = { x: -SUN.x / SUN_LENGTH, z: -SUN.z / SUN_LENGTH };
/** Camera eye height (cameraRig.ts, parity). */
const EYE = 1.7;

interface AbResult {
  readings: Record<string, { drop: number; warmth: number }>;
  /**
   * Whole-frame numbers for the same on/off pair.
   *
   * A light group's *contribution at a point* is a tricky measurement; whether the group
   * shapes the frame at all is not. Keeping both means a patch that silently samples the
   * wrong thing (or the sky) can be told apart from a light that does nothing: the frame
   * pair moves either way.
   */
  frames: { onMean: number; offMean: number; onDetail: number; offDetail: number; changedPct: number };
}

interface Patch {
  name: string;
  x: number;
  y: number;
  z: number;
  r?: number;
}

interface PatchSample {
  name: string;
  x: number;
  y: number;
  mean: number;
  p10: number;
  /** Sampled pixels; 0 means the point fell outside the frame (probe bug, not a dark object). */
  count: number;
  red: number;
  blue: number;
  /** (red - blue) / luma: the patch's colour temperature, signed warm. */
  warmth: number;
}

interface FrameMetrics {
  mean: number;
  darkPct: number;
  brightPct: number;
  p1: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  midContrast: number;
  detail: number;
  saturation: number;
  /** Strong edge pixels per 1000 pixels. */
  edgeDensity: number;
  /** Transition (ramp) pixels per strong edge pixel — the AA score. */
  rampPerEdge: number;
  patches: PatchSample[];
}

/**
 * Targets the foundation is supposed to hit (mirrored in docs/QUALITY_BAR.md).
 *
 * The `*-ao_*`/`shadow-cast_*` keys are *relative* darkening measured at fixed
 * world points with the effect off and on, so they cannot be satisfied by moving
 * the camera, and the control points (`*_open`, `*_shadow3.2`) fail if the effect
 * spills where it should not.
 */
const TARGETS: Array<{ key: string; min?: number; max?: number; label: string }> = [
  { key: 'shadow-cast_car_shadow1.6', min: 0.45, label: 'car cast shadow at 1.6 m' },
  { key: 'shadow-cast_car_shadow3.2', max: 0.03, label: 'sunlit control stays unshadowed' },
  { key: 'contact-ao_barrel_ring', min: 0.02, label: 'AO darkening at a barrel base' },
  { key: 'contact-ao_barrel_open', max: 0.01, label: 'AO spares open ground' },
  { key: 'corner-ao_wall_base0.3', min: 0.02, label: 'AO darkening at a wall base' },
  // Measured in the `ao-contact` probe as the *image* difference between the pass
  // off and on at one pose. That is the only trustworthy channel: the pass's own
  // debug view is a tone-mapped, bloomed, graded image, and AgX compresses so hard
  // that a linear occlusion of 0.3 displays as 0.65 — which is how an AO term that
  // was working looked like "a flat grey wash that ignores its radius".
  { key: 'ao_barrel_ring', min: 0.08, label: 'AO grounds a barrel base' },
  { key: 'ao_barrel_open', max: 0.03, label: 'AO spares open ground 1.7 m out' },
  { key: 'ao_wall_base0.3', min: 0.18, label: 'AO at the wall base (contact)' },
  { key: 'ao_wall_base2', max: 0.12, label: 'AO fades by 2 m from the wall' },
  { key: 'ao_npc_perp', max: 0.08, label: 'AO spares the ground beside a body' },
  { key: 'npcContact', min: 0.25, label: 'NPC feet contact darkening' },
  { key: 'emitterBright', max: 0.3, label: 'clipped pixels at the street light' },
  { key: 'shadeDetail', min: 8, label: 'shadowed ground keeps detail (luma)' },
  // ---- lighting rig (ADR-0013) ---------------------------------------------
  // Every one of these is a *relative* change at a fixed world point with one
  // group of the rig switched off, so none of them can be satisfied by moving the
  // camera, and the control points fail if a light spills where it should not.
  { key: 'lighting-lamps_pool', min: 0.3, label: 'a lamp lights its own pavement' },
  { key: 'lighting-lamps_near3', min: 0.1, label: 'the lamp pool still reaches 3 m' },
  { key: 'lighting-lamps_falloff', min: 0.1, label: 'lamp light falls off with distance' },
  { key: 'lighting-lampsFar_farControl', max: 0.05, label: 'lamp light stops inside 34 m' },
  { key: 'lighting-lamps_warmthDelta', min: 0.02, label: 'the lamp pool is warmer than the moonlit field' },
  { key: 'lighting-key_litGround', min: 0.35, label: 'the moon key lights the +x side of a block' },
  { key: 'lighting-key_shadowGround', max: 0.25, label: 'the moon key leaves the far side shadowed' },
  { key: 'lighting-key_contrast', min: 0.05, label: 'switching the key off removes form from the frame' },
  { key: 'lighting-ambient_shadowGround', min: 0.25, label: 'the fill keeps the shadow side readable' },
  { key: 'lighting-key_frameShare', min: 0.25, label: 'the key is what lights the frame' },
  { key: 'lighting-fill_frameShare', max: 0.35, label: 'the fill never rivals the key' },
  { key: 'lighting-fill_balance', min: 0.2, label: 'the fill is fill, not a second key' },
  { key: 'lighting-windows_wall', min: 0.02, label: 'a lit window warms its own wall' },
  { key: 'lighting-windows_far6', max: 0.01, label: 'window light stops at its own wall' },
];

/**
 * Page-side analysis. Decodes the PNG, measures the brightness distribution, an
 * edge-transition ratio (more ramp pixels per hard edge = better AA), and samples
 * the world-anchored patches.
 */
async function analyseFrame(
  page: Page,
  png: Buffer,
  patches: Patch[] = [],
): Promise<FrameMetrics> {
  return page.evaluate(
    async ({ base64, patches: points }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${base64}`)).blob(),
      );
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      const total = width * height;
      const luma = new Float32Array(total);
      const histogram = new Uint32Array(256);
      let sum = 0;
      let saturation = 0;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luma[p] = value;
        histogram[Math.min(255, value | 0)]!++;
        sum += value;
        saturation += Math.max(r, g, b) - Math.min(r, g, b);
      }
      const percentile = (fraction: number): number => {
        const target = fraction * total;
        let seen = 0;
        for (let bin = 0; bin < 256; bin++) {
          seen += histogram[bin]!;
          if (seen >= target) return bin;
        }
        return 255;
      };

      // Edge classification. A hard edge is a large luma step; a *ramp* pixel is a
      // small one, which is what an anti-aliased boundary is made of. Aliased
      // renders produce hard steps and almost no ramp, so `rampPerEdge` rises when
      // AA improves — and it is a ratio, so it does not move when the scene content
      // changes (only the pixels around the edges do).
      let strong = 0;
      let ramp = 0;
      let detail = 0;
      for (let y = 1; y < height - 1; y += 1) {
        const row = y * width;
        for (let x = 1; x < width - 1; x += 1) {
          const p = row + x;
          const gx = Math.abs(luma[p + 1]! - luma[p - 1]!);
          const gy = Math.abs(luma[p + width]! - luma[p - width]!);
          const g = gx + gy;
          if (g > 60) strong++;
          else if (g > 5) ramp++;
          detail += Math.abs(4 * luma[p]! - luma[p - 1]! - luma[p + 1]! - luma[p - width]! - luma[p + width]!);
        }
      }

      const patchSamples = points.map((point) => {
        const radius = point.r ?? 3;
        const values: number[] = [];
        // Per-channel means as well as luma: the lighting pass claims a *cool*
        // moon and *warm* local sources, and that claim is a colour difference at
        // known world points, not a brightness one. Measuring it needs r/g/b.
        let rSum = 0;
        let bSum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.round(point.x) + dx;
            const py = Math.round(point.y) + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const index = (py * width + px) * 4;
            rSum += data[index]!;
            bSum += data[index + 2]!;
            values.push(luma[py * width + px]!);
          }
        }
        values.sort((a, b) => a - b);
        const mean = values.reduce((acc, value) => acc + value, 0) / Math.max(1, values.length);
        const count = Math.max(1, values.length);
        const red = rSum / count;
        const blue = bSum / count;
        return {
          name: point.name,
          x: point.x,
          y: point.y,
          mean,
          p10: values[Math.floor(values.length * 0.1)] ?? mean,
          count: values.length,
          red,
          blue,
          /** Normalised warm-minus-cool: how warm this patch is, 0 = neutral. */
          warmth: mean > 1 ? (red - blue) / mean : 0,
        };
      });

      return {
        mean: sum / total,
        darkPct: ([...histogram.slice(0, 25)].reduce((a, b) => a + b, 0) / total) * 100,
        brightPct: ([...histogram.slice(241)].reduce((a, b) => a + b, 0) / total) * 100,
        p1: percentile(0.01),
        p5: percentile(0.05),
        p25: percentile(0.25),
        p50: percentile(0.5),
        p75: percentile(0.75),
        p95: percentile(0.95),
        p99: percentile(0.99),
        midContrast: percentile(0.75) - percentile(0.25),
        detail: detail / total,
        saturation: saturation / total,
        edgeDensity: (strong / total) * 1000,
        rampPerEdge: ramp / Math.max(1, strong),
        patches: patchSamples,
      };
    },
    { base64: png.toString('base64'), patches },
  );
}

/** How different two frames are, and how much of that difference is darkening. */
async function diffFrames(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{
  meanAbs: number;
  changedPct: number;
  darkerPct: number;
  brighterPct: number;
  meanLeft: number;
  meanRight: number;
}> {
  return page.evaluate(
    async ({ first, second }: { first: string; second: string }) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      };
      const left = await decode(first);
      const right = await decode(second);
      let diffSum = 0;
      let sumLeft = 0;
      let sumRight = 0;
      let changed = 0;
      let darker = 0;
      let brighter = 0;
      const total = left.data.length / 4;
      for (let i = 0; i < left.data.length; i += 4) {
        const la = 0.2126 * left.data[i]! + 0.7152 * left.data[i + 1]! + 0.0722 * left.data[i + 2]!;
        const lb = 0.2126 * right.data[i]! + 0.7152 * right.data[i + 1]! + 0.0722 * right.data[i + 2]!;
        const delta = la - lb;
        diffSum += Math.abs(delta);
        sumLeft += la;
        sumRight += lb;
        if (Math.abs(delta) > 6) changed++;
        if (delta > 6) darker++;
        if (delta < -6) brighter++;
      }
      return {
        meanAbs: diffSum / total,
        changedPct: (changed / total) * 100,
        darkerPct: (darker / total) * 100,
        brighterPct: (brighter / total) * 100,
        meanLeft: sumLeft / total,
        meanRight: sumRight / total,
      };
    },
    { first: a.toString('base64'), second: b.toString('base64') },
  );
}

/** A pose that stands `distance` from a target point and looks at it. */
function poseLookingAt(
  from: { x: number; z: number },
  target: { x: number; z: number; y?: number },
): { x: number; z: number; yaw: number; pitch: number } {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const horizontal = Math.max(0.001, Math.hypot(dx, dz));
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2((target.y ?? 0.9) - EYE, horizontal);
  return { x: from.x, z: from.z, yaw, pitch };
}

/** A point `distance` from a base, along the direction shadows fall. */
function alongShadow(base: { x: number; z: number }, distance: number): { x: number; z: number } {
  return { x: base.x + SHADOW_DIR.x * distance, z: base.z + SHADOW_DIR.z * distance };
}

/** Across the shadow direction — the viewing side that keeps both halves visible. */
const PERP = { x: -SHADOW_DIR.z, z: SHADOW_DIR.x };

function prop(map: MapDef, kind: string, index = 0): { x: number; z: number; size?: number } {
  const matches = map.props.filter((entry) => entry.kind === kind);
  const found = matches[index];
  if (!found) throw new Error(`no ${kind} prop at index ${index}`);
  return { x: found.x, z: found.z, size: (found as { size?: number }).size };
}

/** The first street lamp on the map (the lighting probe aims at its pool). */
function plazaLamp(): { x: number; z: number } {
  const found = PLAZA_MAP.props.find((entry) => entry.kind === 'lamp');
  if (!found) throw new Error('no lamp prop in the plaza map');
  return { x: found.x, z: found.z };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    channel: CHANNEL as 'chrome',
    args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // esbuild (via tsx) injects `__name(...)` wrappers around named function
  // expressions inside `page.evaluate` bodies — a transform meant for `keepNames`
  // in Node, which does not exist in the page. One shim keeps every evaluate body
  // in this file working without contorting the code around the bundler.
  await page.addInitScript('window.__name = window.__name || ((fn) => fn);');
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  /** HTML-overlay state at capture time — a full-screen overlay reads as black. */
  const overlays = async (): Promise<string> =>
    page.evaluate(() => {
      const parts: string[] = [];
      for (const selector of ['#damageOv', '#flashWhite', '#app', '#viewport']) {
        const node = document.querySelector(selector);
        parts.push(
          node
            ? `${selector}:op=${getComputedStyle(node).opacity},bg=${getComputedStyle(node).backgroundColor}`
            : `${selector}:absent`,
        );
      }
      const screens = document.querySelector('#screens');
      parts.push(
        screens
          ? `screens:display=${getComputedStyle(screens).display},visible=${[...screens.children].filter((c) => getComputedStyle(c).display !== 'none').length}`
          : 'screens:absent',
      );
      return parts.join(' | ');
    });

  const results: Array<{ name: string; metrics: FrameMetrics; note?: string }> = [];
  const diffs: Array<{ name: string; meanAbs: number; changedPct: number; darkerPct: number }> = [];
  /**
   * Ground probe point sets, keyed by the effect they are meant to prove.
   * The A/B reads patches out of the *same pixels* in both states, which is the
   * only way "this effect grounds the object" becomes a number instead of a claim.
   */
  const groundSets: Record<string, { pose: { x: number; z: number; yaw: number; pitch: number }; points: Patch[] }> =
    {};

  /** Project world points for the current pose, then read patch means from a PNG. */
  const patchMeans = async (png: Buffer, points: Patch[]): Promise<Record<string, number>> => {
    const screenPoints = await page.evaluate((patches) => {
      const api = (
        window as never as {
          __IV__: { project(x: number, y: number, z: number): { x: number; y: number } };
        }
      ).__IV__;
      return patches.map((patch) => ({ ...patch, ...api.project(patch.x, patch.y, patch.z) }));
    }, points);
    const metrics = await analyseFrame(page, png, screenPoints);
    const out: Record<string, number> = {};
    for (const patch of metrics.patches) out[patch.name] = patch.mean;
    return out;
  };

  const capture = async (
    name: string,
    patches: Patch[] = [],
    note?: string,
  ): Promise<FrameMetrics> => {
    const png = await page.screenshot();
    writeFileSync(join(OUT, `${name}.png`), png);
    const metrics = await analyseFrame(page, png, patches);
    results.push({ name, metrics, note });
    const patchText = metrics.patches
      // An empty patch means the probe aimed off-frame; printing 0.0 would read
      // like a black object, so it is called out instead.
      .map((patch) => `${patch.name} ${patch.count === 0 ? 'OFF-FRAME' : patch.mean.toFixed(1)}`)
      .join('  ');
    console.log(
      `  ${name.padEnd(20)} mean ${metrics.mean.toFixed(1)}  p1 ${metrics.p1}  p50 ${metrics.p50}  ` +
        `p99 ${metrics.p99}  spread ${metrics.midContrast}  edges ${metrics.edgeDensity.toFixed(1)}  ` +
        `ramp/edge ${metrics.rampPerEdge.toFixed(2)}  detail ${metrics.detail.toFixed(1)}`,
    );
    if (patchText) console.log(`  ${' '.repeat(20)} ${patchText}`);
    // A dark frame is either a bug or a dark UI state; only in that case is the
    // overlay readout worth the noise (it is how the damage vignette was found).
    if (metrics.darkPct > 60) console.log(`  ${' '.repeat(20)} ${await overlays()}`);
    return metrics;
  };

  /**
   * Wait until the camera has *arrived* at the pose it was given.
   *
   * `__IV__.pose()` snaps the rig, but the page keeps rendering and the rig
   * interpolates, so a fixed wait samples a frame from mid-swing. That is not a
   * rounding error: the barrel contact probe aimed at ground 0.7 m from a drum
   * landed on pixels roughly 200 px away and reported "AO does nothing at a barrel
   * base" — a measurement bug that read exactly like a shader bug. Settling is
   * observable, so this polls the projected screen position of a world point until
   * it stops moving instead of guessing a duration.
   *
   * Returns whether it settled; a probe that never settles is a probe bug, and the
   * caller reports it rather than measuring a moving camera.
   */
  const settlePose = async (reference: { x: number; y: number; z: number }): Promise<boolean> => {
    let previous: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await page.waitForTimeout(50);
      const point = await page.evaluate((p) => {
        const api = (
          window as never as {
            __IV__: { project(x: number, y: number, z: number): { x: number; y: number } };
          }
        ).__IV__;
        return api.project(p.x, p.y, p.z);
      }, reference);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return true;
      previous = point;
    }
    return false;
  };

  /** Freeze, pose, wait for the rig to settle, then capture. */
  const atPose = async (
    name: string,
    pose: { x: number; z: number; yaw: number; pitch: number },
    points: Patch[],
    note?: string,
  ): Promise<FrameMetrics> => {
    await page.evaluate((next) => {
      const api = (window as never as { __IV__: { pose(x: number, z: number, yaw: number, pitch: number): void } })
        .__IV__;
      api.pose(next.x, next.z, next.yaw, next.pitch);
    }, pose);
    const reference =
      points[0] ?? { x: pose.x - Math.sin(pose.yaw) * 4, y: 1.2, z: pose.z - Math.cos(pose.yaw) * 4 };
    if (!(await settlePose(reference))) console.log(`  ${name}: pose did not settle`);
    const screenPoints = await page.evaluate((patches) => {
      const api = (
        window as never as {
          __IV__: { project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } };
        }
      ).__IV__;
      return patches.map((patch) => ({ ...patch, ...api.project(patch.x, patch.y, patch.z) }));
    }, points);
    return capture(name, screenPoints, note);
  };

  const callApi = async (name: string, value: unknown): Promise<void> => {
    await page.evaluate(
      ({ key, argument }) => {
        const api = (window as never as { __IV__: Record<string, unknown> }).__IV__;
        const fn = api[key] as ((...args: unknown[]) => void) | undefined;
        // An array argument is spread, so a two-parameter debug call (`setAo`)
        // goes through the same single path as a boolean toggle.
        if (Array.isArray(argument)) fn?.(...argument);
        else fn?.(argument);
      },
      { key: name, argument: value },
    );
  };

  // Menu orbit.
  await page.goto(`${URL_BASE}/?lock=off`);
  await page.waitForFunction(() => Boolean((window as never as { __IV__?: unknown }).__IV__));
  await page.waitForTimeout(1200);
  console.log('menu');
  await capture('01-menu');

  // In mission.
  await page.goto(`${URL_BASE}/?autostart=1&lock=off&seed=${SEED}`);
  await page.waitForFunction(() => Boolean((window as never as { __IV__?: unknown }).__IV__));
  await page.evaluate((tier) => (window as never as { __IV__: { setQuality(t: string): void } }).__IV__.setQuality(tier), QUALITY);
  if (LEGACY) {
    // The pre-foundation image: no MSAA, no ambient occlusion, no grade.
    await callApi('setMsaa', 0);
    await callApi('setAo', false);
    await callApi('setGrade', false);
    console.log('legacy mode: MSAA 0, AO off, grade off');
  }
  // A first pass with the bot driving, so the firefight frames are real.
  for (const [name, seconds] of [
    ['02-spawn', 1.5],
    ['03-firefight', 20],
    ['04-midmission', 90],
  ] as const) {
    await page.evaluate((s) => {
      const api = (window as never as { __IV__: { fastForward(n: number): unknown } }).__IV__;
      api.fastForward(s);
    }, seconds);
    await page.waitForTimeout(700);
    console.log(name);
    for (const suffix of ['', '-b1', '-b2']) {
      if (suffix) await page.waitForTimeout(320);
      await capture(name + suffix);
    }
  }

  // ---------------------------------------------------------------------------
  // Probe suite: fixed poses, frozen simulation, world-anchored samples.
  // ---------------------------------------------------------------------------
  console.log('\nprobes (frozen simulation, world-anchored samples)');
  // The bot usually dies during those 90 seconds, and the death screen is a dark
  // translucent wash over the frame — every luminance probe would measure the
  // overlay instead of the scene. Restart onto a clean wave before probing.
  await page.evaluate((seed) => {
    (window as never as { __IV__: { restart(options?: { seed?: number }): void } }).__IV__.restart({ seed });
  }, SEED);
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const api = (
      window as never as {
        __IV__: { freeze(on?: boolean): void; freezeFx(on?: boolean): void; killAll(): void; giveAmmo(): void };
      }
    ).__IV__;
    api.freeze(true);
    // The simulation being frozen is not enough for a comparable capture pair:
    // fire, smoke, ash and casings are renderer-side and keep moving, which shows
    // up as a few luma of difference between any two frames.
    api.freezeFx(true);
    api.killAll();
    api.giveAmmo();
  });

  const wreck = prop(PLAZA_MAP, 'wreck', 0);
  const lamp = prop(PLAZA_MAP, 'lamp', 0);

  const probes: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: 'car-shadow',
      run: async () => {
        // Viewed from the *side* of the shadow direction, so the lit side, the
        // contact edge and the ground the shadow crosses are all unoccluded by the
        // car itself (a head-on view hides exactly the band being measured).
        const from = { x: wreck.x + PERP.x * 6.5, z: wreck.z + PERP.z * 6.5 };
        const points: Patch[] = [0.5, 1.0, 1.6, 2.4, 3.2].map((distance) => ({
          name: `shadow${distance}`,
          ...alongShadow(wreck, distance),
          y: 0.05,
          r: 3,
        }));
        // Control across the shadow direction: outside the car's own shadow by
        // construction, so it stays lit whether or not the shadow map is on.
        points.push({
          name: 'perp',
          x: wreck.x + PERP.x * 1.4,
          y: 0.05,
          z: wreck.z + PERP.z * 1.4,
          r: 3,
        });
        points.push({ name: 'body', x: wreck.x, y: 0.75, z: wreck.z, r: 3 });
        const pose = poseLookingAt(from, { x: wreck.x, z: wreck.z, y: 0.7 });
        groundSets.car = { pose, points };
        const metrics = await atPose(
          '10-car-shadow',
          pose,
          points,
          'shadow profile across the car: contact, cast shadow, lit ground',
        );
        const byName = (key: string): number =>
          metrics.patches.find((patch) => patch.name === key)?.mean ?? 0;
        console.log(
          `  ${' '.repeat(20)} ground profile 0.5→3.2 m from the shadow side (lit ground is ~120): ` +
            [0.5, 1.0, 1.6, 2.4, 3.2].map((d) => byName(`shadow${d}`).toFixed(0)).join(' '),
        );
      },
    },
    {
      name: 'barrel-contact',
      run: async () => {
        // A barrel is the cleanest contact test in the arena: a small cylinder on
        // open ground with a known radius. The sun side of its base is *not* in the
        // barrel's own shadow, so anything dark there is the AO/contact term.
        const barrel = prop(PLAZA_MAP, 'barrel', 0);
        const from = { x: barrel.x + PERP.x * 4, z: barrel.z + PERP.z * 4 };
        const points: Patch[] = [
          {
            name: 'ring',
            x: barrel.x - SHADOW_DIR.x * 0.72,
            y: 0.05,
            z: barrel.z - SHADOW_DIR.z * 0.72,
            r: 2,
          },
          {
            name: 'sideRing',
            x: barrel.x + PERP.x * 0.72,
            y: 0.05,
            z: barrel.z + PERP.z * 0.72,
            r: 2,
          },
          {
            name: 'open',
            x: barrel.x - SHADOW_DIR.x * 1.7,
            y: 0.05,
            z: barrel.z - SHADOW_DIR.z * 1.7,
            r: 3,
          },
        ];
        const pose = poseLookingAt(from, { x: barrel.x, z: barrel.z, y: 0.5 });
        groundSets.barrel = { pose, points };
        await atPose('16-barrel-contact', pose, points, 'base ring on the sunlit side vs open ground');
      },
    },
    {
      name: 'ao-contact',
      run: async () => {
        // The AO term, measured directly instead of argued about.
        //
        // Three slots, because the ways it fails are different: a small cylinder
        // on open ground (contact), a wall meeting the ground (corner) and a
        // standing body (both). Each slot is captured with the term off and on at
        // the *same* pose, and the term's own buffer is sampled at the same world
        // points — a table of numbers is what makes "AO does nothing" a finding
        // rather than an impression.
        // Everything below is a before/after pair, so the resolution is pinned for
        // the whole probe: the controller would otherwise raise it when the term is
        // switched off, and the difference would be sharpness, not occlusion.
        await callApi('lockResolution', 1);
        const poseTo = async (
          pose: { x: number; z: number; yaw: number; pitch: number },
          reference: { x: number; y: number; z: number },
        ): Promise<void> => {
          await page.evaluate((next) => {
            const api = (
              window as never as { __IV__: { pose(x: number, z: number, yaw: number, pitch: number): void } }
            ).__IV__;
            api.pose(next.x, next.z, next.yaw, next.pitch);
          }, pose);
          await settlePose(reference);
        };
        const shotsAt = async (slot: string, points: Patch[]): Promise<void> => {
          // (a) the term itself.
          await callApi('lockResolution', 1);
          await callApi('setAo', [true, 'ao']);
          await page.waitForTimeout(200);
          const term = await page.screenshot();
          writeFileSync(join(OUT, `ao-term-${slot}.png`), term);
          // (b) the composite, with and without it.
          await callApi('setAo', [true, 'composite']);
          await page.waitForTimeout(200);
          const on = await page.screenshot();
          writeFileSync(join(OUT, `ao-on-${slot}.png`), on);
          // The debug view shows the *unblurred* term, the composite shows the
          // blurred one, so a disagreement between the two is the blur's doing.
          // Capturing it separately is what makes that a measurement.
          await callApi('setAoParams', { blur: false });
          await page.waitForTimeout(200);
          const onRaw = await page.screenshot();
          writeFileSync(join(OUT, `ao-on-raw-${slot}.png`), onRaw);
          await callApi('setAoParams', { blur: Boolean(baseParams.blur ?? true) });
          await callApi('setAo', false);
          await page.waitForTimeout(200);
          const off = await page.screenshot();
          writeFileSync(join(OUT, `ao-off-${slot}.png`), off);
          await callApi('setAo', true);

          // `analyseFrame` samples *screen* pixels (`patchMeans` is the world-point
          // wrapper), so the projection happens here, once — and the patch count it
          // reports is what turns a mis-aimed probe into OFF-FRAME rather than into
          // a perfectly black surface.
          const screenPoints = await page.evaluate((patches) => {
            const api = (
              window as never as {
                __IV__: { project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } };
              }
            ).__IV__;
            return patches.map((patch) => ({ ...patch, ...api.project(patch.x, patch.y, patch.z) }));
          }, points);
          const termFrame = await analyseFrame(page, term, screenPoints);
          const onFrame = await analyseFrame(page, on, screenPoints);
          const offFrame = await analyseFrame(page, off, screenPoints);
          const termPatches = termFrame.patches;
          const onPatches = onFrame.patches;
          const offPatches = offFrame.patches;
          const rawFrame = await analyseFrame(page, onRaw, screenPoints);
          const rawPatches = rawFrame.patches;
          // Frame means for both states: the state a capture is *in* has to be
          // legible in the output, or an effect that darkens everything reads as a
          // contact term.
          console.log(
            `  ${slot.padEnd(12)} frame mean: term ${termFrame.mean.toFixed(1)}  ` +
              `ao-on ${onFrame.mean.toFixed(1)}  ao-off ${offFrame.mean.toFixed(1)}`,
          );
          const parts: string[] = [];
          for (const patch of onPatches) {
            const without = offPatches.find((entry) => entry.name === patch.name);
            const termPatch = termPatches.find((entry) => entry.name === patch.name);
            if (!patch.count || !without?.count) {
              parts.push(`${patch.name} OFF-FRAME`);
              continue;
            }
            const relative = without.mean > 1 ? (without.mean - patch.mean) / without.mean : 0;
            const raw = rawPatches.find((entry) => entry.name === patch.name);
            report(`ao_${slot}_${patch.name}`, relative);
            report(`aoTerm_${slot}_${patch.name}`, (termPatch?.mean ?? 255) / 255);
            parts.push(
              `${patch.name} ${patch.mean.toFixed(0)}/${without.mean.toFixed(0)}` +
                ` = ${(relative * 100).toFixed(1)}% (no-blur ${raw?.mean.toFixed(0) ?? '?'}` +
                `, term ${((termPatch?.mean ?? 255) / 255).toFixed(2)})`,
            );
          }
          console.log(`  ${slot.padEnd(12)} ${parts.join('  ')}`);
        };

        // Radius ladder, before any of the slot captures.
        //
        // A term that is uniformly below 1.0 is the signature of self-occlusion: a
        // sample landing on the surface's own depth noise. Collapsing both radii
        // toward zero must therefore drive the term to exactly 1.0 — if it does
        // not, the bias is in the reconstruction (normals, projection) rather than
        // in the sampling, and no radius will fix it.
        // CLI overrides, so tuning is a run rather than an edit:
        //   --aocontact=0.5 --aoambient=1.0 --aointensity=0.85 --aopower=1.6
        const overrides: Record<string, number> = {};
        for (const [flag, key] of [
          ['aocontact', 'contactRadius'],
          ['aoambient', 'ambientRadius'],
          ['aointensity', 'intensity'],
          ['aopower', 'power'],
          ['aosamples', 'samples'],
        ] as const) {
          const value = arg(flag, '');
          if (value !== '') overrides[key] = Number(value);
        }
        const baseParams = {
          ...(await page.evaluate(
            () =>
              (
                window as never as {
                  __IV__: { renderDebug(): { ao: Record<string, number> | null } };
                }
              ).__IV__.renderDebug().ao ?? {},
          )),
          ...overrides,
        };
        if (Object.keys(overrides).length) {
          await callApi('setAoParams', baseParams);
          console.log(`  ao overrides: ${JSON.stringify(overrides)}`);
        }
        // MSAA is the second axis because the depth the pass reads is *resolved*
        // out of a multisampled target: if that resolve does not reach the texture
        // the pass samples, every depth value is stale, and the symptom is exactly
        // a term that ignores its own radius.
        const requestedMsaa = await page.evaluate(
          () =>
            (
              window as never as { __IV__: { renderDebug(): { msaaSamplesRequested: number } } }
            ).__IV__.renderDebug().msaaSamplesRequested,
        );
        console.log('  term vs radius and MSAA (mean / p1 / p50 luma)')
        for (const samples of [requestedMsaa, 0]) {
          await callApi('setMsaa', samples);
          for (const radius of [0.0, 0.34, 1.3]) {
            await callApi('setAoParams', { ...baseParams, contactRadius: radius, ambientRadius: radius });
            await callApi('setAo', [true, 'ao']);
            await page.waitForTimeout(220);
            const png = await page.screenshot();
            writeFileSync(join(OUT, `ao-ladder-msaa${samples}-r${radius}.png`), png);
            const metrics = await analyseFrame(page, png);
            console.log(
              `    msaa ${samples}  r=${radius.toFixed(2)}m  mean ${metrics.mean.toFixed(1)}  ` +
                `p1 ${metrics.p1}  p50 ${metrics.p50}  p99 ${metrics.p99}`,
            );
          }
        }
        await callApi('setMsaa', requestedMsaa);
        await callApi('setAoParams', baseParams);
        await callApi('setAo', [true, 'composite']);

        // Is a difference between "AO off" and "AO on" attributable to the AO
        // term at all? With `intensity: 0` the term is exactly 1.0, so the pass
        // still runs and multiplies by one: any residual difference between that
        // frame and the disabled-pass frame is pipeline state, not occlusion.
        await callApi('setAo', [true, 'composite']);
        await page.waitForTimeout(200);
        const termOff = await page.screenshot();
        await callApi('setAoParams', { ...baseParams, intensity: 0 });
        await page.waitForTimeout(200);
        const neutral = await page.screenshot();
        await callApi('setAoParams', baseParams);          const neutralDiff = await diffFrames(page, termOff, neutral);          console.log(
          `  pass-on with intensity 0 vs pass-off: mean |Δ| ${neutralDiff.meanAbs.toFixed(2)}  ` +
            `changed ${neutralDiff.changedPct.toFixed(1)}%  darker ${neutralDiff.darkerPct.toFixed(1)}%  ` +
            `brighter ${neutralDiff.brighterPct.toFixed(1)}%  frame ${neutralDiff.meanLeft.toFixed(1)} vs ${neutralDiff.meanRight.toFixed(1)}`,
        );
        // The pass running with `intensity: 0` is a multiply by exactly one, so
        // this is the *pass-off* frame against a neutral pass — the test that says
        // whether an A/B difference is the term or the pipeline.
        await callApi('setAo', false);
        await page.waitForTimeout(200);
        const passOff = await page.screenshot();
        const neutralVsOff = await diffFrames(page, passOff, neutral);
        console.log(
          `  pass-off vs pass-on-intensity-0: mean |Δ| ${neutralVsOff.meanAbs.toFixed(2)}  ` +
            `changed ${neutralVsOff.changedPct.toFixed(1)}%  frame ${neutralVsOff.meanLeft.toFixed(1)} vs ${neutralVsOff.meanRight.toFixed(1)}`,
        );
        // And: the pass in the chain but disabled (which leaves the depth texture
        // on the scene target) against a composer built with no AO pass and no
        // depth texture at all. If those two differ, the *attachment* is what
        // changes the image, not the shading.
        await callApi('setAo', false);
        await page.waitForTimeout(220);
        const passDisabled = await page.screenshot();
        await callApi('setAoQuality', 0);
        await page.waitForTimeout(220);
        const noPass = await page.screenshot();
        const attachDiff = await diffFrames(page, passDisabled, noPass);
        console.log(
          `  pass-disabled vs composer-without-pass: mean |Δ| ${attachDiff.meanAbs.toFixed(2)}  ` +
            `changed ${attachDiff.changedPct.toFixed(1)}%`,
        );
        await callApi('setAoQuality', baseParams.samples ?? 8);
        await callApi('setAo', [true, 'composite']);

        // Barrel: contact only. The sampling point sits 0.72 m from the axis, on
        // the side the sun does not shadow, so a shadow map cannot explain a value.
        const barrel = prop(PLAZA_MAP, 'barrel', 0);
        await poseTo(poseLookingAt({ x: barrel.x + PERP.x * 4, z: barrel.z + PERP.z * 4 }, { x: barrel.x, z: barrel.z, y: 0.5 }), {
          x: barrel.x,
          y: 0.6,
          z: barrel.z,
        });
        await shotsAt('barrel', [
          { name: 'ring', x: barrel.x - SHADOW_DIR.x * 0.72, y: 0.05, z: barrel.z - SHADOW_DIR.z * 0.72, r: 2 },
          { name: 'sideRing', x: barrel.x + PERP.x * 0.72, y: 0.05, z: barrel.z + PERP.z * 0.72, r: 2 },
          { name: 'open', x: barrel.x - SHADOW_DIR.x * 1.7, y: 0.05, z: barrel.z - SHADOW_DIR.z * 1.7, r: 3 },
        ]);

        // Wall: corner only.
        const wall = PLAZA_MAP.props.find(
          (entry) => entry.kind === 'wall' && (entry as { z?: number }).z !== undefined,
        ) as { x: number; z: number; size?: number; depth?: number };
        const size = wall.size ?? 52;
        const depth = wall.depth ?? 2;
        const alongX = size >= depth;
        const halfThickness = (alongX ? depth : size) / 2;
        const sign = Math.sign((alongX ? -wall.z : -wall.x)) || 1;
        const normal = alongX ? { x: 0, z: sign } : { x: sign, z: 0 };
        const face = { x: wall.x + normal.x * halfThickness, z: wall.z + normal.z * halfThickness };
        const wallPoints: Patch[] = [0.3, 1.0, 2.0].map((distance) => ({
          name: `base${distance}`,
          x: face.x + normal.x * distance,
          y: 0.06,
          z: face.z + normal.z * distance,
          r: distance < 0.5 ? 2 : 3,
        }));
        wallPoints.push({
          name: 'wallFace',
          x: face.x + normal.x * 0.05,
          y: 1.2,
          z: face.z + normal.z * 0.05,
          r: 3,
        });
        await poseTo(
          poseLookingAt({ x: face.x + normal.x * 5, z: face.z + normal.z * 5 }, { x: face.x, y: 0.5, z: face.z }),
          { x: face.x, y: 1.2, z: face.z },
        );
        await shotsAt('wall', wallPoints);

        // A body: the case the whole term is for. Its feet must meet the ground.
        await page.evaluate(() => {
          const api = (window as never as { __IV__: { spawn(kind: string, distance: number): number } }).__IV__;
          api.spawn('rifleman', 7);
        });
        await page.waitForTimeout(300);
        const enemies = await page.evaluate(() =>
          (window as never as { __IV__: { enemies(): { x: number; z: number }[] } }).__IV__.enemies(),
        );
        const npc = enemies[0];
        if (npc) {
          await poseTo(
            poseLookingAt({ x: npc.x + PERP.x * 4.5, z: npc.z + PERP.z * 4.5 }, { x: npc.x, z: npc.z, y: 1.0 }),
            { x: npc.x, y: 1.0, z: npc.z },
          );
          await shotsAt('npc', [
            // 0.45 m out: clear of the boot itself (whose own dark leather is not
            // the AO term) but still inside the contact kernel.
            { name: 'feet', ...alongShadow(npc, 0.45), y: 0.05, r: 2 },
            { name: 'perp', x: npc.x + PERP.x * 1.1, y: 0.05, z: npc.z + PERP.z * 1.1, r: 3 },
          ]);
        }
        await callApi('setAo', [true, 'composite']);
        await callApi('lockResolution', null);
      },
    },
    {
      name: 'npc-contact',
      run: async () => {
        await page.evaluate(() => {
          const api = (window as never as { __IV__: { spawn(kind: string, distance: number): number } }).__IV__;
          api.spawn('rifleman', 7);
        });
        const enemies = await page.evaluate(() =>
          (window as never as { __IV__: { enemies(): { x: number; z: number }[] } }).__IV__.enemies(),
        );
        const npc = enemies[0];
        if (!npc) throw new Error('no enemy spawned for the contact probe');
        // Perpendicular to the shadow direction: the feet, the shadow the body
        // throws and the lit ground beside it are all visible and unobstructed.
        const from = { x: npc.x + PERP.x * 4.5, z: npc.z + PERP.z * 4.5 };
        const points: Patch[] = [
          // 0.3 m out: past the boot (whose own dark leather would otherwise be
          // measured) but still inside the contact term's ~0.5 m radius.
          { name: 'feet', ...alongShadow(npc, 0.3), y: 0.05, r: 2 },
          { name: 'shadowHalf', ...alongShadow(npc, 0.9), y: 0.05, r: 3 },
          { name: 'shadowFull', ...alongShadow(npc, 1.5), y: 0.05, r: 3 },
          { name: 'perp', x: npc.x + PERP.x * 1.1, y: 0.05, z: npc.z + PERP.z * 1.1, r: 3 },
          { name: 'torso', x: npc.x, y: 1.05, z: npc.z, r: 3 },
        ];
        const pose = poseLookingAt(from, { x: npc.x, z: npc.z, y: 1.0 });
        groundSets.npc = { pose, points };
        const metrics = await atPose(
          '11-npc-contact',
          pose,
          points,
          'NPC feet contact + body shadow vs lit ground',
        );
        const byName = (key: string): number =>
          metrics.patches.find((patch) => patch.name === key)?.mean ?? 0;
        const litLuma = Math.max(1, byName('perp'));
        report('npcContact', (litLuma - byName('feet')) / litLuma);
        report('npcShadow', (litLuma - byName('shadowHalf')) / litLuma);
      },
    },
    {
      name: 'wall-corner',
      run: async () => {
        // The plaza's perimeter wall, sampled on its *inner* face: that is where a
        // wall meets the ground, which is the corner AO is supposed to deepen.
        const wall = PLAZA_MAP.props.find(
          (entry) => entry.kind === 'wall' && (entry as { z?: number }).z !== undefined,
        ) as { x: number; z: number; size?: number; depth?: number };
        const size = wall.size ?? 52;
        const depth = wall.depth ?? 2;
        const alongX = size >= depth;
        const halfThickness = (alongX ? depth : size) / 2;
        // Inward normal: walls are axis aligned and face the plaza centre.
        const sign = Math.sign((alongX ? -wall.z : -wall.x)) || 1;
        const normal = alongX ? { x: 0, z: sign } : { x: sign, z: 0 };
        const face = {
          x: wall.x + normal.x * halfThickness,
          z: wall.z + normal.z * halfThickness,
        };
        const points: Patch[] = [0.3, 1.0, 2.0].map((distance) => ({
          name: `base${distance}`,
          x: face.x + normal.x * distance,
          y: 0.06,
          z: face.z + normal.z * distance,
          r: distance < 0.5 ? 2 : 3,
        }));
        const from = { x: face.x + normal.x * 5, z: face.z + normal.z * 5 };
        const pose = poseLookingAt(from, { x: face.x, y: 0.5, z: face.z });
        groundSets.wall = { pose, points };
        await atPose('12-wall-corner', pose, points, 'ground away from the wall base: 0.3 / 1.0 / 2.0 m');
      },
    },
    {
      name: 'rail-silhouette',
      run: async () => {
        // Thin geometry against the sky: the fence, the lamp arm and the cables is
        // where aliasing is most visible (and where MSAA earns its cost).
        await atPose(
          '13-rail-silhouette',
          poseLookingAt({ x: lamp.x + 3.2, z: lamp.z + 3.2 }, { x: lamp.x, y: 5.2, z: lamp.z }),
          [],
          'thin geometry against the sky (AA)',
        );
      },
    },
    {
      name: 'streetlight',
      run: async () => {
        // Aimed between the head and the ground so the emitter, its pool and the
        // shade beside it are all in frame at once: that is the exposure test.
        const pose = poseLookingAt(
          { x: lamp.x + 5.5, z: lamp.z + 5.5 },
          { x: lamp.x, y: 3, z: lamp.z },
        );
        const metrics = await atPose(
          '14-streetlight',
          pose,
          [
            { name: 'bulb', x: lamp.x, y: 5.45, z: lamp.z, r: 2 },
            { name: 'pool', x: lamp.x + 1.2, y: 0.06, z: lamp.z + 1.2, r: 4 },
            { name: 'shade', x: lamp.x - SHADOW_DIR.x * 1.5, y: 0.06, z: lamp.z - SHADOW_DIR.z * 1.5, r: 4 },
          ],
          'emitter + lit pool + deep shade (exposure)',
        );
        report('emitterBright', metrics.brightPct);
        const lit = Math.max(1, metrics.patches.find((patch) => patch.name === 'pool')?.mean ?? 0);
        const shade = metrics.patches.find((patch) => patch.name === 'shade')?.mean ?? 0;
        report('shadeDetail', shade);
        report('lightFalloff', (lit - shade) / lit);
      },
    },
    {
      name: 'lighting',
      run: async () => {
        // The lighting rig, one group at a time.
        //
        // Every reading is an A/B pair at a *frozen* pose: the same frame with one
        // group of the rig switched off and on (`__IV__.setLighting`), sampled at
        // world points that should move and points that should not. That is what
        // separates "the lamps light their pavement" from "the pavement is brighter
        // there anyway", and it is the only honest way to check a light rig whose
        // whole job is to make some places warmer and brighter than others.
        await callApi('lockResolution', 1);

        /** Relative darkening of every patch when `group` is switched off. */
        const ab = async (
          slot: string,
          groups: string | string[],
          pose: { x: number; z: number; yaw: number; pitch: number },
          points: Patch[],
        ): Promise<AbResult> => {
          await page.evaluate((next) => {
            const api = (
              window as never as { __IV__: { pose(x: number, z: number, yaw: number, pitch: number): void } }
            ).__IV__;
            api.pose(next.x, next.z, next.yaw, next.pitch);
          }, pose);
          await settlePose(points[0]!);
          const screenPoints = await page.evaluate((patches) => {
            const api = (
              window as never as {
                __IV__: { project(x: number, y: number, z: number): { x: number; y: number } };
              }
            ).__IV__;
            return patches.map((patch) => ({ ...patch, ...api.project(patch.x, patch.y, patch.z) }));
          }, points);

          const set = (on: boolean): Promise<unknown> => {
            const list = Array.isArray(groups) ? groups : [groups];
            return list.reduce<Promise<unknown>>(
              (chain, group) => chain.then(() => callApi('setLighting', [group, on])),
              Promise.resolve(),
            );
          };
          await set(true);
          await page.waitForTimeout(220);
          const on = await page.screenshot();
          writeFileSync(join(OUT, `lighting-${slot}-${slot}-on.png`), on);
          await set(false);
          await page.waitForTimeout(220);
          const off = await page.screenshot();
          writeFileSync(join(OUT, `lighting-${slot}-${slot}-off.png`), off);
          await set(true);

          const onFrame = await analyseFrame(page, on, screenPoints);
          const offFrame = await analyseFrame(page, off, screenPoints);
          const frameDiff = await diffFrames(page, off, on);
          const parts: string[] = [];
          const readings: Record<string, { drop: number; warmth: number }> = {};
          for (const patch of onFrame.patches) {
            const without = offFrame.patches.find((entry) => entry.name === patch.name)!;
            if (!patch.count || !without.count) {
              parts.push(`${patch.name} OFF-FRAME`);
              continue;
            }
            // How much light this group contributes at that point: 0 = nothing,
            // +1 = everything, and >1 means the point was almost black without it.
            //
            // Positive means *the group made it brighter*, which is what the targets
            // are written against ("a lamp lights its own pavement", min 0.3). This
            // used to be `(without - with) / without`, i.e. negative for every working
            // light, so the whole light-group table was unsatisfiable and read as six
            // broken lights. The frame means are what settle the sign: with the lamps
            // enabled the frame is `42.6 → 86.8`, so `true` means on and a working
            // lamp must report a positive contribution.
            //
            // The denominator is floored at one luma level rather than gated at it, and
            // that distinction is a *measurement* one: a surface this group alone lights
            // goes to black when the group is off, and `> 1 ? … : 0` reported that as
            // "the group does nothing here" — the exact opposite. Reading >1 now means
            // "this group is essentially all of the light at this point" (the fill on a
            // shadowed pad reads ~10), which is the truth about a shadow with a full-strength
            // key and is what `lighting-ambient_shadowGround` is there to see.
            const drop = (patch.mean - without.mean) / Math.max(without.mean, 1);
            readings[patch.name] = { drop, warmth: patch.warmth };
            report(`lighting-${slot}_${patch.name}`, drop);
            parts.push(
              `${patch.name} ${drop >= 0 ? '+' : ''}${(drop * 100).toFixed(1)}%` +
                ` of ${patch.mean.toFixed(0)}` +
                ` (warmth ${patch.warmth >= 0 ? '+' : ''}${patch.warmth.toFixed(3)})`,
            );
          }
          console.log(
            `  ${`${slot}/${Array.isArray(groups) ? groups.join('+') : groups}`.padEnd(22)} ${parts.join('  ')}  |  frame mean ` +
              `${frameDiff.meanLeft.toFixed(1)} → ${frameDiff.meanRight.toFixed(1)}  ` +
              `changed ${frameDiff.changedPct.toFixed(1)}%`,
          );
          return {
            readings,
            frames: {
              onMean: frameDiff.meanRight,
              offMean: frameDiff.meanLeft,
              onDetail: onFrame.detail,
              offDetail: offFrame.detail,
              changedPct: frameDiff.changedPct,
            },
          };
        };

        // ---- street lamps: a warm pool with real distance falloff ------------
        const lamp = plazaLamp();
        const head = { x: lamp.x + 0.6, z: lamp.z };
        const toward = Math.SQRT1_2; // 45° view line, so the pool is not axis-aligned
        const away = { x: toward, z: toward };
        const lampPose = poseLookingAt(
          { x: head.x + away.x * 10, z: head.z + away.z * 10 },
          { x: head.x, y: 0.5, z: head.z },
        );
        const lampPatches: Patch[] = [
          { name: 'pool', x: head.x + away.x * 0.8, y: 0.06, z: head.z + away.z * 0.8, r: 3 },
          { name: 'near3', x: head.x + away.x * 3, y: 0.06, z: head.z + away.z * 3, r: 3 },
          { name: 'mid6', x: head.x + away.x * 6, y: 0.06, z: head.z + away.z * 6, r: 3 },
        ];
        const lampReadings = await ab('lamps', 'lamps', lampPose, lampPatches);
        const pool = lampReadings.readings.pool?.drop ?? 0;
        const mid = lampReadings.readings.mid6?.drop ?? 0;
        // The *shape* of the falloff, not its absolute value: a lamp that lit its
        // pavement and its neighbours' pavement equally would be a flat ambient term.
        report('lighting-lamps_falloff', pool > 0.01 ? (pool - mid) / pool : 0);

        // Warmth: the pool must be warmer than the moonlit field beside it, which is
        // the whole "warm local sources inside a cool environment" requirement.
        const poolWarmth = lampReadings.readings.pool?.warmth ?? 0;
        const midWarmth = lampReadings.readings.mid6?.warmth ?? 0;
        report('lighting-lamps_warmthDelta', poolWarmth - midWarmth);

        // Control: 36 m from the nearest lamp, outside its range (22–32 m), the same
        // toggle must do nothing at all. Without this, "the lamp lit it" could just be
        // "the frame changed". The point is picked for its *distance*, not for its
        // looks: the plaza is only ~116 m across, so the far corner is the only place
        // in it that is genuinely out of every lamp's reach.
        await ab('lampsFar', 'lamps', poseLookingAt({ x: 44, z: -6 }, { x: 48, y: 0.06, z: -6 }), [
          { name: 'farControl', x: 48, y: 0.06, z: -6, r: 4 },
        ]);

        // ---- the moon key: does it reveal form? ------------------------------
        const building = PLAZA_MAP.props.find((prop) => prop.kind === 'building') as {
          x: number;
          z: number;
          size?: number;
          depth?: number;
          height?: number;
        };
        const width = building.size ?? 12;
        // The patches are *ground*, not wall, and that is deliberate. A facade sample has to
        // guess a building's real extent and normal from the map — and a patch 8 cm off a wall
        // that the map and the builder disagree about, or that a balcony, pilaster, canopy or
        // neighbouring block happens to stand in front of, silently samples something else and
        // reports the light as dead. Paving either side of a block is a flat, unambiguous
        // surface at a known height, and it carries exactly the same claim: the key lights one
        // side of a mass and leaves the other in shadow.
        const pad = 4.5;
        // The shadow pad is placed *by the sun*, not guessed: a block `h` tall throws its
        // shadow `h / tan(elevation)` metres along `SHADOW_DIR`, so the pad goes 60% of the
        // way along that throw — inside the shadow the key actually casts, not a metre off a
        // wall where a rotated block, a kerb or a neighbouring mass can decide the answer.
        const shadowReach = (building.height ?? 12) * (SUN_LENGTH / SUN.y);
        const cornerPose = poseLookingAt(
          { x: building.x, z: building.z + width + 22 },
          { x: building.x, y: 1.2, z: building.z },
        );
        const faces: Patch[] = [
          // The key comes from +x/-z (MOON_POSITION), so the +x side is lit and the shadow
          // falls along SHADOW_DIR, toward -x/+z.
          { name: 'litGround', x: building.x + width / 2 + pad, y: 0.06, z: building.z, r: 5 },
          {
            name: 'shadowGround',
            x: building.x + SHADOW_DIR.x * shadowReach * 0.6,
            y: 0.06,
            z: building.z + SHADOW_DIR.z * shadowReach * 0.6,
            r: 5,
          },
        ];
        const keyReadings = await ab('key', 'key', cornerPose, faces);
        // The frame-level version of the same claim: with the key off the image must lose
        // *form* (its high-frequency energy), not just brightness.
        const keyFrames = keyReadings.frames;
        report(
          'lighting-key_contrast',
          keyFrames.offDetail > 0 ? (keyFrames.onDetail - keyFrames.offDetail) / keyFrames.offDetail : 0,
        );
        // ...and its share of the frame's light: how much of the image's brightness the
        // key supplies. A *patch* cannot answer "does the fill rival the key" — one surface
        // being mostly fill-lit is expected (that is what a shadow is) — but the frame can.
        report(
          'lighting-key_frameShare',
          keyFrames.onMean > 0 ? (keyFrames.onMean - keyFrames.offMean) / keyFrames.onMean : 0,
        );
        // The fill term is the hemisphere *and* the sky's image-based lighting: they are two
        // switches (`ambient`, `reflections`) and one physical thing, and the sky is the bigger
        // half of it. Toggling only the hemisphere measured 0.4% and read as "ambient does
        // nothing" when what it was doing was measuring a third of itself.
        const ambientReadings = await ab('ambient', ['ambient', 'reflections'], cornerPose, faces);
        const fillFrames = ambientReadings.frames;
        report(
          'lighting-fill_frameShare',
          fillFrames.onMean > 0 ? (fillFrames.onMean - fillFrames.offMean) / fillFrames.onMean : 0,
        );
        // Fill quality, as one number: the ambient must matter far more on the
        // shadowed face (where it is the only light) than on the lit one (where the
        // key should dominate). A fill that scores near zero here is a second key
        // light wearing an ambient's name, and it is what flattens a scene.
        report(
          'lighting-fill_balance',
          (ambientReadings.readings.shadowGround?.drop ?? 0) - (ambientReadings.readings.litGround?.drop ?? 0),
        );

        // ---- windows: a local light that reaches its own wall -----------------
        const nearest = await page.evaluate(() => {
          const api = (
            window as never as {
              __IV__: {
                renderDebug(): {
                  lighting: { windows: { nearest: { x: number; y: number; z: number } | null } };
                };
              };
            }
          ).__IV__;
          return api.renderDebug().lighting.windows.nearest;
        });
        if (nearest) {
          // Stand inside the compound and look back at the window: windows are on
          // the perimeter walls, which face the arena centre.
          const length = Math.max(0.001, Math.hypot(nearest.x, nearest.z));
          const inward = { x: -nearest.x / length, z: -nearest.z / length };
          const tangent = { x: -inward.z, z: inward.x };
          const windowPose = poseLookingAt(
            { x: nearest.x + inward.x * 5, z: nearest.z + inward.z * 5 },
            { x: nearest.x, y: nearest.y, z: nearest.z },
          );
          await ab('windows', 'windows', windowPose, [
            { name: 'wall', x: nearest.x + tangent.x * 1.6, y: nearest.y, z: nearest.z + tangent.z * 1.6, r: 4 },
            { name: 'below', x: nearest.x + inward.x * 0.7, y: 0.06, z: nearest.z + inward.z * 0.7, r: 3 },
            { name: 'far6', x: nearest.x + inward.x * 6, y: 0.06, z: nearest.z + inward.z * 6, r: 4 },
          ]);
        } else {
          console.log('  no window anchors in the arena — window lights skipped');
        }

        // ---- reflections: the bounce term ------------------------------------
        await ab('reflections', 'reflections', cornerPose, faces);

        // ---- the night as a whole --------------------------------------------
        // Everything on, at the wide pose: the frame has to stay a night frame (and
        // keep its darks) with the whole rig running.
        const night = await atPose(
          '17-lighting-night',
          poseLookingAt({ x: 0, z: 34 }, { x: 0, y: 3.4, z: -6 }),
          [
            { name: 'moonlit', x: 0, y: 0.06, z: 18, r: 4 },
            { name: 'lampPool', x: 12.6, y: 0.06, z: 2, r: 3 },
          ],
          'night mood: darks kept, emitters controlled',
        );
        report('lighting-night_darkPct', night.darkPct);
        report('lighting-night_brightPct', night.brightPct);
        report('lighting-night_detail', night.detail);
        const moonlit = night.patches.find((patch) => patch.name === 'moonlit');
        const lampPool = night.patches.find((patch) => patch.name === 'lampPool');
        if (moonlit && lampPool) {
          console.log(
            `  ${'moon vs lamp'.padEnd(22)} moonlit ${moonlit.mean.toFixed(0)} ` +
              `(warmth ${moonlit.warmth.toFixed(3)})  lampPool ${lampPool.mean.toFixed(0)} ` +
              `(warmth ${lampPool.warmth.toFixed(3)})`,
          );
          // Printed, not asserted, and that distinction is the honest one: comparing two
          // *different* patches of one frame compares whatever else is in them (a puddle, a
          // kerb, a sand drift), so it cannot isolate the lamp. The claim is gated where it
          // can be measured as a pair — `lighting-lamps_warmthDelta`, on the same patch with
          // the lamps on and off. This line is here so the two readings are visible together.
        }
        await callApi('lockResolution', null);
      },
    },
    {
      name: 'plaza-wide',
      run: async () => {
        const metrics = await atPose(
          '15-plaza-wide',
          poseLookingAt({ x: 0, z: 34 }, { x: 0, y: 3.4, z: -6 }),
          [],
          'the money shot: histogram spread, saturation',
        );
        report('darkest', metrics.p1);
        report('spread', metrics.midContrast);
      },
    },
  ];

  const report = (key: string, value: number): void => {
    measured[key] = value;
  };
  const measured: Record<string, number> = {};

  for (const probe of probes) {
    if (ONLY && probe.name !== ONLY) continue;
    console.log(`\n${probe.name}`);
    await probe.run();
  }

  // Effect A/B: what each stage actually contributes to the frame.
  if (!ONLY) {
    console.log('\neffect A/B (same pose, effect off vs on)');
    const requested = await page.evaluate(
      () =>
        (
          window as never as { __IV__: { renderDebug(): { msaaSamplesRequested: number } } }
        ).__IV__.renderDebug().msaaSamplesRequested,
    );
    const pairs: Array<{
      name: string;
      key: string;
      off: unknown;
      on: unknown;
      sets: string[];
    }> = [
      { name: 'shadows', key: 'setShadows', off: false, on: true, sets: [] },
      { name: 'grade', key: 'setGrade', off: false, on: true, sets: [] },
      // MSAA rebuilds the composer rather than toggling a flag, so it is driven
      // through setMsaa; the pair is still the same before/after capture.
      { name: 'msaa', key: 'setMsaa', off: 0, on: requested, sets: [] },
      // Patch-proven pairs: the world points the effect is supposed to change.
      { name: 'shadow-cast', key: 'setShadows', off: false, on: true, sets: ['car'] },
      { name: 'contact-ao', key: 'setAo', off: false, on: true, sets: ['barrel', 'npc'] },
      { name: 'corner-ao', key: 'setAo', off: false, on: true, sets: ['wall'] },
    ];
    const poseTo = async (
      pose: { x: number; z: number; yaw: number; pitch: number },
      reference: { x: number; y: number; z: number },
    ): Promise<void> => {
      await page.evaluate((next) => {
        const api = (
          window as never as { __IV__: { pose(x: number, z: number, yaw: number, pitch: number): void } }
        ).__IV__;
        api.pose(next.x, next.z, next.yaw, next.pitch);
      }, pose);
      await settlePose(reference);
    };
    // Pin the resolution for the whole A/B block. Otherwise switching an effect
    // off makes the frame cheaper, the controller raises the resolution, and the
    // pair differs in sharpness as well as in the effect being measured.
    await callApi('lockResolution', 1);
    await page.waitForTimeout(200);

    for (const pair of pairs) {
      const key = pair.key;
      const sets = pair.sets.map((name) => ({ name, set: groundSets[name] })).filter((entry) => entry.set);
      if (pair.sets.length && sets.length === 0) continue;
      if (sets.length) await poseTo(sets[0]!.set!.pose, sets[0]!.set!.points[0]!);

      await callApi(key, pair.on);
      await page.waitForTimeout(200);
      let on = await page.screenshot();
      await callApi(key, pair.off);
      await page.waitForTimeout(200);
      let off = await page.screenshot();
      await callApi(key, pair.on);
      const diff = await diffFrames(page, off, on);
      diffs.push({ name: pair.name, ...diff });
      writeFileSync(join(OUT, `ab-${pair.name}-on.png`), on);
      writeFileSync(join(OUT, `ab-${pair.name}-off.png`), off);
      console.log(
        `  ${pair.name.padEnd(12)} mean |Δ| ${diff.meanAbs.toFixed(1)}  ` +
          `changed ${diff.changedPct.toFixed(1)}%  darker ${diff.darkerPct.toFixed(1)}%`,
      );

      // The strongest evidence that an effect grounds an object is not a
      // whole-frame average: it is the delta at the world points that *should*
      // change, read out of the *same pixels* in both states.
      for (const { name, set } of sets) {
        // Each set needs its *own* before/after frames: the pair above was
        // captured at the first set's pose, so re-using it for a second set would
        // sample one pose's pixels against another pose's screenshot.
        if (name !== sets[0]?.name) {
          await poseTo(set!.pose, set!.points[0]!);
          await callApi(key, pair.on);
          await page.waitForTimeout(200);
          on = await page.screenshot();
          await callApi(key, pair.off);
          await page.waitForTimeout(200);
          off = await page.screenshot();
          await callApi(key, pair.on);
        }
        const withEffect = await patchMeans(on, set!.points);
        const withoutEffect = await patchMeans(off, set!.points);
        const parts: string[] = [];
        for (const [patchName, value] of Object.entries(withEffect)) {
          const withoutValue = withoutEffect[patchName] ?? value;
          const delta = withoutValue - value;
          const relative = withoutValue > 1 ? delta / withoutValue : 0;
          report(`${pair.name}_${name}_${patchName}`, relative);
          parts.push(`${patchName} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} (${(relative * 100).toFixed(0)}%)`);
        }
        console.log(
          `  ${' '.repeat(12)} ${name}: positive = darker with it on  ${parts.join('  ')}`,
        );
      }
    }

    if (arg('aodebug', '0') === '1') {
      // The AO term is easy to ship broken and invisible: the pass renders, its
      // depth feed is empty, and nothing looks wrong. These frames say which stage
      // is empty — a flat white AO view means no occlusion is being found, and a
      // flat grey depth view means the pass is not reading the depth buffer the
      // scene was drawn into (the bug post/ao.ts was written to fix).
      console.log('\nAO feeds and parameter sweep');
      const barrelSet = groundSets.barrel;
      const wallSet = groundSets.wall;
      await poseTo(
        barrelSet?.pose ?? poseLookingAt({ x: 0, z: 20 }, { x: 0, y: 1, z: 0 }),
        barrelSet?.points[0] ?? { x: 0, y: 1, z: 0 },
      );

      for (const feed of ['depth', 'normal', 'ao'] as const) {
        await callApi('setAo', [true, feed]);
        await page.waitForTimeout(220);
        const png = await page.screenshot();
        writeFileSync(join(OUT, `ao-feed-${feed}.png`), png);
        const metrics = await analyseFrame(page, png);
        console.log(
          `  feed ${feed.padEnd(7)} p5 ${metrics.p5} p25 ${metrics.p25} p50 ${metrics.p50} p95 ${metrics.p95}`,
        );
      }

      // `setAoParams` merges into the live options, so every variant is expressed
      // as the tier's own preset plus a delta — otherwise each row would silently
      // inherit the previous row's change and the sweep would read as noise.
      const base = await page.evaluate(
        () =>
          (
            window as never as {
              __IV__: { renderDebug(): { ao: Record<string, number> | null } };
            }
          ).__IV__.renderDebug().ao ?? {},
      );
      const variants: Array<{ name: string; params: Record<string, number> }> = [
        { name: 'preset', params: { ...base } },
        { name: 'tight', params: { ...base, contactRadius: 0.2, ambientRadius: 0.8 } },
        { name: 'wide', params: { ...base, contactRadius: 0.55, ambientRadius: 2 } },
        { name: 'strong', params: { ...base, intensity: 1, power: 1.2 } },
        { name: 'deep', params: { ...base, intensity: 1, power: 2.4 } },
        { name: 'half-res', params: { ...base, scale: 0.5 } },
      ];
      for (const variant of variants) {
        await callApi('setAoParams', variant.params);
        // (a) the raw AO term: how deep the occlusion actually goes.
        await callApi('setAo', [true, 'ao']);
        await page.waitForTimeout(220);
        const aoPng = await page.screenshot();
        writeFileSync(join(OUT, `ao-term-${variant.name}.png`), aoPng);
        const aoMetrics = await analyseFrame(page, aoPng);
        const aoPatches = barrelSet ? await patchMeans(aoPng, barrelSet.points) : {};
        // (b) the composite, with and without the pass: what the player sees.
        await callApi('setAo', [true, 'composite']);
        await page.waitForTimeout(200);
        await callApi('setAo', true);
        await page.waitForTimeout(200);
        const onPng = await page.screenshot();
        await callApi('setAo', false);
        await page.waitForTimeout(200);
        const offPng = await page.screenshot();
        await callApi('setAo', true);
        const barOn = barrelSet ? await patchMeans(onPng, barrelSet.points) : {};
        const barOff = barrelSet ? await patchMeans(offPng, barrelSet.points) : {};
        const wallOn = wallSet ? await patchMeans(onPng, wallSet.points) : {};
        const wallOff = wallSet ? await patchMeans(offPng, wallSet.points) : {};
        const delta = (a: Record<string, number>, b: Record<string, number>, key: string): string => {
          const without = b[key] ?? 0;
          const with_ = a[key] ?? 0;
          const relative = without > 1 ? (without - with_) / without : 0;
          return `${key} ${(relative * 100).toFixed(0)}%`;
        };
        const diff = await diffFrames(page, offPng, onPng);
        console.log(
          `  ${variant.name.padEnd(10)} term p5 ${aoMetrics.p5} p50 ${aoMetrics.p50}  ` +
            `barrel ${Object.entries(aoPatches).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ')}`,
        );
        console.log(
          `  ${' '.repeat(10)} frame: ${delta(barOn, barOff, 'ring')}  ${delta(barOn, barOff, 'open')}  ` +
            `${delta(wallOn, wallOff, 'base0.3')}  ${delta(wallOn, wallOff, 'base1')}  ` +
            `whole-frame mean ${(diff.meanAbs * 100 / 255).toFixed(2)}  changed ${diff.changedPct.toFixed(1)}%`,
        );
        results.push({
          name: `ao-${variant.name}`,
          metrics: aoMetrics,
          note: JSON.stringify(variant.params),
        });
      }
      // Restore the shipped configuration: setQuality rebuilds the composer with
      // the preset values, which is exactly what the sweep was tuning.
      await callApi('setAo', [true, 'composite']);
      await callApi('setMsaa', requested);
      await page.evaluate((tier) => {
        (window as never as { __IV__: { setQuality(t: string): void } }).__IV__.setQuality(tier as string);
      }, QUALITY);
    }

    await callApi('lockResolution', null);
    await page.evaluate(() => {
      const api = (window as never as { __IV__: { freeze(on?: boolean): void } }).__IV__;
      api.freeze(false);
    });
  }

  // Black-frame hunt: hammer the frame loop and catch transients that a
  // deliberate single capture would miss.
  const hunt = Number(arg('hunt', '30'));
  let worst = Number.POSITIVE_INFINITY;
  let worstAt = -1;
  let blackFrames = 0;
  for (let i = 0; i < hunt; i++) {
    await page.waitForTimeout(80);
    const png = await page.screenshot();
    const metrics = await analyseFrame(page, png);
    if (metrics.mean < worst) {
      worst = metrics.mean;
      worstAt = i;
    }
    if (metrics.darkPct > 90) {
      blackFrames++;
      writeFileSync(join(OUT, `black-${i}.png`), png);
    }
  }
  console.log(
    `\nblack-frame hunt (${hunt} frames): worst mean ${worst.toFixed(1)} at frame ${worstAt}, frames >90% dark: ${blackFrames}`,
  );

  // Death state: the results screen and the damage vignette are both dark UI, so
  // this is the frame most likely to be mistaken for a black-screen bug.
  await page.evaluate(() => {
    (window as never as { __IV__: { die(): void } }).__IV__.die();
  });
  await page.waitForTimeout(1400);
  console.log('05-death');
  await capture('05-death');

  // Scene census: draw-call sources. This is what makes the budget model in
  // docs/PERF_BUDGET.md checkable instead of aspirational.
  const census = await page.evaluate(() =>
    (window as never as { __IV__: { sceneCensus(): { total: number; top: string[] } } }).__IV__.sceneCensus(),
  );
  console.log(`\nscene census: ${census.total} drawable objects`);
  for (const line of census.top) console.log(`  ${line}`);

  const stats = await page.evaluate(() => ({
    info: (window as never as { __IV__: { renderer(): unknown } }).__IV__.renderer(),
    debug: (window as never as { __IV__: { renderDebug(): unknown } }).__IV__.renderDebug(),
    state: (window as never as { __IV__: { state(): unknown } }).__IV__.state(),
  }));
  console.log('\nrenderer:', JSON.stringify(stats.info));
  console.log('pipeline:', JSON.stringify(stats.debug));
  console.log('state (post-death capture):', JSON.stringify(stats.state));

  // Targets and deltas.
  if (Object.keys(measured).length) {
    console.log('\ntargets');
    let failures = 0;
    for (const target of TARGETS) {
      const value = measured[target.key];
      if (value === undefined) continue;
      const below = target.min !== undefined && value < target.min;
      const above = target.max !== undefined && value > target.max;
      const ok = !below && !above;
      if (!ok) failures++;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${target.label.padEnd(34)} ${value.toFixed(3)}` +
          `${target.min !== undefined ? ` (min ${target.min})` : ''}${target.max !== undefined ? ` (max ${target.max})` : ''}`,
      );
    }
    console.log(`  ${failures === 0 ? 'all targets met' : `${failures} target(s) missed`}`);
  }

  if (BASELINE) {
    const baseline = JSON.parse(readFileSync(resolve(BASELINE), 'utf8')) as {
      measured?: Record<string, number>;
      results?: Array<{ name: string; metrics: FrameMetrics }>;
    };
    console.log(`\nvs baseline ${BASELINE}`);
    if (baseline.measured) {
      for (const key of Object.keys(measured)) {
        const before = baseline.measured[key];
        if (before === undefined) continue;
        const delta = measured[key]! - before;
        console.log(`  ${key.padEnd(18)} ${before.toFixed(3)} → ${measured[key]!.toFixed(3)}  ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`);
      }
    }
    for (const captureResult of results) {
      const before = baseline.results?.find((entry) => entry.name === captureResult.name)?.metrics;
      if (!before) continue;
      const spread = before.midContrast > 0 ? (captureResult.metrics.midContrast - before.midContrast) / before.midContrast : 0;
      const ramp = before.rampPerEdge > 0 ? (captureResult.metrics.rampPerEdge - before.rampPerEdge) / before.rampPerEdge : 0;
      const detail = before.detail > 0 ? (captureResult.metrics.detail - before.detail) / before.detail : 0;
      console.log(
        `  ${captureResult.name.padEnd(20)} spread ${(spread * 100).toFixed(0)}%  ramp/edge ${(ramp * 100).toFixed(0)}%  detail ${(detail * 100).toFixed(0)}%`,
      );
    }
  }

  const reportPath = JSON_OUT ? resolve(JSON_OUT) : join(OUT, 'report.json');
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        seed: SEED,
        quality: QUALITY,
        viewport: [1280, 720],
        measured,
        diffs,
        results,
        blackHunt: { frames: hunt, worstMean: worst, worstAt, blackFrames },
        renderer: stats.info,
        pipeline: stats.debug,
        state: stats.state,
        census,
        consoleErrors: [...new Set(problems)].slice(0, 12),
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${OUT} and ${reportPath}`);

  if (problems.length) {
    console.log('\nconsole errors/warnings:');
    for (const problem of [...new Set(problems)].slice(0, 12)) console.log(`  - ${problem}`);
  } else {
    console.log('\nconsole errors: none');
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
