/**
 * Audio graph.
 *
 * Structure is deliberate and worth keeping when real samples land in M2:
 *   source -> [bus gain] -> compressor -> destination
 * plus a music bus that the SFX bus can duck, which is what makes gunfire feel
 * like it owns the mix (docs/AUDIO_SPEC.md).
 */
export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
}

export interface Buses {
  context: AudioContext;
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  compressor: DynamicsCompressorNode;
  noiseBuffer: AudioBuffer;
}

export function createBuses(settings: AudioSettings): Buses | null {
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined' ? AudioContext : undefined;
  if (!Ctor) return null;

  const context = new Ctor();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14; // parity
  compressor.ratio.value = 5;

  const master = context.createGain();
  const sfx = context.createGain();
  const music = context.createGain();

  sfx.connect(master);
  music.connect(master);
  master.connect(compressor);
  compressor.connect(context.destination);

  const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const buses: Buses = { context, master, sfx, music, compressor, noiseBuffer };
  applyAudioSettings(buses, settings);
  return buses;
}

export function applyAudioSettings(buses: Buses, settings: AudioSettings): void {
  buses.master.gain.value = settings.masterVolume;
  buses.sfx.gain.value = settings.sfxVolume;
  buses.music.gain.value = settings.musicVolume;
}

/** Ambient bed: filtered noise + slow LFO, ported from the prototype's SFX.init(). */
export function startAmbientBed(buses: Buses): void {
  const { context } = buses;
  const source = context.createBufferSource();
  source.buffer = buses.noiseBuffer;
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 280; // parity
  filter.Q.value = 0.5;

  const gain = context.createGain();
  gain.gain.value = 0.04;

  const lfo = context.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoGain = context.createGain();
  lfoGain.gain.value = 0.02;

  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(buses.sfx);
  source.start();
  lfo.start();
}
