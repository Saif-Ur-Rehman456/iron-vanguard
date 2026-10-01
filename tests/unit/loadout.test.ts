/**
 * The loadout: three weapons, selected with 1/2/3 (parse request → ADR-0016 era).
 *
 * The review asked for a soldier carrying a Desert Eagle, an M4 and an AK-47, picked
 * with the number keys, and for the weapons to *work* — which is why the contract here
 * is about the simulation rather than about the models:
 *
 *  - the loadout is three weapons and the mission opens on the rifle;
 *  - ammo belongs to the weapon, not to the slot, so a swap is a swap and not a
 *    conjured magazine;
 *  - a swap puts the weapon away for its own `equipSeconds`, so nobody fires the gun
 *    that arrived on the tick it arrived;
 *  - the numbers that make the three feel like three (damage, recoil, falloff) are
 *    read from `world.weaponDef`, so switching weapons *is* switching behaviour.
 *
 * The determinism half is the important half: a swap is an action, so it is recorded
 * and replayed like any other command, and `tests/golden` still passes because a
 * replay that never presses 1 or 3 never sees a difference (verified by
 * `npm run replay`).
 */
import { describe, expect, it } from 'vitest';
import {
  canFire,
  createInputState,
  createWorld,
  fireShot,
  spreadNow,
  startReload,
  stepWorld,
  switchWeapon,
  type World,
} from '@iron/sim';
import { DEFAULT_SLOT, LOADOUT, WEAPONS_BY_ID } from '@iron/content';

const makeWorld = (): World =>
  createWorld({ seed: 7, missionId: 'm00_prologue', difficultyId: 'regular' });

const slotOf = (world: World, slot: number): (typeof world.player.loadout)[number] =>
  world.player.loadout[slot - 1]!;

describe('the loadout', () => {
  it('carries three weapons and opens on the mission rifle', () => {
    const world = makeWorld();
    expect(world.player.loadout).toHaveLength(3);
    expect(LOADOUT).toHaveLength(3);
    expect(world.player.loadout.map((entry) => entry.defId)).toEqual([...LOADOUT]);
    expect(world.player.slot).toBe(DEFAULT_SLOT);
    expect(world.player.weapon).toBe(slotOf(world, DEFAULT_SLOT));
    expect(world.weaponDef.id).toBe(world.player.weapon.defId);
    // The three the review asked for, by class: a pistol, two rifles.
    const classes = LOADOUT.map((id) => WEAPONS_BY_ID[id]!.class);
    expect(classes).toContain('pistol');
    expect(classes.filter((c) => c === 'rifle')).toHaveLength(2);
  });

  it('gives each slot its own ammunition, and never refills on a swap', () => {
    const world = makeWorld();
    const rifle = { ...world.player.weapon };
    world.player.weapon.ammo = rifle.ammo - 9; // nine rounds down the M4
    const spent = world.player.weapon.ammo;

    switchWeapon(world, 1);
    expect(world.player.weapon.defId).toBe(LOADOUT[0]);
    // A pistol carries pistol ammunition: three magazines of seven, not 240 rounds.
    expect(world.player.weapon.reserve).toBeLessThanOrEqual(
      WEAPONS_BY_ID[LOADOUT[0]!]!.reserveMax,
    );

    switchWeapon(world, DEFAULT_SLOT);
    expect(world.player.weapon.ammo).toBe(spent);
    expect(world.player.weapon.reserve).toBe(rifle.reserve);
  });

  it('reads the weapon that is in hand, so the three really are three', () => {
    const world = makeWorld();
    const rifleDamage = world.weaponDef.damage;
    const rifleSpread = spreadNow(world);
    switchWeapon(world, 1);
    expect(world.weaponDef.id).toBe(LOADOUT[0]);
    expect(world.weaponDef.damage).not.toBe(rifleDamage);
    expect(world.weaponDef.damage).toBeGreaterThan(rifleDamage); // the .50 hits harder
    expect(spreadNow(world)).not.toBe(rifleSpread); // and carries its own cone
    expect(world.weaponDef.viewModel.archetype).toBe('pistol');
  });

  it('locks fire for the weapon’s own equip time, then unlocks it', () => {
    const world = makeWorld();
    switchWeapon(world, 3);
    const equipTicks = world.player.equipTicks;
    expect(equipTicks).toBeGreaterThan(0);
    expect(canFire(world)).toBe(false);

    // One tick of the canonical order: `updatePlayer` decrements the counter.
    for (let i = 0; i < equipTicks; i++) stepWorld(world, createInputState());
    expect(world.player.equipTicks).toBe(0);
    expect(canFire(world)).toBe(true);

    // ...and the rifle fires with its own damage, from its own magazine.
    const before = world.player.weapon.ammo;
    fireShot(world);
    expect(world.player.weapon.ammo).toBe(before - 1);
    expect(world.events.some((event) => event.type === 'shot' && event.weaponId === 'ak47')).toBe(true);
  });

  it('cancels a reload in progress and reports the swap to the renderer', () => {
    const world = makeWorld();
    world.player.weapon.ammo = 1;
    startReload(world);
    expect(world.player.reloading).toBe(true);
    world.events.length = 0;

    switchWeapon(world, 3);
    expect(world.player.reloading).toBe(false);
    expect(world.player.reloadTicks).toBe(0);
    const changed = world.events.find((event) => event.type === 'weaponChanged');
    expect(changed).toBeDefined();
    expect(changed && changed.type === 'weaponChanged' ? changed.weaponId : null).toBe('ak47');
    expect(changed && changed.type === 'weaponChanged' ? changed.slot : null).toBe(3);
  });

  it('is an action, so the number keys go through the command log', () => {
    const world = makeWorld();
    stepWorld(world, createInputState(), ['weapon1']);
    // The tick that carried the action has already decremented once, which is why the
    // lockout is `equipSeconds * 60 - 1` ticks from the *next* tick's point of view.
    expect(world.player.slot).toBe(1);
    expect(world.player.weapon.defId).toBe(LOADOUT[0]);
    expect(world.player.equipTicks).toBeGreaterThan(0);

    // Unknown slots and the slot in hand are no-ops rather than errors: a keypress is
    // not a place to throw.
    const before = world.player.slot;
    const events = world.events.length;
    switchWeapon(world, 0);
    switchWeapon(world, 9);
    switchWeapon(world, before);
    expect(world.player.slot).toBe(before);
    expect(world.events.length).toBe(events);
  });
});
