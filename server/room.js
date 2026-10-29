// One self-contained match: map, players, bots, flags, base objects and vehicles.
// The lobby server (server.js) runs as many of these as there are games.
import { World, MAPS, TEAM_NAMES } from '../shared/world.js';
import { PHYS, ARMORS, newPlayerState, stepPlayer, aimDir } from '../shared/physics.js';
import { WEAPONS, stepProjectile, sanitizeLoadout, ammoFor, DEFAULT_LOADOUTS, grenadesFor, kitsFor, KIT_HEAL } from '../shared/weapons.js';
import { SKIFF, newSkiff, stepSkiff } from '../shared/vehicles.js';

const DEBUG = !!process.env.DEBUG_BOTS;
const TRACE = process.env.TRACE_BOT || '';
export const TICK = 1 / 60;
const SNAP_EVERY = 3;       // 20 Hz snapshots
const RESPAWN_TIME = 4;
const FLAG_RETURN_TIME = 30;
const REPAIR_RANGE = 6;
const REPAIR_RATE = { gen: 45, turret: 40 };
const STATION_COOLDOWN = 5;
const SLOTS = ARMORS.map((a) => a.slots);

// opts: { id, name, map, bots (per team), caps, maxPlayers, password, persistent }
export function createRoom(opts) {
  const TEAM_SIZE = opts.bots;
  const CAPS_TO_WIN = opts.caps;
  const TIME_LIMIT = (opts.timeLimit || 20) * 60;
  const SKILL = opts.skill ?? 0.6;     // bot aim and reaction, 0..1
  const SPAWN_PROTECT = 3;
  // Points for everything that helps the team, not just kills
  const PTS = { kill: 10, assist: 5, carrierKill: 15, grab: 10, return: 15, cap: 50, gen: 30, turret: 10, repair: 2, restore: 10 };
  // ---------- game state ----------
  const BOT_NAMES = ['Vex', 'Halyard', 'Moraine', 'Tinder', 'Scree', 'Corvid', 'Brask', 'Lumen', 'Quill', 'Rook', 'Sable', 'Wick', 'Harrow', 'Flint', 'Tamsin', 'Oriel'];
  let nextId = 1;
  let mapIndex = opts.map;
  let world = new World(mapIndex);
  const players = new Map();
  let projectiles = [];
  let nextProj = 1;
  let flags = [];
  let objects = [];          // runtime state parallel to world.objects
  let vehicles = new Map();
  let pickups = [];          // supply crates dropped by the dead
  let nextPickup = 1;
  let nextVeh = 1;
  let score = [0, 0];
  let time = 0;
  let intermissionUntil = 0;
  let matchEnds = TIME_LIMIT;

  function resetMapState() {
    flags = [0, 1].map((team) => ({ team, state: 'home', pos: [...world.flagStands[team]], vel: [0, 0, 0], carrier: 0, droppedAt: 0 }));
    objects = world.objects.map((o) => ({ hp: o.maxHp, disabled: false, yaw: 0, pitch: 0, lastFire: 0, target: 0, nextScan: 0 }));
    vehicles = new Map();
    pickups = [];
    for (const o of world.objects) if (o.type === 'vpad') spawnVehicle(o);
  }

  function spawnVehicle(pad) {
    const v = newSkiff(nextVeh++, pad.team, [pad.pos[0], pad.pos[1] + SKIFF.hoverHeight, pad.pos[2]], pad.yaw);
    v.pad = pad.id;
    vehicles.set(v.id, v);
    return v;
  }
  resetMapState();

  function broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of players.values()) if (p.ws && p !== except && p.ws.readyState === 1) p.ws.send(s);
  }
  function send(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
  function announce(text, team = -1) {
    if (DEBUG) console.log(`[${opts.name} ${time.toFixed(0)}s] ${text}`);
    broadcast({ t: 'msg', text, team });
  }
  const powered = (team) => {
    const g = world.objects.find((o) => o.team === team && o.type === 'gen');
    return !g || !objects[g.id].disabled;
  };
  const ammoOut = (ammo) => ammo.map((a) => (a === Infinity ? -1 : a));

  function makePlayer({ name, team, bot, ws }) {
    const p = {
      id: nextId++, name, team, bot, ws,
      st: newPlayerState([0, 0, 0]),
      hp: 100, maxHp: 100, alive: false, respawnAt: time + 0.5, life: 0,
      loadout: DEFAULT_LOADOUTS[1], pending: DEFAULT_LOADOUTS[1],
      weapon: 0, ammo: ammoFor(DEFAULT_LOADOUTS[1].weapons), lastFire: WEAPONS.map(() => -10),
      kills: 0, deaths: 0, caps: 0, score: 0, assists: 0, returns: 0, streak: 0, multi: 0, lastKillAt: -10,
      ping: 0, damagers: new Map(), protectedUntil: 0, repairAcc: 0,
      brain: null, vehicle: 0, repairing: false, stationAt: -10,
      lastDamager: 0, lastDamageAt: -10,
      kits: 0, nades: 0,
    };
    if (bot) { p.brain = newBrain(p); p.pending = botLoadout(p.brain.role); }
    players.set(p.id, p);
    return p;
  }

  function equip(p, lo) {
    p.loadout = lo;
    p.st.armor = lo.armor;
    p.maxHp = ARMORS[lo.armor].hp;
    p.hp = p.maxHp;
    p.st.energy = ARMORS[lo.armor].maxEnergy;
    p.ammo = ammoFor(lo.weapons, lo.pack);
    p.kits = kitsFor(lo.pack);
    p.nades = grenadesFor(lo.pack);
    p.st.regenMul = lo.pack === 0 ? 1.7 : 1;
    if (!lo.weapons.includes(p.weapon)) p.weapon = lo.weapons[0];
  }

  // Everything the client needs to know about its own kit
  function invOf(p) {
    return { armor: p.loadout.armor, weapons: p.loadout.weapons, pack: p.loadout.pack, ammo: ammoOut(p.ammo), hp: p.hp, kits: p.kits, nades: p.nades };
  }

  function spawn(p) {
    const list = world.spawns[p.team];
    const s = list[Math.floor(Math.random() * list.length)];
    p.st = newPlayerState([s[0] + (Math.random() - 0.5) * 2, s[1] + 0.5, s[2] + (Math.random() - 0.5) * 2], p.pending.armor);
    const stand = world.flagStands[1 - p.team];
    p.st.yaw = Math.atan2(-(stand[0] - s[0]), -(stand[2] - s[2]));
    p.alive = true; p.life++; p.vehicle = 0; p.repairing = false;
    p.protectedUntil = time + SPAWN_PROTECT;
    p.damagers.clear();
    equip(p, p.pending);
    if (p.bot) p.brain = newBrain(p, p.brain && p.brain.role);
    send(p, { t: 'spawn', p: p.st.pos, yaw: p.st.yaw, life: p.life, ...invOf(p) });
  }

  function rebalance() {
    for (const team of [0, 1]) {
      const humans = [...players.values()].filter((p) => !p.bot && p.team === team).length;
      const bots = [...players.values()].filter((p) => p.bot && p.team === team);
      const want = Math.max(0, TEAM_SIZE - humans);
      for (let i = bots.length; i < want; i++) {
        const used = new Set([...players.values()].map((p) => p.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot${nextId}`;
        makePlayer({ name, team, bot: true });
      }
      for (let i = want; i < bots.length; i++) removePlayer(bots[i]);
    }
    sendRoster();
  }

  function removePlayer(p) {
    exitVehicle(p);
    dropFlag(p);
    players.delete(p.id);
    broadcast({ t: 'leave', id: p.id });
  }

  function sendRoster() {
    broadcast({
      t: 'roster',
      players: [...players.values()].map((p) => ({
        id: p.id, name: p.name, team: p.team, bot: p.bot, kills: p.kills, deaths: p.deaths, caps: p.caps,
        score: p.score, assists: p.assists, returns: p.returns, ping: p.ping, armor: p.st.armor,
      })),
      timeLeft: Math.max(0, Math.round(matchEnds - time)), capLimit: CAPS_TO_WIN,
      score,
    });
  }

  // ---------- vehicles ----------
  function boardVehicle(p) {
    if (!p.alive || p.vehicle) return;
    let best = null, bestD = 6;
    for (const v of vehicles.values()) {
      if (!v.alive || v.driver) continue;
      const d = Math.hypot(v.pos[0] - p.st.pos[0], v.pos[1] - p.st.pos[1], v.pos[2] - p.st.pos[2]);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return;
    best.driver = p.id; p.vehicle = best.id; p.repairing = false;
    send(p, { t: 'board', id: best.id, p: best.pos, v: best.vel, yaw: best.yaw, e: best.energy, hp: best.hp });
  }

  function exitVehicle(p, eject = false) {
    const v = vehicles.get(p.vehicle);
    p.vehicle = 0;
    if (!v) return;
    v.driver = 0;
    if (!p.alive) return;
    const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    p.st.pos = [v.pos[0] + rx * 2.5, v.pos[1] + 1.5, v.pos[2] + rz * 2.5];
    if (world.pointInBox(p.st.pos[0], p.st.pos[1] + 1, p.st.pos[2])) p.st.pos = [v.pos[0], v.pos[1] + 2.5, v.pos[2]];
    p.st.vel = [v.vel[0], v.vel[1] + (eject ? 10 : 3), v.vel[2]];
    p.st.onGround = false;
    send(p, { t: 'exit', p: p.st.pos.map(r2), v: p.st.vel.map(r2) });
  }

  function damageVehicle(v, amt, attacker) {
    if (!v.alive || intermissionUntil) return;
    v.hp -= amt;
    if (attacker && !attacker.isObj) send(attacker, { t: 'hitconf' });
    if (v.hp > 0) return;
    v.alive = false; v.hp = 0;
    v.respawnAt = time + SKIFF.respawn;
    broadcast({ t: 'boom', id: 0, w: 4, p: v.pos.map(r2), n: [0, 1, 0] });
    const d = players.get(v.driver);
    if (d) { exitVehicle(d, true); damage(d, 40, attacker, 4); }
    v.driver = 0;
  }

  function updateVehicles(dt) {
    for (const v of [...vehicles.values()]) {
      if (!v.alive) {
        if (time >= v.respawnAt) { vehicles.delete(v.id); spawnVehicle(world.objects[v.pad]); }
        continue;
      }
      const d = players.get(v.driver);
      if (!d || !d.alive || d.vehicle !== v.id) {
        if (d && d.vehicle === v.id) d.vehicle = 0;
        v.driver = 0;
        const impact = stepSkiff(v, { fwd: 0, side: 0, jet: false, yaw: v.yaw }, dt, world);
        if (impact) damageVehicle(v, (impact - 22) * 3, null);
        continue;
      }
      // Driver's client simulates the skiff; keep the rider glued to it
      d.st.pos = [v.pos[0], v.pos[1] + 0.4, v.pos[2]];
      d.st.vel = [...v.vel];
      // Ramming enemies
      const sp = Math.hypot(...v.vel);
      if (sp > SKIFF.ramSpeed) {
        for (const e of players.values()) {
          if (!e.alive || e.team === d.team || e.vehicle) continue;
          const dd = Math.hypot(e.st.pos[0] - v.pos[0], e.st.pos[1] + 1 - v.pos[1], e.st.pos[2] - v.pos[2]);
          if (dd < 3 && time - (e.rammedAt || 0) > 0.5) {
            e.rammedAt = time;
            damage(e, (sp - 20) * 2, d, -2);
            knock(e, [v.vel[0] / sp, 0.5, v.vel[2] / sp], sp * 0.6 / ARMORS[e.st.armor].mass);
            damageVehicle(v, 15, null);
          }
        }
      }
    }
  }

  // ---------- combat ----------
  function teamcast(team, msg) {
    const sjson = JSON.stringify(msg);
    for (const q of players.values()) if (q.ws && q.team === team && q.ws.readyState === 1) q.ws.send(sjson);
  }

  // Quick-chat callouts; some of them are orders the team's bots follow
  function quickChat(p, i) {
    if (!(i >= 0 && i < 8) || time - (p.lastQc || -10) < 1) return;
    p.lastQc = time;
    teamcast(p.team, { t: 'qc', from: p.id, i });
    const bots = [...players.values()].filter((q) => q.bot && q.team === p.team && q.alive);
    let ordered = [];
    if (i === 0 || i === 1) {
      ordered = bots;
      for (const b of bots) b.brain.order = { kind: i === 0 ? 'attack' : 'defend', until: time + 60 };
    } else if (i === 5) {
      ordered = bots
        .map((b) => [b, Math.hypot(b.st.pos[0] - p.st.pos[0], b.st.pos[2] - p.st.pos[2])])
        .filter(([, d]) => d < 260).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([b]) => b);
      for (const b of ordered) b.brain.order = { kind: 'escort', leader: p.id, until: time + 45 };
    }
    if (ordered.length) {
      const ack = ordered[Math.floor(Math.random() * ordered.length)];
      setTimeout(() => { if (players.has(ack.id)) teamcast(ack.team, { t: 'qc', from: ack.id, i: 8 }); }, 700);
    }
  }

  function award(p, pts, reason) {
    if (!p || p.isObj || !pts) return;
    p.score += pts;
    send(p, { t: 'pts', n: pts, r: reason });
  }

  function fire(p, w, origin, dir) {
    const W = WEAPONS[w];
    if (!p.alive || p.vehicle || !p.loadout.weapons.includes(w)) return;
    if (p.ammo[w] <= 0 || time - p.lastFire[w] < W.refire * 0.9) return;
    if (W.energyCost) {
      if (p.st.energy < W.energyCost * 0.9) return;
      if (p.bot) p.st.energy -= W.energyCost;
    }
    p.lastFire[w] = time;
    p.ammo[w]--;
    p.protectedUntil = 0;
    spawnProjectile(w, p.id, p.team, origin, dir, p.st.vel);
  }

  function spawnProjectile(w, owner, team, origin, dir, inheritVel) {
    const W = WEAPONS[w];
    let d = dir;
    if (W.spread) {
      d = [dir[0] + (Math.random() - 0.5) * W.spread * 2, dir[1] + (Math.random() - 0.5) * W.spread * 2, dir[2] + (Math.random() - 0.5) * W.spread * 2];
      const l = Math.hypot(...d); d = d.map((x) => x / l);
    }
    const v = inheritVel || [0, 0, 0];
    const pr = {
      id: nextProj++, w, owner, team, age: 0,
      pos: [...origin],
      vel: [d[0] * W.speed + v[0] * W.inherit, d[1] * W.speed + v[1] * W.inherit, d[2] * W.speed + v[2] * W.inherit],
    };
    projectiles.push(pr);
    broadcast({ t: 'proj', id: pr.id, w, o: owner, p: pr.pos.map(r2), v: pr.vel.map(r2) });
  }

  // Who gets credit: a player, or a named object like a turret
  function attackerOf(pr) {
    if (pr.owner > 0) return players.get(pr.owner) || null;
    const o = world.objects[-pr.owner - 1];
    return o ? { isObj: true, id: 0, team: o.team, name: `${TEAM_NAMES[o.team]} turret`, pos: o.pos } : null;
  }

  function damageObject(id, amt, attacker) {
    const o = world.objects[id], s = objects[id];
    if (!o.maxHp || s.disabled || amt <= 0 || intermissionUntil) return;
    s.hp = Math.max(0, s.hp - amt);
    if (attacker && !attacker.isObj) send(attacker, { t: 'hitconf' });
    if (s.hp > 0) return;
    s.disabled = true;
    if (attacker && !attacker.isObj) award(attacker, o.type === 'gen' ? PTS.gen : PTS.turret, o.type === 'gen' ? 'Generator destroyed' : 'Turret destroyed');
    broadcast({ t: 'boom', id: 0, w: 4, p: o.pos.map(r2), n: [0, 1, 0] });
    if (o.type === 'gen') {
      announce(`${attacker && !attacker.isObj ? attacker.name + ' destroyed the' : 'The'} ${TEAM_NAMES[o.team]} generator! Turrets and stations offline`);
      broadcast({ t: 'sfx', s: 'gen' });
    } else {
      announce(`The ${TEAM_NAMES[o.team]} ${o.type} was destroyed`);
    }
  }

  // Distance from a point to an object's box (or its centre for boxless objects)
  function distToObject(o, p) {
    if (!o.box) return Math.hypot(p[0] - o.pos[0], p[1] - o.pos[1], p[2] - o.pos[2]);
    const b = o.box;
    const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
    const dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]);
    const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
    return Math.hypot(dx, dy, dz);
  }

  function explode(pr, hit) {
    const W = WEAPONS[pr.w];
    const attacker = attackerOf(pr);
    broadcast({ t: 'boom', id: pr.id, w: pr.w, p: hit.point.map(r2), n: hit.normal.map(r2) });
    const dirn = (() => { const l = Math.hypot(...pr.vel) || 1; return pr.vel.map((x) => x / l); })();

    // Direct hits
    const tg = hit.target;
    if (tg && tg.kind === 'player') {
      const p = tg.ref;
      if (p.team !== pr.team || p.id === pr.owner) damage(p, W.damage, attacker, pr.w, hit.point, dirn);
      if (!W.splash) knock(p, dirn, W.knock / 100 / ARMORS[p.st.armor].mass);
    } else if (tg && tg.kind === 'veh') {
      if (tg.ref.team !== pr.team || !tg.ref.driver) damageVehicle(tg.ref, W.damage * 1.2, attacker);
    }
    if (hit.box && hit.box.obj != null && !W.splash) {
      const o = world.objects[hit.box.obj];
      if (o.team !== pr.team) damageObject(o.id, W.damage * W.objScale, attacker);
    }
    if (!W.splash) return;

    for (const p of players.values()) {
      if (!p.alive || (tg && tg.ref === p) || p.vehicle) continue;
      const c = [p.st.pos[0], p.st.pos[1] + 1.1, p.st.pos[2]];
      const dx = c[0] - hit.point[0], dy = c[1] - hit.point[1], dz = c[2] - hit.point[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > W.splash) continue;
      const f = 1 - d / W.splash;
      const self = p.id === pr.owner;
      const dl = d || 1;
      if (p.team !== pr.team || self) damage(p, W.damage * f * (self ? W.selfScale : 1), attacker, pr.w, null, [dx / dl, dy / dl, dz / dl]);
      knock(p, [dx / dl, dy / dl + 0.25, dz / dl], (W.knock / 100) * f / ARMORS[p.st.armor].mass);
    }
    for (const v of vehicles.values()) {
      if (!v.alive || (tg && tg.ref === v)) continue;
      const d = Math.hypot(v.pos[0] - hit.point[0], v.pos[1] - hit.point[1], v.pos[2] - hit.point[2]);
      if (d > W.splash + 1) continue;
      const f = 1 - Math.min(1, d / (W.splash + 1));
      const drv = players.get(v.driver);
      if (v.team !== pr.team || !v.driver) damageVehicle(v, W.damage * f, attacker);
      if (drv && drv.team !== pr.team) damage(drv, W.damage * f * 0.3, attacker, pr.w);
      if (drv) send(drv, { t: 'imp', v: [(v.pos[0] - hit.point[0]) / (d || 1) * f * 8, f * 6, (v.pos[2] - hit.point[2]) / (d || 1) * f * 8].map(r2) });
    }
    for (const o of world.objects) {
      if (!o.maxHp || o.team === pr.team) continue;
      const d = distToObject(o, hit.point);
      if (d < W.splash) damageObject(o.id, W.damage * (1 - d / W.splash) * W.objScale, attacker);
    }
  }

  function knock(p, dir, mag) {
    if (!p.alive || p.vehicle) return;
    const imp = [dir[0] * mag, dir[1] * mag, dir[2] * mag];
    if (p.bot) { p.st.vel[0] += imp[0]; p.st.vel[1] += imp[1]; p.st.vel[2] += imp[2]; p.st.onGround = false; }
    else send(p, { t: 'imp', v: imp.map(r2) });
  }

  // at: impact point (defaults to the chest), dir: direction the hit travelled
  function damage(p, amt, attacker, w, at, dir) {
    if (!p.alive || amt <= 0 || intermissionUntil) return;
    if (time < p.protectedUntil && attacker !== p) return;
    if (p.loadout.pack === 2 && p.st.energy > 1) {
      const absorbed = Math.min(amt * 0.5, p.st.energy / 2);
      amt -= absorbed;
      p.st.energy -= absorbed * 2;
      if (!p.bot) send(p, { t: 'drain', e: r2(absorbed * 2) });
    }
    p.hp -= amt;
    if (attacker && !attacker.isObj && attacker !== p) { p.lastDamager = attacker.id; p.lastDamageAt = time; p.damagers.set(attacker.id, time); }
    const src = attacker && attacker !== p ? (attacker.isObj ? attacker.pos : attacker.st.pos) : null;
    send(p, { t: 'dmg', a: r2(amt), hp: r2(p.hp), from: attacker ? attacker.id : 0, src: src ? src.map(r2) : undefined });
    if (attacker && !attacker.isObj && attacker !== p) send(attacker, { t: 'hitconf' });
    // Everyone sees the hit land (blood, sparks)
    const point = at || [p.st.pos[0], p.st.pos[1] + 1.2, p.st.pos[2]];
    broadcast({ t: 'hit', v: p.id, p: point.map(r2), d: (dir || [0, 0, 0]).map(r2), a: Math.round(amt) });
    if (p.hp <= 0) {
      // Explosive deaths, rams, self-destructs and heavy overkill blow the suit apart
      const gib = (w >= 0 && WEAPONS[w].splash > 0) || w === -2 || w === -3 || p.hp < -35;
      kill(p, attacker, w, { gib, dir });
    }
  }

  function kill(p, attacker, w, how = {}) {
    if (p.vehicle) exitVehicle(p);
    p.alive = false; p.hp = 0; p.deaths++; p.repairing = false;
    p.respawnAt = time + RESPAWN_TIME;
    pickups.push({ id: nextPickup++, pos: [p.st.pos[0], p.st.pos[1] + 1, p.st.pos[2]], vel: [p.st.vel[0] * 0.3, 6, p.st.vel[2] * 0.3], until: time + 25 });
    // Credit whoever last hurt you if you killed yourself shortly after
    let killer = attacker;
    if ((!killer || killer === p) && time - p.lastDamageAt < 6) killer = players.get(p.lastDamager) || killer;
    const wasCarrier = flags.some((f) => f.state === 'carried' && f.carrier === p.id);
    let streak = 0, multi = 0;
    if (killer && !killer.isObj && killer !== p) {
      killer.kills++;
      killer.streak++;
      killer.multi = time - killer.lastKillAt < 4 ? killer.multi + 1 : 1;
      killer.lastKillAt = time;
      streak = killer.streak; multi = killer.multi;
      award(killer, PTS.kill, 'Kill');
      if (wasCarrier) award(killer, PTS.carrierKill, 'Flag carrier killed');
    }
    for (const [id, t] of p.damagers) {
      const q = players.get(id);
      if (q && q !== killer && q !== p && time - t < 8 && q.team !== p.team) { q.assists++; award(q, PTS.assist, 'Assist'); }
    }
    p.damagers.clear();
    p.streak = 0;
    dropFlag(p);
    if (DEBUG) console.log(`[${time.toFixed(0)}s] kill ${killer ? killer.name : '-'} -> ${p.name} w=${w} at ${p.st.pos.map((v) => v.toFixed(0))} role=${p.brain ? p.brain.role : 'human'} goal=${p.brain && p.brain.target ? p.brain.target.map((v) => v.toFixed(0)) : '-'}`);
    broadcast({
      t: 'kill', k: killer && !killer.isObj ? killer.id : 0, kn: killer && killer.isObj ? killer.name : undefined, v: p.id, w,
      p: p.st.pos.map(r2), vv: p.st.vel.map(r2), g: how.gib || w === -3 ? 1 : 0, d: (how.dir || [0, 0, 0]).map(r2), ar: p.st.armor,
      kh: killer && !killer.isObj && killer !== p ? Math.max(0, Math.ceil(killer.hp)) : undefined, ks: streak, km: multi, car: wasCarrier ? 1 : 0,
    });
    sendRoster();
  }

  // ---------- flags ----------
  function dropFlag(p) {
    for (const f of flags) {
      if (f.state === 'carried' && f.carrier === p.id) {
        f.state = 'dropped'; f.carrier = 0; f.droppedAt = time;
        f.pos = [p.st.pos[0], p.st.pos[1] + 1.5, p.st.pos[2]];
        f.vel = [p.st.vel[0] * 0.6, Math.max(4, p.st.vel[1] * 0.6), p.st.vel[2] * 0.6];
        broadcast({ t: 'flag', ev: 'drop', team: f.team, by: p.id });
      }
    }
  }

  function returnFlag(f, by, silent = false) {
    f.state = 'home'; f.carrier = 0; f.pos = [...world.flagStands[f.team]]; f.vel = [0, 0, 0];
    if (silent) return;
    if (by) { by.returns++; award(by, PTS.return, 'Flag returned'); }
    broadcast({ t: 'flag', ev: by ? 'return' : 'auto', team: f.team, by: by ? by.id : 0 });
  }

  function updateFlags(dt) {
    for (const f of flags) {
      if (f.state === 'carried') {
        const c = players.get(f.carrier);
        if (!c || !c.alive) { f.state = 'dropped'; f.droppedAt = time; continue; }
        f.pos = [c.st.pos[0], c.st.pos[1] + 2.4, c.st.pos[2]];
      } else if (f.state === 'dropped') {
        f.vel[1] -= PHYS.gravity * dt;
        for (let i = 0; i < 3; i++) f.pos[i] += f.vel[i] * dt;
        const h = world.height(f.pos[0], f.pos[2]);
        if (f.pos[1] < h) { f.pos[1] = h; f.vel = [f.vel[0] * 0.5, 0, f.vel[2] * 0.5]; if (Math.hypot(f.vel[0], f.vel[2]) < 1) f.vel = [0, 0, 0]; }
        const b = world.pointInBox(f.pos[0], f.pos[1], f.pos[2]);
        if (b) { f.pos[1] = b.max[1]; f.vel = [0, 0, 0]; }
        if (time - f.droppedAt > FLAG_RETURN_TIME) returnFlag(f);
      }
    }
    if (intermissionUntil) return;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const c = [p.st.pos[0], p.st.pos[1] + 1.1, p.st.pos[2]];
      for (const f of flags) {
        if (f.state === 'carried') continue;
        const d = Math.hypot(c[0] - f.pos[0], c[1] - (f.pos[1] + 1), c[2] - f.pos[2]);
        if (d > (p.vehicle ? 4 : 3)) continue;
        if (f.team !== p.team) {
          const fromStand = f.state === 'home';
          f.state = 'carried'; f.carrier = p.id;
          if (fromStand) award(p, PTS.grab, 'Flag taken');
          broadcast({ t: 'flag', ev: 'take', team: f.team, by: p.id });
          if (DEBUG) console.log(`[${opts.name} ${time.toFixed(0)}s] ${p.name} took the ${TEAM_NAMES[f.team]} flag`);
        } else if (f.state === 'dropped') {
          returnFlag(f, p);
        } else {
          const enemy = flags[1 - p.team];
          if (enemy.state === 'carried' && enemy.carrier === p.id) {
            score[p.team]++; p.caps++;
            returnFlag(enemy, null, true);
            award(p, PTS.cap, 'Flag captured');
            broadcast({ t: 'flag', ev: 'cap', team: enemy.team, by: p.id, sc: score });
            if (DEBUG) console.log(`[${opts.name} ${time.toFixed(0)}s] ${p.name} captured`);
            sendRoster();
            if (score[p.team] >= CAPS_TO_WIN) endMatch(p.team);
          }
        }
      }
    }
  }

  // ---------- supply crates, kits, grenades ----------
  function updatePickups(dt) {
    pickups = pickups.filter((k) => time < k.until);
    for (const k of pickups) {
      if (k.vel) {
        k.vel[1] -= PHYS.gravity * dt;
        for (let i = 0; i < 3; i++) k.pos[i] += k.vel[i] * dt;
        const h = world.height(k.pos[0], k.pos[2]);
        const b = world.pointInBox(k.pos[0], k.pos[1], k.pos[2]);
        if (k.pos[1] < h) { k.pos[1] = h; k.vel = null; }
        else if (b) { k.pos[1] = b.max[1]; k.vel = null; }
      }
    }
    for (const p of players.values()) {
      if (!p.alive || p.vehicle) continue;
      for (const k of pickups) {
        if (k.taken || Math.hypot(p.st.pos[0] - k.pos[0], p.st.pos[1] + 1 - k.pos[1], p.st.pos[2] - k.pos[2]) > 2.4) continue;
        k.taken = true;
        const full = ammoFor(p.loadout.weapons, p.loadout.pack);
        for (const w of p.loadout.weapons) {
          if (full[w] !== Infinity) p.ammo[w] = Math.min(full[w], p.ammo[w] + Math.ceil(full[w] * 0.4));
        }
        p.hp = Math.min(p.maxHp, p.hp + 25);
        p.nades = Math.min(grenadesFor(p.loadout.pack), p.nades + 1);
        send(p, { t: 'inv', ...invOf(p), pickup: 1 });
      }
    }
    pickups = pickups.filter((k) => !k.taken);
  }

  function useKit(p) {
    if (!p.alive || p.kits <= 0 || p.hp >= p.maxHp) return;
    p.kits--;
    p.hp = Math.min(p.maxHp, p.hp + KIT_HEAL);
    send(p, { t: 'inv', ...invOf(p), kit: 1 });
  }

  function throwGrenade(p, origin, dir) {
    if (!p.alive || p.vehicle || p.nades <= 0 || time - p.lastFire[7] < WEAPONS[7].refire * 0.9) return;
    p.lastFire[7] = time;
    p.nades--;
    p.protectedUntil = 0;
    spawnProjectile(7, p.id, p.team, origin, dir, p.st.vel);
  }

  // ---------- base objects ----------
  function updateObjects(dt) {
    // Repairs: anyone holding repair near a damaged friendly object
    for (const p of players.values()) {
      if (!p.alive || !p.repairing || p.vehicle) continue;
      const eye = [p.st.pos[0], p.st.pos[1] + 1.2, p.st.pos[2]];
      const pack = p.loadout.pack === 1;
      let best = null, bestD = REPAIR_RANGE * (pack ? 2 : 1);
      for (const o of world.objects) {
        if (!o.maxHp || o.team !== p.team || objects[o.id].hp >= o.maxHp) continue;
        const d = distToObject(o, eye);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (!best) {
        if (pack && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 12 * dt);
        continue;
      }
      const s = objects[best.id];
      const before = s.hp;
      s.hp = Math.min(best.maxHp, s.hp + REPAIR_RATE[best.type] * (pack ? 1 : 0.5) * dt);
      p.repairAcc += s.hp - before;
      while (p.repairAcc >= 60) { p.repairAcc -= 60; award(p, PTS.repair, 'Repairs'); }
      if (s.disabled && s.hp >= best.maxHp) award(p, PTS.restore, best.type === 'gen' ? 'Generator restored' : 'Turret restored');
      p.repairTarget = best.id;
      if (s.disabled && s.hp >= best.maxHp) {
        s.disabled = false;
        announce(`${p.name} repaired the ${TEAM_NAMES[best.team]} ${best.type === 'gen' ? 'generator — base power restored' : best.type}`);
      }
    }

    // Inventory stations re-equip and refill anyone standing on them
    for (const p of players.values()) {
      if (!p.alive || p.vehicle || time - p.stationAt < STATION_COOLDOWN) continue;
      for (const o of world.objects) {
        if (o.type !== 'station' || o.team !== p.team) continue;
        if (Math.hypot(p.st.pos[0] - o.pos[0], p.st.pos[2] - o.pos[2]) > 1.8 || Math.abs(p.st.pos[1] - o.pos[1]) > 1.5) continue;
        if (!powered(p.team)) { if (time - (p.noPowerMsg || 0) > 3) { p.noPowerMsg = time; send(p, { t: 'msg', text: 'Station offline: generator is down', team: p.team }); } continue; }
        p.stationAt = time;
        equip(p, p.pending);
        if (p.bot) continue;
        send(p, { t: 'loadout', ...invOf(p), energy: p.st.energy });
      }
    }

    // Turrets track and fire on enemies while their base has power
    const T = WEAPONS[6];
    for (const o of world.objects) {
      if (o.type !== 'turret') continue;
      const s = objects[o.id];
      if (s.disabled || !powered(o.team)) { s.target = 0; s.pitch += (-0.4 - s.pitch) * dt * 2; continue; }
      if (time >= s.nextScan) {
        s.nextScan = time + 0.3;
        let best = 0, bestD = 200;
        for (const e of players.values()) {
          if (!e.alive || e.team === o.team) continue;
          const c = [e.st.pos[0], e.st.pos[1] + 1.2, e.st.pos[2]];
          const d = Math.hypot(c[0] - o.pos[0], c[1] - o.pos[1], c[2] - o.pos[2]);
          if (d < bestD && los(o.pos, c)) { bestD = d; best = e.id; }
        }
        s.target = best;
      }
      const e = players.get(s.target);
      if (!e || !e.alive) continue;
      // Lead the target
      const ev = e.vehicle && vehicles.get(e.vehicle) ? vehicles.get(e.vehicle).vel : e.st.vel;
      let tx = e.st.pos[0], ty = e.st.pos[1] + 1.1, tz = e.st.pos[2];
      for (let k = 0; k < 2; k++) {
        const t = Math.hypot(tx - o.pos[0], ty - o.pos[1], tz - o.pos[2]) / T.speed;
        tx = e.st.pos[0] + ev[0] * t * 0.85; ty = e.st.pos[1] + 1.1 + ev[1] * t * 0.6; tz = e.st.pos[2] + ev[2] * t * 0.85;
      }
      const ax = tx - o.pos[0], ay = ty - o.pos[1], az = tz - o.pos[2];
      const wantYaw = Math.atan2(-ax, -az), wantPitch = Math.atan2(ay, Math.hypot(ax, az));
      let dyaw = Math.atan2(Math.sin(wantYaw - s.yaw), Math.cos(wantYaw - s.yaw));
      const turn = 3 * dt;
      s.yaw += Math.max(-turn, Math.min(turn, dyaw));
      s.pitch += Math.max(-turn, Math.min(turn, wantPitch - s.pitch));
      if (Math.abs(dyaw) < 0.08 && time - s.lastFire > T.refire) {
        s.lastFire = time;
        const d = aimDir(s.yaw, s.pitch);
        spawnProjectile(6, -(o.id + 1), o.team, [o.pos[0] + d[0] * 1.6, o.pos[1] + d[1] * 1.6, o.pos[2] + d[2] * 1.6], d, null);
      }
    }
  }

  let voteOptions = null;
  function tallyVotes() {
    const counts = voteOptions.map(() => 0);
    for (const q of players.values()) if (!q.bot && q.vote != null) counts[q.vote]++;
    return counts;
  }

  function endMatch(winner) {
    if (intermissionUntil) return;
    intermissionUntil = time + 15;
    // Next in rotation first, then two other maps that aren't this one
    const next = (mapIndex + 1) % MAPS.length;
    const others = MAPS.map((_, i) => i).filter((i) => i !== mapIndex && i !== next).sort(() => Math.random() - 0.5);
    voteOptions = [next, ...others.slice(0, 2)];
    for (const q of players.values()) q.vote = null;
    const ps = [...players.values()];
    const best = (key, title) => {
      const top = ps.filter((q) => q[key] > 0).sort((a, b) => b[key] - a[key])[0];
      return top ? { title, id: top.id, name: top.name, team: top.team, value: top[key] } : null;
    };
    broadcast({
      t: 'end', winner, score, in: 15, next: MAPS[(mapIndex + 1) % MAPS.length].name,
      options: voteOptions.map((i) => ({ map: i, name: MAPS[i].name })),
      awards: [best('score', 'MVP'), best('kills', 'Most kills'), best('caps', 'Most captures'), best('returns', 'Best defender')].filter(Boolean),
      players: ps.map((q) => ({ id: q.id, name: q.name, team: q.team, bot: q.bot, score: q.score, kills: q.kills, deaths: q.deaths, assists: q.assists, caps: q.caps, returns: q.returns })),
    });
    if (DEBUG) console.log(`[${opts.name} ${time.toFixed(0)}s] match over, winner ${winner}`);
  }

  function nextMap() {
    // Most votes wins; ties (or no votes) go to the earliest option, the rotation default
    if (voteOptions) {
      const counts = tallyVotes();
      let best = 0;
      counts.forEach((c, i) => { if (c > counts[best]) best = i; });
      mapIndex = voteOptions[best];
      voteOptions = null;
    } else mapIndex = (mapIndex + 1) % MAPS.length;
    world = new World(mapIndex);
    intermissionUntil = 0;
    score = [0, 0];
    projectiles = [];
    resetMapState();
    matchEnds = time + TIME_LIMIT;
    for (const p of players.values()) {
      Object.assign(p, { kills: 0, deaths: 0, caps: 0, score: 0, assists: 0, returns: 0, streak: 0, alive: false, vehicle: 0, respawnAt: time + 1 });
    }
    broadcast({ t: 'map', map: mapIndex });
    sendRoster();
  }

  // ---------- bots ----------
  const ROLES = ['attack', 'attack', 'defend', 'raid', 'attack', 'defend', 'attack', 'raid'];
  let roleCounter = 0;
  function newBrain(p, role) {
    return {
      role: role || ROLES[roleCounter++ % ROLES.length],
      nextThink: 0, jetting: false, aimErr: [0, 0, 0], target: null, objTarget: -1,
      patrol: null, reactAt: 0, enemy: 0, input: { fwd: 1, side: 0, jet: false, ski: false, jump: false, yaw: 0 },
      weapon: 0, repair: -1,
    };
  }

  function botLoadout(role) {
    if (role === 'raid') return { armor: 2, weapons: [4, 0, 2, 1, 3], pack: 3 };
    if (role === 'defend') return Math.random() < 0.5 ? { armor: 2, weapons: [0, 1, 4, 2, 3], pack: 1 } : { armor: 1, weapons: [0, 1, 2, 3], pack: 1 };
    return Math.random() < 0.6 ? { armor: 0, weapons: [0, 1, 3], pack: 0 } : { armor: 1, weapons: [0, 1, 2, 3], pack: 2 };
  }

  function los(a, b) {
    return !world.raycast(a[0], a[1], a[2], b[0], b[1], b[2]);
  }

  // Low launch angle that lands a ballistic shot at horizontal distance d, height y
  function ballisticPitch(v, g, d, y) {
    if (g === 0) return Math.atan2(y, d);
    const v2 = v * v, disc = v2 * v2 - g * (g * d * d + 2 * y * v2);
    if (disc < 0) return Math.PI / 4;
    return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
  }

  // ---------- navigation inside the keeps ----------
  const inKeep = (q, n) => q[0] > n.min[0] && q[0] < n.max[0] && q[2] > n.min[2] && q[2] < n.max[2] && q[1] > n.min[1] && q[1] < n.max[1];
  // Can a bot at a walk straight to b? Same floor, nothing in the way at chest height
  const walkable = (a, b) => Math.abs(a[1] - b[1]) < 2 && !world.raycast(a[0], a[1] + 1.2, a[2], b[0], b[1] + 1.2, b[2]);
  const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  function nearestNode(nav, q, needWalk, outOnly) {
    let best = -1, bestD = Infinity;
    nav.nodes.forEach((nd, i) => {
      if (outOnly && !nd.out) return;
      const d = flat(q, nd.pos) + (outOnly ? 0 : Math.abs(q[1] - nd.pos[1]) * 3);
      if (d < bestD && (!needWalk || walkable(q, nd.pos))) { bestD = d; best = i; }
    });
    return best;
  }
  // A* over the waypoints (a couple of dozen nodes, so a plain scan is plenty)
  function navPath(nav, from, to) {
    if (!nav.adj) {
      nav.adj = nav.nodes.map(() => []);
      for (const [x, y] of nav.links) { nav.adj[x].push(y); nav.adj[y].push(x); }
    }
    const dist = (i, j) => Math.hypot(...[0, 1, 2].map((k) => nav.nodes[i].pos[k] - nav.nodes[j].pos[k]));
    const g = new Map([[from, 0]]), prev = new Map(), open = new Set([from]);
    while (open.size) {
      let cur = -1, curF = Infinity;
      for (const i of open) { const f = g.get(i) + dist(i, to); if (f < curF) { curF = f; cur = i; } }
      if (cur === to) break;
      open.delete(cur);
      for (const nb of nav.adj[cur]) {
        const c = g.get(cur) + dist(cur, nb);
        if (c < (g.get(nb) ?? Infinity)) { g.set(nb, c); prev.set(nb, cur); open.add(nb); }
      }
    }
    const path = [to];
    while (path[0] !== from) { const pr = prev.get(path[0]); if (pr === undefined) return [from]; path.unshift(pr); }
    return path;
  }
  // Next point to steer for: along the path, skipping ahead to the furthest waypoint
  // in plain view on the same floor, and finally the goal itself once it's in reach
  function navStep(pos, goal, nav) {
    // Mid-staircase or far outside nothing may be in plain view: take the nearest node then
    let from = nearestNode(nav, pos, true);
    if (from < 0) from = nearestNode(nav, pos, false);
    // Somewhere outside: leave by the doorway nearest to it
    const to = nearestNode(nav, goal, false, !inKeep(goal, nav));
    if (from < 0 || to < 0) return goal;
    const path = navPath(nav, from, to).map((i) => nav.nodes[i].pos);
    if (walkable(pos, goal) && (inKeep(goal, nav) || !inKeep(pos, nav))) return goal;
    let i = 0;
    // (bots stop steering within 2 m of their target, so a waypoint counts as reached at 2.5 m)
    while (i < path.length - 1 && flat(pos, path[i]) < 2.5 && Math.abs(pos[1] - path[i][1]) < 2) i++;
    while (i < path.length - 1 && walkable(pos, path[i + 1])) i++;
    if (i === path.length - 1 && flat(pos, path[i]) < 2.5 && walkable(pos, goal)) return goal;
    return path[i];
  }

  function botThink(p) {
    const B = p.brain, st = p.st;
    const myFlag = flags[p.team], enemyFlag = flags[1 - p.team];
    // Orders from teammates override the bot's own role for a while
    const order = B.order && time < B.order.until ? B.order : null;
    const role = order && order.kind !== 'escort' ? order.kind : B.role;
    const leader = order && order.kind === 'escort' ? players.get(order.leader) : null;
    const enemyGen = world.objects.find((o) => o.team !== p.team && o.type === 'gen');
    B.objTarget = -1;
    B.repair = -1;
    let goal;
    if (enemyFlag.state === 'carried' && enemyFlag.carrier === p.id) goal = world.flagStands[p.team];
    else if (leader && leader.alive) {
      // Escort: stay a few metres off the leader's shoulder
      const off = (p.id % 3 - 1) * 7;
      goal = [leader.st.pos[0] + off, leader.st.pos[1], leader.st.pos[2] - 6];
    }
    else if (myFlag.state !== 'home' && (role === 'defend' || p.id % 3 === 0)) goal = myFlag.pos;
    else if (role === 'raid' && enemyGen && !objects[enemyGen.id].disabled) {
      // Fight into the enemy keep and shell the generator from its room's doorway
      const gnav = world.navs.find((n) => n.team === enemyGen.team);
      const doorway = gnav && gnav.nodes.find((nd) => nd.name === 'genDoor');
      goal = doorway ? doorway.pos : enemyGen.pos;
      const eyeR = [st.pos[0], st.pos[1] + ARMORS[st.armor].eyeHeight, st.pos[2]];
      // The ray ends inside the generator's own box, so a hit right at it still counts as a clear view
      const gp = enemyGen.pos, hit = world.raycast(eyeR[0], eyeR[1], eyeR[2], gp[0], gp[1], gp[2]);
      const seen = !hit || Math.hypot(hit.point[0] - gp[0], hit.point[1] - gp[1], hit.point[2] - gp[2]) < 2.6;
      if (seen && Math.hypot(gp[0] - st.pos[0], gp[2] - st.pos[2]) < 60) B.objTarget = enemyGen.id;
    } else if (role === 'attack' || role === 'raid') goal = enemyFlag.pos;
    else {
      // Defenders fix damaged gear before patrolling
      const broken = world.objects.find((o) => o.team === p.team && o.maxHp && objects[o.id].hp < o.maxHp);
      if (broken && !B.enemy) { goal = broken.pos; B.repair = broken.id; }
      else {
        if (!B.patrol || Math.random() < 0.05) {
          const s = world.flagStands[p.team];
          const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 35;
          B.patrol = [s[0] + Math.cos(a) * r, 0, s[2] + Math.sin(a) * r];
          B.patrol[1] = world.height(B.patrol[0], B.patrol[2]);
        }
        goal = B.patrol;
      }
    }
    // Over or right beside a lava pocket: get out first, straight away from its centre
    const goalIn = (z) => goal && Math.hypot(goal[0] - z.x, goal[2] - z.z) < z.r;
    const inside = world.hazards.find((hz) => Math.hypot(st.pos[0] - hz.x, st.pos[2] - hz.z) < hz.r + 25 && !goalIn(hz));
    if (inside) {
      const ex = st.pos[0] - inside.x, ez = st.pos[2] - inside.z, el = Math.hypot(ex, ez) || 1;
      goal = [inside.x + ex / el * (inside.r + 60), 0, inside.z + ez / el * (inside.r + 60)];
      goal[1] = world.height(goal[0], goal[2]);
    } else if (world.avoidZones.length && goal) {
      const gx = goal[0] - st.pos[0], gz = goal[2] - st.pos[2], gl = Math.hypot(gx, gz) || 1;
      let block = null, blockAlong = Infinity;
      for (const hz of world.avoidZones) {
        if (goalIn(hz) || Math.hypot(st.pos[0] - hz.x, st.pos[2] - hz.z) < hz.r) continue; // heading in on purpose, or already inside
        const cx = hz.x - st.pos[0], cz = hz.z - st.pos[2];
        const along = (cx * gx + cz * gz) / gl, off = Math.abs(cx * gz - cz * gx) / gl;
        if (along > -hz.r && along < gl + hz.r && off < hz.r + 30 && along < blockAlong) { block = hz; blockAlong = along; }
      }
      if (block) {
        const cx = block.x - st.pos[0], cz = block.z - st.pos[2];
        // Pick a side once per pocket so the waypoint doesn't flip back and forth
        if (B.hzBlock !== block) { B.hzBlock = block; B.hzSide = Math.sign(cx * gz - cz * gx) || 1; }
        const side = B.hzSide;
        const nx = -gz / gl * side, nz = gx / gl * side;
        goal = [block.x - nx * (block.r + 70), 0, block.z - nz * (block.r + 70)];
        goal[1] = world.height(goal[0], goal[2]);
      }
    }
    // Inside a keep, or heading into one: follow its waypoint graph
    const nav = world.navs.find((n) => inKeep(st.pos, n)) || world.navs.find((n) => inKeep(goal, n));
    if (nav) goal = navStep(st.pos, goal, nav);
    B.target = goal;

    // Pick an enemy to shoot
    const eye = [st.pos[0], st.pos[1] + ARMORS[st.armor].eyeHeight, st.pos[2]];
    let bestE = null, bestD = 180;
    for (const e of players.values()) {
      if (!e.alive || e.team === p.team) continue;
      const d = Math.hypot(e.st.pos[0] - st.pos[0], e.st.pos[1] - st.pos[1], e.st.pos[2] - st.pos[2]);
      const carrierBonus = flags[p.team].carrier === e.id ? 80 : 0;
      if (d - carrierBonus < bestD && los(eye, [e.st.pos[0], e.st.pos[1] + 1.5, e.st.pos[2]])) { bestD = d - carrierBonus; bestE = e; }
    }
    // A raider at the enemy generator keeps shooting it unless someone is right on top of them
    if (bestE && B.objTarget >= 0 && role === 'raid' && bestD > 6) {
      const go = world.objects[B.objTarget].pos;
      if (Math.hypot(go[0] - st.pos[0], go[2] - st.pos[2]) < 15) bestE = null;
    }
    if (bestE && bestE.id !== B.enemy) B.reactAt = time + 0.15 + (1 - SKILL) * 0.6 + Math.random() * 0.35;
    B.enemy = bestE ? bestE.id : 0;
    // Fast, distant targets are harder to track
    const skill = SKILL;
    const tSpeed = bestE ? Math.hypot(...bestE.st.vel) : 0;
    const k = (1 - skill) * (1 + tSpeed / 25 + bestD / 120);
    B.aimErr = [(Math.random() - 0.5) * k * 6, (Math.random() - 0.5) * k * 3, (Math.random() - 0.5) * k * 6];
  }

  function pickBotWeapon(p, dist, below) {
    const has = (w) => p.loadout.weapons.includes(w) && p.ammo[w] > 0;
    if (dist > 14 && dist < 110 && has(0)) return 0;
    if (dist > 14 && dist < 60 && below && has(2)) return 2;
    if (dist >= 110 && has(3) && Math.random() < 0.3) return 3;
    if (has(1)) return 1;
    return p.loadout.weapons.find((w) => p.ammo[w] > 0) ?? 0;
  }

  function botUpdate(p, dt) {
    const B = p.brain, st = p.st, A = ARMORS[st.armor];
    if (time >= B.nextThink) { botThink(p); B.nextThink = time + 0.15 + Math.random() * 0.1; }
    const goal = B.target || st.pos;
    let dx = goal[0] - st.pos[0], dz = goal[2] - st.pos[2];
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist; dz /= dist;
    // Lava: swing around the pool instead of trying to jet across it
    const fl = world.fluid;
    if (fl && fl.kind === 'lava' && dist > 20) {
      const hot = (ux, uz) => [15, 35, 60].some((r) => r < dist && world.height(st.pos[0] + ux * r, st.pos[2] + uz * r) < fl.level + 2);
      if (hot(dx, dz)) {
        B.lavaSide = B.lavaSide || (Math.random() < 0.5 ? 1 : -1);
        for (const deg of [30, 60, 90, 105]) {
          const a = deg * Math.PI / 180 * B.lavaSide;
          const ux = dx * Math.cos(a) - dz * Math.sin(a), uz = dx * Math.sin(a) + dz * Math.cos(a);
          if (!hot(ux, uz)) { dx = ux; dz = uz; break; }
        }
      } else B.lavaSide = 0;
    }
    const dy = goal[1] - st.pos[1];
    const speed = Math.hypot(st.vel[0], st.vel[2]);

    // Movement decisions
    const ahead = world.height(st.pos[0] + dx * 22, st.pos[2] + dz * 22);
    const near = world.height(st.pos[0] + dx * 6, st.pos[2] + dz * 6);
    const ground = world.height(st.pos[0], st.pos[2]);
    const downhill = near < ground - 0.6;
    // Blocked by a structure or a lip: hop and burn up and over it
    if (dist > 3 && speed < 2) B.stuck = (B.stuck || 0) + dt; else B.stuck = 0;
    if (B.stuck > 0.5) {
      B.unstickUntil = time + 0.8;
      // Repeatedly blocked: slide sideways around the obstacle for a while
      if (B.stuck > 1.5 && time > (B.detourUntil || 0)) { B.detourUntil = time + 1.6; B.detourDir = Math.random() < 0.5 ? 1 : -1; B.stuck = 0; }
    }
    const unsticking = time < (B.unstickUntil || 0);
    if (time < (B.detourUntil || 0)) { const t = dx; dx = -dz * B.detourDir; dz = t * B.detourDir; }
    const overFluid = world.fluid && (Math.min(ahead, near) < world.fluid.level + 1.5 || st.inFluid > 0);
    const wantJet = unsticking || overFluid || (ahead > st.pos[1] + 2) || (dy > 6 && dist < 180) || (dy > 1 && dist < 12) ||
      (!st.onGround && st.vel[1] < -4 && ahead > st.pos[1] - 12);
    const reserve = p.loadout.weapons.includes(5) ? 45 : 0;
    if (B.jetting) { if (st.energy < 6 || !wantJet) B.jetting = false; }
    else if (wantJet && st.energy > (unsticking || st.inFluid > 0 ? 3 : 35 + reserve * 0.3)) B.jetting = true;
    // Only ski while there's room to bleed speed before the goal
    const nearHazard = world.hazards.some((hz) => Math.hypot(st.pos[0] - hz.x, st.pos[2] - hz.z) < hz.r + 30);
    const ski = st.onGround && !nearHazard && (downhill || speed > 14) && dist > speed * 1.5 + 20;
    // Steer toward a desired velocity rather than a direction, so drift and overshoot get cancelled
    const want = Math.min(90, Math.max(6, dist * 0.9));
    let mx = dx * want - st.vel[0], mz = dz * want - st.vel[2];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;

    // Aim
    const eye = [st.pos[0], st.pos[1] + A.eyeHeight, st.pos[2]];
    let aimYaw = Math.atan2(-dx, -dz), aimPitch = 0, shooting = false;
    const e = B.enemy && players.get(B.enemy);
    if (e && e.alive) {
      const ed = Math.hypot(e.st.pos[0] - st.pos[0], e.st.pos[1] - st.pos[1], e.st.pos[2] - st.pos[2]);
      const w = pickBotWeapon(p, ed, e.st.pos[1] < st.pos[1] - 5);
      B.weapon = w; p.weapon = w;
      const W = WEAPONS[w];
      const yOff = W.splash ? (e.st.onGround ? 0.2 : 0.9) : 1.2;
      let tx = e.st.pos[0], ty = e.st.pos[1] + yOff, tz = e.st.pos[2];
      for (let k = 0; k < 2; k++) {
        const t = Math.hypot(tx - eye[0], ty - eye[1], tz - eye[2]) / W.speed;
        tx = e.st.pos[0] + (e.st.vel[0] - st.vel[0] * W.inherit) * t;
        ty = e.st.pos[1] + yOff + (e.st.vel[1] - st.vel[1] * W.inherit) * t;
        tz = e.st.pos[2] + (e.st.vel[2] - st.vel[2] * W.inherit) * t;
        if (!e.st.onGround && !e.st.jetting) ty -= 0.5 * PHYS.gravity * t * t * 0.6;
      }
      tx += B.aimErr[0]; ty += B.aimErr[1]; tz += B.aimErr[2];
      const ax = tx - eye[0], ay = ty - eye[1], az = tz - eye[2];
      aimYaw = Math.atan2(-ax, -az);
      aimPitch = ballisticPitch(W.speed, W.gravity, Math.hypot(ax, az), ay);
      shooting = time > B.reactAt;
    } else if (B.objTarget >= 0) {
      // Shell a structure: mortar if we have it, else discs
      const o = world.objects[B.objTarget];
      const od = Math.hypot(o.pos[0] - st.pos[0], o.pos[2] - st.pos[2]);
      const has = (k) => p.ammo[k] > 0 && p.loadout.weapons.includes(k);
      const w = od > 40 && has(4) ? 4 : od > 5 && has(2) ? 2 : pickBotWeapon(p, od, false);
      B.weapon = w; p.weapon = w;
      const W = WEAPONS[w];
      const ax = o.pos[0] - eye[0], ay = o.pos[1] - eye[1], az = o.pos[2] - eye[2];
      const hd = Math.hypot(ax, az);
      if (W.gravity || hd < 100) {
        aimYaw = Math.atan2(-ax, -az) + (Math.random() - 0.5) * 0.04;
        aimPitch = ballisticPitch(W.speed, W.gravity, hd, ay) + (Math.random() - 0.5) * 0.03;
        shooting = true;
      }
    }
    if (B.repair >= 0 && Math.hypot(goal[0] - st.pos[0], goal[2] - st.pos[2]) < 5) p.repairing = true;
    else p.repairing = false;

    // Movement relative to aim yaw
    const fx = -Math.sin(aimYaw), fz = -Math.cos(aimYaw);
    const rx = Math.cos(aimYaw), rz = -Math.sin(aimYaw);
    const inp = B.input;
    inp.yaw = aimYaw;
    inp.fwd = dist > 2 ? mx * fx + mz * fz : 0;
    inp.side = dist > 2 ? mx * rx + mz * rz : 0;
    inp.jet = B.jetting;
    inp.ski = ski;
    inp.jump = st.onGround && !ski && (unsticking || Math.random() < 0.01);
    st.pitch = aimPitch;

    const impact = stepPlayer(st, inp, dt, world);
    if (impact) damage(p, (impact - PHYS.impactThreshold) * 2.5, null, -1);
    if (TRACE === p.name && Math.floor(time * 4) !== Math.floor((time - dt) * 4)) {
      console.log(`  trace ${p.name} t=${time.toFixed(2)} pos=${st.pos.map((v) => v.toFixed(0))} v=${st.vel.map((v) => v.toFixed(0))} gnd=${+st.onGround} ski=${+st.skiing} jet=${+st.jetting} en=${st.energy.toFixed(0)} fluid=${(st.inFluid || 0).toFixed(1)} goal=${goal.map((v) => v.toFixed(0))} fwd=${inp.fwd.toFixed(1)}`);
    }
    if (p.alive && p.hp < p.maxHp * 0.35) useKit(p);

    if (shooting && p.alive) {
      const W = WEAPONS[B.weapon];
      if (time - p.lastFire[B.weapon] >= W.refire) {
        const d = aimDir(aimYaw, aimPitch);
        const o = [st.pos[0] + d[0] * 1.2, st.pos[1] + A.eyeHeight - 0.3 + d[1] * 1.2, st.pos[2] + d[2] * 1.2];
        // Don't disc your own feet
        const clear = !world.raycast(o[0], o[1], o[2], o[0] + d[0] * 6, o[1] + d[1] * 6, o[2] + d[2] * 6);
        if (clear || !W.splash) fire(p, B.weapon, o, d);
      }
    }
  }


  // ---------- connections (called by the lobby server) ----------
  function humans() {
    return [...players.values()].filter((q) => !q.bot);
  }

  function join(ws, m) {
    const counts = [0, 1].map((t) => humans().filter((q) => q.team === t).length);
    const team = counts[0] <= counts[1] ? 0 : 1;
    let name = String(m.name || 'Pilot').replace(/[^\w \-]/g, '').slice(0, 16) || 'Pilot';
    // Keep callsigns unique within the room
    const taken = new Set([...players.values()].map((q) => q.name));
    for (let n = 2; taken.has(name); n++) name = `${String(m.name || 'Pilot').slice(0, 13)}#${n}`;
    const p = makePlayer({ name, team, bot: false, ws });
    if (m.loadout) p.pending = sanitizeLoadout(m.loadout, SLOTS);
    send(p, { t: 'welcome', id: p.id, team, map: mapIndex, room: opts.name });
    announce(`${p.name} joined ${TEAM_NAMES[team]}`);
    rebalance();
    return p;
  }

  function message(p, m) {
    switch (m.t) {
      case 'st':
        if (!p.alive || m.l !== p.life || p.vehicle) return;
        if (!Array.isArray(m.p) || !Array.isArray(m.v)) return;
        p.st.pos = m.p; p.st.vel = m.v; p.st.yaw = m.y; p.st.pitch = m.pi;
        p.st.jetting = !!m.j; p.st.skiing = !!m.s; p.st.onGround = !!m.g;
        if (typeof m.e === 'number') p.st.energy = m.e;
        if (typeof m.w === 'number' && p.loadout.weapons.includes(m.w)) p.weapon = m.w;
        p.repairing = !!m.r;
        break;
      case 'vst': {
        const v = vehicles.get(p.vehicle);
        if (!v || !p.alive || m.l !== p.life || !Array.isArray(m.p) || !Array.isArray(m.v)) return;
        v.pos = m.p; v.vel = m.v; v.yaw = m.y; v.pitch = m.pi || 0; v.roll = m.ro || 0;
        v.energy = m.e; v.lifting = !!m.j;
        p.st.yaw = m.cy ?? m.y; p.st.pitch = m.cp ?? 0;
        break;
      }
      case 'vimpact': {
        const v = vehicles.get(p.vehicle);
        if (v) damageVehicle(v, Math.min(200, (Number(m.s) - 22) * 3), null);
        break;
      }
      case 'kit':
        useKit(p);
        break;
      case 'nade':
        if (Array.isArray(m.o) && Array.isArray(m.d)) {
          const l = Math.hypot(...m.d) || 1;
          throwGrenade(p, m.o, m.d.map((x) => x / l));
        }
        break;
      case 'use':
        if (p.vehicle) exitVehicle(p); else boardVehicle(p);
        break;
      case 'fire':
        if (WEAPONS[m.w] && Array.isArray(m.o) && Array.isArray(m.d)) {
          const l = Math.hypot(...m.d) || 1;
          fire(p, m.w, m.o, m.d.map((x) => x / l));
        }
        break;
      case 'loadout':
        p.pending = sanitizeLoadout(m, SLOTS);
        p.stationAt = -10; // let a station apply it right away
        break;
      case 'impact':
        if (p.alive && !p.vehicle) damage(p, Math.min(100, (Number(m.s) - PHYS.impactThreshold) * 2.5), null, -1);
        break;
      case 'qc':
        quickChat(p, Number(m.i));
        break;
      case 'mark':
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite) && time - (p.lastMark || -10) > 1.5) {
          p.lastMark = time;
          teamcast(p.team, { t: 'mark', by: p.id, p: m.p.map(r2) });
        }
        break;
      case 'vote':
        if (intermissionUntil && voteOptions && Number.isInteger(m.i) && m.i >= 0 && m.i < voteOptions.length) {
          p.vote = m.i;
          broadcast({ t: 'votes', counts: tallyVotes() });
        }
        break;
      case 'chat':
        broadcast({ t: 'chat', from: p.id, text: String(m.text).slice(0, 140), team: m.team ? p.team : -1 });
        break;
      case 'ping':
        send(p, { t: 'pong', c: m.c });
        if (typeof m.rtt === 'number') p.ping = Math.max(0, Math.min(999, Math.round(m.rtt)));
        break;
      case 'suicide':
        if (p.alive) kill(p, null, -3);
        break;
      case 'team':
        dropFlag(p);
        p.team = 1 - p.team;
        if (p.alive) kill(p, null, -1);
        p.respawnAt = time + 1;
        send(p, { t: 'welcome', id: p.id, team: p.team, map: mapIndex, room: opts.name });
        rebalance();
        break;
    }
  }

  function leave(p) {
    announce(`${p.name} left`);
    removePlayer(p);
    rebalance();
  }

  function info() {
    const hs = humans();
    return {
      id: opts.id, name: opts.name, map: mapIndex, mapName: MAPS[mapIndex].name,
      players: hs.length, bots: players.size - hs.length, maxPlayers: opts.maxPlayers,
      score, caps: CAPS_TO_WIN, timeLeft: Math.max(0, Math.round(matchEnds - time)), locked: !!opts.password, persistent: !!opts.persistent,
      names: hs.map((q) => q.name),
    };
  }
  // ---------- loop ----------
  function r2(x) { return Math.round(x * 100) / 100; }

  let tickCount = 0;
  function tick() {
    time += TICK;
    tickCount++;
    if (intermissionUntil && time > intermissionUntil) nextMap();
    // Time limit: most captures wins, otherwise it's a draw
    if (!intermissionUntil && time >= matchEnds) endMatch(score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1);

    for (const p of players.values()) {
      if (!p.alive) { if (time >= p.respawnAt && !intermissionUntil) spawn(p); continue; }
      if (p.bot) botUpdate(p, TICK);
      if (p.st.pos[1] < -50) kill(p, null, -1);
      if (world.fluid && world.fluid.kind === 'lava' && p.alive && !p.vehicle && p.st.pos[1] < world.fluid.level + 0.2) {
        if (time - (p.lastBurn || 0) > 0.25) { p.lastBurn = time; damage(p, 12, null, -4); }
      }
    }
    updateVehicles(TICK);
    updateObjects(TICK);

    const targets = [];
    for (const p of players.values()) {
      if (p.alive && !p.vehicle) targets.push({ kind: 'player', id: p.id, pos: p.st.pos, alive: true, r: ARMORS[p.st.armor].hitRadius, ref: p });
    }
    for (const v of vehicles.values()) {
      if (v.alive) targets.push({ kind: 'veh', id: -1000 - v.id, pos: v.pos, alive: true, r: SKIFF.hitRadius, yOff: 0.6, ref: v });
    }
    const keep = [];
    for (const pr of projectiles) {
      // Your own skiff shouldn't eat the shots you fire from it
      const own = players.get(pr.owner);
      pr.ignore = own && own.vehicle ? -1000 - own.vehicle : undefined;
      const hit = stepProjectile(pr, TICK, world, targets);
      if (!hit) { keep.push(pr); continue; }
      if (hit.type === 'expire') { broadcast({ t: 'boom', id: pr.id, w: pr.w, p: hit.point.map(r2), n: [0, 1, 0], x: 1 }); continue; }
      explode(pr, hit);
    }
    projectiles = keep;

    updateFlags(TICK);
    updatePickups(TICK);

    if (tickCount % SNAP_EVERY === 0) {
      const ps = [];
      for (const p of players.values()) {
        const s = p.st;
        ps.push([p.id, p.team, r2(s.pos[0]), r2(s.pos[1]), r2(s.pos[2]), r2(s.vel[0]), r2(s.vel[1]), r2(s.vel[2]),
          r2(s.yaw), r2(s.pitch), (p.alive ? 1 : 0) | (s.jetting ? 2 : 0) | (s.skiing ? 4 : 0) | (p.repairing ? 8 : 0) | (time < p.protectedUntil ? 16 : 0),
          p.weapon, Math.ceil(p.hp), s.armor, p.vehicle, p.maxHp]);
      }
      broadcast({
        t: 'snap', time: r2(time), ps,
        fl: flags.map((f) => [f.state === 'home' ? 0 : f.state === 'carried' ? 1 : 2, r2(f.pos[0]), r2(f.pos[1]), r2(f.pos[2]), f.carrier,
          f.state === 'dropped' ? Math.max(0, Math.ceil(FLAG_RETURN_TIME - (time - f.droppedAt))) : 0]),
        ob: objects.map((s) => [Math.ceil(s.hp), s.disabled ? 1 : 0, r2(s.yaw), r2(s.pitch)]),
        vh: [...vehicles.values()].map((v) => [v.id, v.team, r2(v.pos[0]), r2(v.pos[1]), r2(v.pos[2]), r2(v.vel[0]), r2(v.vel[1]), r2(v.vel[2]),
          r2(v.yaw), r2(v.pitch), r2(v.roll), Math.ceil(v.hp), v.driver, (v.alive ? 1 : 0) | (v.lifting ? 2 : 0)]),
        pw: [powered(0) ? 1 : 0, powered(1) ? 1 : 0],
        pk: pickups.map((k) => [k.id, r2(k.pos[0]), r2(k.pos[1]), r2(k.pos[2])]),
        sc: score,
      });
    }
    if (tickCount % 120 === 0) sendRoster();
    if (DEBUG && tickCount % 1800 === 0) {
      const objs = world.objects.filter((o) => o.maxHp).map((o) => `${o.type[0]}${o.team}:${Math.ceil(objects[o.id].hp)}${objects[o.id].disabled ? 'X' : ''}`).join(' ');
      console.log(`[${time.toFixed(0)}s] score ${score} | ${objs}`);
      for (const p of players.values()) {
        if (!p.bot) continue;
        const s = p.st, g = p.brain.target || s.pos;
        console.log(`  ${p.name.padEnd(8)} t${p.team} ${p.brain.role.padEnd(6)} ${ARMORS[s.armor].name[0]} alive=${+p.alive} pos=${s.pos.map((x) => x.toFixed(0))} goal=${Math.hypot(g[0] - s.pos[0], g[2] - s.pos[2]).toFixed(0)}m spd=${Math.hypot(...s.vel).toFixed(1)} en=${s.energy.toFixed(0)} stuck=${(p.brain.stuck || 0).toFixed(1)}`);
      }
    }
  }

  rebalance();
  return {
    id: opts.id, opts,
    join, message, leave, info,
    humanCount: () => humans().length,
    tick,
    // For offline simulations (scripts/sim-bots.js)
    inspect: () => ({ players, world, objects, time }),
  };
}
