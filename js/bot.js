import { CONFIG, clamp, wrapAngle } from './config.js';

// Finite state machine driving a Car through the same control interface the
// player uses (throttle / brake / steer / boost / drift).
//
//   CHASE   - default. Steer at the crown holder (with lead prediction) and burn
//             nitro to ram when close and lined up.
//   EVADE   - this bot holds the crown. Score escape points (open space and
//             ramps), blend with a flee vector away from the nearest chaser and
//             only spend nitro when someone gets close (nitro never regenerates).
//   RECOVER - transient: reverse out when wedged against a wall / obstacle.
//
// Obstacle avoidance (all states): three forward probes sample the arena
// colliders (walls, crates, pillars, platform sides) and steer toward the side
// with more clearance; platform edges are also treated as blocked.

export const BotState = { CHASE: 'CHASE', EVADE: 'EVADE', RECOVER: 'RECOVER' };

const ESCAPE_REFRESH = 0.45;
const ESCAPE_MIN_HOLD = 1.6;

export class Bot {
  constructor(car, arena, personality = {}) {
    this.car = car;
    this.arena = arena;
    this.state = BotState.CHASE;

    this.aggression = personality.aggression ?? 1; // scales ram range
    this.wobble = personality.wobble ?? 0.06; // human-like steering noise (rad)
    this.seed = Math.random() * 100;
    this.time = 0;

    this.stuckTimer = 0;
    this.recoverTimer = 0;
    this.recoverSteer = 1;

    this.escape = { x: 0, z: 0, ramp: null };
    this.escapeAge = 99;
    this.escapeTimer = 0;
    this.climbing = false;

    this._goal = { x: 0, z: 0 };
    this._circle = { x: 0, z: 0 };
  }

  /**
   * @param {number} dt
   * @param {{cars: Array, holder: object}} ctx
   */
  think(dt, ctx) {
    const car = this.car;
    const c = car.controls;
    this.time += dt;

    // --- RECOVER: back out of a jam ---
    if (this.recoverTimer > 0) {
      this.recoverTimer -= dt;
      this.state = BotState.RECOVER;
      c.throttle = 0;
      c.brake = 1;
      c.steer = this.recoverSteer;
      c.boost = false;
      c.drift = false;
      return;
    }

    this.state = car.hasCrown ? BotState.EVADE : BotState.CHASE;
    this.climbing = false;

    let boost = false;
    let goal;
    let nearestChaserDist = Infinity;
    if (this.state === BotState.EVADE) {
      const info = this._evade(dt, ctx);
      goal = info.goal;
      nearestChaserDist = info.nearestDist;
      boost = nearestChaserDist < 15 && car.nitro > 6 && !car.nitroLocked;
    } else {
      const holder = ctx.holder;
      goal = this._chase(holder);
      const dx = holder.pos.x - car.pos.x;
      const dz = holder.pos.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      const diff = Math.abs(wrapAngle(Math.atan2(dx, dz) - car.heading));
      boost =
        dist < 32 * this.aggression &&
        diff < 0.4 &&
        car.nitro > 18 &&
        !car.nitroLocked &&
        Math.abs(holder.pos.y - car.pos.y) < 2.5;
    }

    // --- Steering toward the goal ---
    const dx = goal.x - car.pos.x;
    const dz = goal.z - car.pos.z;
    const wobble = Math.sin(this.time * 1.7 + this.seed) * this.wobble;
    const angleDiff = wrapAngle(Math.atan2(dx, dz) - car.heading + wobble);
    let steer = clamp(-angleDiff * 2.4, -1, 1); // positive steer = right = heading decreases
    let throttle = 1;
    let brake = 0;
    const speed = car.speed;

    // Take tight corners slower, using a handbrake slide on very sharp turns.
    let drift = false;
    if (Math.abs(angleDiff) > 1.0 && speed > 18) {
      throttle = 0.45;
      drift = Math.abs(angleDiff) > 1.25 && speed > 22;
    }

    // --- Obstacle avoidance ---
    const look = 10 + speed * 0.55;
    const heading = car.heading;
    const clearC = this._clearance(heading, look);
    const clearL = this._clearance(heading + 0.6, look * 0.8);
    const clearR = this._clearance(heading - 0.6, look * 0.8);
    const sideLook = look * 0.8;
    if (clearC < look || clearL < sideLook || clearR < sideLook) {
      let avoid = (clearR - clearL) / look; // >0: right side is clearer -> steer right
      if (Math.abs(avoid) < 0.06) avoid = (Math.sin(this.seed) > 0 ? 1 : -1) * 0.5;
      const w = Math.max(1 - clearC / look, 0.7 * (1 - Math.min(clearL, clearR) / sideLook));
      steer = steer * (1 - clamp(w * 1.8, 0, 1)) + clamp(avoid * 3.2, -1, 1) * clamp(w * 1.8, 0, 1);
      if (clearC < 5 + speed * 0.12) {
        throttle = Math.min(throttle, 0.25);
        if (speed > 14) brake = 0.6;
      }
      boost = boost && clearC > look * 0.7;
    }

    // Slow down when lined up for a ramp approach but not yet aligned.
    c.throttle = brake > 0 ? 0 : throttle;
    c.brake = brake;
    c.steer = steer;
    c.boost = boost;
    c.drift = drift;

    // --- Stuck detection ---
    if (speed < 1.6 && car.grounded) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.0) {
        this.recoverTimer = 0.9;
        this.recoverSteer = Math.random() < 0.5 ? -1 : 1;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }

  }

  // ----- CHASE ------------------------------------------------------------

  _chase(holder) {
    const car = this.car;
    const arena = this.arena;
    const goal = this._goal;

    const holderOnPlatform = holder.pos.y > 2 && holder.surface && holder.surface.id !== 'ramp-blue' && holder.surface.id !== 'ramp-green';
    const onLowGround = car.pos.y < 1.2;

    if (holderOnPlatform && onLowGround) {
      // Take the red ramp up to the platform.
      const ramp = arena.ramps.find((r) => r.kind === 'access');
      const u = ramp.collider.localU(car.pos.x, car.pos.z);
      const w = ramp.collider.localW(car.pos.x, car.pos.z);
      if (Math.abs(u) < ramp.hw * 0.75 && w > -ramp.hl - 9 && w < ramp.hl) {
        goal.x = ramp.high.x + ramp.dir.x * 7;
        goal.z = ramp.high.z + ramp.dir.z * 7;
        this.climbing = true;
      } else {
        goal.x = ramp.low.x - ramp.dir.x * 10;
        goal.z = ramp.low.z - ramp.dir.z * 10;
      }
      return goal;
    }

    // Lead the target a little so bots cut corners instead of tail-chasing.
    const dx = holder.pos.x - car.pos.x;
    const dz = holder.pos.z - car.pos.z;
    const dist = Math.hypot(dx, dz);
    const lead = clamp(dist / Math.max(car.speed + 12, 14), 0, 0.85);
    goal.x = holder.pos.x + holder.vel.x * lead;
    goal.z = holder.pos.z + holder.vel.z * lead;
    return goal;
  }

  // ----- EVADE ------------------------------------------------------------

  _evade(dt, ctx) {
    const car = this.car;
    const arena = this.arena;
    const chasers = ctx.cars;

    // Nearest chaser (by predicted position).
    let nearest = null;
    let nearestDist = Infinity;
    for (const o of chasers) {
      if (o === car) continue;
      const px = o.pos.x + o.vel.x * 0.4;
      const pz = o.pos.z + o.vel.z * 0.4;
      const d = Math.hypot(px - car.pos.x, pz - car.pos.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = o;
      }
    }

    // Leaving the platform: head for the red ramp and roll down it.
    if (car.surface && car.surface.id === 'platform') {
      const ramp = arena.ramps.find((r) => r.kind === 'access');
      this._goal.x = ramp.low.x - ramp.dir.x * 10;
      this._goal.z = ramp.low.z - ramp.dir.z * 10;
      return { goal: this._goal, nearestDist, flee: null };
    }

    // Periodically (re)pick an escape destination.
    this.escapeAge += dt;
    this.escapeTimer -= dt;
    const escapeDist = Math.hypot(this.escape.x - car.pos.x, this.escape.z - car.pos.z);
    const stale = this.escapeAge > ESCAPE_MIN_HOLD || escapeDist < 6;
    if (this.escapeTimer <= 0 && stale) {
      this.escapeTimer = ESCAPE_REFRESH;
      this._pickEscape(chasers);
    }

    // Resolve the escape point into a concrete waypoint (ramps need an approach + a run-up).
    let gx = this.escape.x;
    let gz = this.escape.z;
    const ramp = this.escape.ramp;
    if (ramp) {
      const u = ramp.collider.localU(car.pos.x, car.pos.z);
      const w = ramp.collider.localW(car.pos.x, car.pos.z);
      if (Math.abs(u) < ramp.hw * 0.8 && w > -ramp.hl - 4 && w < ramp.hl) {
        gx = ramp.high.x + ramp.dir.x * 16;
        gz = ramp.high.z + ramp.dir.z * 16;
        this.climbing = true;
      } else {
        gx = ramp.low.x - ramp.dir.x * 7;
        gz = ramp.low.z - ramp.dir.z * 7;
      }
    }

    // Blend the destination with a direct "away from the nearest chaser" push.
    let tx = gx - car.pos.x;
    let tz = gz - car.pos.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;

    let flee = null;
    if (nearest) {
      let fx = car.pos.x - nearest.pos.x;
      let fz = car.pos.z - nearest.pos.z;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      flee = { x: fx, z: fz };
      const w = clamp(1 - nearestDist / 22, 0, 1);
      tx = tx * (1 - w) + fx * w * 1.4;
      tz = tz * (1 - w) + fz * w * 1.4;
    }
    const l = Math.hypot(tx, tz) || 1;
    this._goal.x = car.pos.x + (tx / l) * 35;
    this._goal.z = car.pos.z + (tz / l) * 35;
    return { goal: this._goal, nearestDist, flee };
  }

  _pickEscape(chasers) {
    const car = this.car;
    const arena = this.arena;
    const half = arena.half;

    // Predicted chaser positions (0.8 s ahead).
    const preds = [];
    let nearestPred = null;
    let nearestD = Infinity;
    for (const o of chasers) {
      if (o === car) continue;
      const p = { x: o.pos.x + o.vel.x * 0.8, z: o.pos.z + o.vel.z * 0.8 };
      preds.push(p);
      const d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
      if (d < nearestD) {
        nearestD = d;
        nearestPred = p;
      }
    }

    let best = null;
    let bestScore = -Infinity;

    const consider = (x, z, ramp, bonus) => {
      let minCh = Infinity;
      for (const p of preds) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < minCh) minCh = d;
      }
      const dB = Math.hypot(x - car.pos.x, z - car.pos.z);
      let score = minCh - 0.45 * dB + bonus;
      const wallDist = half - Math.max(Math.abs(x), Math.abs(z));
      if (wallDist < 14) score -= (14 - wallDist) * 3;
      if (nearestPred && dB > 1) {
        const cx = x - car.pos.x;
        const cz = z - car.pos.z;
        const nx = nearestPred.x - car.pos.x;
        const nz = nearestPred.z - car.pos.z;
        const dot = (cx * nx + cz * nz) / (dB * (Math.hypot(nx, nz) || 1));
        if (dot > 0.35) score -= 35 * dot;
      }
      if (!ramp && arena.isBlocked(x, z, 3, 0)) score -= 120;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, ramp };
      }
    };

    const radii = [22, 44, 64];
    for (const r of radii) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + r * 0.01;
        consider(Math.sin(a) * r, Math.cos(a) * r, null, 0);
      }
    }
    for (const ramp of arena.ramps) {
      const ax = ramp.low.x - ramp.dir.x * 7;
      const az = ramp.low.z - ramp.dir.z * 7;
      consider(ax, az, ramp, ramp.kind === 'jump' ? 16 : 8);
    }

    if (best) {
      this.escape = best;
      this.escapeAge = 0;
    }
  }

  // ----- Obstacle sensing ---------------------------------------------------

  /** Distance along `angle` (world heading convention) until something solid, up to maxDist. */
  _clearance(angle, maxDist) {
    const car = this.car;
    const arena = this.arena;
    const colliders = arena.colliders;
    const radius = car.spec.radius * 0.9 + 0.3;
    const sx = Math.sin(angle);
    const sz = Math.cos(angle);
    const y = car.pos.y;
    const onPlatform = car.grounded && car.surface && car.surface.id === 'platform';
    const step = 1.8;

    for (let d = step; d <= maxDist; d += step) {
      const px = car.pos.x + sx * d;
      const pz = car.pos.z + sz * d;
      for (let i = 0; i < colliders.length; i++) {
        const col = colliders[i];
        if (this.climbing && col.id === 'platform') continue;
        if (col.test(px, pz, radius, y, CONFIG.OBSTACLE_CLEARANCE)) return d;
      }
      if (onPlatform) {
        const h = arena.surfaceHeight(px, pz, y + CONFIG.STEP_UP);
        if (h < y - 1.5) return d; // do not drive off the platform edge
      }
    }
    return maxDist;
  }
}
