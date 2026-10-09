// Car-vs-car collision detection and response.
//
// Each car is approximated by three circles (rear / centre / front) so long
// cars bump realistically on their ends and sides. All maths is plain 2D
// vector work on the x/z plane; height is only used to ignore cars that are on
// clearly different levels (e.g. one on the platform, one underneath).

const MAX_LEVEL_DIFF = 2.4;
const RESTITUTION = 0.55;

const _ca = { x: 0, z: 0 };
const _cb = { x: 0, z: 0 };

/** Result of the last `contact()` call. */
export const CONTACT = { nx: 0, nz: 0, pen: 0, px: 0, pz: 0 };

/**
 * Deepest overlap between two cars' circle sets. `extra` inflates the radii (used for
 * the slightly more forgiving tag reach). Returns true and fills CONTACT when touching.
 * The normal points from `b` toward `a`.
 */
export function contact(a, b, extra = 0) {
  if (Math.abs(a.pos.y - b.pos.y) > MAX_LEVEL_DIFF) return false;
  const reach = a.spec.radius + b.spec.radius + extra;
  let best = 0;
  let found = false;
  for (let i = 0; i < 3; i++) {
    a.circle(i, _ca);
    for (let j = 0; j < 3; j++) {
      b.circle(j, _cb);
      const dx = _ca.x - _cb.x;
      const dz = _ca.z - _cb.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      const pen = reach - d;
      if (pen > best) {
        best = pen;
        found = true;
        if (d > 1e-5) {
          CONTACT.nx = dx / d;
          CONTACT.nz = dz / d;
        } else {
          CONTACT.nx = 1;
          CONTACT.nz = 0;
        }
        CONTACT.pen = pen;
        CONTACT.px = (_ca.x + _cb.x) * 0.5;
        CONTACT.pz = (_ca.z + _cb.z) * 0.5;
      }
    }
  }
  return found;
}

/**
 * Separate two overlapping cars and exchange momentum (mass weighted).
 * Returns the closing speed along the contact normal (0 if they were separating).
 */
export function resolvePair(a, b) {
  if (!contact(a, b, 0)) return 0;
  const nx = CONTACT.nx;
  const nz = CONTACT.nz;
  const ma = a.spec.mass;
  const mb = b.spec.mass;
  const total = ma + mb;

  // Positional correction, heavier cars move less.
  const push = CONTACT.pen;
  a.pos.x += nx * push * (mb / total);
  a.pos.z += nz * push * (mb / total);
  b.pos.x -= nx * push * (ma / total);
  b.pos.z -= nz * push * (ma / total);

  const rv = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
  if (rv >= 0) return 0;
  const j = (-(1 + RESTITUTION) * rv) / (1 / ma + 1 / mb);
  a.vel.x += (nx * j) / ma;
  a.vel.z += (nz * j) / ma;
  b.vel.x -= (nx * j) / mb;
  b.vel.z -= (nz * j) / mb;
  return -rv;
}
