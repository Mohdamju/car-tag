import * as THREE from '../lib/three.module.min.js';
import { CONFIG, wrapAngle } from './config.js';
import { Arena } from './arena.js';
import { Car } from './car.js';
import { Bot } from './bot.js';
import { Crown, TargetArrow, makeLabel } from './crown.js';
import { Particles } from './particles.js';
import { CameraRig } from './camera.js';
import { resolvePair, contact, CONTACT } from './physics.js';
import { hex } from './hud.js';

// Six fixed car slots. Humans take slots from 0 upward; bots drive the rest.
export const CAR_DEFS = [
  { typeKey: 'muscle', color: 0x19d3ff, botName: 'Zippy', speedScale: 0.97, aggression: 1.0 },
  { typeKey: 'muscle', color: 0xff4d2e, botName: 'Blaze', speedScale: 0.97, aggression: 1.1 },
  { typeKey: 'monster', color: 0x8a5cff, botName: 'Crusher', speedScale: 1.0, aggression: 1.0 },
  { typeKey: 'muscle', color: 0x3dff7a, botName: 'Nitro Nick', speedScale: 0.95, aggression: 1.2 },
  { typeKey: 'monster', color: 0xff3df2, botName: 'Big Bertha', speedScale: 1.0, aggression: 0.9 },
  { typeKey: 'muscle', color: 0xff9a1f, botName: 'Drifty', speedScale: 0.96, aggression: 1.0 },
];

export const GameState = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ENDED: 'ended',
};

const STATE_CODES = [GameState.COUNTDOWN, GameState.PLAYING, GameState.ENDED];
const MAX_PHYSICS_STEP = 1 / 90;
const NITRO_KEY_HINT = { 'kb-all': 'SHIFT', 'kb-wasd': 'L-SHIFT', 'kb-arrows': 'R-SHIFT' };

const LAYOUTS = {
  1: [[0, 0, 1, 1]],
  2: [
    [0, 0, 0.5, 1],
    [0.5, 0, 0.5, 1],
  ],
  4: [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 0.5, 0.5],
    [0, 0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.5],
  ],
};

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Owns the simulation: cars, bots, crown rules, scoring, match flow and the
 * split-screen views. Runs in one of three modes:
 *   offline - everything local (solo or split-screen)
 *   host    - authoritative simulation; streams snapshots to guests
 *   client  - online guest: predicts its own car, interpolates the rest from host snapshots
 */
export class Game {
  constructor({ scene, hud, audio, input, platform }) {
    this.scene = scene;
    this.hud = hud;
    this.audio = audio;
    this.input = input;
    this.platform = platform;
    this.session = null; // OnlineSession while playing online
    this.onMatchEnded = null; // callback(main) when results are shown

    this.arena = new Arena(scene);
    this.particles = new Particles(scene, 700);
    this.crown = new Crown(scene);

    this.mode = 'offline';
    this.state = GameState.MENU;
    this.paused = false;
    this.cars = [];
    this.bots = [];
    this.labels = [];
    this.arrows = [];
    this.slots = [];
    this.views = [];
    this.holder = null;
    this.remoteControls = [];

    this.matchTime = CONFIG.MATCH_TIME;
    this.countdown = CONFIG.COUNTDOWN_TIME;
    this.tagLock = 0;
    this._lastCountdownInt = -1;
    this._smokeAcc = 0;
    this._ctx = { cars: this.cars, holder: null };
    this._viewport = { w: 1280, h: 720, pixelRatio: 1 };
    this._lastSetup = null;

    // Client-side networking state
    this.net = { latency: 0.05, correction: new THREE.Vector3(), awaitingFirst: false, localSlot: 0 };

    this.overview = this._makeView(null, [0, 0, 1, 1]);
    this.overview.rig.mode = 'orbit';

    this._createCars();
    this._placeOnSpawns();
    this._setHolder(this.cars[Math.floor(Math.random() * this.cars.length)], true);
  }

  // ----- Setup --------------------------------------------------------------

  _createCars() {
    CAR_DEFS.forEach((def, i) => {
      const car = new Car({ id: `car${i}`, name: def.botName, typeKey: def.typeKey, color: def.color, speedScale: def.speedScale });
      car.slot = i;
      car.isBot = true;
      this.cars.push(car);
      this.bots.push(new Bot(car, this.arena, { aggression: def.aggression, wobble: 0.04 + Math.random() * 0.05 }));
      this.remoteControls.push({ throttle: 0, brake: 0, steer: 0, boost: false, drift: false });
      this.scene.add(car.root);
      this.arrows.push(new TargetArrow(this.scene, car.color));
      const label = makeLabel(car.name, car.color);
      this.scene.add(label);
      this.labels.push(label);
    });
  }

  _setLabel(i, text) {
    const old = this.labels[i];
    const label = makeLabel(text, this.cars[i].color);
    this.scene.remove(old);
    old.material.map.dispose();
    old.material.dispose();
    this.scene.add(label);
    this.labels[i] = label;
  }

  _makeView(car, rect) {
    const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV, 16 / 9, 0.3, 900);
    const rig = new CameraRig(camera, this.arena);
    return { car, camera, rig, rect, hud: null, hudConfig: null, controls: { throttle: 0, brake: 0, steer: 0, boost: false, drift: false } };
  }

  /** Cars driven by humans on this device, in split-screen order. */
  get localCars() {
    return this.views.map((v) => v.car);
  }

  // ----- Match setup --------------------------------------------------------

  /**
   * @param {{mode: 'offline'|'host'|'client', slots: Array<{kind: 'local'|'bot'|'remote', name?: string, device?: string}>}} setup
   * One entry per car slot (CONFIG.TOTAL_CARS).
   */
  startMatch(setup) {
    this._lastSetup = setup;
    this.mode = setup.mode;
    this.slots = setup.slots;
    this.paused = false;

    // Configure every car for its controller.
    const localSlots = [];
    this.cars.forEach((car, i) => {
      const slot = this.slots[i] || { kind: 'bot' };
      car.isBot = slot.kind === 'bot';
      car.isPlayer = slot.kind === 'local';
      car.name = car.isBot ? CAR_DEFS[i].botName : slot.name;
      car.netBuf.length = 0;
      this._setLabel(i, car.name);
      const rc = this.remoteControls[i];
      rc.throttle = rc.brake = rc.steer = 0;
      rc.boost = rc.drift = false;
      if (slot.kind === 'local') localSlots.push(i);
    });

    // Split-screen views.
    const n = localSlots.length;
    const layout = LAYOUTS[n >= 3 ? 4 : n] || LAYOUTS[1];
    this.views = localSlots.map((slotIndex, k) => {
      const car = this.cars[slotIndex];
      const view = this._makeView(car, layout[k]);
      view.rig.mode = 'follow';
      view.device = this.slots[slotIndex].device || 'kb-all';
      view.hudConfig = {
        rect: layout[k],
        compact: n > 1,
        tagText: n > 1 ? car.name : '',
        tagColor: hex(car.color),
        nitroKey: n > 1 ? NITRO_KEY_HINT[view.device] || 'A / RB' : 'SHIFT',
      };
      return view;
    });
    const huds = this.hud.buildPlayerHuds(this.views);
    this.views.forEach((v, k) => (v.hud = huds[k]));
    this.arena.setShadowSpan(n > 1 ? 88 : 55);

    if (this.mode === 'client') {
      this.net.localSlot = localSlots[0];
      this.net.awaitingFirst = true;
      this.net.correction.set(0, 0, 0);
      this.matchTime = CONFIG.MATCH_TIME;
      this.countdown = CONFIG.COUNTDOWN_TIME;
      this.tagLock = 0;
      for (const car of this.cars) car.reset(car.pos.x, car.pos.z, car.heading);
    } else {
      this._resetMatch();
    }

    this.state = GameState.COUNTDOWN;
    this._lastCountdownInt = -1;
    for (const v of this.views) v.rig.snapBehind(v.car);
    this.hud.buildScoreboard(this.cars, this.localCars);
    this.hud.clearFeed();
    this.hud.hideResults();
    this.hud.setTimer(this.matchTime);
    this.hud.updateScoreboard(this.cars);
    this.hud.showHUD(true);
    this.platform.gameplayStart();
  }

  /** Same players, new match (offline "Play Again"). */
  restart() {
    if (this._lastSetup) this.startMatch(this._lastSetup);
  }

  _placeOnSpawns() {
    const spawns = this.arena.spawns.slice();
    for (let i = spawns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
    }
    this.cars.forEach((car, i) => {
      const s = spawns[i % spawns.length];
      car.reset(s.x, s.z, s.heading);
    });
  }

  _resetMatch() {
    this._placeOnSpawns();
    for (const bot of this.bots) {
      bot.recoverTimer = 0;
      bot.stuckTimer = 0;
      bot.escapeAge = 99;
      bot.escapeTimer = 0;
    }
    this.matchTime = CONFIG.MATCH_TIME;
    this.countdown = CONFIG.COUNTDOWN_TIME;
    this.tagLock = 1.0;
    this._setHolder(this.cars[Math.floor(Math.random() * this.cars.length)], true);
  }

  _setHolder(car, snap = false) {
    for (const c of this.cars) c.hasCrown = false;
    car.hasCrown = true;
    this.holder = car;
    this._ctx.holder = car;
    this.crown.setTarget(car, snap);
  }

  /** Back to the title screen (also used when leaving an online room). */
  quitToMenu() {
    this.state = GameState.MENU;
    this.mode = 'offline';
    this.paused = false;
    this.views = [];
    this.hud.buildPlayerHuds([]);
    this.hud.showHUD(false);
    this.hud.hideResults();
    this.hud.clearFeed();
    this.arena.setShadowSpan(55);
    this.audio.setEngine(0, 0, false, false);
    this.platform.gameplayStop();
    this.cars.forEach((car, i) => {
      car.isPlayer = false;
      car.clearControls();
      car.netBuf.length = 0;
      if (car.name !== CAR_DEFS[i].botName) {
        car.name = CAR_DEFS[i].botName;
        this._setLabel(i, car.name);
      }
    });
  }

  // ----- Pause (offline only actually freezes the world) ----------------------

  get canFreeze() {
    return this.mode === 'offline';
  }

  setPaused(paused) {
    if (this.state !== GameState.COUNTDOWN && this.state !== GameState.PLAYING) return false;
    this.paused = paused && this.canFreeze;
    this.input.enabled = !paused;
    if (paused) this.platform.gameplayStop();
    else this.platform.gameplayStart();
    return true;
  }

  get isRunning() {
    return this.state === GameState.COUNTDOWN || this.state === GameState.PLAYING;
  }

  // ----- Per-frame update -----------------------------------------------------

  update(dt) {
    if (!this.paused) {
      if (this.mode === 'client' && this.state !== GameState.MENU) this._updateClient(dt);
      else if (this.state === GameState.COUNTDOWN) this._updateCountdown(dt);
      else if (this.state === GameState.PLAYING) this._updatePlaying(dt);
      else this._idle();

      this.crown.update(dt, this.tagLock > 0 && this.state === GameState.PLAYING);
      this.particles.update(dt);
    }

    this._syncVisuals(this.paused ? 0 : dt);

    if (!this.paused) {
      for (const v of this.views) v.rig.update(dt, v.car);
      this.overview.rig.update(dt, null);
    }

    // Shadows follow the local players (centroid for split-screen).
    if (this.views.length) {
      let x = 0;
      let z = 0;
      for (const v of this.views) {
        x += v.car.pos.x;
        z += v.car.pos.z;
      }
      this.arena.followWithSun(x / this.views.length, z / this.views.length);
    } else {
      this.arena.followWithSun(0, 0);
    }

    if (this.isRunning) {
      this.hud.updateScoreboard(this.cars);
      this.views.forEach((v) => v.hud.update(v.car, this.holder, v.rig.heading));
      const p = this.views[0] && this.views[0].car;
      if (p && !this.paused) {
        this.audio.setEngine(Math.min(1.4, p.speed / p.spec.maxSpeed), p.controls.throttle, p.boosting, this.state === GameState.PLAYING);
      }
    }

    if (this.mode === 'host' && this.session) this.session.hostTick(dt);
  }

  _idle() {
    for (const car of this.cars) {
      car.vel.set(0, 0, 0);
      car.forwardSpeed = 0;
      car.boosting = false;
      car.clearControls();
    }
    this.audio.setEngine(0, 0, false, false);
  }

  _updateCountdown(dt) {
    this.countdown -= dt;
    this._presentCountdown();
    for (const car of this.cars) car.clearControls();
    this._stepPhysics(dt, false);
    if (this.countdown <= 0) {
      this.state = GameState.PLAYING;
      this._presentGo();
    }
  }

  _updatePlaying(dt) {
    this.matchTime -= dt;
    if (this.matchTime <= 0) {
      this.matchTime = 0;
      this._stepPhysics(dt, true);
      this.hud.setTimer(0);
      this._endMatch();
      return;
    }
    this.hud.setTimer(this.matchTime);

    this._gatherControls(dt);
    this._stepPhysics(dt, true);
    this.holder.holdTime += dt;
  }

  /** Fill every car's controls from its controller (local device, bot brain, or network). */
  _gatherControls(dt) {
    for (const v of this.views) this.input.read(v.device, v.car.controls);
    this.cars.forEach((car, i) => {
      const kind = this.slots[i] ? this.slots[i].kind : 'bot';
      if (kind === 'remote') Object.assign(car.controls, this.remoteControls[i]);
    });
    this.bots.forEach((bot) => {
      if (bot.car.isBot) bot.think(dt, this._ctx);
    });
  }

  /** Sub-stepped physics + collisions + tag rules (offline / host). */
  _stepPhysics(dt, tagging) {
    const steps = Math.max(1, Math.ceil(dt / MAX_PHYSICS_STEP));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const car of this.cars) car.update(h, this.arena);
      this._carCollisions(tagging);
      if (tagging) this._tagLogic(h);
    }
    this._effects(dt);
  }

  _carCollisions(tagging) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const strength = resolvePair(cars[i], cars[j]);
        if (strength > 6) {
          for (const v of this.views) {
            if (v.car === cars[i] || v.car === cars[j]) v.rig.addShake(Math.min(0.5, strength * 0.02));
          }
          if (this.views[0] && (this.views[0].car === cars[i] || this.views[0].car === cars[j])) this.audio.bump(strength);
          if (tagging) this.particles.burst(CONTACT.px, Math.max(cars[i].pos.y, cars[j].pos.y) + 1, CONTACT.pz, 6);
        }
      }
    }
  }

  /** Crown transfer: chaser touching the holder steals it unless the 0.5 s lock is active. */
  _tagLogic(dt) {
    if (this.tagLock > 0) {
      this.tagLock = Math.max(0, this.tagLock - dt);
      return;
    }
    const holder = this.holder;
    for (const car of this.cars) {
      if (car === holder) continue;
      if (contact(car, holder, CONFIG.TAG_EXTRA_REACH)) {
        const px = CONTACT.px;
        const pz = CONTACT.pz;
        this._setHolder(car);
        this.tagLock = CONFIG.TAG_COOLDOWN;
        this._presentTag(holder, car, px, pz);
        if (this.session && this.mode === 'host') this.session.sendEvent({ e: 'tag', f: holder.slot, t: car.slot, x: r2(px), z: r2(pz) });
        return;
      }
    }
  }

  _endMatch() {
    this.state = GameState.ENDED;
    this.matchTime = 0;
    this.hud.setTimer(0);
    for (const car of this.cars) {
      car.clearControls();
      car.holdTime = r2(car.holdTime); // identical final numbers on host and guests
    }
    if (this.session && this.mode === 'host') {
      this.session.sendEvent({ e: 'end', ht: this.cars.map((c) => r2(c.holdTime)) });
    }
    this._presentEnd();
  }

  // ----- Presentation (shared by authoritative and guest modes) ---------------

  _presentCountdown() {
    const n = Math.ceil(this.countdown);
    if (n !== this._lastCountdownInt && this.countdown > 0) {
      this._lastCountdownInt = n;
      this.hud.setCenter(String(n));
      this.audio.tick();
    }
  }

  _presentGo() {
    this.hud.setCenter('GO!');
    this.audio.go();
    setTimeout(() => {
      if (this.state === GameState.PLAYING) this.hud.setCenter('', false);
    }, 700);
    const holder = this.holder;
    for (const v of this.views) {
      if (holder === v.car) v.hud.showToast('YOU HAVE THE CROWN! RUN!', '#ffe500');
      else v.hud.showToast(`${holder.name} has the crown - get it!`, '#39f0ff');
    }
  }

  _presentTag(from, to, px, pz) {
    this.crown.onTransfer();
    const y = Math.max(from.pos.y, to.pos.y) + 1.2;
    this.particles.burst(px, y, pz, 46);
    const single = this.views.length === 1 ? this.views[0].car : null;
    const nameOf = (c, subject) => (c === single ? (subject ? 'You' : 'you') : c.name);
    this.hud.pushFeed(`${nameOf(to, true)} tagged ${nameOf(from, false)}`, hex(to.color));

    let localInvolved = false;
    for (const v of this.views) {
      if (v.car === to) {
        v.hud.showToast('YOU HAVE THE CROWN! RUN!', '#ffe500');
        v.rig.addShake(0.6);
        localInvolved = true;
      } else if (v.car === from) {
        v.hud.showToast(`${to.name} stole the crown!`, '#39f0ff');
        v.rig.addShake(0.5);
      }
    }
    this.audio.tag(localInvolved);
  }

  _presentEnd() {
    this.hud.setCenter("TIME'S UP!");
    this.audio.end();
    this.audio.setEngine(0, 0, false, false);
    this.platform.gameplayStop();
    const sorted = this.cars.slice().sort((a, b) => b.holdTime - a.holdTime);
    const local = this.localCars;
    // Brief beat so "TIME'S UP!" is visible before the full-screen leaderboard.
    setTimeout(() => {
      if (this.state !== GameState.ENDED) return;
      this.hud.setCenter('', false);
      this.hud.showHUD(false);
      this.views = [];
      this.hud.buildPlayerHuds([]);
      this.hud.showResults(sorted, local, {
        canRestart: this.mode !== 'client',
        note: this.mode === 'client' ? 'Waiting for the host to start the next match…' : '',
      });
      this.platform.happyTime(local.includes(sorted[0]));
      if (this.onMatchEnded) this.onMatchEnded();
    }, 1100);
  }

  // ----- Online: host side ------------------------------------------------------

  /** Compact world state broadcast to guests ~20x per second. */
  makeSnapshot() {
    return {
      t: 'snap',
      st: Math.max(0, STATE_CODES.indexOf(this.state)),
      mt: r2(this.matchTime),
      cd: r2(this.countdown),
      h: this.holder.slot,
      tl: r2(this.tagLock),
      c: this.cars.map((c) => [
        r2(c.pos.x),
        r2(c.pos.y),
        r2(c.pos.z),
        r3(c.heading),
        r3(c.pitch),
        r3(c.roll),
        r2(c.vel.x),
        r2(c.vel.y),
        r2(c.vel.z),
        r2(c.forwardSpeed),
        r2(c.steerCur),
        (c.boosting ? 1 : 0) | (c.drifting ? 2 : 0) | (c.grounded ? 4 : 0) | (c.ghostTimer > 0 ? 8 : 0) | (c.nitroLocked ? 16 : 0),
        r1(c.nitro),
        r2(c.holdTime),
      ]),
    };
  }

  setRemoteControls(slot, arr) {
    const rc = this.remoteControls[slot];
    if (!rc || !Array.isArray(arr)) return;
    rc.throttle = Math.min(1, Math.max(0, Number(arr[0]) || 0));
    rc.brake = Math.min(1, Math.max(0, Number(arr[1]) || 0));
    rc.steer = Math.min(1, Math.max(-1, Number(arr[2]) || 0));
    rc.boost = !!arr[3];
    rc.drift = !!arr[4];
  }

  /** A guest left mid-match: a bot takes over the car. */
  convertToBot(slot) {
    if (!this.slots[slot]) return;
    this.slots[slot] = { kind: 'bot' };
    const car = this.cars[slot];
    car.isBot = true;
    car.name = CAR_DEFS[slot].botName;
    this._setLabel(slot, car.name);
    this.hud.buildScoreboard(this.cars, this.localCars);
  }

  // ----- Online: guest side -----------------------------------------------------

  applySnapshot(s) {
    if (this.mode !== 'client' || this.state === GameState.MENU || !s || !Array.isArray(s.c)) return;
    const now = performance.now() / 1000;
    const nextState = STATE_CODES[s.st] || GameState.COUNTDOWN;

    if (this.state === GameState.COUNTDOWN) this.countdown = s.cd;
    this.matchTime = s.mt;
    this.tagLock = s.tl;
    const holder = this.cars[s.h];
    if (holder && holder !== this.holder) this._setHolder(holder, this.net.awaitingFirst);

    const own = this.cars[this.net.localSlot];
    s.c.forEach((a, i) => {
      const car = this.cars[i];
      if (!car || !Array.isArray(a)) return;
      car.nitro = a[12];
      car.nitroLocked = (a[11] & 16) !== 0;
      car.holdTime = a[13];
      if (car === own) return;
      car.netBuf.push({ t: now, a });
      if (car.netBuf.length > 6) car.netBuf.shift();
    });

    if (own) this._reconcileOwn(own, s.c[this.net.localSlot]);

    if (this.net.awaitingFirst) {
      this.net.awaitingFirst = false;
      s.c.forEach((a, i) => {
        const car = this.cars[i];
        car.pos.set(a[0], a[1], a[2]);
        car.heading = a[3];
        car.vel.set(a[6], a[7], a[8]);
      });
      for (const v of this.views) v.rig.snapBehind(v.car);
      this.crown.setTarget(this.holder, true);
    }

    if (nextState === GameState.PLAYING && this.state === GameState.COUNTDOWN) {
      this.state = GameState.PLAYING;
      this._presentGo();
    }
  }

  /** Blend our locally-predicted car toward the host's authoritative state. */
  _reconcileOwn(car, a) {
    if (!a) return;
    const lat = Math.min(0.25, this.net.latency);
    const tx = a[0] + a[6] * lat;
    const tz = a[2] + a[8] * lat;
    const ex = tx - car.pos.x;
    const ez = tz - car.pos.z;
    const err = Math.hypot(ex, ez);
    const ghost = (a[11] & 8) !== 0;
    if (err > 6 || this.state === GameState.COUNTDOWN) {
      car.pos.set(tx, a[1], tz);
      car.vel.set(a[6], a[7], a[8]);
      car.heading = a[3];
      car.grounded = (a[11] & 4) !== 0;
      this.net.correction.set(0, 0, 0);
    } else {
      this.net.correction.set(ex, 0, ez);
      // Big velocity disagreement means the host resolved an impact we could not predict.
      const dvx = a[6] - car.vel.x;
      const dvz = a[8] - car.vel.z;
      if (Math.hypot(dvx, dvz) > 6) {
        car.vel.x = a[6];
        car.vel.z = a[8];
      }
      const dh = wrapAngle(a[3] - car.heading);
      if (Math.abs(dh) > 0.35) car.heading += dh * 0.3;
    }
    car.ghostTimer = ghost ? Math.max(car.ghostTimer, 0.1) : car.ghostTimer;
  }

  applyEvent(ev) {
    if (this.mode !== 'client' || !ev) return;
    if (ev.e === 'tag') {
      const from = this.cars[ev.f];
      const to = this.cars[ev.t];
      if (!from || !to) return;
      this._setHolder(to);
      this._presentTag(from, to, ev.x, ev.z);
    } else if (ev.e === 'end') {
      if (this.state === GameState.ENDED || this.state === GameState.MENU) return;
      if (Array.isArray(ev.ht)) ev.ht.forEach((t, i) => this.cars[i] && (this.cars[i].holdTime = t));
      this.state = GameState.ENDED;
      this.matchTime = 0;
      this.hud.setTimer(0);
      this._presentEnd();
    }
  }

  _updateClient(dt) {
    const own = this.cars[this.net.localSlot];

    if (this.state === GameState.COUNTDOWN) {
      this.countdown = Math.max(0, this.countdown - dt);
      this._presentCountdown();
      own.clearControls();
    } else if (this.state === GameState.PLAYING) {
      this.matchTime = Math.max(0, this.matchTime - dt);
      this.hud.setTimer(this.matchTime);
      for (const v of this.views) this.input.read(v.device, v.car.controls);
    } else {
      own.clearControls();
    }

    // Predict our own car with the same physics the host runs.
    if (this.state !== GameState.ENDED) {
      const steps = Math.max(1, Math.ceil(dt / MAX_PHYSICS_STEP));
      for (let s = 0; s < steps; s++) own.update(dt / steps, this.arena);
      const corr = this.net.correction;
      const k = Math.min(1, 10 * dt);
      own.pos.x += corr.x * k;
      own.pos.z += corr.z * k;
      corr.multiplyScalar(1 - k);
    }

    this._interpolateOthers(own);
    this._effects(dt);
    if (own.lastImpact > 6) {
      this.audio.bump(own.lastImpact);
      this.views[0].rig.addShake(Math.min(0.5, own.lastImpact * 0.02));
    }
  }

  _interpolateOthers(own) {
    const renderT = performance.now() / 1000 - CONFIG.NET_INTERP_DELAY;
    for (const car of this.cars) {
      if (car === own) continue;
      const buf = car.netBuf;
      if (!buf.length) continue;
      let a = buf[0];
      let b = buf[0];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].t <= renderT) a = buf[i];
        if (buf[i].t >= renderT) {
          b = buf[i];
          break;
        }
        b = buf[i];
      }
      const A = a.a;
      const B = b.a;
      let t = 0;
      let extra = 0;
      if (b.t > a.t) t = Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t)));
      else if (renderT > b.t) extra = Math.min(0.2, renderT - b.t); // ran out of data: extrapolate briefly
      const lerp = (i) => A[i] + (B[i] - A[i]) * t;
      car.pos.set(lerp(0) + B[6] * extra, lerp(1), lerp(2) + B[8] * extra);
      car.heading = A[3] + wrapAngle(B[3] - A[3]) * t;
      car.pitch = lerp(4);
      car.roll = lerp(5);
      car.vel.set(B[6], B[7], B[8]);
      car.forwardSpeed = B[9];
      car.steerCur = B[10];
      car.boosting = (B[11] & 1) !== 0;
      car.drifting = (B[11] & 2) !== 0;
      car.grounded = (B[11] & 4) !== 0;
      car.ghostTimer = (B[11] & 8) !== 0 ? 0.5 : 0;
      car.lastLanding = 0;
    }
  }

  // ----- Effects & visuals ----------------------------------------------------

  /** Smoke, drift trails, nitro sparks, landing dust. */
  _effects(dt) {
    this._smokeAcc += dt;
    const emit = this._smokeAcc > 0.03;
    if (emit) this._smokeAcc = 0;
    for (const car of this.cars) {
      if (car.lastLanding > 10) this.particles.burst(car.pos.x, car.pos.y + 0.3, car.pos.z, 8);
      if (!emit) continue;
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      if (car.grounded && car.drifting) {
        const sx = Math.cos(car.heading) * car.spec.track;
        const sz = -Math.sin(car.heading) * car.spec.track;
        this.particles.smoke(car.pos.x - fx * 1.3 + sx, car.pos.y, car.pos.z - fz * 1.3 + sz, car.vel.x, car.vel.z);
        this.particles.smoke(car.pos.x - fx * 1.3 - sx, car.pos.y, car.pos.z - fz * 1.3 - sz, car.vel.x, car.vel.z);
      }
      if (car.boosting) {
        const back = car.typeKey === 'monster' ? 2.4 : 2.3;
        const up = car.typeKey === 'monster' ? 2.0 : 0.5;
        for (const side of [-0.6, 0.6]) {
          const sx = Math.cos(car.heading) * side;
          const sz = -Math.sin(car.heading) * side;
          this.particles.spark(
            car.pos.x - fx * back + sx,
            car.pos.y + up,
            car.pos.z - fz * back + sz,
            car.vel.x * 0.4 - fx * 6 + (Math.random() - 0.5) * 3,
            (Math.random() - 0.2) * 2,
            car.vel.z * 0.4 - fz * 6 + (Math.random() - 0.5) * 3,
            0.3,
            0.7,
            1
          );
        }
      }
    }
  }

  _syncVisuals(dt) {
    const showArrows = this.isRunning;
    this.cars.forEach((car, i) => {
      if (this.mode === 'client' && car.slot !== this.net.localSlot && dt > 0) {
        // Guests do not run physics for other cars; keep the ghost flicker timing alive.
        car.ghostTimer = Math.max(0, car.ghostTimer - dt);
      }
      car.syncMesh(dt);
      this.labels[i].position.set(car.pos.x, car.pos.y + car.spec.labelHeight, car.pos.z);
      this.arrows[i].update(dt, car, this.holder, showArrows);
    });
  }

  // ----- Rendering support (called by main.js) -----------------------------------

  setViewport(w, h, pixelRatio) {
    this._viewport.w = w;
    this._viewport.h = h;
    this._viewport.pixelRatio = pixelRatio;
  }

  /** Views to draw this frame. The 4th quadrant of 3-player split shows an overview. */
  renderViews() {
    if (this.isRunning && this.views.length) {
      if (this.views.length === 3) {
        this.overview.rect = LAYOUTS[4][3];
        return [...this.views, this.overview];
      }
      return this.views;
    }
    this.overview.rect = LAYOUTS[1][0];
    return [this.overview];
  }

  /** Per-view tweaks right before rendering (hide your own name tag, size particles). */
  prepareView(view, heightPx) {
    this.cars.forEach((car, i) => {
      this.labels[i].visible = car !== view.car;
    });
    this.particles.setView(heightPx, view.camera.fov);
  }
}
