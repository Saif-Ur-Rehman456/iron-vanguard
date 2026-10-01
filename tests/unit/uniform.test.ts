/**
 * What makes a soldier read as a soldier (ADR-0015).
 *
 * The review's complaint was "the enemies do not read as real soldiers". Probing the
 * built body found three reasons, and every one of them is arithmetic:
 *
 *  1. the kit was mirrored — the sim's forward is local -z (`yawFromDirection` is
 *     `atan2(-dx, -dz)`, the muzzle and the aim laser both point -z, and the death
 *     fall is along -z) while the goggles, NVG mount, chest pouches, chest knife, hip
 *     pouches, kneepads, boot toes, holster, backpack and radio antenna were all
 *     authored at +z. The squad wore its vests, faces and boots backwards;
 *  2. the arms rested at a *negative* pitch, which for a -z-forward body swings the
 *     hand behind the hip — so soldiers carried their rifles behind their backs and
 *     "raised" them by swinging further back;
 *  3. the weapon hung 0.72-0.78 m from the support shoulder while a 1.8 m soldier's
 *     arm is 0.62 m, so the support hand could not touch the weapon it was holding.
 *
 * These tests check the fixes as geometry, not as intent: a distance against an arm
 * length, a direction against the body's forward, a value against the value next to
 * it. They run with no GPU, because none of the three defects needed one to be seen.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ENEMIES } from '@iron/content';
import {
  ARM_REACH,
  COMBATANT,
  KIT,
  PALETTE_LIFT,
  RIM,
  carryPoint,
  carrySolution,
  deriveUniformPalette,
  front,
  back,
  kitZ,
  lift,
  sheened,
} from '@iron/render';

/** Linear luminance of an sRGB hex, which is what a dim key light multiplies. */
function luminance(hex: number): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function hue(hex: number): number {
  return new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).h;
}

describe('which way a soldier faces', () => {
  it('calls the simulation forward -z, the axis everything visible already uses', () => {
    // The three independent confirmations, as constants: `front()` is negative and
    // `back()` positive, so a part's side is named rather than signed.
    expect(front(1)).toBeLessThan(0);
    expect(back(1)).toBeGreaterThan(0);
  });

  it('puts the face, the pouches and the toes on the front, and the pack on the back', () => {
    for (const piece of Object.keys(KIT) as (keyof typeof KIT)[]) {
      const z = kitZ(piece, 0.2);
      if (KIT[piece] === 'front') expect(z, piece).toBeLessThan(0);
      else expect(z, piece).toBeGreaterThan(0);
    }
    // The two the player reads first: a face and a toe box.
    expect(kitZ('goggles', 0.115)).toBeLessThan(0);
    expect(kitZ('nvgMount', 0.15)).toBeLessThan(0);
    expect(kitZ('toes', 0.05)).toBeLessThan(0);
    expect(kitZ('chestPouches', 0.2)).toBeLessThan(0);
    expect(kitZ('backpack', 0.28)).toBeGreaterThan(0);
    expect(kitZ('radioAntenna', 0.08)).toBeGreaterThan(0);
  });

  it('has every directional kit piece accounted for on one side or the other', () => {
    // A new piece of kit that is not in the table is a piece whose side nobody chose.
    for (const [piece, side] of Object.entries(KIT)) {
      expect(['front', 'back'], piece).toContain(side);
    }
    expect(Object.keys(KIT).length).toBeGreaterThanOrEqual(10);
  });
});

describe('uniform palette', () => {
  it('lifts every garment off content, and never darkens one', () => {
    for (const enemy of ENEMIES) {
      const palette = deriveUniformPalette(enemy.render);
      for (const key of ['jacket', 'trousers', 'carrier', 'pouches', 'helmet', 'belt'] as const) {
        expect(PALETTE_LIFT[key], `${enemy.id}.${key}`).toBeGreaterThanOrEqual(1);
      }
      // The dark end is content's own value: the archetype colours were chosen for a
      // night mission, and the fix is separation, not brightness.
      expect(luminance(palette.boots)).toBeCloseTo(luminance(enemy.render.bodyColor), 6);
      expect(luminance(palette.jacket)).toBeGreaterThan(luminance(enemy.render.bodyColor));
      // ...but nobody becomes a beige blob: content * lift, bounded.
      expect(PALETTE_LIFT.jacket).toBeLessThanOrEqual(2.5);
    }
  });

  it('keeps content hue exactly, so an archetype stays recognisable', () => {
    for (const enemy of ENEMIES) {
      const palette = deriveUniformPalette(enemy.render);
      // A scalar multiply in linear space preserves the ratios between channels,
      // which is the hue. The residual is 8-bit quantisation — these are dark,
      // near-neutral olives where the channels are a couple of levels apart, so
      // rounding one channel moves the *hue angle* by a degree or two. Visually
      // nothing; the point of the test is that the archetype has not turned a
      // different colour.
      // The tolerance scales with how much hue there is to preserve: the heavy's
      // 0x33393c is a near-neutral blue-grey whose channels are nine levels apart, so
      // its hue *angle* is unstable under quantisation in a way a green olive's is
      // not. What the test is really asserting is that an archetype has not become a
      // different colour.
      const saturation = new THREE.Color(enemy.render.bodyColor).getHSL({ h: 0, s: 0, l: 0 }).s;
      const tolerance = 4 + (1 - Math.min(1, saturation / 0.3)) * 10;
      for (const key of ['jacket', 'trousers', 'helmet', 'boots'] as const) {
        const delta = Math.abs(hue(palette[key]) - hue(enemy.render.bodyColor));
        expect(Math.min(delta, 1 - delta) * 360, `${enemy.id}.${key}`).toBeLessThan(tolerance);
      }
      expect(palette.visor).toBe(enemy.render.visorColor);
    }
  });

  it('separates every adjacent pair of garments by a visible step', () => {
    for (const enemy of ENEMIES) {
      const palette = deriveUniformPalette(enemy.render);
      // The read the palette exists for: armour against cloth, pouches against the
      // garment they sit on, a helmet against the shoulders. A 25% luminance step is
      // the smallest that survives a dim key light; nothing here is a flat wash.
      const pairs: [string, number, number][] = [
        ['jacket vs carrier', palette.jacket, palette.carrier],
        ['pouches vs carrier', palette.pouches, palette.carrier],
        ['pouches vs jacket', palette.pouches, palette.jacket],
        ['jacket vs trousers', palette.jacket, palette.trousers],
        ['helmet vs jacket', palette.helmet, palette.jacket],
        ['trousers vs boots', palette.trousers, palette.boots],
      ];
      for (const [label, a, b] of pairs) {
        const ratio = Math.max(luminance(a), luminance(b)) / Math.max(1e-6, Math.min(luminance(a), luminance(b)));
        expect(ratio, `${enemy.id}: ${label}`).toBeGreaterThan(1.25);
      }
    }
  });

  it('clamps instead of overflowing the gamut', () => {
    expect(luminance(lift(0xf0f0f0, 4))).toBeLessThanOrEqual(1);
    expect(lift(0x000000, 3)).toBe(0);
  });
});

describe('rim response', () => {
  it('gives cloth a tight warm-neutral rim, sharing the library maps rather than cloning them', () => {
    const map = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 });
    const cloth = sheened(source, RIM.cloth, 0x50503c);
    expect(cloth.sheen).toBeCloseTo(RIM.cloth, 6);
    expect(cloth.sheenRoughness).toBeCloseTo(RIM.sheenRoughness, 6);
    // Tight: a broad sheen lobe is not a rim at all — it is a uniform veil of extra
    // light, and over the palette lift it shaded the whole soldier towards pale
    // cream (the review's "flat boxman" measured on the plaza). A grazing rim is
    // tight by definition.
    expect(RIM.sheenRoughness).toBeLessThan(0.5);
    // Warm-neutral, not the moon's blue: the strongest light that reaches a soldier
    // in the plaza is a street lamp, and a cool veil on a warm-lit figure is what
    // "washed out" was. (The old assertion asked for a cool sheen; it encoded the
    // rationale that produced the wash — see AGENTS.md, bugs-found entry 33.)
    const sheen = cloth.sheenColor;
    expect(sheen.r).toBeGreaterThanOrEqual(sheen.b);
    // The maps belong to the texture library, which disposes them once: a clone per
    // enemy would be a leak and a duplicate upload.
    expect(cloth.map).toBe(map);
    expect(cloth.color.getHex()).toBe(0x50503c);
    // The hit flash sets `emissive` on these, so they have to be standard-family.
    expect(cloth.emissive.setHex(0x7a1008)).toBe(cloth.emissive);
    cloth.dispose();
    source.dispose();
  });
});

describe('the two-handed carry', () => {
  it('solves the low-ready carry so the support grip is inside the support arm', () => {
    const carry = carrySolution();
    // The defect: 0.72-0.78 m from a 0.62 m arm, so the support arm stopped short.
    // The solved carry lands within a few centimetres of the reach rather than a
    // tenth of a metre short, and the residual is a deliberate trade: the last
    // centimetres would cost a weapon that hangs level to the soldier's side, and
    // they are covered by the support glove that is part of the weapon.
    expect(carry.reachError).toBeLessThan(0.06);
    expect(Math.abs(carry.restDistance - ARM_REACH)).toBeLessThan(0.06);
    expect(carry.restDistance).toBeGreaterThan(0.55);
  });

  it('points the weapon at the player when the soldier aims', () => {
    const carry = carrySolution();
    const [x, y, z] = carry.aimMuzzle;
    // Level and forward: an aim pose whose rifle points at the soldier's own left is
    // worse than no aim pose at all.
    expect(z).toBeLessThan(-0.9);
    expect(Math.abs(x)).toBeLessThan(0.1);
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-0.4);
  });

  it('hangs the weapon across the chest at low ready, muzzle down and never up', () => {
    const carry = carrySolution();
    expect(carry.restMuzzle[1]).toBeLessThan(0);
    expect(carry.restRotation[0]).toBeLessThan(0);
  });

  it('holds the same grip in both poses, so the animation cannot open a gap', () => {
    const carry = carrySolution();
    // `carryPoint` is what the per-frame support-arm solve uses, and it has to agree
    // with the distances the solver measured — including mid-blend, which is what the
    // weapon's rotation is slerped through.
    const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(...carry.restRotation));
    const aim = new THREE.Quaternion().setFromEuler(new THREE.Euler(...carry.aimRotation));
    const left = new THREE.Vector3(...COMBATANT.shoulderLeft);
    const blend = new THREE.Quaternion();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      blend.slerpQuaternions(rest, aim, t);
      const euler = new THREE.Euler().setFromQuaternion(blend, 'XYZ');
      const armPitch = COMBATANT.restArm + (COMBATANT.aimArm - COMBATANT.restArm) * t;
      const grip = carryPoint([euler.x, euler.y, euler.z], armPitch);
      const reach = left.distanceTo(grip);
      // The aiming pose leaves the grip ~0.2 m beyond the arm — the reason the support
      // glove is a child of the weapon rather than of the arm — and nothing in the
      // blend may be worse than the poses it interpolates.
      expect(reach, `blend ${t}`).toBeGreaterThan(0.5);
      expect(reach, `blend ${t}`).toBeLessThan(0.9);
    }
  });

  it('solves once, and cheaply', () => {
    const start = Date.now();
    const first = carrySolution();
    const again = carrySolution();
    expect(again).toBe(first);
    expect(Date.now() - start).toBeLessThan(250);
  });

  it('keeps the arms in front of the body, not behind it', () => {
    // The sign of the arm pitch is the whole of defect 2: for a -z-forward body, a
    // negative pitch puts the hand behind the hip. Measured from the shoulder, the
    // rest glove has to be forward of it.
    expect(COMBATANT.restArm).toBeGreaterThan(0);
    expect(COMBATANT.aimArm).toBeGreaterThan(COMBATANT.restArm);
    const hand = new THREE.Vector3(...COMBATANT.handLocal);
    const arm = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(COMBATANT.restArm, 0, COMBATANT.armCant),
    );
    const world = hand.clone().applyQuaternion(arm);
    expect(world.z).toBeLessThan(-0.3);
    expect(world.y).toBeLessThan(0);
  });
});
