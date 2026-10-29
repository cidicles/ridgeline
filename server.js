// Lobby server: serves the client, lists and creates games, and routes each
// WebSocket connection into its room. Game logic lives in server/room.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MAPS } from './shared/world.js';
import { createRoom, TICK } from './server/room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 24;
const EMPTY_ROOM_TTL = 120; // seconds a non-persistent room survives with nobody in it

const rooms = new Map();

function makeRoom(o, persistent = false) {
  const id = persistent ? 'public' : crypto.randomBytes(4).toString('hex');
  const room = createRoom({
    id,
    name: o.name,
    map: o.map,
    bots: o.bots,
    caps: o.caps,
    timeLimit: o.timeLimit,
    skill: o.skill,
    maxPlayers: o.maxPlayers,
    password: o.password || '',
    persistent,
  });
  room.emptySince = Date.now();
  rooms.set(id, room);
  console.log(`room ${id} "${o.name}" created (${MAPS[o.map].name}, ${o.bots} bots/team)`);
  return room;
}

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);

// Validate a create-game request into room options
function roomOptions(b) {
  const name = String(b.name || '').replace(/[^\w '!?.\-]/g, '').trim().slice(0, 28) || 'Ridgeline game';
  const map = Number(b.map) === -1 ? Math.floor(Math.random() * MAPS.length) : clamp(b.map, 0, MAPS.length - 1, 0);
  return {
    name, map,
    bots: clamp(b.bots, 0, 8, 4),
    caps: clamp(b.caps, 1, 10, 5),
    timeLimit: clamp(b.timeLimit, 5, 60, 20),
    skill: { easy: 0.35, normal: 0.6, hard: 0.85 }[b.skill] ?? 0.6,
    maxPlayers: clamp(b.maxPlayers, 2, 32, 16),
    password: String(b.password || '').slice(0, 24),
  };
}

makeRoom({
  name: process.env.ROOM_NAME || 'Public: Ridgeline',
  map: (Number(process.env.MAP) || 0) % MAPS.length,
  bots: Number(process.env.TEAM_SIZE ?? 4),
  caps: Number(process.env.CAPS) || 5,
  timeLimit: Number(process.env.TIME_LIMIT) || 20,
  skill: 0.6,
  maxPlayers: 32,
}, true);

// ---------- HTTP: static files + lobby API ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function api(req, res, url) {
  if (url === '/api/rooms' && req.method === 'GET') {
    return json(res, 200, {
      rooms: [...rooms.values()].map((r) => r.info()).sort((a, b) => b.persistent - a.persistent || b.players - a.players),
      maps: MAPS.map((m) => m.name),
    });
  }
  if (url === '/api/rooms' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let b;
      try { b = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Bad request' }); }
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'Server is full of games. Join one instead.' });
      const room = makeRoom(roomOptions(b));
      json(res, 200, { id: room.id });
    });
    return;
  }
  json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) return api(req, res, url);
  if (url === '/') url = '/index.html';
  const root = url.startsWith('/shared/') ? __dirname : path.join(__dirname, 'public');
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    // Sound files are large and change rarely; everything else revalidates so updates show at once
    const cache = /\.(mp3|glb|webp)$/.test(file) ? 'public, max-age=86400' : 'no-cache'; // generated assets are large and rarely change
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
});

// ---------- WebSocket: route into rooms ----------
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const roomId = new URL(req.url, 'http://x').searchParams.get('room') || 'public';
  let room = null, p = null;
  const fail = (msg) => { ws.send(JSON.stringify({ t: 'error', msg })); ws.close(); };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!p) {
      if (m.t !== 'hello') return;
      room = rooms.get(roomId);
      if (!room) return fail('That game no longer exists.');
      if (room.opts.password && m.password !== room.opts.password) return fail('Wrong password.');
      if (room.humanCount() >= room.opts.maxPlayers) return fail('That game is full.');
      p = room.join(ws, m);
      return;
    }
    if (rooms.get(room.id) === room) room.message(p, m);
  });
  ws.on('close', () => {
    if (p && rooms.get(room.id) === room) room.leave(p);
  });
});

// ---------- loop: tick rooms with people in them, reap abandoned ones ----------
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += (now - last) / 1000; last = now;
  if (acc > 0.25) acc = 0.25;
  while (acc >= TICK) {
    for (const r of rooms.values()) if (r.humanCount() > 0 || process.env.DEBUG_BOTS) r.tick();
    acc -= TICK;
  }
}, 4);

setInterval(() => {
  for (const [id, r] of rooms) {
    if (r.humanCount() > 0) { r.emptySince = Date.now(); continue; }
    if (!r.opts.persistent && Date.now() - r.emptySince > EMPTY_ROOM_TTL * 1000) {
      rooms.delete(id);
      console.log(`room ${id} "${r.opts.name}" closed (empty)`);
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`Ridgeline lobby on http://localhost:${PORT}`);
});
