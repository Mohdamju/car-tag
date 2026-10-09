import * as THREE from '../lib/three.module.min.js';

// A single pooled Points object that renders smoke, nitro sparks and tag bursts
// as soft round sprites. One draw call regardless of particle count.

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uPxScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPxScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.15, d) * vColor.a;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

export class Particles {
  constructor(scene, max = 600) {
    this.max = max;
    this.cursor = 0;

    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 4);
    this.sizes = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uPxScale: { value: 600 } },
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** Update the pixel-size scale (call when the viewport or FOV changes). */
  setView(heightPx, fovDeg) {
    this.material.uniforms.uPxScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x, y, z, vx, vy, vz, size, r, g, b, alpha, life, opts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = i * 3;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.vel[p] = vx;
    this.vel[p + 1] = vy;
    this.vel[p + 2] = vz;
    const c = i * 4;
    this.colors[c] = r;
    this.colors[c + 1] = g;
    this.colors[c + 2] = b;
    this.colors[c + 3] = alpha;
    this.baseAlpha[i] = alpha;
    this.baseSize[i] = size;
    this.sizes[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = opts.grow ?? 0;
    this.drag[i] = opts.drag ?? 1.5;
    this.gravity[i] = opts.gravity ?? 0;
  }

  smoke(x, y, z, vx, vz) {
    const s = 0.9 + Math.random() * 0.8;
    this.emit(
      x + (Math.random() - 0.5) * 0.5,
      y + 0.2,
      z + (Math.random() - 0.5) * 0.5,
      vx * 0.15 + (Math.random() - 0.5) * 1.2,
      0.8 + Math.random() * 0.8,
      vz * 0.15 + (Math.random() - 0.5) * 1.2,
      s,
      0.85,
      0.88,
      0.95,
      0.55,
      0.7 + Math.random() * 0.3,
      { grow: 2.2, drag: 2 }
    );
  }

  spark(x, y, z, vx, vy, vz, r = 1, g = 0.7, b = 0.2) {
    this.emit(x, y, z, vx, vy, vz, 0.45 + Math.random() * 0.25, r, g, b, 1, 0.35 + Math.random() * 0.25, {
      drag: 1.2,
      gravity: 9,
    });
  }

  /** Radial burst used when the crown changes hands. */
  burst(x, y, z, count = 40) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.1) * Math.PI * 0.6;
      const sp = 8 + Math.random() * 14;
      const vx = Math.cos(a) * Math.cos(e) * sp;
      const vz = Math.sin(a) * Math.cos(e) * sp;
      const vy = Math.sin(e) * sp + 4;
      const mix = Math.random();
      this.emit(x, y, z, vx, vy, vz, 0.7 + Math.random() * 0.7, 1, 0.85 + mix * 0.15, 0.2 + mix * 0.4, 1, 0.6 + Math.random() * 0.5, {
        drag: 2.2,
        gravity: 12,
      });
    }
  }

  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        this.sizes[i] = 0;
        this.colors[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const p = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[p] *= damp;
      this.vel[p + 1] = this.vel[p + 1] * damp - this.gravity[i] * dt;
      this.vel[p + 2] *= damp;
      this.positions[p] += this.vel[p] * dt;
      this.positions[p + 1] += this.vel[p + 1] * dt;
      this.positions[p + 2] += this.vel[p + 2] * dt;
      this.sizes[i] = this.baseSize[i] + this.grow[i] * (1 - t);
      this.colors[i * 4 + 3] = this.baseAlpha[i] * t;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }
}
