import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEAM_COLORS } from '../shared/world.js';
import { metalTexture, softTexture } from './textures.js';
import { library, WEAPON_MODELS } from './assets3d.js';

// First-person weapons, each held by armoured gauntlets. Model space: -Z is
// forward, origin near the trigger hand. Every model exposes
//   userData.muzzle  local muzzle point (for the flash)
//   userData.animate(dt, state)  per-frame animation

const geoCache = new Map();
function rb(w, h, d, r = 0.02) {
  const key = `${w},${h},${d},${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)));
  return geoCache.get(key);
}
function at(mesh, x, y, z, rx = 0, ry = 0, rz = 0) { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); return mesh; }
const M = (geo, mat) => new THREE.Mesh(geo, mat);
// Cylinder lying along Z
const tube = (r1, r2, len, seg = 16) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2);
const ring = (r, t, seg = 24) => new THREE.TorusGeometry(r, t, 8, seg);

function materials(team) {
  const metal = metalTexture();
  const tc = new THREE.Color(TEAM_COLORS[team]);
  return {
    hue: team ? tc.getHSL({}).h : null,
    gun: new THREE.MeshStandardMaterial({ color: 0x59616c, map: metal, metalness: 0.55, roughness: 0.42 }),
    alloy: new THREE.MeshStandardMaterial({ color: 0xb9c0c9, map: metal, metalness: 0.85, roughness: 0.28 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.85, metalness: 0 }),
    team: new THREE.MeshStandardMaterial({ color: tc, metalness: 0.35, roughness: 0.45, emissive: tc, emissiveIntensity: 0.12 }),
    teamGlow: new THREE.MeshBasicMaterial({ color: tc.clone().lerp(new THREE.Color(0xffffff), 0.3) }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.05 }),
    glow: (c) => new THREE.MeshBasicMaterial({ color: c }),
  };
}

// Armoured gauntlet: palm block, finger plates, knuckle guard in team colour
function gauntlet(m, left) {
  const g = new THREE.Group();
  g.add(at(M(rb(0.1, 0.09, 0.13, 0.025), m.rubber), 0, 0, 0));
  g.add(at(M(rb(0.105, 0.035, 0.07, 0.012), m.team), 0, 0.05, -0.02));
  for (let i = 0; i < 4; i++) g.add(at(M(rb(0.022, 0.028, 0.07, 0.008), m.alloy), -0.036 + i * 0.024, -0.045, -0.05, 0.6, 0, 0));
  if (left) g.scale.x = -1;
  return g;
}

function flash(color, size) {
  const mat = new THREE.MeshBasicMaterial({ map: softTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  // Two long crossed planes along the barrel axis plus a face-on burst
  const g = new THREE.Group();
  const vertical = M(new THREE.PlaneGeometry(size * 2.2, size), mat);
  vertical.rotation.y = Math.PI / 2;
  const flat = M(new THREE.PlaneGeometry(size, size * 2.2), mat);
  flat.rotation.x = Math.PI / 2;
  g.add(vertical, flat, M(new THREE.PlaneGeometry(size * 1.4, size * 1.4), mat));
  g.visible = false;
  return g;
}

function finish(g, muzzle, flashColor, flashSize, animate) {
  const f = flash(flashColor, flashSize);
  f.position.copy(muzzle);
  f.position.z -= flashSize * 0.8; // centre the burst just past the muzzle
  g.add(f);
  g.userData = { muzzle, flash: f, animate };
  return g;
}

// ---------- the six weapons ----------

// AI-generated weapon (scripts/generate-models.js); the blocky procedural gauntlets
// clash with its detail, so it's shown on its own.
// Scaled to at most 1 m in view, its back end near the hand and turned a little
// so its side shows; the muzzle flash sits at its front tip.
// Muzzle flash colour and size per weapon id, as on the procedural models
const FLASH = [[0x9fe0ff, 0.22], [0xffd27a, 0.16], [0xffb070, 0.24], [0xff7a3a, 0.24], [0x9affdc, 0.4], [0xff3050, 0.18]];

function generatedWeapon(w, m) {
  const id = WEAPON_MODELS[w];
  const body = id && library.instance(id, { hue: m.hue });
  if (!body) return null;
  const [, h, len] = library.dims(id);
  const k = Math.min(1, 1 / len), ry = 0.35;
  const g = new THREE.Group();
  body.scale.setScalar(k);
  body.position.set(0.02, -0.24, 0.2 - len * k / 2);
  body.rotation.y = ry;
  g.add(body);
  const muzzle = new THREE.Vector3(-Math.sin(ry), 0, -Math.cos(ry)).multiplyScalar(len * k / 2).add(body.position);
  muzzle.y += h * k * 0.55;
  return finish(g, muzzle, FLASH[w][0], FLASH[w][1], () => {});
}

function discLauncher(m) {
  const g = new THREE.Group();
  g.add(at(M(rb(0.17, 0.18, 0.62, 0.035), m.gun), 0, 0.02, -0.12));
  g.add(at(M(rb(0.19, 0.06, 0.4, 0.02), m.alloy), 0, -0.08, -0.16));
  // Disc chamber: flat drum with a glass lid and a spinning disc inside
  const chamber = new THREE.Group(); chamber.position.set(0, 0.16, -0.14); g.add(chamber);
  chamber.add(M(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 32), m.gun));
  chamber.add(at(M(new THREE.CylinderGeometry(0.155, 0.155, 0.04, 32), m.glass), 0, 0.045, 0));
  chamber.add(at(M(ring(0.165, 0.012, 40), m.teamGlow), 0, 0.03, 0, Math.PI / 2));
  const disc = new THREE.Group(); disc.position.y = 0.04; chamber.add(disc);
  const discGlow = m.glow(0xbfeaff);
  disc.add(M(new THREE.CylinderGeometry(0.12, 0.12, 0.018, 32), m.alloy));
  disc.add(at(M(ring(0.1, 0.008, 32), discGlow), 0, 0.011, 0, Math.PI / 2));
  for (let i = 0; i < 3; i++) disc.add(at(M(rb(0.13, 0.006, 0.018, 0.002), discGlow), 0, 0.012, 0, 0, i * Math.PI / 3));
  // Flared muzzle with an inner glow ring
  g.add(at(M(tube(0.11, 0.085, 0.2, 24), m.alloy), 0, 0.03, -0.5));
  g.add(at(M(ring(0.092, 0.012, 32), m.glow(0x9fe0ff)), 0, 0.03, -0.6));
  g.add(at(M(tube(0.075, 0.075, 0.05, 20), m.rubber), 0, 0.03, -0.39));
  for (const s of [-1, 1]) g.add(at(M(rb(0.012, 0.03, 0.42, 0.005), m.teamGlow), 0.088 * s, 0.03, -0.14));
  g.add(at(M(rb(0.08, 0.19, 0.1, 0.02), m.rubber), 0, -0.16, 0.08, 0.28));
  g.add(at(M(rb(0.07, 0.13, 0.08, 0.02), m.rubber), 0, -0.15, -0.34, -0.1));
  g.add(at(gauntlet(m), 0.0, -0.13, 0.08, 0.25));
  g.add(at(gauntlet(m, true), 0.0, -0.11, -0.34, 0.05, 0, 0));
  return finish(g, new THREE.Vector3(0, 0.03, -0.62), 0x9fe0ff, 0.22, (dt, s) => {
    const ready = s.since > s.refire * 0.6;
    disc.visible = ready;
    disc.rotation.y += dt * (ready ? 9 : 0);
    discGlow.color.setHSL(0.55, 0.9, ready ? 0.82 : 0.55 + 0.25 * Math.sin(s.now * 18));
  });
}

function chaingun(m) {
  const g = new THREE.Group();
  g.add(at(M(rb(0.2, 0.2, 0.36, 0.04), m.gun), 0, 0, 0.0));
  g.add(at(M(rb(0.16, 0.05, 0.3, 0.02), m.alloy), 0, 0.12, 0.0));
  // Carry handle
  g.add(at(M(rb(0.03, 0.03, 0.22, 0.01), m.gun), 0, 0.2, -0.02));
  for (const z of [-0.1, 0.07]) g.add(at(M(rb(0.03, 0.08, 0.03, 0.01), m.gun), 0, 0.16, z));
  // Ammo drum on the left
  g.add(at(M(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 24).rotateZ(Math.PI / 2), m.gun), -0.15, -0.03, 0.02));
  g.add(at(M(ring(0.12, 0.01, 30), m.teamGlow), -0.21, -0.03, 0.02, 0, Math.PI / 2));
  // Spinning barrel cluster with clamps; barrels glow as they heat up
  const heat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, metalness: 0.8, roughness: 0.35, emissive: 0xff5a10, emissiveIntensity: 0 });
  const spin = new THREE.Group(); spin.position.set(0, 0, -0.42); g.add(spin);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spin.add(at(M(tube(0.021, 0.021, 0.62, 10), heat), Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0));
  }
  for (const z of [-0.26, 0.05, 0.26]) spin.add(at(M(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 20).rotateX(Math.PI / 2), m.alloy), 0, 0, z));
  g.add(at(M(tube(0.09, 0.1, 0.1, 20), m.gun), 0, 0, -0.17));
  g.add(at(M(rb(0.08, 0.2, 0.1, 0.02), m.rubber), 0, -0.17, 0.12, 0.25));
  g.add(at(gauntlet(m), 0, -0.14, 0.12, 0.25));
  g.add(at(gauntlet(m, true), 0, -0.15, -0.2, 0.1));
  let spinSpeed = 0, temp = 0;
  return finish(g, new THREE.Vector3(0, 0, -0.75), 0xffd27a, 0.16, (dt, s) => {
    const want = s.firing ? 38 : 0;
    spinSpeed += (want - spinSpeed) * Math.min(1, dt * (s.firing ? 4 : 1.5));
    spin.rotation.z += spinSpeed * dt;
    temp = Math.max(0, Math.min(1, temp + (s.firing ? dt * 0.35 : -dt * 0.25)));
    heat.emissiveIntensity = temp * temp * 1.4;
  });
}

function grenadeLauncher(m) {
  const g = new THREE.Group();
  g.add(at(M(rb(0.16, 0.16, 0.4, 0.035), m.gun), 0, 0, 0.0));
  // Revolving six-shot drum
  const drum = new THREE.Group(); drum.position.set(0, -0.02, -0.25); g.add(drum);
  drum.add(M(tube(0.14, 0.14, 0.2, 6), m.alloy));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    drum.add(at(M(tube(0.035, 0.035, 0.205, 12), m.rubber), Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0));
  }
  g.add(at(M(tube(0.085, 0.08, 0.36, 20), m.gun), 0, 0.03, -0.52));
  g.add(at(M(ring(0.085, 0.012, 24), m.teamGlow), 0, 0.03, -0.7));
  for (const sx of [-1, 1]) g.add(at(M(rb(0.01, 0.025, 0.26, 0.004), m.glow(0x9cff7a)), 0.082 * sx, 0.02, -0.02));
  // Flip-up ladder sight
  g.add(at(M(rb(0.06, 0.07, 0.01, 0.003), m.alloy), 0, 0.13, -0.4));
  g.add(at(M(rb(0.08, 0.19, 0.1, 0.02), m.rubber), 0, -0.16, 0.12, 0.28));
  g.add(at(gauntlet(m), 0, -0.13, 0.12, 0.25));
  g.add(at(gauntlet(m, true), 0, -0.12, -0.5, 0.05));
  let shots = 0, angle = 0;
  return finish(g, new THREE.Vector3(0, 0.03, -0.72), 0xffb070, 0.24, (dt, s) => {
    if (s.justFired) shots++;
    const target = shots * (Math.PI / 3);
    angle += (target - angle) * Math.min(1, dt * 14);
    drum.rotation.z = angle;
  });
}

function plasmaRifle(m) {
  const g = new THREE.Group();
  g.add(at(M(rb(0.13, 0.15, 0.7, 0.035), m.gun), 0, 0, -0.18));
  g.add(at(M(rb(0.09, 0.05, 0.6, 0.02), m.alloy), 0, -0.09, -0.2));
  // Glowing energy cell on top
  const cellMat = m.glow(0xff7a3a);
  g.add(at(M(tube(0.035, 0.035, 0.24, 14), m.glass), 0, 0.11, -0.05));
  g.add(at(M(tube(0.022, 0.022, 0.22, 10), cellMat), 0, 0.11, -0.05));
  // Accelerator coils along the barrel
  const coils = [];
  for (let i = 0; i < 4; i++) {
    const mat = m.glow(0xff6a3a);
    coils.push(mat);
    g.add(at(M(ring(0.062, 0.009, 24), mat), 0, 0, -0.36 - i * 0.12));
  }
  g.add(at(M(tube(0.04, 0.05, 0.34, 14), m.alloy), 0, 0, -0.5));
  g.add(at(M(rb(0.08, 0.19, 0.1, 0.02), m.rubber), 0, -0.16, 0.1, 0.28));
  g.add(at(M(rb(0.12, 0.05, 0.24, 0.015), m.team), 0, -0.05, 0.12));
  g.add(at(gauntlet(m), 0, -0.13, 0.1, 0.25));
  g.add(at(gauntlet(m, true), 0, -0.1, -0.32, 0.05));
  return finish(g, new THREE.Vector3(0, 0, -0.7), 0xff7a3a, 0.24, (dt, s) => {
    // Coils light in sequence while recharging, all bright when ready
    const k = Math.min(1, s.since / s.refire);
    coils.forEach((c, i) => {
      const lit = k >= (i + 1) / 4;
      c.color.setRGB(lit ? 1 : 0.22, lit ? 0.42 + 0.1 * Math.sin(s.now * 9 + i) : 0.08, lit ? 0.18 : 0.05);
    });
    cellMat.color.setRGB(1, 0.45 + 0.15 * Math.sin(s.now * 5), 0.2);
  });
}

function mortar(m) {
  const g = new THREE.Group();
  g.add(at(M(tube(0.145, 0.16, 0.7, 24), m.gun), 0, 0.04, -0.25));
  for (const z of [-0.5, -0.36, -0.22]) g.add(at(M(tube(0.165, 0.165, 0.04, 24), m.alloy), 0, 0.04, z));
  g.add(at(M(ring(0.135, 0.014, 32), m.glow(0x7affd0)), 0, 0.04, -0.6));
  // Breech block with a glowing loading ring
  g.add(at(M(rb(0.27, 0.25, 0.26, 0.05), m.gun), 0, 0.03, 0.15));
  const breech = m.glow(0x7affd0);
  g.add(at(M(rb(0.12, 0.02, 0.05, 0.008), breech), 0, 0.165, 0.2));
  g.add(at(M(rb(0.04, 0.04, 0.28, 0.015), m.alloy), 0, 0.22, -0.1));
  for (const z of [-0.2, 0.0]) g.add(at(M(rb(0.035, 0.07, 0.035, 0.01), m.alloy), 0, 0.17, z));
  g.add(at(M(rb(0.29, 0.06, 0.2, 0.02), m.team), 0, -0.12, 0.15));
  g.add(at(M(rb(0.08, 0.2, 0.1, 0.02), m.rubber), 0.04, -0.2, 0.12, 0.28));
  g.add(at(gauntlet(m), 0.04, -0.17, 0.12, 0.25));
  g.add(at(gauntlet(m, true), 0, -0.17, -0.3, 0.1));
  return finish(g, new THREE.Vector3(0, 0.04, -0.62), 0x9affdc, 0.4, (dt, s) => {
    const k = Math.min(1, s.since / s.refire);
    breech.color.setRGB(0.48 * k, k, 0.82 * k);
  });
}

function laserRifle(m) {
  const g = new THREE.Group();
  g.add(at(M(rb(0.09, 0.13, 0.6, 0.03), m.gun), 0, 0, 0.0));
  g.add(at(M(rb(0.07, 0.11, 0.26, 0.025), m.rubber), 0, -0.02, 0.38)); // stock
  g.add(at(M(tube(0.024, 0.026, 0.72, 12), m.alloy), 0, 0.02, -0.62));
  g.add(at(M(tube(0.04, 0.04, 0.06, 14), m.gun), 0, 0.02, -0.98));
  for (let i = 0; i < 5; i++) g.add(at(M(tube(0.034, 0.034, 0.012, 12), m.gun), 0, 0.02, -0.36 - i * 0.1));
  // Scope
  g.add(at(M(tube(0.032, 0.032, 0.3, 16), m.gun), 0, 0.12, -0.04));
  g.add(at(M(tube(0.04, 0.032, 0.05, 16), m.gun), 0, 0.12, -0.2));
  g.add(at(M(new THREE.CircleGeometry(0.03, 16), m.glow(0xff3050)), 0, 0.12, -0.226));
  for (const z of [-0.12, 0.05]) g.add(at(M(rb(0.025, 0.05, 0.025, 0.008), m.gun), 0, 0.075, z));
  // Charge cell: fills with energy
  const cellMat = m.glow(0xff3050);
  g.add(at(M(rb(0.1, 0.04, 0.2, 0.01), m.glass), 0, -0.08, -0.12));
  const cell = at(M(rb(0.08, 0.025, 0.18, 0.008), cellMat), 0, -0.08, -0.12);
  g.add(cell);
  g.add(at(M(rb(0.07, 0.17, 0.09, 0.02), m.rubber), 0, -0.15, 0.12, 0.3));
  g.add(at(gauntlet(m), 0, -0.12, 0.12, 0.25));
  g.add(at(gauntlet(m, true), 0, -0.09, -0.4, 0.05));
  return finish(g, new THREE.Vector3(0, 0.02, -1.0), 0xff3050, 0.18, (dt, s) => {
    const k = Math.max(0.05, Math.min(1, s.energy / s.energyCost));
    cell.scale.z = k;
    cell.position.z = -0.12 + (1 - k) * 0.09;
    cellMat.color.setRGB(k >= 1 ? 1 : 0.5, k >= 1 ? 0.2 + 0.1 * Math.sin(s.now * 10) : 0.1, k >= 1 ? 0.32 : 0.15);
  });
}

const BUILDERS = [discLauncher, chaingun, grenadeLauncher, plasmaRifle, mortar, laserRifle];

// Indexed by weapon id
export function createViewModels(team = 0) {
  const m = materials(team);
  return BUILDERS.map((b, i) => {
    const g = generatedWeapon(i, m) || b(m);
    g.scale.setScalar(0.62);
    g.visible = false;
    return g;
  });
}
