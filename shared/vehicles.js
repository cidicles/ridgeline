// Single-seat hover skiff: fast transport that floats over terrain.
// Driven with client prediction just like a player; the server steps it when empty.

export const SKIFF = {
  hp: 300,
  hoverHeight: 2.4,
  spring: 14,
  damping: 3.5,
  thrust: 26,
  strafe: 12,
  lift: 30,
  energy: 100,
  liftDrain: 25,
  energyRegen: 15,
  dragLin: 0.15,
  dragQuad: 0.0012,
  grip: 1.6,
  halfWidth: 1.4,
  height: 1.3,
  hitRadius: 2.2,
  respawn: 20,
  ramSpeed: 25,
};

export function newSkiff(id, team, pos, yaw) {
  return {
    id, team, pos: [...pos], vel: [0, 0, 0], yaw, pitch: 0, roll: 0,
    energy: SKIFF.energy, hp: SKIFF.hp, driver: 0, alive: true, respawnAt: 0, lifting: false,
  };
}

const n = [0, 1, 0];
const scratch = [];

// input: { fwd, side, jet, yaw } ; returns impact speed for a hard collision, else 0
export function stepSkiff(s, input, dt, world) {
  const S = SKIFF, v = s.vel, p = s.pos;
  s.yaw = input.yaw;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);

  v[1] -= 20 * dt;

  // Hover spring against whichever is higher: terrain or a structure roof below
  let ground = world.height(p[0], p[2]);
  for (const b of world.boxes) {
    if (p[0] > b.min[0] && p[0] < b.max[0] && p[2] > b.min[2] && p[2] < b.max[2] && b.max[1] <= p[1] + 0.5) ground = Math.max(ground, b.max[1]);
  }
  const alt = p[1] - ground;
  if (alt < S.hoverHeight + 1.5) {
    const push = (S.hoverHeight - alt) * S.spring - v[1] * S.damping;
    if (push > 0) v[1] += push * dt;
  }

  // Engines
  v[0] += (fx * input.fwd * S.thrust + rx * input.side * S.strafe) * dt;
  v[2] += (fz * input.fwd * S.thrust + rz * input.side * S.strafe) * dt;
  s.lifting = false;
  if (input.jet && s.energy > 1) {
    s.lifting = true;
    s.energy = Math.max(0, s.energy - S.liftDrain * dt);
    v[1] += S.lift * dt;
  } else {
    s.energy = Math.min(S.energy, s.energy + S.energyRegen * dt);
  }

  // Grip: bleed sideways slide so it carves rather than drifts forever
  const side = v[0] * rx + v[2] * rz;
  const k = Math.min(1, S.grip * dt);
  v[0] -= rx * side * k; v[2] -= rz * side * k;

  const sp = Math.hypot(v[0], v[1], v[2]);
  const drag = Math.min(1, (S.dragLin + S.dragQuad * sp) * dt);
  v[0] *= 1 - drag; v[2] *= 1 - drag; v[1] *= 1 - drag * 0.5;

  p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;

  let impact = 0;
  const h = world.height(p[0], p[2]);
  if (p[1] < h + 0.6) {
    world.normal(p[0], p[2], n);
    p[1] = h + 0.6;
    const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    if (vn < 0) { impact = -vn; v[0] -= n[0] * vn; v[1] -= n[1] * vn; v[2] -= n[2] * vn; }
  }

  const hw = S.halfWidth;
  for (const b of world.boxes) {
    if (p[0] + hw <= b.min[0] || p[0] - hw >= b.max[0] || p[1] + S.height <= b.min[1] || p[1] >= b.max[1] ||
        p[2] + hw <= b.min[2] || p[2] - hw >= b.max[2]) continue;
    const pens = [
      [b.max[0] - (p[0] - hw), 0, 1], [p[0] + hw - b.min[0], 0, -1],
      [b.max[1] - p[1], 1, 1], [p[1] + S.height - b.min[1], 1, -1],
      [b.max[2] - (p[2] - hw), 2, 1], [p[2] + hw - b.min[2], 2, -1],
    ];
    let best = pens[0];
    for (const c of pens) if (c[0] < best[0]) best = c;
    const [d, axis, sign] = best;
    p[axis] += d * sign;
    if (v[axis] * sign < 0) { impact = Math.max(impact, Math.abs(v[axis])); v[axis] *= -0.2; }
  }

  // Scenery: shove the hull off trunks, spires and boulders
  if (world.collidersIn) {
    for (const c of world.collidersIn(p[0] - 3, p[2] - 3, p[0] + 3, p[2] + 3, scratch)) {
      const top = c.type === 'cyl' ? c.y1 : c.y + c.r;
      if (p[1] > top || (c.type === 'cyl' && p[1] + S.height < c.y0)) continue;
      const dx = p[0] - c.x, dz = p[2] - c.z;
      const r = c.type === 'cyl' ? c.r : Math.sqrt(Math.max(0, c.r * c.r - (p[1] - c.y) ** 2));
      const d = Math.hypot(dx, dz), rr = r + hw;
      if (d >= rr || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      p[0] = c.x + nx * rr; p[2] = c.z + nz * rr;
      const vn = v[0] * nx + v[2] * nz;
      if (vn < 0) { impact = Math.max(impact, -vn); v[0] -= nx * vn * 1.3; v[2] -= nz * vn * 1.3; }
    }
  }

  if (world.outOfBounds(p[0], p[2])) {
    const dx = world.center[0] - p[0], dz = world.center[1] - p[2];
    const l = Math.hypot(dx, dz);
    v[0] += dx / l * 40 * dt; v[2] += dz / l * 40 * dt;
  }

  // Visual attitude: nose follows climb, bank into turns
  const hs = Math.hypot(v[0], v[2]);
  s.pitch += (Math.atan2(v[1], Math.max(hs, 5)) * 0.6 - s.pitch) * Math.min(1, dt * 5);
  s.roll += (-side * 0.03 - s.roll) * Math.min(1, dt * 5);
  return impact > 22 ? impact : 0;
}
