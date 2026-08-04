// Sound packs. Everything is synthesised — no audio files — so a pack is
// really a set of voices for the same four events.

export type PackId = "studio" | "zen" | "drips" | "off";

/** Background ambience, layered under whatever the sound pack is doing. */
export type AmbienceId = "off" | "waves" | "rain" | "forest" | "night" | "day";

export const AMBIENCES: { id: AmbienceId; name: string; blurb: string }[] = [
  { id: "night", name: "Night Field", blurb: "crickets and low air" },
  { id: "day", name: "Day Field", blurb: "warm breeze and songbirds" },
  { id: "waves", name: "Beach", blurb: "slow surf, rolling in" },
  { id: "rain", name: "Rainfall", blurb: "steady rain on leaves" },
  { id: "forest", name: "Rainforest", blurb: "wind and distant birds" },
  { id: "off", name: "None", blurb: "just the game" },
];

export const PACKS: { id: PackId; name: string; blurb: string }[] = [
  { id: "zen", name: "Zen Garden", blurb: "wind chimes · soft and slow" },
  { id: "drips", name: "Paint Drips", blurb: "thick drops into a tin" },
  { id: "studio", name: "Paint Studio", blurb: "wet splats and pops" },
  { id: "off", name: "Silent", blurb: "no sound at all" },
];

// A pentatonic scale has no harsh intervals, so any two notes sound calm
// together — which is what makes wind chimes pleasant at random.
const PENTATONIC = [523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66, 1396.91];

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private amb: { gain: GainNode; stop: () => void } | null = null;
  private ambId: AmbienceId = "off";
  pack: PackId = "studio";

  get muted() {
    return this.pack === "off";
  }

  ensure() {
    // Build the graph even with the pack off — ambience is independent of it.
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      // A short synthetic tail gives chimes room to breathe. Without it the
      // pack sounds like beeps rather than something in a space.
      this.verb = this.ctx.createConvolver();
      this.verb.buffer = this.impulse(2.6);
      const wet = this.ctx.createGain();
      wet.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.master.connect(this.verb).connect(wet).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  /** Silence everything without tearing the graph down, for when the player
   *  leaves the tab. */
  suspend() {
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
  }

  resume() {
    this.ensure();
  }

  /** Long buffer of noise, looped. Long enough that the seam is inaudible. */
  private noiseLoop(brown: boolean): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 9;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      } else {
        d[i] = w;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  /** A short bird call: a rising then falling whistle. */
  private birdCall(at: number) {
    const ctx = this.ctx;
    if (!ctx || !this.amb) return;
    const t = ctx.currentTime + at;
    const f0 = 1700 + Math.random() * 1600;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.5), t + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    o.connect(g).connect(this.amb.gain);
    o.start(t);
    o.stop(t + 0.21);
  }

  /** A cricket: a fast burst of clicks around 4kHz. */
  private cricket(at: number) {
    const ctx = this.ctx;
    if (!ctx || !this.amb) return;
    const t0 = ctx.currentTime + at;
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * 0.035;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 3900 + Math.random() * 500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.016, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
      o.connect(g).connect(this.amb.gain);
      o.start(t);
      o.stop(t + 0.03);
    }
  }

  get ambience() {
    return this.ambId;
  }

  /** Swap the background bed. Everything is synthesised — no audio files. */
  setAmbient(id: AmbienceId) {
    this.ambId = id;
    if (this.amb) {
      const old = this.amb;
      this.amb = null;
      const t = this.ctx ? this.ctx.currentTime : 0;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 0.8);
      setTimeout(() => old.stop(), 1000);
    }
    if (id === "off") return;
    this.ensure();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const started: { stop(): void }[] = [];
    const timers: number[] = [];
    const stop = () => {
      for (const s of started) { try { s.stop(); } catch { /* already stopped */ } }
      for (const t of timers) clearInterval(t);
      gain.disconnect();
    };
    this.amb = { gain, stop };

    if (id === "waves") {
      // brown noise under a slow swell, with brighter foam on the peaks
      const src = this.noiseLoop(true);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      const swell = ctx.createGain();
      swell.gain.value = 0.55;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.075; // ~13s between waves
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.42;
      lfo.connect(lfoAmt).connect(swell.gain);
      src.connect(lp).connect(swell).connect(gain);
      const foam = this.noiseLoop(false);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2600;
      const foamGain = ctx.createGain();
      foamGain.gain.value = 0.05;
      const foamLfo = ctx.createGain();
      foamLfo.gain.value = 0.05;
      lfo.connect(foamLfo).connect(foamGain.gain);
      foam.connect(hp).connect(foamGain).connect(gain);
      src.start(); foam.start(); lfo.start();
      started.push(src, foam, lfo);
    } else if (id === "rain") {
      const src = this.noiseLoop(false);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7000;
      const body = ctx.createGain();
      body.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.12;
      lfo.connect(lfoAmt).connect(body.gain);
      src.connect(hp).connect(lp).connect(body).connect(gain);
      // low rumble underneath so it isn't all hiss
      const rumble = this.noiseLoop(true);
      const rlp = ctx.createBiquadFilter();
      rlp.type = "lowpass";
      rlp.frequency.value = 300;
      const rg = ctx.createGain();
      rg.gain.value = 0.22;
      rumble.connect(rlp).connect(rg).connect(gain);
      src.start(); rumble.start(); lfo.start();
      started.push(src, rumble, lfo);
    } else if (id === "forest") {
      const src = this.noiseLoop(true);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 700;
      bp.Q.value = 0.6;
      const wind = ctx.createGain();
      wind.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.055;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.35;
      lfo.connect(lfoAmt).connect(wind.gain);
      src.connect(bp).connect(wind).connect(gain);
      src.start(); lfo.start();
      started.push(src, lfo);
      // birds, scheduled a few seconds ahead at a time
      timers.push(
        window.setInterval(() => {
          if (!this.amb) return;
          const n = Math.random() < 0.55 ? 1 + ((Math.random() * 2) | 0) : 0;
          for (let k = 0; k < n; k++) this.birdCall(Math.random() * 3);
        }, 3200)
      );
    } else if (id === "day") {
      // open meadow: a lighter, brighter breeze than the rainforest bed
      const src = this.noiseLoop(true);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1100;
      bp.Q.value = 0.45;
      const breeze = ctx.createGain();
      breeze.gain.value = 0.34;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.2;
      lfo.connect(lfoAmt).connect(breeze.gain);
      src.connect(bp).connect(breeze).connect(gain);
      // a soft warm bed underneath so it doesn't read as pure hiss
      const warm = this.noiseLoop(true);
      const wlp = ctx.createBiquadFilter();
      wlp.type = "lowpass";
      wlp.frequency.value = 340;
      const wg = ctx.createGain();
      wg.gain.value = 0.3;
      warm.connect(wlp).connect(wg).connect(gain);
      src.start(); warm.start(); lfo.start();
      started.push(src, warm, lfo);
      // songbirds: busier and brighter than the rainforest
      timers.push(
        window.setInterval(() => {
          if (!this.amb) return;
          const n = 1 + ((Math.random() * 3) | 0);
          for (let k = 0; k < n; k++) this.birdCall(Math.random() * 2.2);
        }, 2400)
      );
    } else if (id === "night") {
      const src = this.noiseLoop(true);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 240;
      const air = ctx.createGain();
      air.gain.value = 0.5;
      src.connect(lp).connect(air).connect(gain);
      src.start();
      started.push(src);
      timers.push(
        window.setInterval(() => {
          if (!this.amb) return;
          for (let k = 0; k < 2 + ((Math.random() * 3) | 0); k++) this.cricket(Math.random() * 2.4);
        }, 2500)
      );
    }

    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 2.5);
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
    }
    return buf;
  }

  /** Filtered noise burst — the wet splat of the studio pack. */
  private noise(dur: number, freq: number, gain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  /** A struck chime: soft attack, long tail, slight detune for shimmer. */
  private chimeNote(freq: number, at: number, gain: number, dur = 3.4) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    for (const [mult, level, detune] of [[1, 1, 0], [2.76, 0.32, 4], [5.4, 0.12, -6]]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * mult;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur);
    }
  }

  private note(i: number): number {
    return PENTATONIC[Math.max(0, Math.min(PENTATONIC.length - 1, i))];
  }

  /** A thick drop landing in a tin: a resonant plip that falls in pitch. */
  private drip(freq: number, at: number, gain = 0.2) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 2.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.055);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq * 1.8;
    bp.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(bp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.36);
  }

  land() {
    if (this.muted || !this.ctx) return;
    if (this.pack === "zen") {
      // one soft chime, randomly placed in the scale
      this.chimeNote(this.note((Math.random() * PENTATONIC.length) | 0), 0, 0.16, 2.8);
    } else if (this.pack === "drips") {
      this.drip(210 + Math.random() * 190, 0, 0.18);
    } else {
      this.noise(0.15, 900, 0.25);
    }
  }

  boom() {
    if (this.muted || !this.ctx) return;
    if (this.pack === "zen") {
      this.chimeNote(PENTATONIC[0] / 2, 0, 0.3, 5.5); // low gong
    } else if (this.pack === "drips") {
      this.noise(0.45, 400, 0.3); // the splash
      this.drip(90, 0.02, 0.3); // and the deep plop under it
    } else {
      this.noise(0.5, 250, 0.5);
    }
  }

  /** Rising figure; longer and higher the bigger the chain. */
  clear(steps: number) {
    if (this.muted || !this.ctx) return;
    const n = Math.max(2, Math.min(9, steps));
    if (this.pack === "zen") {
      for (let k = 0; k < n; k++) {
        this.chimeNote(this.note(k), k * 0.16, 0.15, 3.6);
      }
    } else if (this.pack === "drips") {
      // a run of drops falling faster and higher
      for (let k = 0; k < n; k++) {
        this.drip(240 * Math.pow(1.18, k), k * 0.11, 0.17);
      }
    } else {
      const ctx = this.ctx;
      for (let k = 0; k < n; k++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 400 * Math.pow(1.25, k);
        g.gain.setValueAtTime(0.12, ctx.currentTime + k * 0.07);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + k * 0.07 + 0.3);
        o.connect(g).connect(this.master!);
        o.start(ctx.currentTime + k * 0.07);
        o.stop(ctx.currentTime + k * 0.07 + 0.35);
      }
    }
  }

  level() {
    if (this.muted || !this.ctx) return;
    for (let k = 0; k < 4; k++) {
      if (this.pack === "zen") this.chimeNote(this.note(k * 2), k * 0.22, 0.18, 4.5);
      else if (this.pack === "drips") this.drip(200 * Math.pow(1.26, k), k * 0.14, 0.2);
      else this.noise(0.12, 1400 + k * 300, 0.16);
    }
  }

  /** Barely-there tonal bed, only for the zen pack. */
  setAmbience(on: boolean) {
    if (!this.ctx || !this.master) return;
    if (on && this.pack === "zen" && !this.drone) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 4);
      gain.connect(this.master);
      const osc: OscillatorNode[] = [];
      for (const f of [130.81, 196.0, 261.63]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 8;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        o.connect(g).connect(gain);
        o.start();
        osc.push(o);
      }
      this.drone = { osc, gain };
    } else if ((!on || this.pack !== "zen") && this.drone) {
      const { osc, gain } = this.drone;
      this.drone = null;
      const t = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 1.2);
      for (const o of osc) o.stop(t + 1.3);
    }
  }
}
