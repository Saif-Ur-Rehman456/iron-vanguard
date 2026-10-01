/**
 * Input layer.
 *
 * Everything funnels into `CommandQueue`, which is the only route into the
 * simulation. Look deltas are scaled by sensitivity *here* so a recorded command
 * log replays identically regardless of the player's settings.
 */
import type { CommandQueue } from '@iron/sim';
import type { StoredSettings } from '@iron/sim';

const BASE_SENSITIVITY = 0.0022; // parity: CFG.sens

export interface InputDeps {
  queue: CommandQueue;
  getSettings: () => StoredSettings;
  isActive: () => boolean;
  shouldUsePointerLock: () => boolean;
  onEscape: () => void;
  canvas: HTMLElement;
}

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly deps: InputDeps;
  private disposers: (() => void)[] = [];

  constructor(deps: InputDeps) {
    this.deps = deps;
  }

  attach(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      this.keys.add(event.code);
      if (event.code === 'Escape') {
        this.deps.onEscape();
        return;
      }
      if (!this.deps.isActive()) return;
      if (event.code === 'KeyR') this.deps.queue.push(0, { type: 'action', action: 'reload' });
      if (event.code === 'KeyG') this.deps.queue.push(0, { type: 'action', action: 'grenade' });
      // Jump is an *action*; crouch is held-state, pushed with the movement each
      // frame in `pumpMovement` (so a lost keyup cannot leave the player crouched).
      if (event.code === 'Space') this.deps.queue.push(0, { type: 'action', action: 'jump' });
      // The loadout: 1 = Desert Eagle, 2 = the M4, 3 = the AK-47. Digit keys (and not
      // `KeyCode`), because that is what a keyboard sends for the number row, and the
      // *command* rather than a direct call: a weapon swap has to be part of the tick
      // log or a replay cannot reproduce it (ADR-0002).
      if (event.code === 'Digit1') this.deps.queue.push(0, { type: 'action', action: 'weapon1' });
      if (event.code === 'Digit2') this.deps.queue.push(0, { type: 'action', action: 'weapon2' });
      if (event.code === 'Digit3') this.deps.queue.push(0, { type: 'action', action: 'weapon3' });
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      this.keys.delete(event.code);
    };

    const onMouseDown = (event: MouseEvent): void => {
      if (!this.deps.isActive()) return;
      if (event.button === 0) this.deps.queue.push(0, { type: 'fire', held: true });
      if (event.button === 2) this.deps.queue.push(0, { type: 'aim', held: true });
      event.preventDefault();
    };

    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 0) this.deps.queue.push(0, { type: 'fire', held: false });
      if (event.button === 2) this.deps.queue.push(0, { type: 'aim', held: false });
    };

    const onMouseMove = (event: MouseEvent): void => {
      if (!this.deps.isActive()) return;
      const locked = document.pointerLockElement === this.deps.canvas;
      if (!locked && !this.deps.shouldUsePointerLock()) return;
      const settings = this.deps.getSettings();
      const scale = BASE_SENSITIVITY * settings.sensitivity * (settings.invertY ? -1 : 1);
      this.deps.queue.push(0, {
        type: 'look',
        dyaw: -(event.movementX || 0) * scale,
        dpitch: -(event.movementY || 0) * scale,
      });
    };

    const onContextMenu = (event: Event): void => event.preventDefault();
    const onBlur = (): void => this.keys.clear();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', onBlur);

    this.disposers = [
      () => document.removeEventListener('keydown', onKeyDown),
      () => document.removeEventListener('keyup', onKeyUp),
      () => document.removeEventListener('mousedown', onMouseDown),
      () => document.removeEventListener('mouseup', onMouseUp),
      () => document.removeEventListener('mousemove', onMouseMove),
      () => document.removeEventListener('contextmenu', onContextMenu),
      () => window.removeEventListener('blur', onBlur),
    ];
  }

  /** Push the current movement/sprint state for this frame into the queue. */
  pumpMovement(): void {
    if (!this.deps.isActive()) return;
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const right = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    // C only: Ctrl is a browser modifier (Ctrl+W closes the tab), and a game that
    // claims it can lose the player's window.
    const crouch = this.keys.has('KeyC');
    this.deps.queue.push(0, { type: 'move', forward, right });
    this.deps.queue.push(0, { type: 'sprint', held: sprint });
    this.deps.queue.push(0, { type: 'crouch', held: crouch });
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.keys.clear();
  }
}
