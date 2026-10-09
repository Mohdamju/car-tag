# Car Tag: King of the Crown

A low-poly 3D arcade car-tag game built with plain JavaScript and Three.js. It needs no build step and has no physics engine.

Grab the crown and hold it longer than anyone else before the 90-second timer runs out. The crown holder is 15% slower and their nitro doesn't refill, so the chasers can catch up.

Modes (up to 6 cars per match; every mode has a Bots setting):

- **Solo**: you against 1–5 bots.
- **Local**: 2–4 players in split screen. Up to 2 players share the keyboard; players 3–4 use gamepads.
- **Online**: 2–6 players. One player creates a room and the others join with its 4-letter code.

## Run

ES modules need to be served over HTTP:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Three.js r160 and PeerJS 1.5.4 are stored in `lib/`, so no game code is downloaded from a CDN.

### Online play

Online play needs the game served from a real web address, such as GitHub Pages (Settings → Pages → deploy from this branch, root folder). Players connect directly to each other over WebRTC. Joining a room by code goes through the free PeerJS cloud server, and you can point the game at your own [`peerjs-server`](https://github.com/peers/peerjs-server) by adding URL parameters:

```
?peerhost=my.server.com&peerport=443&peerpath=/myapp
```

The host's browser runs the authoritative simulation and sends world state 20 times per second. Guests send their controls 30 times per second, simulate their own car immediately so it responds without delay, and blend toward the host's version. Other cars are drawn 100 ms in the past and interpolated between updates. There's no relay (TURN) server, so a small share of networks that block direct connections, such as strict corporate or mobile networks, can't join.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Drive | WASD / arrow keys | ◀ ▶ GAS BRAKE |
| Nitro (1.5x) | Shift | NITRO |
| Drift / handbrake | Space | DRIFT |
| Pause | P / Esc | — |
| Mute | M | SFX button |

Split screen: P1 uses WASD, Left Shift and Space. P2 uses the arrow keys, Right Shift (or `/`) and Right Ctrl (or `.`). On a gamepad: RT is gas, LT is brake/reverse, the left stick or d-pad steers, A or RB is nitro, B, X or LB is drift, and Start pauses.

## Project layout

| File | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | HUD, menus, results screen, touch controls |
| `js/main.js` | Renderer, split-screen render loop, resize, adaptive resolution |
| `js/menus.js` | Title, local setup, online room/lobby, pause and results screens |
| `js/online.js` | Online rooms over PeerJS: lobby, host snapshots, guest input |
| `js/config.js` | All tuning constants plus math helpers |
| `js/arena.js` | Arena visuals, lights, and the 2D+height collider world (ramps, platform, obstacles, walls) |
| `js/car.js` | Car models (muscle car and monster truck) and the kinematic arcade physics |
| `js/input.js` | Keyboard layouts, gamepads and touch; the most recently pressed of two opposite keys wins |
| `js/physics.js` | Car-vs-car contact (three circles per car) and impulse response |
| `js/bot.js` | Bot finite state machine (CHASE / EVADE / RECOVER) with obstacle-avoidance probes |
| `js/game.js` | Match flow, crown transfer rules, scoring, split-screen views, online host/guest sync |
| `js/crown.js` | Neon crown, 3D target arrows, name tags |
| `js/camera.js` | Smoothed 3rd-person chase camera and orbit camera |
| `js/hud.js` | Shared HUD plus one HUD per split-screen player; writes to the DOM only when values change |
| `js/particles.js` | Pooled particles drawn in a single call (smoke, sparks, tag bursts) |
| `js/audio.js` | Synthesized WebAudio sound effects (no audio files) |
| `js/platform.js` | Optional portal SDK hooks (e.g. `PokiSDK`); these do nothing when the SDK is absent |

To use the Poki SDK, add their SDK `<script>` tag before `js/main.js`. `platform.js` calls `gameplayStart`/`gameplayStop` automatically.
