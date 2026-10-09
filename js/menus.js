import { CONFIG } from './config.js';
import { CAR_DEFS, GameState, fillSlots } from './game.js';
import { DEVICE_LABELS } from './input.js';
import { OnlineSession, onlineSupported } from './online.js';
import { hex } from './hud.js';

const LOCAL_DEVICES = ['kb-wasd', 'kb-arrows', 'gamepad-0', 'gamepad-1', 'gamepad-2', 'gamepad-3'];
const DEFAULT_LOCAL_DEVICES = ['kb-wasd', 'kb-arrows', 'gamepad-0', 'gamepad-1'];
const OVERLAYS = ['menu', 'solo-setup', 'local-setup', 'online-menu', 'lobby', 'pause', 'results'];

function loadName() {
  try {
    return localStorage.getItem('cartag-name') || '';
  } catch (e) {
    return '';
  }
}

function loadNumber(key, fallback) {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(v) ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    /* storage unavailable; ignore */
  }
}

function saveName(name) {
  try {
    localStorage.setItem('cartag-name', name);
  } catch (e) {
    /* storage unavailable; ignore */
  }
}

/** All title / setup / lobby / pause / results screens and their buttons. */
export class Menus {
  constructor({ game, hud, audio, input, isTouch }) {
    this.game = game;
    this.hud = hud;
    this.audio = audio;
    this.input = input;
    this.isTouch = isTouch;
    this.session = null;
    this.localCount = 2;
    this.localDevices = DEFAULT_LOCAL_DEVICES.slice();
    // Bot count per mode (remembered between visits).
    this.botCounts = {
      solo: loadNumber('cartag-bots-solo', 5),
      local: loadNumber('cartag-bots-local', 4),
      online: loadNumber('cartag-bots-online', 4),
    };
    this.$ = (id) => document.getElementById(id);

    game.onMatchEnded = () => {
      this.hud.showTouch(false);
      this._hide('pause');
    };

    this._bindSteppers();
    this._bindMain();
    this._bindLocal();
    this._bindOnline();
    this._bindPause();
    this._bindResults();
  }

  show(name) {
    for (const id of OVERLAYS) this.$(id).classList.toggle('hidden', id !== name);
    const first = name && this.$(name).querySelector('button:not(.hidden):not(:disabled), input');
    if (first && !this.isTouch) first.focus({ preventScroll: true });
  }

  _hide(name) {
    this.$(name).classList.add('hidden');
  }

  _hideAll() {
    for (const id of OVERLAYS) this._hide(id);
  }

  _beginMatch() {
    this._hideAll();
    this.input.enabled = true;
    this.hud.showTouch(this.isTouch && this.game.views.length === 1);
  }

  // ----- Main menu ------------------------------------------------------------

  _bindMain() {
    this.$('solo-btn').addEventListener('click', () => {
      this.audio.unlock();
      this._renderSteppers();
      this.show('solo-setup');
    });
    this.$('solo-start').addEventListener('click', () => this.startSolo());
    this.$('solo-back').addEventListener('click', () => this.show('menu'));
    this.$('local-btn').addEventListener('click', () => {
      this.audio.unlock();
      this._renderLocal();
      this._renderSteppers();
      this.show('local-setup');
    });
    this.$('online-btn').addEventListener('click', () => {
      this.audio.unlock();
      this.$('online-name').value = loadName();
      this._setStatus('online-status', onlineSupported() ? '' : 'Online play is not available in this browser or page.');
      this.show('online-menu');
    });
  }

  startSolo() {
    this.audio.unlock();
    const humans = [{ kind: 'local', name: 'YOU', device: 'kb-all' }, null, null, null, null, null];
    this.game.startMatch({ mode: 'offline', slots: fillSlots(humans, this._bots('solo')) });
    this._beginMatch();
  }

  // ----- Local split-screen -------------------------------------------------------

  _bindLocal() {
    this.$('local-setup')
      .querySelectorAll('.seg-btn')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          this.localCount = Number(btn.dataset.count);
          this._renderLocal();
          this._renderSteppers();
        })
      );
    this.$('local-start').addEventListener('click', () => this.startLocal());
    this.$('local-back').addEventListener('click', () => this.show('menu'));
    window.addEventListener('gamepadconnected', () => this._renderLocal());
    window.addEventListener('gamepaddisconnected', () => this._renderLocal());
  }

  _renderLocal() {
    const pads = this.input.gamepads().length;
    this.$('local-setup')
      .querySelectorAll('.seg-btn')
      .forEach((btn) => btn.setAttribute('aria-checked', String(Number(btn.dataset.count) === this.localCount)));

    const list = this.$('local-players');
    list.textContent = '';
    const used = new Map();
    for (let i = 0; i < this.localCount; i++) used.set(this.localDevices[i], (used.get(this.localDevices[i]) || 0) + 1);

    let problems = 0;
    for (let i = 0; i < this.localCount; i++) {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = hex(CAR_DEFS[i].color);
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = `P${i + 1}`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Controls for player ${i + 1}`);
      for (const d of LOCAL_DEVICES) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = DEVICE_LABELS[d];
        select.appendChild(opt);
      }
      select.value = this.localDevices[i];
      select.addEventListener('change', () => {
        this.localDevices[i] = select.value;
        this._renderLocal();
      });
      li.append(sw, name, select);

      const dev = this.localDevices[i];
      let warn = '';
      if (used.get(dev) > 1) warn = 'Used by another player';
      else if (dev.startsWith('gamepad-') && Number(dev.slice(8)) >= pads) warn = 'Not connected';
      if (warn) {
        problems++;
        const w = document.createElement('span');
        w.className = 'warn';
        w.textContent = warn;
        li.appendChild(w);
      }
      list.appendChild(li);
    }

    const duplicate = [...used.values()].some((n) => n > 1);
    this.$('local-start').disabled = duplicate;
    this.$('pad-status').textContent =
      `${pads} gamepad${pads === 1 ? '' : 's'} detected. ` +
      (problems ? 'Plug in a controller and press any button on it to wake it up.' : '');
  }

  startLocal() {
    this.audio.unlock();
    const humans = [];
    for (let i = 0; i < CONFIG.TOTAL_CARS; i++) {
      humans.push(i < this.localCount ? { kind: 'local', name: `P${i + 1}`, device: this.localDevices[i] } : null);
    }
    this.game.startMatch({ mode: 'offline', slots: fillSlots(humans, this._bots('local')) });
    this._beginMatch();
  }

  // ----- Online -------------------------------------------------------------------

  _bindOnline() {
    this.$('online-back').addEventListener('click', () => this.show('menu'));
    this.$('create-room').addEventListener('click', () => this._createRoom());
    this.$('join-room').addEventListener('click', () => this._joinRoom());
    this.$('join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._joinRoom();
    });
    this.$('lobby-start').addEventListener('click', () => {
      if (this.session && this.session.isHost) {
        this.session.startMatch();
        this._beginMatch();
      }
    });
    this.$('lobby-leave').addEventListener('click', () => this.leaveOnline());
  }

  _uiCallbacks() {
    return {
      onLobby: (players, session) => this._renderLobby(players, session),
      onStatus: (msg) => {
        this._setStatus('lobby-status', msg);
        this._setStatus('online-status', msg);
      },
      onMatchStart: () => this._beginMatch(),
      onClosed: (reason) => {
        this.session = null;
        this.game.quitToMenu();
        this.hud.showTouch(false);
        this.show('online-menu');
        this._setStatus('online-status', reason);
      },
    };
  }

  _playerName() {
    const name = this.$('online-name').value.trim();
    if (name) saveName(name);
    return name;
  }

  async _createRoom() {
    if (!onlineSupported()) return;
    this._setBusy(true);
    this._setStatus('online-status', 'Creating room…');
    const session = new OnlineSession(this.game, this._uiCallbacks());
    try {
      session.botCount = this._bots('online');
      const code = await session.host(this._playerName() || 'Host');
      this.session = session;
      this.$('lobby-code').textContent = code;
      this._setStatus('lobby-status', '');
      this._renderLobby(session.players, session);
      this.show('lobby');
    } catch (err) {
      session.close(false);
      this._setStatus('online-status', err.message);
    } finally {
      this._setBusy(false);
    }
  }

  async _joinRoom() {
    if (!onlineSupported()) return;
    const code = this.$('join-code').value;
    this._setBusy(true);
    this._setStatus('online-status', 'Joining…');
    const session = new OnlineSession(this.game, this._uiCallbacks());
    try {
      await session.join(code, this._playerName() || 'Guest');
      this.session = session;
      this.$('lobby-code').textContent = session.code;
      this._setStatus('lobby-status', 'Waiting for the host to start the match…');
      this._renderLobby(session.players, session);
      this.show('lobby');
    } catch (err) {
      this._setStatus('online-status', err.message);
    } finally {
      this._setBusy(false);
    }
  }

  _setBusy(busy) {
    this.$('create-room').disabled = busy;
    this.$('join-room').disabled = busy;
  }

  _renderLobby(players, session) {
    const list = this.$('lobby-list');
    list.textContent = '';
    let botsLeft = session ? (session.isHost ? session.effectiveBots : session.botCount) : 0;
    for (let i = 0; i < CONFIG.TOTAL_CARS; i++) {
      const p = players.find((pl) => pl.slot === i);
      const li = document.createElement('li');
      const isBot = !p && botsLeft > 0;
      if (isBot) botsLeft--;
      if (!p) li.classList.add(isBot ? 'bot' : 'empty');
      if (p && session && p.slot === session.slot) li.classList.add('me');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = hex(CAR_DEFS[i].color);
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p ? p.name : isBot ? `${CAR_DEFS[i].botName} (bot)` : 'Empty seat';
      li.append(sw, name);
      if (p && p.slot === 0) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'HOST';
        li.appendChild(b);
      }
      list.appendChild(li);
    }
    const isHost = !!(session && session.isHost);
    const start = this.$('lobby-start');
    start.classList.toggle('hidden', !isHost);
    start.textContent = `Start Match (${players.length} player${players.length === 1 ? '' : 's'})`;
    this._renderSteppers();
  }

  leaveOnline() {
    if (this.session) this.session.close(true);
    this.session = null;
    this.game.quitToMenu();
    this.hud.showTouch(false);
    this.show('menu');
  }

  _setStatus(id, text) {
    this.$(id).textContent = text || '';
  }

  // ----- Bot count steppers ---------------------------------------------------------

  /** Allowed bot range for a mode given the humans currently in it. Matches need 2+ cars. */
  _botRange(mode) {
    let humans = 1;
    if (mode === 'local') humans = this.localCount;
    else if (mode === 'online') humans = this.session ? this.session.players.length : 1;
    return { min: humans < 2 ? 1 : 0, max: CONFIG.TOTAL_CARS - humans };
  }

  _bots(mode) {
    const { min, max } = this._botRange(mode);
    return Math.min(max, Math.max(min, this.botCounts[mode]));
  }

  _bindSteppers() {
    document.querySelectorAll('.stepper').forEach((el) => {
      const mode = el.dataset.stepper;
      el.querySelectorAll('.step-btn').forEach((btn) =>
        btn.addEventListener('click', () => {
          const next = this._bots(mode) + Number(btn.dataset.step);
          const { min, max } = this._botRange(mode);
          this.botCounts[mode] = Math.min(max, Math.max(min, next));
          saveNumber(`cartag-bots-${mode}`, this.botCounts[mode]);
          if (mode === 'online' && this.session && this.session.isHost) this.session.setBotCount(this.botCounts[mode]);
          this._renderSteppers();
        })
      );
    });
  }

  _renderSteppers() {
    document.querySelectorAll('.stepper').forEach((el) => {
      const mode = el.dataset.stepper;
      const guest = mode === 'online' && this.session && !this.session.isHost;
      const value = guest ? this.session.botCount : this._bots(mode);
      const { min, max } = this._botRange(mode);
      el.classList.toggle('readonly', !!guest);
      el.querySelector('.step-val').textContent = String(value);
      const [minus, plus] = el.querySelectorAll('.step-btn');
      minus.disabled = value <= min;
      plus.disabled = value >= max;
    });
    const soloHint = document.querySelector('[data-hint="solo"]');
    if (soloHint) {
      const n = this._bots('solo');
      soloHint.textContent = `${n + 1} cars in the arena. Fewer bots means more room to escape.`;
    }
  }

  // ----- Pause ----------------------------------------------------------------------

  _bindPause() {
    this.$('resume-btn').addEventListener('click', () => this.togglePause());
    this.$('restart-btn').addEventListener('click', () => {
      this.audio.unlock();
      this.game.restart();
      this._beginMatch();
    });
    this.$('quit-btn').addEventListener('click', () => this.quit());
  }

  togglePause() {
    const pauseOpen = !this.$('pause').classList.contains('hidden');
    if (pauseOpen) {
      this._hide('pause');
      this.game.setPaused(false);
      return;
    }
    if (!this.game.isRunning) return;
    const online = !!this.session;
    this.$('restart-btn').classList.toggle('hidden', online);
    this.$('pause-note').classList.toggle('hidden', !online);
    this.$('quit-btn').textContent = online ? 'Leave Match' : 'Quit to Menu';
    if (this.game.setPaused(true)) this.show('pause');
  }

  /** Auto-pause when the tab is hidden (offline only; online keeps running). */
  pauseIfRunning() {
    if (this.game.isRunning && this.$('pause').classList.contains('hidden') && !this.session) this.togglePause();
  }

  quit() {
    this.game.setPaused(false);
    if (this.session) {
      this.leaveOnline();
      return;
    }
    this.game.quitToMenu();
    this.hud.showTouch(false);
    this.show('menu');
  }

  // ----- Results ---------------------------------------------------------------------

  _bindResults() {
    this.$('again-btn').addEventListener('click', () => this.playAgain());
    this.$('menu-btn').addEventListener('click', () => {
      if (this.session) this.leaveOnline();
      else {
        this.game.quitToMenu();
        this.show('menu');
      }
    });
  }

  playAgain() {
    if (this.game.state !== GameState.ENDED) return;
    this.audio.unlock();
    if (this.session) {
      if (!this.session.isHost) return;
      this.session.startMatch();
    } else {
      this.game.restart();
    }
    this._beginMatch();
  }

  /** Keyboard shortcut: Enter on the title starts solo, on results plays again. */
  onEnter() {
    if (!this.$('menu').classList.contains('hidden')) this.startSolo();
    else if (!this.$('results').classList.contains('hidden')) this.playAgain();
  }
}
