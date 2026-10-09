import * as THREE from '../lib/three.module.min.js';

// ---------------------------------------------------------------------------
// Neon crown that spins and floats above whichever car is "It".
// ---------------------------------------------------------------------------

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,245,150,0.95)');
  grad.addColorStop(0.35, 'rgba(255,220,40,0.45)');
  grad.addColorStop(1, 'rgba(255,200,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Crown {
  constructor(scene) {
    this.group = new THREE.Group();
    this.spinner = new THREE.Group();
    this.group.add(this.spinner);

    const gold = new THREE.MeshBasicMaterial({ color: 0xffe500 });
    const goldDark = new THREE.MeshBasicMaterial({ color: 0xffb800 });
    const glowShell = new THREE.MeshBasicMaterial({
      color: 0xfff27a,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.85, 0.55, 10, 1, false), gold);
    this.spinner.add(band);
    const bandTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.12, 10, 1, false), goldDark);
    bandTrim.position.y = -0.2;
    this.spinner.add(bandTrim);

    // Five sharp spikes with jewel tips.
    const spikeGeo = new THREE.ConeGeometry(0.3, 1.05, 4);
    const jewelGeo = new THREE.OctahedronGeometry(0.14);
    const jewelColors = [0xff3df2, 0x3df2ff, 0xff3df2, 0x3df2ff, 0xff3df2];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(spikeGeo, gold);
      spike.position.set(Math.cos(a) * 0.72, 0.78, Math.sin(a) * 0.72);
      this.spinner.add(spike);
      const jewel = new THREE.Mesh(jewelGeo, new THREE.MeshBasicMaterial({ color: jewelColors[i] }));
      jewel.position.set(Math.cos(a) * 0.72, 1.4, Math.sin(a) * 0.72);
      this.spinner.add(jewel);
    }

    // Soft neon shell + sprite glow.
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.1, 0.8, 10), glowShell);
    shell.position.y = 0.1;
    this.spinner.add(shell);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    this.glow.scale.set(5.5, 5.5, 1);
    this.glow.position.y = 0.5;
    this.group.add(this.glow);

    // The only dynamic light in the scene: it makes the holder visibly "hot".
    this.light = new THREE.PointLight(0xffd84a, 90, 20, 2);
    this.light.position.y = 0.6;
    this.group.add(this.light);

    this.group.scale.setScalar(1.15);
    this.group.visible = false;
    scene.add(this.group);

    this.target = null;
    this.time = 0;
    this.pulse = 0;
  }

  /** Called when the crown changes hands; makes it pop. */
  onTransfer() {
    this.pulse = 1;
  }

  setTarget(car, snap = false) {
    this.target = car;
    this.group.visible = !!car;
    if (car && snap) {
      this.group.position.set(car.pos.x, car.pos.y + car.spec.crownHeight, car.pos.z);
    }
  }

  update(dt, lockActive) {
    const car = this.target;
    if (!car) return;
    this.time += dt;
    this.pulse = Math.max(0, this.pulse - dt * 2.5);

    const bob = Math.sin(this.time * 3.2) * 0.22;
    const ty = car.pos.y + car.spec.crownHeight + bob;
    const k = 1 - Math.exp(-16 * dt);
    const g = this.group.position;
    g.x += (car.pos.x - g.x) * k;
    g.y += (ty - g.y) * k;
    g.z += (car.pos.z - g.z) * k;

    this.spinner.rotation.y += dt * 2.6;
    this.spinner.rotation.z = Math.sin(this.time * 2) * 0.08;

    let s = 1.15 + this.pulse * 0.6;
    // Flicker while the 0.5 s steal-lock is active so players can see it is protected.
    if (lockActive) s *= 0.9 + 0.1 * Math.sin(this.time * 70);
    this.group.scale.setScalar(s);
    this.glow.material.opacity = 0.85 + Math.sin(this.time * 5) * 0.15;
  }
}

// ---------------------------------------------------------------------------
// 3D target arrows floating above each chaser, pointing at the crown holder.
// ---------------------------------------------------------------------------

export class TargetArrow {
  constructor(scene, color) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color });
    const edge = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Flat arrow lying in the horizontal plane, pointing along +z.
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 1.3), mat);
    shaft.position.z = -0.35;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.0, 3), mat);
    head.rotation.x = Math.PI / 2;
    head.scale.set(1, 1, 0.55);
    head.position.z = 0.65;
    const outlineHead = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.2, 3), edge);
    outlineHead.rotation.x = Math.PI / 2;
    outlineHead.scale.set(1, 1, 0.4);
    outlineHead.position.set(0, -0.05, 0.62);
    this.group.add(shaft, head, outlineHead);

    this.group.visible = false;
    scene.add(this.group);
    this.phase = Math.random() * 6;
  }

  update(dt, car, holder, visible) {
    const show = visible && holder && car !== holder;
    this.group.visible = !!show;
    if (!show) return;
    this.phase += dt * 4;
    const dx = holder.pos.x - car.pos.x;
    const dz = holder.pos.z - car.pos.z;
    const dy = holder.pos.y - car.pos.y;
    const dist = Math.hypot(dx, dz);
    this.group.position.set(car.pos.x, car.pos.y + car.spec.arrowHeight + Math.sin(this.phase) * 0.12, car.pos.z);
    this.group.rotation.set(0, Math.atan2(dx, dz), 0);
    // Tilt slightly up/down toward elevated targets.
    this.group.rotation.x = -Math.atan2(dy, Math.max(dist, 1)) * 0.5;
    this.group.rotation.order = 'YXZ';
    const s = car.isPlayer ? 1.6 : 1.1;
    this.group.scale.setScalar(s * (dist < 7 ? 0.7 : 1));
  }
}

// ---------------------------------------------------------------------------
// Name tags
// ---------------------------------------------------------------------------

export function makeLabel(text, colorHex) {
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.font = '900 34px "Trebuchet MS", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(10,14,30,0.9)';
  g.lineJoin = 'round';
  g.strokeText(text.toUpperCase(), w / 2, h / 2 + 2);
  g.fillStyle = `#${colorHex.toString(16).padStart(6, '0')}`;
  g.fillText(text.toUpperCase(), w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(6.4, 1.6, 1);
  sprite.renderOrder = 10;
  return sprite;
}
