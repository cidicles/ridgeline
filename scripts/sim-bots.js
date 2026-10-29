#!/usr/bin/env node
// Fast-forward a bots-only match and report how they cope with the keeps:
//   node scripts/sim-bots.js [map] [minutes]
import { createRoom } from '../server/room.js';

const map = Number(process.argv[2] || 0), minutes = Number(process.argv[3] || 5);
const room = createRoom({ id: 'sim', name: 'sim', map, bots: 6, caps: 99, timeLimit: 60, skill: 0.6, maxPlayers: 16 });
const { players, world, objects } = room.inspect();
const inside = (q, n) => q[0] > n.min[0] && q[0] < n.max[0] && q[2] > n.min[2] && q[2] < n.max[2] && q[1] > n.min[1] && q[1] < n.max[1];
const stats = { exits: [], stuckInside: 0, insideSamples: 0, genDowns: 0, raidReachedGen: 0 };
const track = new Map(); // bot id -> { spawnedAt, life }
let genState = world.objects.filter((o) => o.type === 'gen').map((o) => objects[o.id].disabled);
const TICK = 1 / 60, total = minutes * 60 * 60;
for (let i = 0; i < total; i++) {
  room.tick();
  if (i % 30) continue;
  const { time } = room.inspect();
  for (const p of players.values()) {
    if (!p.alive) { track.delete(p.id); continue; }
    const nav = world.navs.find((n) => inside(p.st.pos, n));
    let t = track.get(p.id);
    if (!t) { t = { spawnedAt: time, inOwn: !!nav, exited: false }; track.set(p.id, t); }
    if (t.inOwn && !t.exited && !nav) { t.exited = true; stats.exits.push(time - t.spawnedAt); }
    if (nav) {
      stats.insideSamples++;
      if ((p.brain.stuck || 0) > 1) stats.stuckInside++;
      const gen = world.objects.find((o) => o.type === 'gen' && o.team === nav.team);
      if (p.brain.role === 'raid' && p.team !== nav.team && Math.hypot(gen.pos[0] - p.st.pos[0], gen.pos[2] - p.st.pos[2]) < 6) stats.raidReachedGen++;
    }
  }
  const now = world.objects.filter((o) => o.type === 'gen').map((o) => objects[o.id].disabled);
  now.forEach((d, k) => { if (d && !genState[k]) stats.genDowns++; });
  genState = now;
}
const ex = stats.exits.sort((a, b) => a - b);
console.log(`map ${map}, ${minutes} min, ${players.size} bots`);
console.log(`  left the keep after spawning: ${ex.length} times, median ${ex[ex.length >> 1]?.toFixed(1)}s, slowest ${ex.at(-1)?.toFixed(1)}s`);
console.log(`  inside-keep samples ${stats.insideSamples}, stuck ${stats.stuckInside} (${(100 * stats.stuckInside / Math.max(1, stats.insideSamples)).toFixed(1)}%)`);
console.log(`  raider samples at an enemy generator: ${stats.raidReachedGen}, generators knocked out: ${stats.genDowns}`);
const still = [...track.entries()].filter(([, t]) => t.inOwn && !t.exited);
console.log(`  bots currently still inside since spawn: ${still.length}`);
if (process.argv.includes('--detail')) {
  for (const p of players.values()) {
    const nav = world.navs.find((n) => inside(p.st.pos, n));
    const g = p.brain.target || p.st.pos;
    const nm = (q) => { const k = nav || world.navs[p.team]; let best = null, bd = 1e9; for (const nd of k.nodes) { const d = Math.hypot(nd.pos[0] - q[0], nd.pos[1] - q[1], nd.pos[2] - q[2]); if (d < bd) { bd = d; best = nd.name; } } return `${best}(${bd.toFixed(1)})`; };
    console.log(`  at ${nm(p.st.pos)} -> target ${nm(g)} vel=${Math.hypot(...p.st.vel).toFixed(1)} gnd=${+p.st.onGround}`);
    console.log(`  ${p.name.padEnd(8)} t${p.team} ${p.brain.role.padEnd(6)} inKeep=${nav ? nav.team : '-'} y=${p.st.pos[1].toFixed(1)} goal ${Math.hypot(g[0] - p.st.pos[0], g[2] - p.st.pos[2]).toFixed(1)}m dy=${(g[1] - p.st.pos[1]).toFixed(1)} obj=${p.brain.objTarget} w=${p.weapon} repair=${p.brain.repair} enemy=${p.brain.enemy}`);
  }
  console.log('  objects', world.objects.filter((o) => o.maxHp).map((o) => `${o.type}${o.team}:${Math.ceil(objects[o.id].hp)}`).join(' '));
}
process.exit(0);
