import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEAM_COLORS } from '../shared/world.js';
import { createArmor } from './models.js';
import { metalTexture } from './textures.js';

const MAX_GIBS = 140;
const MAX_DECALS = 70;
const GIB_LIFE = 12;
const CORPSE_LIFE = 10;

const rnd = (s) => (Math.random() - 0.5) * s;
const BLOOD = [0.42, 0.02, 0.02];
const BLOOD_DARK = [0.24, 0.01, 0.01];

// Blood, gibs and corpses. With gore off, hits throw sparks and deaths
// burst into armour plates only.
export class Gore {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.enabled = true;
    this.gibs = [];
    this.decals = [];
    this.corpses = [];
    const metal = metalTexture();
    this.plateGeos = [
      new RoundedBoxGeometry(0.42, 0.3, 0.12, 2, 0.04),
      new RoundedBoxGeometry(0.28, 0.24, 0.3, 2, 0.05),
      new RoundedBoxGeometry(0.2, 0.42, 0.2, 2, 0.05),
      new RoundedBoxGeometry(0.3, 0.3, 0.32, 2, 0.08),
    ];
    this.chunkGeo = new THREE.IcosahedronGeometry(0.13, 0);
    this.darkMat = new THREE.MeshLambertMaterial({ color: 0x5d646d, map: metal });
    this.lightMat = new THREE.MeshLambertMaterial({ color: 0xd6dbe2, map: metal });
    this.teamMats = TEAM_COLORS.map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.12 }));
    this.meatMat = new THREE.MeshLambertMaterial({ color: 0x6a0c0c, emissive: 0x200000 });
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalTex = splatTexture();
  }

  // A bullet or blast connecting with someone
  hit(point, dir, amount, world) {
    const n = Math.min(30, 5 + amount * 0.6);
    const d = dir && Math.hypot(...dir) > 0.1 ? dir : [0, 0, 0];
    if (!this.enabled) {
      for (let i = 0; i < 6; i++) this.fx.add.emit(point, [rnd(8) + d[0] * 4, rnd(6) + 2, rnd(8) + d[2] * 4], [1, 0.8, 0.45], 0.18, 0.3, { grav: 18 });
      return;
    }
    // Exit spray along the shot direction, plus a little back-spatter
    for (let i = 0; i < n; i++) {
      const back = Math.random() < 0.25 ? -0.6 : 1;
      const sp = 3 + Math.random() * 7;
      this.fx.smoke.emit(point, [d[0] * sp * back + rnd(4), d[1] * sp * back + rnd(4) + 1.5, d[2] * sp * back + rnd(4)],
        Math.random() < 0.5 ? BLOOD : BLOOD_DARK, 0.09 + Math.random() * 0.12, 0.7 + Math.random() * 0.4, { grav: 22, alpha: 0.95 });
    }
    this.fx.smoke.emit(point, [d[0] * 1.5, 0.6, d[2] * 1.5], BLOOD, 0.5 + amount * 0.01, 0.55, { alpha: 0.45, grow: 1.6, drag: 2 });
    // Splat on whatever is below and ahead
    if (world && amount >= 4) {
      const x = point[0] + d[0] * 1.5 + rnd(1), z = point[2] + d[2] * 1.5 + rnd(1);
      this.splat(world, x, point[1], z, 0.5 + Math.min(1.4, amount / 40));
    }
  }

  // A kill: gib the body or drop a corpse
  death(m, pos, vel, team, armor, world) {
    if (m.g) this.gib(pos, vel, m.d, team, world);
    else this.corpse(pos, vel, team, armor, world);
  }

  gib(pos, vel, dir, team, world) {
    const c = [pos[0], pos[1] + 1.1, pos[2]];
    const push = dir && Math.hypot(...dir) > 0.1 ? dir : [0, 0.5, 0];
    const mats = [this.teamMats[team], this.teamMats[team], this.darkMat, this.lightMat];
    const pieces = 9 + Math.floor(Math.random() * 4);
    for (let i = 0; i < pieces; i++) this.spawnGib(c, vel, push, new THREE.Mesh(this.plateGeos[i % 4], mats[i % 4]), true);
    if (this.enabled) {
      for (let i = 0; i < 8; i++) this.spawnGib(c, vel, push, new THREE.Mesh(this.chunkGeo, this.meatMat), false, true);
      // A burst of blood and red mist
      for (let i = 0; i < 70; i++) {
        const sp = 4 + Math.random() * 12;
        const a = Math.random() * Math.PI * 2, u = Math.random() * 1.6 - 0.4;
        this.fx.smoke.emit(c, [Math.cos(a) * sp + push[0] * 5 + vel[0] * 0.4, u * sp + 3, Math.sin(a) * sp + push[2] * 5 + vel[2] * 0.4],
          Math.random() < 0.6 ? BLOOD : BLOOD_DARK, 0.12 + Math.random() * 0.18, 0.9 + Math.random() * 0.6, { grav: 20, alpha: 0.95 });
      }
      for (let i = 0; i < 10; i++) this.fx.smoke.emit([c[0] + rnd(1), c[1] + rnd(1), c[2] + rnd(1)], [rnd(3), 1 + Math.random() * 2, rnd(3)], BLOOD, 1.2 + Math.random(), 1.2, { alpha: 0.4, grow: 2.5, drag: 1.5 });
      if (world) for (let i = 0; i < 4; i++) this.splat(world, c[0] + rnd(5), c[1], c[2] + rnd(5), 1 + Math.random() * 1.6);
    } else {
      for (let i = 0; i < 30; i++) this.fx.add.emit(c, [rnd(16), Math.random() * 10, rnd(16)], [1, 0.75, 0.4], 0.2, 0.5, { grav: 15 });
    }
  }

  spawnGib(c, vel, push, mesh, metal, meat = false) {
    if (this.gibs.length >= MAX_GIBS) { const old = this.gibs.shift(); this.scene.remove(old.mesh); }
    const sp = 6 + Math.random() * 12;
    const a = Math.random() * Math.PI * 2;
    const g = {
      mesh, metal, meat, age: 0, landed: false,
      pos: [c[0] + rnd(0.6), c[1] + rnd(0.8), c[2] + rnd(0.6)],
      vel: [Math.cos(a) * sp * 0.6 + push[0] * 8 + vel[0] * 0.5, 4 + Math.random() * 9 + push[1] * 4, Math.sin(a) * sp * 0.6 + push[2] * 8 + vel[2] * 0.5],
      spin: [rnd(20), rnd(20), rnd(20)],
    };
    mesh.position.set(...g.pos);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(mesh);
    this.gibs.push(g);
  }

  // Body topples over and bleeds out, then sinks away
  corpse(pos, vel, team, armor, world) {
    if (this.corpses.length >= 12) { const old = this.corpses.shift(); this.scene.remove(old.model); }
    const model = createArmor(team, armor);
    const yaw = Math.atan2(-vel[0], -vel[2]) || Math.random() * 6;
    model.position.set(pos[0], pos[1], pos[2]);
    model.rotation.order = 'YXZ';
    model.rotation.y = yaw;
    const u = model.userData;
    if (u.rig) {
      // Generated armour: settle once into a limp airborne pose, then leave it frozen
      model.updateMatrixWorld(true);
      for (let i = 0; i < 20; i++) u.rig.update(0.05, { speed: 0, onGround: false, skiing: false, jetting: false, pitch: -0.9 });
    } else {
      u.legs[0].leg.rotation.x = 0.3; u.legs[1].leg.rotation.x = -0.2; u.legs[0].knee.rotation.x = 0.6;
      u.arms.rotation.x = -0.8;
      for (const f of u.flames) f.visible = false;
    }
    this.scene.add(model);
    this.corpses.push({ model, age: 0, vel: [vel[0] * 0.5, Math.max(0, vel[1] * 0.3), vel[2] * 0.5], fall: Math.random() < 0.5 ? 1 : -1, pooled: false, world });
    if (this.enabled) this.hit([pos[0], pos[1] + 1.2, pos[2]], [0, -0.3, 0], 25, world);
  }

  // Blood decal flat on the terrain (or a roof) below the given point
  splat(world, x, y, z, size) {
    if (!this.enabled) return;
    this.decal(world, x, y, z, size, this.decalTex, 0x5a0606, 0.85, 30 + Math.random() * 10);
  }

  // Charred blast mark where an explosion meets the ground (shown with gore off too)
  scorch(world, p, radius) {
    if (p[1] - world.height(p[0], p[2]) > 2.5 && !world.pointInBox(p[0], p[1] - 1.5, p[2])) return;
    this.decal(world, p[0], p[1] + 0.5, p[2], radius * (0.55 + Math.random() * 0.2), this.scorchTex || (this.scorchTex = scorchTexture()), 0x0d0b0a, 0.8, 25);
  }

  decal(world, x, y, z, size, tex, color, opacity, life) {
    let g = world.height(x, z), roof = false;
    for (const b of world.boxes) {
      if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && b.max[1] <= y + 0.5 && b.max[1] > g) { g = b.max[1]; roof = true; }
    }
    if (y - g > 30) return;
    if (this.decals.length >= MAX_DECALS) { const old = this.decals.shift(); this.scene.remove(old.mesh); old.mesh.material.dispose(); }
    const mesh = new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    const n = roof ? [0, 1, 0] : world.normal(x, z);
    mesh.position.set(x, g + 0.04, z);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n));
    mesh.rotateY(Math.random() * Math.PI * 2);
    mesh.scale.set(size, 1, size);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.decals.push({ mesh, age: 0, life, target: size, opacity });
  }

  update(dt, world) {
    // Gibs: tumble, bounce off terrain, leave blood trails, then sink
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      g.age += dt;
      if (g.age > GIB_LIFE) { this.scene.remove(g.mesh); this.gibs.splice(i, 1); continue; }
      if (g.age > GIB_LIFE - 2) { g.mesh.position.y -= dt * 0.25; continue; }
      g.vel[1] -= 20 * dt;
      for (let k = 0; k < 3; k++) g.pos[k] += g.vel[k] * dt;
      const h = world.height(g.pos[0], g.pos[2]);
      if (g.pos[1] < h + 0.08) {
        g.pos[1] = h + 0.08;
        const n = world.normal(g.pos[0], g.pos[2]);
        const vn = g.vel[0] * n[0] + g.vel[1] * n[1] + g.vel[2] * n[2];
        if (vn < 0) {
          const bounce = g.meat ? 0.15 : 0.35;
          for (let k = 0; k < 3; k++) g.vel[k] = (g.vel[k] - (1 + bounce) * vn * n[k]) * 0.7;
          for (let k = 0; k < 3; k++) g.spin[k] *= 0.6;
          if (!g.landed && this.enabled && (g.meat || Math.random() < 0.4)) this.splat(world, g.pos[0], g.pos[1] + 0.3, g.pos[2], 0.4 + Math.random() * 0.5);
          g.landed = true;
        }
        if (Math.hypot(...g.vel) < 0.6) { g.vel = [0, 0, 0]; g.spin = [0, 0, 0]; }
      }
      g.mesh.position.set(...g.pos);
      g.mesh.rotation.x += g.spin[0] * dt; g.mesh.rotation.y += g.spin[1] * dt; g.mesh.rotation.z += g.spin[2] * dt;
      if (this.enabled && !g.landed && Math.random() < (g.meat ? 0.8 : 0.3)) {
        this.fx.smoke.emit(g.pos, [rnd(0.5), -0.5, rnd(0.5)], BLOOD_DARK, 0.1, 0.6, { grav: 8, alpha: 0.9 });
      }
    }
    // Corpses: fall over onto the ground, pool blood, then sink after a while
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.age += dt;
      const m = c.model;
      if (c.age > CORPSE_LIFE + 3) { this.scene.remove(m); this.corpses.splice(i, 1); continue; }
      const k = Math.min(1, c.age / 0.7);
      m.rotation.x = c.fall * (Math.PI / 2 - 0.08) * k * k;
      c.vel[1] -= 20 * dt;
      m.position.x += c.vel[0] * dt; m.position.z += c.vel[2] * dt; m.position.y += c.vel[1] * dt;
      const h = world.height(m.position.x, m.position.z) + 0.25 * k;
      if (m.position.y < h) { m.position.y = h; c.vel = [c.vel[0] * 0.8, 0, c.vel[2] * 0.8]; }
      if (!c.pooled && c.age > 0.8) { c.pooled = true; this.splat(world, m.position.x, m.position.y + 0.5, m.position.z, 1.6 + Math.random() * 0.8); }
      if (c.age > CORPSE_LIFE) m.position.y -= dt * 0.6;
    }
    // Decals: pools spread a little, then fade
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age < 1.5) { const s = d.target * (0.6 + 0.4 * Math.min(1, d.age / 1.5)); d.mesh.scale.set(s, 1, s); }
      if (d.age > d.life - 4) d.mesh.material.opacity = d.opacity * Math.max(0, (d.life - d.age) / 4);
      if (d.age >= d.life) { this.scene.remove(d.mesh); d.mesh.material.dispose(); this.decals.splice(i, 1); }
    }
  }

  clear() {
    for (const g of this.gibs) this.scene.remove(g.mesh);
    for (const c of this.corpses) this.scene.remove(c.model);
    for (const d of this.decals) { this.scene.remove(d.mesh); d.mesh.material.dispose(); }
    this.gibs = []; this.corpses = []; this.decals = [];
  }
}

// Irregular splat: a blob with droplets around it
function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blob = (x, y, r, a) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.7, `rgba(255,255,255,${a * 0.9})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  blob(64, 64, 34, 1);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.sin(i * 7.3), d = 22 + ((i * 37) % 30);
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + ((i * 13) % 9), 0.9);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}


// Scorch: dark centre with ragged radial streaks
function scorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.sin(i * 3.1) * 0.2, r0 = 20, r1 = 44 + ((i * 29) % 18);
    g.lineWidth = 2 + (i % 3);
    g.beginPath(); g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
