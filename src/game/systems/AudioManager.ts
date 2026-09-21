import { AUDIO } from '../config';
import { randRange } from '../utils/math';

interface ToneOptions {
  type: OscillatorType;
  freq: number;
  /** Optional pitch glide target. */
  freqEnd?: number;
  /** Duration of the pitch glide (defaults to the decay time). */
  glide?: number;
  attack: number;
  decay: number;
  gain: number;
  delay?: number;
  lowpass?: number;
  highpass?: number;
}

interface NoiseOptions {
  duration: number;
  gain: number;
  delay?: number;
  lowpass?: number;
  highpass?: number;
  bandpass?: number;
  q?: number;
}

type RateKey = 'wall' | 'paddle' | 'obstacle' | 'ui' | 'misc';

type AudioContextCtor = typeof AudioContext;

/**
 * Procedural sound effects on the Web Audio API.
 *
 * The AudioContext is only created inside a real user gesture (autoplay policy),
 * every voice goes through a master gain and a gentle compressor, and a voice cap
 * plus per-category rate limits keep busy moments from turning harsh.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = 0;
  private hidden = false;
  private readonly lastPlayed: Record<RateKey, number> = { wall: 0, paddle: 0, obstacle: 0, ui: 0, misc: 0 };
  private readonly unlockEvents = ['pointerdown', 'touchend', 'mousedown', 'keydown'] as const;

  constructor(private muted: boolean) {}

  get isMuted(): boolean {
    return this.muted;
  }

  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Listen for the first valid user interaction, then create/resume the AudioContext. */
  attachUnlock(): void {
    for (const ev of this.unlockEvents) window.addEventListener(ev, this.handleGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  private readonly handleGesture = (): void => {
    // Only touch the AudioContext inside an activation-granting gesture (touchend / click / key),
    // otherwise browsers log autoplay warnings and keep it suspended.
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) return;
    this.unlock();
    if (this.isUnlocked) {
      for (const ev of this.unlockEvents) window.removeEventListener(ev, this.handleGesture, { capture: true });
    }
  };

  private readonly handleVisibility = (): void => {
    this.setHidden(document.visibilityState === 'hidden');
  };

  private unlock(): void {
    if (this.hidden) return;
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      compressor.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO.masterVolume;
      this.master.connect(compressor);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, t, 0.03);
    }
  }

  /** Suspend audio while the tab is hidden, resume safely when it comes back. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) {
      this.ctx.suspend().catch(() => undefined);
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private canPlay(key: RateKey, minIntervalMs: number): boolean {
    if (this.muted || this.hidden || !this.ctx || !this.master || this.ctx.state !== 'running') return false;
    if (this.voices >= AUDIO.maxVoices) return false;
    const now = performance.now();
    if (now - this.lastPlayed[key] < minIntervalMs) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  private tone(o: ToneOptions): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + (o.glide ?? o.decay));
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + o.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.attack + o.decay);

    let node: AudioNode = osc;
    const filters: BiquadFilterNode[] = [];
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      node.connect(f);
      node = f;
      filters.push(f);
    }
    if (o.highpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = o.highpass;
      node.connect(f);
      node = f;
      filters.push(f);
    }
    node.connect(gain);
    gain.connect(out);

    this.voices++;
    osc.onended = () => {
      this.voices--;
      osc.disconnect();
      for (const f of filters) f.disconnect();
      gain.disconnect();
    };
    osc.start(t0);
    osc.stop(t0 + o.attack + o.decay + 0.03);
  }

  private noise(o: NoiseOptions): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    if (o.bandpass) {
      filter.type = 'bandpass';
      filter.frequency.value = o.bandpass;
      filter.Q.value = o.q ?? 1;
    } else if (o.highpass) {
      filter.type = 'highpass';
      filter.frequency.value = o.highpass;
    } else {
      filter.type = 'lowpass';
      filter.frequency.value = o.lowpass ?? 3000;
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + o.duration + 0.02);
  }

  private jitter(amount = 0.035): number {
    return 1 + randRange(-amount, amount);
  }

  // ---------------------------------------------------------------- effects

  /** Soft muted tick for unprotected wall bounces. */
  wall(): void {
    if (!this.canPlay('wall', AUDIO.minIntervalMs.wall)) return;
    this.tone({ type: 'triangle', freq: 520 * this.jitter(0.08), freqEnd: 300, attack: 0.002, decay: 0.05, gain: 0.05, lowpass: 1400 });
  }

  /** Clear tonal pop; pitch rises with ball level and combo, higher levels get richer layers. */
  paddle(level: number, combo: number): void {
    if (!this.canPlay('paddle', AUDIO.minIntervalMs.paddle)) return;
    const semis = Math.min(level - 1, 11) * 2 + (combo - 1) * 5;
    const base = 392 * Math.pow(2, semis / 12) * this.jitter();
    this.tone({ type: 'sine', freq: base * 1.6, freqEnd: base, glide: 0.03, attack: 0.003, decay: 0.16, gain: 0.2 });
    this.tone({ type: 'triangle', freq: base * 2, attack: 0.002, decay: 0.07, gain: 0.05, lowpass: 5000 });
    if (level >= 3) {
      // Richer layered pop: a fifth above plus a soft sub thump.
      this.tone({ type: 'sine', freq: base * 1.5, attack: 0.004, decay: 0.2, gain: 0.07 + Math.min(level, 8) * 0.008 });
      this.tone({ type: 'sine', freq: 140, freqEnd: 60, attack: 0.003, decay: 0.12, gain: 0.08 + Math.min(level, 8) * 0.01 });
    }
    if (level >= 6) {
      this.tone({ type: 'sine', freq: base * 3, attack: 0.002, decay: 0.12, gain: 0.03, delay: 0.015 });
    }
  }

  /** Obstacle impact. The diamond is deliberately lower pitched. */
  obstacle(kind: 'diamond' | 'bumper' | 'bar'): void {
    if (!this.canPlay('obstacle', AUDIO.minIntervalMs.obstacle)) return;
    if (kind === 'diamond') {
      this.tone({ type: 'sine', freq: 170 * this.jitter(), freqEnd: 110, attack: 0.003, decay: 0.2, gain: 0.2 });
      this.tone({ type: 'triangle', freq: 340 * this.jitter(), attack: 0.002, decay: 0.08, gain: 0.05, lowpass: 900 });
    } else if (kind === 'bumper') {
      this.tone({ type: 'sine', freq: 300 * this.jitter(), freqEnd: 420, glide: 0.06, attack: 0.003, decay: 0.16, gain: 0.13 });
      this.noise({ duration: 0.03, gain: 0.03, bandpass: 2500, q: 2 });
    } else {
      this.tone({ type: 'triangle', freq: 260 * this.jitter(), freqEnd: 200, attack: 0.002, decay: 0.09, gain: 0.1, lowpass: 1800 });
      this.noise({ duration: 0.025, gain: 0.03, highpass: 3000 });
    }
  }

  /** Bubble pop for Add Ball / new ball spawn. */
  addBall(): void {
    if (!this.canPlay('misc', 20)) return;
    this.tone({ type: 'sine', freq: 320, freqEnd: 900, glide: 0.09, attack: 0.005, decay: 0.12, gain: 0.2 });
    this.tone({ type: 'sine', freq: 520, freqEnd: 1300, glide: 0.07, attack: 0.004, decay: 0.1, gain: 0.12, delay: 0.07 });
  }

  /** Mechanical build click and thump for Add Paddle. */
  addPaddle(): void {
    if (!this.canPlay('misc', 20)) return;
    this.noise({ duration: 0.025, gain: 0.12, highpass: 2500 });
    this.tone({ type: 'square', freq: 1400, attack: 0.001, decay: 0.02, gain: 0.03, lowpass: 3000 });
    this.tone({ type: 'sine', freq: 150, freqEnd: 55, attack: 0.004, decay: 0.2, gain: 0.3, delay: 0.06 });
    this.noise({ duration: 0.04, gain: 0.08, bandpass: 1800, q: 3, delay: 0.14 });
  }

  /** Rising sweep and sparkle that plays while two balls are pulled together. */
  mergeRise(): void {
    if (!this.canPlay('misc', 20)) return;
    this.tone({ type: 'sawtooth', freq: 180, freqEnd: 900, glide: 0.55, attack: 0.08, decay: 0.5, gain: 0.05, lowpass: 2200 });
    this.tone({ type: 'sine', freq: 360, freqEnd: 1450, glide: 0.55, attack: 0.05, decay: 0.55, gain: 0.07 });
    const sparkle = [1568, 2093, 2637, 3136];
    sparkle.forEach((f, i) => {
      this.tone({ type: 'sine', freq: f * this.jitter(0.01), attack: 0.003, decay: 0.12, gain: 0.035, delay: 0.25 + i * 0.07 });
    });
  }

  /** Bright chime and soft bass pop at the moment of combination. */
  mergePop(newLevel: number): void {
    if (!this.canPlay('misc', 0)) return;
    const root = 523 * Math.pow(2, (Math.min(newLevel, 10) - 2) / 12);
    this.tone({ type: 'sine', freq: 120, freqEnd: 42, attack: 0.004, decay: 0.3, gain: 0.34 });
    this.tone({ type: 'triangle', freq: root, attack: 0.004, decay: 0.3, gain: 0.12 });
    this.tone({ type: 'sine', freq: root * 1.5, attack: 0.004, decay: 0.35, gain: 0.08, delay: 0.04 });
    this.tone({ type: 'sine', freq: root * 2, attack: 0.004, decay: 0.4, gain: 0.06, delay: 0.08 });
    this.noise({ duration: 0.12, gain: 0.05, bandpass: 5000, q: 1.2 });
  }

  /**
   * One pop in a multi-pair merge wave: each successive pop climbs a pentatonic
   * scale, so a big merge plays as a bright rising run.
   */
  mergeCascade(index: number, newLevel: number): void {
    if (!this.canPlay('misc', 0)) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
    const semis = scale[Math.min(index, scale.length - 1)] + Math.min(newLevel - 2, 8);
    const f = 523.25 * Math.pow(2, semis / 12);
    this.tone({ type: 'sine', freq: f * 1.25, freqEnd: f, glide: 0.025, attack: 0.003, decay: 0.2, gain: 0.13 });
    this.tone({ type: 'triangle', freq: f * 2, attack: 0.002, decay: 0.08, gain: 0.035 });
    if (index === 0) this.tone({ type: 'sine', freq: 120, freqEnd: 42, attack: 0.004, decay: 0.3, gain: 0.3 });
  }

  uiClick(): void {
    if (!this.canPlay('ui', AUDIO.minIntervalMs.ui)) return;
    this.tone({ type: 'sine', freq: 1250 * this.jitter(0.02), freqEnd: 900, attack: 0.002, decay: 0.045, gain: 0.08 });
  }

  /** Quick rising whoosh for tap-to-speed-up; pitch climbs with the boost level. */
  boost(multiplier: number): void {
    if (!this.canPlay('ui', 35)) return;
    const f = 420 * (1 + (multiplier - 1) * 0.55) * this.jitter(0.02);
    this.tone({ type: 'triangle', freq: f, freqEnd: f * 1.7, glide: 0.07, attack: 0.003, decay: 0.09, gain: 0.07 });
    this.noise({ duration: 0.14, gain: 0.045, bandpass: 900 + multiplier * 700, q: 0.7 });
  }

  /** Low, soft "nope" for unaffordable / unavailable actions. */
  error(): void {
    if (!this.canPlay('ui', 60)) return;
    this.tone({ type: 'triangle', freq: 200, freqEnd: 150, attack: 0.006, decay: 0.16, gain: 0.14, lowpass: 900 });
    this.tone({ type: 'triangle', freq: 150, freqEnd: 120, attack: 0.006, decay: 0.16, gain: 0.1, lowpass: 900, delay: 0.09 });
  }

  /** Short three-note success fanfare. */
  fanfare(): void {
    if (!this.canPlay('misc', 0)) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      this.tone({ type: 'triangle', freq: f, attack: 0.01, decay: last ? 0.7 : 0.2, gain: 0.16, delay: i * 0.13 });
      this.tone({ type: 'sine', freq: f * 2, attack: 0.01, decay: last ? 0.5 : 0.15, gain: 0.05, delay: i * 0.13 });
    });
    this.tone({ type: 'sine', freq: 130.8, attack: 0.02, decay: 0.8, gain: 0.14, delay: 0.26 });
  }
}
