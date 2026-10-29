import * as THREE from 'three';
import { World, MAPS, TEAM_NAMES, TEAM_COLORS } from '../shared/world.js';
import { ARMORS, newPlayerState, stepPlayer, aimDir } from '../shared/physics.js';
import { WEAPONS, PACKS, DEFAULT_LOADOUTS, sanitizeLoadout, canCarry, PLAYER_WEAPONS } from '../shared/weapons.js';
import { stepSkiff } from '../shared/vehicles.js';
import { GameScene, castShadows } from './scene.js';
import { createArmor, animateArmor, createSkiff, createCrate } from './models.js';
import { createViewModels } from './viewmodels.js';
import { library } from './assets3d.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Effects } from './fx.js';
import { Gore } from './gore.js';
import { softTexture } from './textures.js';
import { Audio } from './audio.js';
import { Hud, QUICK_CHAT } from './hud.js';

const SLOTS = ARMORS.map((a) => a.slots);

// ---------- settings ----------
const settings = { sens: 2.2, fov: 90, name: 'Pilot', loadout: DEFAULT_LOADOUTS[1], volume: 0.5, invert: false, gore: true, quality: 'high', music: 0.35, showFps: false, tipsSeen: false, hints: {} };
try { Object.assign(settings, JSON.parse(localStorage.getItem('ridgeline.settings') || '{}')); } catch { /* storage blocked */ }
settings.loadout = sanitizeLoadout(settings.loadout, SLOTS);
function saveSettings() { try { localStorage.setItem('ridgeline.settings', JSON.stringify(settings)); } catch { /* ignore */ } }

// ---------- renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 6000);
camera.rotation.order = 'YXZ';

// First-person weapons live in their own scene, lit to match the map
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
const pmrem = new THREE.PMREMGenerator(renderer);
vmScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
vmScene.environmentIntensity = 0.9;
const vmHemi = new THREE.HemisphereLight(0xdde8ff, 0x403830, 1.2);
const vmSun = new THREE.DirectionalLight(0xffffff, 2.4);
vmScene.add(vmHemi, vmSun);
let viewModels = [];
let viewModelTeam = -1;
function buildViewModels(team) {
  if (team === viewModelTeam) return;
  for (const m of viewModels) vmScene.remove(m);
  viewModels = createViewModels(team); // indexed by weapon id
  viewModels.forEach((m) => vmScene.add(m));
  viewModelTeam = team;
}
buildViewModels(0);

// Post-processing: bloom on anything glowing, then a gentle grade and vignette
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, saturation: { value: 1.08 }, contrast: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette, saturation, contrast; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, saturation);
      col = (col - 0.18) * contrast + 0.18;
      // Split tone: shadows lean cool, highlights warm
      col *= mix(vec3(0.96, 0.985, 1.04), vec3(1.035, 1.0, 0.955), smoothstep(0.05, 0.7, l));
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * dot(d, d) * 1.8;
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};
const composer = new EffectComposer(renderer);
const scenePass = new RenderPass(null, camera);
const vmPass = new RenderPass(vmScene, vmCamera);
vmPass.clear = false;
vmPass.clearDepth = true;
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.82);
composer.addPass(scenePass);
composer.addPass(vmPass);
composer.addPass(bloomPass);
composer.addPass(new ShaderPass(GradeShader));
composer.addPass(new OutputPass());

const game = new GameScene();
const fx = new Effects(game.scene);
const gore = new Gore(game.scene, fx);
gore.enabled = settings.gore;
const audio = new Audio();
const hud = new Hud(document.getElementById('hud'));

// Low / Medium / High: render resolution, bloom, grass density, weather particles
const QUALITY = {
  low: { ratio: 0.85, bloom: false, grass: 0, weather: 0.4, shadow: 0 },
  medium: { ratio: 1.25, bloom: false, grass: 0.5, weather: 0.7, shadow: 1024 },
  high: { ratio: 1.75, bloom: true, grass: 1, weather: 1, shadow: 2048 },
};
function applyQuality() {
  const q = QUALITY[settings.quality] || QUALITY.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.ratio));
  if (game.cover) game.cover.geometry.instanceCount = Math.floor(game.cover.userData.count * q.grass);
  fx.weatherScale = q.weather;
  game.setShadowQuality(q.shadow);
  resize();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.updateProjectionMatrix();
  hud.resize(w, h, Math.min(window.devicePixelRatio, 2));
  fx.setViewport(h * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();

// ---------- state ----------
let world = null;
const me = {
  id: 0, team: 0, life: 0, alive: false, hp: 100,
  st: newPlayerState([0, 0, 0]), pitch: 0,
  weapons: [...settings.loadout.weapons], weapon: settings.loadout.weapons[0],
  ammo: WEAPONS.map(() => 0), lastFire: WEAPONS.map(() => -10),
  deathAt: 0, deathPos: [0, 0, 0], killer: 0,
  vehicle: null,      // locally simulated skiff while driving
  repairing: false,
  pack: settings.loadout.pack, kits: 0, nades: 0, lastNade: -10,
};
const pickups = new Map();   // id -> crate mesh
let endInfo = null;          // end-of-match summary while the intermission runs
let matchEndAt = null, capLimit = 5;
let lastRtt = 0;
let protectUntil = 0;
let lastHeartbeat = 0, lastWarnAt = 0, hudWeapon = -1;
const teamCss = (t) => `#${TEAM_COLORS[t].toString(16).padStart(6, '0')}`;
const pendingShots = [];     // locally predicted shots awaiting the server's id
let localShotId = 0;
const others = new Map();    // id -> remote player
const vehicles = new Map();  // id -> skiff render state
let roster = [];
let score = [0, 0];
let flagState = [null, null];
let objState = null;         // per world object [hp, disabled, yaw, pitch]
let power = [1, 1];
let serverOffset = null;     // serverTime - localTime
let thirdPerson = false;
let showScores = false;
let recoil = 0, shake = 0, vmKick = 0;
let myModel = null;
let prompt = '';

function nameOf(id) {
  if (id === me.id) return settings.name;
  const r = roster.find((x) => x.id === id);
  return r ? r.name : '???';
}
function teamOf(id) {
  if (id === me.id) return me.team;
  const r = roster.find((x) => x.id === id);
  return r ? r.team : -1;
}

function setMap(index) {
  world = new World(index);
  game.setWorld(world);
  fx.clear();
  gore.clear();
  fx.setFog(game.fogColor, game.fogDensity);
  applyQuality(); // grass is rebuilt per map at full density
  for (const v of vehicles.values()) dropModel(v.model);
  vehicles.clear();
  for (const c of pickups.values()) game.dynamic.remove(c);
  pickups.clear();
  objState = null;
  document.getElementById('mapname').textContent = MAPS[index].name;
  const d = MAPS[index];
  vmHemi.color.setRGB(...d.sky.top, THREE.SRGBColorSpace);
  vmHemi.groundColor.setRGB(...d.sky.fog, THREE.SRGBColorSpace).multiplyScalar(0.45);
  vmSun.color.setRGB(...d.sky.horizon, THREE.SRGBColorSpace).lerp(new THREE.Color(0xffffff), 0.5);
}

// ---------- soft shadows under players and skiffs ----------
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const UP = new THREE.Vector3(0, 1, 0), tmpNormal = new THREE.Vector3();
function addModel(model, size) {
  castShadows(model);
  game.dynamic.add(model);
  const sh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({
    color: 0x000000, map: softTexture(), transparent: true, opacity: 0.5, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  sh.userData.size = size;
  sh.renderOrder = 1;
  game.dynamic.add(sh);
  model.userData.shadow = sh;
  return model;
}
function dropModel(model) {
  game.dynamic.remove(model);
  if (model.userData.shadow) game.dynamic.remove(model.userData.shadow);
}
// Highest surface under (x, z) at or below y: terrain or a structure roof
function groundBelow(x, y, z) {
  let g = world.height(x, z), onBox = false;
  for (const b of world.boxes) {
    if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && b.max[1] <= y + 0.2 && b.max[1] > g) { g = b.max[1]; onBox = true; }
  }
  return [g, onBox];
}
function placeShadow(model, x, y, z, visible) {
  const sh = model.userData.shadow;
  if (!sh || !world) return;
  const [g, onBox] = groundBelow(x, y + 0.3, z);
  const alt = y - g;
  sh.visible = visible && alt < 60;
  if (!sh.visible) return;
  sh.position.set(x, g + 0.05, z);
  const n = onBox ? [0, 1, 0] : world.normal(x, z);
  sh.quaternion.setFromUnitVectors(UP, tmpNormal.set(n[0], n[1], n[2]));
  const k = sh.userData.size * (1 + alt * 0.035);
  sh.scale.set(k, 1, k);
  // Faint when real sun shadows are on: it then mainly marks the spot below a jetting player
  sh.material.opacity = (game.sun?.castShadow ? 0.25 : 0.55) * Math.max(0, 1 - alt / 60);
}

function setMyModel() {
  if (myModel) dropModel(myModel);
  myModel = addModel(createArmor(me.team, me.st.armor), 1.6);
}

// ---------- networking ----------
let ws = null;
let roomId = null, roomName = '';
let leaving = false, joinError = '';
const basePath = location.pathname.replace(/[^/]*$/, '');
audio.base = basePath; // samples load relative to the page, so subpath hosting works

function connect(id, password) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  roomId = id;
  joinError = '';
  const sock = ws = new WebSocket(`${proto}://${location.host}${basePath}ws?room=${encodeURIComponent(id)}`);
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', name: settings.name, loadout: settings.loadout, password }));
  sock.onmessage = (e) => handle(JSON.parse(e.data));
  sock.onclose = () => {
    if (sock !== ws) return;
    if (leaving) { leaving = false; return; }
    resetGame();
    setStatus(joinError || 'Disconnected from the game.');
    if (document.pointerLockElement) document.exitPointerLock();
    showMenu(true);
  };
}

// Back to a clean slate (lobby backdrop) after leaving or losing a game
function resetGame() {
  started = false;
  me.id = 0; me.alive = false; me.vehicle = null; me.hp = 100;
  endInfo = null; matchEndAt = null; me.deathInfo = null;
  for (const o of others.values()) dropModel(o.model);
  others.clear();
  roster = []; score = [0, 0]; flagState = [null, null]; serverOffset = null;
  pendingShots.length = 0;
  hud.feed = []; hud.center = [];
  setMap(0);
  me.st = newPlayerState(world.spawns[0][4]);
  me.deathPos = [...world.flagStands[0]];
  me.deathAt = performance.now() / 1000;
  history.replaceState(null, '', location.pathname + location.search);
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
setInterval(() => { if (started) send({ t: 'ping', c: performance.now(), rtt: Math.round(lastRtt) }); }, 2000);
const r2 = (x) => Math.round(x * 100) / 100;
const ammoIn = (a) => a.map((x) => (x == null ? -1 : x)); // server sends -1 for unlimited

function applyLoadout(m) {
  me.st.armor = m.armor;
  me.weapons = m.weapons;
  me.ammo = ammoIn(m.ammo);
  me.pack = m.pack; me.kits = m.kits; me.nades = m.nades;
  me.st.regenMul = m.pack === 0 ? 1.7 : 1;
  if (!me.weapons.includes(me.weapon)) me.weapon = me.weapons[0];
  if (m.hp != null) me.hp = m.hp;
  setMyModel();
}

function flagEvent(m) {
  const ours = m.team === me.team;
  const flagName = `${TEAM_NAMES[m.team]} flag`;
  const who = m.by === me.id ? 'You' : nameOf(m.by);
  const byColor = m.by ? teamCss(Math.max(0, teamOf(m.by))) : teamCss(m.team);
  let text, sub, sound, color = byColor;
  switch (m.ev) {
    case 'take':
      if (m.by === me.id) { text = 'YOU HAVE THE FLAG'; sub = 'Get it back to your stand'; sound = 'grab'; }
      else if (ours) { text = 'OUR FLAG HAS BEEN TAKEN'; sub = `${who} has it`; sound = 'lost'; }
      else { text = `${who.toUpperCase()} HAS THE FLAG`; sub = 'Escort the carrier home'; sound = 'grab'; }
      break;
    case 'drop':
      text = ours ? 'OUR FLAG IS DOWN' : `${flagName.toUpperCase()} DROPPED`;
      sub = ours ? 'Touch it to return it' : `${who} dropped it`;
      color = teamCss(m.team); sound = 'drop';
      break;
    case 'return':
      text = `${flagName.toUpperCase()} RETURNED`; sub = `by ${who}`; color = teamCss(m.team); sound = 'ret';
      break;
    case 'auto':
      text = `${flagName.toUpperCase()} RETURNED`; sub = 'Returned to base automatically'; color = teamCss(m.team); sound = 'ret';
      break;
    case 'cap':
      text = `${who.toUpperCase()} CAPTURED THE ${flagName.toUpperCase()}`;
      sub = m.sc ? `${TEAM_NAMES[0]} ${m.sc[0]} – ${m.sc[1]} ${TEAM_NAMES[1]}` : undefined;
      sound = ours ? 'capThem' : 'capUs';
      break;
  }
  if (!text) return;
  hud.pushBanner(text, color, sub);
  hud.pushFeed(`${text.charAt(0)}${text.slice(1).toLowerCase()}${sub ? ' — ' + sub : ''}`, '#ffe6a0');
  audio.flagEvent(sound);
}

function handle(m) {
  const now = performance.now() / 1000;
  switch (m.t) {
    case 'error':
      joinError = m.msg;
      break;
    case 'welcome':
      me.id = m.id; me.team = m.team;
      buildViewModels(m.team);
      if (m.room) { roomName = m.room; document.getElementById('room-name').textContent = roomName; }
      history.replaceState(null, '', `${location.pathname}${location.search}#room=${roomId}`);
      if (!world || world.mapIndex !== m.map) setMap(m.map);
      setMyModel();
      break;
    case 'map':
      setMap(m.map);
      me.alive = false; me.vehicle = null;
      for (const o of others.values()) o.snaps = [];
      endInfo = null;
      hud.pushBanner(MAPS[m.map].name.toUpperCase(), '#9fffb6', 'New match');
      break;
    case 'spawn':
      me.st = newPlayerState(m.p, m.armor); me.st.yaw = m.yaw; me.pitch = 0;
      me.life = m.life; me.alive = true; me.vehicle = null;
      me.lastFire = WEAPONS.map(() => -10);
      me.deathInfo = null;
      audio.event('spawn');
      if (!settings.tipsSeen) { settings.tipsSeen = true; saveSettings(); hud.showTips(); }
      firstSpawnAt = firstSpawnAt || performance.now() / 1000;
      protectUntil = performance.now() / 1000 + 3;
      applyLoadout(m);
      break;
    case 'loadout':
      applyLoadout(m);
      me.st.energy = m.energy;
      hud.pushBanner(`${ARMORS[m.armor].name.toUpperCase()} ARMOR EQUIPPED`, '#9fe8ff');
      audio.event('station');
      break;
    case 'inv':
      me.ammo = ammoIn(m.ammo); me.hp = m.hp; me.kits = m.kits; me.nades = m.nades;
      if (m.pickup) { audio.event('pickup'); hud.pushFeed('Picked up supplies: ammo, armor, grenade', '#c8f0ff'); }
      if (m.kit) { audio.event('kit'); hud.pushFeed('Repair kit used', '#c8f0ff'); }
      break;
    case 'drain':
      me.st.energy = Math.max(0, me.st.energy - m.e);
      break;
    case 'board':
      audio.event('board');
      me.vehicle = { id: m.id, pos: [...m.p], vel: [...m.v], yaw: m.yaw, pitch: 0, roll: 0, energy: m.e, hp: m.hp, lifting: false };
      me.st.yaw = m.yaw;
      break;
    case 'exit':
      me.vehicle = null;
      me.st.pos = m.p; me.st.vel = m.v; me.st.onGround = false;
      break;
    case 'snap': {
      const est = m.time - now;
      serverOffset = serverOffset == null ? est : (est > serverOffset ? serverOffset * 0.9 + est * 0.1 : serverOffset * 0.99 + est * 0.01);
      const seen = new Set();
      for (const a of m.ps) {
        const [id, team, x, y, z, vx, vy, vz, yaw, pitch, bits, weapon, hp, armor, veh, maxHp] = a;
        seen.add(id);
        if (id === me.id) {
          me.hp = hp; me.team = team;
          if (me.vehicle && veh !== me.vehicle.id) me.vehicle = null;
          continue;
        }
        let o = others.get(id);
        if (!o || o.team !== team || o.armor !== armor) {
          if (o) dropModel(o.model);
          o = { id, team, armor, snaps: o ? o.snaps : [], model: addModel(createArmor(team, armor), armor === 2 ? 2 : 1.6), pos: [x, y, z], vel: [0, 0, 0], yaw, pitch, alive: false, hp, maxHp, spotted: false };
          others.set(id, o);
        }
        o.snaps.push({ t: m.time, pos: [x, y, z], vel: [vx, vy, vz], yaw, pitch, alive: !!(bits & 1), jet: !!(bits & 2), ski: !!(bits & 4), rep: !!(bits & 8), prot: !!(bits & 16), weapon, hp, veh, maxHp });
        if (o.snaps.length > 30) o.snaps.shift();
      }
      for (const [id, o] of others) if (!seen.has(id)) { dropModel(o.model); others.delete(id); }

      const vseen = new Set();
      for (const a of m.vh) {
        const [id, team, x, y, z, vx, vy, vz, yaw, pitch, roll, hp, driver, bits] = a;
        vseen.add(id);
        let v = vehicles.get(id);
        if (!v) {
          v = { id, team, snaps: [], model: addModel(createSkiff(team), 4.5), pos: [x, y, z], vel: [0, 0, 0], yaw, alive: true, driver: 0 };
          vehicles.set(id, v);
        }
        v.snaps.push({ t: m.time, pos: [x, y, z], vel: [vx, vy, vz], yaw, pitch, roll, hp, driver, alive: !!(bits & 1), lifting: !!(bits & 2) });
        if (v.snaps.length > 30) v.snaps.shift();
        if (me.vehicle && me.vehicle.id === id) me.vehicle.hp = hp;
      }
      for (const [id, v] of vehicles) if (!vseen.has(id)) { dropModel(v.model); vehicles.delete(id); }

      flagState = m.fl.map((f, i) => ({ team: i, state: f[0], pos: [f[1], f[2], f[3]], carrier: f[4], returnIn: f[5] || 0 }));
      if (objState) {
        // Alarm when our generator goes down
        const gen = world.objects.find((o) => o.team === me.team && o.type === 'gen');
        if (gen && !objState[gen.id][1] && m.ob[gen.id][1]) audio.alarm();
      }
      objState = m.ob;
      power = m.pw;
      const kseen = new Set();
      for (const [id, x, y, z] of m.pk) {
        kseen.add(id);
        let c = pickups.get(id);
        if (!c) { c = createCrate(); game.dynamic.add(c); pickups.set(id, c); }
        c.userData.target = [x, y, z];
      }
      for (const [id, c] of pickups) if (!kseen.has(id)) { game.dynamic.remove(c); pickups.delete(id); }
      score = m.sc;
      break;
    }
    case 'roster':
      roster = m.players; score = m.score;
      if (m.timeLeft != null) matchEndAt = performance.now() / 1000 + m.timeLeft;
      if (m.capLimit) capLimit = m.capLimit;
      break;
    case 'pong':
      lastRtt = performance.now() - m.c;
      break;
    case 'pts':
      hud.pushPoints(m.n, m.r);
      break;
    case 'flag':
      flagEvent(m);
      break;
    case 'qc': {
      const t = Math.max(0, teamOf(m.from));
      const text = QUICK_CHAT[m.i] || '';
      hud.pushFeed(`[team] ${nameOf(m.from)}: ${text}`, '#a8ffb8');
      if (m.i === 3 || m.i === 4) hud.pushBanner(text.toUpperCase(), teamCss(t), nameOf(m.from));
      audio.radio('qc');
      break;
    }
    case 'mark':
      hud.addMark(m.p, nameOf(m.by), m.by === me.id ? '#9fffb6' : '#ffe28a');
      audio.radio('mark');
      break;
    case 'votes':
      if (endInfo) endInfo.votes = m.counts;
      break;
    case 'end':
      endInfo = { ...m, at: performance.now(), votes: (m.options || []).map(() => 0), myVote: null };
      audio.flagEvent(m.winner === me.team ? 'win' : 'lose');
      break;
    case 'proj': {
      // Our own shots were already drawn when fired; adopt the server's id
      if (m.o === me.id) {
        const i = pendingShots.findIndex((p) => p.w === m.w);
        if (i >= 0) {
          const [p] = pendingShots.splice(i, 1);
          if (fx.renameProjectile(p.id, m.id)) break;
        }
      }
      fx.spawnProjectile(m.id, m.w, m.p, m.v, m.o, world);
      if (m.o !== me.id) audio.fire(m.w, m.p);
      break;
    }
    case 'boom': {
      fx.removeProjectile(m.id);
      fx.explode(m.w, m.p, m.n, m.x);
      if (WEAPONS[m.w].splash && !m.x && world) gore.scorch(world, m.p, WEAPONS[m.w].splash);
      const big = WEAPONS[m.w].splash > 0 && !m.x;
      audio.explosion(m.p, big, m.w);
      if (big) {
        const d = Math.hypot(m.p[0] - camera.position.x, m.p[1] - camera.position.y, m.p[2] - camera.position.z);
        shake = Math.max(shake, Math.max(0, 1 - d / (WEAPONS[m.w].splash * 5)) * 0.6);
      }
      break;
    }
    case 'imp': {
      const tgt = me.vehicle || me.st;
      tgt.vel[0] += m.v[0]; tgt.vel[1] += m.v[1]; tgt.vel[2] += m.v[2];
      me.st.onGround = false;
      break;
    }
    case 'dmg':
      me.hp = m.hp;
      hud.damageFlash = Math.min(0.8, hud.damageFlash + m.a / 60);
      audio.hurt();
      if (m.src) {
        // Direction to the attacker relative to where we're looking (0 = ahead)
        const yaw = camera.rotation.y;
        const dx = m.src[0] - me.st.pos[0], dz = m.src[2] - me.st.pos[2];
        const right = dx * Math.cos(yaw) - dz * Math.sin(yaw), fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
        hud.addDamageDir(Math.atan2(right, fwd), m.a);
      }
      break;
    case 'hitconf':
      hud.hitMarker = 0.3;
      audio.hitmarker();
      break;
    case 'hit': {
      // Skip blood in our own face when we're the one hit in first person
      if (m.v === me.id && !thirdPerson && !me.vehicle) break;
      const o = others.get(m.v);
      let p = m.p;
      if (o && o.pos) {
        // Re-anchor the impact onto the interpolated body we're actually drawing
        const sp = o.snaps[o.snaps.length - 1];
        if (sp) p = [m.p[0] - sp.pos[0] + o.pos[0], m.p[1] - sp.pos[1] + o.pos[1], m.p[2] - sp.pos[2] + o.pos[2]];
      }
      gore.hit(p, m.d, m.a, world);
      break;
    }
    case 'kill': {
      {
        const o = others.get(m.v);
        const pos = m.v === me.id ? [...me.st.pos] : o && o.pos ? [...o.pos] : m.p;
        if (pos && world) gore.death(m, pos, m.vv || [0, 0, 0], teamOf(m.v) < 0 ? 0 : teamOf(m.v), m.ar ?? 1, world);
        // Hide the body now rather than when the interpolated snapshot catches up
        if (o) o.goneAt = now;
        if (pos) audio.death(pos, !!m.g);
      }
      const wname = m.w === -2 ? 'Skiff' : m.w >= 0 ? WEAPONS[m.w].name : '';
      const vt = Math.max(0, teamOf(m.v));
      const selfKill = !m.kn && (!m.k || m.k === m.v);
      hud.pushKill({
        killer: m.kn || (selfKill ? '' : nameOf(m.k)),
        kColor: m.kn ? '#c8d2dc' : teamCss(Math.max(0, teamOf(m.k))),
        victim: nameOf(m.v), vColor: teamCss(vt), w: m.kn ? 6 : selfKill && m.w < 0 ? -9 : m.w,
        mine: m.k === me.id || m.v === me.id,
      });
      if (m.v === me.id) {
        me.alive = false; me.deathAt = now; me.deathPos = [...me.st.pos]; me.killer = m.k; me.vehicle = null;
        me.deathInfo = selfKill
          ? { self: true, text: m.w === -1 ? 'You cratered' : m.w === -3 ? 'You self-destructed' : m.w === -4 ? 'You fell into the lava' : 'You blew yourself up', color: '#ffb08a' }
          : { killer: m.kn || nameOf(m.k), color: m.kn ? '#e8eef5' : teamCss(Math.max(0, teamOf(m.k))), sub: `${wname}${m.kh != null ? ` · they had ${m.kh} armor left` : ''}` };
      }
      if (m.k === me.id && m.v !== me.id) {
        audio.killConfirm();
        const multi = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL' }[m.km] || (m.km >= 4 ? 'MULTI KILL' : '');
        const spree = { 5: 'KILLING SPREE', 10: 'RAMPAGE', 15: 'UNSTOPPABLE' }[m.ks];
        if (multi || spree) { hud.pushBanner(spree || multi, '#ffe28a', spree && multi ? multi : undefined); audio.callout(); }
      }
      if (m.ks && [5, 10, 15].includes(m.ks) && m.k !== me.id) hud.pushFeed(`${nameOf(m.k)} is on a ${m.ks >= 15 ? 'unstoppable run' : m.ks >= 10 ? 'rampage' : 'killing spree'}!`, '#ffe28a');
      break;
    }
    case 'msg':
      if (m.team >= 0 && m.team !== me.team) break;
      hud.pushFeed(m.text, '#ffe6a0');
      if (/generator/.test(m.text)) hud.pushBanner(m.text.replace(/!.*$/, '').toUpperCase(), '#ffb08a');
      break;
    case 'chat': {
      if (m.team >= 0 && m.team !== me.team) break;
      const t = teamOf(m.from);
      hud.pushFeed(`${m.team >= 0 ? '[team] ' : ''}${nameOf(m.from)}: ${m.text}`, t === me.team ? '#a8ffb8' : '#ffb8a8');
      break;
    }

    case 'leave': {
      const o = others.get(m.id);
      if (o) { dropModel(o.model); others.delete(m.id); }
      break;
    }
  }
}

// ---------- input ----------
const keys = new Set();
let mouseDown = [false, false, false];
let jumpQueued = false;
let chatting = false;
let panelOpen = false;
let started = false;
const chatInput = document.getElementById('chat');

document.addEventListener('keydown', (e) => {
  if (chatting) {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) send({ t: 'chat', text, team: chatInput.dataset.team === '1' });
      endChat();
    } else if (e.key === 'Escape') endChat();
    return;
  }
  if (panelOpen) { if (e.code === 'KeyB' || e.key === 'Escape') closeLoadout(); return; }
  if (!document.pointerLockElement) return;
  hud.dismissTips();
  if (e.code === 'F1') { showHelp = !showHelp; e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Space' && !e.repeat) { jumpQueued = true; if (me.alive && me.st.onGround && !me.vehicle) audio.event('jump'); }
  if (e.code.startsWith('Digit')) {
    const i = Number(e.code.slice(5)) - 1;
    if (qcOpen) { if (i >= 0 && i < 8) send({ t: 'qc', i }); qcOpen = false; return; }
    if (endInfo && endInfo.options) {
      if (i >= 0 && i < endInfo.options.length) { endInfo.myVote = i; send({ t: 'vote', i }); }
      return;
    }
    if (me.weapons[i] != null) me.weapon = me.weapons[i];
  }
  if (e.code === 'KeyZ' && !e.repeat) qcOpen = !qcOpen;
  if (e.key === 'Escape') qcOpen = false;
  if (e.code === 'KeyX' && !e.repeat) pingLocation();
  if (e.code === 'KeyQ') cycleWeapon(1);
  if (e.code === 'KeyV') thirdPerson = !thirdPerson;
  if (e.code === 'KeyE' && !e.repeat) send({ t: 'use' });
  if (e.code === 'KeyG' && !e.repeat) throwGrenade();
  if (e.code === 'KeyH' && !e.repeat) send({ t: 'kit' });
  if (e.code === 'KeyB') { openLoadout(); e.preventDefault(); }
  if (e.code === 'Tab') { showScores = true; e.preventDefault(); }
  if (e.code === 'KeyK') send({ t: 'suicide' });
  if (e.code === 'KeyM') send({ t: 'team' });
  if (e.code === 'KeyT' || e.code === 'KeyY') { startChat(e.code === 'KeyY'); e.preventDefault(); }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') showScores = false;
});
function cycleWeapon(d) {
  const i = me.weapons.indexOf(me.weapon);
  me.weapon = me.weapons[(i + d + me.weapons.length) % me.weapons.length];
}
function startChat(team) {
  chatting = true;
  keys.clear();
  chatInput.dataset.team = team ? '1' : '0';
  chatInput.placeholder = team ? 'Team chat…' : 'Say…';
  chatInput.style.display = 'block';
  chatInput.value = '';
  setTimeout(() => chatInput.focus(), 0);
}
function endChat() {
  chatting = false;
  chatInput.style.display = 'none';
  chatInput.blur();
  canvas.requestPointerLock();
}

canvas.addEventListener('mousedown', (e) => {
  if (!document.pointerLockElement) { if (started && !panelOpen) canvas.requestPointerLock(); return; }
  if (e.button === 1) { pingLocation(); e.preventDefault(); return; }
  mouseDown[e.button] = true;
});
// Browsers only allow audio after a gesture: start it on the first click or key in the lobby
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => audio.init(), { once: true });

let qcOpen = false, showHelp = false;
// Mark whatever the crosshair is on for the team
function pingLocation() {
  if (!me.alive || !world) return;
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  const a = camera.position;
  const hit = world.raycast(a.x, a.y, a.z, a.x + d.x * 1500, a.y + d.y * 1500, a.z + d.z * 1500);
  const p = hit ? hit.point : [a.x + d.x * 400, a.y + d.y * 400, a.z + d.z * 400];
  send({ t: 'mark', p: p.map(r2) });
}
document.addEventListener('mouseup', (e) => { mouseDown[e.button] = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (!document.pointerLockElement) return;
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
});
document.addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  const s = settings.sens * 0.001;
  me.st.yaw -= e.movementX * s;
  swayTarget[0] = Math.max(-0.06, Math.min(0.06, swayTarget[0] - e.movementX * 0.0004));
  swayTarget[1] = Math.max(-0.05, Math.min(0.05, swayTarget[1] + e.movementY * 0.0004));
  me.pitch = Math.max(-1.55, Math.min(1.55, me.pitch - e.movementY * s * (settings.invert ? -1 : 1)));
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !chatting && !panelOpen) { showMenu(true); keys.clear(); mouseDown = [false, false, false]; }
  else if (document.pointerLockElement) showMenu(false);
});

// ---------- menu ----------
const menu = document.getElementById('menu');
const nameInput = document.getElementById('name');
const sensInput = document.getElementById('sens');
const fovInput = document.getElementById('fov');
nameInput.value = settings.name;
sensInput.value = settings.sens;
fovInput.value = settings.fov;
const volInput = document.getElementById('vol');
const invInput = document.getElementById('invert');
volInput.value = settings.volume;
invInput.checked = settings.invert;
volInput.addEventListener('input', () => { settings.volume = Number(volInput.value); audio.setVolume(settings.volume); saveSettings(); });
invInput.addEventListener('change', () => { settings.invert = invInput.checked; saveSettings(); });
const qualityInput = document.getElementById('quality');
qualityInput.value = settings.quality;
qualityInput.addEventListener('change', () => { settings.quality = qualityInput.value; saveSettings(); applyQuality(); });
const musicInput = document.getElementById('music');
musicInput.value = settings.music;
musicInput.addEventListener('input', () => { settings.music = Number(musicInput.value); audio.setMusicVolume(settings.music); saveSettings(); });
audio.setMusicVolume(settings.music);
const fpsInput = document.getElementById('showfps');
fpsInput.checked = settings.showFps;
fpsInput.addEventListener('change', () => { settings.showFps = fpsInput.checked; saveSettings(); });
const goreInput = document.getElementById('gore');
goreInput.checked = settings.gore;
goreInput.addEventListener('change', () => { settings.gore = gore.enabled = goreInput.checked; saveSettings(); });
audio.setVolume(settings.volume);
const $ = (id) => document.getElementById(id);
function setStatus(t) { $('status').textContent = t || ''; }

// The menu is the lobby before you join and the pause screen once you're in a game
let menuMode = 'browse';
function setMenuMode(mode) {
  menuMode = mode;
  $('browse-view').style.display = mode === 'browse' ? '' : 'none';
  $('create-view').style.display = mode === 'create' ? '' : 'none';
  $('pause-view').style.display = mode === 'pause' ? '' : 'none';
  if (mode === 'browse') refreshRooms();
}
function showMenu(v) {
  menu.style.display = v ? 'flex' : 'none';
  if (v) setMenuMode(started ? 'pause' : (menuMode === 'create' ? 'create' : 'browse'));
}

function applySettings() {
  settings.name = nameInput.value.trim().slice(0, 16) || 'Pilot';
  settings.sens = Number(sensInput.value);
  settings.fov = Number(fovInput.value);
  camera.fov = settings.fov; camera.updateProjectionMatrix();
  fx.setViewport(window.innerHeight * renderer.getPixelRatio(), camera.fov);
  saveSettings();
}

function joinRoom(id, password) {
  applySettings();
  audio.init();
  setStatus('');
  started = true;
  connect(id, password);
  canvas.requestPointerLock();
}

$('deploy').addEventListener('click', () => { applySettings(); canvas.requestPointerLock(); });

// ---------- server browser ----------
let roomList = [], selectedRoom = null, mapNames = [];
const inviteId = (location.hash.match(/room=([\w-]+)/) || [])[1] || null;

async function refreshRooms() {
  const t0 = performance.now();
  try {
    const r = await fetch(`${basePath}api/rooms`, { cache: 'no-store' });
    const data = await r.json();
    $('ping').textContent = `ping ${Math.round(performance.now() - t0)} ms`;
    roomList = data.rooms;
    if (!mapNames.length) {
      mapNames = data.maps;
      $('c-map').innerHTML = '<option value="-1">Random</option>' + mapNames.map((n, i) => `<option value="${i}">${n}</option>`).join('');
    }
    if (!selectedRoom && inviteId && roomList.some((g) => g.id === inviteId)) selectedRoom = inviteId;
    if (selectedRoom && !roomList.some((g) => g.id === selectedRoom)) selectedRoom = null;
    if (!selectedRoom && roomList.length) selectedRoom = roomList[0].id;
    renderRooms();
  } catch {
    $('rooms-empty').textContent = 'Could not reach the server.';
  }
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderRooms() {
  const body = $('rooms').querySelector('tbody');
  body.innerHTML = '';
  for (const g of roomList) {
    const tr = document.createElement('tr');
    tr.className = g.id === selectedRoom ? 'sel' : '';
    const who = g.names.length ? g.names.slice(0, 4).map(esc).join(', ') + (g.names.length > 4 ? '…' : '') : 'nobody yet';
    tr.innerHTML = `<td>${g.locked ? '🔒 ' : ''}${esc(g.name)}<span class="tagline">${who}${g.id === inviteId ? ' · your invite' : ''}</span></td>` +
      `<td>${esc(g.mapName)}</td><td>${g.players}/${g.maxPlayers}${g.bots ? ` <span class="muted">+${g.bots} bots</span>` : ''}</td>` +
      `<td>${g.score[0]}–${g.score[1]} <span class="muted">to ${g.caps} · ${Math.ceil((g.timeLeft || 0) / 60)}m left</span></td>`;
    tr.onclick = () => { selectedRoom = g.id; renderRooms(); };
    tr.ondblclick = () => { selectedRoom = g.id; tryJoin(); };
    body.appendChild(tr);
  }
  $('rooms-empty').style.display = roomList.length ? 'none' : '';
  $('rooms-empty').textContent = 'No games running. Create one!';
  const sel = roomList.find((g) => g.id === selectedRoom);
  $('pass-row').style.display = sel && sel.locked ? '' : 'none';
  $('join').disabled = !sel || sel.players >= sel.maxPlayers;
}

function tryJoin() {
  const sel = roomList.find((g) => g.id === selectedRoom);
  if (!sel) return;
  if (sel.locked && !$('join-pass').value) { setStatus('This game needs a password.'); $('join-pass').focus(); return; }
  joinRoom(sel.id, $('join-pass').value);
}
$('join').addEventListener('click', tryJoin);
for (const b of document.querySelectorAll('#menu button, #loadout button')) b.addEventListener('click', () => audio.event('ui_click'));
$('refresh').addEventListener('click', refreshRooms);
setInterval(() => { if (!started && menu.style.display !== 'none' && menuMode === 'browse') refreshRooms(); }, 5000);

// ---------- create game ----------
for (const k of ['bots', 'caps', 'max', 'time']) {
  const input = $(`c-${k}`), out = $(`c-${k}-v`);
  input.addEventListener('input', () => { out.textContent = input.value; });
}
$('create-open').addEventListener('click', () => {
  if (!$('c-name').value) $('c-name').value = `${nameInput.value.trim() || 'Pilot'}'s game`;
  setStatus('');
  setMenuMode('create');
});
$('create-back').addEventListener('click', () => setMenuMode('browse'));
$('create').addEventListener('click', async () => {
  const body = {
    name: $('c-name').value, map: Number($('c-map').value), bots: Number($('c-bots').value),
    caps: Number($('c-caps').value), maxPlayers: Number($('c-max').value), password: $('c-pass').value,
    timeLimit: Number($('c-time').value), skill: $('c-skill').value,
  };
  try {
    const r = await fetch(`${basePath}api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) return setStatus(data.error || 'Could not create the game.');
    menuMode = 'browse';
    joinRoom(data.id, body.password);
  } catch {
    setStatus('Could not reach the server.');
  }
});

// ---------- pause menu ----------
$('invite').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}#room=${roomId}`;
  try { await navigator.clipboard.writeText(link); setStatus('Invite link copied. Share it with your friends.'); }
  catch { setStatus(`Invite link: ${link}`); }
});
$('leave').addEventListener('click', () => {
  leaving = true;
  if (ws) ws.close();
  resetGame();
  setStatus('');
  setMenuMode('browse');
});
document.getElementById('menu-loadout').addEventListener('click', () => { showMenu(false); openLoadout(); });

// ---------- loadout panel ----------
const panel = document.getElementById('loadout');
let draft = { ...settings.loadout, weapons: [...settings.loadout.weapons] };
function renderLoadout() {
  const armorsEl = document.getElementById('lo-armors');
  armorsEl.innerHTML = '';
  ARMORS.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'armor' + (draft.armor === a.id ? ' sel' : '');
    b.innerHTML = `<b>${a.name}</b><span>${a.hp} armor · ${a.maxEnergy} energy</span><span>${a.slots} weapons · run ${a.runSpeed} m/s</span>`;
    b.onclick = () => { draft.armor = a.id; draft = sanitizeLoadout(draft, SLOTS); renderLoadout(); };
    armorsEl.appendChild(b);
  });
  const wEl = document.getElementById('lo-weapons');
  wEl.innerHTML = '';
  for (const wi of PLAYER_WEAPONS) {
    const w = WEAPONS[wi];
    const ok = canCarry(draft.armor, wi);
    const on = draft.weapons.includes(wi);
    const b = document.createElement('button');
    b.className = 'weap' + (on ? ' sel' : '') + (ok ? '' : ' off');
    const only = w.armors ? ` · ${w.armors.map((x) => ARMORS[x].name).join('/')} only` : '';
    b.innerHTML = `<b>${w.name}</b><span>${w.splash ? 'splash ' + w.splash + 'm · ' : ''}${w.energyCost ? w.energyCost + ' energy/shot' : 'ammo ' + w.ammo}${only}</span>`;
    b.disabled = !ok;
    b.onclick = () => {
      if (on) draft.weapons = draft.weapons.filter((x) => x !== wi);
      else if (draft.weapons.length < SLOTS[draft.armor]) draft.weapons.push(wi);
      renderLoadout();
    };
    wEl.appendChild(b);
  }
  const pEl = document.getElementById('lo-packs');
  pEl.innerHTML = '';
  for (const pk of PACKS) {
    const b = document.createElement('button');
    b.className = 'weap' + (draft.pack === pk.id ? ' sel' : '');
    b.innerHTML = `<b>${pk.name}</b><span>${pk.desc}</span>`;
    b.onclick = () => { draft.pack = pk.id; renderLoadout(); };
    pEl.appendChild(b);
  }
  document.getElementById('lo-slots').textContent = `${draft.weapons.length} / ${SLOTS[draft.armor]} weapon slots`;
}
function openLoadout() {
  panelOpen = true;
  draft = { ...settings.loadout, weapons: [...settings.loadout.weapons] };
  renderLoadout();
  panel.style.display = 'flex';
  keys.clear(); mouseDown = [false, false, false];
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeLoadout() {
  panelOpen = false;
  panel.style.display = 'none';
  if (started) canvas.requestPointerLock(); else showMenu(true);
}
document.getElementById('lo-save').addEventListener('click', () => {
  settings.loadout = sanitizeLoadout(draft, SLOTS);
  saveSettings();
  send({ t: 'loadout', ...settings.loadout });
  hud.pushFeed(`Loadout saved: ${ARMORS[settings.loadout.armor].name}. Applies at next spawn or an inventory station`, '#c8f0ff');
  closeLoadout();
});
document.getElementById('lo-cancel').addEventListener('click', closeLoadout);

// ---------- local player ----------
let sendAcc = 0;
function updateLocal(dt, now) {
  const st = me.st;
  prompt = '';
  me.repairing = false;
  if (!me.alive || !world) return;
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const jet = mouseDown[2] || keys.has('ShiftLeft') || keys.has('ShiftRight');
  sendAcc += dt;
  const sendNow = sendAcc >= 1 / 30;
  if (sendNow) sendAcc = 0;

  if (me.vehicle) {
    const v = me.vehicle;
    let rem = dt;
    while (rem > 1e-6) {
      const h = Math.min(rem, 1 / 120);
      const impact = stepSkiff(v, { fwd, side, jet: jet || keys.has('Space'), yaw: st.yaw }, h, world);
      if (impact) send({ t: 'vimpact', s: impact });
      rem -= h;
    }
    st.pos = [v.pos[0], v.pos[1] + 0.4, v.pos[2]];
    st.vel = [...v.vel];
    st.onGround = false; st.jetting = false; st.skiing = false;
    jumpQueued = false;
    if (sendNow) send({ t: 'vst', l: me.life, p: v.pos.map(r2), v: v.vel.map(r2), y: r2(v.yaw), pi: r2(v.pitch), ro: r2(v.roll), e: r2(v.energy), j: v.lifting ? 1 : 0, cy: r2(st.yaw), cp: r2(me.pitch) });
    return;
  }

  const input = { fwd, side, jet, ski: keys.has('Space'), jump: jumpQueued, yaw: st.yaw };
  jumpQueued = false;
  let rem = dt;
  while (rem > 1e-6) {
    const h = Math.min(rem, 1 / 120);
    const impact = stepPlayer(st, input, h, world);
    if (impact) send({ t: 'impact', s: impact });
    input.jump = false;
    rem -= h;
  }
  st.pitch = me.pitch;

  // Interaction prompts: vehicles and repairs
  let nearVeh = null;
  for (const v of vehicles.values()) {
    if (!v.alive || v.driver) continue;
    if (Math.hypot(v.pos[0] - st.pos[0], v.pos[1] - st.pos[1], v.pos[2] - st.pos[2]) < 6) nearVeh = v;
  }
  const rt = repairTarget(st.pos, me.team);
  if (nearVeh) prompt = 'E: board skiff';
  else if (rt) {
    const pct = Math.round(100 * objState[rt.id][0] / rt.maxHp);
    const label = rt.type === 'gen' ? 'generator' : rt.type;
    prompt = `Hold F: repair ${label} (${pct}%)`;
    if (keys.has('KeyF')) {
      me.repairing = true;
      prompt = `Repairing ${label}… ${pct}%`;
      repairBeam([st.pos[0], st.pos[1] + 1.4, st.pos[2]], rt);
      audio.repairTick();
    }
  }

  if (sendNow) {
    send({ t: 'st', l: me.life, p: st.pos.map(r2), v: st.vel.map(r2), y: r2(st.yaw), pi: r2(me.pitch), j: st.jetting ? 1 : 0, s: st.skiing ? 1 : 0, g: st.onGround ? 1 : 0, w: me.weapon, e: r2(st.energy), r: me.repairing ? 1 : 0 });
  }

  // Firing
  const W = WEAPONS[me.weapon];
  const hasAmmo = W.energyCost ? st.energy >= W.energyCost : me.ammo[me.weapon] !== 0;
  if (mouseDown[0] && !hasAmmo && !me.repairing && now - lastWarnAt > 0.6) {
    lastWarnAt = now;
    hud.warning(W.energyCost ? `NEED ${W.energyCost} ENERGY` : 'OUT OF AMMO');
    audio.click();
  }
  if (mouseDown[0] && !me.repairing && now - me.lastFire[me.weapon] >= W.refire && hasAmmo) {
    me.lastFire[me.weapon] = now;
    if (W.energyCost) st.energy -= W.energyCost;
    else if (me.ammo[me.weapon] > 0) me.ammo[me.weapon]--;
    const d = aimDir(st.yaw, me.pitch);
    // Spawn from just below/right of the eye so discs don't clip your own head
    const right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
    const eye = ARMORS[st.armor].eyeHeight;
    const o = [
      st.pos[0] + d[0] * 1.0 + right[0] * 0.25,
      st.pos[1] + eye - 0.25 + d[1] * 1.0,
      st.pos[2] + d[2] * 1.0 + right[2] * 0.25,
    ];
    send({ t: 'fire', w: me.weapon, o: o.map(r2), d });
    protectUntil = 0;
    predictShot(me.weapon, o, d);
    audio.fire(me.weapon, null);
    recoil = Math.min(1, recoil + (me.weapon === 1 ? 0.12 : 0.5));
    vmKick = me.weapon === 1 ? 0.3 : 1;
  }
}

// Draw our own projectile immediately; the server's copy takes over when it arrives
function predictShot(w, o, d) {
  const W = WEAPONS[w], v = me.st.vel;
  const id = -(++localShotId);
  fx.spawnProjectile(id, w, o, [d[0] * W.speed + v[0] * W.inherit, d[1] * W.speed + v[1] * W.inherit, d[2] * W.speed + v[2] * W.inherit], me.id, world);
  pendingShots.push({ id, w, t: performance.now() });
  // Forget predictions the server never confirmed (refused shot): drop their visuals
  while (pendingShots.length && performance.now() - pendingShots[0].t > 1500) fx.removeProjectile(pendingShots.shift().id);
}

function throwGrenade() {
  const now = performance.now() / 1000;
  if (!me.alive || me.vehicle || me.nades <= 0 || now - me.lastNade < WEAPONS[7].refire) return;
  me.lastNade = now;
  me.nades--;
  const st = me.st;
  const d = aimDir(st.yaw, me.pitch + 0.12);
  const eye = ARMORS[st.armor].eyeHeight;
  const o = [st.pos[0] + d[0] * 0.8, st.pos[1] + eye - 0.2 + d[1] * 0.8, st.pos[2] + d[2] * 0.8];
  send({ t: 'nade', o: o.map(r2), d });
  protectUntil = 0;
  predictShot(7, o, d);
  audio.fire(7, null);
}

// Nearest damaged friendly generator/turret within reach
function repairTarget(pos, team) {
  if (!objState || !world) return null;
  let best = null, bestD = 6;
  const p = [pos[0], pos[1] + 1.2, pos[2]];
  for (const o of world.objects) {
    if (!o.maxHp || o.team !== team || !objState[o.id] || objState[o.id][0] >= o.maxHp) continue;
    const b = o.box;
    const d = Math.hypot(Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]), Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]), Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]));
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
function repairBeam(from, o) {
  if (Math.random() < 0.5) fx.beam(from, [o.pos[0] + (Math.random() - 0.5), o.pos[1] + (Math.random() - 0.5), o.pos[2] + (Math.random() - 0.5)], 0x8affc0, 0.04, 0.08);
}

// Splash (or lava spatter) when a body hits the fluid surface
function checkSplash(holder, pos, vel) {
  const fl = world && world.fluid;
  if (!fl) return;
  const above = pos[1] >= fl.level;
  if (holder.wasAbove && !above && vel[1] < -3) {
    const speed = Math.hypot(...vel);
    fx.splash([pos[0], fl.level + 0.1, pos[2]], speed, fl.kind === 'lava');
    audio.splash([pos[0], fl.level, pos[2]], fl.kind === 'lava');
  }
  holder.wasAbove = above;
}

// ---------- soundscape: footsteps, landings, other jets, ambience, music ----------
let stepAcc = 0, wasGround = true, lastVy = 0, nextAmbience = 0;
const near = { water: 0, lava: 0, gen: 0 };
function updateSoundscape(dt, now) {
  audio.setMusic(!started || !!endInfo, now);
  if (!world) return;
  const st = me.st;
  if (me.alive && !me.vehicle) {
    const speed = Math.hypot(st.vel[0], st.vel[2]);
    if (st.onGround && !st.skiing && speed > 1.5) {
      stepAcc += speed * dt;
      if (stepAcc > 2.3 + st.armor * 0.3) { stepAcc = 0; audio.step(st.armor); }
    }
    if (st.onGround && !wasGround && lastVy < -9) audio.land(-lastVy);
    wasGround = st.onGround; lastVy = st.vel[1];
  }
  // Other players' jets, as short positional puffs
  for (const o of others.values()) {
    if (!o.alive || !o.jet || !o.pos) continue;
    if (Math.hypot(o.pos[0] - camera.position.x, o.pos[2] - camera.position.z) > 80) continue;
    if (now > (o.nextPuff || 0)) { o.nextPuff = now + 0.22; audio.jetPuff(o.pos); }
  }
  // Proximity to water, lava and generators, sampled a couple of times a second
  if (now > nextAmbience) {
    nextAmbience = now + 0.4;
    const c = camera.position;
    near.water = near.lava = near.gen = 0;
    if (world.fluid) {
      let best = Infinity;
      for (let dz = -60; dz <= 60; dz += 12) for (let dx = -60; dx <= 60; dx += 12) {
        if (world.height(c.x + dx, c.z + dz) < world.fluid.level) best = Math.min(best, Math.hypot(dx, dz));
      }
      const w = Math.max(0, 1 - best / 70);
      near[world.fluid.kind === 'lava' ? 'lava' : 'water'] = w;
    }
    if (objState) {
      for (const o of world.objects) {
        if (o.type !== 'gen' || !objState[o.id] || objState[o.id][1]) continue;
        near.gen = Math.max(near.gen, 1 - Math.hypot(o.pos[0] - c.x, o.pos[1] - c.y, o.pos[2] - c.z) / 25);
      }
    }
  }
  audio.setAmbience(world.def.weather, near, now);
}

// ---------- one-time hints ----------
let firstSpawnAt = 0;
function hint(key, title, sub) {
  if (settings.hints[key]) return;
  settings.hints[key] = 1;
  saveSettings();
  hud.pushBanner(`TIP: ${title}`, '#9fe8ff', sub);
}
function updateHints(now) {
  if (!me.alive || !world || !started) return;
  const st = me.st;
  if (st.skiing && st.onGround) settings.hints.ski = settings.hints.ski || (saveSettings(), 1);
  if (firstSpawnAt && now - firstSpawnAt > 25) hint('ski', 'HOLD SPACE TO SKI', 'On downhill slopes you keep all your speed');
  if (st.jetting && st.energy < 8) hint('energy', 'ENERGY RECHARGES WHEN YOU STOP JETTING', 'Ski down slopes while it refills');
  for (const o of world.objects) {
    const d = Math.hypot(o.pos[0] - st.pos[0], o.pos[2] - st.pos[2]);
    if (o.type === 'station' && o.team === me.team && d < 9) hint('station', 'STAND ON THE STATION', 'It applies your loadout (B) and refills ammo and armor');
    if (o.type === 'gen' && o.team === me.team && d < 12) hint('gen', 'PROTECT YOUR GENERATOR', 'It powers your turrets and stations. Hold F to repair it');
  }
  for (const v of vehicles.values()) {
    if (v.alive && !v.driver && v.pos && Math.hypot(v.pos[0] - st.pos[0], v.pos[2] - st.pos[2]) < 12) hint('skiff', 'PRESS E TO BOARD THE SKIFF', 'Space lifts it; ram enemies at speed');
  }
}

// Translucent shimmer around players with spawn protection
const bubbleGeo = new THREE.SphereGeometry(1.35, 20, 14);
function setBubble(model, on, now) {
  let b = model.userData.bubble;
  if (!on) { if (b) b.visible = false; return; }
  if (!b) {
    b = new THREE.Mesh(bubbleGeo, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.position.y = 1.15;
    model.add(b);
    model.userData.bubble = b;
  }
  b.visible = true;
  b.material.opacity = 0.12 + 0.08 * Math.sin(now * 8);
  b.scale.setScalar(1 + 0.03 * Math.sin(now * 5));
}

// ---------- remote interpolation ----------
const INTERP = 0.1;
// Interpolate a snapshot buffer at render time `rt`; `s` is the newest relevant snapshot
function sample(snaps, rt) {
  let a = snaps[0], b = null;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
  }
  if (b && b.alive === a.alive && Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]) < 40) {
    const k = (rt - a.t) / (b.t - a.t);
    let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { s: b, pos: [0, 1, 2].map((i) => a.pos[i] + (b.pos[i] - a.pos[i]) * k), yaw: a.yaw + dy * k, pitch: a.pitch + (b.pitch - a.pitch) * k };
  }
  const latest = b || a;
  const ex = Math.min(0.25, Math.max(0, rt - latest.t));
  return { s: latest, pos: [0, 1, 2].map((i) => latest.pos[i] + latest.vel[i] * ex), yaw: latest.yaw, pitch: latest.pitch };
}

function updateRemote(o, now, dt) {
  if (!o.snaps.length) return;
  const { s, pos, yaw, pitch } = sample(o.snaps, now + (serverOffset ?? 0) - INTERP);
  if (world && !s.veh) pos[1] = Math.max(pos[1], world.height(pos[0], pos[2]));
  o.pos = pos; o.vel = s.vel; o.yaw = yaw; o.pitch = pitch;
  o.alive = s.alive; o.hp = s.hp; o.maxHp = s.maxHp; o.jet = s.jet; o.ski = s.ski; o.veh = s.veh;
  setBubble(o.model, s.prot && s.alive, now);
  if (s.alive) checkSplash(o, o.pos, o.vel);
  // Riders sit on their skiff's rendered position
  const rv = s.veh && vehicles.get(s.veh);
  if (rv) o.pos = [rv.pos[0], rv.pos[1] + 0.4, rv.pos[2]];
  const ground = world ? world.height(o.pos[0], o.pos[2]) : 0;
  const onGround = o.pos[1] - ground < 0.3;
  const speed = Math.hypot(o.vel[0], o.vel[2]);
  o.model.visible = o.alive && !(o.goneAt && now - o.goneAt < 1.5);
  o.model.position.set(...o.pos);
  placeShadow(o.model, o.pos[0], o.pos[1], o.pos[2], o.alive && !rv);
  o.model.rotation.y = rv ? rv.yaw : yaw;
  animateArmor(o.model, { speed, onGround: onGround || !!rv, skiing: o.ski || !!rv, jetting: o.jet && !rv, pitch, weapon: s.weapon }, dt, now);
  if (o.alive && !rv) fx.playerTrail(o.pos, o.vel, o.jet, o.ski, speed, dt);
  if (o.alive && s.rep) {
    const t = repairTarget(o.pos, o.team);
    if (t) repairBeam([o.pos[0], o.pos[1] + 1.4, o.pos[2]], t);
  }
  // Enemies show on radar when in line of sight or making noise
  o.spotted = o.team === me.team || o.jet || !!rv || (world && !world.raycast(camera.position.x, camera.position.y, camera.position.z, o.pos[0], o.pos[1] + 1.5, o.pos[2]));
}

function updateVehicles(now) {
  for (const v of vehicles.values()) {
    const mine = me.vehicle && me.vehicle.id === v.id;
    let pos, yaw, pitch, roll, lifting;
    if (mine) {
      ({ pos, yaw, pitch, roll, lifting } = me.vehicle);
      v.driver = me.id; v.alive = true;
    } else {
      if (!v.snaps.length) continue;
      const r = sample(v.snaps, now + (serverOffset ?? 0) - INTERP);
      pos = r.pos; yaw = r.yaw; pitch = r.s.pitch; roll = r.s.roll; lifting = r.s.lifting;
      v.driver = r.s.driver; v.alive = r.s.alive; v.vel = r.s.vel;
    }
    v.pos = pos; v.yaw = yaw;
    v.model.visible = v.alive;
    if (!v.alive) { if (v.model.userData.shadow) v.model.userData.shadow.visible = false; continue; }
    v.model.position.set(pos[0], pos[1] - 0.6, pos[2]);
    placeShadow(v.model, pos[0], pos[1] - 0.6, pos[2], true);
    v.model.rotation.set(0, yaw, 0);
    v.model.userData.body.rotation.set(pitch, 0, roll);
    v.model.userData.exhaust.scale.set(1, v.driver ? 1 + Math.random() * 0.4 : 0.3, 1);
    fx.hoverWash(pos, lifting);
  }
}

// ---------- camera ----------
function updateCamera(dt, now) {
  const st = me.st;
  let pos, yaw = st.yaw, pitch = me.pitch;
  if (me.alive) {
    pos = [st.pos[0], st.pos[1] + ARMORS[st.armor].eyeHeight, st.pos[2]];
    if (thirdPerson || me.vehicle) {
      const d = aimDir(yaw, pitch);
      const full = me.vehicle ? 11 : 7, lift = me.vehicle ? 3.2 : 1.5;
      let back = full;
      const hit = world && world.raycast(pos[0], pos[1], pos[2], pos[0] - d[0] * back, pos[1] - d[1] * back + lift, pos[2] - d[2] * back);
      if (hit) back *= Math.max(0.1, hit.t - 0.05);
      pos = [pos[0] - d[0] * back, pos[1] - d[1] * back + lift * (back / full), pos[2] - d[2] * back];
    }
  } else {
    // Slow orbit around where you died, watching the killer if we can see them
    const t = now - me.deathAt;
    const k = others.get(me.killer);
    const c = me.deathPos;
    yaw = st.yaw + t * 0.25;
    const r = 9 + Math.min(t * 3, 8);
    pos = [c[0] + Math.sin(yaw) * r, c[1] + 4 + Math.min(t, 3), c[2] + Math.cos(yaw) * r];
    if (world) pos[1] = Math.max(pos[1], world.height(pos[0], pos[2]) + 2);
    let look = c;
    if (k && k.alive) look = k.pos;
    const dx = look[0] - pos[0], dy = look[1] + 1 - pos[1], dz = look[2] - pos[2];
    yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  camera.position.set(...pos);
  camera.rotation.set(pitch, yaw, 0);
  if (shake > 0) {
    camera.rotation.x += (Math.random() - 0.5) * shake * 0.08;
    camera.rotation.y += (Math.random() - 0.5) * shake * 0.08;
    shake = Math.max(0, shake - dt * 2.5);
  }
  // Speed FOV kick sells the skiing
  const speed = Math.hypot(...st.vel);
  const targetFov = settings.fov + Math.min(15, Math.max(0, speed - 30) * 0.15);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
  if (game.sky) game.sky.position.copy(camera.position);
}

const swayTarget = [0, 0], sway = [0, 0];
let shownWeapon = -1, switchT = 1, lastFireSeen = 0;
function updateViewModel(dt, now) {
  const show = me.alive && !thirdPerson && !me.vehicle && !endInfo;
  const st = me.st;
  const speed = Math.hypot(st.vel[0], st.vel[2]);
  // Weapon switch: drop the old gun out of view, raise the new one
  if (me.weapon !== shownWeapon) { shownWeapon = me.weapon; switchT = 0; }
  switchT = Math.min(1, switchT + dt * 4);
  const lower = (1 - switchT) ** 2 * 0.35;
  // Sway lags behind mouse movement, then recentres
  for (let i = 0; i < 2; i++) {
    sway[i] += (swayTarget[i] - sway[i]) * Math.min(1, dt * 10);
    swayTarget[i] *= Math.max(0, 1 - dt * 6);
  }
  const W = WEAPONS[me.weapon];
  const since = now - me.lastFire[me.weapon];
  const justFired = me.lastFire[me.weapon] !== lastFireSeen && since < 0.1;
  if (justFired) lastFireSeen = me.lastFire[me.weapon];
  const state = {
    now, since, justFired, refire: W.refire, firing: mouseDown[0] && show,
    energy: st.energy, energyCost: W.energyCost || 1,
  };
  viewModels.forEach((m, i) => {
    m.visible = show && i === me.weapon;
    if (!m.visible) return;
    const walk = st.onGround && !st.skiing ? Math.min(speed, 12) / 12 : 0;
    const bobX = Math.sin(now * 9) * 0.012 * walk, bobY = Math.abs(Math.cos(now * 9)) * 0.01 * walk;
    const breathe = Math.sin(now * 1.6) * 0.003;
    m.position.set(0.25 + bobX + sway[0], -0.27 - bobY + breathe - lower + sway[1] - (st.skiing ? 0.025 : 0), -0.8 + vmKick * 0.07);
    m.rotation.set(vmKick * 0.12 + sway[1] * 1.5 - lower * 1.2, sway[0] * 1.5, (st.skiing ? 0.06 : 0) + bobX * 2);
    m.userData.animate(dt, state);
    const f = m.userData.flash;
    f.visible = since < 0.055;
    if (f.visible) { f.rotation.z = Math.random() * Math.PI; f.scale.setScalar(0.8 + Math.random() * 0.5); }
  });
  vmKick = Math.max(0, vmKick - dt * 6);
}

// ---------- main loop ----------
let last = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (!world) { renderer.clear(); return; }

  updateLocal(dt, now);
  updateVehicles(now);
  for (const o of others.values()) updateRemote(o, now, dt);

  // Own model: third person, or riding a skiff
  if (myModel) {
    myModel.visible = me.alive && (thirdPerson || !!me.vehicle);
    myModel.position.set(...me.st.pos);
    placeShadow(myModel, me.st.pos[0], me.st.pos[1], me.st.pos[2], me.alive && !me.vehicle);
    myModel.rotation.y = me.vehicle ? me.vehicle.yaw : me.st.yaw;
    const sp = Math.hypot(me.st.vel[0], me.st.vel[2]);
    animateArmor(myModel, { speed: sp, onGround: me.st.onGround || !!me.vehicle, skiing: me.st.skiing || !!me.vehicle, jetting: me.st.jetting, pitch: me.pitch, weapon: me.weapon }, dt, now);
    if (me.alive && !me.vehicle) fx.playerTrail(me.st.pos, me.st.vel, me.st.jetting, me.st.skiing && me.st.onGround, sp, dt);
  }

  // Flags follow their carrier's rendered position
  const flagsRender = flagState.map((f) => {
    if (!f) return null;
    let pos = f.pos;
    if (f.state === 1) {
      if (f.carrier === me.id) pos = [me.st.pos[0], me.st.pos[1] + 2.4, me.st.pos[2]];
      else { const c = others.get(f.carrier); if (c) pos = [c.pos[0], c.pos[1] + 2.4, c.pos[2]]; }
    }
    return { ...f, pos, visible: !(f.state === 1 && f.carrier === me.id && !thirdPerson && !me.vehicle) };
  });
  game.updateFlags(flagsRender, dt);
  if (objState) {
    game.updateObjects(world, objState, power, dt);
    world.objects.forEach((o, i) => { if (o.maxHp && objState[i] && objState[i][1]) fx.wreckSmoke(o.pos); });
  }

  for (const c of pickups.values()) {
    const t = c.userData.target;
    c.position.set(t[0], t[1] + 0.5 + Math.sin(now * 3) * 0.15, t[2]);
    c.rotation.y += dt * 1.5;
  }

  updateCamera(dt, now);
  fx.update(dt, world);
  gore.update(dt, world);
  fx.weather(world.def.weather, [camera.position.x, camera.position.y, camera.position.z], dt);
  game.updateEnv(camera.position, now);
  updateViewModel(dt, now);
  updateSoundscape(dt, now);
  updateHints(now);
  hud.fps = hud.fps ? hud.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
  if (me.weapon !== hudWeapon) { if (hudWeapon !== -1 && me.alive) { hud.showWeapon(WEAPONS[me.weapon].name); audio.event('weapon_switch'); } hudWeapon = me.weapon; }
  const maxHp = ARMORS[me.st.armor].hp;
  if (me.alive && me.hp / maxHp < 0.3 && now - lastHeartbeat > 0.85) { lastHeartbeat = now; audio.heartbeat(); }
  if (myModel) setBubble(myModel, me.alive && now < protectUntil, now);
  if (me.alive) checkSplash(me, me.st.pos, me.st.vel);

  const speed = Math.hypot(...me.st.vel);
  const right = [Math.cos(camera.rotation.y), 0, -Math.sin(camera.rotation.y)];
  audio.setListener([camera.position.x, camera.position.y, camera.position.z], right);
  audio.setMovement({ jetting: me.alive && me.st.jetting, speed: me.alive && !me.vehicle ? speed : 0, skiing: me.st.skiing, onGround: me.st.onGround });
  audio.setEngine(me.alive && !!me.vehicle, speed, !!(me.vehicle && me.vehicle.lifting));

  recoil = Math.max(0, recoil - dt * 3);
  hud.hitMarker = Math.max(0, hud.hitMarker - dt);
  hud.damageFlash = Math.max(0, hud.damageFlash - dt * 1.2);

  if (QUALITY[settings.quality]?.bloom ?? true) {
    scenePass.scene = game.scene;
    composer.render(dt);
  } else {
    renderer.clear();
    renderer.render(game.scene, camera);
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }

  // No HUD over the lobby backdrop
  if (!started) { hud.ctx.setTransform(1, 0, 0, 1, 0, 0); hud.ctx.clearRect(0, 0, hud.canvas.width, hud.canvas.height); return; }
  hud.draw({
    camera, camPos: [camera.position.x, camera.position.y, camera.position.z],
    me: { id: me.id, team: me.team, alive: me.alive, hp: me.hp, energy: me.st.energy, armor: me.st.armor, weapon: me.weapon, weapons: me.weapons, ammo: me.ammo, yaw: camera.rotation.y, pack: me.pack, kits: me.kits, nades: me.nades },
    maxHp: ARMORS[me.st.armor].hp, maxEnergy: ARMORS[me.st.armor].maxEnergy,
    protectLeft: Math.max(0, protectUntil - now),
    timeLeft: matchEndAt == null ? null : matchEndAt - now, capLimit,
    end: endInfo, deathInfo: me.deathInfo, nameOf,
    qcOpen, showHelp, showFps: settings.showFps,
    others: [...others.values()].map((o) => ({ ...o, name: nameOf(o.id) })),
    vehicles: [...vehicles.values()],
    vehicle: me.vehicle,
    objects: world.objects, ob: objState, power,
    flags: flagsRender, score, roster, showScores,
    speed, skiing: me.st.skiing && me.st.onGround, recoil, prompt, repairing: me.repairing,
    carrying: flagState.some((f) => f && f.state === 1 && f.carrier === me.id),
    outOfBounds: world.outOfBounds(me.st.pos[0], me.st.pos[2]),
    respawnIn: me.alive || !me.id ? null : 4 - (now - me.deathAt),
    mapName: MAPS[world.mapIndex].name,
  });
}
requestAnimationFrame(frame);

// Show the first map behind the menu straight away
setMap(0);
me.st.pos = [...world.spawns[0][4]];
me.deathPos = [...world.flagStands[0]];
me.deathAt = performance.now() / 1000;
setMenuMode('browse');
if (inviteId) setStatus('You were invited to a game. It is selected below; press Join.');

// Generated models load in the background; swap them in for the procedural stand-ins
library.setEnvironment(vmScene.environment);
library.ready.then(() => {
  viewModelTeam = -1;
  buildViewModels(me.team || 0);
  if (myModel) setMyModel();
  for (const o of others.values()) { dropModel(o.model); o.model = addModel(createArmor(o.team, o.armor), o.armor === 2 ? 2 : 1.6); }
  for (const v of vehicles.values()) { dropModel(v.model); v.model = addModel(createSkiff(v.team), 4.5); }
  for (const [id, c] of pickups) {
    const n = createCrate();
    n.position.copy(c.position); n.userData.target = c.userData.target;
    game.dynamic.remove(c); game.dynamic.add(n); pickups.set(id, n);
  }
  if (world) { game.rebuildObjects(world); game.rebuildScenery(world); }
});

// Test hook: ?debug exposes state so automated checks can teleport and drive
if (/[?&]debug\b/.test(location.search)) window.__rl = { me, vehicles, others, send, get viewModels() { return viewModels; }, library, get myModel() { return myModel; }, camera, gore, hud, game, audio, get world() { return world; } };
