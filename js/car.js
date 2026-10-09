import * as THREE from '../lib/three.module.min.js';
import { CONFIG, clamp } from './config.js';
import { HIT } from './arena.js';

// ---------------------------------------------------------------------------
// Car specs
// ---------------------------------------------------------------------------

export const CAR_TYPES = {
  muscle: {
    label: 'Muscle Car',
    maxSpeed: 38,
    accel: 25,
    brake: 46,
    reverseAccel: 16,
    maxReverse: 14,
    rollFriction: 7,
    drag: 0.07,
    turnRate: 2.6,
    grip: 13,
    gripDrift: 3.4,
    mass: 1,
    radius: 1.0,
    circleOffset: 1.3,
    wheelBase: 1.45,
    track: 1.0,
    crownHeight: 2.9,
    labelHeight: 4.7,
    arrowHeight: 3.5,
    camDistance: 11,
    camHeight: 5.2,
  },
  monster: {
    label: 'Monster Truck',
    maxSpeed: 33,
    accel: 21,
    brake: 40,
    reverseAccel: 14,
    maxReverse: 12,
    rollFriction: 6,
    drag: 0.07,
    turnRate: 2.2,
    grip: 10,
    gripDrift: 3.0,
    mass: 1.5,
    radius: 1.25,
    circleOffset: 1.4,
    wheelBase: 1.65,
    track: 1.5,
    crownHeight: 4.7,
    labelHeight: 6.5,
    arrowHeight: 5.2,
    camDistance: 13.5,
    camHeight: 6.8,
  },
};

// ---------------------------------------------------------------------------
// Shared geometry / material caches (keeps draw state small for 6-7 cars)
// ---------------------------------------------------------------------------

const geoCache = new Map();
function geo(key, factory) {
  let g = geoCache.get(key);
  if (!g) {
    g = factory();
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map();
function lambert(color) {
  const key = `l${color}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    matCache.set(key, m);
  }
  return m;
}
function basic(color) {
  const key = `b${color}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    matCache.set(key, m);
  }
  return m;
}
const flameMat = new THREE.MeshBasicMaterial({
  color: 0x4dc3ff,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const flameCoreMat = new THREE.MeshBasicMaterial({
  color: 0xfff2b0,
  transparent: true,
  opacity: 0.95,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

function boxMesh(parent, w, h, l, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(
    geo(`box${w},${h},${l}`, () => new THREE.BoxGeometry(w, h, l)),
    mat
  );
  m.position.set(x, y, z);
  m.castShadow = cast;
  parent.add(m);
  return m;
}

function cabinMesh(parent, topR, botR, h, sx, sz, mat, x, y, z) {
  const g = geo(`cab${topR},${botR},${h}`, () => {
    const cg = new THREE.CylinderGeometry(topR, botR, h, 4, 1);
    cg.rotateY(Math.PI / 4);
    return cg;
  });
  const m = new THREE.Mesh(g, mat);
  m.scale.set(sx, 1, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function makeWheel(parent, radius, width, x, y, z, front, tireMat, rimMat) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const spin = new THREE.Group();
  pivot.add(spin);

  const tire = new THREE.Mesh(
    geo(`tire${radius},${width}`, () => {
      const g = new THREE.CylinderGeometry(radius, radius, width, 14);
      g.rotateZ(Math.PI / 2);
      return g;
    }),
    tireMat
  );
  tire.castShadow = true;
  spin.add(tire);

  const side = x >= 0 ? 1 : -1;
  const rim = new THREE.Mesh(
    geo(`rim${radius},${width}`, () => {
      const g = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.04, 8);
      g.rotateZ(Math.PI / 2);
      return g;
    }),
    rimMat
  );
  spin.add(rim);

  // A bolt-pattern bar so wheel rotation is visible while driving.
  const bar = new THREE.Mesh(
    geo(`bar${radius}`, () => new THREE.BoxGeometry(width + 0.08, radius * 0.25, radius * 1.0)),
    tireMat
  );
  bar.position.x = side * 0.0;
  spin.add(bar);

  parent.add(pivot);
  return { pivot, spin, front, radius };
}

function makeFlames(parent, x, y, z, scale) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const outer = new THREE.Mesh(
    geo('flameOuter', () => {
      const g = new THREE.ConeGeometry(0.28, 1.9, 8);
      g.rotateX(-Math.PI / 2); // tip points toward -z (behind the car)
      g.translate(0, 0, -0.95);
      return g;
    }),
    flameMat
  );
  const inner = new THREE.Mesh(
    geo('flameInner', () => {
      const g = new THREE.ConeGeometry(0.14, 1.1, 8);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, -0.55);
      return g;
    }),
    flameCoreMat
  );
  group.add(outer, inner);
  group.scale.setScalar(scale);
  group.visible = false;
  parent.add(group);
  return group;
}

function buildMuscle(color) {
  const chassis = new THREE.Group();
  const body = lambert(color);
  const dark = lambert(0x16181f);
  const glass = lambert(0x24384d);
  const wheels = [];
  const flames = [];

  boxMesh(chassis, 2.0, 0.55, 4.4, body, 0, 0.62, 0);
  // Hood + trunk taper blocks for a more muscular silhouette.
  boxMesh(chassis, 1.8, 0.22, 1.5, body, 0, 0.98, 1.35);
  boxMesh(chassis, 1.8, 0.18, 1.0, body, 0, 0.95, -1.65);
  cabinMesh(chassis, 0.62, 0.98, 0.55, 1.2, 1.6, glass, 0, 1.2, -0.3);
  boxMesh(chassis, 0.42, 0.04, 4.45, lambert(0xf4f6ff), 0, 1.095, 0, false); // racing stripe
  boxMesh(chassis, 0.7, 0.18, 0.8, dark, 0, 1.15, 1.3); // hood scoop
  boxMesh(chassis, 2.06, 0.26, 0.24, dark, 0, 0.42, 2.2);
  boxMesh(chassis, 2.06, 0.26, 0.24, dark, 0, 0.42, -2.2);
  boxMesh(chassis, 0.5, 0.2, 0.1, basic(0xfff7c2), -0.65, 0.78, 2.2, false);
  boxMesh(chassis, 0.5, 0.2, 0.1, basic(0xfff7c2), 0.65, 0.78, 2.2, false);
  boxMesh(chassis, 0.6, 0.18, 0.1, basic(0xff2a3a), -0.65, 0.8, -2.21, false);
  boxMesh(chassis, 0.6, 0.18, 0.1, basic(0xff2a3a), 0.65, 0.8, -2.21, false);
  // Spoiler
  boxMesh(chassis, 0.1, 0.4, 0.16, dark, -0.7, 1.25, -1.95);
  boxMesh(chassis, 0.1, 0.4, 0.16, dark, 0.7, 1.25, -1.95);
  boxMesh(chassis, 2.15, 0.07, 0.6, body, 0, 1.5, -2.0);

  const wr = 0.46;
  const ww = 0.42;
  const tire = lambert(0x15161b);
  const rim = lambert(0xd8dde8);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wheels.push(makeWheel(chassis, wr, ww, sx * 1.02, wr, sz * 1.45, sz > 0, tire, rim));
    }
  }
  flames.push(makeFlames(chassis, -0.55, 0.45, -2.3, 1));
  flames.push(makeFlames(chassis, 0.55, 0.45, -2.3, 1));
  return { chassis, wheels, flames };
}

function buildMonster(color) {
  const chassis = new THREE.Group();
  const body = lambert(color);
  const dark = lambert(0x16181f);
  const glass = lambert(0x24384d);
  const metal = lambert(0x8d94a6);
  const wheels = [];
  const flames = [];

  // Frame + axles
  boxMesh(chassis, 1.9, 0.4, 4.4, dark, 0, 1.45, 0);
  boxMesh(chassis, 3.1, 0.3, 0.35, metal, 0, 1.0, 1.65);
  boxMesh(chassis, 3.1, 0.3, 0.35, metal, 0, 1.0, -1.65);
  // Body shell
  boxMesh(chassis, 2.4, 1.0, 4.1, body, 0, 2.15, 0);
  boxMesh(chassis, 2.3, 0.35, 1.5, body, 0, 2.85, 1.2); // hood bulge
  cabinMesh(chassis, 0.8, 1.2, 0.85, 1.25, 1.35, glass, 0, 3.0, -0.55);
  boxMesh(chassis, 2.5, 0.65, 0.22, dark, 0, 1.95, 2.12); // grille bumper
  boxMesh(chassis, 2.5, 0.5, 0.22, dark, 0, 1.9, -2.12);
  boxMesh(chassis, 0.55, 0.32, 0.12, basic(0xfff7c2), -0.8, 2.45, 2.1, false);
  boxMesh(chassis, 0.55, 0.32, 0.12, basic(0xfff7c2), 0.8, 2.45, 2.1, false);
  boxMesh(chassis, 0.6, 0.28, 0.1, basic(0xff2a3a), -0.8, 2.4, -2.1, false);
  boxMesh(chassis, 0.6, 0.28, 0.1, basic(0xff2a3a), 0.8, 2.4, -2.1, false);
  // Roof light bar
  for (let i = -2; i <= 2; i++) {
    boxMesh(chassis, 0.32, 0.22, 0.22, basic(0xfff2b0), i * 0.42, 3.62, 0.25, false);
  }
  // Exhaust stacks
  const stackGeo = geo('stack', () => new THREE.CylinderGeometry(0.16, 0.2, 1.3, 8));
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(stackGeo, metal);
    s.position.set(sx * 1.05, 3.1, -1.6);
    s.castShadow = true;
    chassis.add(s);
  }

  const wr = 1.0;
  const ww = 0.95;
  const tire = lambert(0x15161b);
  const rim = lambert(0xe9d24a);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wheels.push(makeWheel(chassis, wr, ww, sx * 1.6, wr, sz * 1.65, sz > 0, tire, rim));
    }
  }
  flames.push(makeFlames(chassis, -0.75, 1.95, -2.15, 1.5));
  flames.push(makeFlames(chassis, 0.75, 1.95, -2.15, 1.5));
  return { chassis, wheels, flames };
}

// ---------------------------------------------------------------------------
// Car (kinematic arcade physics, no physics engine)
// ---------------------------------------------------------------------------

export class Car {
  constructor({ id, name, typeKey, color, isPlayer = false, speedScale = 1 }) {
    this.id = id;
    this.name = name;
    this.typeKey = typeKey;
    this.spec = CAR_TYPES[typeKey];
    this.color = color;
    this.isPlayer = isPlayer;
    this.speedScale = speedScale;

    const built = typeKey === 'monster' ? buildMonster(color) : buildMuscle(color);
    this.chassis = built.chassis;
    this.wheels = built.wheels;
    this.flames = built.flames;

    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.root.add(this.chassis);

    // Kinematic state
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.roll = 0;
    this.steerCur = 0;
    this.grounded = true;
    this.airTime = 0;
    this.surface = null;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.drifting = false;
    this.boosting = false;

    // Gameplay state
    this.nitro = CONFIG.NITRO_MAX;
    this.nitroLocked = false;
    this.nitroIdle = 0;
    this.hasCrown = false;
    this.holdTime = 0;

    // Events consumed by the game each frame (impacts, landings, ...)
    this.lastImpact = 0;
    this.lastLanding = 0;

    this.controls = { throttle: 0, brake: 0, steer: 0, boost: false, drift: false };

    // Cosmetic smoothing
    this._chassisPitch = 0;
    this._chassisRoll = 0;
    this._prevForward = 0;
    this._flamePhase = Math.random() * 10;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Effective top speed right now (before the nitro multiplier). */
  get maxSpeed() {
    return this.spec.maxSpeed * this.speedScale * (this.hasCrown ? CONFIG.HOLDER_SPEED_FACTOR : 1);
  }

  reset(x, z, heading) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.steerCur = 0;
    this.grounded = true;
    this.airTime = 0;
    this.surface = null;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.drifting = false;
    this.boosting = false;
    this.nitro = CONFIG.NITRO_MAX;
    this.nitroLocked = false;
    this.nitroIdle = 0;
    this.hasCrown = false;
    this.holdTime = 0;
    this.lastImpact = 0;
    this.lastLanding = 0;
    this._chassisPitch = 0;
    this._chassisRoll = 0;
    this._prevForward = 0;
    this.clearControls();
    this.syncMesh(0);
  }

  clearControls() {
    const c = this.controls;
    c.throttle = 0;
    c.brake = 0;
    c.steer = 0;
    c.boost = false;
    c.drift = false;
  }

  /** i = 0 (rear), 1 (centre), 2 (front) collision circle centres, written into out. */
  circle(i, out) {
    const off = (i - 1) * this.spec.circleOffset;
    out.x = this.pos.x + Math.sin(this.heading) * off;
    out.z = this.pos.z + Math.cos(this.heading) * off;
    return out;
  }

  // ----- Physics step -------------------------------------------------------

  update(dt, arena) {
    this.lastImpact = 0;
    this.lastLanding = 0;
    this._updateNitro(dt);
    this._updateHorizontal(dt);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._collideStatic(arena);

    this._updateVertical(dt, arena);
    this._updateOrientation(dt, arena);

    // Hard safety net: never leave the arena or fall out of the world.
    arena.clampInside(this.pos, 1.0);
    if (this.pos.y < -30) {
      this.pos.set(0, 0, 0);
      this.vel.set(0, 0, 0);
      this.grounded = true;
    }
  }

  _updateNitro(dt) {
    const c = this.controls;
    const wantBoost = c.boost && !this.nitroLocked && this.nitro > 0;
    this.boosting = wantBoost;
    if (wantBoost) {
      this.nitro = Math.max(0, this.nitro - CONFIG.NITRO_DRAIN * dt);
      this.nitroIdle = CONFIG.NITRO_REGEN_DELAY;
      if (this.nitro <= 0) {
        this.nitroLocked = true;
        this.boosting = false;
      }
    } else {
      this.nitroIdle = Math.max(0, this.nitroIdle - dt);
      // The crown holder's nitro never regenerates (chasers must be able to catch up).
      if (!this.hasCrown && this.nitroIdle <= 0) {
        this.nitro = Math.min(CONFIG.NITRO_MAX, this.nitro + CONFIG.NITRO_REGEN * dt);
      }
    }
    if (this.nitroLocked && !this.hasCrown && this.nitro >= CONFIG.NITRO_UNLOCK) {
      this.nitroLocked = false;
    }
  }

  _updateHorizontal(dt) {
    const c = this.controls;
    const spec = this.spec;
    const maxSpeed = this.maxSpeed;
    const boostMul = this.boosting ? CONFIG.BOOST_MULT : 1;
    const topSpeed = maxSpeed * boostMul;

    // Steering input is smoothed so keyboard play feels analogue.
    const rate = Math.abs(c.steer) > Math.abs(this.steerCur) ? 8 : 12;
    this.steerCur += clamp(c.steer - this.steerCur, -rate * dt, rate * dt);

    if (!this.grounded) {
      // Limited air control; velocity is ballistic.
      this.heading -= this.steerCur * 0.9 * dt;
      const drag = Math.exp(-0.05 * dt);
      this.vel.x *= drag;
      this.vel.z *= drag;
      this.drifting = false;
      return;
    }

    // --- Steering (uses the previous forward speed to decide authority) ---
    const speedAbs = Math.abs(this.forwardSpeed);
    const drifting = c.drift && speedAbs > 9;
    this.drifting = drifting;
    const authority = clamp(speedAbs / 6, 0, 1) * (1 - 0.45 * clamp(speedAbs / maxSpeed, 0, 1));
    const turn = this.steerCur * spec.turnRate * authority * (drifting ? 1.3 : 1);
    const dirSign = this.forwardSpeed >= -0.5 ? 1 : -1;
    this.heading -= turn * dt * dirSign; // steer > 0 = right = heading decreases

    // --- Decompose the (unchanged) world velocity on the new car axes ---
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const sx = Math.cos(this.heading);
    const sz = -Math.sin(this.heading);
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vs = this.vel.x * sx + this.vel.z * sz;

    // --- Throttle / brake / reverse / friction ---
    let throttle = c.throttle;
    if (this.boosting) throttle = Math.max(throttle, 1);
    const brake = c.brake;

    if (throttle > 0 && vf < topSpeed) {
      const ratio = clamp(vf / topSpeed, 0, 1);
      vf += spec.accel * boostMul * (1 - 0.5 * ratio) * throttle * dt;
      if (vf > topSpeed) vf = topSpeed;
    }
    if (brake > 0) {
      if (vf > 0.5) {
        vf = Math.max(0, vf - spec.brake * brake * dt);
      } else {
        vf = Math.max(-spec.maxReverse, vf - spec.reverseAccel * brake * dt);
      }
    } else if (throttle <= 0) {
      const fr = spec.rollFriction * dt;
      vf = Math.abs(vf) <= fr ? 0 : vf - Math.sign(vf) * fr;
    }
    vf -= vf * spec.drag * dt;
    if (vf > topSpeed) vf -= (vf - topSpeed) * Math.min(1, 2.5 * dt); // bleed overspeed (nitro end / crown handicap)
    vf -= Math.sin(this.pitch) * 12 * dt; // uphill slows, downhill speeds up

    // --- Lateral grip: bled sideways speed is partly converted back to forward speed ---
    const grip = drifting ? spec.gripDrift : spec.grip;
    const keep = Math.exp(-grip * dt);
    const lost = vs * (1 - keep);
    vs *= keep;
    vf += Math.abs(lost) * 0.85 * (vf >= 0 ? 1 : -1);
    if (drifting && vf > 0) vf = Math.max(0, vf - 4 * dt);

    this.forwardSpeed = vf;
    this.lateralSpeed = vs;
    this.vel.x = fx * vf + sx * vs;
    this.vel.z = fz * vf + sz * vs;
  }

  _collideStatic(arena) {
    const spec = this.spec;
    const colliders = arena.colliders;
    const circle = { x: 0, z: 0 };
    // Two passes so a corner pinch (wall + crate) settles inside a single frame.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 3; i++) {
        this.circle(i, circle);
        for (let k = 0; k < colliders.length; k++) {
          if (!colliders[k].test(circle.x, circle.z, spec.radius, this.pos.y, CONFIG.OBSTACLE_CLEARANCE)) continue;
          this.pos.x += HIT.nx * HIT.pen;
          this.pos.z += HIT.nz * HIT.pen;
          circle.x += HIT.nx * HIT.pen;
          circle.z += HIT.nz * HIT.pen;
          const vn = this.vel.x * HIT.nx + this.vel.z * HIT.nz;
          if (vn < 0) {
            // Reflect with damping; tangential velocity is kept so cars scrape along walls.
            const bounce = 0.35;
            this.vel.x -= (1 + bounce) * vn * HIT.nx;
            this.vel.z -= (1 + bounce) * vn * HIT.nz;
            if (-vn > 4) {
              this.vel.x *= 0.92;
              this.vel.z *= 0.92;
            }
            this.lastImpact = Math.max(this.lastImpact, -vn);
          }
        }
      }
    }
  }

  _updateVertical(dt, arena) {
    const p = this.pos;
    const prevY = p.y;

    if (this.grounded) {
      const h = arena.surfaceHeight(p.x, p.z, prevY + CONFIG.STEP_UP);
      if (prevY - h > CONFIG.SNAP_DOWN) {
        // The ground fell away (ramp lip / platform edge): leave the surface keeping vertical speed.
        this.grounded = false;
        this.airTime = 0;
      } else {
        this.surface = arena.lastSurface;
        p.y = h;
        this.vel.y = clamp((h - prevY) / dt, -40, 40);
      }
    }

    if (!this.grounded) {
      this.vel.y -= CONFIG.GRAVITY * dt;
      p.y += this.vel.y * dt;
      this.airTime += dt;
      const h = arena.surfaceHeight(p.x, p.z, prevY + 0.3);
      if (p.y <= h && this.vel.y <= 0) {
        // Landing
        this.lastLanding = -this.vel.y;
        p.y = h;
        this.surface = arena.lastSurface;
        this.grounded = true;
        this.vel.y = 0;
        // Landing scrubs a little horizontal speed on hard impacts.
        if (this.lastLanding > 14) {
          this.vel.x *= 0.94;
          this.vel.z *= 0.94;
        }
        this.forwardSpeed = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
      }
    }
  }

  _updateOrientation(dt, arena) {
    const p = this.pos;
    const spec = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const sx = Math.cos(this.heading);
    const sz = -Math.sin(this.heading);
    const L = spec.wheelBase;
    const T = spec.track;

    // Surface slope under the wheels (also used as the "land flat" target while airborne).
    const limit = p.y + (this.grounded ? CONFIG.STEP_UP : 0.4);
    const hF = arena.surfaceHeight(p.x + fx * L, p.z + fz * L, limit);
    const hR = arena.surfaceHeight(p.x - fx * L, p.z - fz * L, limit);
    const hL = arena.surfaceHeight(p.x + sx * T, p.z + sz * T, limit);
    const hRt = arena.surfaceHeight(p.x - sx * T, p.z - sz * T, limit);
    const groundPitch = clamp(Math.atan2(hF - hR, 2 * L), -0.55, 0.55);
    const groundRoll = clamp(Math.atan2(hL - hRt, 2 * T), -0.4, 0.4);

    if (this.grounded) {
      const k = 1 - Math.exp(-14 * dt);
      this.pitch += (groundPitch - this.pitch) * k;
      this.roll += (groundRoll - this.roll) * k;
    } else {
      // Auto-level: high up the nose follows the flight path, close to the ground it
      // blends toward the slope below so the car lands on all four wheels.
      const below = arena.surfaceHeight(p.x, p.z, p.y + 0.1);
      const heightAbove = p.y - below;
      const blend = clamp(heightAbove / 4.5, 0, 1);
      const trajectory = clamp(Math.atan2(this.vel.y, Math.max(this.speed, 8)), -0.7, 0.7) * 0.75;
      const targetPitch = groundPitch * (1 - blend) + trajectory * blend;
      const k = 1 - Math.exp(-3.4 * dt);
      this.pitch += (targetPitch - this.pitch) * k;
      this.roll += (groundRoll * (1 - blend) - this.roll) * k;
    }
  }

  // ----- Visuals ------------------------------------------------------------

  syncMesh(dt) {
    this.root.position.copy(this.pos);
    this.root.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');

    // Body lean in corners + squat/dive under acceleration (cosmetic only).
    if (dt > 0) {
      const accel = (this.forwardSpeed - this._prevForward) / dt;
      this._prevForward = this.forwardSpeed;
      const ratio = clamp(Math.abs(this.forwardSpeed) / this.spec.maxSpeed, 0, 1);
      const targetRoll = -this.steerCur * ratio * 0.07 + clamp(-this.lateralSpeed * 0.004, -0.08, 0.08);
      const targetPitch = clamp(-accel * 0.0018, -0.05, 0.05);
      const k = 1 - Math.exp(-9 * dt);
      this._chassisRoll += (targetRoll - this._chassisRoll) * k;
      this._chassisPitch += (targetPitch - this._chassisPitch) * k;
      this.chassis.rotation.set(this._chassisPitch, 0, this._chassisRoll);

      // Wheels: roll with ground speed, front pair steers.
      const spinDelta = this.forwardSpeed * dt;
      for (const w of this.wheels) {
        w.spin.rotation.x += spinDelta / w.radius;
        if (w.front) w.pivot.rotation.y = -this.steerCur * 0.45;
      }

      // Nitro exhaust flames flicker.
      this._flamePhase += dt * 40;
      for (const f of this.flames) {
        f.visible = this.boosting;
        if (this.boosting) {
          const s = 0.85 + Math.sin(this._flamePhase + f.position.x * 7) * 0.2 + Math.random() * 0.25;
          f.scale.set(1, 1, s * (this.typeKey === 'monster' ? 1.5 : 1.0));
        }
      }
    }
  }
}
