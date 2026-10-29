import * as THREE from 'three';
import { TEAM_COLORS } from '../shared/world.js';
import { ARMORS } from '../shared/physics.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { metalTexture } from './textures.js';
import { library, CharacterRig, WEAPON_MODELS } from './assets3d.js';

// The other team gets the generated models' orange accents rotated to its own hue
const TEAM_HUE = [null, new THREE.Color(TEAM_COLORS[1]).getHSL({}).h];
const CLASS_NAMES = ['light', 'medium', 'heavy'];

// Slightly rounded edges catch the light, so even simple props read as machined parts
const box = (w, h, d, mat) => new THREE.Mesh(plate(w, h, d, Math.min(0.04, Math.min(w, h, d) * 0.2)), mat);

function flameMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
}

// Power armour proportions per class: [width, height, depth] of each plate
const SPEC = [
  { // Light: slim scout with a long visor and a finned helmet
    legX: 0.13, chest: [0.56, 0.36, 0.34], abd: [0.38, 0.22, 0.26], pad: [0.24, 0.15, 0.34],
    thigh: [0.19, 0.48, 0.22], shin: [0.18, 0.46, 0.21], boot: [0.22, 0.12, 0.36],
    helm: [0.27, 0.29, 0.38], headY: 0.88, pack: [0.36, 0.46, 0.16], nozzles: [-0.1, 0.1], nozR: 0.06,
  },
  { // Medium: balanced trooper
    legX: 0.15, chest: [0.68, 0.42, 0.42], abd: [0.44, 0.24, 0.3], pad: [0.34, 0.21, 0.46],
    thigh: [0.23, 0.5, 0.27], shin: [0.21, 0.46, 0.25], boot: [0.26, 0.14, 0.42],
    helm: [0.31, 0.32, 0.38], headY: 0.9, pack: [0.5, 0.56, 0.24], nozzles: [-0.15, 0.15], nozR: 0.09,
  },
  { // Heavy: wide chest, huge pauldrons, head sunk between the shoulders, four-nozzle pack
    legX: 0.19, chest: [0.84, 0.5, 0.52], abd: [0.54, 0.26, 0.38], pad: [0.46, 0.33, 0.6],
    thigh: [0.28, 0.5, 0.32], shin: [0.27, 0.46, 0.31], boot: [0.33, 0.16, 0.5],
    helm: [0.34, 0.3, 0.38], headY: 0.84, pack: [0.74, 0.64, 0.32], nozzles: [-0.27, -0.09, 0.09, 0.27], nozR: 0.1,
  },
];

const geoCache = new Map();
// Rounded plate, cached since every player reuses the same shapes
function plate(w, h, d, r = 0.05) {
  const key = `${w},${h},${d},${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)));
  return geoCache.get(key);
}
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

// Power armour. Origin at the feet, facing -Z. Animation hooks live in userData.
export function createArmor(team, armor = 1) {
  const gen = generatedArmor(team, armor);
  if (gen) return gen;
  const S = SPEC[armor];
  const root = new THREE.Group();
  const tc = new THREE.Color(TEAM_COLORS[team]);
  const metal = metalTexture();
  const teamMat = new THREE.MeshLambertMaterial({ color: tc, emissive: tc, emissiveIntensity: 0.15 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x5d646d, map: metal });
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xd6dbe2, map: metal });
  const glowMat = new THREE.MeshBasicMaterial({ color: tc.clone().lerp(new THREE.Color(0xffffff), 0.35) });
  const visorMat = new THREE.MeshBasicMaterial({ color: team === 0 ? 0xffd08a : 0xa8f2ff });

  const body = new THREE.Group();
  body.scale.set(1, ARMORS[armor].scale[1], 1);
  root.add(body);

  // Legs: thigh, knee pivot with a team knee pad, shin, boot
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  hips.add(mesh(plate(S.abd[0] * 1.05, 0.2, S.abd[2]), darkMat));
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.x = S.legX * s; hips.add(leg);
    leg.add(mesh(plate(...S.thigh, 0.06), darkMat, 0, -0.25, 0));
    const knee = new THREE.Group(); knee.position.y = -0.5; leg.add(knee);
    knee.add(mesh(plate(S.shin[0] * 0.95, 0.15, 0.1, 0.04), teamMat, 0, -0.02, -S.shin[2] / 2 - 0.03));
    knee.add(mesh(plate(...S.shin, 0.06), lightMat, 0, -0.23, 0));
    knee.add(mesh(plate(...S.boot, 0.05), darkMat, 0, -0.44, -0.06));
    legs.push({ leg, knee });
  }

  // Torso: abdomen, team chest shell, light breastplate with a glow strip, collar
  const upper = new THREE.Group(); upper.position.y = 0.1; hips.add(upper);
  const [cw, ch, cd] = S.chest;
  upper.add(mesh(plate(...S.abd, 0.06), darkMat, 0, 0.14, 0));
  upper.add(mesh(plate(cw, ch, cd, 0.09), teamMat, 0, 0.44, 0));
  upper.add(mesh(plate(cw * 0.7, ch * 0.62, 0.07, 0.03), lightMat, 0, 0.46, -cd / 2 - 0.01));
  upper.add(mesh(plate(cw * 0.42, 0.035, 0.02, 0.01), glowMat, 0, 0.5, -cd / 2 - 0.05));
  upper.add(mesh(plate(cw * 0.55, 0.08, cd * 0.7, 0.03), darkMat, 0, 0.69, 0));

  // Pauldrons with glowing trim
  const [pw, ph, pd] = S.pad;
  for (const s of [-1, 1]) {
    const pad = mesh(plate(pw, ph, pd, 0.07), teamMat, (cw / 2 + pw / 2 - 0.08) * s, 0.63, 0);
    pad.rotation.z = -0.22 * s;
    pad.add(mesh(plate(pw * 0.9, 0.03, pd * 1.02, 0.01), glowMat, 0, -ph / 2 + 0.03, 0));
    upper.add(pad);
  }

  // Head
  const head = new THREE.Group(); head.position.y = S.headY; upper.add(head);
  const [hw, hh, hd] = S.helm;
  head.add(mesh(plate(hw, hh, hd, 0.1), lightMat));
  head.add(mesh(plate(hw * 0.86, armor === 0 ? 0.06 : 0.075, 0.05, 0.02), visorMat, 0, 0.02, -hd / 2 - 0.005));
  if (armor === 0) head.add(mesh(plate(0.035, 0.13, hd * 0.85, 0.015), teamMat, 0, hh / 2 + 0.05, 0.02));
  if (armor === 1) {
    head.add(mesh(plate(0.07, 0.07, hd * 0.9, 0.02), teamMat, 0, hh / 2 + 0.02, 0));
    head.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), darkMat, hw / 2 + 0.02, 0.2, 0.08));
  }
  if (armor === 2) head.add(mesh(plate(hw * 1.08, 0.13, hd * 0.6, 0.04), darkMat, 0, -0.12, -0.07));

  // Jetpack with glowing vents and one flame per nozzle
  const [jw, jh, jd] = S.pack;
  const packZ = cd / 2 + jd / 2 - 0.03;
  upper.add(mesh(plate(jw, jh, jd, 0.07), darkMat, 0, 0.44, packZ));
  upper.add(mesh(plate(jw * 0.6, 0.035, 0.02, 0.01), glowMat, 0, 0.56, packZ + jd / 2 + 0.01));
  upper.add(mesh(plate(jw * 0.6, 0.035, 0.02, 0.01), glowMat, 0, 0.48, packZ + jd / 2 + 0.01));
  const flames = [];
  for (const x of S.nozzles) {
    upper.add(mesh(new THREE.CylinderGeometry(S.nozR * 0.8, S.nozR * 1.15, 0.16, 10), lightMat, x, 0.1, packZ));
    const flame = new THREE.Mesh(new THREE.ConeGeometry(S.nozR * 1.2, 0.9, 8, 1, true), flameMaterial());
    flame.rotation.x = Math.PI; flame.position.set(x, -0.45, packZ);
    upper.add(flame);
    flames.push(flame);
  }

  // Arms reaching forward to a two-handed rifle
  const arms = new THREE.Group(); arms.position.y = 0.6; upper.add(arms);
  for (const s of [-1, 1]) {
    const ux = (cw / 2 + 0.02) * s;
    const up = mesh(plate(0.14, 0.34, 0.15, 0.05), darkMat, ux, -0.12, -0.06); up.rotation.x = -0.55; arms.add(up);
    arms.add(mesh(plate(0.16, 0.15, 0.36, 0.05), lightMat, ux * 0.72, -0.26, -0.36));
  }
  arms.add(mesh(plate(0.12, 0.16, 0.8, 0.03), darkMat, 0.12, -0.2, -0.62));
  arms.add(mesh(plate(0.02, 0.05, 0.5, 0.01), glowMat, 0.19, -0.18, -0.62));
  const barrel = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), lightMat, 0.12, -0.17, -1.16);
  barrel.rotation.x = Math.PI / 2; arms.add(barrel);

  root.userData = { hips, upper, head, arms, legs, flames, phase: 0, armor };
  return root;
}

// AI-generated armour (scripts/generate-models.js) for classes that have one
function generatedArmor(team, armor) {
  const id = `soldier_${CLASS_NAMES[armor]}_ember`;
  if (!library.has(id)) return null;
  const root = library.instance(id, { hue: TEAM_HUE[team] });
  // Weapons in hand, offset so the grip (about a third from the back) sits in the palm
  const makeWeapon = (w) => {
    const gun = WEAPON_MODELS[w] && library.instance(WEAPON_MODELS[w], { hue: TEAM_HUE[team] });
    if (!gun) return null;
    gun.position.set(0, -0.13, -0.2 * library.dims(WEAPON_MODELS[w])[2]);
    return gun;
  };
  root.userData.rig = new CharacterRig(root, { flameMaterial: flameMaterial(), makeWeapon });
  root.userData.armor = armor;
  return root;
}

// Animate the armour from movement state
export function animateArmor(model, state, dt, time) {
  const u = model.userData;
  if (u.rig) { u.rig.update(dt, state); return; }
  const { speed, onGround, skiing, jetting, pitch } = state;
  const running = onGround && !skiing && speed > 0.5;
  u.phase += dt * (running ? Math.min(speed, 12) * 0.9 : 0);
  const swing = running ? Math.sin(u.phase) * 0.7 : 0;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    let hip = swing * s, knee = running ? Math.max(0, -Math.sin(u.phase + (i ? Math.PI : 0))) * 0.9 : 0;
    if (skiing) { hip = -0.35; knee = 0.6; }
    else if (!onGround) { hip = 0.25 * s - 0.15; knee = 0.35; }
    u.legs[i].leg.rotation.x += (hip - u.legs[i].leg.rotation.x) * Math.min(1, dt * 12);
    u.legs[i].knee.rotation.x += (knee - u.legs[i].knee.rotation.x) * Math.min(1, dt * 12);
  }
  u.hips.position.y = skiing ? 0.85 : 0.95;
  u.upper.rotation.x = skiing ? -0.25 : (!onGround ? -0.1 : 0);
  u.arms.rotation.x = pitch;
  u.head.rotation.x = pitch * 0.5;
  for (const f of u.flames) {
    f.visible = jetting;
    if (jetting) {
      const s = 0.8 + Math.random() * 0.5;
      f.scale.set(1, s, 1);
      f.position.y = -0.05 - 0.45 * s;
    }
  }
}

// ---------- vehicles & base objects ----------

export function createSkiff(team) {
  const gen = generatedSkiff(team);
  if (gen) return gen;
  const g = new THREE.Group();
  const metal = metalTexture();
  const tc = new THREE.Color(TEAM_COLORS[team]);
  const hull = new THREE.MeshLambertMaterial({ color: 0xd2d7de, map: metal });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3d434b, map: metal });
  const teamMat = new THREE.MeshLambertMaterial({ color: tc, emissive: tc, emissiveIntensity: 0.25 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.4, emissive: 0x1a3a50 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xa8e6ff });
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };
  const body = new THREE.Group(); g.add(body);

  // Hull: a wedge side-profile (nose at -Z) extruded across the width with bevelled edges
  const profile = new THREE.Shape();
  profile.moveTo(-2.5, 0.28);
  profile.quadraticCurveTo(-1.6, 0.62, -0.6, 0.78);
  profile.lineTo(1.3, 0.82);
  profile.lineTo(2.05, 0.68);
  profile.lineTo(2.1, 0.18);
  profile.quadraticCurveTo(0, 0.0, -1.9, 0.08);
  profile.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(profile, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 3, curveSegments: 10 });
  hullGeo.translate(0, 0, -0.6);
  hullGeo.rotateY(-Math.PI / 2); // profile x (nose at -2.5) -> world z, so the nose points forward
  // Taper the hull to a narrow nose
  const hp = hullGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const t = Math.min(1, Math.max(0, (hp.getZ(i) + 2.6) / 3.2));
    hp.setX(i, hp.getX(i) * (0.35 + 0.65 * Math.sqrt(t)));
  }
  hullGeo.computeVertexNormals();
  add(body, hullGeo, hull, 0, 0.1, 0);
  // Team stripe along the flanks and a dark belly
  for (const s of [-1, 1]) add(body, plate(0.04, 0.12, 3.4, 0.02), teamMat, 0.75 * s, 0.6, 0.1);
  add(body, plate(1.2, 0.12, 3.6, 0.05), dark, 0, 0.12, 0.1);

  // Cockpit: seat well and a glass canopy
  add(body, plate(0.8, 0.25, 1.2, 0.08), dark, 0, 0.92, 0.55);
  const canopy = add(body, new THREE.SphereGeometry(0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.88, -0.25);
  canopy.scale.set(0.95, 0.7, 1.45);

  // Engine pods: intake ring in front, glowing exhaust ring behind
  for (const s of [-1, 1]) {
    const pod = new THREE.Group(); pod.position.set(1.08 * s, 0.38, 0.35); body.add(pod);
    add(pod, new THREE.CylinderGeometry(0.3, 0.34, 2.2, 18).rotateX(Math.PI / 2), dark);
    add(pod, new THREE.TorusGeometry(0.3, 0.05, 8, 24), hull, 0, 0, -1.12);
    add(pod, new THREE.CircleGeometry(0.27, 18), new THREE.MeshBasicMaterial({ color: 0x0c1014 }), 0, 0, -1.1, Math.PI);
    add(pod, new THREE.TorusGeometry(0.29, 0.045, 8, 24), glow, 0, 0, 1.12);
    add(pod, plate(0.08, 0.12, 1.6, 0.03), teamMat, 0, 0.3, 0.1);
    // Pylon to the hull
    add(pod, plate(0.36, 0.12, 0.9, 0.04), hull, -0.3 * s, 0.05, 0.1);
    // Hover pad glowing underneath
    add(pod, new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), 0, -0.35, 0.1, Math.PI / 2);
  }
  // Tail fins in team colour
  for (const s of [-1, 1]) add(body, plate(0.06, 0.7, 0.9, 0.03), teamMat, 0.42 * s, 1.15, 1.75, 0.35, 0, 0.32 * s);

  // Exhaust: group whose local +Y points backwards, so scaling Y stretches the flames
  const exhaust = new THREE.Group();
  exhaust.position.set(0, 0.38, 1.5);
  exhaust.rotation.x = Math.PI / 2;
  body.add(exhaust);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.4, 12, 1, true).rotateX(Math.PI).translate(0, 0.7, 0), flameMat);
    cone.position.set(1.08 * s, 0, 0);
    exhaust.add(cone);
  }
  g.userData = { body, exhaust };
  return g;
}

// Exhaust flames: group whose local +Y points backwards, so scaling Y stretches them
function skiffExhaust(x, y, z, spread, radius) {
  const exhaust = new THREE.Group();
  exhaust.position.set(x, y, z);
  exhaust.rotation.x = Math.PI / 2;
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, 1.4, 12, 1, true).rotateX(Math.PI).translate(0, 0.7, 0), flameMat);
    cone.position.set(spread * s, 0, 0);
    exhaust.add(cone);
  }
  return exhaust;
}

// AI-generated skiff, hovering at the same height as the procedural one
function generatedSkiff(team) {
  const model = library.instance('skiff', { hue: TEAM_HUE[team] });
  if (!model) return null;
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  model.position.y = 0.1;
  body.add(model);
  const exhaust = skiffExhaust(0, 0.62, 2.45, 1.0, 0.24);
  body.add(exhaust);
  g.userData = { body, exhaust };
  return g;
}

// Emissive materials of a generated model, so its glow can go dark when unpowered
function glowMaterials(model) {
  const mats = [];
  model.traverse((o) => { if (o.isMesh && !mats.includes(o.material)) mats.push(o.material); });
  return mats;
}

export function createGenerator(team) {
  const g = new THREE.Group();
  const metal = metalTexture();
  const gen = library.instance('generator', { hue: TEAM_HUE[team], unique: true });
  const coreMat = new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] });
  if (gen) {
    // Generated housing, with the spinning status rings kept above it
    g.add(gen);
    const rings = [];
    const top = library.dims('generator')[1];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 6, 24), coreMat);
      r.rotation.x = Math.PI / 2; r.position.y = top + 0.3 + i * 0.35; g.add(r); rings.push(r);
    }
    const glowMats = glowMaterials(gen);
    g.userData = { rings, coreMat, color: new THREE.Color(TEAM_COLORS[team]), glowMats, glow: glowMats[0]?.emissiveIntensity ?? 1 };
    return g;
  }
  const base = box(2.6, 4.2, 3.4, new THREE.MeshLambertMaterial({ color: 0x8a9098, map: metal }));
  base.position.y = 2.1; g.add(base);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 6, 24), coreMat);
    r.rotation.x = Math.PI / 2; r.position.y = 4.5 + i * 0.35; g.add(r); rings.push(r);
  }
  for (const s of [-1, 1]) {
    const win = box(0.06, 2.6, 2.2, coreMat); win.position.set(1.31 * s, 2.2, 0); g.add(win);
  }
  g.userData = { rings, coreMat, color: new THREE.Color(TEAM_COLORS[team]) };
  return g;
}

export function createTurret(team) {
  const g = new THREE.Group();
  const metal = metalTexture();
  const dark = new THREE.MeshLambertMaterial({ color: 0x5a6068, map: metal });
  const light = new THREE.MeshLambertMaterial({ color: 0xb0b6be, map: metal });
  const head = new THREE.Group(); head.position.y = 0.6; g.add(head);
  const gen = library.instance('turret_head', { hue: TEAM_HUE[team], unique: true });
  if (gen) {
    // Generated head pitches as a whole about its middle
    const tilt = new THREE.Group(); tilt.position.y = 0.45; head.add(tilt);
    gen.position.y = -0.45;
    tilt.add(gen);
    const glowMats = glowMaterials(gen);
    g.userData = { head, tilt, eyeMat: new THREE.MeshBasicMaterial(), color: new THREE.Color(TEAM_COLORS[team]), glowMats, glow: glowMats[0]?.emissiveIntensity ?? 1 };
    return g;
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), light); head.add(dome);
  const tilt = new THREE.Group(); tilt.position.y = 0.35; head.add(tilt);
  for (const s of [-1, 1]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.8, 8), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0.25 * s, 0, -0.9); tilt.add(barrel);
  }
  const eye = box(0.35, 0.12, 0.05, new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
  eye.position.set(0, 0.25, -0.75); tilt.add(eye);
  g.userData = { head, tilt, eyeMat: eye.material, color: new THREE.Color(TEAM_COLORS[team]) };
  return g;
}

export function createStation(team) {
  const g = new THREE.Group();
  const metal = metalTexture();
  const padMat = new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.55 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.15, 24), new THREE.MeshLambertMaterial({ color: 0x9aa0a8, map: metal }));
  pad.position.y = 0.07; g.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 6, 32), padMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.18; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 1.7; g.add(beam);
  g.userData = { ring, beam, padMat };
  return g;
}

export function createVehiclePad(team) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.3, 0.3, 32), new THREE.MeshLambertMaterial({ color: 0x8a9098, map: metalTexture() }));
  pad.position.y = 0.15; g.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.1, 6, 40), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.32; g.add(ring);
  return g;
}

// Supply crate dropped on death
export function createCrate() {
  const g = new THREE.Group();
  const gen = library.instance('supply_crate');
  if (gen) { gen.position.y = -0.3; g.add(gen); return g; } // centred like the procedural crate
  const crate = box(0.9, 0.6, 0.6, new THREE.MeshLambertMaterial({ color: 0x8a8f6a, map: metalTexture() }));
  g.add(crate);
  const glow = new THREE.MeshBasicMaterial({ color: 0x9fffb6 });
  const a = box(0.5, 0.12, 0.62, glow); a.position.y = 0.01; g.add(a);
  const b = box(0.12, 0.4, 0.62, glow); g.add(b);
  return g;
}
