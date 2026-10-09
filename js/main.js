import * as THREE from '../lib/three.module.min.js';
import { CONFIG } from './config.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { AudioManager } from './audio.js';
import { Platform } from './platform.js';
import { Game, GameState } from './game.js';

// ---------------------------------------------------------------------------
// Bootstrap: renderer, scene, game loop, resize + adaptive resolution.
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
renderer.outputColorSpace = THREE.SRGBColorSpace;

const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
const MIN_PIXEL_RATIO = 0.6;
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV, window.innerWidth / window.innerHeight, 0.3, 900);

const game = new Game({ scene, camera, hud, audio, input, platform });

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  game.setViewHeight(h * pixelRatio);
}
window.addEventListener('resize', resize);
resize();

// --- Touch detection --------------------------------------------------------
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// --- UI wiring --------------------------------------------------------------
function start() {
  audio.unlock();
  game.startMatch();
  hud.showTouch(isTouch);
}

document.getElementById('start-btn').addEventListener('click', start);
document.getElementById('again-btn').addEventListener('click', start);
document.getElementById('resume-btn').addEventListener('click', () => game.togglePause());
document.getElementById('restart-btn').addEventListener('click', () => {
  audio.unlock();
  game.restartFromPause();
});

hud.setMuteIcon(audio.muted);
document.getElementById('mute-btn').addEventListener('click', (e) => {
  hud.setMuteIcon(audio.toggleMute());
  e.currentTarget.blur();
});
input.onMute = () => hud.setMuteIcon(audio.toggleMute());
input.onPause = () => game.togglePause();

// Enter / Space start or restart from overlays for keyboard players.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Enter') return;
  if (game.state === GameState.MENU || (game.state === GameState.ENDED && !document.getElementById('results').classList.contains('hidden'))) {
    start();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pauseIfRunning();
});

// --- Main loop ----------------------------------------------------------------
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

  game.update(dt);
  renderer.render(scene, camera);

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

// --- Boot -------------------------------------------------------------------
(async function boot() {
  await platform.init();
  // Warm up shaders so the first match frame doesn't hitch.
  renderer.compile(scene, camera);
  hud.showLoading(false);
  hud.showMenu(true);
  platform.loadingFinished();
  last = performance.now();
  requestAnimationFrame(frame);
})();

// Exposed for debugging from the console / automated smoke tests.
window.__carTag = { game, renderer, scene, camera };
