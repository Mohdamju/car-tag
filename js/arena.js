import * as THREE from '../lib/three.module.min.js';
import { CONFIG, clamp } from './config.js';

// ---------------------------------------------------------------------------
// Colliders
//
// All solid world geometry is described in 2D (x/z footprint) plus a "top"
// height. A car is blocked by a collider only while the car's wheels are lower
// than the collider's top (minus a clearance), which is what lets cars drive up
// ramps, onto the platform and land on top of crates after a jump.
//
// Box colliders use the same heading convention as cars:
//   forward axis f = (sin h, cos h)   -> local "w" (half extent hl)
//   side axis    s = (cos h, -sin h)  -> local "u" (half extent hw)
// ---------------------------------------------------------------------------

/** Shared scratch result for circle tests (avoids per-frame allocation). */
export const HIT = { nx: 0, nz: 0, pen: 0 };

export class BoxCollider {
  constructor({ id, x, z, hw, hl, heading = 0, top = 1, slope = false, walkable = true }) {
    this.id = id;
    this.kind = 'box';
    this.x = x;
    this.z = z;
    this.hw = hw;
    this.hl = hl;
    this.heading = heading;
    this.top = top;
    this.slope = slope; // true: height rises linearly along +forward from 0 to `top`
    this.walkable = walkable;
    this.cos = Math.cos(heading);
    this.sin = Math.sin(heading);
  }

  localU(x, z) {
    return (x - this.x) * this.cos - (z - this.z) * this.sin;
  }

  localW(x, z) {
    return (x - this.x) * this.sin + (z - this.z) * this.cos;
  }

  topAtW(w) {
    if (!this.slope) return this.top;
    return this.top * clamp((w + this.hl) / (2 * this.hl), 0, 1);
  }

  /** Surface height at a world point, or null when the point is outside the footprint. */
  heightAt(x, z) {
    const u = this.localU(x, z);
    const w = this.localW(x, z);
    if (u < -this.hw || u > this.hw || w < -this.hl || w > this.hl) return null;
    return this.topAtW(w);
  }

  /** Circle (cx,cz,r) at wheel height y vs this solid. Writes HIT and returns true on contact. */
  test(cx, cz, r, y, clearance) {
    const u = this.localU(cx, cz);
    const w = this.localW(cx, cz);
    const cu = clamp(u, -this.hw, this.hw);
    const cw = clamp(w, -this.hl, this.hl);
    const du = u - cu;
    const dw = w - cw;
    const d2 = du * du + dw * dw;
    if (d2 > r * r) return false;

    let nu;
    let nw;
    let pen;
    if (d2 > 1e-8) {
      if (y + clearance >= this.topAtW(cw)) return false;
      const d = Math.sqrt(d2);
      nu = du / d;
      nw = dw / d;
      pen = r - d;
    } else {
      // Circle centre is inside the footprint: push out along the shallowest axis.
      if (y + clearance >= this.topAtW(w)) return false;
      const pu = this.hw - Math.abs(u);
      const pw = this.hl - Math.abs(w);
      if (pu < pw) {
        nu = u >= 0 ? 1 : -1;
        nw = 0;
        pen = pu + r;
      } else {
        nu = 0;
        nw = w >= 0 ? 1 : -1;
        pen = pw + r;
      }
    }
    HIT.nx = nu * this.cos + nw * this.sin;
    HIT.nz = -nu * this.sin + nw * this.cos;
    HIT.pen = pen;
    return true;
  }
}

export class CylinderCollider {
  constructor({ id, x, z, r, top }) {
    this.id = id;
    this.kind = 'cylinder';
    this.x = x;
    this.z = z;
    this.r = r;
    this.top = top;
    this.walkable = true;
    this.slope = false;
  }

  heightAt(x, z) {
    const dx = x - this.x;
    const dz = z - this.z;
    return dx * dx + dz * dz <= this.r * this.r ? this.top : null;
  }

  test(cx, cz, r, y, clearance) {
    const dx = cx - this.x;
    const dz = cz - this.z;
    const rr = r + this.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return false;
    if (y + clearance >= this.top) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      HIT.nx = 1;
      HIT.nz = 0;
    } else {
      HIT.nx = dx / d;
      HIT.nz = dz / d;
    }
    HIT.pen = rr - d;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const RAMP_DEFS = [
  // Red: climbs onto the central platform (its high end meets the platform edge).
  { id: 'ramp-red', color: 0xff3b3b, x: 0, z: -20, heading: 0, hw: 5.5, hl: 9, H: CONFIG.PLATFORM_HEIGHT, kind: 'access' },
  // Blue / green: free-standing stunt launch ramps.
  { id: 'ramp-blue', color: 0x2f86ff, x: -50, z: 30, heading: Math.PI / 2, hw: 6, hl: 8, H: 3.4, kind: 'jump' },
  { id: 'ramp-green', color: 0x2fe06b, x: 50, z: -30, heading: -Math.PI / 2, hw: 6, hl: 8, H: 3.4, kind: 'jump' },
];

const OBSTACLE_DEFS = [
  { type: 'box', id: 'crate-a', x: 30, z: 30, hw: 3.5, hl: 3.5, top: 3.4, heading: 0.35, color: 0xffa31a },
  { type: 'box', id: 'crate-b', x: -32, z: -32, hw: 3.5, hl: 3.5, top: 3.4, heading: -0.45, color: 0xff5ca8 },
  { type: 'box', id: 'crate-c', x: 22, z: -52, hw: 2.8, hl: 2.8, top: 2.8, heading: 0.2, color: 0x35e0d0 },
  { type: 'box', id: 'crate-d', x: -18, z: 56, hw: 2.8, hl: 2.8, top: 2.8, heading: 0.9, color: 0xb36bff },
  { type: 'cyl', id: 'pillar-a', x: -38, z: -4, r: 2.6, top: 7, color: 0x38e8ff },
  { type: 'cyl', id: 'pillar-b', x: 38, z: 6, r: 2.6, top: 7, color: 0xff6b3a },
  { type: 'cyl', id: 'pillar-c', x: 0, z: 40, r: 2.2, top: 6, color: 0xffd23a },
  { type: 'box', id: 'barrier-a', x: 62, z: 14, hw: 1.6, hl: 9, top: 2.4, heading: 0.15, color: 0xb36bff },
  { type: 'box', id: 'barrier-b', x: -62, z: -14, hw: 1.6, hl: 9, top: 2.4, heading: 0.15, color: 0x38e8ff },
  { type: 'box', id: 'barrier-c', x: 8, z: 62, hw: 10, hl: 1.4, top: 2.2, heading: 0, color: 0xff5ca8 },
];

// Spawn ring: seven slots so every match start has room for up to 7 cars.
const SPAWN_RADIUS = 56;
const SPAWN_COUNT = 7;

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.half = CONFIG.ARENA_HALF;
    this.colliders = [];
    this.walkables = [];
    this.ramps = [];
    this.platform = null;
    this.spawns = [];
    this.crowd = null;

    this._buildSky();
    this._buildLights();
    this._buildFloor();
    this._buildWalls();
    this._buildPlatform();
    this._buildRamps();
    this._buildObstacles();
    this._buildSpawns();
    this._buildStadium();

    this.walkables = this.colliders.filter((c) => c.walkable);
    this.lastSurface = null;
  }

  // ----- Queries ----------------------------------------------------------

  /**
   * Highest walkable surface at (x,z) that is not above `limit`.
   * Also records which collider supplied it in `this.lastSurface` (null = ground).
   */
  surfaceHeight(x, z, limit) {
    let best = 0;
    let who = null;
    const list = this.walkables;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const h = c.heightAt(x, z);
      if (h !== null && h <= limit && h > best) {
        best = h;
        who = c;
      }
    }
    this.lastSurface = who;
    return best;
  }

  /** True if a car-sized circle at (x,z) with wheels at height y would hit something solid. */
  isBlocked(x, z, radius, y) {
    const list = this.colliders;
    for (let i = 0; i < list.length; i++) {
      if (list[i].test(x, z, radius, y, CONFIG.OBSTACLE_CLEARANCE)) return true;
    }
    return false;
  }

  /** Clamp a point to the playable area. */
  clampInside(p, margin) {
    const m = this.half - margin;
    p.x = clamp(p.x, -m, m);
    p.z = clamp(p.z, -m, m);
  }

  // ----- Build: environment ----------------------------------------------

  _buildSky() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#2d6bff');
    grad.addColorStop(0.55, '#7fc6ff');
    grad.addColorStop(1, '#ffd9a8');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = tex;
    this.scene.fog = new THREE.Fog(0xcfe6ff, 140, 380);
  }

  _buildLights() {
    this.ambient = new THREE.AmbientLight(0xffe0b8, 1.15);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0xbfe6ff, 0x7a5a3a, 0.55);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d2, 2.6);
    this.sun.position.set(40, 70, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -55;
    sc.right = 55;
    sc.top = 55;
    sc.bottom = -55;
    sc.near = 10;
    sc.far = 190;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.sunOffset = new THREE.Vector3(40, 70, 25);
  }

  /** Wider shadow frustum for split-screen (players can be far apart). */
  setShadowSpan(span) {
    const sc = this.sun.shadow.camera;
    if (sc.right === span) return;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.updateProjectionMatrix();
  }

  /** Keeps the (tight, crisp) shadow frustum centred on the action. */
  followWithSun(x, z) {
    // Snap to a coarse grid so shadow texels do not shimmer while moving.
    const gx = Math.round(x / 2) * 2;
    const gz = Math.round(z / 2) * 2;
    this.sun.target.position.set(gx, 0, gz);
    this.sun.position.set(gx + this.sunOffset.x, this.sunOffset.y, gz + this.sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  _buildFloor() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const t = size / 2;
    g.fillStyle = '#35466b';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#2d3c5c';
    g.fillRect(0, 0, t, t);
    g.fillRect(t, t, t, t);
    g.strokeStyle = 'rgba(120,200,255,0.35)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, size - 4, size - 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    const tiles = (this.half * 2) / 20;
    tex.repeat.set(tiles, tiles);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.half * 2, this.half * 2),
      new THREE.MeshLambertMaterial({ map: tex })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Outer ground (visible beyond the walls).
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshLambertMaterial({ color: 0x1f2a44 })
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.08;
    this.scene.add(outer);

    // Painted ring around the platform + centre lanes.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x39d5ff, transparent: true, opacity: 0.55 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(27, 28, 72), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.scene.add(ring);

    const laneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
    const lane1 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, this.half * 2), laneMat);
    lane1.rotation.x = -Math.PI / 2;
    lane1.position.y = 0.025;
    this.scene.add(lane1);
    const lane2 = new THREE.Mesh(new THREE.PlaneGeometry(this.half * 2, 1.2), laneMat);
    lane2.rotation.x = -Math.PI / 2;
    lane2.position.y = 0.025;
    this.scene.add(lane2);
  }

  _buildWalls() {
    const half = this.half;
    const th = CONFIG.WALL_THICKNESS;
    const h = CONFIG.WALL_HEIGHT;

    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 === 0 ? '#ff3d5a' : '#f4f6ff';
      g.fillRect(i * 32, 0, 32, 64);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 44, 256, 20);

    const defs = [
      { x: 0, z: -(half + th / 2), hw: half + th, hl: th / 2, len: (half + th) * 2 },
      { x: 0, z: half + th / 2, hw: half + th, hl: th / 2, len: (half + th) * 2 },
      { x: -(half + th / 2), z: 0, hw: th / 2, hl: half, len: half * 2 },
      { x: half + th / 2, z: 0, hw: th / 2, hl: half, len: half * 2 },
    ];

    const capMat = new THREE.MeshBasicMaterial({ color: 0x39f0ff });
    defs.forEach((d, i) => {
      // Collider (walls are infinitely tall for gameplay purposes).
      this.colliders.push(
        new BoxCollider({ id: `wall-${i}`, x: d.x, z: d.z, hw: d.hw, hl: d.hl, top: 1000, walkable: false })
      );

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(d.len / 16, 1);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.hw * 2, h, d.hl * 2), mat);
      mesh.position.set(d.x, h / 2, d.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(d.hw * 2 + 0.1, 0.35, d.hl * 2 + 0.1), capMat);
      cap.position.set(d.x, h + 0.17, d.z);
      this.scene.add(cap);
    });
  }

  _buildPlatform() {
    const H = CONFIG.PLATFORM_HEIGHT;
    const size = 22;
    this.platform = new BoxCollider({ id: 'platform', x: 0, z: 0, hw: size / 2, hl: size / 2, top: H });
    this.colliders.push(this.platform);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(size, H, size),
      new THREE.MeshLambertMaterial({ color: 0x5a3bd6 })
    );
    body.position.set(0, H / 2, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    this.scene.add(body);

    // Top surface with inset neon frame.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#7b5cff';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#6a4bec';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if ((x + y) % 2 === 0) g.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    g.strokeStyle = '#ffe94d';
    g.lineWidth = 10;
    g.strokeRect(14, 14, 228, 228);
    // Crown emblem
    g.fillStyle = '#ffe94d';
    g.beginPath();
    g.moveTo(78, 168);
    g.lineTo(70, 96);
    g.lineTo(104, 128);
    g.lineTo(128, 84);
    g.lineTo(152, 128);
    g.lineTo(186, 96);
    g.lineTo(178, 168);
    g.closePath();
    g.fill();
    const topTex = new THREE.CanvasTexture(c);
    topTex.colorSpace = THREE.SRGBColorSpace;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(size - 0.4, size - 0.4), new THREE.MeshLambertMaterial({ map: topTex }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = H + 0.03;
    top.receiveShadow = true;
    this.scene.add(top);

    // Neon base strip.
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.3, 0.3, size + 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffe94d })
    );
    strip.position.set(0, 0.2, 0);
    this.scene.add(strip);
  }

  _buildRamps() {
    for (const def of RAMP_DEFS) {
      const collider = new BoxCollider({
        id: def.id,
        x: def.x,
        z: def.z,
        hw: def.hw,
        hl: def.hl,
        heading: def.heading,
        top: def.H,
        slope: true,
      });
      this.colliders.push(collider);

      const fx = Math.sin(def.heading);
      const fz = Math.cos(def.heading);
      this.ramps.push({
        id: def.id,
        kind: def.kind,
        color: def.color,
        collider,
        x: def.x,
        z: def.z,
        heading: def.heading,
        height: def.H,
        hl: def.hl,
        hw: def.hw,
        dir: { x: fx, z: fz },
        low: { x: def.x - fx * def.hl, z: def.z - fz * def.hl },
        high: { x: def.x + fx * def.hl, z: def.z + fz * def.hl },
      });

      // Mesh: triangular prism extruded across the ramp width.
      const shape = new THREE.Shape();
      shape.moveTo(-def.hl, 0);
      shape.lineTo(def.hl, 0);
      shape.lineTo(def.hl, def.H);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: def.hw * 2, bevelEnabled: false });
      geo.translate(0, 0, -def.hw);
      const group = new THREE.Group();
      group.position.set(def.x, 0, def.z);
      group.rotation.y = def.heading - Math.PI / 2; // local +x -> world forward

      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: def.color }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      // Chevron decal pointing up the slope.
      const slopeLen = Math.hypot(def.hl * 2, def.H);
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(slopeLen * 0.92, def.hw * 1.5),
        new THREE.MeshBasicMaterial({ map: this._chevronTexture(), transparent: true, depthWrite: false })
      );
      decal.rotation.x = -Math.PI / 2;
      const decalHolder = new THREE.Group();
      decalHolder.rotation.z = Math.atan2(def.H, def.hl * 2);
      decalHolder.position.set(0, def.H / 2 + 0.04, 0);
      decalHolder.add(decal);
      group.add(decalHolder);

      // Glowing edge at the lip so jumps read clearly.
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.3, def.hw * 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      lip.position.set(def.hl - 0.25, def.H, 0);
      group.add(lip);

      this.scene.add(group);
    }
  }

  _chevronTexture() {
    if (this._chevron) return this._chevron;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 14;
    g.lineJoin = 'miter';
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 62;
      g.beginPath();
      g.moveTo(x, 14);
      g.lineTo(x + 34, 64);
      g.lineTo(x, 114);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._chevron = tex;
    return tex;
  }

  _crateTexture(color) {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = hex;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 118, 118);
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(8, 8);
    g.lineTo(120, 120);
    g.moveTo(120, 8);
    g.lineTo(8, 120);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildObstacles() {
    for (const o of OBSTACLE_DEFS) {
      if (o.type === 'box') {
        this.colliders.push(
          new BoxCollider({ id: o.id, x: o.x, z: o.z, hw: o.hw, hl: o.hl, heading: o.heading, top: o.top })
        );
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(o.hw * 2, o.top, o.hl * 2),
          new THREE.MeshLambertMaterial({ map: this._crateTexture(o.color) })
        );
        mesh.position.set(o.x, o.top / 2, o.z);
        mesh.rotation.y = o.heading;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      } else {
        this.colliders.push(new CylinderCollider({ id: o.id, x: o.x, z: o.z, r: o.r, top: o.top }));
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(o.r, o.r, o.top, 14),
          new THREE.MeshLambertMaterial({ color: o.color, flatShading: true })
        );
        mesh.position.set(o.x, o.top / 2, o.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(o.r + 0.05, o.r + 0.05, 0.5, 14),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        band.position.set(o.x, o.top - 0.6, o.z);
        this.scene.add(band);
      }
    }
  }

  _buildSpawns() {
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    for (let i = 0; i < SPAWN_COUNT; i++) {
      // Nudge each slot around the ring until it is clear of ramps / obstacles.
      let a = 0.4 + (i / SPAWN_COUNT) * Math.PI * 2;
      for (let k = 0; k < 40 && this.isBlocked(Math.sin(a) * SPAWN_RADIUS, Math.cos(a) * SPAWN_RADIUS, 5, 0); k++) {
        a += (k % 2 === 0 ? 1 : -1) * (k + 1) * 0.03;
      }
      const x = Math.sin(a) * SPAWN_RADIUS;
      const z = Math.cos(a) * SPAWN_RADIUS;
      const heading = Math.atan2(-x, -z); // face the arena centre
      this.spawns.push({ x, z, heading });

      const mark = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.9, 28), markMat);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(x, 0.04, z);
      this.scene.add(mark);
    }
  }

  _buildStadium() {
    const half = this.half;
    const th = CONFIG.WALL_THICKNESS;
    const rows = 3;
    const rowDepth = 7;
    const standMat = new THREE.MeshLambertMaterial({ color: 0x2a3555 });

    const crowdGeo = new THREE.BoxGeometry(1.1, 1.7, 1.1);
    const perRow = 62;
    const total = 4 * rows * perRow;
    const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), total);
    const palette = [0xff5c7a, 0xffd23a, 0x5cd6ff, 0x7cff7a, 0xb08cff, 0xffffff, 0xff9a3a];
    const color = new THREE.Color();
    const m = new THREE.Matrix4();
    let n = 0;

    for (let side = 0; side < 4; side++) {
      for (let r = 0; r < rows; r++) {
        const dist = half + th + 4 + r * rowDepth;
        const height = 2.5 + r * 2.6;
        const len = (half + th + 4 + r * rowDepth) * 2;
        const alongX = side < 2;
        const sign = side % 2 === 0 ? -1 : 1;

        const stand = new THREE.Mesh(
          new THREE.BoxGeometry(alongX ? len : rowDepth, height, alongX ? rowDepth : len),
          standMat
        );
        stand.position.set(alongX ? 0 : sign * dist, height / 2, alongX ? sign * dist : 0);
        stand.receiveShadow = true;
        this.scene.add(stand);

        for (let i = 0; i < perRow; i++) {
          const t = (i / (perRow - 1) - 0.5) * (len - 6);
          const jitter = (Math.random() - 0.5) * 2.2;
          const px = alongX ? t : sign * (dist + jitter * 0.5);
          const pz = alongX ? sign * (dist + jitter * 0.5) : t;
          m.makeTranslation(px, height + 0.85, pz);
          crowd.setMatrixAt(n, m);
          color.setHex(palette[Math.floor(Math.random() * palette.length)]);
          crowd.setColorAt(n, color);
          n++;
        }
      }
    }
    crowd.instanceMatrix.needsUpdate = true;
    crowd.instanceColor.needsUpdate = true;
    crowd.frustumCulled = false;
    this.crowd = crowd;
    this.scene.add(crowd);

    // Corner floodlight towers.
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x3a4468 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4c2 });
    const o = half + th + 14;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.6, 34, 8), towerMat);
      pole.position.set(sx * o, 17, sz * o);
      this.scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 2), lampMat);
      head.position.set(sx * o, 35, sz * o);
      head.lookAt(0, 20, 0);
      this.scene.add(head);
    }
  }
}
