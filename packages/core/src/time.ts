/** Fixed timestep clock: the simulation only ever advances in whole ticks. */
import { clamp } from './math.js';

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
/** Never advance more than this in one frame, even if the tab was suspended. */
export const MAX_FRAME_DT = 0.25;
/** Cap catch-up work so a slow frame cannot spiral. */
export const MAX_TICKS_PER_FRAME = 5;

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * TICK_HZ));
}

export function ticksToSeconds(ticks: number): number {
  return ticks / TICK_HZ;
}

export class FixedStepClock {
  private accumulator = 0;
  private tickCount = 0;
  /** Frames whose catch-up work was dropped, for the dev overlay. */
  droppedTicks = 0;

  get tick(): number {
    return this.tickCount;
  }

  get seconds(): number {
    return this.tickCount * TICK_DT;
  }

  /** Fractional position between the previous and current tick, for interpolated rendering. */
  get alpha(): number {
    return this.accumulator / TICK_DT;
  }

  /** Feed a frame delta; returns how many fixed ticks should run now. */
  advance(frameDt: number): number {
    this.accumulator += clamp(frameDt, 0, MAX_FRAME_DT);
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps < MAX_TICKS_PER_FRAME) {
      this.accumulator -= TICK_DT;
      steps++;
    }
    if (this.accumulator >= TICK_DT) {
      const dropped = Math.floor(this.accumulator / TICK_DT);
      this.droppedTicks += dropped;
      this.accumulator = 0;
    }
    this.tickCount += steps;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.tickCount = 0;
    this.droppedTicks = 0;
  }
}
