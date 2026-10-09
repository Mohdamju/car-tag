// Central tuning values for the whole game. Everything gameplay-related that a
// designer might want to tweak lives here.

export const CONFIG = {
  // Match flow
  MATCH_TIME: 90,
  COUNTDOWN_TIME: 3,
  TOTAL_CARS: 6, // humans + bots; bots fill every empty slot
  MAX_LOCAL_PLAYERS: 4, // split-screen
  MAX_ONLINE_PLAYERS: 6,

  // Arena
  ARENA_HALF: 80,
  WALL_HEIGHT: 5,
  WALL_THICKNESS: 6,
  PLATFORM_HEIGHT: 4,

  // World physics
  GRAVITY: 34,
  STEP_UP: 0.7, // max height a grounded car climbs per frame without being "airborne"
  SNAP_DOWN: 0.8, // max drop a grounded car follows without leaving the ground
  OBSTACLE_CLEARANCE: 0.75, // car is not blocked by solids lower than this above its wheels

  // Crown rules
  TAG_COOLDOWN: 0.5,
  TAG_EXTRA_REACH: 0.5,
  HOLDER_SPEED_FACTOR: 0.85,

  // Nitro
  BOOST_MULT: 1.5,
  NITRO_MAX: 100,
  NITRO_DRAIN: 30,
  NITRO_REGEN: 15,
  NITRO_REGEN_DELAY: 0.8,
  NITRO_UNLOCK: 25,

  // Camera
  CAMERA_FOV: 62,

  // Online
  NET_SNAPSHOT_HZ: 20, // host -> guests world state
  NET_INPUT_HZ: 30, // guest -> host controls
  NET_INTERP_DELAY: 0.1, // guests render other cars this far in the past (s)
  NET_ROOM_PREFIX: 'cartag-kotc-',
};

export const TWO_PI = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapAngle(a) {
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
