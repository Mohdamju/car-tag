// Keyboard + touch input, merged into a single analogue-style control state.

const KEY_MAP = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  Space: 'drift',
};

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  constructor() {
    this.keys = { up: false, down: false, left: false, right: false, boost: false, drift: false };
    this.touch = { up: false, down: false, left: false, right: false, boost: false, drift: false };
    this.onPause = null; // callbacks assigned by main
    this.onMute = null;

    this.state = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false };

    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this._bindTouch();
  }

  reset() {
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
      this.touch[k] = false;
    }
  }

  _onKey(e, down) {
    if (PREVENT.has(e.code)) e.preventDefault();
    const action = KEY_MAP[e.code];
    if (action) {
      this.keys[action] = down;
    }
    if (down && !e.repeat) {
      if ((e.code === 'KeyP' || e.code === 'Escape') && this.onPause) this.onPause();
      if (e.code === 'KeyM' && this.onMute) this.onMute();
    }
    // Shift key state can be lost on some browsers when focus changes; trust the event flag too.
    if (e.key === 'Shift') this.keys.boost = down;
  }

  _bindTouch() {
    const root = document.getElementById('touch');
    if (!root) return;
    const buttons = root.querySelectorAll('[data-action]');
    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      const press = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this.touch[action] = true;
        btn.classList.add('active');
      };
      const release = (e) => {
        e.preventDefault();
        this.touch[action] = false;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  /** Resolve the latest control state; call once per frame. */
  poll() {
    const k = this.keys;
    const t = this.touch;
    const s = this.state;
    s.throttle = k.up || t.up ? 1 : 0;
    s.brake = k.down || t.down ? 1 : 0;
    s.steer = (k.right || t.right ? 1 : 0) - (k.left || t.left ? 1 : 0);
    s.boost = k.boost || t.boost;
    s.drift = k.drift || t.drift;
    return s;
  }
}
