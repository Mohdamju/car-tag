import * as THREE from '../lib/three.module.min.js';
import { CONFIG, clamp, wrapAngle } from './config.js';

// Smooth, lerped 3rd-person chase camera with an orbit mode for menu / results.

export class CameraRig {
  constructor(camera, arena) {
    this.camera = camera;
    this.arena = arena;
    this.mode = 'orbit';
    this.heading = 0;
    this.focusY = 0;
    this.orbitAngle = 0;
    this.pos = new THREE.Vector3(0, 40, -70);
    this.look = new THREE.Vector3(0, 2, 0);
    this.fov = CONFIG.CAMERA_FOV;
    this.shake = 0;
    this._desired = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    camera.position.copy(this.pos);
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Immediately place the camera behind a car (used when a match starts). */
  snapBehind(car) {
    this.heading = car.heading;
    this.focusY = car.pos.y;
    const d = car.spec.camDistance;
    this.pos.set(
      car.pos.x - Math.sin(this.heading) * d,
      car.pos.y + car.spec.camHeight,
      car.pos.z - Math.cos(this.heading) * d
    );
    this.look.set(car.pos.x, car.pos.y + 1.5, car.pos.z);
  }

  update(dt, car) {
    const cam = this.camera;
    if (this.mode === 'orbit' || !car) {
      this.orbitAngle += dt * 0.16;
      const r = 78;
      this._desired.set(Math.sin(this.orbitAngle) * r, 34, Math.cos(this.orbitAngle) * r);
      this._lookTarget.set(0, 3, 0);
      const k = 1 - Math.exp(-2.5 * dt);
      this.pos.lerp(this._desired, k);
      this.look.lerp(this._lookTarget, k);
      this.fov += (CONFIG.CAMERA_FOV - this.fov) * k;
    } else {
      const spec = car.spec;
      const speed = car.speed;

      // Blend car heading with velocity direction so drifts and reversing read naturally.
      let target = car.heading;
      if (car.grounded && speed > 8) {
        const velAngle = Math.atan2(car.vel.x, car.vel.z);
        const w = clamp((speed - 8) / 22, 0, 0.45);
        if (car.forwardSpeed > 0) target = car.heading + wrapAngle(velAngle - car.heading) * w;
      }
      this.heading += wrapAngle(target - this.heading) * (1 - Math.exp(-5 * dt));

      // Vertical focus is smoothed separately so ramps do not jerk the camera.
      this.focusY += (car.pos.y - this.focusY) * (1 - Math.exp(-6 * dt));

      const boostK = car.boosting ? 1 : 0;
      const dist = spec.camDistance + speed * 0.06 + boostK * 1.8;
      const height = spec.camHeight + speed * 0.015;
      this._desired.set(
        car.pos.x - Math.sin(this.heading) * dist,
        this.focusY + height,
        car.pos.z - Math.cos(this.heading) * dist
      );
      this.pos.lerp(this._desired, 1 - Math.exp(-7.5 * dt));

      const ahead = 7 + speed * 0.05;
      this._lookTarget.set(
        car.pos.x + Math.sin(this.heading) * ahead,
        this.focusY + 1.8,
        car.pos.z + Math.cos(this.heading) * ahead
      );
      this.look.lerp(this._lookTarget, 1 - Math.exp(-10 * dt));

      const targetFov = CONFIG.CAMERA_FOV + clamp(speed / spec.maxSpeed, 0, 1.4) * 8 + boostK * 10;
      this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));

      // Never let the camera leave the arena or sink into the floor.
      const m = this.arena.half - 1.5;
      this.pos.x = clamp(this.pos.x, -m, m);
      this.pos.z = clamp(this.pos.z, -m, m);
      this.pos.y = Math.max(this.pos.y, 1.8);
    }

    cam.position.copy(this.pos);
    if (this.shake > 0) {
      const s = this.shake * 0.45;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
