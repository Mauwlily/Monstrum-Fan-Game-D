import { AcousticContext, FloorMaterial } from './types';

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function safeFreq(val: number, fallback = 440): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(20, Math.min(20000, val));
}

function safeGain(val: number): number {
  if (!Number.isFinite(val)) return 0.0001;
  return Math.max(0.0001, Math.min(1.5, val));
}

export class HorrorAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbSendGain: GainNode | null = null;

  // Continuous industrial ambient & dynamic layers
  private hullSubGain: GainNode | null = null;
  private hullSubFilter: BiquadFilterNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private turbineSource: AudioBufferSourceNode | null = null;
  private turbineGain: GainNode | null = null;

  // Dynamic Stalk / Chase stem layers
  private tensionGain: GainNode | null = null;
  private tensionFilter: BiquadFilterNode | null = null;
  private tensionOsc1: OscillatorNode | null = null;
  private tensionOsc2: OscillatorNode | null = null;
  private chaseOsc: OscillatorNode | null = null;
  private chaseFilter: BiquadFilterNode | null = null;
  private chaseBedGain: GainNode | null = null;

  // Environmental proximity loops (fluorescent ballast hum, steam vents, flares)
  private lightHumOsc1: OscillatorNode | null = null;
  private lightHumOsc2: OscillatorNode | null = null;
  private lightHumFilter: BiquadFilterNode | null = null;
  private lightHumGain: GainNode | null = null;

  private steamLoopSource: AudioBufferSourceNode | null = null;
  private steamFilter: BiquadFilterNode | null = null;
  private steamGain: GainNode | null = null;

  private flareLoopSource: AudioBufferSourceNode | null = null;
  private flareFilter: BiquadFilterNode | null = null;
  private flareGain: GainNode | null = null;

  // Reusable noise buffers
  private shortWhiteNoise: AudioBuffer | null = null;
  private longBrownNoise: AudioBuffer | null = null;

  private muted = false;
  private heartbeatTimer = 0;
  private breathTimer = 0.2;
  private creakTimer = 6.5;
  private pipePingTimer = 4.2;
  private chasePulseTimer = 0;
  private chaseBeatStep = 0;
  private sputterCooldown = 0;
  private lastSputterLevel = 0;

  public init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.76;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // Build synthetic metallic ship-hull convolution reverb bus
    this.setupReverbBus();
    this.shortWhiteNoise = this.createWhiteNoiseBuffer(0.75);
    this.longBrownNoise = this.createBrownNoiseBuffer(3.0);

    this.startIndustrialSoundscape();
    this.startThreatStems();
    this.startProximityLoops();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.76, this.ctx.currentTime, 0.05);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private setupReverbBus(): void {
    if (!this.ctx || !this.masterGain) return;
    const sampleRate = this.ctx.sampleRate;
    const duration = 1.25;
    const len = Math.floor(sampleRate * duration);
    const ir = this.ctx.createBuffer(2, len, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        const decay = Math.exp(-t * 3.4);
        // Subtle metallic corridor slap-back reflections
        const early =
          Math.abs(t - 0.022) < 0.002 ||
          Math.abs(t - 0.051) < 0.002 ||
          Math.abs(t - 0.088) < 0.002
            ? 1.5
            : 0.75;
        data[i] = (Math.random() * 2 - 1) * decay * early * 0.35;
      }
    }

    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = ir;

    const wetFilter = this.ctx.createBiquadFilter();
    wetFilter.type = 'lowpass';
    wetFilter.frequency.value = 1850;

    this.reverbSendGain = this.ctx.createGain();
    this.reverbSendGain.gain.value = 0.26;

    this.reverbSendGain.connect(this.reverbNode);
    this.reverbNode.connect(wetFilter);
    wetFilter.connect(this.masterGain);
  }

  private createWhiteNoiseBuffer(durationSec: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createBrownNoiseBuffer(durationSec: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.028 * white) / 1.028;
      data[i] = clamp(last * 3.1, -1, 1);
    }
    return buffer;
  }

  private computeOcclusionParams(
    occlusion01: number,
    muffled = false
  ): { lowpassHz: number; gainMult: number; reverbWet: number } {
    const eff = clamp(Math.max(occlusion01, muffled ? 0.55 : 0), 0, 1);
    const lowpassHz = safeFreq(13500 * Math.pow(310 / 13500, eff), 1000);
    const gainMult = clamp(1 - eff * 0.64, 0.28, 1);
    const reverbWet = clamp(0.18 + eff * 0.28, 0.15, 0.52);
    return { lowpassHz, gainMult, reverbWet };
  }

  private routeSpatialNode(
    sourceGain: AudioNode,
    dx: number,
    occlusion01: number,
    muffled: boolean
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const { lowpassHz, reverbWet } = this.computeOcclusionParams(occlusion01, muffled);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;

    const pan = this.ctx.createStereoPanner();
    pan.pan.value = clamp(dx / 440, -0.92, 0.92);

    sourceGain.connect(filter);
    filter.connect(pan);
    pan.connect(this.masterGain);

    if (this.reverbSendGain) {
      const send = this.ctx.createGain();
      send.gain.value = reverbWet;
      pan.connect(send);
      send.connect(this.reverbSendGain);
    }
  }

  private startIndustrialSoundscape(): void {
    if (!this.ctx || !this.masterGain) return;

    this.hullSubGain = this.ctx.createGain();
    this.hullSubGain.gain.value = 0.065;

    this.hullSubFilter = this.ctx.createBiquadFilter();
    this.hullSubFilter.type = 'lowpass';
    this.hullSubFilter.frequency.value = 115;

    this.droneOsc1 = this.ctx.createOscillator();
    this.droneOsc1.type = 'sawtooth';
    this.droneOsc1.frequency.value = 37.5;

    this.droneOsc2 = this.ctx.createOscillator();
    this.droneOsc2.type = 'triangle';
    this.droneOsc2.frequency.value = 56.25;

    this.droneOsc1.connect(this.hullSubFilter);
    this.droneOsc2.connect(this.hullSubFilter);
    this.hullSubFilter.connect(this.hullSubGain);
    this.hullSubGain.connect(this.masterGain);

    this.droneOsc1.start();
    this.droneOsc2.start();

    // Distant ship engine / ventilation turbine bed
    if (this.longBrownNoise) {
      this.turbineSource = this.ctx.createBufferSource();
      this.turbineSource.buffer = this.longBrownNoise;
      this.turbineSource.loop = true;

      const turbineBand = this.ctx.createBiquadFilter();
      turbineBand.type = 'bandpass';
      turbineBand.frequency.value = 128;
      turbineBand.Q.value = 0.8;

      this.turbineGain = this.ctx.createGain();
      this.turbineGain.gain.value = 0.08;

      this.turbineSource.connect(turbineBand);
      turbineBand.connect(this.turbineGain);
      this.turbineGain.connect(this.masterGain);
      this.turbineSource.start();
    }
  }

  private startThreatStems(): void {
    if (!this.ctx || !this.masterGain) return;

    // Eerie dissonant stalk/suspense pad
    this.tensionFilter = this.ctx.createBiquadFilter();
    this.tensionFilter.type = 'lowpass';
    this.tensionFilter.frequency.value = 260;

    this.tensionGain = this.ctx.createGain();
    this.tensionGain.gain.value = 0.0;

    this.tensionOsc1 = this.ctx.createOscillator();
    this.tensionOsc1.type = 'sawtooth';
    this.tensionOsc1.frequency.value = 73.42; // D2

    this.tensionOsc2 = this.ctx.createOscillator();
    this.tensionOsc2.type = 'sawtooth';
    this.tensionOsc2.frequency.value = 77.78; // D#2 dissonant tension rub

    this.tensionOsc1.connect(this.tensionFilter);
    this.tensionOsc2.connect(this.tensionFilter);
    this.tensionFilter.connect(this.tensionGain);
    this.tensionGain.connect(this.masterGain);
    if (this.reverbSendGain) {
      this.tensionGain.connect(this.reverbSendGain);
    }

    this.tensionOsc1.start();
    this.tensionOsc2.start();

    // Active chase industrial bass/brass swell
    this.chaseFilter = this.ctx.createBiquadFilter();
    this.chaseFilter.type = 'lowpass';
    this.chaseFilter.frequency.value = 420;
    this.chaseFilter.Q.value = 3.2;

    this.chaseBedGain = this.ctx.createGain();
    this.chaseBedGain.gain.value = 0.0;

    this.chaseOsc = this.ctx.createOscillator();
    this.chaseOsc.type = 'sawtooth';
    this.chaseOsc.frequency.value = 49.0; // G1 menacing growl

    this.chaseOsc.connect(this.chaseFilter);
    this.chaseFilter.connect(this.chaseBedGain);
    this.chaseBedGain.connect(this.masterGain);
    this.chaseOsc.start();
  }

  private startProximityLoops(): void {
    if (!this.ctx || !this.masterGain) return;

    // 1. Fluorescent 60Hz ballast buzz (120Hz + 240Hz harmonics)
    this.lightHumFilter = this.ctx.createBiquadFilter();
    this.lightHumFilter.type = 'bandpass';
    this.lightHumFilter.frequency.value = 210;
    this.lightHumFilter.Q.value = 1.1;

    this.lightHumGain = this.ctx.createGain();
    this.lightHumGain.gain.value = 0.0;

    this.lightHumOsc1 = this.ctx.createOscillator();
    this.lightHumOsc1.type = 'sawtooth';
    this.lightHumOsc1.frequency.value = 120;

    this.lightHumOsc2 = this.ctx.createOscillator();
    this.lightHumOsc2.type = 'triangle';
    this.lightHumOsc2.frequency.value = 240;

    this.lightHumOsc1.connect(this.lightHumFilter);
    this.lightHumOsc2.connect(this.lightHumFilter);
    this.lightHumFilter.connect(this.lightHumGain);
    this.lightHumGain.connect(this.masterGain);

    this.lightHumOsc1.start();
    this.lightHumOsc2.start();

    // 2. Steam vent hiss loop
    if (this.shortWhiteNoise) {
      this.steamLoopSource = this.ctx.createBufferSource();
      this.steamLoopSource.buffer = this.shortWhiteNoise;
      this.steamLoopSource.loop = true;

      this.steamFilter = this.ctx.createBiquadFilter();
      this.steamFilter.type = 'bandpass';
      this.steamFilter.frequency.value = 2100;
      this.steamFilter.Q.value = 0.9;

      this.steamGain = this.ctx.createGain();
      this.steamGain.gain.value = 0.0;

      this.steamLoopSource.connect(this.steamFilter);
      this.steamFilter.connect(this.steamGain);
      this.steamGain.connect(this.masterGain);
      this.steamLoopSource.start();
    }

    // 3. Burning flare sizzle loop
    if (this.shortWhiteNoise) {
      this.flareLoopSource = this.ctx.createBufferSource();
      this.flareLoopSource.buffer = this.shortWhiteNoise;
      this.flareLoopSource.loop = true;

      this.flareFilter = this.ctx.createBiquadFilter();
      this.flareFilter.type = 'bandpass';
      this.flareFilter.frequency.value = 3400;
      this.flareFilter.Q.value = 1.6;

      this.flareGain = this.ctx.createGain();
      this.flareGain.gain.value = 0.0;

      this.flareLoopSource.connect(this.flareFilter);
      this.flareFilter.connect(this.flareGain);
      this.flareGain.connect(this.masterGain);
      this.flareLoopSource.start();
    }
  }

  public updateAmbient(dt: number, state: AcousticContext): void {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const isChasing = state.bruteState === 'CHASE' || state.bruteState === 'SMASH_DOOR';
    const isStalking =
      state.bruteState === 'STALK' ||
      state.bruteState === 'CHECK_HIDING' ||
      state.bruteState === 'INVESTIGATE' ||
      state.bruteState === 'SEARCH_ROOM';

    const dist = clamp(state.bruteDistance, 0, 3000);
    const prox = clamp(1 - dist / 520, 0, 1);
    const occDamp = clamp(1 - state.bruteOcclusion * 0.45, 0.35, 1);

    // 1. Dynamic tension & chase stem levels
    const targetTension = isChasing
      ? 0.085
      : clamp((isStalking ? 0.038 : 0.008) + prox * 0.065 * occDamp, 0, 0.09);
    const targetChase = isChasing
      ? 0.095 + prox * 0.05
      : state.bruteState === 'CHECK_HIDING' && prox > 0.45
        ? 0.045
        : 0;

    if (this.tensionGain && this.tensionFilter) {
      this.tensionGain.gain.setTargetAtTime(clamp(targetTension, 0, 0.14), now, 0.25);
      this.tensionFilter.frequency.setTargetAtTime(
        safeFreq(220 + prox * 420 * occDamp + (isChasing ? 280 : 0), 260),
        now,
        0.2
      );
    }

    if (this.chaseBedGain && this.chaseFilter) {
      this.chaseBedGain.gain.setTargetAtTime(clamp(targetChase, 0, 0.16), now, 0.14);
      this.chaseFilter.frequency.setTargetAtTime(
        safeFreq(340 + prox * 620 + (isChasing ? 240 : 0), 380),
        now,
        0.15
      );
    }

    // 2. Rhythmic industrial chase percussion pulses when actively hunted
    if (isChasing || (state.bruteState === 'CHECK_HIDING' && prox > 0.55)) {
      this.chasePulseTimer -= dt;
      if (this.chasePulseTimer <= 0) {
        const beatInterval = isChasing ? 0.22 : 0.34;
        this.chasePulseTimer = beatInterval;
        this.playChasePercussionStep(this.chaseBeatStep, 0.14 + prox * 0.12);
        this.chaseBeatStep = (this.chaseBeatStep + 1) % 8;
      }
    } else {
      this.chasePulseTimer = 0.08;
      this.chaseBeatStep = 0;
    }

    // 3. Fluorescent 60Hz ballast hum & occasional electric sputter synced with flickering lights
    if (this.sputterCooldown > 0) this.sputterCooldown -= dt;
    if (this.lightHumGain && this.lightHumFilter) {
      const lightProx =
        Number.isFinite(state.nearestLightDist) && state.nearestLightDist < 360
          ? Math.pow(1 - state.nearestLightDist / 360, 1.45)
          : 0;
      const lightOcc = this.computeOcclusionParams(state.nearestLightOcclusion, false);
      const sputterBoost = 1 + state.nearestLightSputter * 0.9;
      const humLevel = clamp(lightProx * 0.028 * lightOcc.gainMult * sputterBoost, 0, 0.06);
      this.lightHumGain.gain.setTargetAtTime(humLevel, now, 0.08);
      this.lightHumFilter.frequency.setTargetAtTime(
        safeFreq(Math.min(lightOcc.lowpassHz, 220 + state.nearestLightSputter * 460), 220),
        now,
        0.06
      );

      if (
        lightProx > 0.18 &&
        state.nearestLightSputter > 0.58 &&
        this.lastSputterLevel <= 0.58 &&
        this.sputterCooldown <= 0
      ) {
        this.sputterCooldown = 0.65;
        this.playLightSputter(lightProx * lightOcc.gainMult, state.nearestLightOcclusion);
      }
      this.lastSputterLevel = state.nearestLightSputter;
    }

    // 4. Active steam vent hiss & burning flare sizzle
    if (this.steamGain && this.steamFilter) {
      const vInt = clamp(state.nearestVentIntensity, 0, 1);
      this.steamGain.gain.setTargetAtTime(vInt * 0.11, now, 0.09);
      this.steamFilter.frequency.setTargetAtTime(safeFreq(550 + vInt * 2100, 1400), now, 0.09);
    }
    if (this.flareGain && this.flareFilter) {
      const fInt = clamp(state.nearestFlareIntensity, 0, 1);
      this.flareGain.gain.setTargetAtTime(fInt * 0.065, now, 0.08);
      this.flareFilter.frequency.setTargetAtTime(safeFreq(700 + fInt * 2800, 2200), now, 0.08);
    }

    // 5. Random metallic hull groans & distant pipe pings
    this.creakTimer -= dt;
    if (this.creakTimer <= 0) {
      this.creakTimer = 8 + Math.random() * 13;
      this.playHullCreak();
    }

    this.pipePingTimer -= dt;
    if (this.pipePingTimer <= 0) {
      this.pipePingTimer = 6 + Math.random() * 11;
      this.playDistantPipePing();
    }

    // 6. Survivor heartbeat under danger
    if (isChasing || prox > 0.18) {
      const interval = isChasing ? 0.41 : Math.max(0.46, 1.06 - prox * 0.56);
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        this.heartbeatTimer = interval;
        const vol = (isChasing ? 0.34 : 0.09 + prox * 0.24) * (state.playerHiding ? 1.1 : 1.0);
        this.playHeartbeat(clamp(vol, 0.02, 0.42));
      }
    } else {
      this.heartbeatTimer = 0.15;
    }

    // 7. Survivor stamina/exhaustion breathing
    const needsBreath = state.playerExhausted || state.playerStaminaRatio < 0.34;
    if (needsBreath) {
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = state.playerExhausted ? 0.62 : 0.85;
        const intensity = clamp(1 - state.playerStaminaRatio / 0.4, 0.25, 1) * (state.playerHiding ? 0.45 : 1);
        this.playExhaustedBreath(intensity);
      }
    } else {
      this.breathTimer = 0.25;
    }
  }

  private playChasePercussionStep(step: number, amp: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const isDownbeat = step % 4 === 0;
    const isAccent = step === 0 || step === 3 || step === 6;
    if (!isAccent && step % 2 !== 0) return;

    // Industrial anvil/kick pulse
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isDownbeat ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isDownbeat ? 98 : 132, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.12);

    const peak = safeGain(amp * (isDownbeat ? 0.68 : 0.36));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGain);
    if (this.reverbSendGain && isDownbeat) {
      const send = this.ctx.createGain();
      send.gain.value = 0.22;
      gain.connect(send);
      send.connect(this.reverbSendGain);
    }
    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playLightSputter(amp: number, occlusion01: number): void {
    if (!this.ctx || !this.masterGain || this.muted || !this.shortWhiteNoise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.shortWhiteNoise;

    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = safeFreq(2400 * (1 - occlusion01 * 0.65), 1400);
    band.Q.value = 2.4;

    const gain = this.ctx.createGain();
    const peak = safeGain(0.045 * amp);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    gain.gain.setValueAtTime(peak * 0.7, now + 0.075);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

    src.connect(band);
    band.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.14);
  }

  private playHullCreak(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;

    osc.type = 'sawtooth';
    const base = 68 + Math.random() * 48;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(safeFreq(base * 0.64, 42), now + 1.5);

    filter.type = 'bandpass';
    filter.frequency.value = 210 + Math.random() * 120;
    filter.Q.value = 3.5;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.032, now + 0.38);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.65);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.masterGain);
    if (this.reverbSendGain) {
      const send = this.ctx.createGain();
      send.gain.value = 0.35;
      pan.connect(send);
      send.connect(this.reverbSendGain);
    }

    osc.start(now);
    osc.stop(now + 1.7);
  }

  private playDistantPipePing(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.7 - 0.85;

    osc.type = 'sine';
    const f = 310 + Math.random() * 360;
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.94, now + 0.35);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.018, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(gain);
    gain.connect(pan);
    pan.connect(this.masterGain);
    if (this.reverbSendGain) {
      const send = this.ctx.createGain();
      send.gain.value = 0.45;
      pan.connect(send);
      send.connect(this.reverbSendGain);
    }

    osc.start(now);
    osc.stop(now + 0.45);
  }

  private playExhaustedBreath(intensity: number): void {
    if (!this.ctx || !this.masterGain || this.muted || !this.shortWhiteNoise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.shortWhiteNoise;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(620, now);
    filter.frequency.linearRampToValueAtTime(420, now + 0.24);
    filter.Q.value = 1.6;

    const gain = this.ctx.createGain();
    const peak = safeGain(0.032 * intensity);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.3);
  }

  private playHeartbeat(volume: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const pulse = (offset: number, amp: number) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, now + offset);
      osc.frequency.exponentialRampToValueAtTime(30, now + offset + 0.13);

      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(safeGain(amp), now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    };

    pulse(0, volume);
    pulse(0.14, volume * 0.64);
  }

  public playPlayerStep(
    sprinting: boolean,
    crouching: boolean,
    material: FloorMaterial = 'STEEL'
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const basePeak = sprinting ? 0.13 : crouching ? 0.032 : 0.072;

    if (this.shortWhiteNoise) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.shortWhiteNoise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = material === 'GRATING' ? 3.2 : material === 'WEATHER' ? 1.1 : 1.5;

      const centerHz =
        material === 'GRATING'
          ? 1250
          : material === 'CABIN'
            ? 240
            : material === 'BRIDGE'
              ? 310
              : material === 'WEATHER'
                ? 580
                : 390;
      filter.frequency.value = safeFreq(centerHz * (sprinting ? 1.18 : crouching ? 0.78 : 1), 360);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(safeGain(basePeak), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      if (this.reverbSendGain && (material === 'STEEL' || material === 'GRATING' || material === 'CARGO')) {
        const send = this.ctx.createGain();
        send.gain.value = sprinting ? 0.22 : 0.1;
        gain.connect(send);
        send.connect(this.reverbSendGain);
      }
      src.start(now);
      src.stop(now + 0.095);
    }

    // Subtle boot-impact body resonance by floor material
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = material === 'GRATING' ? 'triangle' : 'sine';
    const pitch = material === 'GRATING' ? 235 : material === 'CABIN' ? 108 : 138;
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(safeFreq(pitch * 0.48, 45), now + 0.055);
    oscGain.gain.setValueAtTime(safeGain(basePeak * 0.55), now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playBruteStep(
    dx: number,
    dy: number,
    isChasing: boolean,
    muffled = false,
    occlusion = 0,
    material: FloorMaterial = 'STEEL'
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const dist = Math.hypot(dx, dy);
    const maxHear = muffled ? 740 : 1220;
    if (dist > maxHear) return;

    const now = this.ctx.currentTime;
    const atten = Math.pow(1 - dist / maxHear, 1.5);
    const occ = this.computeOcclusionParams(occlusion, muffled);
    const vol = clamp((isChasing ? 0.58 : 0.36) * atten * occ.gainMult, 0.001, 0.72);

    // 1. Sub-bass deck stomp
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isChasing ? 112 : 84, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.21);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(safeGain(vol), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);

    osc.connect(gain);
    this.routeSpatialNode(gain, dx, occlusion, muffled);
    osc.start(now);
    osc.stop(now + 0.25);

    // 2. Heavy steel/grating armor clank transient (attenuated sharply by wall occlusion)
    if (this.shortWhiteNoise && occ.gainMult > 0.32) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.shortWhiteNoise;
      const clankBand = this.ctx.createBiquadFilter();
      clankBand.type = 'bandpass';
      clankBand.frequency.value = material === 'GRATING' ? 1450 : 620;
      clankBand.Q.value = 1.8;

      const clankGain = this.ctx.createGain();
      clankGain.gain.setValueAtTime(safeGain(vol * 0.42), now);
      clankGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

      src.connect(clankBand);
      clankBand.connect(clankGain);
      this.routeSpatialNode(clankGain, dx, occlusion, muffled);
      src.start(now);
      src.stop(now + 0.1);
    }
  }

  public playStairTraversal(effectiveDist = 0, occlusion = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const maxHear = 980;
    if (effectiveDist > maxHear) return;
    const atten = Math.pow(1 - effectiveDist / maxHear, 1.3);
    const occ = this.computeOcclusionParams(occlusion, effectiveDist > 0 && occlusion > 0.45);
    const now = this.ctx.currentTime;

    [0, 0.11, 0.22].forEach((offset, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(175 + idx * 28, now + offset);
      osc.frequency.exponentialRampToValueAtTime(72, now + offset + 0.09);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(safeGain(0.16 * atten * occ.gainMult), now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.1);
      osc.connect(gain);
      this.routeSpatialNode(gain, 0, occlusion, false);
      osc.start(now + offset);
      osc.stop(now + offset + 0.11);
    });
  }

  public playBruteRoar(dx = 0, dy = 0, occlusion = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dist = Math.hypot(dx, dy);
    const atten = clamp(1 - dist / 1400, 0.3, 1);
    const occ = this.computeOcclusionParams(occlusion, false);

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(150, now);
    osc1.frequency.exponentialRampToValueAtTime(64, now + 0.9);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(157, now);
    osc2.frequency.exponentialRampToValueAtTime(59, now + 0.9);

    lfo.frequency.value = 32;
    lfoGain.gain.value = 28;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(safeFreq(680 * occ.gainMult, 360), now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.9);
    filter.Q.value = 1.4;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(safeGain(0.46 * atten * occ.gainMult), now + 0.055);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.94);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    this.routeSpatialNode(gain, dx, occlusion, false);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);
    osc1.stop(now + 0.96);
    osc2.stop(now + 0.96);
    lfo.stop(now + 0.96);
  }

  public playBruteSuspicionGrowl(dx: number, dy: number, occlusion = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const dist = Math.hypot(dx, dy);
    const maxHear = 980;
    if (dist > maxHear) return;

    const now = this.ctx.currentTime;
    const atten = Math.pow(1 - dist / maxHear, 1.35);
    const occ = this.computeOcclusionParams(occlusion, false);

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(96, now);
    osc.frequency.linearRampToValueAtTime(62, now + 0.24);
    osc.frequency.linearRampToValueAtTime(79, now + 0.48);

    filter.type = 'lowpass';
    filter.frequency.value = safeFreq(Math.min(occ.lowpassHz, 260 + atten * 380), 260);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(safeGain(0.28 * atten * occ.gainMult), now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    osc.connect(filter);
    filter.connect(gain);
    this.routeSpatialNode(gain, dx, occlusion, false);

    osc.start(now);
    osc.stop(now + 0.52);
  }

  public playDoorToggle(
    open: boolean,
    silent = false,
    effectiveDist = 0,
    occlusion = 0,
    dx = 0
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const maxHear = silent ? 280 : 980;
    if (effectiveDist > maxHear) return;
    const atten = effectiveDist <= 0 ? 1 : Math.pow(1 - effectiveDist / maxHear, 1.35);
    const occ = this.computeOcclusionParams(occlusion, false);
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (silent) {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(open ? 124 : 102, now);
      osc.frequency.linearRampToValueAtTime(open ? 156 : 78, now + 0.36);
      gain.gain.setValueAtTime(safeGain(0.032 * atten * occ.gainMult), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.connect(gain);
      this.routeSpatialNode(gain, dx, occlusion, false);
      osc.start(now);
      osc.stop(now + 0.4);
    } else {
      // Heavy steel latch clunk + hydraulic bulkhead thud
      osc.type = 'square';
      osc.frequency.setValueAtTime(open ? 195 : 138, now);
      osc.frequency.exponentialRampToValueAtTime(open ? 290 : 72, now + 0.11);
      gain.gain.setValueAtTime(safeGain(0.095 * atten * occ.gainMult), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      osc.connect(gain);
      this.routeSpatialNode(gain, dx, occlusion, false);
      osc.start(now);
      osc.stop(now + 0.14);
    }
  }

  public playBreakerSwitch(on: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(on ? 340 : 220, now);
    osc.frequency.exponentialRampToValueAtTime(on ? 680 : 105, now + 0.06);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  public playDoorSmash(dx: number, dy: number, occlusion = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const dist = Math.hypot(dx, dy);
    const atten = clamp(1 - dist / 1550, 0.08, 1);
    const occ = this.computeOcclusionParams(occlusion, false);
    const now = this.ctx.currentTime;

    if (this.shortWhiteNoise) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.shortWhiteNoise;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(safeGain(0.52 * atten * occ.gainMult), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

      src.connect(gain);
      this.routeSpatialNode(gain, dx, occlusion, false);
      src.start(now);
      src.stop(now + 0.38);
    }

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(118, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.28);
    oscGain.gain.setValueAtTime(safeGain(0.46 * atten * occ.gainMult), now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(oscGain);
    this.routeSpatialNode(oscGain, dx, occlusion, false);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playLockerSound(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(255, now);
    osc.frequency.linearRampToValueAtTime(155, now + 0.14);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    if (this.reverbSendGain) {
      const send = this.ctx.createGain();
      send.gain.value = 0.2;
      gain.connect(send);
      send.connect(this.reverbSendGain);
    }
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playFlashlightClick(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(960, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.025);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.038);
  }

  public playItemPickup(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(587, now + 0.055);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playContainerSearch(foundItem: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    if (this.shortWhiteNoise) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.shortWhiteNoise;
      const band = this.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = foundItem ? 960 : 620;
      band.Q.value = 1.6;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      src.connect(band);
      band.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.15);
    }

    if (foundItem) {
      this.playItemPickup();
    }
  }

  public playBoltCuttersSnap(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Sharp metallic shear snap
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1420, now);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.08);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    if (this.reverbSendGain) {
      const send = this.ctx.createGain();
      send.gain.value = 0.25;
      gain.connect(send);
      send.connect(this.reverbSendGain);
    }
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playFlareIgnite(dx = 0): void {
    if (!this.ctx || !this.masterGain || this.muted || !this.shortWhiteNoise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.shortWhiteNoise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1800, now);
    band.frequency.exponentialRampToValueAtTime(3800, now + 0.24);
    band.Q.value = 1.3;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    src.connect(band);
    band.connect(gain);
    this.routeSpatialNode(gain, dx, 0, false);
    src.start(now);
    src.stop(now + 0.36);
  }

  public playExtinguisherBlast(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const noise = this.shortWhiteNoise ?? this.createWhiteNoiseBuffer(0.65);
    if (!noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1100;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.64);
  }

  public playDeathImpact(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.65);
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.72);
  }

  public playVictoryHorn(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [130.8, 164.8, 196.0].forEach((freq) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.13, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.45);
    });
  }

  public playItemDrop(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(78, now + 0.08);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playBackpackEquip(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [330, 440, 587].forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);
      gain.gain.setValueAtTime(0.09, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.16);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.17);
    });
  }

  public playJournalToggle(opening: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted || !this.shortWhiteNoise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.shortWhiteNoise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(opening ? 1350 : 950, now);
    filter.Q.value = 1.4;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.09);
  }

  public playRepairTick(route: 'LIFEBOAT' | 'HELI', partId: string): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (partId === 'AVIATION_FUEL') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190 + Math.random() * 55, now);
      osc.frequency.linearRampToValueAtTime(310, now + 0.08);
    } else if (partId === 'ROTOR_FUSE' || partId === 'MARINE_BATTERY') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(620 + Math.random() * 140, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.06);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(route === 'HELI' ? 320 : 240, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.09);
    }
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playRepairComplete(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [293.7, 440.0].forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.14, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.22);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.24);
    });
  }

  public playEscapeActivationStart(route: 'LIFEBOAT' | 'HELI'): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    if (route === 'HELI') {
      osc.frequency.setValueAtTime(75, now);
      osc.frequency.exponentialRampToValueAtTime(340, now + 0.75);
    } else {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(145, now + 0.35);
      osc.frequency.linearRampToValueAtTime(215, now + 0.75);
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.88);
  }

  public playEscapeActivationPulse(route: 'LIFEBOAT' | 'HELI', progress: number, dx = 0, occ = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const occParams = this.computeOcclusionParams(occ, false);
    if (route === 'HELI') {
      osc.type = 'sawtooth';
      const pitch = safeFreq(68 + progress * 195, 140);
      osc.frequency.setValueAtTime(pitch, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(safeGain(0.14 * occParams.gainMult), now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(148 + progress * 48, now);
      osc.frequency.exponentialRampToValueAtTime(64, now + 0.22);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(safeGain(0.16 * occParams.gainMult), now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    }
    osc.connect(gain);
    this.routeSpatialNode(gain, dx, occ, false);
    osc.start(now);
    osc.stop(now + 0.34);
  }

  public playEscapeReadyChime(route: 'LIFEBOAT' | 'HELI'): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = route === 'HELI' ? [523.25, 659.25, 783.99] : [440, 554.37, 659.25];
    notes.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.09);
      gain.gain.setValueAtTime(0.16, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.34);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.36);
    });
  }

  public playCutsceneProjectorClick(funny = false): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = funny ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(funny ? 310 : 720, now);
    osc.frequency.exponentialRampToValueAtTime(funny ? 520 : 180, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public dispose(): void {
    const stopNode = (node: { stop: () => void } | null) => {
      if (!node) return;
      try {
        node.stop();
      } catch {}
    };
    stopNode(this.droneOsc1);
    stopNode(this.droneOsc2);
    stopNode(this.turbineSource);
    stopNode(this.tensionOsc1);
    stopNode(this.tensionOsc2);
    stopNode(this.chaseOsc);
    stopNode(this.lightHumOsc1);
    stopNode(this.lightHumOsc2);
    stopNode(this.steamLoopSource);
    stopNode(this.flareLoopSource);
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
