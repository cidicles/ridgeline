// The keep: each team's walk-in base building, laid out in base-local
// coordinates (a = toward the map centre, p = across, y = height). Shared by
// the server (colliders, objects, bot navigation) and the client (rendering
// and decoration), so both agree on every wall and doorway.
//
//   Ground floor  entrance hall (front door plus a door on each side), two
//                 staircases, inventory stations, and the generator room behind
//                 a single choke door
//   Upper floor   gallery with windows over the flag, and a control room with
//                 a station above the generator
//   Roof          parapeted deck, reached by jetting up the shaft in the middle
//                 of the hall

export const KEEP = {
  back: -44, front: -16, half: 15, // outer faces
  wall: 1, // outer wall thickness
  part: [-35, -34], // partition between the hall and the generator / control rooms
  floor2: 6.6, roof: 13.2, slab: 0.6, // floor heights above the base level h
  stairs: [7.5, 11], // |p| range of each staircase
  stairFoot: -20, steps: 11, rise: 0.6, // first step at stairFoot, climbing toward the back
  shaft: { a: [-28, -24], p: [-2, 2] },
  frontDoor: { p: [-3, 3], h: 5 },
  sideDoor: { a: [-26, -22], h: 4.6 },
  genDoor: { p: [-2.5, 2.5], h: 4.5 },
};

// A rectangle (u0..u1 x v0..v1) minus rectangular holes, as a few solid rectangles.
// Cuts it into strips across u at every hole edge, then merges neighbouring strips
// that ended up with the same v span.
export function carve(u0, u1, v0, v1, holes = []) {
  const cuts = [...new Set([u0, u1, ...holes.flatMap((h) => [h.u0, h.u1]).filter((x) => x > u0 && x < u1)])].sort((x, y) => x - y);
  const out = [], open = new Map(); // "v0,v1" -> rect still growing along u
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i], s1 = cuts[i + 1], mid = (s0 + s1) / 2;
    const covered = holes.filter((h) => h.u0 < mid && h.u1 > mid).map((h) => [Math.max(h.v0, v0), Math.min(h.v1, v1)]).sort((x, y) => x[0] - y[0]);
    const spans = [];
    let v = v0;
    for (const [a, b] of covered) { if (a > v) spans.push([v, a]); v = Math.max(v, b); }
    if (v < v1) spans.push([v, v1]);
    const next = new Map();
    for (const [a, b] of spans) {
      const key = `${a},${b}`, prev = open.get(key);
      if (prev && prev.u1 === s0) { prev.u1 = s1; next.set(key, prev); } else { const r = { u0: s0, u1: s1, v0: a, v1: b }; out.push(r); next.set(key, r); }
    }
    open.clear();
    for (const [k, r] of next) open.set(k, r);
  }
  return out;
}

// Build one keep. rect(a0, a1, y0, y1, p0, p1, kind) adds a collider box; sp(a, y, p)
// converts base-local to world coordinates. Returns the generator box, stations,
// spawn points and the bot navigation graph.
export function buildKeep(rect, sp, h) {
  const K = KEEP, A0 = K.back, A1 = K.front, W = K.half, t = K.wall;
  const F2 = h + K.floor2, R = h + K.roof, top = R;
  const ia0 = A0 + t, ia1 = A1 - t, ip = W - t; // interior extents
  const hole = (u0, u1, v0, v1) => ({ u0, u1, v0, v1 });
  // Walls facing the front/back (spanning p) and the sides (spanning a)
  const wallAcross = (a0, a1, p0, p1, y0, y1, holes, kind) => {
    for (const r of carve(p0, p1, y0, y1, holes)) rect(a0, a1, r.v0, r.v1, r.u0, r.u1, kind);
  };
  const wallAlong = (p0, p1, aa0, aa1, y0, y1, holes, kind) => {
    for (const r of carve(aa0, aa1, y0, y1, holes)) rect(r.u0, r.u1, r.v0, r.v1, p0, p1, kind);
  };
  const slab = (y0, y1, holes, kind) => {
    for (const r of carve(ia0, ia1, -ip, ip, holes)) rect(r.u0, r.u1, y0, y1, r.v0, r.v1, kind);
  };
  const L2win = (lo, hi) => [hole(-hi, -lo, h + 8.4, h + 11), hole(lo, hi, h + 8.4, h + 11)];

  // Outer shell
  const fd = K.frontDoor, sd = K.sideDoor;
  wallAcross(A1 - t, A1, -W, W, h - 1, top, [
    hole(fd.p[0], fd.p[1], h - 1, h + fd.h),
    hole(-12, -8, h + 2, h + 3.6), hole(8, 12, h + 2, h + 3.6), // firing slits
    ...L2win(5, 12),
  ], 'keep');
  wallAcross(A0, A0 + t, -W, W, h - 1, top, [hole(-10, -6, h + 2.5, h + 3.5), hole(6, 10, h + 2.5, h + 3.5), ...L2win(5, 11)], 'keep');
  for (const s of [-1, 1]) {
    const [p0, p1] = s > 0 ? [W - t, W] : [-W, -W + t];
    wallAlong(p0, p1, A0 + t, A1 - t, h - 1, top, [
      hole(sd.a[0], sd.a[1], h - 1, h + sd.h),
      hole(-41, -37, h + 8.4, h + 11), hole(-30, -21, h + 8.6, h + 10.6),
    ], 'keep');
    // Parapet around the roof
    wallAlong(s > 0 ? W - 0.5 : -W, s > 0 ? W : -W + 0.5, A0, A1, top, top + 1.2, [], 'parapet');
  }
  wallAcross(A1 - 0.5, A1, -W + 0.5, W - 0.5, top, top + 1.2, [], 'parapet');
  wallAcross(A0, A0 + 0.5, -W + 0.5, W - 0.5, top, top + 1.2, [], 'parapet');

  // Floors: ground, upper (open over the stairs and the shaft), roof (open over the shaft)
  const sh = K.shaft, [s0, s1] = K.stairs;
  const stairTop = K.stairFoot - K.steps; // where the last step ends
  const shaftHole = { u0: sh.a[0], u1: sh.a[1], v0: sh.p[0], v1: sh.p[1] };
  rect(ia0, ia1, h - 1, h + 0.06, -ip, ip, 'floor'); // a hair above the terrain, which is flat at h here
  slab(F2 - K.slab, F2, [shaftHole, { u0: stairTop, u1: K.stairFoot + 0.5, v0: s0, v1: s1 }, { u0: stairTop, u1: K.stairFoot + 0.5, v0: -s1, v1: -s0 }], 'slab');
  slab(R - K.slab, R, [shaftHole], 'roof');

  // Partition: generator room / control room behind, with one doorway on each floor
  const [pa0, pa1] = K.part, gd = K.genDoor;
  wallAcross(pa0, pa1, -ip, ip, h, F2 - K.slab, [hole(gd.p[0], gd.p[1], h, h + gd.h)], 'partition');
  wallAcross(pa0, pa1, -ip, ip, F2, R - K.slab, [hole(-2.5, 2.5, F2, F2 + 4), hole(-10, -5, F2 + 2, F2 + 4), hole(5, 10, F2 + 2, F2 + 4)], 'partition');

  // Staircases up both sides of the hall, climbing toward the back
  for (const s of [-1, 1]) {
    for (let k = 0; k < K.steps; k++) {
      rect(K.stairFoot - k - 1, K.stairFoot - k, h - 1, h + K.rise * (k + 1), s > 0 ? s0 : -s1, s > 0 ? s1 : -s0, 'stair');
    }
  }

  // Generator in its room; stations in the hall and the control room
  const genA = -39.5;
  const genBox = rect(genA - 1.3, genA + 1.3, h - 1, h + 3.2, -1.7, 1.7, 'gen');
  const stations = [sp(-31, h, -4.5), sp(-31, h, 4.5), sp(genA, F2, 0)];
  const spawns = [sp(-24, h + 0.3, -4.5), sp(-24, h + 0.3, 4.5), sp(-29, h + 0.3, -6), sp(-29, h + 0.3, 6), sp(-22, F2 + 0.3, -5), sp(-22, F2 + 0.3, 5)];

  // Navigation graph for bots: named waypoints and the walkable links between them
  const n = {}, links = [];
  const node = (name, a, p, y) => { n[name] = sp(a, y, p); };
  const sb = (s0 + s1) / 2;
  node('frontOut', -9, 0, h); node('door', -19, 0, h); node('hall', -27, 0, h);
  node('genDoor', -32, 0, h); node('gen', -36.5, 0, h);
  node('ctrlDoor', -33, 0, F2); node('ctrl', -38.5, 0, F2);
  for (const [s, k] of [[-1, 'L'], [1, 'R']]) {
    node(`sideOut${k}`, (sd.a[0] + sd.a[1]) / 2, 21 * s, h);
    node(`sideIn${k}`, (sd.a[0] + sd.a[1]) / 2, 12.5 * s, h);
    node(`corner${k}`, -18.5, 12.5 * s, h);
    node(`back${k}`, -33, 12.5 * s, h);
    node(`stairFoot${k}`, K.stairFoot + 0.6, sb * s, h);
    node(`stairTop${k}`, stairTop - 1.5, sb * s, F2);
    node(`landing${k}`, -33, 5 * s, F2);
    node(`gallery${k}`, -20.5, 5 * s, F2);
    links.push([`sideOut${k}`, `sideIn${k}`], [`sideIn${k}`, `corner${k}`], [`sideIn${k}`, `back${k}`], [`back${k}`, 'genDoor'],
      [`corner${k}`, `stairFoot${k}`], ['door', `stairFoot${k}`], [`stairFoot${k}`, `stairTop${k}`], [`stairTop${k}`, `landing${k}`],
      [`landing${k}`, 'ctrlDoor'], [`landing${k}`, `gallery${k}`], ['frontOut', `sideOut${k}`]);
  }
  links.push(['frontOut', 'door'], ['door', 'hall'], ['hall', 'genDoor'], ['genDoor', 'gen'], ['ctrlDoor', 'ctrl']);
  const names = Object.keys(n);
  const nav = {
    nodes: names.map((name) => ({ name, pos: n[name], out: name.includes('Out') })), // out: just outside a doorway
    links: links.map(([x, y]) => [names.indexOf(x), names.indexOf(y)]),
  };
  return { genBox, genPos: sp(genA, h + 1.2, 0), stations, spawns, nav };
}
