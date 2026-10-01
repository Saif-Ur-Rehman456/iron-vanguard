/**
 * The lighting rig's contract (ADR-0013).
 *
 * These are the checks that can be made without rendering a frame, and they exist
 * because the Phase 02 feedback was exactly this: *everything was one brown wash,
 * and the lamps were decorations*. Both failures are visible in the numbers below
 * before a single pixel is drawn —
 *
 *  - a key light that does not clearly beat its own ambient cannot reveal form,
 *  - local sources that are no warmer than the environment cannot read as local,
 *  - a bloom threshold under the midtone turns every emitter into a white blob.
 *
 * The visual half of the same contract is measured in `npm run shots` (probe
 * `lighting`), which A/Bs one group of the rig at a time at fixed world points.
 */
import { describe, expect, it } from 'vitest';
import { LIGHTING, LOOK, QUALITY_PRESETS, type QualityTier } from '@iron/render';

const TIERS: QualityTier[] = ['low', 'medium', 'high', 'cinematic'];

/** Perceptual warmth of a colour: > 0 warm, < 0 cool. */
function warmth(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (r - b) / Math.max(1, r + g + b);
}

describe('lighting rig contract', () => {
  it('keeps the environment cool and the artificial sources warm', () => {
    // The separation the whole night scene rests on: moon and sky on one side of
    // neutral, lamps, windows, muzzle and fire on the other.
    expect(warmth(LIGHTING.moonColor)).toBeLessThan(-0.05);
    expect(warmth(LIGHTING.skyColor)).toBeLessThan(-0.05);
    expect(warmth(LIGHTING.lampWarm)).toBeGreaterThan(0.15);
    expect(warmth(LIGHTING.windowWarm)).toBeGreaterThan(0.15);
    expect(warmth(LIGHTING.muzzle)).toBeGreaterThan(0.15);
    // ...and by a margin: a lamp barely warmer than the moon reads as grey.
    expect(warmth(LIGHTING.lampWarm) - warmth(LIGHTING.moonColor)).toBeGreaterThan(0.25);
  });

  it('keeps the moon key clear of the ambient on every tier', () => {
    for (const tier of TIERS) {
      const quality = QUALITY_PRESETS[tier];
      // A hemisphere light delivers half its intensity to a vertical face, so the
      // effective fill is `ambient / 2`. If the key is not several times that, a lit
      // facade and a shadowed one converge and the geometry goes flat.
      expect(quality.keyIntensity).toBeGreaterThan(quality.ambientIntensity * 2);
      // The key is the only light that casts shadows, and it has to be there to do
      // it: a tier without a key would have no form at all.
      expect(quality.keyIntensity).toBeGreaterThan(1);
    }
  });

  it('casts a full shadow and leaves the fill to keep it readable', () => {
    for (const tier of TIERS) {
      const quality = QUALITY_PRESETS[tier];
      // This used to assert `shadowIntensity < 1`, on the reasoning that 1 would be a
      // fully black shadow and "dark objects lose their surface information". The
      // reasoning was wrong and the number was a leak: `shadow.intensity` scales the
      // *key's* occlusion only, so 0.84 left 16% of the moon inside every shadow in the
      // plaza — a flat wash over exactly the areas the key is there to shape. The
      // capture probe measured it before it was changed (`lighting-key_shadowGround`
      // 1.242, i.e. the "shadowed" pad was still being lit by the key).
      expect(quality.shadowIntensity).toBe(1);
      // What keeps a shadow from going black is the fill, and these two are it.
      expect(quality.ambientIntensity).toBeGreaterThan(0.3);
      expect(quality.environmentIntensity).toBeGreaterThan(0.4);
    }
  });

  it('blooms only real emitters, on every tier', () => {
    for (const tier of TIERS) {
      const quality = QUALITY_PRESETS[tier];
      // The threshold is the highlight guard: under ~0.85 the diffuse scene itself
      // starts to bloom, which is how a lamp becomes a glowing blob. The sixth report
      // (AGENTS.md entry 30) is why it is 1.0: the *weapon* sits 40 cm from its own
      // light, so anything below the emitters' band (an emissive prop is 1.4-1.5) puts
      // the receiver's rail and the optic's tube into the glow as well.
      expect(quality.bloomThreshold).toBeGreaterThanOrEqual(0.95);
      expect(quality.bloomStrength).toBeGreaterThan(0);
      expect(quality.bloomStrength).toBeLessThan(0.5);
      // Radius is how far the glow spreads. At 0.5 a clipped highlight reached across
      // the frame; a lamp's pool is a pool, not a wash over the scene behind it.
      expect(quality.bloomRadius).toBeGreaterThan(0);
      expect(quality.bloomRadius).toBeLessThanOrEqual(0.45);
    }
  });

  it('keeps local lights local', () => {
    for (const tier of TIERS) {
      const quality = QUALITY_PRESETS[tier];
      // A muzzle flash that lights the far side of the street is a bug, not drama —
      // and neither is one that costs the player their visibility. 60 cd is 60 lux on
      // the ground a metre ahead, four stops above a moonlit street; 26 is the same
      // flash one stop down, which reads as a flash rather than as a white-out.
      expect(quality.muzzleLightIntensity).toBeGreaterThan(0);
      expect(quality.muzzleLightIntensity).toBeLessThanOrEqual(40);
      expect(quality.muzzleLightRange).toBeGreaterThan(4);
      expect(quality.muzzleLightRange).toBeLessThanOrEqual(16);
      // Real local lights are budgeted; the emissive fallback covers the rest.
      expect(quality.lampLightBudget).toBeGreaterThanOrEqual(0);
      expect(quality.windowLightBudget).toBeGreaterThanOrEqual(0);
    }
  });

  it('spends more lighting on the higher tiers, never less', () => {
    const order: QualityTier[] = ['low', 'medium', 'high', 'cinematic'];
    for (let i = 1; i < order.length; i++) {
      const lower = QUALITY_PRESETS[order[i - 1]!];
      const higher = QUALITY_PRESETS[order[i]!];
      expect(higher.ambientIntensity).toBeGreaterThanOrEqual(lower.ambientIntensity);
      expect(higher.environmentIntensity).toBeGreaterThanOrEqual(lower.environmentIntensity);
      expect(higher.windowLightBudget).toBeGreaterThanOrEqual(lower.windowLightBudget);
    }
  });

  it('keeps the look pass set up for a night frame', () => {
    // Exposure is a real setting, not a style: without it the night frame is either
    // black or daylight.
    expect(LOOK.exposure).toBeGreaterThan(1);
    expect(LOOK.exposure).toBeLessThan(1.6);
    // The haze is the aerial perspective, and it has to be cooler than it is warm or
    // distance desaturates toward beige instead of toward the night sky.
    expect(warmth(LOOK.fogColor)).toBeLessThan(0);
    expect(LOOK.fogDensityScale).toBeGreaterThan(0.4);
  });
});
