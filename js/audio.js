// Tiny WebAudio synth: engine hum, tag stinger, countdown beeps, impacts.
// No audio files => nothing to download. Everything is created lazily after the
// first user gesture to satisfy autoplay policies.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('cartag-muted') === '1';
    } catch (e) {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture (e.g. the Start button). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this._startEngine();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('cartag-muted', m ? '1' : '0');
    } catch (e) {
      /* storage unavailable; ignore */
    }
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _startEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, filter, gain };
  }

  /** speedRatio 0..1.4, throttle 0..1 */
  setEngine(speedRatio, throttle, boosting, active) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const base = 48 + speedRatio * 110 + (boosting ? 35 : 0);
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.06);
    this.engine.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(280 + speedRatio * 700 + throttle * 250, t, 0.08);
    const vol = active ? 0.05 + throttle * 0.035 + speedRatio * 0.03 : 0;
    this.engine.gain.gain.setTargetAtTime(vol, t, 0.08);
  }

  _tone(freq, dur, type = 'square', vol = 0.25, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  tick() {
    this._tone(520, 0.14, 'square', 0.18);
  }

  go() {
    this._tone(880, 0.35, 'square', 0.22);
  }

  tag(gotCrown) {
    if (gotCrown) {
      this._tone(523, 0.12, 'square', 0.22);
      this._tone(659, 0.12, 'square', 0.22, null, 0.08);
      this._tone(784, 0.25, 'square', 0.22, null, 0.16);
    } else {
      this._tone(420, 0.28, 'sawtooth', 0.2, 180);
    }
  }

  bump(strength) {
    const v = Math.min(0.3, 0.05 + strength * 0.012);
    this._tone(110, 0.14, 'sawtooth', v, 50);
  }

  end() {
    this._tone(784, 0.16, 'square', 0.22);
    this._tone(659, 0.16, 'square', 0.22, null, 0.14);
    this._tone(523, 0.4, 'square', 0.22, null, 0.28);
  }
}
