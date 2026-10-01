/**
 * Pointer lock handling.
 *
 * parity: the prototype asked for a lock, fell back to unclamped mouse-look when
 * the API was unavailable, and paused when the lock was lost. It also had a
 * latent bug where a browser without `requestPointerLock` never re-entered
 * fallback mode correctly — that is fixed here, and the lock now requests
 * `unadjustedMovement` so raw input is not distorted by OS mouse acceleration.
 */
export type LockMode = 'lock' | 'fallback';

export interface PointerLockOptions {
  canvas: HTMLCanvasElement;
  onLockLost: () => void;
  onFallbackEntered: () => void;
}

interface LockOptionsWithRaw {
  unadjustedMovement?: boolean;
}

export class PointerLockController {
  mode: LockMode = 'lock';

  constructor(private readonly options: PointerLockOptions) {
    document.addEventListener('pointerlockchange', this.handleChange);
    document.addEventListener('pointerlockerror', this.handleError);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.options.canvas;
  }

  request(): void {
    const element = this.options.canvas as HTMLCanvasElement & {
      requestPointerLock?: (options?: LockOptionsWithRaw) => Promise<void> | void;
    };
    if (typeof element.requestPointerLock !== 'function') {
      this.enterFallback();
      return;
    }
    try {
      const result = element.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          // Retry without the raw-input hint, then fall back to free look.
          try {
            const retry = element.requestPointerLock!();
            if (retry && typeof (retry as Promise<void>).catch === 'function') {
              (retry as Promise<void>).catch(() => this.enterFallback());
            }
          } catch {
            this.enterFallback();
          }
        });
      }
    } catch {
      this.enterFallback();
    }
    window.setTimeout(() => {
      if (!this.locked && this.mode === 'lock') this.enterFallback();
    }, 600);
  }

  exit(): void {
    try {
      document.exitPointerLock();
    } catch {
      // Nothing to do — some browsers throw when no lock is held.
    }
  }

  enterFallback(): void {
    if (this.mode === 'fallback') return;
    this.mode = 'fallback';
    this.options.onFallbackEntered();
  }

  private handleChange = (): void => {
    if (this.locked) {
      this.mode = 'lock';
      return;
    }
    if (this.mode === 'lock') this.options.onLockLost();
  };

  private handleError = (): void => {
    this.enterFallback();
  };

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.handleChange);
    document.removeEventListener('pointerlockerror', this.handleError);
  }
}
