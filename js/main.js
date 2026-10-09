import * as THREE from '../lib/three.module.min.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { AudioManager } from './audio.js';
import { Platform } from './platform.js';
import { Game } from './game.js';
import { Menus } from './menus.js';

// ---------------------------------------------------------------------------
// Bootstrap: renderer, scene, split-screen render loop, resize + adaptive resolution.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas');
const hud = new HUD();
const audio = new AudioManager();
const input = new Input();
const platform = new Platform();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // rendered once per frame, shared by every split-screen view
renderer.outputColorSpace = THREE.SRGBColorSpace;

const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
const MIN_PIXEL_RATIO = 0.6;
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const game = new Game({ scene, hud, audio, input, platform });

const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const menus = new Menus({ game, hud, audio, input, isTouch });

let viewW = window.innerWidth;
let viewH = window.innerHeight;

function resize() {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  renderer.setSize(viewW, viewH, false);
  game.setViewport(viewW, viewH, pixelRatio);
}
window.addEventListener('resize', resize);
resize();

// --- Global UI wiring ----------------------------------------------------------
hud.setMuteIcon(audio.muted);
document.getElementById('mute-btn').addEventListener('click', (e) => {
  hud.setMuteIcon(audio.toggleMute());
  e.currentTarget.blur();
});
input.onMute = () => hud.setMuteIcon(audio.toggleMute());
input.onPause = () => menus.togglePause();

window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) menus.onEnter();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) menus.pauseIfRunning();
});

// --- Rendering ----------------------------------------------------------------------

function renderViews() {
  const views = game.renderViews();
  renderer.shadowMap.needsUpdate = true;
  const split = views.length > 1;
  renderer.setScissorTest(split);
  for (const view of views) {
    const [rx, ry, rw, rh] = view.rect;
    const x = Math.round(rx * viewW);
    const w = Math.round(rw * viewW);
    const h = Math.round(rh * viewH);
    const y = Math.round((1 - ry - rh) * viewH); // GL origin is bottom-left
    const aspect = w / Math.max(1, h);
    if (Math.abs(view.camera.aspect - aspect) > 1e-3) {
      view.camera.aspect = aspect;
      view.camera.updateProjectionMatrix();
    }
    renderer.setViewport(x, y, w, h);
    if (split) renderer.setScissor(x, y, w, h);
    game.prepareView(view, h * pixelRatio);
    renderer.render(scene, view.camera);
  }
  renderer.setScissorTest(false);
}

// --- Main loop ------------------------------------------------------------------------

let last = performance.now();
let perfAccum = 0;
let perfFrames = 0;
let perfCooldown = 3;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 1 / 60;
  const rawDt = dt;
  dt = Math.min(dt, 1 / 20); // avoid huge steps after tab switches / hitches

  if (input.pollPadStart()) menus.togglePause();
  game.update(dt);
  renderViews();

  // Adaptive resolution: if we're consistently slower than ~45 fps, drop pixel ratio.
  perfAccum += rawDt;
  perfFrames++;
  perfCooldown -= rawDt;
  if (perfAccum >= 1.5) {
    const avg = perfAccum / perfFrames;
    perfAccum = 0;
    perfFrames = 0;
    if (perfCooldown <= 0 && avg > 1 / 45 && pixelRatio > MIN_PIXEL_RATIO) {
      pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.2);
      renderer.setPixelRatio(pixelRatio);
      resize();
      perfCooldown = 2;
    }
  }
}

// --- Boot -------------------------------------------------------------------------------
(async function boot() {
  await platform.init();
  // Warm up shaders so the first match frame doesn't hitch.
  renderer.compile(scene, game.overview.camera);
  hud.showLoading(false);
  menus.show('menu');
  platform.loadingFinished();
  last = performance.now();
  requestAnimationFrame(frame);
})();

// Exposed for debugging from the console / automated smoke tests.
window.__carTag = { game, menus, input, renderer, scene };
