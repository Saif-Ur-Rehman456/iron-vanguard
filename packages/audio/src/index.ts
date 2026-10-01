/**
 * Audio facade. The game app owns lifecycle (init on first gesture, settings),
 * the simulation owns the cue list — this package just turns cues into sound.
 */
import type { Vec3 } from '@iron/core';
import { applyAudioSettings, createBuses, startAmbientBed, type AudioSettings, type Buses } from './bus';
import { SoundLibrary } from './sfx';
import type { Listener } from './spatial';

export * from './bus';
export * from './sfx';
export * from './spatial';

export class AudioSystem {
  private buses: Buses | null = null;
  private library: SoundLibrary | null = null;
  private ambientStarted = false;
  private queued: { cue: string; pos?: Vec3; volume?: number }[] = [];

  get ready(): boolean {
    return this.buses !== null;
  }

  get contextState(): string {
    return this.buses?.context.state ?? 'closed';
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  init(settings: AudioSettings): void {
    if (this.buses) {
      void this.buses.context.resume();
      return;
    }
    const buses = createBuses(settings);
    if (!buses) return;
    this.buses = buses;
    this.library = new SoundLibrary(buses);
    if (!this.ambientStarted) {
      startAmbientBed(buses);
      this.ambientStarted = true;
    }
    for (const request of this.queued) this.play(request.cue, request.pos, request.volume);
    this.queued.length = 0;
  }

  applySettings(settings: AudioSettings): void {
    if (this.buses) applyAudioSettings(this.buses, settings);
  }

  /** Play a simulation cue. Cues before `init` are queued, not dropped. */
  play(cue: string, pos?: Vec3, volume?: number, listener: Listener = { x: 0, z: 0, yaw: 0 }): void {
    if (!this.library) {
      if (this.queued.length < 64) this.queued.push({ cue, pos, volume });
      return;
    }
    this.library.play({ cue, pos, volume, listener });
  }

  /** Per-frame housekeeping (music ducking lands in M2 with real stems). */
  update(_dt: number): void {}

  dispose(): void {
    void this.buses?.context.close();
    this.buses = null;
    this.library = null;
  }
}
