/**
 * The roughness map's contract, as arithmetic (ADR-0022).
 *
 * three's stock fragment chunk is `roughnessFactor = roughness` then, with a map,
 * `roughnessFactor *= texelRoughness.g`. So a map that carries an *absolute* roughness is
 * multiplied by the material's absolute roughness, and the surface shades at its own gloss
 * squared: car paint authored at 0.34 shaded at 0.12, the view model's receiver authored at
 * 0.56 shaded at 0.23 (a mirror), water at 0.06 shaded at 0.004. Every material with a map
 * paid it, at a rate set by how smooth it was — which is why the *smooth* half of the
 * library looked like polished plastic and why a 1.1 cd light 40 cm away came back as a
 * white smear on the weapon.
 *
 * The map now carries the local *swing* and the material carries the value. Neither half is
 * visible in a screenshot as a number, so the composition is a function and this file is its
 * check: an authored roughness is the gloss the surface has, a texel can move it by at most
 * its class's declared swing, and the encoding round-trips through a texture channel.
 */
import { describe, expect, it } from 'vitest';
import {
  SURFACE_CLASSES,
  SURFACE_SPEC,
  effectiveRoughness,
  roughnessSwing,
  swingChannel,
} from '@iron/render';

/** three floors a roughness at the base mip of a 256 cubemap (`lights_physical_fragment`). */
const THREE_ROUGHNESS_FLOOR = 0.0525;

describe('the roughness map is a swing, not a value', () => {
  it('is neutral in the middle of its own channel', () => {
    // The height field's neutral is 0.5 (`Sketch.fill`) and the painted field starts at 0.5,
    // so a surface with neither relief nor paint has to come out at exactly its material's
    // roughness. This is the assertion that would have caught the squared version: under it,
    // a neutral texel multiplied the material by 0.5 and every value below is halved.
    expect(roughnessSwing(0.3, 0.6, 0.5, 0.5)).toBe(0);
    expect(swingChannel(0)).toBeCloseTo(0.5, 12);
    expect(effectiveRoughness(0.34, roughnessSwing(0.3, 0.6, 0.5, 0.5))).toBe(0.34);
    // ...and *not* the square, which is what the shipped build shaded.
    expect(effectiveRoughness(0.34, 0)).not.toBeCloseTo(0.34 * 0.34, 3);
  });

  it('leaves an authored roughness meaning what it says, at both ends of the table', () => {
    // The two ends are the ones the reports were about: car paint (0.34) reading as a mirror
    // and the weapon's receiver (0.56) reading as a light source.
    for (const cls of SURFACE_CLASSES) {
      const spec = SURFACE_SPEC[cls];
      const neutral = effectiveRoughness(spec.roughness, 0);
      expect(neutral, cls).toBeCloseTo(Math.max(spec.roughness, THREE_ROUGHNESS_FLOOR), 9);
    }
  });

  it('cannot move a texel further than the class declares', () => {
    // The swing's bound is the class's own declaration — relief variation plus the painted
    // field's full range — and it is clamped to the channel it is stored in. A surface that
    // could swing past its own roughness by more than 1.0 would be a bug that only shows up
    // as one dark corner of one map.
    for (const cls of SURFACE_CLASSES) {
      const spec = SURFACE_SPEC[cls];
      for (const height of [0, 0.5, 1]) {
        for (const field of [0, 0.5, 1]) {
          const swing = roughnessSwing(spec.roughnessVariation, spec.roughnessField, height, field);
          expect(Math.abs(swing), `${cls} at ${height}/${field}`).toBeLessThanOrEqual(1);
          expect(swingChannel(swing), cls).toBeGreaterThanOrEqual(0);
          expect(swingChannel(swing), cls).toBeLessThanOrEqual(1);
          const effective = effectiveRoughness(spec.roughness, swing);
          expect(effective, cls).toBeGreaterThanOrEqual(THREE_ROUGHNESS_FLOOR);
          expect(effective, cls).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('survives a round trip through an 8-bit channel', () => {
    // The swing is stored in a texture, so the loss is one quantisation step: this is the
    // check that the loss is a step and not a factor (which is what a mis-scaled decode
    // would be — a surface 2x glossier than authored, on every material at once).
    for (let i = 0; i <= 200; i++) {
      const swing = i / 100 - 1;
      const channel = swingChannel(swing);
      const stored = Math.round(channel * 255) / 255;
      const decoded = (stored - 0.5) * 2;
      expect(Math.abs(decoded - swing), `swing ${swing}`).toBeLessThanOrEqual(1.5 / 255);
    }
  });

  it('cannot invert the ordering of two classes at its neutral point', () => {
    // The defect it guards is a *scale*, not a sign: the swing is added, so a surface's
    // neutral texel is its authored value and the table's ordering survives to the shader.
    // Under the multiply, every class moved toward 0 by a factor of its own roughness and
    // the ordering compressed — a road at 0.81 and a sandbag at 1.0 read as 0.81 and 1.0,
    // while car paint at 0.34 read as 0.12, closer to water (0.004) than to the glove beside
    // it. The test is the ratio, because that is what the eye reads as "different material".
    const neutral = (cls: (typeof SURFACE_CLASSES)[number]): number =>
      effectiveRoughness(SURFACE_SPEC[cls].roughness, 0);
    expect(neutral('sand')).toBeGreaterThan(neutral('asphalt'));
    expect(neutral('asphalt')).toBeGreaterThan(neutral('gunmetal'));
    expect(neutral('gunmetal')).toBeGreaterThan(neutral('carPaint'));
    expect(neutral('carPaint')).toBeGreaterThan(neutral('water'));
    // And the *ordering* survives every texel the two classes can produce, which is the
    // statement the pair from the material report needs: for all of a road's and a sand's
    // relief, the sand is never the smoother surface. It saturates at the top — both reach
    // fully-rough, as physics requires — so the invariant is the order, not the gap.
    const swingFor = (cls: 'asphalt' | 'sand', height: number, field: number): number =>
      roughnessSwing(SURFACE_SPEC[cls].roughnessVariation, SURFACE_SPEC[cls].roughnessField, height, field);
    for (const h of [0, 0.5, 1]) {
      for (const f of [0, 0.5, 1]) {
        const road = effectiveRoughness(SURFACE_SPEC.asphalt.roughness, swingFor('asphalt', h, f));
        const sand = effectiveRoughness(SURFACE_SPEC.sand.roughness, swingFor('sand', h, f));
        expect(sand, `road ${road} vs sand ${sand}`).toBeGreaterThanOrEqual(road);
      }
    }
    // ...and their *smoothest* texels — the traffic-polished lanes against compacted sand —
    // are still 0.05 apart, which is the margin the material suite's distance metric asks of
    // a pair the report could not tell apart. Both classes saturate at fully-rough, so the
    // gap is a statement about the glossy end, where the report's "the road reads as sand"
    // actually came from.
    const glossyRoad = effectiveRoughness(SURFACE_SPEC.asphalt.roughness, swingFor('asphalt', 0, 0));
    const glossySand = effectiveRoughness(SURFACE_SPEC.sand.roughness, swingFor('sand', 0, 0));
    expect(glossySand - glossyRoad).toBeGreaterThanOrEqual(0.05);
  });
});
