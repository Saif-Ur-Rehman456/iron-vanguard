/**
 * Time of day: two atmospheres, one simulation.
 *
 * The review asked for the morning scene the prototype had *and* the dusk one, and for
 * the player to choose before deploying. The half of that which can be proved without
 * a GPU is that the two presets are genuinely two pictures — a different sky, a key
 * from a different direction, a different exposure, different artificial light — rather
 * than one picture with a recoloured fog. That is what this file checks; the pixels are
 * in docs/CAPTURE_REQUEST.md.
 *
 * Nothing here touches the renderer's DOM paths (`skyTextureFor` draws a canvas), so
 * this runs anywhere the rest of the suite does.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_OF_DAY,
  LOOK_RIG,
  TIME_OF_DAY_IDS,
  TIME_PRESETS,
  keyDirection,
  keyElevationDeg,
  timePreset,
  type TimeOfDay,
} from '@iron/render';

/** Perceptual warmth of a colour: > 0 warm, < 0 cool. */
function warmth(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (r - b) / Math.max(1, r + g + b);
}

describe('the two atmospheres', () => {
  it('offers a morning and a dusk, and opens on the tuned night rig', () => {
    expect(TIME_OF_DAY_IDS).toEqual(['dawn', 'dusk']);
    expect(TIME_OF_DAY_IDS).toHaveLength(2);
    // Dusk is the default because it is the rig every number in docs/ART_BIBLE.md
    // describes (ADR-0013); the morning is the player's choice.
    expect(DEFAULT_TIME_OF_DAY).toBe('dusk');
    for (const id of TIME_OF_DAY_IDS) {
      expect(timePreset(id).id).toBe(id);
    }
  });

  it('puts the sun and the moon in different parts of the sky', () => {
    const dawn = keyDirection(TIME_PRESETS.dawn);
    const dusk = keyDirection(TIME_PRESETS.dusk);
    // Not a nuance: the key's direction is the direction every shadow in the frame
    // falls in. A morning that reused the moon's azimuth would be the night scene with
    // a blue fog, which is exactly the cheap version of this feature.
    expect(dawn.dot(dusk)).toBeLessThan(0.3);
    for (const preset of Object.values(TIME_PRESETS)) {
      const elevation = keyElevationDeg(preset);
      // Above the horizon (or there is no key) and below the zenith (or every roof is
      // lit equally and the street goes flat).
      expect(elevation, preset.id).toBeGreaterThan(15);
      expect(elevation, preset.id).toBeLessThan(70);
    }
    // Both keys are white-ish light, but the separation is the point: a morning sun is
    // warm and the moon is cool, which is the inversion that makes the two read as
    // different times of day rather than as different filters.
    expect(warmth(TIME_PRESETS.dawn.key.color)).toBeGreaterThan(0);
    expect(warmth(TIME_PRESETS.dusk.key.color)).toBeLessThan(-0.05);
    expect(warmth(TIME_PRESETS.dawn.key.color) - warmth(TIME_PRESETS.dusk.key.color)).toBeGreaterThan(0.1);
  });

  it('keeps the key ahead of its own ambient at both hours', () => {
    for (const preset of Object.values(TIME_PRESETS)) {
      // The rule the lighting pass established (ADR-0013) applies at any hour: a key
      // that loses to its own ambient flattens every surface into one value. The
      // presets scale the tier's rig rather than replacing it, so the check is on the
      // products — which is also what catches a morning that is merely "brighter".
      const key = LOOK_RIG.keyIntensity * preset.key.scale;
      const ambient = LOOK_RIG.ambientIntensity * preset.ambient.scale;
      expect(key, preset.id).toBeGreaterThan(ambient * 2);
    }
  });

  it('lights the artificial sources only when the sun is down', () => {
    const { dawn, dusk } = TIME_PRESETS;
    expect(dusk.artificial).toEqual({ lamps: true, windows: true, fire: true, stars: true });
    expect(dawn.artificial.lamps).toBe(false);
    expect(dawn.artificial.windows).toBe(false);
    expect(dawn.artificial.stars).toBe(false);
    // A burning barrel is on fire at any hour.
    expect(dawn.artificial.fire).toBe(true);
    // A street lamp's *lens* is still an object in daylight, so its colour has to
    // change rather than only its light: the renderer drives `lampBulb` from here.
    expect(warmth(dawn.glow.bulb)).toBeLessThan(warmth(dusk.glow.bulb));
    expect(dawn.glow.lampLightScale).toBe(0);
    expect(dusk.glow.lampLightScale).toBe(1);
  });

  it('grades the two frames differently: exposure, haze and reflection', () => {
    const { dawn, dusk } = TIME_PRESETS;
    // A bright scene needs less exposure, and the reflection of a morning sky is much
    // stronger than the reflection of a night one — which is most of why metal looks
    // like metal in daylight.
    expect(dawn.exposureScale).toBeLessThan(dusk.exposureScale);
    expect(dawn.environmentScale).toBeGreaterThan(dusk.environmentScale);
    // The haze thins in the morning, and its colour is brighter than the night's.
    expect(dawn.fog.densityScale).toBeLessThan(dusk.fog.densityScale);
    const luma = (hex: number): number => ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff);
    expect(luma(dawn.fog.color)).toBeGreaterThan(luma(dusk.fog.color));
    // ...and the sky itself is two gradients, not one: the dawn zenith is bright blue
    // where the dusk one is nearly black.
    const zenith = (id: TimeOfDay): string => TIME_PRESETS[id].sky[0]![1];
    expect(zenith('dawn')).not.toBe(zenith('dusk'));
    expect(Number.parseInt(zenith('dawn').slice(1, 3), 16)).toBeGreaterThan(
      Number.parseInt(zenith('dusk').slice(1, 3), 16),
    );
    // Every gradient runs top to bottom, or the dome's UVs would fold it back on
    // itself.
    for (const preset of Object.values(TIME_PRESETS)) {
      let previous = -1;
      for (const [stop] of preset.sky) {
        expect(stop, preset.id).toBeGreaterThan(previous);
        previous = stop;
      }
    }
  });
});
