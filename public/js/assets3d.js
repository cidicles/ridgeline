import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// AI-generated models (public/models, made by scripts/generate-models.js).
// Every model is normalised on load: scaled to a target size, origin at its
// base, facing -Z, so game code can swap them in for the procedural models.
// Anything missing simply isn't offered, and the procedural model is used.

// Target size (height, length along the facing axis, or a [w, h, d] box to fit
// inside), the yaw that turns each model to face -Z, how strongly its emissive map
// glows (Meshy bakes full-strength glow, which blooms), how much it reflects the
// environment and a base colour multiplier (white paint blows out) - tuned per asset
const FIT = {
  soldier_light_ember: { height: 2.0, yaw: Math.PI },
  soldier_medium_ember: { height: 2.2, yaw: Math.PI },
  soldier_heavy_ember: { height: 2.5, yaw: Math.PI },
  skiff: { length: 4.8, yaw: -Math.PI / 2, glow: 0.3, env: 0.45, tint: 0.72 },
  // Weapons at their in-world size (held in third person; first person scales them down)
  disc_launcher: { length: 0.8, yaw: -Math.PI / 2, glow: 0.15, env: 0.4 },
  chaingun: { length: 0.95, yaw: -Math.PI / 2, glow: 0.3, env: 0.4 },
  grenade_launcher: { length: 0.85, yaw: -Math.PI / 2, glow: 0.3, env: 0.4 },
  plasma_rifle: { length: 0.95, yaw: -Math.PI / 2, glow: 0.4, env: 0.4 },
  mortar: { length: 1.1, yaw: -Math.PI / 2, glow: 0.3, env: 0.4 },
  laser_rifle: { length: 1.35, yaw: -Math.PI / 2, glow: 0.4, env: 0.4 },
  generator: { box: [2.9, 4.4, 3.4], yaw: 0, glow: 0.6, env: 0.5 },
  turret_head: { length: 2.4, yaw: -Math.PI / 2, glow: 0.6, env: 0.5 },
  supply_crate: { box: [0.9, 0.6, 0.6], yaw: 0, glow: 0.8, env: 0.5 },
};

// Generated model per weapon id (shared/weapons.js order)
export const WEAPON_MODELS = ['disc_launcher', 'chaingun', 'grenade_launcher', 'plasma_rifle', 'mortar', 'laser_rifle'];

export class ModelLibrary {
  constructor(base) {
    this.base = base;
    this.models = {};
    this.envMap = null;
    this.recolors = new Map();
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.ready = this.load().catch(() => {});
  }

  async load() {
    const r = await fetch(`${this.base}models/index.json`, { cache: 'no-cache' });
    if (!r.ok) return;
    const index = await r.json();
    await Promise.all(Object.entries(index).map(async ([id, entry]) => {
      try {
        const gltf = await this.loader.loadAsync(`${this.base}models/${entry.file}`);
        const clips = {};
        for (const [name, file] of Object.entries(entry.anims || {})) {
          const a = await this.loader.loadAsync(`${this.base}models/${file}`);
          if (a.animations[0]) clips[name] = a.animations[0];
        }
        this.models[id] = { entry, scene: gltf.scene, clips, fit: this.measure(id, gltf.scene) };
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.material.emissiveIntensity = FIT[id]?.glow ?? 1;
          o.material.color.multiplyScalar(FIT[id]?.tint ?? 1);
        });
        if (this.envMap) this.applyEnv(id);
      } catch (err) {
        console.warn(`model ${id} failed to load`, err);
      }
    }));
  }

  // The game scene has no environment map; generated PBR metals need one to not look black
  setEnvironment(tex) {
    this.envMap = tex;
    for (const id of Object.keys(this.models)) this.applyEnv(id);
  }
  applyEnv(id) {
    this.models[id].scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material.envMap = this.envMap;
      o.material.envMapIntensity = FIT[id]?.env ?? 0.7;
      o.material.needsUpdate = true;
    });
  }

  // Scale and offset that put the model at the target size, base at y=0, centred on x/z
  measure(id, scene) {
    const f = FIT[id] || {};
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const size = box.getSize(new THREE.Vector3());
    const yaw = f.yaw || 0;
    const turned = Math.abs(Math.cos(yaw)) > 0.5;
    const along = turned ? size.z : size.x; // extent along the facing axis after the yaw
    const across = turned ? size.x : size.z;
    const scale = f.height ? f.height / size.y : f.length ? f.length / Math.max(along, 1e-3)
      : f.box ? Math.min(f.box[0] / across, f.box[1] / size.y, f.box[2] / along) : 1;
    const center = box.getCenter(new THREE.Vector3());
    return { scale, yaw, offset: new THREE.Vector3(-center.x, -box.min.y, -center.z), size };
  }

  has(id) { return !!this.models[id]; }

  // World size of a normalised model: [width, height, length]
  dims(id) {
    const m = this.models[id];
    if (!m) return null;
    const { size, scale, yaw } = m.fit, turned = Math.abs(Math.cos(yaw)) > 0.5;
    return [(turned ? size.x : size.z) * scale, size.y * scale, (turned ? size.z : size.x) * scale];
  }

  // A ready-to-place copy: wrapper group at the model's base, facing -Z.
  // hue: shift the model's orange accents to this hue (0-1), for the other team.
  // unique: own material copies, for per-instance changes such as dimming the glow.
  instance(id, { hue, unique } = {}) {
    const m = this.models[id];
    if (!m) return null;
    const inner = m.entry.rigged ? SkeletonUtils.clone(m.scene) : m.scene.clone(true);
    inner.position.copy(m.fit.offset);
    const pivot = new THREE.Group();
    pivot.rotation.y = m.fit.yaw;
    pivot.scale.setScalar(m.fit.scale);
    pivot.add(inner);
    const root = new THREE.Group();
    root.add(pivot);
    root.userData.generated = { id, inner, pivot, clips: m.clips };
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = !o.isSkinnedMesh; // skinned bounds don't follow the pose
      if (hue != null) o.material = this.recolor(o.material, hue);
      if (unique) o.material = o.material.clone();
    });
    return root;
  }

  // Material copy whose base colour has its orange hues rotated to `hue` (cached)
  recolor(mat, hue) {
    const key = `${mat.uuid}:${hue}`;
    if (!this.recolors.has(key)) {
      const out = mat.clone();
      if (mat.map?.image) out.map = recolorTexture(mat.map, hue);
      if (mat.emissiveMap?.image) out.emissiveMap = recolorTexture(mat.emissiveMap, hue);
      this.recolors.set(key, out);
    }
    return this.recolors.get(key);
  }
}

function recolorTexture(tex, hue) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data, col = new THREE.Color(), hsl = {};
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.LinearSRGBColorSpace).getHSL(hsl, THREE.LinearSRGBColorSpace);
    // Orange-to-amber band with real saturation: accent panels, visor, trim
    if (hsl.s < 0.3 || hsl.h > 0.17 || hsl.l < 0.08) continue;
    col.setHSL(hue, hsl.s, hsl.l * 0.95, THREE.LinearSRGBColorSpace);
    d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255;
  }
  g.putImageData(data, 0, 0);
  const t = tex.clone();
  t.source = new THREE.Source(c); // clones share their source; the original must stay orange
  t.needsUpdate = true;
  return t;
}

export const library = new ModelLibrary('');

// ---------- rigged characters ----------

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
const RIGHT = new THREE.Vector3(1, 0, 0);

// Turn `bone` (partially, by w) so the line to `child` points along `target` (world space)
function aim(bone, child, target, w = 1) {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _dir.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_dir, target);
  if (w < 1) _q.copy(_q2.identity().slerp(_q, w));
  turn(bone, _q);
}
// Rotate `bone` about a world axis
function twist(bone, axis, angle) {
  turn(bone, _q.setFromAxisAngle(axis, angle));
}
// Apply a world-space rotation to a bone
function turn(bone, q) {
  bone.getWorldQuaternion(_wq);
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(q.multiply(_wq)));
  bone.updateMatrixWorld(true);
}

// Limb directions in model space (facing -Z, +X is the character's right)
const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const POSE = {
  // Launcher held at the hip, left hand on the fore-grip
  armR: v(0.12, -0.8, -0.5), foreR: v(-0.04, -0.12, -1),
  armL: v(-0.18, -0.72, -0.6), foreL: v(0.6, -0.05, -0.8),
  // Skiing: knees bent, shins swept back
  ski: { thigh: v(0, -0.78, -0.62), shin: v(0, -0.86, 0.5), spread: 0.07, drop: 0.13, lean: -0.3 },
  // Airborne: legs trailing, slightly tucked
  air: { thigh: v(0, -0.93, -0.3), shin: v(0, -0.9, 0.42), spread: 0.04, drop: 0.06, lean: -0.1 },
};

// Drives a generated rigged character: walk/run clips synced to ground speed,
// with aim, ski crouch and airborne poses layered on procedurally, a jet flame
// pair on the pack and the player's current weapon in hand.
export class CharacterRig {
  constructor(root, { flameMaterial, makeWeapon }) {
    const g = root.userData.generated;
    this.root = root;
    this.pivot = g.pivot;
    const bone = (n) => g.inner.getObjectByName(n);
    this.b = {};
    for (const n of ['Hips', 'Spine02', 'neck', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftUpLeg', 'LeftLeg', 'LeftFoot']) this.b[n] = bone(n);
    this.ok = Object.values(this.b).every(Boolean);
    // Rest pose, restored every frame before the clips and overrides are applied
    this.bones = [];
    g.inner.traverse((o) => { if (o.isBone) this.bones.push({ o, q: o.quaternion.clone(), p: o.position.clone() }); });
    // Clip samplers per bone, so walk and run can be phase-synced and blended
    this.tracks = new Map();
    this.len = {};
    for (const [name, clip] of Object.entries(g.clips)) {
      this.len[name] = clip.duration;
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const o = bone(nodeName);
        if (!o || (propertyName !== 'quaternion' && !(propertyName === 'position' && nodeName === 'Hips'))) continue;
        const key = `${nodeName}.${propertyName}`;
        if (!this.tracks.has(key)) this.tracks.set(key, { o, prop: propertyName, bind: this.bones.find((x) => x.o === o) });
        this.tracks.get(key)[name] = track.createInterpolant();
      }
    }
    this.hasGait = !!(g.clips.walk && g.clips.run);
    this.phase = 0; this.gait = 0; this.runMix = 0; this.ski = 0; this.air = 0;
    // Jet flames, placed under the pack each frame
    this.flames = [0, 1].map(() => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 8, 1, true), flameMaterial);
      f.rotation.x = Math.PI;
      f.visible = false;
      root.add(f);
      return f;
    });
    // Held weapon follows the right hand, aimed with the view. makeWeapon(id)
    // builds one on first use; the holder swaps between them.
    this.makeWeapon = makeWeapon;
    this.weapons = [];
    this.weapon = new THREE.Group();
    root.add(this.weapon);
    this.held = -1;
  }

  hold(w) {
    if (w === this.held || !this.makeWeapon) return;
    this.held = w;
    if (this.weapons[w] === undefined) {
      this.weapons[w] = this.makeWeapon(w) || null;
      if (this.weapons[w]) this.weapon.add(this.weapons[w]);
    }
    this.weapons.forEach((g, i) => { if (g) g.visible = i === w; });
  }

  update(dt, { speed, onGround, skiing, jetting, pitch, weapon = 0 }) {
    this.hold(weapon);
    const k = Math.min(1, dt * 10);
    const running = onGround && !skiing && speed > 0.5;
    this.gait += ((running ? 1 : 0) - this.gait) * k;
    this.runMix += (Math.min(1, Math.max(0, (speed - 2.5) / 4)) - this.runMix) * k;
    this.ski += ((skiing ? 1 : 0) - this.ski) * k;
    this.air += ((!onGround && !skiing ? 1 : 0) - this.air) * k;
    // One gait cycle covers ~1.6 m walking, ~3.6 m running
    if (running) this.phase = (this.phase + dt * speed / (1.6 + 2 * this.runMix)) % 1;

    for (const x of this.bones) { x.o.quaternion.copy(x.q); x.o.position.copy(x.p); }
    if (this.hasGait && this.gait > 0.01) this.sampleGait();
    this.root.updateMatrixWorld(true);
    if (this.ok) this.pose(pitch);
    this.placeFlames(jetting);
    this.placeWeapon(pitch);
  }

  sampleGait() {
    const tw = this.phase * this.len.walk, tr = this.phase * this.len.run;
    for (const t of this.tracks.values()) {
      const { o, bind } = t;
      if (t.prop === 'quaternion') {
        const qa = t.walk ? _q.fromArray(t.walk.evaluate(tw)) : _q.copy(bind.q);
        const qb = t.run ? _q2.fromArray(t.run.evaluate(tr)) : _q2.copy(bind.q);
        o.quaternion.slerp(qa.slerp(qb, this.runMix), this.gait);
      } else {
        // Hips: keep the bob, drop any root motion
        const ya = t.walk ? t.walk.evaluate(tw)[1] : bind.p.y, yb = t.run ? t.run.evaluate(tr)[1] : bind.p.y;
        o.position.y += (ya + (yb - ya) * this.runMix - bind.p.y) * this.gait;
      }
    }
  }

  pose(pitch) {
    const b = this.b, rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = RIGHT.clone().applyQuaternion(rq);
    const world = (d, p = 0) => d.clone().applyAxisAngle(RIGHT, p).applyQuaternion(rq);
    // Legs: blend into the ski crouch or airborne tuck
    for (const [P, w] of [[POSE.ski, this.ski], [POSE.air, this.air]]) {
      if (w < 0.01) continue;
      for (const [up, low, foot, s] of [[b.RightUpLeg, b.RightLeg, b.RightFoot, 1], [b.LeftUpLeg, b.LeftLeg, b.LeftFoot, -1]]) {
        const thigh = P.thigh.clone(); thigh.x += P.spread * s;
        aim(up, low, world(thigh.normalize()), w);
        aim(low, foot, world(P.shin), w);
      }
    }
    this.pivot.position.y = -(POSE.ski.drop * this.ski + POSE.air.drop * this.air);
    // Torso: lean into the ski, and part of the aim pitch through the spine and neck
    twist(b.Spine02, right, POSE.ski.lean * this.ski + POSE.air.lean * this.air + pitch * 0.25);
    twist(b.neck, right, pitch * 0.3);
    // Arms hold the launcher, following the aim
    aim(b.RightArm, b.RightForeArm, world(POSE.armR, pitch * 0.5));
    aim(b.RightForeArm, b.RightHand, world(POSE.foreR, pitch * 0.45));
    aim(b.LeftArm, b.LeftForeArm, world(POSE.armL, pitch * 0.5));
    aim(b.LeftForeArm, b.LeftHand, world(POSE.foreL, pitch * 0.45));
  }

  // Root-local position of a bone
  local(bone, out) { return this.root.worldToLocal(bone.getWorldPosition(out)); }

  placeFlames(jetting) {
    const pack = this.ok ? this.local(this.b.Spine02, _a) : _a.set(0, 1.3, 0);
    this.flames.forEach((f, i) => {
      f.visible = jetting;
      if (!jetting) return;
      const s = 0.8 + Math.random() * 0.5;
      f.scale.set(1, s, 1);
      f.position.set(pack.x + (i ? 0.13 : -0.13), pack.y - 0.05 - 0.45 * s, pack.z + 0.32);
    });
  }

  placeWeapon(pitch) {
    if (this.ok) this.local(this.b.RightHand, this.weapon.position);
    this.weapon.rotation.set(pitch, 0, 0);
  }
}
