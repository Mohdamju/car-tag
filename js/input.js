// Keyboard, gamepad and touch input. Each local player reads from one "device":
//
//   kb-all     - every driving key (solo play) + touch buttons + first gamepad
//   kb-wasd    - W A S D, Left Shift (nitro), Space (drift)
//   kb-arrows  - Arrow keys, Right Shift or / (nitro), Right Ctrl or . (drift)
//   gamepad-N  - Nth connected gamepad (standard mapping)
//
// When opposing inputs overlap (W held while tapping S, A+D rolls) the most
// recently pressed one wins, so drivers can flip direction without first
// releasing the other key.

const SCHEMES = {
  'kb-all': {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    boost: ['ShiftLeft', 'ShiftRight'],
    drift: ['Space'],
  },
  'kb-wasd': {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    boost: ['ShiftLeft'],
    drift: ['Space'],
  },
  'kb-arrows': {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    boost: ['ShiftRight', 'Slash'],
    drift: ['ControlRight', 'Period', 'Numpad0'],
  },
};

export const DEVICE_LABELS = {
  'kb-all': 'Keyboard',
  'kb-wasd': 'Keyboard: WASD · L-Shift · Space',
  'kb-arrows': 'Keyboard: Arrows · R-Shift · R-Ctrl',
  'gamepad-0': 'Gamepad 1',
  'gamepad-1': 'Gamepad 2',
  'gamepad-2': 'Gamepad 3',
  'gamepad-3': 'Gamepad 4',
};

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash']);
const PAD_DEADZONE = 0.18;
const PAD_START = 9;

export class Input {
  constructor() {
    this.seq = 0;
    this.keys = new Map(); // code -> press sequence (absent when up)
    this.touch = { up: 0, down: 0, left: 0, right: 0, boost: 0, drift: 0 };
    this.onPause = null; // callbacks assigned by main
    this.onMute = null;
    this.enabled = true;
    this._padStartWas = [false, false, false, false];

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this._bindTouch();
  }

  reset() {
    this.keys.clear();
    for (const k of Object.keys(this.touch)) this.touch[k] = 0;
  }

  _onKey(e, down) {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
    if (typing) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    if (down) {
      if (!this.keys.has(e.code)) this.keys.set(e.code, ++this.seq);
    } else {
      this.keys.delete(e.code);
    }
    if (down && !e.repeat) {
      if ((e.code === 'KeyP' || e.code === 'Escape') && this.onPause) this.onPause();
      if (e.code === 'KeyM' && this.onMute) this.onMute();
    }
  }

  _bindTouch() {
    const root = document.getElementById('touch');
    if (!root) return;
    root.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      const press = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this.touch[action] = ++this.seq;
        btn.classList.add('active');
      };
      const release = (e) => {
        e.preventDefault();
        this.touch[action] = 0;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  /** Connected gamepads in a stable order (gaps removed). */
  gamepads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const out = [];
    for (const p of list) if (p && p.connected) out.push(p);
    return out;
  }

  /** True once per press of any gamepad's Start button (used for pause). */
  pollPadStart() {
    const pads = this.gamepads();
    let pressed = false;
    for (let i = 0; i < 4; i++) {
      const down = !!(pads[i] && pads[i].buttons[PAD_START] && pads[i].buttons[PAD_START].pressed);
      if (down && !this._padStartWas[i]) pressed = true;
      this._padStartWas[i] = down;
    }
    return pressed;
  }

  /** Latest sequence number of any held key for an action (0 = not held). */
  _keySeq(codes) {
    let best = 0;
    for (const c of codes) {
      const s = this.keys.get(c);
      if (s && s > best) best = s;
    }
    return best;
  }

  /**
   * Resolve the control state for one device into `out`
   * ({throttle, brake, steer, boost, drift}).
   */
  read(device, out) {
    out.throttle = 0;
    out.brake = 0;
    out.steer = 0;
    out.boost = false;
    out.drift = false;
    if (!this.enabled) return out;

    if (device.startsWith('gamepad-')) {
      this._readPad(this.gamepads()[Number(device.slice(8))], out);
      return out;
    }

    const scheme = SCHEMES[device] || SCHEMES['kb-all'];
    const withTouch = device === 'kb-all';
    const t = this.touch;
    const up = Math.max(this._keySeq(scheme.up), withTouch ? t.up : 0);
    const down = Math.max(this._keySeq(scheme.down), withTouch ? t.down : 0);
    const left = Math.max(this._keySeq(scheme.left), withTouch ? t.left : 0);
    const right = Math.max(this._keySeq(scheme.right), withTouch ? t.right : 0);

    if (up && down) {
      if (up > down) out.throttle = 1;
      else out.brake = 1;
    } else {
      out.throttle = up ? 1 : 0;
      out.brake = down ? 1 : 0;
    }
    if (left && right) out.steer = right > left ? 1 : -1;
    else out.steer = (right ? 1 : 0) - (left ? 1 : 0);
    out.boost = this._keySeq(scheme.boost) > 0 || (withTouch && t.boost > 0);
    out.drift = this._keySeq(scheme.drift) > 0 || (withTouch && t.drift > 0);

    // Solo players can also just pick up a controller.
    if (withTouch) {
      const pad = this.gamepads()[0];
      if (pad) {
        const p = this._readPad(pad, { throttle: 0, brake: 0, steer: 0, boost: false, drift: false });
        if (p.throttle > out.throttle && !out.brake) out.throttle = p.throttle;
        if (p.brake > out.brake && !out.throttle) out.brake = p.brake;
        if (Math.abs(p.steer) > Math.abs(out.steer)) out.steer = p.steer;
        out.boost = out.boost || p.boost;
        out.drift = out.drift || p.drift;
      }
    }
    return out;
  }

  /** Standard gamepad mapping: RT gas, LT brake/reverse, left stick / d-pad steer, A or RB nitro, B / X / LB drift. */
  _readPad(pad, out) {
    if (!pad) return out;
    const b = (i) => (pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0);
    let steer = pad.axes[0] || 0;
    if (Math.abs(steer) < PAD_DEADZONE) steer = 0;
    else steer = Math.sign(steer) * ((Math.abs(steer) - PAD_DEADZONE) / (1 - PAD_DEADZONE));
    if (b(14)) steer = -1;
    if (b(15)) steer = 1;
    const gas = Math.max(b(7), b(12));
    const brake = Math.max(b(6), b(13));
    // Whichever trigger is pressed harder wins, so gas and brake never cancel out.
    if (gas > 0.05 && gas >= brake) out.throttle = gas;
    else if (brake > 0.05) out.brake = brake;
    out.steer = steer;
    out.boost = b(0) > 0.5 || b(5) > 0.5;
    out.drift = b(1) > 0.5 || b(2) > 0.5 || b(4) > 0.5;
    return out;
  }
}
