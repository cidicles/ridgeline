// Player movement shared by client prediction and server-side bots.
// Momentum is king: landing on a slope projects velocity onto it instead of killing it.

export const PHYS = {
  gravity: 20,
  groundAccel: 70,
  friction: 18,
  airAccel: 5,
  jumpSpeed: 7.5,
  drag: 0.00035,
  maxSpeed: 160,
  steepSlope: 0.62,
  halfWidth: 0.6,
  eyeHeight: 1.9,
  impactThreshold: 30,
};

// Three frames trading speed and agility for armour and firepower.
export const ARMORS = [
  {
    id: 0, name: 'Light', hp: 70, maxEnergy: 100, energyRegen: 15, jetDrain: 28,
    jetUp: 33, jetSide: 16, runSpeed: 12.5, mass: 0.8, slots: 3, height: 2.0, eyeHeight: 1.75,
    scale: [0.9, 0.93, 0.9], hitRadius: 0.9, impactScale: 0.8,
  },
  {
    id: 1, name: 'Medium', hp: 100, maxEnergy: 110, energyRegen: 14, jetDrain: 30,
    jetUp: 30.5, jetSide: 13, runSpeed: 10.5, mass: 1.0, slots: 4, height: 2.2, eyeHeight: 1.9,
    scale: [1, 1, 1], hitRadius: 1.0, impactScale: 1,
  },
  {
    id: 2, name: 'Heavy', hp: 160, maxEnergy: 130, energyRegen: 13, jetDrain: 32,
    jetUp: 27, jetSide: 9, runSpeed: 8.5, mass: 1.6, slots: 5, height: 2.5, eyeHeight: 2.15,
    scale: [1.25, 1.12, 1.25], hitRadius: 1.2, impactScale: 1.4,
  },
];

export function newPlayerState(pos, armor = 1) {
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [0, 0, 0],
    yaw: 0, pitch: 0,
    armor,
    energy: ARMORS[armor].maxEnergy,
    onGround: false,
    groundN: [0, 1, 0],
    jetting: false,
    skiing: false,
  };
}

const tmpN = [0, 1, 0];
const scratch = [];

// input: { fwd:-1..1, side:-1..1, jet:bool, ski:bool, jump:bool, yaw }
// Returns impact speed (into-surface) if a hard landing happened, else 0.
export function stepPlayer(p, input, dt, world) {
  const P = PHYS, A = ARMORS[p.armor ?? 1];
  const v = p.vel, pos = p.pos;
  p.yaw = input.yaw;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  // Forward is -Z when yaw = 0 (three.js camera convention)
  let wx = -sy * input.fwd + cy * input.side;
  let wz = -cy * input.fwd - sy * input.side;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-4) { wx /= wl; wz /= wl; }

  v[1] -= P.gravity * dt;

  // Jetpack
  p.jetting = false;
  if (input.jet && p.energy > 0.5) {
    p.jetting = true;
    p.energy = Math.max(0, p.energy - A.jetDrain * dt);
    const sideShare = wl > 1e-4 ? 1 : 0;
    v[1] += A.jetUp * (1 - 0.25 * sideShare) * dt;
    v[0] += wx * A.jetSide * sideShare * dt;
    v[2] += wz * A.jetSide * sideShare * dt;
  } else {
    p.energy = Math.min(A.maxEnergy, p.energy + A.energyRegen * (p.regenMul || 1) * dt);
  }

  const n = p.groundN;
  const steep = n[1] < P.steepSlope;
  p.skiing = p.onGround && (input.ski || steep);

  if (p.onGround && !p.jetting) {
    if (input.jump) {
      // Jump along the surface normal blended with up, like a pop off the slope
      v[0] += n[0] * P.jumpSpeed * 0.4;
      v[1] += P.jumpSpeed;
      v[2] += n[2] * P.jumpSpeed * 0.4;
      p.onGround = false;
    } else if (!p.skiing) {
      // Walking: steer horizontal velocity toward the wish velocity with friction.
      const tx = wx * A.runSpeed, tz = wz * A.runSpeed;
      let dx = tx - v[0], dz = tz - v[2];
      const dl = Math.hypot(dx, dz);
      const speed = Math.hypot(v[0], v[2]);
      const accel = (wl > 1e-4 && speed <= A.runSpeed * 1.05) ? P.groundAccel : P.friction;
      const maxDelta = accel * dt;
      if (dl > maxDelta) { dx *= maxDelta / dl; dz *= maxDelta / dl; }
      v[0] += dx; v[2] += dz;
    }
  } else if (!p.onGround && wl > 1e-4) {
    // A little air control, only up to a modest speed in the wish direction
    const along = v[0] * wx + v[2] * wz;
    if (along < 18) {
      v[0] += wx * P.airAccel * dt;
      v[2] += wz * P.airAccel * dt;
    }
  }

  // Quadratic drag keeps top speed sane
  const sp = Math.hypot(v[0], v[1], v[2]);
  if (sp > 0) {
    const k = Math.max(0, 1 - P.drag * sp * dt);
    v[0] *= k; v[1] *= k; v[2] *= k;
    if (sp > P.maxSpeed) { const s = P.maxSpeed / sp; v[0] *= s; v[1] *= s; v[2] *= s; }
  }

  pos[0] += v[0] * dt; pos[1] += v[1] * dt; pos[2] += v[2] * dt;

  let impact = 0;
  const wasGround = p.onGround;
  p.onGround = false;

  // Terrain
  const h = world.height(pos[0], pos[2]);
  if (pos[1] <= h + 0.02) {
    world.normal(pos[0], pos[2], tmpN);
    pos[1] = h;
    const vn = v[0] * tmpN[0] + v[1] * tmpN[1] + v[2] * tmpN[2];
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      v[0] -= tmpN[0] * vn; v[1] -= tmpN[1] * vn; v[2] -= tmpN[2] * vn;
    }
    p.onGround = true;
    n[0] = tmpN[0]; n[1] = tmpN[1]; n[2] = tmpN[2];
  } else if (wasGround && !p.jetting && !input.jump && !input.ski && pos[1] - h < 0.6 && v[1] <= 0.5) {
    // Stick to the ground when walking over crests
    world.normal(pos[0], pos[2], tmpN);
    pos[1] = h;
    const vn = v[0] * tmpN[0] + v[1] * tmpN[1] + v[2] * tmpN[2];
    if (vn > 0) { v[0] -= tmpN[0] * vn; v[1] -= tmpN[1] * vn; v[2] -= tmpN[2] * vn; }
    p.onGround = true;
    n[0] = tmpN[0]; n[1] = tmpN[1]; n[2] = tmpN[2];
  }

  // Structures (AABB vs AABB, resolve on the axis of least penetration)
  const hw = P.halfWidth, ph = A.height;
  for (const b of world.boxes) {
    const minX = pos[0] - hw, maxX = pos[0] + hw;
    const minY = pos[1], maxY = pos[1] + ph;
    const minZ = pos[2] - hw, maxZ = pos[2] + hw;
    if (maxX <= b.min[0] || minX >= b.max[0] || maxY <= b.min[1] || minY >= b.max[1] ||
        maxZ <= b.min[2] || minZ >= b.max[2]) continue;
    const pens = [
      [b.max[0] - minX, 0, 1], [maxX - b.min[0], 0, -1],
      [b.max[1] - minY, 1, 1], [maxY - b.min[1], 1, -1],
      [b.max[2] - minZ, 2, 1], [maxZ - b.min[2], 2, -1],
    ];
    // Prefer stepping up onto low ledges
    let best = pens[0];
    for (const c of pens) if (c[0] < best[0]) best = c;
    if (pens[2][0] < 0.7 && v[1] <= 2) best = pens[2];
    const [d, axis, sign] = best;
    pos[axis] += d * sign;
    if (v[axis] * sign < 0) {
      if (axis === 1 && sign > 0) impact = Math.max(impact, -v[1]);
      v[axis] = 0;
    }
    if (axis === 1 && sign > 0) {
      p.onGround = true;
      n[0] = 0; n[1] = 1; n[2] = 0;
    }
  }

  // Tree trunks, rock spires and boulders
  if (world.collidersIn) {
    for (const c of world.collidersIn(pos[0] - 2, pos[2] - 2, pos[0] + 2, pos[2] + 2, scratch)) {
      if (c.type === 'cyl') {
        if (pos[1] + ph <= c.y0 || pos[1] > c.y1) continue;
        const dx = pos[0] - c.x, dz = pos[2] - c.z;
        const d = Math.hypot(dx, dz), rr = c.r + hw;
        if (d >= rr) continue;
        if (pos[1] > c.y1 - 0.7 && v[1] <= 0.5) {
          // Standing on top of a spire
          if (v[1] < 0) { impact = Math.max(impact, -v[1]); v[1] = 0; }
          pos[1] = c.y1; p.onGround = true; n[0] = 0; n[1] = 1; n[2] = 0;
          continue;
        }
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        pos[0] = c.x + nx * rr; pos[2] = c.z + nz * rr;
        const vn = v[0] * nx + v[2] * nz;
        if (vn < 0) { v[0] -= nx * vn; v[2] -= nz * vn; }
      } else {
        // Boulders are smooth, so you ski over them like terrain
        const cx = pos[0] - c.x, cy = pos[1] + 0.9 - c.y, cz = pos[2] - c.z;
        const d = Math.hypot(cx, cy, cz), rr = c.r + 0.75;
        if (d >= rr || d < 1e-4) continue;
        const nx = cx / d, ny = cy / d, nz = cz / d;
        pos[0] += nx * (rr - d); pos[1] += ny * (rr - d); pos[2] += nz * (rr - d);
        const vn = v[0] * nx + v[1] * ny + v[2] * nz;
        if (vn < 0) { impact = Math.max(impact, -vn); v[0] -= nx * vn; v[1] -= ny * vn; v[2] -= nz * vn; }
        if (ny > 0.55) { p.onGround = true; n[0] = nx; n[1] = ny; n[2] = nz; }
      }
    }
  }

  // Fluids: heavy drag, buoyancy near the surface, and no skiing
  const fl = world.fluid;
  p.inFluid = 0;
  if (fl && pos[1] < fl.level) {
    const depth = fl.level - pos[1];
    p.inFluid = depth;
    const k = Math.max(0, 1 - (fl.kind === 'lava' ? 3.5 : 2.2) * dt);
    v[0] *= k; v[2] *= k;
    // Water floats you with your head out; lava just swallows you
    const lift = fl.kind === 'lava' ? 6 : depth > 1.4 ? 30 : depth > 0.7 ? 22 : 8;
    v[1] = v[1] * Math.max(0, 1 - 3 * dt) + lift * dt;
    p.skiing = false;
  }

  // Mission area: shove back toward the middle
  if (world.outOfBounds(pos[0], pos[2])) {
    const dx = world.center[0] - pos[0], dz = world.center[1] - pos[2];
    const l = Math.hypot(dx, dz);
    v[0] += dx / l * 40 * dt;
    v[2] += dz / l * 40 * dt;
  }

  return impact > P.impactThreshold ? impact * A.impactScale : 0;
}

export function eyeHeight(p) {
  return ARMORS[p.armor ?? 1].eyeHeight;
}

export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
