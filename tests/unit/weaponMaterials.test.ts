/**
 * The view model's materials (AGENTS.md entries 21 and 27).
 *
 * Two reports meet here. *"The gun and the hands are a silhouette in their own frame"*
 * was measured on a build where a 0.92-metalness receiver sat 40 cm from a single small
 * point light: a pure metal returns a specular highlight and no diffuse term, so at
 * night the weapon and the gloves holding it came back as one black shape. And the
 * black sight picture was partly this: two dark lenses at 0.4 opacity, stacked in front
 * of an eye 12 cm away.
 *
 * Both are properties of the material data rather than of a shader, which is why they
 * live in `WEAPON_SURFACE` and in two small factories and can be checked with no GPU.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOOK_RIG, WEAPON_SURFACE, createDotMaterial, createLensMaterial } from '@iron/render';

describe('the view model\u2019s surfaces', () => {
  it('are lit by the view light, not only by the specular lobe', () => {
    for (const key of ['gunmetal', 'steel'] as const) {
      const surface = WEAPON_SURFACE[key];
      // A point light 40 cm from a 0.92-metalness surface gives the player a highlight
      // and nothing else. The threshold is soft on purpose: this is "metal that responds
      // to a light", not "metal that is not metal".
      expect(surface.metalness ?? 0, key).toBeLessThanOrEqual(0.75);
      expect(surface.metalness ?? 0, key).toBeGreaterThan(0.4);
      // ...and the night sky is what carries the rest of the read.
      expect(surface.envIntensity ?? 0, key).toBeGreaterThan(0.6);
      expect(surface.roughness ?? 0, key).toBeGreaterThan(0.3);
    }
  });

  it('spread a light over the surface instead of clipping it into a glow', () => {
    // The sixth report is the *opposite* complaint to entry 21 and it is the same two
    // numbers: at roughness 0.44 and `envIntensity` 1.25 a 7 lux source 40 cm away pushed
    // the rail, the optic and the flash hider past 1.0 in the HDR buffer, and everything
    // past the bloom threshold smears across the frame. A broad lobe at a lower gain puts
    // the same energy on the surface it landed on.
    for (const key of ['gunmetal', 'steel'] as const) {
      const surface = WEAPON_SURFACE[key];
      expect(surface.roughness ?? 0, key).toBeGreaterThanOrEqual(0.5);
      expect(surface.envIntensity ?? 0, key).toBeLessThanOrEqual(1);
    }
    // And the view light itself is the other half of the fix: 17 lux on a receiver is
    // 6.5x the moon key, which clips whatever it touches no matter how the surface is
    // authored. 7 lux is ~2.7x. Asserted where the light is built (renderer.ts) — here
    // the point is that the *materials* cannot be made to clip by themselves.
  });

  it('give the hands and the sleeves the sky at full strength', () => {
    for (const key of ['leather', 'sleeve', 'skin'] as const) {
      const surface = WEAPON_SURFACE[key];
      // These are the objects that say "a person is holding this". None of them may be
      // a metal, and all of them take the environment at least at full strength.
      expect(surface.metalness ?? 0, key).toBe(0);
      expect(surface.envIntensity ?? 0, key).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps every weapon surface in the table, so none falls back to the world library', () => {
    for (const key of ['gunmetal', 'steel', 'polymer', 'wood', 'leather', 'sleeve', 'skin'] as const) {
      expect(WEAPON_SURFACE[key], key).toBeDefined();
      // The world library's maps are authored for a plaza; a weapon surface that did not
      // state its own colour would be the wrong value on a 7 cm part.
      expect(WEAPON_SURFACE[key], key).toBeTypeOf('object');
    }
  });

  it('makes the optic glass see-through rather than a dark filter', () => {
    const lens = createLensMaterial();
    const placed = [lens, createLensMaterial()];
    // Two lenses, front and rear, 12 cm from the eye: at 0.4 the pair was a 60% black
    // wash over the whole sight picture — the "black scope" the player kept reporting.
    let transmission = 1;
    for (const glass of placed) {
      expect(glass.transparent).toBe(true);
      // 0.2 was the entry-27 fix; the sixth report's "the optic's lens is a grey wash"
      // is what 0.16 x 2 in front of a 19 cm eye actually looks like. A sight picture
      // has to be almost entirely the world.
      expect(glass.opacity).toBeLessThanOrEqual(0.08);
      // A 1.7-intensity reflection of the sky on 0.04-roughness glass is a two-way
      // mirror across the whole aperture — the other half of the grey.
      expect(glass.envMapIntensity).toBeLessThanOrEqual(0.6);
      // Glass must never occlude what is behind it in the depth buffer.
      expect(glass.depthWrite).toBe(false);
      expect(glass.side).toBe(THREE.DoubleSide);
      expect(glass.metalness).toBe(0);
      expect(glass.roughness).toBeLessThan(0.15);
      transmission *= 1 - glass.opacity;
    }
    // What the player sees through the pair, after the reticle's own tint is accounted
    // for: nearly nine tenths of the world, against the four tenths it shipped with.
    expect(transmission).toBeGreaterThan(0.85);
    lens.dispose();
  });

  it('draws the reticle as a source rather than as lit paint', () => {
    const dot = createDotMaterial();
    // Unlit, so a night frame does not dim the one thing the player aims with...
    expect(dot.type).toBe('MeshBasicMaterial');
    // ...and outside the tone map, so it stays a red dot instead of an orange smudge.
    expect(dot.toneMapped).toBe(false);
    expect(dot.transparent).toBe(true);
    expect(dot.depthWrite).toBe(false);
    const { r, g, b } = dot.color;
    expect(r).toBeGreaterThan(0.5);
    expect(g).toBeLessThan(r * 0.4);
    expect(b).toBeLessThan(r * 0.4);
    // ...and it is deliberately *below* the bloom threshold. A reticle that bloomed is a
    // soft pink blob whose centre is not where the round goes, which is the one thing an
    // aiming system cannot trade away. The sixth report's frame had exactly that: a 50 px
    // pink disc where the point of aim should be.
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(LOOK_RIG.bloomThreshold);
    dot.dispose();
  });

  it('separates the weapon into material groups, so it is not one dark value', () => {
    // The seventh review's item 11: *"weapon ke materials too dark aur visually compressed
    // hain… metal, polymer, grip aur other components ke differences kam nazar aate hain"*.
    // Brightening the weapon is not the fix — separation is. The four hard-surface groups
    // have to differ in what they *do* with light, not only in colour: a receiver, a barrel,
    // a grip and a wooden handguard are four different responses on one object.
    const groups = ['gunmetal', 'steel', 'polymer', 'wood'] as const;
    const separation = (a: (typeof groups)[number], b: (typeof groups)[number]): number => {
      const one = WEAPON_SURFACE[a];
      const two = WEAPON_SURFACE[b];
      return (
        Math.abs((one.roughness ?? 0) - (two.roughness ?? 0)) +
        Math.abs((one.metalness ?? 0) - (two.metalness ?? 0)) +
        Math.abs((one.envIntensity ?? 0) - (two.envIntensity ?? 0))
      );
    };
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        expect(separation(groups[i]!, groups[j]!), `${groups[i]}/${groups[j]}`).toBeGreaterThan(0.15);
      }
    }
    // Both readings are present: the weapon is metal *and* it is not only metal, which is
    // what makes a polymer grip read as a grip against a receiver.
    expect(groups.some((key) => (WEAPON_SURFACE[key].metalness ?? 0) >= 0.5)).toBe(true);
    expect(groups.some((key) => (WEAPON_SURFACE[key].metalness ?? 0) === 0)).toBe(true);
    // ...and no two groups are painted the same value. Colour is the *last* resort, not the
    // mechanism: two surfaces that differ only in colour have the same response.
    const colours = new Set<number>();
    for (const key of Object.keys(WEAPON_SURFACE) as (keyof typeof WEAPON_SURFACE)[]) {
      const colour = WEAPON_SURFACE[key].color;
      if (colour === undefined) continue;
      expect(colours.has(colour), `${key} shares a colour`).toBe(false);
      colours.add(colour);
    }
  });

  it('lets the hands take the difference when the metals come down', () => {
    // The sixth review's rule, stated as an ordering rather than as one number per
    // material: the opaque metals are held at or below 0.9 of the sky so their highlight
    // stays on the surface, and every *dielectric* in the frame — glove, sleeve, skin, and
    // the two soft parts of the weapon — gets the sky at or above full strength, because a
    // matte surface is where the environment reads as form and a hand lit by the sky cannot
    // blow out. If this inverts, the report's "there are no hands" comes back with a
    // highlighter instead of a silhouette.
    const metals = ['gunmetal', 'steel'] as const;
    const hands = ['leather', 'sleeve', 'skin'] as const;
    const metalCeiling = Math.max(...metals.map((key) => WEAPON_SURFACE[key].envIntensity ?? 0));
    const handFloor = Math.min(...hands.map((key) => WEAPON_SURFACE[key].envIntensity ?? 0));
    expect(metalCeiling).toBeLessThanOrEqual(0.9);
    expect(handFloor).toBeGreaterThanOrEqual(1);
    expect(handFloor - metalCeiling).toBeGreaterThan(0.09);
    // The weapon's own non-metals (a grip, a handguard) are held below the hands but not
    // starved: they are the parts that say the weapon has *more than one* material, so a
    // value low enough to make them read as dark shapes would undo item 11 again.
    for (const key of ['polymer', 'wood'] as const) {
      expect(WEAPON_SURFACE[key].envIntensity ?? 0, key).toBeGreaterThanOrEqual(0.7);
      expect(WEAPON_SURFACE[key].metalness ?? 0, key).toBe(0);
    }
  });
});
