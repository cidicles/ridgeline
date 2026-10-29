import * as THREE from 'three';
import { SIZE, TEAM_COLORS, TEAM_NAMES } from '../shared/world.js';
import { PALETTES } from './textures.js';
import { library } from './assets3d.js';
import { KEEP } from '../shared/base.js';

// ---------- generated scenery (scripts/generate-models.js) ----------

// Generated model per scenery kind, and the size it's baked to so it matches the
// colliders in shared/world.js: base at y=0 (rocks centred), w = footprint, h = height
// crown: [centre height, trunk radius] as fractions of h, for soft canopy shading
const GENERATED = {
  pine: { id: 'pine_tree', h: 10.5, crown: [0.45, 0.06] },
  snowpine: { id: 'snow_pine', h: 10.5, crown: [0.5, 0.06], tint: [0.82, 0.84, 0.88] },
  broadleaf: { id: 'broadleaf_tree', h: 11, crown: [0.68, 0.06], tint: [0.4, 0.37, 0.3] },
  dead: { id: 'dead_tree', h: 8 },
  spire: { id: 'rock_spire', w: 8.5, h: 30 },
  boulder: { id: 'boulder', w: 2.1, h: 1.7, centre: true },
};
GENERATED.rock = GENERATED.boulder;
const SWAYS = new Set(['pine', 'snowpine', 'broadleaf']);
// Rock tint per palette (the generated rocks are neutral grey and red sandstone)
const ROCK_TINT = { temperate: [1, 1, 1], desert: [1.12, 0.86, 0.72], snow: [0.92, 0.96, 1.04], volcanic: [0.42, 0.4, 0.4] };
const SPIRE_TINT = { desert: [1, 1, 1], volcanic: [0.38, 0.34, 0.33] };

const baked = new Map();
// One geometry per model with its node transforms applied, rescaled to the kind's size
function bakedGeometry(id, fit) {
  const key = `${id}:${fit.w}:${fit.h}`;
  if (baked.has(key)) return baked.get(key);
  const m = library.models[id];
  let mesh = null;
  m.scene.updateMatrixWorld(true);
  m.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  const geo = new THREE.BufferGeometry();
  // Meshopt-quantised attributes are normalised integers: expand to floats before transforming
  for (const name of ['position', 'normal', 'uv']) {
    const a = mesh.geometry.attributes[name];
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (mesh.geometry.index) geo.setIndex(Array.from(mesh.geometry.index.array));
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const b = geo.boundingBox, size = b.getSize(new THREE.Vector3());
  const sy = fit.h / size.y, sxz = fit.w ? fit.w / Math.max(size.x, size.z) : sy;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.scale(sxz, sy, sxz);
  if (fit.centre) geo.translate(0, -fit.h / 2, 0);
  if (fit.crown) {
    // Canopy normals bend outward from the crown's centre, so the foliage shades as one
    // soft volume instead of thousands of facets; the trunk keeps its own normals
    const p = geo.attributes.position, n = geo.attributes.normal;
    const cy = fit.crown[0] * fit.h, trunk = fit.crown[1] * fit.h, v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = Math.min(1, Math.max(0, (Math.hypot(x, z) - trunk) / trunk));
      if (k === 0) continue;
      v.set(x, (y - cy) * 0.7, z).normalize();
      o.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(v, 0.75 * k).normalize();
      n.setXYZ(i, o.x, o.y, o.z);
    }
  }
  geo.computeBoundingSphere();
  const result = { geo, material: mesh.material };
  baked.set(key, result);
  return result;
}

const swayTime = { value: 0 };
export function animateScenery(t) { swayTime.value = t; }

// Lambert copy of the generated material: no metalness, optional wind sway and snow caps
function sceneryMaterial(src, { sway, snow, glow, foliage, tint = [1, 1, 1] }) {
  // Only kinds meant to glow (the dead tree's embers) keep Meshy's emissive map;
  // foliage drops the normal map, which fights the soft canopy normals
  const m = new THREE.MeshLambertMaterial({
    map: src.map, normalMap: foliage ? null : src.normalMap, emissiveMap: glow ? src.emissiveMap : null,
    color: new THREE.Color(...tint),
    emissive: glow && src.emissiveMap ? new THREE.Color(1, 0.6, 0.4) : new THREE.Color(0, 0, 0), emissiveIntensity: 1,
  });
  if (!sway && !snow) return m;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.swayTime = swayTime;
    if (sway) {
      sh.vertexShader = 'uniform float swayTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        // Wind: the crown sways more than the trunk, each tree out of step with its neighbours
        vec3 root = instanceMatrix[3].xyz;
        float bend = pow(max(transformed.y, 0.0) / 10.0, 1.6);
        float gust = sin(swayTime * 0.6 + root.x * 0.013 + root.z * 0.011) * 0.5 + 0.5;
        transformed.x += sin(swayTime * 1.3 + root.x * 0.21) * 0.18 * bend * (0.5 + gust);
        transformed.z += cos(swayTime * 1.1 + root.z * 0.17) * 0.12 * bend * (0.5 + gust);`);
    }
    if (snow) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Snow settles on upward-facing surfaces
        float snowCap = smoothstep(0.35, 0.7, dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 1.0), snowCap);`);
    }
  };
  m.customProgramCacheKey = () => `scenery${sway ? 1 : 0}${snow ? 1 : 0}`;
  return m;
}

// ---------- geometry helpers ----------

// Deterministic jitter so every client builds identical props
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Bake a colour (or a per-vertex colour function) into a non-indexed copy
function painted(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (typeof color === 'function') c.copy(color(pos.getX(i), pos.getY(i), pos.getZ(i)));
    else c.set(color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

// Concatenate non-indexed geometries that share position/normal/color
export function merge(geos) {
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    if (!geos.every((g) => g.attributes[name])) continue;
    const arr = new Float32Array(total * 3);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

// Push vertices in/out radially with deterministic noise (shared vertices stay welded)
function lumpy(geo, amount, seed) {
  const r = rng(seed), pos = geo.attributes.position, offsets = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 + (r() - 0.5) * amount);
    const k = offsets.get(key);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * (0.5 + 0.5 * k), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const cyl = (rt, rb, h, seg, y) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, y, 0);

// ---------- prop shapes (unit scale; instances scale them) ----------
function buildKinds(palette) {
  const P = PALETTES[palette];
  const rock = new THREE.Color(`rgb(${P.rock.join(',')})`);
  const rockDark = rock.clone().multiplyScalar(0.7);
  const snowy = palette === 'snow';
  const snow = new THREE.Color(0xf2f5fa);
  const kinds = {};

  const bark = 0x5a4232, needle = [0x2f4a2a, 0x355230, 0x2a4226];
  kinds.pine = merge([
    painted(cyl(0.22, 0.4, 4, 6, 2), bark),
    ...[[2.6, 4.4, 4.4], [2.0, 3.8, 6.6], [1.3, 3.0, 8.6]].map(([r, h, y], i) => painted(new THREE.ConeGeometry(r, h, 8).translate(0, y, 0), needle[i])),
  ]);
  kinds.snowpine = merge([
    painted(cyl(0.22, 0.4, 4, 6, 2), bark),
    ...[[2.6, 4.4, 4.4], [2.0, 3.8, 6.6], [1.3, 3.0, 8.6]].map(([r, h, y]) => painted(new THREE.ConeGeometry(r, h, 8).translate(0, y, 0),
      (x, yy) => (yy > y - h * 0.1 ? snow : new THREE.Color(0x2c4430)))),
  ]);
  const leaf = [0x55692e, 0x4a5f2a, 0x63753a];
  kinds.broadleaf = merge([
    painted(cyl(0.3, 0.5, 5.5, 7, 2.75), 0x4e3a2c),
    ...[[0, 7.2, 0, 2.8], [1.6, 6.4, 0.8, 2.1], [-1.4, 6.6, -0.9, 2.2], [0.3, 8.6, -0.4, 1.9]].map(([x, y, z, r], i) =>
      painted(lumpy(new THREE.IcosahedronGeometry(r, 1), 0.35, 11 + i).translate(x, y, z), leaf[i % 3])),
  ]);
  const charcoal = 0x2a2522;
  kinds.dead = merge([
    painted(cyl(0.12, 0.42, 7.5, 6, 3.75), charcoal),
    ...[[0.9, 4.5, 0.5], [-0.8, 5.5, 0.6], [0.2, 6.3, -0.9], [-0.5, 3.6, -0.7]].map(([x, y, z], i) => {
      const g = cyl(0.04, 0.1, 2.2, 5, 1.1);
      g.rotateZ(-Math.sign(x || 1) * (0.7 + i * 0.1)); g.rotateY(i * 1.7);
      return painted(g.translate(x * 0.3, y, z * 0.3), charcoal);
    }),
  ]);
  // Rock spire: tapered, lumpy, banded strata
  const spire = lumpy(new THREE.CylinderGeometry(2.2, 4.4, 30, 9, 8).translate(0, 15, 0), 0.3, 5);
  kinds.spire = painted(spire, (x, y) => (Math.floor(y / 3.2) % 2 ? rock : rockDark).clone().lerp(snowy ? snow : rock, y > 26 ? 0.4 : 0));
  const boulder = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.45, 9);
  kinds.boulder = painted(boulder, (x, y) => (snowy && y > 0.35 ? snow : y < -0.2 ? rockDark : rock));
  kinds.rock = kinds.boulder;
  for (const g of Object.values(kinds)) g.computeBoundingSphere();
  return kinds;
}

// Instances are grouped into squares this size (metres) for culling
const CHUNK = 256;

// How far beyond the playable tile each kind is still worth drawing
const REACH = { rock: 220, boulder: 700, spire: SIZE, pine: 700, snowpine: 700, broadleaf: 700, dead: 700 };

export function buildScenery(world) {
  const group = new THREE.Group();
  const kinds = buildKinds(world.def.palette);
  const byKind = {};
  for (const s of world.scenery) (byKind[s.kind] ||= []).push(s);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const [kind, items] of Object.entries(byKind)) {
    const reach = REACH[kind];
    // Copies in neighbouring tiles only where they'd be visible from the play area
    const placed = [];
    for (const it of items) {
      for (let tx = -1; tx <= 1; tx++) {
        for (let tz = -1; tz <= 1; tz++) {
          const x = it.x + tx * SIZE, z = it.z + tz * SIZE;
          if (x < -reach || x > SIZE + reach || z < -reach || z > SIZE + reach) continue;
          placed.push([it, x, z]);
        }
      }
    }
    // Generated model when loaded, else the procedural one
    const fit = GENERATED[kind];
    let geo = kinds[kind], material = mat, tint = null;
    if (fit && library.has(fit.id)) {
      const bk = bakedGeometry(fit.id, fit);
      geo = bk.geo;
      const rocky = kind === 'boulder' || kind === 'rock' || kind === 'spire';
      material = sceneryMaterial(bk.material, { sway: SWAYS.has(kind), snow: rocky && world.def.palette === 'snow', glow: kind === 'dead', foliage: !!fit.crown, tint: fit.tint });
      tint = kind === 'spire' ? SPIRE_TINT[world.def.palette] : rocky ? ROCK_TINT[world.def.palette] : null;
    }
    // Split into square chunks so the camera and the sun's shadow pass cull them separately
    const chunks = new Map();
    for (const p of placed) {
      const k = `${Math.floor(p[1] / CHUNK)},${Math.floor(p[2] / CHUNK)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(p);
    }
    for (const list of chunks.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([it, x, z], i) => {
        const tilt = kind === 'rock' || kind === 'boulder' ? 0.35 : kind === 'dead' ? 0.08 : 0.03;
        e.set(Math.sin(it.rot * 3) * tilt, it.rot, Math.cos(it.rot * 5) * tilt);
        q.setFromEuler(e);
        v.set(x, it.y, z);
        const s = it.s;
        sc.set(s, kind === 'rock' || kind === 'boulder' ? s * 0.8 : s, s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
        if (tint) {
          // Slight per-instance variation keeps a field of rocks from looking stamped
          const vary = 0.9 + ((it.rot * 7.31) % 1) * 0.2;
          mesh.setColorAt(i, col.setRGB(tint[0] * vary, tint[1] * vary, tint[2] * vary));
        }
      });
      mesh.computeBoundingSphere();
      // Trees cast but don't take sun shadows: self-shadowing turns a crown's inside black
      if (fit?.crown) mesh.userData.noReceive = true;
      group.add(mesh);
    }
  }
  return group;
}

// ---------- base decoration (visual only; collision is unchanged) ----------

const teamCss = (team) => `#${TEAM_COLORS[team].toString(16).padStart(6, '0')}`;

// Team symbol centred at (x, y), about 220px tall at scale 1: Ember's flame, Glacier's snow crystal
function drawEmblem(g, team, x, y, scale, col) {
  g.save(); g.translate(x, y); g.scale(scale, scale);
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 10; g.lineJoin = 'round'; g.lineCap = 'round';
  if (team === 0) {
    g.beginPath(); g.moveTo(0, -110); g.bezierCurveTo(70, -40, 80, 40, 0, 90); g.bezierCurveTo(-80, 40, -60, -20, -20, -50);
    g.bezierCurveTo(-10, -10, 10, 0, 0, -110); g.fill();
  } else {
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -100); g.moveTo(0, -55); g.lineTo(25, -80); g.moveTo(0, -55); g.lineTo(-25, -80); g.stroke();
    }
  }
  g.restore();
}

// Flag cloth: team colour field, pale emblem, darker hoist stripe
export function flagTexture(team) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = teamCss(team); g.fillRect(0, 0, 320, 200);
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, 34, 200);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(34, 0, 6, 200);
  drawEmblem(g, team, 185, 100, 0.72, 'rgba(255,255,255,0.92)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function emblemTexture(team) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  const col = teamCss(team);
  g.fillStyle = '#1a1f26'; g.fillRect(0, 0, 256, 512);
  g.fillStyle = col; g.fillRect(0, 0, 256, 26); g.fillRect(0, 486, 256, 26);
  drawEmblem(g, team, 128, 220, 1, col);
  g.fillStyle = col; g.font = 'bold 44px Rajdhani, sans-serif'; g.textAlign = 'center';
  g.fillText(TEAM_NAMES[team].toUpperCase(), 128, 400);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildBaseDecor(world) {
  const group = new THREE.Group();
  const beacons = [];
  const spinners = [];   // radar dishes
  const fields = [];     // force-field door materials
  const windowGlow = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
  // Merged decor geometry carries no UVs, so these are flat-coloured
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x5c626a });
  const railMat = new THREE.MeshLambertMaterial({ color: 0xb8bec6 });
  const whiteGlow = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (const b of world.bases) {
    const { wx, wz, h, team, alongX, dir } = b;
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_COLORS[team]).multiplyScalar(1.15) });
    const parts = { dark: [], rail: [], glow: [], white: [], window: [] };
    const toWorld = (a, p) => (alongX ? [wx + a * dir, wz + p] : [wx + p, wz + a * dir]);
    // Axis-aligned box in base-local coordinates
    const box = (list, a, y, p, sa, sy, sp) => {
      const [x, z] = toWorld(a, p);
      list.push(painted(new THREE.BoxGeometry(alongX ? sa : sp, sy, alongX ? sp : sa).translate(x, y + sy / 2, z), 0xffffff));
    };

    // Railings around both tower decks and along the bridge
    const deckY = h + 25;
    for (const s of [-1, 1]) {
      const pc = 22 * s;
      const edges = [[-5, pc - 5, -5, pc + 5], [5, pc - 5, 5, pc + 5], [-5, pc + 5 * s, 5, pc + 5 * s]];
      for (const [a0, p0, a1, p1] of edges) {
        const len = Math.hypot(a1 - a0, p1 - p0);
        const am = (a0 + a1) / 2, pm = (p0 + p1) / 2;
        const along = Math.abs(a1 - a0) > Math.abs(p1 - p0);
        box(parts.rail, am, deckY + 1.0, pm, along ? len : 0.08, 0.08, along ? 0.08 : len);
        box(parts.rail, am, deckY + 0.5, pm, along ? len : 0.06, 0.06, along ? 0.06 : len);
        for (let k = 0; k <= 4; k++) box(parts.rail, a0 + (a1 - a0) * k / 4, deckY, p0 + (p1 - p0) * k / 4, 0.1, 1.05, 0.1);
      }
      // Glowing corner strips up each tower
      for (const ca of [-3.05, 3.05]) for (const cp of [-3.05, 3.05]) box(parts.glow, ca, h - 1, pc + cp, 0.14, 25.5, 0.14);
      // Antenna mast with a blinking beacon
      const [mx, mz] = toWorld(-4.2, pc + 4.2 * s);
      parts.dark.push(painted(new THREE.CylinderGeometry(0.06, 0.1, 7, 6).translate(mx, deckY + 3.5, mz), 0xffffff));
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
      beacon.position.set(mx, deckY + 7.1, mz);
      group.add(beacon); beacons.push(beacon);
      // Team banner hanging on the face toward the map centre
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 9), new THREE.MeshLambertMaterial({ map: emblemTexture(team), side: THREE.DoubleSide }));
      const [bx, bz] = toWorld(3.1, pc);
      banner.position.set(bx, h + 16, bz);
      banner.rotation.y = alongX ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      group.add(banner);
    }
    for (const s of [-1, 1]) {
      box(parts.rail, 2 * s, deckY + 1.0, 0, 0.08, 0.08, 34);
      for (let k = -4; k <= 4; k++) box(parts.rail, 2 * s, deckY, k * 4, 0.1, 1.05, 0.1);
    }

    // The keep (shared/base.js): lit doorways, emblems, team trim, interior lights,
    // the jet shaft's light column, glowing stair edges and generator-room machinery
    const K = KEEP, F2 = h + K.floor2, R = h + K.roof, fa = K.front + 0.06;
    const faceRot = alongX ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    box(parts.glow, fa, h + K.frontDoor.h, 0, 0.12, 0.18, K.frontDoor.p[1] * 2 + 0.3);
    for (const s of [-1, 1]) box(parts.glow, fa, h - 1, (K.frontDoor.p[1] + 0.05) * s, 0.12, K.frontDoor.h + 1, 0.18);
    for (const s of [-1, 1]) {
      const pf = (K.half + 0.06) * s, [d0, d1] = K.sideDoor.a;
      box(parts.glow, (d0 + d1) / 2, h + K.sideDoor.h, pf, d1 - d0 + 0.3, 0.18, 0.12);
      for (const ae of [d0 - 0.05, d1 + 0.05]) box(parts.glow, ae, h - 1, pf, 0.18, K.sideDoor.h + 1, 0.12);
      // Team trim around the top of the walls, just under the parapet
      box(parts.glow, (K.back + K.front) / 2, R - 0.5, (K.half + 0.06) * s, K.front - K.back, 0.25, 0.12);
    }
    box(parts.glow, fa, R - 0.5, 0, 0.12, 0.25, K.half * 2);
    box(parts.glow, K.back - 0.06, R - 0.5, 0, 0.12, 0.25, K.half * 2);
    // Emblems: plaques beside the door and a large one between the upper windows
    const emblem = (a, y, p, w, ht) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), new THREE.MeshLambertMaterial({ map: emblemTexture(team) }));
      const [x, z] = toWorld(a, p);
      m.position.set(x, y, z);
      m.rotation.y = faceRot;
      group.add(m);
    };
    emblem(fa + 0.02, h + 2.8, -5.3, 2.2, 4.4);
    emblem(fa + 0.02, h + 2.8, 5.3, 2.2, 4.4);
    emblem(fa + 0.02, h + 9.7, 0, 3.6, 5.8);
    // Floodlights under the parapet at the front corners
    for (const s of [-1, 1]) box(parts.white, fa + 0.2, R - 1.5, 13 * s, 0.3, 0.4, 0.8);
    // Ceiling light strips on both floors
    const ceil1 = F2 - K.slab - 0.12, ceil2 = R - K.slab - 0.12;
    for (const s of [-1, 1]) {
      box(parts.white, -26, ceil1, 4.8 * s, 14, 0.12, 0.3); // hall
      box(parts.white, -26, ceil1, 12.5 * s, 14, 0.12, 0.3); // side corridors
      box(parts.white, -39.5, ceil1, 7 * s, 6, 0.12, 0.3); // generator room
      box(parts.white, -26, ceil2, 5 * s, 14, 0.12, 0.3); // gallery
      box(parts.white, -39.5, ceil2, 6 * s, 6, 0.12, 0.3); // control room
    }
    // Jet shaft: glowing rims at each level and a faint column of light up through it
    const [sa0, sa1] = K.shaft.a, [sp0, sp1] = K.shaft.p, sam = (sa0 + sa1) / 2;
    for (const y of [h, F2, R]) {
      for (const ae of [sa0 - 0.12, sa1 + 0.12]) box(parts.glow, ae, y, 0, 0.24, 0.07, sp1 - sp0 + 0.48);
      for (const pe of [sp0 - 0.12, sp1 + 0.12]) box(parts.glow, sam, y, pe, sa1 - sa0, 0.07, 0.24);
    }
    {
      const colH = R - h + 3;
      const column = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, colH, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const [cx, cz] = toWorld(sam, 0);
      column.position.set(cx, h + colH / 2, cz);
      group.add(column);
    }
    // Warm light in each room, from the ceiling strips (no shadows; walls are thick enough)
    for (const [a, y] of [[-25, h + 3.8], [-39.5, h + 3.8], [-25, F2 + 3.8], [-39.5, F2 + 3.8]]) {
      const light = new THREE.PointLight(0xffe9cc, 38, 24, 1.6);
      const [x, z] = toWorld(a, 0);
      light.position.set(x, y, z);
      group.add(light);
    }
    // Lit nosing along the front edge of every step
    for (const s of [-1, 1]) {
      const [s0, s1] = K.stairs;
      for (let k = 0; k < K.steps; k++) box(parts.window, K.stairFoot - k - 0.05, h + K.rise * (k + 1) - 0.05, s * (s0 + s1) / 2, 0.1, 0.06, s1 - s0);
    }
    // Generator room: a glowing ring on the floor, pipes along the back wall, machinery in the corners
    {
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.0, 48), glow);
      const [rx, rz] = toWorld(-39.5, 0);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(rx, h + 0.03, rz);
      group.add(ring);
      for (const y of [h + 4.4, h + 5.1]) {
        const [x0, z0] = toWorld(K.back + 1.4, 0);
        const g = new THREE.CylinderGeometry(0.16, 0.16, K.half * 2 - 2, 8);
        if (alongX) g.rotateX(Math.PI / 2); else g.rotateZ(Math.PI / 2);
        parts.dark.push(painted(g.translate(x0, y, z0), 0xffffff));
      }
      for (const s of [-1, 1]) {
        box(parts.dark, -41.6, h, 11 * s, 1.8, 3.4, 2.6);
        box(parts.window, -40.66, h + 2.2, 11 * s, 0.06, 0.3, 1.6);
      }
    }

    // Towers: armour bands, glowing window strips near the top, corner buttresses
    for (const s of [-1, 1]) {
      const pc = 22 * s;
      for (const y of [h + 2, h + 10, h + 18]) box(parts.dark, 0, y, pc, 6.35, 1.1, 6.35);
      for (const [fa, fp, sa, sp] of [[3.06, 0, 0.1, 4], [-3.06, 0, 0.1, 4], [0, 3.06, 4, 0.1], [0, -3.06, 4, 0.1]]) {
        box(parts.window, fa, h + 21.2, pc + fp, sa, 0.45, sp);
        box(parts.window, fa, h + 13.2, pc + fp, sa * 0.6 || 0.1, 0.3, sp * 0.6 || 0.1);
      }
      for (const ca of [-1, 1]) for (const cp of [-1, 1]) box(parts.dark, 3.4 * ca, h - 1, pc + 3.4 * cp, 1.1, 3.2, 1.1);
    }
    // Keep roof: vents and a rotating radar dish
    box(parts.dark, -38, R, 7, 2.2, 1.1, 2.2);
    box(parts.dark, -21, R, -9, 1.2, 0.7, 1.6);
    box(parts.dark, -21, R, 9, 1.2, 0.7, 1.6);
    {
      const [rx, rz] = toWorld(-40, -9);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.4, 8), darkMat);
      mast.position.set(rx, R + 1.2, rz);
      const dishPivot = new THREE.Group();
      dishPivot.position.set(rx, R + 2.5, rz);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), new THREE.MeshLambertMaterial({ color: 0xd9dde3, side: THREE.DoubleSide }));
      dish.rotation.x = Math.PI / 2 + 0.5;
      const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), darkMat);
      feed.rotation.x = Math.PI / 2 + 0.5; feed.position.set(0, 0.25, -0.5);
      dishPivot.add(dish, feed);
      group.add(mast, dishPivot);
      spinners.push(dishPivot);
    }
    // Force fields across the three doorways (visual only)
    {
      const fieldMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, color: { value: new THREE.Color(TEAM_COLORS[team]) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float time; uniform vec3 color; varying vec2 vUv;
          void main() {
            float lines = 0.5 + 0.5 * sin(vUv.y * 60.0 - time * 4.0);
            float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
            float a = (0.08 + 0.12 * lines + 0.1 * sin(time * 2.0 + vUv.x * 9.0)) * edge + (1.0 - edge) * 0.35;
            gl_FragColor = vec4(color, a);
          }`,
      });
      fields.push(fieldMat);
      const field = (a, p, w, ht, acrossA) => {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), fieldMat);
        const [x, z] = toWorld(a, p);
        f.position.set(x, h + ht / 2, z);
        f.rotation.y = (alongX === acrossA) ? Math.PI / 2 : 0;
        group.add(f);
      };
      field(K.front - K.wall / 2, 0, K.frontDoor.p[1] * 2, K.frontDoor.h, true);
      for (const s of [-1, 1]) field((K.sideDoor.a[0] + K.sideDoor.a[1]) / 2, (K.half - K.wall / 2) * s, K.sideDoor.a[1] - K.sideDoor.a[0], K.sideDoor.h, false);
    }
    // Stepped plinth surround with three energy pylons
    box(parts.dark, 0, h - 0.6, 0, 9.6, 0.9, 9.6);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const pa = Math.cos(a) * 5.8, pp = Math.sin(a) * 5.8;
      box(parts.dark, pa, h - 0.2, pp, 0.35, 3.2, 0.35);
      box(parts.glow, pa, h + 3.0, pp, 0.5, 0.5, 0.5);
    }
    // Floodlight cones from the tower decks down toward the flag
    for (const s of [-1, 1]) {
      const [lx, lz] = toWorld(4.6, 22 * s - 3 * s);
      const from = new THREE.Vector3(lx, h + 23.7, lz), to = new THREE.Vector3(wx, h, wz);
      const len = from.distanceTo(to);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.5, len, 20, 1, true).translate(0, -len / 2, 0),
        new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone.position.copy(from);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      group.add(cone);
      box(parts.white, 4.6, h + 23.6, 22 * s - 3 * s, 0.6, 0.4, 0.6); // hangs under the deck edge
    }

    const add = (list, mat) => { if (list.length) group.add(new THREE.Mesh(merge(list), mat)); };
    add(parts.window, windowGlow);
    add(parts.dark, darkMat); add(parts.rail, railMat); add(parts.glow, glow); add(parts.white, whiteGlow);
  }
  group.userData.beacons = beacons;
  group.userData.animate = (t) => {
    for (const s of spinners) s.rotation.y = t * 0.8;
    for (const f of fields) f.uniforms.time.value = t;
  };
  return group;
}
