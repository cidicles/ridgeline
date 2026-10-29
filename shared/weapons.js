// Weapon definitions and projectile flight, shared so the client can render
// the exact path the server simulates.

export const WEAPONS = [
  {
    id: 0, name: 'Disc Launcher', short: 'Disc',
    speed: 70, inherit: 0.5, gravity: 0, life: 6,
    refire: 1.1, damage: 48, splash: 7.5, knock: 1800, selfScale: 0.45, objScale: 1,
    ammo: 25, color: 0xd8f4ff,
  },
  {
    id: 1, name: 'Chaingun', short: 'Chain',
    speed: 340, inherit: 0.4, gravity: 0, life: 1.4,
    refire: 0.075, damage: 4.5, splash: 0, knock: 60, spread: 0.024, objScale: 0.6,
    ammo: 300, color: 0xffd27a,
  },
  {
    id: 2, name: 'Grenade Launcher', short: 'Grenade',
    speed: 45, inherit: 0.6, gravity: 20, life: 2.2, bounce: 0.45,
    refire: 0.9, damage: 55, splash: 9, knock: 2200, selfScale: 0.6, objScale: 1.2,
    ammo: 20, color: 0x9cff7a,
  },
  {
    id: 3, name: 'Plasma Rifle', short: 'Plasma',
    speed: 95, inherit: 0.3, gravity: 0, life: 3,
    refire: 0.5, damage: 30, splash: 3.5, knock: 500, selfScale: 0.5, objScale: 1,
    ammo: 40, color: 0xff6a3a,
  },
  {
    id: 4, name: 'Mortar', short: 'Mortar', armors: [2],
    speed: 52, inherit: 0.5, gravity: 20, life: 8,
    refire: 2.0, damage: 95, splash: 14, knock: 3200, selfScale: 0.7, objScale: 2.5,
    ammo: 10, color: 0x7affd0,
  },
  {
    id: 5, name: 'Laser Rifle', short: 'Laser', armors: [0],
    speed: 1500, inherit: 0, gravity: 0, life: 0.6,
    refire: 1.2, damage: 45, splash: 0, knock: 200, objScale: 0.3,
    ammo: Infinity, energyCost: 45, color: 0xff3050,
  },
  {
    // Base defence turrets only
    id: 6, name: 'Turret Bolt', short: 'Turret', hidden: true,
    speed: 120, inherit: 0, gravity: 0, life: 3,
    refire: 1.1, damage: 20, splash: 4, knock: 900, objScale: 0,
    ammo: Infinity, color: 0xffe14a,
  },
  {
    // Thrown with G, not a slot weapon
    id: 7, name: 'Hand Grenade', short: 'Nade', hidden: true,
    speed: 26, inherit: 0.8, gravity: 20, life: 1.8, bounce: 0.4,
    refire: 0.8, damage: 50, splash: 8, knock: 2000, selfScale: 0.6, objScale: 1,
    ammo: Infinity, color: 0xc8ff7a,
  },
];

// Backpacks: one per loadout
export const PACKS = [
  { id: 0, name: 'Energy Pack', desc: '+70% energy recharge' },
  { id: 1, name: 'Repair Pack', desc: 'Repair at double speed and range; hold F alone to heal yourself' },
  { id: 2, name: 'Shield Pack', desc: 'Energy absorbs half of incoming damage' },
  { id: 3, name: 'Ammo Pack', desc: '+60% ammo, +2 grenades, +1 repair kit' },
];

export const GRENADES = 3;
export const REPAIR_KITS = 1;
export const KIT_HEAL = 50;

export const PLAYER_WEAPONS = WEAPONS.filter((w) => !w.hidden).map((w) => w.id);

export function canCarry(armor, w) {
  const W = WEAPONS[w];
  return !!W && !W.hidden && (!W.armors || W.armors.includes(armor));
}

// Sensible default loadouts per armour
export const DEFAULT_LOADOUTS = [
  { armor: 0, weapons: [0, 1, 5], pack: 0 },
  { armor: 1, weapons: [0, 1, 2, 3], pack: 2 },
  { armor: 2, weapons: [0, 1, 2, 4, 3], pack: 3 },
];

// Clamp a requested loadout to what the armour allows
export function sanitizeLoadout(lo, slots) {
  const armor = [0, 1, 2].includes(lo?.armor) ? lo.armor : 1;
  const seen = new Set();
  const weapons = (Array.isArray(lo?.weapons) ? lo.weapons : [])
    .filter((w) => canCarry(armor, w) && !seen.has(w) && seen.add(w))
    .slice(0, slots[armor]);
  if (!weapons.length) weapons.push(0);
  const pack = [0, 1, 2, 3].includes(lo?.pack) ? lo.pack : 0;
  return { armor, weapons, pack };
}

export function ammoFor(weapons, pack) {
  const k = pack === 3 ? 1.6 : 1;
  return WEAPONS.map((w) => (weapons.includes(w.id) ? (w.ammo === Infinity ? w.ammo : Math.round(w.ammo * k)) : 0));
}

export const grenadesFor = (pack) => GRENADES + (pack === 3 ? 2 : 0);
export const kitsFor = (pack) => REPAIR_KITS + (pack === 3 ? 1 : 0);

// Advance a projectile one step. Returns {type:'hit', point, normal, target?, box?} or null.
// `targets` is an iterable of {id, pos, alive, r, yOff} for direct hits (skip the owner briefly).
export function stepProjectile(pr, dt, world, targets) {
  const w = WEAPONS[pr.w];
  pr.age += dt;
  const ax = pr.pos[0], ay = pr.pos[1], az = pr.pos[2];
  pr.vel[1] -= w.gravity * dt;
  const bx = ax + pr.vel[0] * dt, by = ay + pr.vel[1] * dt, bz = az + pr.vel[2] * dt;

  let best = null;
  if (targets) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    for (const tg of targets) {
      if (!tg.alive || (tg.id === pr.owner && pr.age < 0.25) || tg.id === pr.ignore) continue;
      const r = tg.r || 1;
      const cx = tg.pos[0], cy = tg.pos[1] + (tg.yOff ?? 1.1), cz = tg.pos[2];
      let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / (len2 || 1);
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
      if (px * px + py * py * 0.5 + pz * pz < r * r * 1.4) {
        if (!best || t < best.t) best = { t, target: tg };
      }
    }
  }
  const hit = world.raycast(ax, ay, az, bx, by, bz);
  if (hit && (!best || hit.t < best.t)) {
    if (w.bounce && pr.age < w.life && !(hit.box && hit.box.obj)) {
      const n = hit.normal;
      const vn = pr.vel[0] * n[0] + pr.vel[1] * n[1] + pr.vel[2] * n[2];
      pr.vel[0] = (pr.vel[0] - 2 * vn * n[0]) * w.bounce;
      pr.vel[1] = (pr.vel[1] - 2 * vn * n[1]) * w.bounce;
      pr.vel[2] = (pr.vel[2] - 2 * vn * n[2]) * w.bounce;
      pr.pos[0] = hit.point[0] + n[0] * 0.15;
      pr.pos[1] = hit.point[1] + n[1] * 0.15;
      pr.pos[2] = hit.point[2] + n[2] * 0.15;
      return null;
    }
    pr.pos = hit.point;
    return { type: 'hit', point: hit.point, normal: hit.normal, box: hit.box };
  }
  if (best) {
    const t = best.t;
    pr.pos = [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
    return { type: 'hit', point: pr.pos, normal: [0, 1, 0], target: best.target };
  }
  pr.pos = [bx, by, bz];
  if (pr.age >= w.life) {
    return w.bounce ? { type: 'hit', point: pr.pos, normal: [0, 1, 0] } : { type: 'expire', point: pr.pos };
  }
  return null;
}
