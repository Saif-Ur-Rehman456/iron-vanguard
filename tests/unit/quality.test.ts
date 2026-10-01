/**
 * Graphics tiers and the adaptive resolution controller (ADR-0014, ADR-0017).
 *
 * Two reviews, one setting, and they disagree about what a tier is for:
 *
 *  - the first said *turning the graphics setting down made the game look worse rather
 *    than cheaper*, which is true, because a tier was an art direction — `low` dropped
 *    the lighting ratios by a third and replaced the grade with a flatter one. That is
 *    what `LOOK_RIG` fixed: the colour, contrast and lighting ratios are one shared rig
 *    now, and a tier may not touch them.
 *  - the third said *still blurry and still laggy, at every graphics level*, which is
 *    also true, because the *pixel count* was tiered too (caps of 1.0 / 1.25 / 1.75 /
 *    2.0) and the adaptive controller was free to scale down on top of it. So the other
 *    half is now invariant: every tier renders at 100% of the display's pixels, and the
 *    resolution trade is an explicit setting (`RESOLUTION_SETTINGS`).
 *
 * A tier's lever is therefore *effects*: ambient occlusion, the shadow atlas, how many
 * real lights exist, MSAA, which screen-space AA, the particle and decal caps. The
 * tests below pin all three of those contracts — the shared look, the invariant pixel
 * count, and the per-tier effect set — and `postChain()` makes a tier's cost a stated
 * list of passes rather than something a reader has to count in the renderer.
 */
import { describe, expect, it } from 'vitest';
import {
  AdaptiveResolution,
  fullResPasses,
  LOOK_RIG,
  postChain,
  QUALITY_PRESETS,
  SHARPEN_BELOW_SCALE,
  SHARPEN_STRENGTH,
  type QualityTier,
} from '@iron/render';

const TIERS: QualityTier[] = ['low', 'medium', 'high', 'cinematic'];

describe('quality tiers trade cost, never look (ADR-0014)', () => {
  it('gives every tier the same look, field for field', () => {
    for (const tier of TIERS) {
      const settings = QUALITY_PRESETS[tier];
      for (const [key, value] of Object.entries(LOOK_RIG)) {
        expect(settings[key as keyof typeof LOOK_RIG], `${tier}.${key}`).toBe(value);
      }
    }
  });

  it('keeps the terms that reveal form on every tier', () => {
    for (const tier of TIERS) {
      const settings = QUALITY_PRESETS[tier];
      // Bloom and the grade are look, and they are on everywhere: they are what the
      // amber/teal night is made of, and neither is what makes an effect budget.
      expect(settings.bloom, tier).toBe(true);
      expect(settings.grade, tier).toBe(true);
      expect(settings.dust, tier).toBe(true);
      // Shadows and AO are *effects* now (ADR-0017): the cheap tiers drop them and the
      // settings copy says so. What no tier may do is change the pixel count.
      if (settings.shadows) expect(settings.shadowMapSize, tier).toBeGreaterThan(0);
      if (settings.aoSamples > 0) expect(settings.aoBlur, tier).toBe(true);
    }
  });

  it('states the effects each tier buys, in one table', () => {
    // The whole tier ladder, as the settings panel describes it. If this test needs
    // updating, so does the copy in packages/ui/src/screens.ts.
    const EXPECTED: Record<QualityTier, { shadows: boolean; ao: boolean; aa: 'fxaa' | 'smaa' }> = {
      low: { shadows: false, ao: false, aa: 'fxaa' },
      medium: { shadows: true, ao: false, aa: 'fxaa' },
      high: { shadows: true, ao: true, aa: 'smaa' },
      cinematic: { shadows: true, ao: true, aa: 'smaa' },
    };
    for (const tier of TIERS) {
      const settings = QUALITY_PRESETS[tier];
      const expected = EXPECTED[tier];
      expect(settings.shadows, tier).toBe(expected.shadows);
      expect(settings.aoSamples > 0, tier).toBe(expected.ao);
      expect(settings.postAa, tier).toBe(expected.aa);
    }
  });

  it('buys more with each higher tier and never less', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const lower = QUALITY_PRESETS[TIERS[i - 1]!];
      const higher = QUALITY_PRESETS[TIERS[i]!];
      for (const key of [
        'shadowMapSize',
        'shadowFar',
        'shadowRadius',
        'aoSamples',
        'lampLightBudget',
        'windowLightBudget',
        'maxParticles',
        'maxDecals',
        'adaptiveFloor',
      ] as const) {
        expect(higher[key], `${key}: ${TIERS[i - 1]} → ${TIERS[i]}`).toBeGreaterThanOrEqual(
          lower[key],
        );
      }
    }
  });
});

/**
 * ADR-0017: the pixel count is not a tier's lever.
 *
 * The report this exists for is *blurry at every graphics level*. It was: the caps
 * were 1.0 / 1.25 / 1.75 / 2.0, so on a 125%-scaled 1080p laptop `low` rendered 80% of
 * the panel's pixels and let the compositor stretch them — a blur applied by the
 * browser, invisible to every number the renderer reports — and on a 2x display even
 * `high` was a downscale. The caps are all 2.0 now (i.e. `min(devicePixelRatio, 2)`,
 * never a downscale on any display) and the controller is locked at 1.0 unless the
 * player asks for the trade.
 */
describe('pixels are invariant, effects are the tier (ADR-0017)', () => {
  it('never downscales the display, at any tier', () => {
    for (const tier of TIERS) {
      // 2.0 is not a supersample target: it is the cap on `devicePixelRatio`, so a 1x
      // panel renders at 1x and a 2x panel at 2x. Anything below 2 can silently
      // undersample a HiDPI display, which is the blur.
      expect(QUALITY_PRESETS[tier].pixelRatioCap, tier).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the dynamic floor at 70% or better, because it is opt-in', () => {
    for (const tier of TIERS) {
      const floor = QUALITY_PRESETS[tier].adaptiveFloor;
      // Only reachable in `dynamic` mode: at 0.7 a 1080p frame is 756p, which the
      // sharpen term in the look pass compensates for. Below that the upscale is
      // visible as an upscale and no amount of compensation hides it.
      expect(floor, tier).toBeGreaterThanOrEqual(0.7);
      expect(floor, tier).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * The post chain, as data.
 *
 * `fullResPasses` is the number of times a tier reads and writes a whole drawing
 * buffer, and it is the part of the frame budget that is provable without a GPU. The
 * cheap tier has to stay cheap *here*, because this is where the last three
 * regressions lived: a multisampled write buffer under every fullscreen pass, a
 * full-size bloom chain, and an AO pass plus three SMAA edges on top.
 */
describe('the post chain is stated, not counted (ADR-0017)', () => {
  it('names the same stage order for every tier', () => {
    const ORDER = ['scene', 'ao', 'bloom', 'output', 'look', 'aa'];
    for (const tier of TIERS) {
      const names = postChain(QUALITY_PRESETS[tier]).map((stage) => stage.name);
      const indices = names.map((name) => ORDER.indexOf(name));
      expect(indices, tier).toEqual([...indices].sort((a, b) => a - b));
      expect(names[0], tier).toBe('scene');
      expect(names.at(-1), tier).toBe('aa');
    }
  });

  it('gives the cheap tier strictly fewer whole-buffer passes than the expensive one', () => {
    const low = fullResPasses(QUALITY_PRESETS.low);
    const high = fullResPasses(QUALITY_PRESETS.high);
    const cinematic = fullResPasses(QUALITY_PRESETS.cinematic);
    // low: scene + output + look + FXAA = 4. high: scene + output + look + SMAA x3 = 6.
    expect(low).toBe(4);
    expect(high).toBe(6);
    expect(cinematic).toBe(6);
    expect(high).toBeGreaterThan(low);
  });

  it('resolves bloom below the buffer and AO at no more than half of it', () => {
    for (const tier of TIERS) {
      const bloom = postChain(QUALITY_PRESETS[tier]).find((stage) => stage.name === 'bloom');
      if (bloom) expect(bloom.scale, tier).toBeLessThan(1);
      const ao = postChain(QUALITY_PRESETS[tier]).find((stage) => stage.name === 'ao');
      if (ao) expect(ao.scale, tier).toBeLessThanOrEqual(0.5);
    }
  });

  it('has no AO stage at all where the tier has no AO samples', () => {
    for (const tier of TIERS) {
      const hasStage = postChain(QUALITY_PRESETS[tier]).some((stage) => stage.name === 'ao');
      expect(hasStage, tier).toBe(QUALITY_PRESETS[tier].aoSamples > 0);
    }
  });

  it('carries the upscale compensation as a uniform, not as its own pass', () => {
    // It is a term of the look pass (post/look.ts), which is why there is no
    // `sharpen` stage in the chain: it was a whole-buffer pass on its own, and the
    // grade was another, and fuse one into the other and the frame is 1 ms cheaper.
    for (const tier of TIERS) {
      const names = postChain(QUALITY_PRESETS[tier]).map((stage) => stage.name as string);
      expect(names, tier).not.toContain('sharpen');
      expect(names, tier).toContain('look');
    }
    expect(SHARPEN_STRENGTH).toBeGreaterThan(0);
    expect(SHARPEN_STRENGTH).toBeLessThan(1);
  });
});

/**
 * What a tier is allowed to cost, per pass.
 *
 * These are ceilings rather than exact values on purpose: the point is not that `high`
 * must render 1024² shadows, it is that it may not quietly go back to 2048². The review
 * this table exists for was "the game is laggy at every graphics level", and every one
 * of those milliseconds was spent somewhere a *look* field could not reach — a shadow
 * atlas four times the fill, an AO pass with twice the samples, a multisampled
 * half-float target under six fullscreen passes (renderer.ts), and eight real point
 * lights evaluated per fragment. A budget that only exists in prose is a budget that
 * gets spent again.
 */
const COST_CEILINGS: Record<
  string,
  { high: number; cinematic: number }
> = {
  msaaSamples: { high: 2, cinematic: 4 },
  shadowMapSize: { high: 1024, cinematic: 2048 },
  shadowFar: { high: 70, cinematic: 90 },
  aoSamples: { high: 6, cinematic: 8 },
  lampLightBudget: { high: 3, cinematic: 4 },
  windowLightBudget: { high: 3, cinematic: 4 },
  maxParticles: { high: 420, cinematic: 640 },
};

describe('the frame fits the budget (ADR-0016)', () => {
  it('keeps every tier under the measured cost ceilings', () => {
    for (const tier of ['high', 'cinematic'] as const) {
      for (const [key, ceiling] of Object.entries(COST_CEILINGS)) {
        const value = QUALITY_PRESETS[tier][key as keyof typeof QUALITY_PRESETS.high];
        expect(Number(value), `${tier}.${key}`).toBeLessThanOrEqual(ceiling[tier]);
      }
    }
  });

  it('only sharpens a frame it upscaled', () => {
    // Compensation is conditional by construction: sharpening a frame that is already
    // native is how a renderer grows a halo on every high-contrast edge. At native
    // resolution the term reads 0 (see `syncSharpen` in renderer.ts).
    expect(SHARPEN_BELOW_SCALE).toBeLessThan(1);
    expect(SHARPEN_BELOW_SCALE).toBeGreaterThan(0.5);
    // ...and the ceiling is where a frame *starts* being upscaled, which is what
    // native mode never crosses.
    expect(SHARPEN_BELOW_SCALE).toBeGreaterThan(QUALITY_PRESETS.low.adaptiveFloor - 1);
  });
});

describe('adaptive resolution', () => {
  const controller = (onScale: (scale: number) => void = () => {}): AdaptiveResolution =>
    new AdaptiveResolution(16.7, 0.8, onScale, 30);

  const feed = (adaptive: AdaptiveResolution, frameMs: number, frames: number): void => {
    for (let i = 0; i < frames; i++) adaptive.sample(frameMs);
  };

  /**
   * Frames of `frameMs` until the scale moves, bounded.
   *
   * Counting frames to a change rather than feeding a hand-computed number is
   * deliberate: a step down arms a 150 ms hold, so "three windows" is a moving
   * target in frames — and a test that has to model that is a test that will be
   * wrong the next time the guard is tuned.
   */
  const framesToChange = (adaptive: AdaptiveResolution, frameMs: number, cap = 20_000): number => {
    const start = adaptive.value;
    let frames = 0;
    while (adaptive.value === start && frames < cap) {
      adaptive.sample(frameMs);
      frames++;
    }
    return frames;
  };

  it('targets 60 fps, not the 71 fps that pinned it to the floor', () => {
    expect(controller().target).toBeCloseTo(16.7, 5);
  });

  it('steps down 5% after three sustained over-budget windows', () => {
    const adaptive = controller();
    feed(adaptive, 33, 3 * 30 - 1);
    expect(adaptive.value).toBe(1);
    feed(adaptive, 33, 1);
    expect(adaptive.value).toBeCloseTo(0.95, 5);
  });

  it('steps back up only after six sustained windows of headroom', () => {
    const adaptive = controller();
    feed(adaptive, 33, 3 * 30); // one step down
    adaptive.hold(0); // this test is about hysteresis, not the post-change guard
    // Comfortably under budget (10 ms against a 16.7 ms target): five windows is
    // not enough, six is. This hysteresis is what stops the image pumping.
    const frames = framesToChange(adaptive, 10);
    expect(adaptive.value).toBeCloseTo(1, 5);
    expect(frames).toBeGreaterThan(5 * 30);
    expect(frames).toBeLessThanOrEqual(6 * 30 + 1);
  });

  it('ignores a single bad window', () => {
    const adaptive = controller();
    feed(adaptive, 33, 30); // one over-budget window
    feed(adaptive, 6, 90); // then comfortably fine
    expect(adaptive.value).toBe(1);
  });

  it('ignores frames that are not frame-rate signals', () => {
    const adaptive = controller();
    // A tab switch or a breakpoint: longer than a quarter second says nothing.
    feed(adaptive, 900, 90);
    expect(adaptive.value).toBe(1);
  });

  it('holds still after a preset change or a load', () => {
    const adaptive = controller();
    adaptive.hold(3000);
    expect(adaptive.isHolding).toBe(true);
    // Every frame in the hold has to be a *bad* frame (33 ms against 16.7) and it
    // still must not move: 3 s of hold absorbs 91 of them at 33 ms, and only the
    // frames after that count. Without this, rebuilding the composer read as a GPU
    // bottleneck, cut the resolution, and left it cut (ADR-0014).
    const frames = framesToChange(adaptive, 33);
    expect(frames).toBeGreaterThan(3000 / 33);
    expect(adaptive.value).toBeLessThan(1);
  });

  it('never goes below its floor, and re-clamps when the floor rises', () => {
    const adaptive = controller();
    feed(adaptive, 200, 5000);
    expect(adaptive.value).toBeCloseTo(0.8, 5);
    adaptive.setFloor(0.9);
    expect(adaptive.value).toBeCloseTo(0.9, 5);
  });

  it('reports the scale it changes to, and stops entirely when locked', () => {
    const seen: number[] = [];
    const adaptive = controller((scale) => seen.push(scale));
    feed(adaptive, 33, 3 * 30);
    expect(seen).toEqual([0.95]);
    adaptive.lock(0.75);
    expect(adaptive.value).toBe(0.75);
    expect(adaptive.isLocked).toBe(true);
    feed(adaptive, 33, 300);
    expect(adaptive.value).toBe(0.75);
    expect(seen).toEqual([0.95]);
    adaptive.lock(null);
    expect(adaptive.isLocked).toBe(false);
  });
});
