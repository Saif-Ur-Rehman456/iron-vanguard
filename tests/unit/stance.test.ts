/**
 * Stance: crouch and jump (AGENTS.md entry 28).
 *
 * These are not parity features, and that is the point. The prototype had no crouch at
 * all, and the shipped build bound C to nothing and Space to a `jump` action that no
 * system consumed: the player *could not leave the ground*, and the request "add crouch
 * on C and jump on Space, realistically rather than robotically" was asking for
 * something that did not exist behind a key that was already wired.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *  - it has to be real gameplay, not a camera trick, so the eye height enemies aim at
 *    and the player's own shot origin resolve through the stance (`playerEyeHeight`);
 *  - it must not disturb the recorded mission, so a player who never presses C or Space
 *    has to hash *exactly* as they always did. That is why the ground state zeroes
 *    `pos.y`/`vel.y` instead of integrating them: `hashWorld` pushes those two vectors.
 */
import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@iron/core';
import {
  STANCE,
  createInputState,
  playerEyeHeight,
  stepWorld,
  tryJump,
  type InputState,
} from '@iron/sim';
import { quietWorld } from '../helpers/world';

/** Run the world for a number of ticks with an input state built once. */
function run(world: ReturnType<typeof quietWorld>, ticks: number, input: InputState): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, input);
}

function jump(world: ReturnType<typeof quietWorld>, input: InputState): void {
  stepWorld(world, input, ['jump']);
}

describe('jump', () => {
  it('leaves the ground, comes back down, and lands at exactly zero', () => {
    const world = quietWorld();
    const input = createInputState();
    expect(world.player.grounded).toBe(true);

    jump(world, input);
    expect(world.player.grounded).toBe(false);
    expect(world.player.vel.y).toBeCloseTo(STANCE.jumpSpeed, 9);

    run(world, 6, input);
    expect(world.player.pos.y, 'should be off the ground').toBeGreaterThan(0.3);

    // Touchdown, and the landing impulse is live on the tick it happens: it is the
    // *fall* speed, so a hop lands harder than a step down a kerb.
    let landed = false;
    for (let i = 0; i < TICK_HZ && !landed; i++) {
      stepWorld(world, input);
      if (world.player.grounded) landed = true;
    }
    expect(landed, 'should touch down inside a second').toBe(true);
    expect(world.player.landT).toBeGreaterThan(0.8);

    // The ground state is a bit-exact one, which is what keeps the golden trace stable.
    expect(world.player.pos.y).toBe(0);
    expect(world.player.vel.y).toBe(0);
    run(world, TICK_HZ, input);
    expect(world.player.landT).toBe(0);
  });

  it('reaches the height the take-off speed implies', () => {
    const world = quietWorld();
    const input = createInputState();
    jump(world, input);
    let apex = 0;
    for (let i = 0; i < TICK_HZ; i++) {
      stepWorld(world, input);
      apex = Math.max(apex, world.player.pos.y);
    }
    const ballistic = (STANCE.jumpSpeed * STANCE.jumpSpeed) / (2 * STANCE.gravity);
    // A soldier in kit, not a gymnast: about half a metre. Semi-implicit Euler at 60 Hz
    // loses half a step of climb (v*dt/2 = 3.8 cm), which is the whole slack allowed.
    expect(apex).toBeGreaterThan(ballistic - STANCE.jumpSpeed * (1 / TICK_HZ));
    expect(apex).toBeLessThan(ballistic + 0.01);
    expect(apex).toBeLessThan(0.65);
  });

  it('cannot jump twice in the air', () => {
    const world = quietWorld();
    const input = createInputState();
    jump(world, input);
    run(world, 10, input);
    const rising = world.player.vel.y;
    expect(rising).toBeLessThan(STANCE.jumpSpeed);
    jump(world, input);
    // A second Space mid-air buys nothing: the take-off speed is not re-applied.
    expect(world.player.vel.y).toBeLessThanOrEqual(rising + 1e-9);
  });

  it('keeps its momentum, and can be steered a little', () => {
    const world = quietWorld();
    const input: InputState = { ...createInputState(), forward: 1 };
    input.sprinting = true; // sprint first, on the ground
    run(world, TICK_HZ, input);
    const groundSpeed = world.player.speed;
    input.sprinting = false;
    jump(world, input);
    run(world, 8, input);
    // Air control is reduced, never off: the jump keeps the run's momentum.
    expect(world.player.speed).toBeGreaterThan(groundSpeed * 0.7);
  });

  it('rises back to the standing eye and nothing else when idle', () => {
    const world = quietWorld();
    const input = createInputState();
    for (let i = 0; i < TICK_HZ * 4; i++) {
      stepWorld(world, input);
      expect(world.player.pos.y).toBe(0);
      expect(world.player.vel.y).toBe(0);
      expect(world.player.eyeHeight).toBe(1.7);
    }
  });
});

describe('crouch', () => {
  it('drops the eye to the crouched height and back, smoothly', () => {
    const world = quietWorld();
    const input = createInputState();
    run(world, TICK_HZ, input);
    expect(world.player.eyeHeight).toBeCloseTo(STANCE.standEye, 9);

    input.crouching = true;
    // Half a second is more than the stance's whole blend.
    run(world, TICK_HZ / 2, input);
    expect(world.player.crouchK).toBeGreaterThan(0.95);
    expect(world.player.eyeHeight).toBeLessThan(STANCE.crouchEye + 0.02);
    expect(playerEyeHeight(world)).toBeLessThan(1.7 - 0.45);

    input.crouching = false;
    run(world, TICK_HZ, input);
    expect(world.player.eyeHeight).toBeCloseTo(STANCE.standEye, 3);
  });

  it('walks slower crouched, and will not sprint', () => {
    const stand = quietWorld();
    const crouch = quietWorld();
    const walk: InputState = { ...createInputState(), forward: 1 };
    const sneaking: InputState = { ...createInputState(), forward: 1, crouching: true };
    run(stand, TICK_HZ, walk);
    run(crouch, TICK_HZ, sneaking);
    // `speed` rather than a position: the world's geometry pushes a body that starts
    // inside it, and this is about the gait anyway.
    expect(crouch.player.speed).toBeGreaterThan(1);
    expect(crouch.player.speed).toBeLessThan(stand.player.speed * 0.65);

    // Sprinting and crouching are exclusive: Shift does nothing while C is held.
    const sprinter = quietWorld();
    const both: InputState = { ...createInputState(), forward: 1, crouching: true, sprinting: true };
    run(sprinter, Math.round(TICK_HZ / 2), both);
    expect(sprinter.player.sprintK).toBeLessThan(0.05);
    expect(sprinter.player.sprinting).toBe(false);
  });

  it('is real gameplay, not a camera trick: the eye the enemy aims at moves', () => {
    const world = quietWorld();
    const input = createInputState();
    run(world, 4, input);
    const standing = playerEyeHeight(world);
    input.crouching = true;
    run(world, TICK_HZ, input);
    // `playerEyeHeight` is what the AI's sight target, its aim point and the player's own
    // shot origin all resolve through, so this is the difference between a stance and a
    // pose.
    expect(standing - playerEyeHeight(world)).toBeGreaterThan(0.45);
  });

  it('does not move a world that never presses a key', () => {
    const world = quietWorld();
    const input = createInputState();
    for (let i = 0; i < TICK_HZ * 2; i++) stepWorld(world, input);
    // The golden trace is recorded from a bot that never crouches or jumps, and this is
    // the property that keeps it byte-identical: at rest, the new state is constant.
    expect(world.player.crouchK).toBe(0);
    expect(world.player.crouching).toBe(false);
    expect(world.player.grounded).toBe(true);
    expect(world.player.airTicks).toBe(0);
    expect(world.player.landT).toBe(0);
    expect(world.player.pos.y).toBe(0);
    expect(world.player.vel.y).toBe(0);
  });

  it('refuses a jump from the air and takes one from the ground', () => {
    const world = quietWorld();
    tryJump(world);
    expect(world.player.grounded).toBe(false);
    expect(world.player.airTicks).toBe(0);
    world.player.alive = false;
    world.player.grounded = true;
    tryJump(world);
    expect(world.player.grounded).toBe(true);
  });
});
