/**
 * Commands are the sole input path into the simulation (ADR-0002).
 * Recording a command log is therefore enough to replay a whole mission, which
 * is what golden tests, the headless harness and (later) Theater mode all use.
 */
export type Command =
  | { type: 'move'; forward: number; right: number }
  | { type: 'look'; dyaw: number; dpitch: number }
  | { type: 'fire'; held: boolean }
  | { type: 'aim'; held: boolean }
  | { type: 'sprint'; held: boolean }
  /**
   * Stance. `sprint` is held-state in the same way: the queue carries the *current*
   * key state each frame, so a dropped key can never leave the player crouched.
   */
  | { type: 'crouch'; held: boolean }
  | {
      type: 'action';
      /**
       * `weapon1`..`weapon3` select a loadout slot. They are actions rather than a
       * command of their own so a swap is queued, recorded and replayed exactly like
       * a reload — which is what makes "I switched to the pistol and killed him with
       * it" reproducible from a command log.
       */
      action: 'reload' | 'grenade' | 'jump' | 'interact' | 'weapon1' | 'weapon2' | 'weapon3';
    };

export interface TimedCommand {
  tick: number;
  command: Command;
}

/** Buffered input state the simulation reads each tick. */
export interface InputState {
  forward: number;
  right: number;
  dYaw: number;
  dPitch: number;
  firing: boolean;
  aiming: boolean;
  sprinting: boolean;
  crouching: boolean;
}

export function createInputState(): InputState {
  return {
    forward: 0,
    right: 0,
    dYaw: 0,
    dPitch: 0,
    firing: false,
    aiming: false,
    sprinting: false,
    crouching: false,
  };
}

/**
 * Accumulates commands for the upcoming tick. `look` values are summed so a
 * fast mouse flick within one tick is not thrown away.
 */
export class CommandQueue {
  private state = createInputState();
  private actions: Extract<Command, { type: 'action' }>['action'][] = [];
  private log: TimedCommand[] = [];
  private recording = false;

  startRecording(): void {
    this.recording = true;
    this.log = [];
  }

  stopRecording(): TimedCommand[] {
    this.recording = false;
    return this.log;
  }

  get recorded(): readonly TimedCommand[] {
    return this.log;
  }

  /** External (AI bot, replay, network) command injection. */
  push(tick: number, command: Command): void {
    this.apply(command);
    if (this.recording) this.log.push({ tick, command });
  }

  private apply(command: Command): void {
    switch (command.type) {
      case 'move':
        this.state.forward = command.forward;
        this.state.right = command.right;
        break;
      case 'look':
        this.state.dYaw += command.dyaw;
        this.state.dPitch += command.dpitch;
        break;
      case 'fire':
        this.state.firing = command.held;
        break;
      case 'aim':
        this.state.aiming = command.held;
        break;
      case 'crouch':
        this.state.crouching = command.held;
        break;
      case 'sprint':
        this.state.sprinting = command.held;
        break;
      case 'action':
        this.actions.push(command.action);
        break;
    }
  }

  /** Read the buffered input for this tick; look deltas are consumed. */
  drain(): { input: InputState; actions: readonly string[] } {
    const input: InputState = {
      forward: this.state.forward,
      right: this.state.right,
      dYaw: this.state.dYaw,
      dPitch: this.state.dPitch,
      firing: this.state.firing,
      aiming: this.state.aiming,
      sprinting: this.state.sprinting,
      crouching: this.state.crouching,
    };
    this.state.dYaw = 0;
    this.state.dPitch = 0;
    const actions = this.actions;
    this.actions = [];
    return { input, actions };
  }
}
