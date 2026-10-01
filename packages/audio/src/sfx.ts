/**
 * Synthesised SFX library — the prototype's WebAudio design, kept as the
 * zero-asset baseline. `play(cue)` is the single entry point, so replacing a cue
 * with a real recording in M2 is a table edit plus a sample loader, not a
 * call-site change.
 */
import type { Vec3 } from '@iron/core';
import type { Buses } from './bus';
import { distanceGain, panFor, type Listener } from './spatial';

interface BurstOptions {
  f0: number;
  f1: number;
  dur: number;
  vol: number;
  type?: BiquadFilterType;
  q?: number;
  at?: number;
}

interface ToneOptions {
  f0: number;
  f1: number;
  dur: number;
  vol: number;
  wave?: OscillatorType;
  at?: number;
}

export interface CueRequest {
  cue: string;
  pos?: Vec3;
  volume?: number;
  listener: Listener;
}

const SURFACE_IMPACTS: Record<string, { f0: number; f1: number; vol: number; type: BiquadFilterType }> = {
  concrete: { f0: 1800, f1: 300, vol: 0.22, type: 'lowpass' },
  metal: { f0: 3200, f1: 900, vol: 0.2, type: 'bandpass' },
  wood: { f0: 1100, f1: 220, vol: 0.2, type: 'lowpass' },
  sand: { f0: 700, f1: 160, vol: 0.2, type: 'lowpass' },
  glass: { f0: 4200, f1: 1800, vol: 0.18, type: 'highpass' },
  dirt: { f0: 600, f1: 140, vol: 0.18, type: 'lowpass' },
  flesh: { f0: 900, f1: 200, vol: 0.24, type: 'lowpass' },
};

export class SoundLibrary {
  constructor(private readonly buses: Buses) {}

  private out(node: AudioNode, pan: number): void {
    const { context } = this.buses;
    if (typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      node.connect(panner);
      panner.connect(this.buses.sfx);
    } else {
      node.connect(this.buses.sfx);
    }
  }

  private burst(options: BurstOptions, pan: number, gainScale = 1): void {
    const { context } = this.buses;
    const start = context.currentTime + (options.at ?? 0);
    const source = context.createBufferSource();
    source.buffer = this.buses.noiseBuffer;

    const filter = context.createBiquadFilter();
    filter.type = options.type ?? 'lowpass';
    filter.frequency.setValueAtTime(options.f0 * (0.94 + Math.random() * 0.12), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, options.f1), start + options.dur);
    if (options.q) filter.Q.value = options.q;

    const gain = context.createGain();
    gain.gain.setValueAtTime(options.vol * gainScale, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + options.dur);

    source.connect(filter);
    filter.connect(gain);
    this.out(gain, pan);
    source.start(start);
    source.stop(start + options.dur + 0.05);
  }

  private tone(options: ToneOptions, pan: number, gainScale = 1): void {
    const { context } = this.buses;
    const start = context.currentTime + (options.at ?? 0);
    const osc = context.createOscillator();
    osc.type = options.wave ?? 'sine';
    osc.frequency.setValueAtTime(options.f0, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.f1), start + options.dur);

    const gain = context.createGain();
    gain.gain.setValueAtTime(options.vol * gainScale, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + options.dur);

    osc.connect(gain);
    this.out(gain, pan);
    osc.start(start);
    osc.stop(start + options.dur + 0.05);
  }

  /** Play a cue, resolving position, pan and distance volume. */
  play(request: CueRequest): void {
    const { cue, listener } = request;
    const pan = request.pos ? panFor(request.pos, listener) : 0;
    const distanceScale = request.pos ? distanceGain(request.pos, listener) : 1;
    const scale = (request.volume ?? 1) * distanceScale;

    if (cue.startsWith('impact_')) {
      const surface = SURFACE_IMPACTS[cue.slice('impact_'.length)] ?? SURFACE_IMPACTS.concrete!;
      this.burst({ f0: surface.f0, f1: surface.f1, dur: 0.09, vol: surface.vol, type: surface.type, q: 2 }, pan, scale);
      return;
    }

    switch (cue) {
      case 'wpn_pistol_fire': {
        // A .50 AE pistol is a *deeper*, shorter crack than a rifle: the case is
        // small and the bore is enormous, so it is all low end and pressure.
        this.burst({ f0: 1900, f1: 120, dur: 0.12, vol: 0.34 }, pan, scale);
        this.burst({ type: 'highpass', f0: 2400, f1: 3000, dur: 0.05, vol: 0.18 }, pan, scale);
        this.tone({ wave: 'square', f0: 118, f1: 44, dur: 0.08, vol: 0.24 }, pan, scale);
        return;
      }
      case 'wpn_equip': {
        // Sling hardware and cloth: the weapon coming up to the eye.
        this.burst({ type: 'highpass', f0: 600, f1: 900, dur: 0.09, vol: 0.1 }, pan, scale);
        this.burst({ f0: 900, f1: 300, dur: 0.07, vol: 0.08 }, pan, scale);
        return;
      }
      case 'wpn_rifle_fire':
      case 'wpn_rifle_heavy_fire':
      case 'wpn_smg_fire': {
        const heavy = cue === 'wpn_rifle_heavy_fire';
        const light = cue === 'wpn_smg_fire';
        this.burst({ f0: heavy ? 2400 : 2700, f1: heavy ? 140 : 170, dur: light ? 0.1 : 0.13, vol: 0.3 }, pan, scale);
        this.burst({ type: 'highpass', f0: 2800, f1: 3200, dur: 0.04, vol: 0.16 }, pan, scale);
        this.tone({ wave: 'square', f0: heavy ? 130 : 150, f1: 52, dur: 0.07, vol: 0.2 }, pan, scale);
        return;
      }
      case 'wpn_enemy_fire':
      case 'wpn_heavy_fire':
        this.burst({ f0: 1100, f1: 130, dur: 0.16, vol: 0.4 }, pan, scale);
        this.tone({ wave: 'square', f0: 105, f1: 48, dur: 0.09, vol: 0.2 }, pan, scale);
        return;
      case 'wpn_rifle_dry':
      case 'wpn_smg_dry':
      case 'wpn_pistol_dry':
      case 'grenade_bounce':
      case 'ui_click':
        this.burst({ type: 'highpass', f0: 1500, f1: 2000, dur: 0.03, vol: 0.12 }, pan, scale);
        return;
      case 'wpn_rifle_reload_01':
      case 'wpn_smg_reload_01':
      case 'wpn_pistol_reload_01':
        this.reloadCue(0, pan, scale);
        return;
      case 'wpn_rifle_reload_02':
      case 'wpn_smg_reload_02':
      case 'wpn_pistol_reload_02':
        this.reloadCue(1, pan, scale);
        return;
      case 'wpn_rifle_reload_03':
      case 'wpn_smg_reload_03':
      case 'wpn_pistol_reload_03':
        this.reloadCue(2, pan, scale);
        return;
      case 'bullet_whiz':
        this.burst({ type: 'bandpass', f0: 2600, f1: 700, dur: 0.12, vol: 0.07, q: 6 }, pan, scale);
        return;
      case 'enemy_aim':
        this.tone({ wave: 'sawtooth', f0: 300, f1: 240, dur: 0.12, vol: 0.05 }, pan, scale);
        return;
      case 'enemy_radio':
        this.tone({ wave: 'square', f0: 1180, f1: 940, dur: 0.07, vol: 0.06 }, pan, scale);
        this.tone({ wave: 'square', f0: 1400, f1: 1200, dur: 0.06, vol: 0.05, at: 0.09 }, pan, scale);
        return;
      case 'voice_enemy_hurt':
        this.grunt(pan, scale);
        return;
      case 'voice_enemy_death':
        this.scream(pan, scale);
        return;
      case 'voice_enemy_alert':
      case 'voice_heavy_alert':
        this.tone({ wave: 'sawtooth', f0: 200, f1: 120, dur: 0.25, vol: 0.12 }, pan, scale);
        return;
      case 'voice_rusher_scream':
        this.scream(pan, scale * 1.2);
        return;
      case 'melee_lunge':
      case 'melee_swish':
        this.burst({ type: 'bandpass', f0: 900, f1: 300, dur: 0.18, vol: 0.2, q: 2 }, pan, scale);
        return;
      case 'grenade_pin':
        this.burst({ type: 'highpass', f0: 2000, f1: 2600, dur: 0.04, vol: 0.15 }, pan, scale);
        return;
      case 'explosion':
        this.burst({ f0: 900, f1: 45, dur: 0.9, vol: 0.75 }, pan, scale);
        this.tone({ f0: 95, f1: 26, dur: 0.8, vol: 0.5 }, pan, scale);
        return;
      case 'player_hurt':
        this.tone({ f0: 120, f1: 45, dur: 0.25, vol: 0.3 }, 0, scale);
        this.burst({ f0: 600, f1: 120, dur: 0.2, vol: 0.2 }, 0, scale);
        return;
      case 'player_death':
        this.tone({ f0: 90, f1: 30, dur: 1.2, vol: 0.35 }, 0, scale);
        return;
      case 'player_heartbeat':
        this.tone({ f0: 60, f1: 40, dur: 0.1, vol: 0.35 }, 0, 1);
        this.tone({ f0: 55, f1: 38, dur: 0.1, vol: 0.3, at: 0.18 }, 0, 1);
        return;
      case 'hit_confirm':
        this.tone({ wave: 'triangle', f0: 1150, f1: 880, dur: 0.05, vol: 0.16 }, 0, 1);
        return;
      case 'hit_kill':
        this.tone({ wave: 'triangle', f0: 190, f1: 70, dur: 0.16, vol: 0.3 }, 0, 1);
        return;
      case 'pickup_collect':
        this.tone({ wave: 'triangle', f0: 620, f1: 940, dur: 0.12, vol: 0.2 }, 0, scale);
        return;
      case 'pickup_drop':
        this.burst({ type: 'bandpass', f0: 500, f1: 320, dur: 0.08, vol: 0.1, q: 3 }, pan, scale);
        return;
      case 'step_left':
        this.burst({ f0: 340, f1: 120, dur: 0.05, vol: 0.05 }, pan, scale);
        return;
      case 'step_right':
        this.burst({ f0: 280, f1: 120, dur: 0.05, vol: 0.05 }, pan, scale);
        return;
      case 'ui_hover':
        this.tone({ wave: 'square', f0: 700, f1: 760, dur: 0.03, vol: 0.05 }, 0, 1);
        return;
      case 'ui_confirm':
        this.tone({ wave: 'triangle', f0: 520, f1: 820, dur: 0.14, vol: 0.18 }, 0, 1);
        return;
      case 'stinger_victory':
        this.tone({ wave: 'triangle', f0: 330, f1: 660, dur: 0.8, vol: 0.2 }, 0, 1);
        this.tone({ wave: 'sine', f0: 220, f1: 440, dur: 1.0, vol: 0.16, at: 0.1 }, 0, 1);
        return;
      case 'stinger_failure':
        this.tone({ wave: 'sawtooth', f0: 220, f1: 80, dur: 1.2, vol: 0.2 }, 0, 1);
        return;
      case 'ambient_rumble':
        this.tone({ f0: 55, f1: 24, dur: 2.4, vol: 0.1 }, 0, 1);
        return;
      default:
        return;
    }
  }

  private reloadCue(index: number, pan: number, scale: number): void {
    const frequency = [700, 420, 900][index] ?? 500;
    this.burst({ type: 'bandpass', f0: frequency, f1: frequency * 0.6, dur: 0.06, vol: 0.22, q: 3 }, pan, scale);
    this.tone({ wave: 'square', f0: frequency * 1.4, f1: frequency, dur: 0.05, vol: 0.08 }, pan, scale);
  }

  private grunt(pan: number, scale: number): void {
    this.tone({ wave: 'sawtooth', f0: 160, f1: 90, dur: 0.12, vol: 0.14 }, pan, scale);
    this.burst({ f0: 500, f1: 200, dur: 0.1, vol: 0.1 }, pan, scale);
  }

  private scream(pan: number, scale: number): void {
    this.tone({ wave: 'sawtooth', f0: 420, f1: 220, dur: 0.3, vol: 0.14 }, pan, scale);
  }
}
