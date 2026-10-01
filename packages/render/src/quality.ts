/**
 * Quality tiers and adaptive resolution.
 *
 * The min-spec target is 60 fps at 1080p on integrated graphics
 * (docs/PERF_BUDGET.md), so every tier is expressed as a budget the renderer can
 * actually honour, and the adaptive controller trades resolution before frame rate.
 *
 * ---------------------------------------------------------------------------
 * ADR-0014: a tier changes cost, never the look.
 *
 * The defect this file was rebuilt around is the one the review reported as "turning
 * GRAPHICS down makes the game look worse, not cheaper". It did, and for a
 * structural reason: a tier used to be a *style*. `low` switched the shadow map off,
 * zeroed the AO term, dropped ambient and environment light by a third, turned the
 * dust off and swapped SMAA for FXAA. Those are not smaller versions of the picture;
 * they are a different picture — flat, ungrounded, low-contrast and blurrier — and
 * the player who turned the setting down to make the game run better was shown a
 * worse game and told it was the same one.
 *
 * So the look now lives in exactly one place, `LOOK_RIG`, and every tier spreads it
 * verbatim. The fields that are left to a tier are all *samples, sizes and counts*:
 * shadow map resolution and reach, AO sample count, MSAA samples, real-light
 * budgets, particle/decals capacity, pixel-ratio cap. A tier can make the frame
 * cheaper; it cannot make it darker, flatter or hazier. If a machine cannot afford
 * the look, the adaptive controller reduces resolution — which is an honest,
 * visible, single-axis trade — rather than the picture quietly becoming something
 * else.
 *
 * ---------------------------------------------------------------------------
 * ADR-0016: a frame that costs more than 16 ms makes the resolution trade a lie.
 *
 * The second review of this setting was the opposite complaint in the same words:
 * *the game is laggy and blurry at every graphics level.* Both halves had the same
 * cause. The adaptive controller's only lever is resolution, so a frame that costs
 * 22 ms gets 0.9 of the pixels and still costs 18 ms — the player was handed a
 * softer picture and no frame rate, which is the worst available trade and exactly
 * what "laggy AND blurry" means. A resolution trade is only honest when the frame
 * it is trading against is already near budget; otherwise it is a tax that buys
 * nothing.
 *
 * So the cost fields below came down where the millisecond was being spent for the
 * least picture, and the floors went *up* (0.9, not 0.8), because a machine still
 * over budget at 0.9 needs a cheaper frame, not a smaller one. Where the time was
 * actually going, and what changed:
 *
 *  - **MSAA belongs to geometry, and only the scene pass has any.** The composer's
 *    write buffer is a half-float target that every fullscreen pass — bloom's
 *    composite, the grade, and each of SMAA's three — renders into and out of.
 *    `renderer.ts` used to leave it multisampled, so each of those passes paid a 4x
 *    resolve for edges it does not contain. That is the single largest change here.
 *  - **A tier's MSAA budget is 2, not 4.** SMAA runs after the grade at every tier
 *    regardless, so the third and fourth samples were edge quality nobody could
 *    see, at double the bandwidth of the second.
 *  - **Bloom resolves at half the drawing buffer** (`BLOOM_SCALE`): it is a blur, so
 *    it carries no detail finer than the buffer it reads.
 *  - **AO sample counts came down; the radii did not.** The two radii *are* the term
 *    (contact grounds a barrel, ambient deepens a corner); the sample count is
 *    noise, which the bilateral blur removes anyway.
 *  - **The sun's shadow atlas** is the largest single allocation in the frame. 2048²
 *    over 95 m is 4.6 cm per texel, which the PCF radius then blurs back to a
 *    gradient; 1024² over 70 m is finer per texel *and* a quarter of the fill.
 *  - **Lamp lights are per-fragment, not per-lamp.** Eight real lamps means eight
 *    lights evaluated for every fragment of every material in the frame; three is
 *    the budget now (`cinematic` gets four), and the emissive lamp and window props
 *    cover the rest for free.
 *
 * Addendum, after the *second* report of the same two symptoms:
 *
 *  - **Resolution is no longer traded by default.** The controller is locked at 1.0
 *    unless the player asks for dynamic resolution (the RESOLUTION setting,
 *    `resolutionMode`). A trade that is chosen is a trade; a trade that happens *to*
 *    you is a blur, and it is the one thing every one of the review's frames had in
 *    common. The lag is answered with the effect budget below instead.
 *  - **AO resolves at 0.4 of the buffer on the two cheap tiers**, and the shadow reach
 *    came in to 40/55 m: a shadow beyond 40 m is a soft grey value behind haze, and the
 *    cascade atlas spends its texels on the ground the player is standing on.
 * ---------------------------------------------------------------------------
 * ADR-0017: the pixel count is not a tier's lever. The effects are.
 *
 * The third report of the same thing — *still blurry, still laggy, at every graphics
 * level* — is what happens when both levers are pulled at once and both are wrong:
 * the tiers went on scaling the picture (pixel ratio caps of 1.0 / 1.25 / 1.75 / 2.0),
 * so the two settings a player reaches for when the game is slow produced a *softer*
 * game with no frames back, and there was no setting anywhere that meant "draw fewer
 * effects, but draw them sharply".
 *
 * So the trade is split, and each half is honest on its own:
 *
 *  - **Every tier draws at the display's native pixel count** (`pixelRatioCap: 2`,
 *    which is `min(devicePixelRatio, 2)` — i.e. never a downscale, at any tier, on any
 *    display). The picture is as sharp as the machine's panel can show, always. This is
 *    also why the per-tier `pixelRatioCap` ladder is *gone* rather than retuned: a
 *    ladder of pixel counts is a ladder of blurs, and no wording in a settings menu can
 *    make "medium" not look like a smeared "high".
 *  - **A tier buys cost** — AO on/off, shadow map size and reach, how many real lights
 *    exist, MSAA, which AA, particle and decal caps. `low` is the honest cheap tier: no
 *    ambient occlusion, no shadow atlas, one real lamp light, FXAA instead of SMAA,
 *    native pixels. It is *sharper* than `high` used to be and it is the fastest frame
 *    the renderer can produce.
 *
 * The one thing a tier may not do is cut the pixel count, and the one thing the player
 * may do is ask for it (`dynamic` resolution, which pays for itself with a sharpen pass
 * in `post/look.ts`).
 *
 * `postChain()` below states each tier's pass list as data, and
 * `tests/unit/quality.test.ts` asserts the *count of full-resolution passes* per tier.
 * That is the GPU-free half of "the frame is cheap": the passes are known, and the
 * number of times a full-size buffer is read and written is arithmetic.
 * ---------------------------------------------------------------------------
 *
 * The visual half of this contract is measured in `npm run shots`; the arithmetical
 * half is in `tests/unit/quality.test.ts`, which fails if two tiers ever disagree
 * about any look field. The in-game copy that explains a tier to the player lives in
 * `packages/ui` with the rest of the interface text — it says what each budget is,
 * and that the look is not one of them.
 * ---------------------------------------------------------------------------
 *
 * Foundation-era notes (ADR-0012):
 *  - `msaaSamples` is the AA that the canvas cannot provide any more: every frame
 *    goes through EffectComposer, so MSAA belongs on its scene target. The old
 *    `antialias: true` canvas flag only ever mattered when there was no composer,
 *    which stopped being true the moment bloom was on at every tier.
 *  - `shadowRadius`/`shadowFar` replace the old `shadowsSoft` flag. three r186
 *    *removed* `PCFSoftShadowMap` (WebGLShadowMap coerces it to PCFShadowMap and
 *    logs a warning), so "soft" used to be a no-op with a console warning; the
 *    penumbra is the shadow radius now.
 *  - `aoSamples`/`aoContactRadius`/`aoAmbientRadius` drive the AO pass in
 *    post/ao.ts. Two radii on purpose: the contact term is what grounds a tyre, a
 *    foot or a barrier, and the ambient term is what deepens a corner. A single
 *    radius cannot do both (small alone leaves corners flat, large alone reads as
 *    a stain on the ground).
 *
 * Lighting-era notes (ADR-0013): the rig is a cool moon key, a broad cool
 * sky/ground ambient and image-based reflected light, and the *ratio* between them
 * is what keeps shape readable: a key that loses to its own ambient flattens every
 * surface into the same value. That ratio is why they are look fields (ADR-0014)
 * rather than knobs a tier may turn.
 *  - `lampLightBudget`/`windowLightBudget` cap how many *real* local lights exist.
 *    Lamps and windows stay emissive at every tier, so the far ones are free; the
 *    budget only decides how many of the nearest get a light that shades the
 *    geometry around them.
 *  - `bloomThreshold` is the highlight guard: emitters are bright, but bloom starts
 *    only above this, so a lamp pools light instead of turning into a white disc.
 */

export type QualityTier = 'low' | 'medium' | 'high' | 'cinematic';

/**
 * The bloom chain's resolution, as a fraction of the drawing buffer.
 *
 * Half, at every tier, on purpose: bloom is a wide blur, so it carries no detail
 * finer than the buffer it reads — resolving it at full size spends 4x the fill rate
 * to compute the same haze. This is a *fidelity* constant, not a tier knob: a
 * quality setting that changed it would be changing what bloom looks like.
 */
export const BLOOM_SCALE = 0.5;

/**
 * The resolution at or above which the sharpen pass is off.
 *
 * Compensation has to be conditional. At native resolution the frame is already as
 * sharp as the renderer can make it, and sharpening a sharp frame is how a renderer
 * acquires halos on every high-contrast edge; below it, the frame has been
 * *upscaled* by the browser, and putting the micro-contrast back is the difference
 * between "a cheaper frame" and "a blurry game" (ADR-0016).
 */
export const SHARPEN_BELOW_SCALE = 0.99;

/**
 * How much micro-contrast the upscale compensation adds back.
 *
 * 0.35 of a cross-shaped unsharp mask: enough to restore the edge structure a bilinear
 * upscale removes, well under the amount that grows a bright halo on every lamp and
 * railing. Tuned against `npm run shots` luminance at the reference scale, and it is
 * only ever applied below `SHARPEN_BELOW_SCALE`.
 */
export const SHARPEN_STRENGTH = 0.35;

/**
 * Whether the renderer may trade resolution for frame rate.
 *
 * `native` (the default) locks the adaptive controller at 1.0: the frame is always
 * rendered at full resolution and the lag is answered by the effect budget. `dynamic`
 * releases the controller, which is the right choice for a machine that cannot hold 60
 * fps at native and would rather have a softer picture than a stutter — but it is the
 * *player's* choice now, because a resolution cut applied silently is indistinguishable
 * from a blurry game (which is exactly the report that produced this setting).
 */
export type ResolutionMode = 'native' | 'dynamic';

export const DEFAULT_RESOLUTION_MODE: ResolutionMode = 'native';

export interface QualitySettings {
  tier: QualityTier;
  pixelRatioCap: number;
  /** MSAA samples on the composer's scene target (0 = off). */
  msaaSamples: 0 | 2 | 4;
  /** Screen-space AA applied after the grade. */
  postAa: 'fxaa' | 'smaa';
  shadows: boolean;
  /** Per-cascade shadow map size; the sun atlas is 2x this wide. */
  shadowMapSize: number;
  /** How far (m) the cascaded sun shadows reach — this sets the cascade splits. */
  shadowFar: number;
  /** PCF penumbra, in shadow-map texels. */
  shadowRadius: number;
  /** 1 = fully black occlusion; below 1 keeps a little bounce in shadow. */
  shadowIntensity: number;
  /** Moon key light intensity (lux). The *only* light that casts shadows. */
  keyIntensity: number;
  /** Broad sky/ground ambient intensity (sky above, warm sand bounce below). */
  ambientIntensity: number;
  /** Sky image-based reflection, as a multiplier on `scene.environmentIntensity`. */
  environmentIntensity: number;
  /** How many lamp props get a real point light (the rest are emissive only). */
  lampLightBudget: number;
  /** How many window lights follow the player (0 = emissive windows only). */
  windowLightBudget: number;
  /** Peak intensity (cd) of the muzzle flash light, and its reach (m). */
  muzzleLightIntensity: number;
  muzzleLightRange: number;
  /** AO samples *per radius*, per pixel (0 = no ambient occlusion pass). */
  aoSamples: number;
  /** Tight contact radius in metres — the term that grounds objects. */
  aoContactRadius: number;
  /** Wider corner/joint radius in metres. */
  aoAmbientRadius: number;
  /** How much occlusion reaches the frame (1 = full). */
  aoIntensity: number;
  /** Curve on the AO term; >1 tightens it toward the contact edge. */
  aoPower: number;
  /** AO buffer resolution relative to the drawing buffer. */
  aoScale: number;
  /** Bilateral denoise of the AO buffer. */
  aoBlur: boolean;
  bloom: boolean;
  bloomStrength: number;
  /** Luminance above which bloom starts — the knob that keeps emitters off a blob. */
  bloomThreshold: number;
  /** How far the bloom kernel spreads. */
  bloomRadius: number;
  /** Filmic grade pass (contrast, highlight roll-off, split-tone). */
  grade: boolean;
  maxParticles: number;
  maxDecals: number;
  dust: boolean;
  fogVolume: boolean;
  /** Lowest resolution scale the adaptive controller may pick on this tier. */
  adaptiveFloor: number;
}

/**
 * The look. Identical on every tier, by construction (ADR-0014).
 *
 * The values are the ones the lighting and look passes were tuned to (ADR-0013):
 * `keyIntensity` is the moon, and it beats its own ambient by roughly 5:1 so that a
 * lit facade and a shadowed one stay legible; `shadowIntensity` stays under 1 so a
 * shadow keeps its surface information; `bloomThreshold` sits above the midtone so
 * only real emitters bloom; the AO terms keep a contact radius (what grounds a
 * barrel, a tyre or a foot) and a wider radius (what deepens a corner).
 *
 * The bloom pair and the muzzle light are the sixth pass's numbers. A bloom *radius*
 * of 0.5 on a strength of 0.55 is a wide, strong kernel: any surface that clipped to
 * white — the view model's rail under its own light, most of all — became a glow that
 * spread over the frame and cost the player the scene behind it. 0.36 and 0.42 are the
 * same effect on a tighter kernel, and `muzzleLightIntensity` came down one stop (60 →
 * 26) so a burst is still the brightest thing in the frame for 40 ms without taking
 * the frame with it. None of this is a tier: bloom is the look.
 *
 * If you are tempted to add a field here per tier: the answer is resolution. See
 * `AdaptiveResolution` below.
 */
export const LOOK_RIG = {
  // Full strength. `shadow.intensity` scales the *key's* occlusion and nothing else, so
  // 0.84 meant every shadowed surface in the plaza still received 16% of the moon — a
  // flat wash laid over exactly the areas the key is supposed to have shaped. The shadow
  // side of a building does not go black when this reads 1: the fill (hemisphere + sky
  // IBL, 0.55 + 0.74) is a separate term and is what keeps it readable, which the
  // capture probe measures as `lighting-ambient_shadowGround` on the same patch.
  shadowIntensity: 1,
  keyIntensity: 2.6,
  ambientIntensity: 0.55,
  environmentIntensity: 0.74,
  muzzleLightIntensity: 26,
  muzzleLightRange: 11,
  aoContactRadius: 0.7,
  aoAmbientRadius: 1.25,
  aoIntensity: 0.85,
  aoPower: 1.6,
  bloom: true,
  bloomStrength: 0.42,
  bloomThreshold: 1.0,
  bloomRadius: 0.36,
  grade: true,
  dust: true,
} as const;

/** A tier's own fields: everything that is a sample count, a size or a cap. */
export type CostSettings = Omit<QualitySettings, keyof typeof LOOK_RIG | 'tier'>;

/** Build a preset from the shared look plus this tier's budget. */
const preset = (tier: QualityTier, cost: CostSettings): QualitySettings => ({
  ...LOOK_RIG,
  tier,
  ...cost,
});

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  /**
   * The min-spec tier — and, since ADR-0017, the honest one: native pixels with no
   * ambient occlusion, no shadow atlas, one real lamp light, FXAA instead of SMAA and
   * a third of the particles. Native pixels is what makes it a *setting* rather than a
   * demotion: it is the sharpest picture the renderer can produce, and it is the
   * cheapest frame.
   *
   * What it gives up is grounding, not detail: without AO a barrel sits slightly less
   * firmly on the pavement, and without the shadow atlas the moon stops casting a long
   * blue shadow across the plaza. Both are visible trades, both are stated in the
   * settings copy, and neither makes the image soft.
   */
  low: preset('low', {
    // Native. Not 1.0: on a 125%-scaled 1080p panel `devicePixelRatio` is 1.25, and a
    // cap of 1.0 renders 80% of the panel's pixels and lets the browser stretch them —
    // which is a blur applied by the compositor, invisible to every number in this file.
    pixelRatioCap: 2,
    msaaSamples: 0,
    postAa: 'fxaa',
    // No shadow atlas at all: it is the largest single allocation in the frame and it
    // re-draws every caster. Re-enable at `medium` for the grounded look.
    shadows: false,
    shadowMapSize: 512,
    shadowFar: 30,
    shadowRadius: 2,
    lampLightBudget: 1,
    windowLightBudget: 0,
    // No AO pass: it is a multi-tap full-screen read plus a bilateral blur, and it is
    // the least visible per-millisecond term in the frame.
    aoSamples: 0,
    aoScale: 0.4,
    aoBlur: false,
    maxParticles: 180,
    maxDecals: 4,
    fogVolume: false,
    // The floor only applies in `dynamic` mode (native locks at 1.0). 0.7 is where a
    // 1080p frame becomes a 756p frame: still recognisable, and the sharpen pass in
    // post/look.ts puts the micro-contrast back.
    adaptiveFloor: 0.7,
  }),
  medium: preset('medium', {
    pixelRatioCap: 2,
    msaaSamples: 0,
    postAa: 'fxaa',
    shadows: true,
    shadowMapSize: 1024,
    shadowFar: 55,
    shadowRadius: 2.5,
    lampLightBudget: 2,
    windowLightBudget: 1,
    aoSamples: 0,
    aoScale: 0.4,
    aoBlur: false,
    maxParticles: 320,
    maxDecals: 8,
    fogVolume: false,
    adaptiveFloor: 0.7,
  }),
  high: preset('high', {
    pixelRatioCap: 2, // native, like every other tier (ADR-0017)
    // Two samples, not four: SMAA is behind it on every tier, and the third and
    // fourth samples are half the MSAA bandwidth for an edge nobody can see.
    msaaSamples: 2,
    postAa: 'smaa',
    shadows: true,
    // 1024 over 70 m, i.e. 3.4 cm per texel on the near cascade. A 2048² atlas was
    // 4x the depth fill for a penumbra that the shadow radius then blurred anyway.
    shadowMapSize: 1024,
    shadowFar: 70,
    shadowRadius: 3,
    lampLightBudget: 3,
    windowLightBudget: 3,
    // Half resolution on purpose, and on every tier: AO is a low-frequency term
    // apart from the contact edge itself, the bilateral blur is what removes the
    // sample-pattern noise, and the alternative (full-res, 16+ taps) is a pass
    // that can take the whole frame budget on integrated graphics — measured, not
    // assumed: the min-spec harness lost the WebGL context outright at scale 1.
    aoSamples: 6,
    aoScale: 0.5,
    aoBlur: true,
    maxParticles: 420,
    maxDecals: 12, // parity
    fogVolume: false,
    // The floor only applies in `dynamic` mode: at `high` the frame is native and the
    // sharpen compensation is therefore off. `dynamic` resolution is a setting, not a
    // behaviour.
    adaptiveFloor: 0.75,
  }),
  cinematic: preset('cinematic', {
    pixelRatioCap: 2,
    msaaSamples: 4,
    postAa: 'smaa',
    shadows: true,
    shadowMapSize: 2048,
    shadowFar: 90,
    shadowRadius: 3.5,
    lampLightBudget: 4,
    windowLightBudget: 4,
    aoSamples: 8,
    aoScale: 0.5,
    aoBlur: true,
    maxParticles: 640,
    maxDecals: 20,
    fogVolume: true,
    adaptiveFloor: 0.85,
  }),
};

/**
 * One stage of the post chain, as data rather than as code.
 *
 * The chain used to be an if-tree inside the renderer, which meant the only way to
 * know what a tier actually cost was to read the renderer and count. It is the same
 * information now, in a form a test can assert on: how many whole-buffer passes a
 * tier runs is arithmetic, and it is the part of the frame budget that is provable
 * without a GPU.
 */
export type PostStageName = 'scene' | 'ao' | 'bloom' | 'output' | 'look' | 'aa';

export interface PostStage {
  name: PostStageName;
  /** Fraction of the drawing buffer this stage resolves at (1 = full size). */
  scale: number;
  /** For `aa`: which screen-space AA. */
  aa?: 'fxaa' | 'smaa';
}

/**
 * The post chain for a tier, in the only order that makes sense:
 *
 *   scene (MSAA, HDR, depth) → AO → bloom (HDR) → output (tone map) → look (grade +
 *   upscale compensation) → screen-space AA
 */
export function postChain(quality: QualitySettings): PostStage[] {
  const stages: PostStage[] = [{ name: 'scene', scale: 1 }];
  if (quality.aoSamples > 0) stages.push({ name: 'ao', scale: quality.aoScale });
  // Bloom always resolves at BLOOM_SCALE: it is a wide blur, so it cannot carry detail
  // finer than the buffer it reads.
  if (quality.bloom) stages.push({ name: 'bloom', scale: BLOOM_SCALE });
  stages.push({ name: 'output', scale: 1 });
  if (quality.grade) stages.push({ name: 'look', scale: 1 });
  stages.push({ name: 'aa', scale: 1, aa: quality.postAa });
  return stages;
}

/**
 * How many times a tier reads and writes a whole drawing buffer.
 *
 * SMAA is three passes and FXAA is one, which is most of the difference between the
 * tiers that exist for frame rate and the tiers that exist for image quality.
 */
export function fullResPasses(quality: QualitySettings): number {
  let count = 0;
  for (const stage of postChain(quality)) {
    const passes = stage.name === 'aa' && stage.aa === 'smaa' ? 3 : 1;
    if (stage.scale >= 1) count += passes;
  }
  return count;
}

/**
 * Dynamic resolution: keeps frame time near the target by scaling pixel ratio,
 * clamped so the image never becomes unusable. This is how a mid-tier laptop
 * holds 60 fps through a heavy explosion.
 *
 * Notes on the three details that used to be wrong:
 *  - The controller must be fed the *real* frame delta (the requestAnimationFrame
 *    gap), not `performance.now()` around `composer.render()`. The latter measures
 *    how long the CPU took to submit the frame, which stays flat on a GPU-bound
 *    frame — so the controller scaled for the wrong reason and, in the worst case,
 *    never reacted to an actual GPU bottleneck. (ADR-0012)
 *  - A single bad window (a tab switch, a GC pause, a breakpoint) must not move the
 *    resolution, and stepping back up needs *sustained* headroom, or the whole
 *    image visibly pumps. Hysteresis: three windows down, six windows up. (ADR-0012)
 *  - `hold` exists because a tier change or a mission load makes one window of
 *    frames meaningless: without it, selecting a preset produced half a second of
 *    unplayable frames and then a permanent resolution cut, which is how the report
 *    "the graphics setting made it uglier" happened even with a correct preset.
 *    (ADR-0014)
 *
 * The target is 16.7 ms (60 fps) rather than the 14 ms it used to be. 14 ms is 71
 * fps: the controller chased a frame rate the display could not show, sat on its own
 * floor on ordinary hardware, and rendered the whole game at 70% of native
 * resolution to buy frames nobody saw.
 */
export class AdaptiveResolution {
  private scale = 1;
  /** A pinned scale, or null when the controller is free to move. */
  private locked: number | null = null;
  private samples = 0;
  private accumulated = 0;
  private overBudget = 0;
  private underBudget = 0;
  /** Milliseconds of frame time left to ignore after a load or a preset change. */
  private holdMs = 0;
  private readonly step = 0.05;

  constructor(
    private readonly targetMs = 16.7,
    private min = 0.8,
    private readonly onScale: (scale: number) => void = () => {},
    /** Frames per decision window; 30 frames ≈ 0.5 s at 60 fps. */
    private readonly window = 30,
  ) {}

  get value(): number {
    return this.locked ?? this.scale;
  }

  /** The frame time this controller aims for, in milliseconds. */
  get target(): number {
    return this.targetMs;
  }

  /**
   * Pin the scale (or release it with null).
   *
   * This exists because the controller makes effect A/B captures dishonest:
   * turning an effect *off* makes the frame cheaper, the controller raises the
   * resolution, and the two frames being compared differ in sharpness as well as
   * in the effect — which showed up as a 37% "darkening" at a high-contrast edge
   * that the effect itself could not produce. Measurement tools lock it.
   */
  lock(scale: number | null): void {
    this.locked = scale === null ? null : Math.max(0.25, Math.min(1, scale));
  }

  get floor(): number {
    return this.min;
  }

  /** True while the scale is pinned (see `lock`). */
  get isLocked(): boolean {
    return this.locked !== null;
  }

  /** True while the controller is ignoring frames after a load or preset change. */
  get isHolding(): boolean {
    return this.holdMs > 0;
  }

  /**
   * Ignore the next `ms` of frame time.
   *
   * Used for the frames that follow a preset change, a resize, a shader compile or
   * a mission load: they say nothing about whether the machine can hold the target.
   * Counted in frame time rather than wall-clock time so that a paused tab does not
   * hold the controller for the length of the pause.
   */
  hold(ms: number): void {
    this.holdMs = Math.max(0, Math.min(10_000, ms));
    this.samples = 0;
    this.accumulated = 0;
  }

  /** Tier changes move the floor; the current scale is re-clamped into range. */
  setFloor(min: number): void {
    this.min = Math.max(0.25, Math.min(1, min));
    if (this.locked !== null) {
      this.locked = Math.max(this.min, this.locked);
      return;
    }
    if (this.scale < this.min) this.stepBy(this.min - this.scale);
  }

  sample(frameMs: number): void {
    if (this.locked !== null) return;
    // A frame that took longer than a quarter second is not a frame-rate signal
    // (tab switch, debugger, shader compile) — dropping it keeps the controller
    // from reacting to everything except the game.
    if (frameMs > 250) return;
    if (this.holdMs > 0) {
      this.holdMs -= frameMs;
      this.samples = 0;
      this.accumulated = 0;
      return;
    }
    this.accumulated += frameMs;
    this.samples++;
    if (this.samples < this.window) return;
    const average = this.accumulated / this.samples;
    this.samples = 0;
    this.accumulated = 0;

    if (average > this.targetMs * 1.15) {
      this.overBudget++;
      this.underBudget = 0;
    } else if (average < this.targetMs * 0.8) {
      this.underBudget++;
      this.overBudget = 0;
    } else {
      this.overBudget = 0;
      this.underBudget = 0;
      return;
    }

    if (this.overBudget >= 3) {
      this.overBudget = 0;
      this.stepBy(-this.step);
    } else if (this.underBudget >= 6) {
      this.underBudget = 0;
      this.stepBy(this.step);
    }
  }

  private stepBy(delta: number): void {
    const next = Math.max(this.min, Math.min(1, this.scale + delta));
    if (Math.abs(next - this.scale) < 1e-3) return;
    this.scale = next;
    // A resolution change recompiles nothing but does invalidate the frames in
    // flight, so give the next window a moment before judging again.
    this.hold(150);
    this.onScale(this.scale);
  }

  reset(): void {
    this.locked = null;
    this.scale = 1;
    this.samples = 0;
    this.accumulated = 0;
    this.overBudget = 0;
    this.underBudget = 0;
    this.holdMs = 0;
  }
}
