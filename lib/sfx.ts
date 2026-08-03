// Sound packs. Everything is synthesised — no audio files — so a pack is
// really a set of voices for the same four events.

export type PackId = "studio" | "zen" | "off";

export const PACKS: { id: PackId; name: string; blurb: string }[] = [
  { id: "studio", name: "Paint Studio", blurb: "wet splats and pops" },
  { id: "zen", name: "Zen Garden", blurb: "wind chimes · soft and slow" },
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
  pack: PackId = "studio";

  get muted() {
    return this.pack === "off";
  }

  ensure() {
    if (this.muted) return;
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
    if (this.muted) return;
    this.ensure();
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

  land() {
    if (this.muted || !this.ctx) return;
    if (this.pack === "zen") {
      // one soft chime, randomly placed in the scale
      this.chimeNote(this.note((Math.random() * PENTATONIC.length) | 0), 0, 0.16, 2.8);
    } else {
      this.noise(0.15, 900, 0.25);
    }
  }

  boom() {
    if (this.muted || !this.ctx) return;
    if (this.pack === "zen") {
      this.chimeNote(PENTATONIC[0] / 2, 0, 0.3, 5.5); // low gong
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
