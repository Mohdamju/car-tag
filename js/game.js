import * as THREE from '../lib/three.module.min.js';
import { CONFIG } from './config.js';
import { Arena } from './arena.js';
import { Car } from './car.js';
import { Bot } from './bot.js';
import { Crown, TargetArrow, makeLabel } from './crown.js';
import { Particles } from './particles.js';
import { CameraRig } from './camera.js';
import { resolvePair, contact, CONTACT } from './physics.js';

const PLAYER_DEF = { name: 'You', typeKey: 'muscle', color: 0x19d3ff };

const BOT_DEFS = [
  { name: 'Blaze', typeKey: 'muscle', color: 0xff4d2e, speedScale: 0.97, aggression: 1.1 },
  { name: 'Crusher', typeKey: 'monster', color: 0x8a5cff, speedScale: 1.0, aggression: 1.0 },
  { name: 'Nitro Nick', typeKey: 'muscle', color: 0x3dff7a, speedScale: 0.95, aggression: 1.2 },
  { name: 'Big Bertha', typeKey: 'monster', color: 0xff3df2, speedScale: 1.0, aggression: 0.9 },
  { name: 'Drifty', typeKey: 'muscle', color: 0xff9a1f, speedScale: 0.96, aggression: 1.0 },
  { name: 'Rocket', typeKey: 'muscle', color: 0xf4f6ff, speedScale: 0.94, aggression: 1.1 },
];

export const GameState = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ENDED: 'ended',
};

const MAX_PHYSICS_STEP = 1 / 90;

/**
 * Owns the simulation: cars, bots, crown rules, scoring and match flow.
 * Rendering is done by main.js; this class only mutates the scene graph.
 */
export class Game {
  constructor({ scene, camera, hud, audio, input, platform }) {
    this.scene = scene;
    this.hud = hud;
    this.audio = audio;
    this.input = input;
    this.platform = platform;

    this.arena = new Arena(scene);
    this.particles = new Particles(scene, 700);
    this.camRig = new CameraRig(camera, this.arena);
    this.crown = new Crown(scene);

    this.state = GameState.MENU;
    this.prevState = GameState.MENU;
    this.cars = [];
    this.bots = [];
    this.arrows = new Map();
    this.labels = new Map();
    this.player = null;
    this.holder = null;

    this.matchTime = CONFIG.MATCH_TIME;
    this.countdown = CONFIG.COUNTDOWN_TIME;
    this.tagLock = 0;
    this._lastCountdownInt = -1;
    this._smokeAcc = 0;
    this._ctx = { cars: this.cars, holder: null };

    this._createCars();
    this.hud.buildScoreboard(this.cars);
    this.resetMatch(false);
  }

  // ----- Setup --------------------------------------------------------------

  _createCars() {
    const player = new Car({ id: 'player', isPlayer: true, ...PLAYER_DEF });
    this.player = player;
    this.cars.push(player);

    const botCount = Math.min(Math.max(CONFIG.BOT_COUNT, 4), BOT_DEFS.length);
    for (let i = 0; i < botCount; i++) {
      const def = BOT_DEFS[i];
      const car = new Car({ id: `bot${i}`, name: def.name, typeKey: def.typeKey, color: def.color, speedScale: def.speedScale });
      this.cars.push(car);
      this.bots.push(new Bot(car, this.arena, { aggression: def.aggression, wobble: 0.04 + Math.random() * 0.05 }));
    }

    for (const car of this.cars) {
      this.scene.add(car.root);
      const arrow = new TargetArrow(this.scene, car.color);
      this.arrows.set(car.id, arrow);
      const label = makeLabel(car.isPlayer ? 'YOU' : car.name, car.color);
      this.scene.add(label);
      this.labels.set(car.id, label);
    }
  }

  /** Put every car on a (shuffled) spawn point and hand the crown to a random car. */
  resetMatch(giveCrown = true) {
    const spawns = this.arena.spawns.slice();
    for (let i = spawns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
    }
    this.cars.forEach((car, i) => {
      const s = spawns[i % spawns.length];
      car.reset(s.x, s.z, s.heading);
    });
    for (const bot of this.bots) {
      bot.recoverTimer = 0;
      bot.stuckTimer = 0;
      bot.escapeAge = 99;
      bot.escapeTimer = 0;
    }

    this.matchTime = CONFIG.MATCH_TIME;
    this.countdown = CONFIG.COUNTDOWN_TIME;
    this._lastCountdownInt = -1;
    this.tagLock = 1.0;

    const first = this.cars[Math.floor(Math.random() * this.cars.length)];
    this._setHolder(first, true);
    if (!giveCrown) this.tagLock = 0;

    this.camRig.snapBehind(this.player);
    this.hud.clearFeed();
    this.hud.setTimer(this.matchTime);
    this.hud.updateScoreboard(this.cars);
  }

  _setHolder(car, snap = false) {
    for (const c of this.cars) c.hasCrown = false;
    car.hasCrown = true;
    this.holder = car;
    this._ctx.holder = car;
    this.crown.setTarget(car, snap);
    // Nitro/speed handicap applies instantly; clamp locked state so a drained holder stays drained.
  }

  // ----- Flow control ---------------------------------------------------------

  startMatch() {
    this.resetMatch(true);
    this.state = GameState.COUNTDOWN;
    this.camRig.mode = 'follow';
    this.hud.showMenu(false);
    this.hud.hideResults();
    this.hud.showPause(false);
    this.hud.showHUD(true);
    this.platform.gameplayStart();
  }

  togglePause() {
    if (this.state === GameState.PLAYING || this.state === GameState.COUNTDOWN) {
      this.prevState = this.state;
      this.state = GameState.PAUSED;
      this.hud.showPause(true);
      this.platform.gameplayStop();
    } else if (this.state === GameState.PAUSED) {
      this.state = this.prevState;
      this.hud.showPause(false);
      this.platform.gameplayStart();
    }
  }

  pauseIfRunning() {
    if (this.state === GameState.PLAYING || this.state === GameState.COUNTDOWN) this.togglePause();
  }

  restartFromPause() {
    this.hud.showPause(false);
    this.startMatch();
  }

  _endMatch() {
    this.state = GameState.ENDED;
    this.matchTime = 0;
    this.hud.setTimer(0);
    this.hud.setCenter("TIME'S UP!");
    for (const car of this.cars) car.clearControls();
    this.audio.end();
    this.audio.setEngine(0, 0, false, false);
    this.platform.gameplayStop();
    this.camRig.mode = 'orbit';

    const sorted = this.cars.slice().sort((a, b) => b.holdTime - a.holdTime);
    // Brief beat so "TIME'S UP!" is visible before the full-screen leaderboard.
    setTimeout(() => {
      if (this.state !== GameState.ENDED) return;
      this.hud.setCenter('', false);
      this.hud.showHUD(false);
      this.hud.showResults(sorted, this.player);
      this.platform.happyTime(sorted[0] === this.player);
    }, 1100);
  }

  // ----- Per-frame update -----------------------------------------------------

  update(dt) {
    switch (this.state) {
      case GameState.MENU:
        this._animateIdle(dt);
        break;
      case GameState.COUNTDOWN:
        this._updateCountdown(dt);
        break;
      case GameState.PLAYING:
        this._updatePlaying(dt);
        break;
      case GameState.ENDED:
        this._animateIdle(dt);
        break;
      case GameState.PAUSED:
      default:
        break;
    }

    // Cosmetics that should keep running (or freeze) consistently.
    if (this.state !== GameState.PAUSED) {
      this.crown.update(dt, this.tagLock > 0 && this.state === GameState.PLAYING);
      this.particles.update(dt);
    }
    this._syncVisuals(dt);

    const followCar = this.camRig.mode === 'follow' ? this.player : null;
    if (this.state !== GameState.PAUSED) this.camRig.update(dt, followCar);
    this.arena.followWithSun(this.player.pos.x, this.player.pos.z);

    // HUD
    if (this.state === GameState.PLAYING || this.state === GameState.COUNTDOWN) {
      this.hud.updateScoreboard(this.cars);
      this.hud.setSpeed(this.player.speed * 3.6);
      this.hud.setNitro(this.player);
      this.hud.updatePointer(this.player, this.holder, this.camRig.heading);
    }
  }

  /** Menu / results: cars sit still, a little idle life (crown bob, camera orbit) keeps going. */
  _animateIdle(dt) {
    for (const car of this.cars) {
      car.vel.set(0, 0, 0);
      car.forwardSpeed = 0;
      car.boosting = false;
    }
    this.audio.setEngine(0, 0, false, false);
  }

  _updateCountdown(dt) {
    this.countdown -= dt;
    const n = Math.ceil(this.countdown);
    if (n !== this._lastCountdownInt && this.countdown > 0) {
      this._lastCountdownInt = n;
      this.hud.setCenter(String(n));
      this.audio.tick();
    }
    for (const car of this.cars) car.clearControls();
    this._stepPhysics(dt, false);
    if (this.countdown <= 0) {
      this.state = GameState.PLAYING;
      this.hud.setCenter('GO!');
      this.audio.go();
      setTimeout(() => {
        if (this.state === GameState.PLAYING) this.hud.setCenter('', false);
      }, 700);
      const holder = this.holder;
      this.hud.showToast(
        holder === this.player ? 'YOU HAVE THE CROWN! RUN!' : `${holder.name} has the crown - get it!`,
        holder === this.player ? '#ffe500' : '#39f0ff'
      );
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

    // Controls
    const input = this.input.poll();
    const pc = this.player.controls;
    pc.throttle = input.throttle;
    pc.brake = input.brake;
    pc.steer = input.steer;
    pc.boost = input.boost;
    pc.drift = input.drift;
    for (const bot of this.bots) bot.think(dt, this._ctx);

    this._stepPhysics(dt, true);

    // Scoring
    this.holder.holdTime += dt;

    // Audio
    const p = this.player;
    this.audio.setEngine(Math.min(1.4, p.speed / p.spec.maxSpeed), p.controls.throttle, p.boosting, true);
  }

  /** Sub-stepped physics + collisions + tag rules. */
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
          if (cars[i].isPlayer || cars[j].isPlayer) {
            this.audio.bump(strength);
            this.camRig.addShake(Math.min(0.5, strength * 0.02));
          }
          if (tagging) {
            this.particles.burst(CONTACT.px, Math.max(cars[i].pos.y, cars[j].pos.y) + 1, CONTACT.pz, 6);
          }
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
        this._transferCrown(holder, car, CONTACT.px, CONTACT.pz);
        return;
      }
    }
  }

  _transferCrown(from, to, px, pz) {
    this._setHolder(to);
    this.tagLock = CONFIG.TAG_COOLDOWN;
    this.crown.onTransfer();

    const y = Math.max(from.pos.y, to.pos.y) + 1.2;
    this.particles.burst(px, y, pz, 46);
    const hex = `#${to.color.toString(16).padStart(6, '0')}`;
    this.hud.pushFeed(`${to.isPlayer ? 'You' : to.name} tagged ${from.isPlayer ? 'you' : from.name}`, hex);

    if (to.isPlayer) {
      this.hud.showToast('YOU HAVE THE CROWN! RUN!', '#ffe500');
      this.audio.tag(true);
      this.camRig.addShake(0.6);
    } else if (from.isPlayer) {
      this.hud.showToast(`${to.name} stole the crown!`, '#39f0ff');
      this.audio.tag(false);
      this.camRig.addShake(0.5);
    } else {
      this.audio.tag(false);
    }
  }

  /** Smoke, drift trails, nitro sparks, landing dust. */
  _effects(dt) {
    this._smokeAcc += dt;
    const emit = this._smokeAcc > 0.03;
    if (emit) this._smokeAcc = 0;
    for (const car of this.cars) {
      if (car.lastLanding > 10) {
        this.particles.burst(car.pos.x, car.pos.y + 0.3, car.pos.z, 8);
      }
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
    const camDt = this.state === GameState.PAUSED ? 0 : dt;
    const showArrows = this.state === GameState.PLAYING || this.state === GameState.COUNTDOWN;
    for (const car of this.cars) {
      car.syncMesh(camDt);
      const label = this.labels.get(car.id);
      label.position.set(car.pos.x, car.pos.y + car.spec.labelHeight, car.pos.z);
      label.visible = !car.isPlayer || this.state === GameState.MENU;
      this.arrows.get(car.id).update(camDt, car, this.holder, showArrows);
    }
    this.particles.setView(this._viewHeight || 720, this.camRig.camera.fov);
  }

  setViewHeight(px) {
    this._viewHeight = px;
  }
}
