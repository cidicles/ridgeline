import * as THREE from 'three';
import { WEAPONS, stepProjectile } from '../shared/weapons.js';
import { softTexture } from './textures.js';

const particleVert = /* glsl */`
  attribute float size;
  attribute vec4 tint;
  uniform float scale;
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;
const particleFrag = /* glsl */`
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec4 vTint;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    float d = gl_FragCoord.z / gl_FragCoord.w;
    float f = 1.0 - exp(-pow(fogDensity * d, 2.0));
    gl_FragColor = vec4(mix(vTint.rgb, fogColor, f), t.a * vTint.a * (1.0 - f * 0.7));
    #include <colorspace_fragment>
  }
`;

// One draw call per blend mode; particles live in flat typed arrays.
class ParticleSystem {
  constructor(capacity, additive) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.tint = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = {
      map: { value: softTexture() }, scale: { value: 600 },
      fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.0015 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: particleVert, fragmentShader: particleFrag, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(p, v, color, size, life, { alpha = 1, grow = 0, drag = 0, grav = 0 } = {}) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    this.pos.set(p, i * 3);
    this.vel[i * 3] = v[0]; this.vel[i * 3 + 1] = v[1]; this.vel[i * 3 + 2] = v[2];
    this.tint[i * 4] = color[0]; this.tint[i * 4 + 1] = color[1]; this.tint[i * 4 + 2] = color[2]; this.tint[i * 4 + 3] = alpha;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grow[i] = grow; this.alpha0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.tint[i * 4 + 3] !== 0) { this.tint[i * 4 + 3] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      for (let a = 0; a < 3; a++) { this.vel[i * 3 + a] *= k; this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt; }
      this.size[i] += this.grow[i] * dt;
      this.tint[i * 4 + 3] = this.alpha0[i] * Math.max(0, this.life[i] / this.maxLife[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticleSystem(4000, true);
    this.smoke = new ParticleSystem(2500, false);
    this.sky = new ParticleSystem(3000, false); // weather
    scene.add(this.smoke.points, this.add.points, this.sky.points);
    this.projectiles = new Map(); // id -> {pr, mesh}
    this.flashes = [];
    this.discGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.07, 16);
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff });
    this.tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 3);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    this.nadeGeo = new THREE.SphereGeometry(0.14, 8, 6);
    this.nadeMat = new THREE.MeshLambertMaterial({ color: 0x3c4a32 });
    this.plasmaGeo = new THREE.SphereGeometry(0.3, 10, 8);
    this.plasmaMat = new THREE.MeshBasicMaterial({ color: 0xffa070 });
    this.flashGeo = new THREE.SphereGeometry(1, 16, 12);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    this.mortarGeo = new THREE.SphereGeometry(0.32, 10, 8);
    this.mortarMat = new THREE.MeshBasicMaterial({ color: 0x9affdc });
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xffe14a });
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.beamGeo.translate(0, 0.5, 0);
    this.beamGeo.rotateX(Math.PI / 2); // unit beam along +Z
    this.beams = [];
  }

  // Straight glowing beam from a to b that fades out over `life` seconds
  beam(a, b, color, width = 0.06, life = 0.25) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 0.01) return;
    const m = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(...a);
    m.lookAt(b[0], b[1], b[2]);
    m.scale.set(width, width, len);
    this.scene.add(m);
    this.beams.push({ m, t: 0, life });
  }

  setFog(color, density) {
    for (const s of [this.add, this.smoke, this.sky]) { s.uniforms.fogColor.value.copy(color); s.uniforms.fogDensity.value = density; }
  }

  setViewport(height, fov) {
    const scale = height / (2 * Math.tan((fov * Math.PI / 180) / 2));
    this.add.uniforms.scale.value = scale;
    this.smoke.uniforms.scale.value = scale;
    this.sky.uniforms.scale.value = scale;
  }

  spawnProjectile(id, w, pos, vel, owner, world) {
    const pr = { id, w, owner, pos: [...pos], vel: [...vel], age: 0 };
    let mesh;
    if (w === 0) mesh = new THREE.Mesh(this.discGeo, this.discMat);
    else if (w === 1) mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    else if (w === 2 || w === 7) mesh = new THREE.Mesh(this.nadeGeo, this.nadeMat);
    else if (w === 4) mesh = new THREE.Mesh(this.mortarGeo, this.mortarMat);
    else if (w === 6) mesh = new THREE.Mesh(this.nadeGeo, this.boltMat);
    else if (w === 5) {
      // Laser: draw the whole beam now; the projectile itself is invisible
      mesh = new THREE.Object3D();
      const sp = Math.hypot(...vel) || 1;
      const reach = WEAPONS[5].speed * WEAPONS[5].life;
      const end = [pos[0] + vel[0] / sp * reach, pos[1] + vel[1] / sp * reach, pos[2] + vel[2] / sp * reach];
      const hit = world && world.raycast(pos[0], pos[1], pos[2], end[0], end[1], end[2]);
      this.beam(pos, hit ? hit.point : end, 0xff3050, 0.07, 0.35);
      this.beam(pos, hit ? hit.point : end, 0xffd0d8, 0.02, 0.2);
    }
    else mesh = new THREE.Mesh(this.plasmaGeo, this.plasmaMat);
    mesh.position.set(...pos);
    this.scene.add(mesh);
    this.projectiles.set(id, { pr, mesh });
    // Muzzle flash
    const col = hex(WEAPONS[w].color);
    this.add.emit(pos, [0, 0, 0], col, w === 1 ? 0.8 : 1.6, 0.08, { alpha: 0.9 });
  }

  // A locally predicted shot is confirmed by the server under a new id
  renameProjectile(from, to) {
    const p = this.projectiles.get(from);
    if (!p) return false;
    this.projectiles.delete(from);
    p.pr.id = to;
    this.projectiles.set(to, p);
    return true;
  }

  // Falling snow or ash in a box around the camera
  weather(kind, cam, dt) {
    if (!kind) { this.sky.update(dt); return; }
    if (kind === 'snow' || kind === 'ash') {
      const snow = kind === 'snow';
      const n = Math.floor((snow ? 420 : 260) * dt * (this.weatherScale ?? 1) + Math.random());
      for (let i = 0; i < n; i++) {
        const p = [cam[0] + rnd(90), cam[1] + 4 + Math.random() * 26, cam[2] + rnd(90)];
        if (snow) this.sky.emit(p, [2 + rnd(1.5), -3.2 + rnd(1), 1 + rnd(1.5)], [0.96, 0.97, 1], 0.2, 7, { alpha: 0.9 });
        else this.sky.emit(p, [1 + rnd(1), -1.3 + rnd(0.6), 0.5 + rnd(1)], [0.3, 0.28, 0.27], 0.16, 9, { alpha: 0.85 });
      }
      if (!snow && Math.random() < dt * 25) {
        this.add.emit([cam[0] + rnd(60), cam[1] + Math.random() * 20, cam[2] + rnd(60)], [rnd(1), 1.5, rnd(1)], [1, 0.45, 0.15], 0.12, 3, { alpha: 0.9 });
      }
    } else if (kind === 'dust') {
      // Wind-blown grit low to the ground, plus the odd gust plume
      const n = Math.floor(160 * dt * (this.weatherScale ?? 1) + Math.random());
      for (let i = 0; i < n; i++) {
        const p = [cam[0] + rnd(80), cam[1] - 2 + Math.random() * 10, cam[2] + rnd(80)];
        this.sky.emit(p, [7 + rnd(3), rnd(0.6), 2.5 + rnd(2)], [0.62, 0.48, 0.34], 0.07, 4, { alpha: 0.6 });
      }
      if (Math.random() < dt * 0.6) {
        const p = [cam[0] + rnd(120), cam[1] - 4, cam[2] + rnd(120)];
        for (let i = 0; i < 12; i++) this.smoke.emit([p[0] + rnd(6), p[1] + Math.random() * 3, p[2] + rnd(6)], [8 + rnd(3), 0.6, 3 + rnd(2)], [0.66, 0.52, 0.38], 3 + Math.random() * 3, 3.5, { alpha: 0.18, grow: 3 });
      }
    } else if (kind === 'motes') {
      // Slow drifting pollen catching the light
      const n = Math.floor(40 * dt * (this.weatherScale ?? 1) + Math.random());
      for (let i = 0; i < n; i++) {
        const p = [cam[0] + rnd(50), cam[1] - 3 + Math.random() * 9, cam[2] + rnd(50)];
        this.add.emit(p, [0.6 + rnd(0.6), rnd(0.3), 0.3 + rnd(0.6)], [1, 0.95, 0.75], 0.05, 6, { alpha: 0.5 });
      }
    }
    this.sky.update(dt);
  }

  // Water splash or lava spatter where something enters the surface
  splash(p, speed, lava) {
    const n = Math.min(60, 10 + speed * 1.5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * speed * 0.25;
      const v = [Math.cos(a) * r, 4 + Math.random() * speed * 0.35, Math.sin(a) * r];
      if (lava) this.add.emit(p, v, [1, 0.45 + Math.random() * 0.3, 0.1], 0.2, 0.9, { grav: 18 });
      else this.smoke.emit(p, v, [0.85, 0.92, 1], 0.18, 0.9, { grav: 18, alpha: 0.8 });
    }
    if (!lava) for (let i = 0; i < 6; i++) this.smoke.emit([p[0] + rnd(2), p[1], p[2] + rnd(2)], [rnd(2), 1, rnd(2)], [0.9, 0.95, 1], 1.5, 1.2, { alpha: 0.35, grow: 3 });
    else for (let i = 0; i < 8; i++) this.smoke.emit([p[0] + rnd(2), p[1] + 0.5, p[2] + rnd(2)], [rnd(1), 3, rnd(1)], [0.2, 0.18, 0.17], 2, 2.5, { alpha: 0.5, grow: 2 });
  }

  removeProjectile(id) {
    const p = this.projectiles.get(id);
    if (!p) return null;
    this.scene.remove(p.mesh);
    this.projectiles.delete(id);
    return p;
  }

  explode(w, point, normal, small) {
    const W = WEAPONS[w];
    const n = normal || [0, 1, 0];
    if (w === 1 || w === 5 || small) {
      for (let i = 0; i < 4; i++) {
        this.add.emit(point, [n[0] * 4 + rnd(6), n[1] * 4 + rnd(6), n[2] * 4 + rnd(6)], [1, 0.85, 0.5], 0.25, 0.25, { grav: 15 });
      }
      this.smoke.emit(point, [n[0], n[1] + 0.5, n[2]], [0.5, 0.48, 0.45], 0.8, 0.6, { alpha: 0.5, grow: 2 });
      return;
    }
    const r = W.splash;
    const fire = w === 3 ? [1, 0.45, 0.2] : w === 2 || w === 7 ? [1, 0.7, 0.3] : w === 4 ? [0.7, 1, 0.85] : w === 6 ? [1, 0.88, 0.35] : [0.75, 0.9, 1];
    // Expanding shockwave sphere
    const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...fire), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(...point);
    this.scene.add(m);
    this.flashes.push({ m, t: 0, life: 0.35, r });
    // Shockwave ring racing outward along the surface
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...fire), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(point[0] + n[0] * 0.15, point[1] + n[1] * 0.15, point[2] + n[2] * 0.15);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n));
    this.scene.add(ring);
    this.flashes.push({ m: ring, t: 0, life: 0.45, r: r * 1.6, ring: true });
    for (let i = 0; i < 40; i++) {
      const s = 10 + Math.random() * 18;
      const d = randDir();
      this.add.emit(point, [d[0] * s + n[0] * 6, d[1] * s + n[1] * 6, d[2] * s + n[2] * 6], fire, 0.5 + Math.random() * 0.6, 0.4 + Math.random() * 0.4, { drag: 3, grav: 6 });
    }
    for (let i = 0; i < 14; i++) {
      const d = randDir();
      this.add.emit(point, [d[0] * 4, d[1] * 4, d[2] * 4], [1, 0.75, 0.4], r * 0.6, 0.25, { alpha: 0.6, grow: r * 2 });
    }
    for (let i = 0; i < 18; i++) {
      const d = randDir();
      this.smoke.emit([point[0] + d[0], point[1] + d[1], point[2] + d[2]], [d[0] * 3 + n[0] * 2, d[1] * 2 + 2, d[2] * 3 + n[2] * 2],
        [0.32, 0.3, 0.29], 2 + Math.random() * 2, 1.6 + Math.random(), { alpha: 0.55, grow: 3, drag: 1 });
    }
    // Dirt chunks kicked up from the ground
    for (let i = 0; i < 10; i++) {
      this.smoke.emit(point, [n[0] * 12 + rnd(10), n[1] * 14 + Math.random() * 8, n[2] * 12 + rnd(10)], [0.35, 0.28, 0.2], 0.4, 1.1, { grav: 20, alpha: 0.9 });
    }
  }

  // Jet exhaust and ski spray for any player
  playerTrail(pos, vel, jetting, skiing, speed, dt) {
    if (jetting) {
      for (let i = 0; i < 2; i++) {
        this.add.emit([pos[0] + rnd(0.3), pos[1] + 0.9, pos[2] + rnd(0.3)], [vel[0] * 0.3 + rnd(1), -10 + vel[1] * 0.3, vel[2] * 0.3 + rnd(1)], [0.5, 0.75, 1], 0.6, 0.25, { alpha: 0.8, grow: 1 });
      }
      if (Math.random() < 0.5) this.smoke.emit([pos[0], pos[1] + 0.6, pos[2]], [rnd(1), -3, rnd(1)], [0.75, 0.75, 0.78], 0.8, 0.9, { alpha: 0.25, grow: 2.5, drag: 1 });
    }
    if (skiing && speed > 8 && Math.random() < Math.min(1, speed / 40)) {
      this.smoke.emit([pos[0] + rnd(0.5), pos[1] + 0.1, pos[2] + rnd(0.5)], [rnd(2), 1.5, rnd(2)], [0.85, 0.85, 0.8], 0.5, 0.6, { alpha: 0.4, grow: 2 });
    }
  }

  update(dt, world) {
    for (const [id, { pr, mesh }] of this.projectiles) {
      const hit = stepProjectile(pr, dt, world, null);
      mesh.position.set(...pr.pos);
      const sp = Math.hypot(...pr.vel);
      if (pr.w === 0) {
        mesh.rotation.y += dt * 30;
        if (Math.random() < 0.8) this.add.emit(pr.pos, [0, 0, 0], [0.6, 0.85, 1], 0.5, 0.3, { alpha: 0.6 });
      } else if (pr.w === 1) {
        mesh.lookAt(pr.pos[0] + pr.vel[0], pr.pos[1] + pr.vel[1], pr.pos[2] + pr.vel[2]);
      } else if (pr.w === 2 || pr.w === 4 || pr.w === 7) {
        if (Math.random() < 0.6) this.smoke.emit(pr.pos, [0, 0.5, 0], [0.7, 0.7, 0.7], pr.w === 4 ? 0.8 : 0.4, 0.8, { alpha: 0.4, grow: 1.2 });
      } else if (pr.w === 6) {
        this.add.emit(pr.pos, [0, 0, 0], [1, 0.85, 0.3], 0.7, 0.15, { alpha: 0.8 });
      } else if (pr.w === 5) {
        // beam already drawn
      } else {
        this.add.emit(pr.pos, [0, 0, 0], [1, 0.5, 0.25], 0.9, 0.18, { alpha: 0.8 });
      }
      // Hide locally once it "hits"; the server's boom event does the real explosion
      if (hit || sp === 0) mesh.visible = false;
      if (pr.age > WEAPONS[pr.w].life + 1) this.removeProjectile(id);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      const k = f.t / f.life;
      if (f.ring) { const e = 1 - (1 - k) ** 3; f.m.scale.set(0.3 + e * f.r, 1, 0.3 + e * f.r); }
      else f.m.scale.setScalar(0.5 + k * f.r);
      f.m.material.opacity = 0.9 * (1 - k);
      if (k >= 1) { this.scene.remove(f.m); f.m.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      b.m.material.opacity = Math.max(0, 1 - b.t / b.life);
      if (b.t >= b.life) { this.scene.remove(b.m); b.m.material.dispose(); this.beams.splice(i, 1); }
    }
    this.add.update(dt);
    this.smoke.update(dt);
  }

  // Smoke and sparks rising from a wrecked object
  wreckSmoke(pos) {
    if (Math.random() < 0.3) this.smoke.emit([pos[0] + rnd(1.5), pos[1] + 1, pos[2] + rnd(1.5)], [rnd(1), 3, rnd(1)], [0.15, 0.14, 0.14], 1.5, 2.5, { alpha: 0.5, grow: 2 });
    if (Math.random() < 0.08) this.add.emit([pos[0], pos[1] + 1, pos[2]], [rnd(6), 6, rnd(6)], [1, 0.7, 0.3], 0.2, 0.5, { grav: 15 });
  }

  hoverWash(pos, lifting) {
    if (Math.random() < 0.5) this.smoke.emit([pos[0] + rnd(2), pos[1] - 0.5, pos[2] + rnd(2)], [rnd(4), 0.5, rnd(4)], [0.75, 0.75, 0.72], 0.8, 0.7, { alpha: 0.18, grow: 3 });
    if (lifting) this.add.emit([pos[0] + rnd(1.5), pos[1], pos[2] + rnd(1.5)], [0, -6, 0], [0.5, 0.8, 1], 0.6, 0.2, { alpha: 0.7 });
  }

  clear() {
    for (const id of [...this.projectiles.keys()]) this.removeProjectile(id);
  }
}

function rnd(s) { return (Math.random() - 0.5) * s; }
function randDir() {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return [r * Math.cos(a), u, r * Math.sin(a)];
}
