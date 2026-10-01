/**
 * Time of day: the atmosphere presets, as data.
 *
 * The build shipped one sky. `lighting.ts` baked a night gradient into a
 * module-level cache, the key light was a moon, the fog was a fixed cool grey and
 * the street lamps were on, all of it decided at authoring time — so "the morning
 * scene" the prototype had was simply gone, and there was nowhere for the player to
 * choose it (the review asked for both, selectable before deploying).
 *
 * A time of day is not a quality tier and it is not a look pass: it is the *rig's
 * inputs* — where the key is, how strong it is, what colour the sky is, how thick
 * the haze is, and which artificial sources are on. Putting those in a table here
 * means the renderer has one `applyTimeOfDay` to call, the UI has a list to offer,
 * and a test can prove the two presets really are two pictures rather than one
 * picture with a different fog colour.
 *
 * The dusk preset is the lighting pass's tuned night rig (ADR-0013), which is why
 * its numbers look like the constants in `lighting.ts`: it *is* those constants,
 * made explicit so the morning can be its counterweight.
 */
import * as THREE from 'three';
import type { Weathering } from '../materials/surfaces';

export type TimeOfDay = 'dawn' | 'dusk';

/**
 * The atmosphere a fresh install starts in.
 *
 * Dusk, because it is the rig the whole lighting pass was tuned and measured
 * against (ADR-0013) and therefore the one every number in docs/ART_BIBLE.md
 * describes. The morning is the player's choice, not the new default.
 */
export const DEFAULT_TIME_OF_DAY: TimeOfDay = 'dusk';

/** The order the menu offers them in. */
export const TIME_OF_DAY_IDS: readonly TimeOfDay[] = ['dawn', 'dusk'];

export interface TimeOfDayPreset {
  id: TimeOfDay;
  /** Sky dome gradient, from zenith (0) to horizon (1). */
  sky: readonly (readonly [number, string])[];
  key: {
    /** Where the light shines *from*: this sets the shadow direction. */
    position: readonly [number, number, number];
    color: number;
    /**
     * Multiplier on the tier's `keyIntensity`. The *ratio* to the ambient is what
     * reveals form, so both scale together and this is what sets the contrast
     * between them: a morning sun beats its sky much harder than a moon does.
     */
    scale: number;
    /** The disc in the sky: sun or moon. */
    body: { color: number; scale: number; opacity: number; glow: number };
  };
  ambient: { sky: number; ground: number; scale: number };
  fog: { color: number; densityScale: number };
  /** Multiplier on the tone-mapping exposure — a bright scene needs less of it. */
  exposureScale: number;
  environmentScale: number;
  /**
   * How the hour has left the surfaces (materials/surfaces.ts).
   *
   * Not a look pass: a wet surface *is* a different surface, so the same material library
   * answers each atmosphere differently. It is declared here, with the sky and the key,
   * because it is part of what a time of day is — 0620 is a dry, dusty morning and 0437 is
   * the damp end of a night, and those two facts are the difference between paving that
   * scatters light and paving that holds a street lamp's reflection.
   *
   * The dust is deliberately on the *bright* preset: a fine layer of settled sand takes the
   * edge off specular clipping in hard morning sun, which is both what a dusty street looks
   * like and a gameplay win, because the player is looking into a sun that is now diffused
   * by the ground rather than off it.
   */
  weather: Weathering;
  /** Which artificial sources are lit. */
  artificial: { lamps: boolean; windows: boolean; fire: boolean; stars: boolean };
  /** The emissive prop colours, per time of day (a lamp lens in daylight is grey). */
  glow: {
    bulb: number;
    window: number;
    sign: number;
    /** Multiplier on the real lamp lights' intensity (0 = lamps are off). */
    lampLightScale: number;
    /**
     * Multiplier on a street lamp's additive halo sprite.
     *
     * Separate from `lampLightScale` because a halo is unlit: switching the lamp's
     * *light* off leaves the sprite glowing over a daylight street, which is the sort
     * of thing that only shows up in a screenshot.
     */
    lampGlow: number;
  };
}

export const TIME_PRESETS: Record<TimeOfDay, TimeOfDayPreset> = {
  /**
   * 0620 — a low, hard sun through thin morning haze.
   *
   * Warm-key/cool-shadow is *inverted* from dusk (the sun is warm, the sky is blue),
   * and that inversion is most of why the scene reads as a different place rather
   * than as the same place with the lights on: the shadow side now falls toward blue
   * instead of the lit side falling toward orange.
   *
   * The sun is lower (elevation ~24°) than a noon sun on purpose: a high key lights
   * every roof equally and flattens the street, which is the same reason the dusk rig
   * dropped the prototype's 47° to 33°.
   */
  dawn: {
    id: 'dawn',
    sky: [
      [0, '#2f6ea8'], // zenith: proper daylight blue, not a night blue
      [0.38, '#5f9ac6'],
      [0.62, '#9dc2d8'],
      [0.78, '#d8cfae'], // the haze band, warm
      [0.9, '#efd79a'],
      [1, '#cfc09a'],
    ],
    key: {
      position: [30, 34, 62],
      color: 0xfff0d6,
      scale: 3.6,
      body: { color: 0xfff6e2, scale: 34, opacity: 0.5, glow: 0.3 },
    },
    // The sky half is bright and blue, the bounce warm off the paving: in daylight
    // the ambient is a large fraction of the exposure, so it scales up rather than
    // being the night's dim fill.
    ambient: { sky: 0x9dbde0, ground: 0x8a7250, scale: 2.9 },
    // Haze is thinner than the night's but *warmer*, which is what a morning looks
    // like at distance: the far end of the plaza washes toward pale sand.
    fog: { color: 0xa8b8c8, densityScale: 0.42 },
    exposureScale: 0.86,
    environmentScale: 2.4,
    // A windy night's dust on every horizontal surface, and the light dew is long gone.
    // `dust` is what stops a low hard sun from putting a clipped specular on every kerb,
    // and the small `wetness` is the last of the night's damp in the shaded half of the
    // street — morning shade is the one place in this preset that is still wet.
    weather: { dust: 0.4, wetness: 0.1 },
    artificial: { lamps: false, windows: false, fire: true, stars: false },
    glow: {
      // A lamp lens in daylight is a pale disc, not a bright one.
      bulb: 0x8e8b84,
      window: 0x2b3138,
      sign: 0x7d6a44,
      lampLightScale: 0,
      lampGlow: 0,
    },
  },
  /**
   * 0437 — the tuned night rig (ADR-0013). The sun has become the moon, the lamps
   * and the lit windows are the only warm light, and the haze is cool and dim.
   */
  dusk: {
    id: 'dusk',
    sky: [
      [0, '#0a1220'],
      [0.42, '#1b2739'],
      [0.66, '#2b3648'],
      [0.78, '#3d4351'],
      [0.86, '#4a453c'], // city glow, kept thin
      [1, '#5a5445'],
    ],
    key: {
      // The prototype's sunset azimuth, held (legacy/PARITY_NOTES.md), at the lower
      // 33° elevation the lighting pass chose so shadows read across the street.
      position: [55, 42, -35],
      color: 0xbdd0f0,
      scale: 1,
      body: { color: 0xdfe8ff, scale: 46, opacity: 0.9, glow: 1 },
    },
    ambient: { sky: 0x59709f, ground: 0x6a5636, scale: 1 },
    // Dimmer than the 0x4b5567 it was, and thinned by `LOOK.fogDensityScale`: at night
    // a bright haze turns the far end of the plaza into the brightest region of the
    // frame, which reads as a blurry picture rather than as distance (ADR-0017).
    fog: { color: 0x39404f, densityScale: 1 },
    exposureScale: 1,
    environmentScale: 1,
    // A damp night: the rain has stopped but nothing has dried. This is what gives the
    // plaza its sheen under the lamps — the road keeps a lamp's reflection and the paving
    // gains sky it did not reflect an hour ago — and it is the *quietest* of the two
    // presets for highlights, because a wet rough surface is glossier but no brighter.
    // 0.33 and not 1.0, and not the 0.45 the first version used either: the road is meant to
    // hold a lamp's reflection, not to be standing water, and a third of the way to the wet
    // target is a sheen you notice on the ground rather than a mirror you notice instead of
    // the street. (0.45 also glossed the paving and every barrier far enough that the plaza
    // brightened as a whole, which is a lighting change rather than a surface one.)
    weather: { dust: 0.12, wetness: 0.33 },
    artificial: { lamps: true, windows: true, fire: true, stars: true },
    glow: { bulb: 0xffd9a0, window: 0x3d2c17, sign: 0xffb043, lampLightScale: 1, lampGlow: 1 },
  },
};

export function timePreset(timeOfDay: TimeOfDay): TimeOfDayPreset {
  return TIME_PRESETS[timeOfDay] ?? TIME_PRESETS.dusk;
}

/** Elevation of a preset's key above the horizon, in degrees. */
export function keyElevationDeg(preset: TimeOfDayPreset): number {
  const [x, y, z] = preset.key.position;
  return (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
}

const skyTextures = new Map<TimeOfDay, THREE.CanvasTexture>();

/**
 * The sky dome's gradient, drawn once per preset and shared.
 *
 * A dome is a 64x512 gradient stretched over a sphere; the dome and the image-based
 * lighting both read *this* texture, which is the point: if the environment map were
 * built from a second gradient, every metal in the scene would reflect a sky that is
 * not the sky overhead.
 */
export function skyTextureFor(timeOfDay: TimeOfDay): THREE.CanvasTexture {
  const cached = skyTextures.get(timeOfDay);
  if (cached) return cached;
  const preset = timePreset(timeOfDay);
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d')!;
  const gradient = g.createLinearGradient(0, 0, 0, 512);
  for (const [stop, color] of preset.sky) gradient.addColorStop(stop, color);
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 512);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  skyTextures.set(timeOfDay, texture);
  return texture;
}

/** Unit direction the key shines from, for the environment's highlight blob. */
export function keyDirection(preset: TimeOfDayPreset): THREE.Vector3 {
  return new THREE.Vector3(...preset.key.position).normalize();
}
