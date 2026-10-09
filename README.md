# Car Tag: King of the Crown

A low-poly 3D arcade car-tag game built with plain JavaScript and Three.js. It needs no build step and has no physics engine.

Grab the crown and hold it longer than anyone else before the 90-second timer runs out. The crown holder is 15% slower and their nitro doesn't refill, so the five AI rivals will catch them.

## Run

ES modules need to be served over HTTP:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Three.js r160 is vendored in `lib/`, so the game makes no external requests.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Drive | WASD / arrow keys | ◀ ▶ GAS BRAKE |
| Nitro (1.5x) | Shift | NITRO |
| Drift / handbrake | Space | DRIFT |
| Pause | P / Esc | — |
| Mute | M | SFX button |

## Project layout

| File | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | HUD, menus, results screen, touch controls |
| `js/main.js` | Renderer, main loop, resize, adaptive resolution, UI wiring |
| `js/config.js` | All tuning constants plus math helpers |
| `js/arena.js` | Arena visuals, lights, and the 2D+height collider world (ramps, platform, obstacles, walls) |
| `js/car.js` | Car models (muscle car and monster truck) and the kinematic arcade physics |
| `js/physics.js` | Car-vs-car contact (three circles per car) and impulse response |
| `js/bot.js` | Bot finite state machine (CHASE / EVADE / RECOVER) with obstacle-avoidance probes |
| `js/game.js` | Match flow, crown transfer rules, scoring, effects |
| `js/crown.js` | Neon crown, 3D target arrows, name tags |
| `js/camera.js` | Smoothed 3rd-person chase camera and orbit camera |
| `js/hud.js` | DOM HUD that only writes when values change |
| `js/particles.js` | Pooled particles drawn in a single call (smoke, sparks, tag bursts) |
| `js/audio.js` | Synthesized WebAudio sound effects (no audio files) |
| `js/platform.js` | Optional portal SDK hooks (e.g. `PokiSDK`); these do nothing when the SDK is absent |

To use the Poki SDK, add their SDK `<script>` tag before `js/main.js`. `platform.js` calls `gameplayStart`/`gameplayStop` automatically.
