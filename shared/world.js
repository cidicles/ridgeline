// Terrain, map definitions and static collision. Runs in both Node and the browser,
// so it must stay deterministic: integer hashing only, no Math.random.

import { buildKeep, KEEP } from './base.js';

export const GRID = 192;          // cells per side
export const CELL = 8;            // metres per cell
export const SIZE = GRID * CELL;  // 1536 m, the terrain tiles infinitely beyond this

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Periodic value noise: `period` lattice points per side so the result tiles.
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const m = (v) => ((v % period) + period) % period;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export const MAPS = [
  {
    name: 'Glasswater Basin',
    seed: 1337,
    amp: 280, ridge: 0.35, baseFreq: 3,
    palette: 'temperate',
    scenery: { tree: 'pine', trees: 380, boulders: 60, rocks: 420 },
    fluid: { kind: 'water', level: 42 },
    weather: 'motes', ground: 'grass',
    sky: { top: [0.30, 0.48, 0.72], horizon: [0.72, 0.80, 0.86], fog: [0.70, 0.77, 0.83] },
    sun: [0.5, 0.75, 0.35],
    fogDensity: 0.0014,
    bases: [
      { team: 0, x: 0.22, z: 0.30 },
      { team: 1, x: 0.76, z: 0.68 },
    ],
  },
  {
    name: 'Cinder Shelf',
    seed: 9001,
    amp: 230, ridge: 0.6, baseFreq: 4,
    palette: 'desert',
    scenery: { spires: 34, boulders: 80, rocks: 500 },
    weather: 'dust', ground: 'scrub',
    sky: { top: [0.42, 0.36, 0.40], horizon: [0.88, 0.66, 0.48], fog: [0.80, 0.62, 0.48] },
    sun: [-0.4, 0.55, 0.6],
    fogDensity: 0.0017,
    bases: [
      { team: 0, x: 0.25, z: 0.72 },
      { team: 1, x: 0.74, z: 0.26 },
    ],
  },
  {
    name: 'Whiteout Pass',
    seed: 4242,
    amp: 300, ridge: 0.5, baseFreq: 3,
    palette: 'snow', weather: 'snow',
    scenery: { tree: 'snowpine', trees: 300, boulders: 45, rocks: 260 },
    sky: { top: [0.55, 0.62, 0.72], horizon: [0.86, 0.88, 0.92], fog: [0.84, 0.86, 0.90] },
    sun: [0.2, 0.5, -0.7],
    fogDensity: 0.0022,
    bases: [
      { team: 0, x: 0.50, z: 0.20 },
      { team: 1, x: 0.50, z: 0.80 },
    ],
  },
  {
    name: 'Thornwood Mesa',
    seed: 777,
    amp: 240, ridge: 0.25, baseFreq: 2, terrace: 18,
    palette: 'temperate',
    scenery: { tree: 'broadleaf', trees: 360, boulders: 50, rocks: 360 },
    weather: 'motes', ground: 'grass',
    sky: { top: [0.20, 0.24, 0.44], horizon: [0.95, 0.62, 0.42], fog: [0.80, 0.60, 0.50] },
    sun: [0.85, 0.28, 0.2],
    fogDensity: 0.0016,
    bases: [
      { team: 0, x: 0.24, z: 0.50 },
      { team: 1, x: 0.76, z: 0.52 },
    ],
  },
  {
    name: 'Ashfall Crater',
    seed: 2468,
    amp: 200, ridge: 0.8, baseFreq: 3, crater: { r: 0.3, depth: 45, rim: 60 },
    palette: 'volcanic', weather: 'ash',
    scenery: { tree: 'dead', trees: 170, spires: 12, boulders: 90, rocks: 520 },
    fluid: { kind: 'lava', level: 8 },
    sky: { top: [0.16, 0.14, 0.17], horizon: [0.58, 0.38, 0.30], fog: [0.44, 0.33, 0.29] },
    sun: [-0.3, 0.6, -0.5],
    fogDensity: 0.002,
    bases: [
      { team: 0, x: 0.21, z: 0.22 },
      { team: 1, x: 0.79, z: 0.78 },
    ],
  },
];

// Base objects: hit points per type
export const OBJECT_HP = { gen: 900, turret: 350, station: 0, vpad: 0 };

export const TEAM_NAMES = ['Ember', 'Glacier'];
export const TEAM_COLORS = [0xff7a2a, 0x3ac8ff];

export class World {
  constructor(mapIndex) {
    this.mapIndex = mapIndex;
    this.def = MAPS[mapIndex];
    this.heights = new Float32Array((GRID + 1) * (GRID + 1));
    this.boxes = [];       // {min:[x,y,z], max:[x,y,z], kind, team}
    this.flagStands = [];  // per team [x,y,z]
    this.spawns = [];      // per team array of [x,y,z]
    this.objects = [];     // generators, turrets, stations, vehicle pads (index = object id)
    this.navs = [];        // per keep: {team, min, max, nodes, links} waypoint graph for bots
    this.bases = [];       // layout frames, for decorating structures
    this.fluid = this.def.fluid || null; // lake or lava pool filling everything below its level
    this.scenery = [];     // {kind, x, y, z, s, rot} for rendering
    this.colliders = [];   // trunks/spires {type:'cyl', x, z, r, y0, y1} and boulders {type:'sphere', x, y, z, r}
    this.cgrid = new Map();
    this.stamp = 0;
    this.center = [SIZE / 2, SIZE / 2];
    this.boundsHalf = SIZE * 0.42;
    this.generate();
  }

  generate() {
    const d = this.def;
    const bases = d.bases.map((b) => ({ ...b, wx: b.x * SIZE, wz: b.z * SIZE }));
    const raw = new Float32Array((GRID + 1) * (GRID + 1));
    for (let iz = 0; iz <= GRID; iz++) {
      for (let ix = 0; ix <= GRID; ix++) {
        const u = ix / GRID, v = iz / GRID;
        let h = 0, amp = 1, freq = d.baseFreq, norm = 0;
        for (let o = 0; o < 6; o++) {
          let n = vnoise(u * freq, v * freq, freq, d.seed + o * 101);
          const r = 1 - Math.abs(n * 2 - 1);  // ridged variant
          n = n * (1 - d.ridge) + r * r * d.ridge;
          h += n * amp; norm += amp;
          amp *= 0.5; freq *= 2;
        }
        h = Math.pow(h / norm, 1.6) * d.amp;
        if (d.terrace) {
          // Flat-topped steps with steep risers: mesas
          const s = h / d.terrace, f = s - Math.floor(s);
          const k = Math.min(1, Math.max(0, (f - 0.6) / 0.4));
          h = h * 0.4 + (Math.floor(s) + k * k * (3 - 2 * k)) * d.terrace * 0.6;
        }
        if (d.crater) {
          // A ringed bowl in the middle of the map
          const r = Math.hypot(u - 0.5, v - 0.5) / d.crater.r;
          h += d.crater.rim * Math.exp(-((r - 1) ** 2) / 0.045) - d.crater.depth * Math.max(0, 1 - r * r);
          h = Math.max(h, 2);
        }
        raw[iz * (GRID + 1) + ix] = h;
      }
    }
    // Each base sits a little above the natural ground at its spot
    for (const b of bases) {
      b.h = raw[Math.round(b.wz / CELL) * (GRID + 1) + Math.round(b.wx / CELL)] + 4;
    }
    for (let iz = 0; iz <= GRID; iz++) {
      for (let ix = 0; ix <= GRID; ix++) {
        let h = raw[iz * (GRID + 1) + ix];
        // Flatten plateaus around each base, wrapping-aware.
        const wx = ix * CELL, wz = iz * CELL;
        for (const b of bases) {
          let dx = Math.abs(wx - b.wx), dz = Math.abs(wz - b.wz);
          dx = Math.min(dx, SIZE - dx); dz = Math.min(dz, SIZE - dz);
          const dist = Math.hypot(dx, dz);
          const t = Math.min(1, Math.max(0, (dist - 46) / 80));
          const s = t * t * (3 - 2 * t);
          h = b.h * (1 - s) + h * s;
        }
        this.heights[iz * (GRID + 1) + ix] = h;
      }
    }
    // Make the edge rows match exactly so the tiling is seamless.
    for (let i = 0; i <= GRID; i++) {
      this.heights[GRID * (GRID + 1) + i] = this.heights[i];
      this.heights[i * (GRID + 1) + GRID] = this.heights[i * (GRID + 1)];
    }

    for (const b of bases) this.buildBase(b);
    this.generateScenery(bases);
    // Each separate lava pocket as a circle, so bots can route around them
    this.hazards = [];
    if (this.fluid && this.fluid.kind === 'lava') {
      const N = GRID, seen = new Uint8Array(N * N);
      const hot = (ix, iz) => this.heights[iz * (GRID + 1) + ix] < this.fluid.level;
      for (let start = 0; start < N * N; start++) {
        if (seen[start] || !hot(start % N, Math.floor(start / N))) continue;
        const cells = [], stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const c = stack.pop(), ix = c % N, iz = Math.floor(c / N);
          cells.push([ix, iz]);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = ix + dx, nz = iz + dz;
            if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
            const k = nz * N + nx;
            if (!seen[k] && hot(nx, nz)) { seen[k] = 1; stack.push(k); }
          }
        }
        if (cells.length < 4) continue;
        const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length, cz = cells.reduce((a, c) => a + c[1], 0) / cells.length;
        const r = Math.max(...cells.map((c) => Math.hypot(c[0] - cx, c[1] - cz))) + 1;
        this.hazards.push({ x: cx * CELL, z: cz * CELL, r: r * CELL });
      }
    }
    // Areas bots path around entirely: the whole crater if there is one, else each pocket
    this.avoidZones = d.crater && this.hazards.length
      ? [{ x: SIZE / 2, z: SIZE / 2, r: d.crater.r * SIZE * 0.92 }]
      : this.hazards;
  }

  // Original base layout: a raised flag plinth between two turret towers joined by
  // a bridge, the keep behind them housing the generator and inventory stations, and a vehicle pad.
  buildBase(b) {
    const { wx, wz, h, team } = b;
    // Lay the base out in local (a = toward map centre, p = perpendicular) coordinates.
    const alongX = Math.abs(SIZE / 2 - wx) >= Math.abs(SIZE / 2 - wz);
    const dir = Math.sign(alongX ? SIZE / 2 - wx : SIZE / 2 - wz) || 1;
    const toWorld = (a, p) => alongX ? [wx + a * dir, wz + p] : [wx + p, wz + a * dir];
    const add = (a, y0, p, sa, sy, sp, kind) => {
      const [cx, cz] = toWorld(a, p);
      const sx = alongX ? sa : sp, sz = alongX ? sp : sa;
      const box = { min: [cx - sx / 2, y0, cz - sz / 2], max: [cx + sx / 2, y0 + sy, cz + sz / 2], kind, team };
      this.boxes.push(box);
      return box;
    };
    const sp = (a, y, p) => { const [x, z] = toWorld(a, p); return [x, y, z]; };
    this.bases.push({ team, wx, wz, h, alongX, dir });
    const obj = (type, pos, box, extra = {}) => {
      const o = { id: this.objects.length, type, team, pos, maxHp: OBJECT_HP[type], box, ...extra };
      if (box) box.obj = o.id;
      this.objects.push(o);
      return o;
    };

    // Flag plinth
    add(0, h - 1, 0, 8, 2.2, 8, 'plinth');
    this.flagStands[team] = [wx, h + 1.2, wz];
    // Towers either side, capped with decks and joined by a bridge
    add(0, h - 2, -22, 6, 26, 6, 'tower');
    add(0, h - 2, 22, 6, 26, 6, 'tower');
    add(0, h + 24, -22, 10, 1, 10, 'deck');
    add(0, h + 24, 22, 10, 1, 10, 'deck');
    add(0, h + 24, 0, 4, 1, 34, 'bridge');
    for (const s of [-1, 1]) {
      const tb = add(0, h + 25, 22 * s, 1.8, 1.4, 1.8, 'turret');
      obj('turret', sp(0, h + 27, 22 * s), tb);
    }

    // The keep: two storeys and a roof, with the generator and stations inside (shared/base.js)
    const rect = (a0, a1, y0, y1, p0, p1, kind) => add((a0 + a1) / 2, y0, (p0 + p1) / 2, a1 - a0, y1 - y0, p1 - p0, kind);
    const keep = buildKeep(rect, sp, h);
    obj('gen', keep.genPos, keep.genBox);
    for (const pos of keep.stations) obj('station', pos, null);
    const c1 = toWorld(KEEP.back, -KEEP.half), c2 = toWorld(KEEP.front, KEEP.half);
    this.navs.push({
      team,
      // Interior volume: bots inside it, or heading into it, follow the waypoint graph
      min: [Math.min(c1[0], c2[0]), h - 2, Math.min(c1[1], c2[1])],
      max: [Math.max(c1[0], c2[0]), h + KEEP.roof - 0.5, Math.max(c1[1], c2[1])],
      ...keep.nav,
    });

    // Low cover walls in front
    add(18, h - 1, -9, 2, 3.5, 10, 'wall');
    add(18, h - 1, 9, 2, 3.5, 10, 'wall');
    // Crate stacks either side of the plinth and in front of the keep
    for (const s of [-1, 1]) {
      add(9, h - 0.2, 13 * s, 2.2, 2, 2.2, 'crate');
      add(9, h + 1.8, 13 * s, 1.6, 1.6, 1.6, 'crate');
      add(10.5, h - 0.2, 15.5 * s, 1.6, 1.6, 1.6, 'crate');
      add(-11, h - 0.2, 14 * s, 2.2, 1.6, 3.4, 'crate');
      add(25, h - 0.6, 3.5 * s, 1.2, 1.8, 4, 'barrier');
    }

    // Vehicle pad off to one side
    const [px, pz] = toWorld(-8, -38);
    obj('vpad', [px, h, pz], null, { yaw: Math.atan2(-(SIZE / 2 - px), -(SIZE / 2 - pz)) });

    this.spawns[team] = [...keep.spawns, sp(0, h + 26, -18)];
  }

  objectsOf(team, type) {
    return this.objects.filter((o) => o.team === team && o.type === type);
  }

  // Deterministic trees, spires, boulders and rocks, kept clear of the bases
  generateScenery(bases) {
    const d = this.def, sc = d.scenery || {};
    let seed = (d.seed * 7919 + 17) >>> 0;
    const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = [0, 1, 0];
    const clear = (x, z, r) => bases.every((b) => {
      let dx = Math.abs(x - b.wx), dz = Math.abs(z - b.wz);
      dx = Math.min(dx, SIZE - dx); dz = Math.min(dz, SIZE - dz);
      return Math.hypot(dx, dz) > r;
    });
    const place = (count, minClear, maxSlope, maxAlt, fn) => {
      for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
        const x = rand() * SIZE, z = rand() * SIZE;
        if (!clear(x, z, minClear)) continue;
        this.normal(x, z, n);
        const h = this.height(x, z);
        if (n[1] < maxSlope || h > maxAlt * d.amp) continue;
        if (this.fluid && h < this.fluid.level + 1) continue; // nothing grows under the lake or lava
        fn(x, h, z);
        i++;
      }
    };
    if (sc.trees) {
      // Groves: a few lone trees, most clustered around grove centres
      const tree = (x, h, z) => {
        const s = 0.8 + rand() * 0.6;
        this.scenery.push({ kind: sc.tree, x, y: h, z, s, rot: rand() * Math.PI * 2 });
        this.addCollider({ type: 'cyl', x, z, r: 0.45 * s, y0: h - 1, y1: h + 6 * s });
      };
      const lone = Math.floor(sc.trees * 0.25);
      place(lone, 95, 0.82, 0.62, tree);
      let planted = lone;
      place(Math.ceil((sc.trees - lone) / 9), 110, 0.8, 0.6, (gx, gh, gz) => {
        for (let k = 0; k < 14 && planted < sc.trees; k++) {
          const a = rand() * Math.PI * 2, r = 4 + Math.sqrt(rand()) * 38;
          const x = ((gx + Math.cos(a) * r) % SIZE + SIZE) % SIZE, z = ((gz + Math.sin(a) * r) % SIZE + SIZE) % SIZE;
          this.normal(x, z, n);
          if (n[1] < 0.8 || !clear(x, z, 95)) continue;
          if (this.fluid && this.height(x, z) < this.fluid.level + 1) continue;
          if (this.collidersIn(x - 3, z - 3, x + 3, z + 3).some((c) => Math.hypot(c.x - x, c.z - z) < 3.5)) continue;
          tree(x, this.height(x, z), z);
          planted++;
        }
      });
    }
    if (sc.spires) {
      place(sc.spires, 130, 0.7, 0.8, (x, h, z) => {
        const s = 0.8 + rand() * 0.7;
        this.scenery.push({ kind: 'spire', x, y: h - 2, z, s, rot: rand() * Math.PI * 2 });
        this.addCollider({ type: 'cyl', x, z, r: 3.6 * s, y0: h - 2, y1: h - 2 + 30 * s });
      });
    }
    if (sc.boulders) {
      place(sc.boulders, 90, 0.6, 1, (x, h, z) => {
        const s = 1.6 + rand() * 2.6;
        this.scenery.push({ kind: 'boulder', x, y: h + s * 0.25, z, s, rot: rand() * Math.PI * 2 });
        this.addCollider({ type: 'sphere', x, y: h + s * 0.25, z, r: s * 0.92 });
      });
    }
    if (sc.rocks) {
      // Small embedded rocks: decoration only
      place(sc.rocks, 60, 0.4, 1, (x, h, z) => {
        const s = 0.25 + rand() * 0.55;
        this.scenery.push({ kind: 'rock', x, y: h - s * 0.2, z, s, rot: rand() * Math.PI * 2 });
      });
    }
  }

  addCollider(c) {
    c.id = this.colliders.length;
    this.colliders.push(c);
    const C = 32, r = c.r;
    for (let gx = Math.floor((c.x - r) / C); gx <= Math.floor((c.x + r) / C); gx++) {
      for (let gz = Math.floor((c.z - r) / C); gz <= Math.floor((c.z + r) / C); gz++) {
        const k = gx * 4096 + gz;
        if (!this.cgrid.has(k)) this.cgrid.set(k, []);
        this.cgrid.get(k).push(c);
      }
    }
  }

  // Colliders whose footprint may overlap the given XZ rectangle (each listed once)
  collidersIn(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const C = 32, stamp = ++this.stamp;
    for (let gx = Math.floor(minX / C); gx <= Math.floor(maxX / C); gx++) {
      for (let gz = Math.floor(minZ / C); gz <= Math.floor(maxZ / C); gz++) {
        const cell = this.cgrid.get(gx * 4096 + gz);
        if (!cell) continue;
        for (const c of cell) if (c.seen !== stamp) { c.seen = stamp; out.push(c); }
      }
    }
    return out;
  }

  rawHeight(ix, iz) {
    ix = ((ix % GRID) + GRID) % GRID;
    iz = ((iz % GRID) + GRID) % GRID;
    return this.heights[iz * (GRID + 1) + ix];
  }

  // Height matching the rendered triangulation exactly.
  height(x, z) {
    const gx = x / CELL, gz = z / CELL;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h00 = this.rawHeight(ix, iz), h10 = this.rawHeight(ix + 1, iz);
    const h01 = this.rawHeight(ix, iz + 1), h11 = this.rawHeight(ix + 1, iz + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  normal(x, z, out = [0, 1, 0]) {
    const gx = x / CELL, gz = z / CELL;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h00 = this.rawHeight(ix, iz), h10 = this.rawHeight(ix + 1, iz);
    const h01 = this.rawHeight(ix, iz + 1), h11 = this.rawHeight(ix + 1, iz + 1);
    let dhx, dhz;
    if (fx + fz <= 1) { dhx = h10 - h00; dhz = h01 - h00; }
    else { dhx = h11 - h01; dhz = h11 - h10; }
    const nx = -dhx / CELL, nz = -dhz / CELL;
    const len = Math.hypot(nx, 1, nz);
    out[0] = nx / len; out[1] = 1 / len; out[2] = nz / len;
    return out;
  }

  // Returns the box the point is inside (with optional inflation), or null.
  pointInBox(x, y, z, pad = 0) {
    for (const b of this.boxes) {
      if (x > b.min[0] - pad && x < b.max[0] + pad && y > b.min[1] - pad && y < b.max[1] + pad &&
          z > b.min[2] - pad && z < b.max[2] + pad) return b;
    }
    return null;
  }

  // March a segment against terrain and boxes. Returns {t, point, normal} or null.
  raycast(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    let best = null;
    // Boxes: slab test
    for (const b of this.boxes) {
      const hit = segBox(ax, ay, az, dx, dy, dz, b);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    // Trunks, spires and boulders
    const pad = 1;
    for (const c of this.collidersIn(Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, this.rayScratch || (this.rayScratch = []))) {
      const hit = c.type === 'sphere' ? segSphere(ax, ay, az, dx, dy, dz, c) : segCyl(ax, ay, az, dx, dy, dz, c);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    // Terrain: step then bisect
    const steps = Math.max(1, Math.ceil(len / 2));
    let prevT = 0, prevAbove = ay - this.height(ax, az);
    if (prevAbove < 0) return { t: 0, point: [ax, ay, az], normal: this.normal(ax, az) };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (best && t > best.t) break;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      const above = y - this.height(x, z);
      if (above < 0) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          const mx = ax + dx * m, my = ay + dy * m, mz = az + dz * m;
          if (my - this.height(mx, mz) < 0) hi = m; else lo = m;
        }
        const px = ax + dx * lo, py = ay + dy * lo, pz = az + dz * lo;
        if (!best || lo < best.t) best = { t: lo, point: [px, py, pz], normal: this.normal(px, pz) };
        break;
      }
      prevT = t; prevAbove = above;
    }
    return best;
  }

  outOfBounds(x, z) {
    return Math.abs(x - this.center[0]) > this.boundsHalf || Math.abs(z - this.center[1]) > this.boundsHalf;
  }
}

function segSphere(ax, ay, az, dx, dy, dz, c) {
  const ox = ax - c.x, oy = ay - c.y, oz = az - c.z;
  const A = dx * dx + dy * dy + dz * dz, B = 2 * (ox * dx + oy * dy + oz * dz), Cc = ox * ox + oy * oy + oz * oz - c.r * c.r;
  const disc = B * B - 4 * A * Cc;
  if (disc < 0 || A === 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0 || t > 1) return null;
  const p = [ax + dx * t, ay + dy * t, az + dz * t];
  return { t, point: p, normal: [(p[0] - c.x) / c.r, (p[1] - c.y) / c.r, (p[2] - c.z) / c.r], collider: c };
}

// Vertical cylinder side or top cap
function segCyl(ax, ay, az, dx, dy, dz, c) {
  let best = null;
  const ox = ax - c.x, oz = az - c.z;
  const A = dx * dx + dz * dz, B = 2 * (ox * dx + oz * dz), Cc = ox * ox + oz * oz - c.r * c.r;
  if (A > 1e-9) {
    const disc = B * B - 4 * A * Cc;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      const y = ay + dy * t;
      if (t >= 0 && t <= 1 && y >= c.y0 && y <= c.y1) {
        const px = ax + dx * t, pz = az + dz * t;
        best = { t, point: [px, y, pz], normal: [(px - c.x) / c.r, 0, (pz - c.z) / c.r], collider: c };
      }
    }
  }
  if (dy < 0 && ay >= c.y1) {
    const t = (c.y1 - ay) / dy;
    const px = ax + dx * t, pz = az + dz * t;
    if (t >= 0 && t <= 1 && (px - c.x) ** 2 + (pz - c.z) ** 2 <= c.r * c.r && (!best || t < best.t)) {
      best = { t, point: [px, c.y1, pz], normal: [0, 1, 0], collider: c };
    }
  }
  return best;
}

function segBox(ax, ay, az, dx, dy, dz, b) {
  let tmin = 0, tmax = 1, axis = -1, sign = 0;
  const o = [ax, ay, az], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
    } else {
      let t1 = (b.min[i] - o[i]) / d[i], t2 = (b.max[i] - o[i]) / d[i];
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (axis < 0) return null; // started inside
  const n = [0, 0, 0]; n[axis] = sign;
  return { t: tmin, point: [ax + dx * tmin, ay + dy * tmin, az + dz * tmin], normal: n, box: b };
}
