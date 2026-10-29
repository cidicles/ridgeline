import * as THREE from 'three';
import { GRID, CELL, SIZE, TEAM_COLORS } from '../shared/world.js';
import { terrainTextures, metalTexture, TERRAIN_SETS, loadSurface } from './textures.js';
import { createGenerator, createTurret, createStation, createVehiclePad } from './models.js';
import { buildScenery, buildBaseDecor, flagTexture, animateScenery } from './scenery.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightTexture, buildGroundCover, buildFluid } from './environment.js';

// Cloud cover per palette, 0 (clear) to 1 (overcast)
const CLOUD_COVER = { temperate: 0.5, desert: 0.25, snow: 0.75, volcanic: 0.6 };
// Volcanic skies carry dark ash clouds rather than white ones
const CLOUD_TINT = { volcanic: [0.42, 0.34, 0.31] };

// Half-width of the sun's shadow box around the camera, in metres
const SHADOW_RANGE = 95;

// Everything solid casts and receives sun shadows; glows, transparent effects and
// custom shaders (grass, water, sky) are left out
export function castShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const fx = m.isMeshBasicMaterial || m.transparent || m.blending === THREE.AdditiveBlending || m.isShaderMaterial;
    o.castShadow = !fx && !o.userData.noShadow;
    o.receiveShadow = (!fx || o.receiveShadow) && !o.userData.noReceive;
  });
}

// Base colour per structure kind; inside the keep (floor, slab, partition, stair)
// is darker than its sunlit shell, so interiors read as indoors
const STRUCTURE_COLOR = {
  plinth: 0xe4e8ee, tower: 0xd6dbe2, deck: 0xeef1f4, bridge: 0xe4e8ee, wall: 0xd8cfc4, crate: 0x9a9468, barrier: 0xb8b2a6,
  keep: 0xd2d7de, parapet: 0xc4c9d0, roof: 0xd8dde4, floor: 0x9a9286, slab: 0xb2aca2, partition: 0xbab3a8, stair: 0x9c958a,
};
// Kinds that get a glowing team trim along their top edge
const TRIMMED = new Set(['plinth', 'tower', 'deck', 'bridge']);

// Structure tint per map palette, so bases match their surroundings
const STRUCTURE_TINT = { temperate: 0xffffff, desert: 0xf2dcbc, snow: 0xf3f7ff, volcanic: 0x8f8984 };

const terrainVert = /* glsl */`
  #include <common>
  #include <shadowmap_pars_vertex>
  varying vec3 vPos;
  varying vec3 vNormal;
  attribute float ao;
  varying float vAo;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec3 transformedNormal = normalMatrix * normal;
    vPos = worldPosition.xyz;
    vNormal = normal;
    vAo = ao;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    #include <shadowmap_vertex>
  }
`;

// Terrain: four ground layers (low, mid, high, cliff rock) blended by altitude,
// slope and their own texture heights, with anti-tiling, triplanar rock, bump
// lighting from the textures, sun shadows and haze that glows toward the sun.
const terrainFrag = /* glsl */`
  #include <common>
  #include <packing>
  uniform bool receiveShadow;
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  uniform sampler2D tLow, tMid, tHigh, tRock, tMacro;
  uniform vec3 sunDir, sunColor, skyColor, groundColor, fogColor;
  uniform float fogDensity, amp, time, shadowFar, texScale, bump, detail;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying float vAo;

  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  // Two samples at unrelated scales and rotations hide the repeat
  vec3 layer(sampler2D t, vec2 uv, float m) {
    vec3 a = texture2D(t, uv).rgb;
    vec3 b = texture2D(t, mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.29 + vec2(0.31, 0.17)).rgb;
    vec3 c = mix(a, b, 0.3 + 0.35 * m);
    return mix(texture2D(t, uv * 0.29, 8.0).rgb, c, detail);
  }
  vec3 triplanar(sampler2D t, vec3 p, vec3 n, float s) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= w.x + w.y + w.z;
    return texture2D(t, p.zy / s).rgb * w.x + texture2D(t, p.xz / s).rgb * w.y + texture2D(t, p.xy / s).rgb * w.z;
  }
  // Blend toward b by t, letting the brighter (raised) texels of each layer win the edge
  vec3 hblend(vec3 a, vec3 b, float t) {
    float ha = lum(a) + (1.0 - t), hb = lum(b) + t;
    float m = max(ha, hb) - 0.18;
    float wa = max(ha - m, 0.0), wb = max(hb - m, 0.0);
    return (a * wa + b * wb) / (wa + wb);
  }

  void main() {
    vec3 n = normalize(vNormal);
    float dist = length(vPos - cameraPosition);
    float macro = texture2D(tMacro, vPos.xz / 512.0).r;
    float macro2 = texture2D(tMacro, vPos.xz / 97.0).r;
    vec2 uv = vPos.xz / texScale;
    vec3 low = layer(tLow, uv, macro2);
    vec3 mid = layer(tMid, uv * 0.8, macro2);
    vec3 high = layer(tHigh, uv * 0.7, macro);
    vec3 rock = mix(triplanar(tRock, vPos, n, texScale * 1.6), triplanar(tRock, vPos * 0.27 + 13.0, n, texScale * 1.6), 0.4);
    float h = vPos.y / amp + (macro - 0.5) * 0.35;
    vec3 col = hblend(low, mid, smoothstep(0.32, 0.55, h + (macro2 - 0.5) * 0.15));
    // Worn patches of the mid layer scattered across low ground
    float patches = texture2D(tMacro, vPos.xz / 41.0 + 0.5).r;
    col = hblend(col, mid, smoothstep(0.6, 0.78, patches * 0.6 + macro2 * 0.4) * 0.75);
    col = hblend(col, high, smoothstep(0.72, 0.8, h) * smoothstep(0.55, 0.8, n.y));
    float steep = 1.0 - smoothstep(0.62, 0.82, n.y + (macro2 - 0.5) * 0.12);
    col = hblend(col, rock, steep);
    col *= 0.8 + macro * 0.4;

    // Bump from the texture's brightness, via screen-space derivatives; fades with distance
    vec3 dpx = dFdx(vPos), dpy = dFdy(vPos);
    float bh = lum(col) * bump * (1.0 - smoothstep(25.0, 110.0, dist));
    vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    vec3 bn = normalize(abs(det) * n - sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2));

    float shadow = getShadowMask();
    shadow = mix(shadow, 1.0, smoothstep(shadowFar * 0.7, shadowFar, dist));
    float cloud = smoothstep(0.52, 0.74, texture2D(tMacro, (vPos.xz + vec2(time * 7.0, time * 3.0)) / 900.0).r);
    float ndl = max(dot(bn, sunDir), 0.0);
    vec3 ambient = mix(groundColor, skyColor, bn.y * 0.5 + 0.5) * vAo;
    col *= ambient + sunColor * ndl * shadow * (0.35 + 0.65 * vAo) * (1.0 - cloud * 0.4);

    // Distance haze, warmer and brighter looking toward the sun
    vec3 vd = (vPos - cameraPosition) / max(dist, 1e-3);
    float toSun = pow(max(dot(vd, sunDir), 0.0), 6.0);
    vec3 haze = mix(fogColor, fogColor * 0.6 + sunColor * 0.5, toSun * 0.6);
    float f = 1.0 - exp(-pow(fogDensity * dist, 2.0));
    gl_FragColor = vec4(mix(col, haze, f), 1.0);
    #include <colorspace_fragment>
  }
`;

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

// Sky: gradient with a brighter horizon, sun disc and halo, sun-lit cumulus (edges
// facing the sun glow, bases darken) and a thin high cirrus layer
const skyFrag = /* glsl */`
  uniform vec3 top, horizon, fogColor, sunDir;
  uniform float time, cover;
  uniform vec3 cloudTint;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return v; }
  float density(vec2 p) { return smoothstep(0.62 - cover * 0.4, 0.95 - cover * 0.3, fbm(p)); }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y, yc = clamp(y, 0.0, 1.0);
    float s = max(dot(d, sunDir), 0.0);
    vec3 col = mix(horizon, top, pow(yc, 0.5));
    col += horizon * 0.22 * pow(1.0 - yc, 6.0);
    col += vec3(1.0, 0.82, 0.6) * (pow(s, 5.0) * 0.22 * (1.0 - yc) + pow(s, 40.0) * 0.25);
    float veil = 0.0;
    if (y > 0.0) {
      vec2 cp = d.xz / (y + 0.12);
      vec2 wind = vec2(time * 0.012, time * 0.005);
      // High cirrus streaks
      float ci = smoothstep(0.55, 0.85, fbm(vec2(cp.x * 0.5, cp.y * 2.2) * 0.8 + wind * 0.4));
      col = mix(col, vec3(1.0, 0.98, 0.95) * cloudTint, ci * 0.3 * smoothstep(0.0, 0.3, y));
      // Cumulus: compare density here with density a step toward the sun
      vec2 p = cp * 1.2 + wind;
      float dens = density(p);
      vec2 toSun = normalize(sunDir.xz + 1e-4) * 0.1;
      float dSun = density(p + toSun);
      float light = clamp(0.62 + (dens - dSun) * 2.2 - dens * 0.25, 0.22, 1.15);
      vec3 shade = mix(horizon, vec3(0.5, 0.53, 0.6), 0.5) * cloudTint;
      vec3 cloud = mix(shade, vec3(1.0, 0.97, 0.93) * cloudTint, light);
      cloud += vec3(1.0, 0.85, 0.6) * pow(s, 10.0) * dens * (1.0 - dens) * 3.0; // silver lining
      veil = dens * smoothstep(0.0, 0.22, y);
      col = mix(col, cloud, veil * 0.92);
    }
    col += vec3(1.0, 0.92, 0.75) * pow(s, 900.0) * 4.0 * (1.0 - veil);
    vec3 haze = mix(fogColor, fogColor * 0.6 + vec3(1.0, 0.9, 0.75) * 0.5, pow(s, 6.0) * 0.6);
    col = mix(col, haze, smoothstep(0.12, -0.02, y));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class GameScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.mapGroup = null;
    this.flagMeshes = [];
    this.time = 0;
  }

  setWorld(world) {
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.world = world;
    const def = world.def;
    const g = this.mapGroup = new THREE.Group();
    this.scene.add(g);

    const sun = new THREE.Vector3(...def.sun).normalize();
    this.sunDir = sun;
    const fog = new THREE.Color().setRGB(...def.sky.fog, THREE.SRGBColorSpace);
    this.fogColor = fog;
    this.fogDensity = def.fogDensity;
    this.scene.fog = new THREE.FogExp2(fog, def.fogDensity);

    // Lights for non-terrain objects
    const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(...def.sky.top, THREE.SRGBColorSpace), 0x9a8a78, 2.0);
    // Sunlight takes some of the horizon's colour: golden at dusk, pale on snow
    const horizonCol = new THREE.Color().setRGB(...def.sky.horizon, THREE.SRGBColorSpace);
    const sunTint = new THREE.Color(1, 0.95, 0.87).lerp(horizonCol, 0.35);
    sunTint.multiplyScalar(1 / Math.max(sunTint.r, sunTint.g, sunTint.b));
    this.sunTint = sunTint;
    const dir = new THREE.DirectionalLight(sunTint, 2.8);
    dir.position.copy(sun).multiplyScalar(100);
    // Sun shadows in a box that follows the camera (see updateShadows)
    dir.shadow.camera.left = dir.shadow.camera.bottom = -SHADOW_RANGE;
    dir.shadow.camera.right = dir.shadow.camera.top = SHADOW_RANGE;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 900;
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.5;
    this.sun = dir;
    this.setShadowQuality(this.shadowSize ?? 2048);
    g.add(hemi, dir, dir.target);

    // Terrain geometry: one tile, drawn 3x3 so the world wraps visually
    const N = GRID + 1;
    const pos = new Float32Array(N * N * 3);
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = (iz * N + ix) * 3;
        pos[i] = ix * CELL;
        pos[i + 1] = world.rawHeight(ix, iz);
        pos[i + 2] = iz * CELL;
      }
    }
    const idx = new Uint32Array(GRID * GRID * 6);
    let k = 0;
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const a = iz * N + ix, b = a + 1, c = a + N, d = c + 1;
        // Same split as World.height: (00,01,10) and (10,01,11)
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // Edge normals: copy from the opposite edge interior so tiles shade seamlessly
    this.fixSeamNormals(geo, world);
    geo.setAttribute('ao', new THREE.BufferAttribute(this.bakeOcclusion(world), 1));
    geo.computeBoundingSphere();

    const tex = terrainTextures(def.palette);
    const toLinear = (c) => new THREE.Color().setRGB(...c, THREE.SRGBColorSpace);
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: terrainVert,
      fragmentShader: terrainFrag,
      lights: true, // for the shadow map uniforms
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
        tLow: { value: tex.low }, tMid: { value: tex.mid }, tHigh: { value: tex.high }, tRock: { value: tex.rock }, tMacro: { value: tex.macro },
        sunDir: { value: sun },
        sunColor: { value: sunTint.clone().multiplyScalar(0.95) },
        skyColor: { value: toLinear(def.sky.top).lerp(new THREE.Color(0.5, 0.52, 0.58), 0.5).multiplyScalar(0.95) },
        groundColor: { value: new THREE.Color(0.3, 0.27, 0.23) },
        fogColor: { value: fog },
        fogDensity: { value: def.fogDensity },
        amp: { value: def.amp },
        time: { value: 0 },
        shadowFar: { value: SHADOW_RANGE },
        texScale: { value: 14 }, // metres per procedural texture repeat
        bump: { value: 0 },
        detail: { value: 1 }, // contrast of the ground layers against their average
      },
    });
    // Swap in the generated ground textures once they load
    const set = TERRAIN_SETS[def.palette], mat = this.terrainMat;
    if (set) {
      Promise.all(['low', 'mid', 'high', 'rock'].map((k) => loadSurface(set[k]))).then((loaded) => {
        if (this.terrainMat !== mat || loaded.some((t) => !t)) return;
        ['tLow', 'tMid', 'tHigh', 'tRock'].forEach((u, i) => { mat.uniforms[u].value = loaded[i]; });
        mat.uniforms.texScale.value = 7;
        mat.uniforms.bump.value = 0.12;
        mat.uniforms.detail.value = 0.72;
        if (this.cover) {
          const cu = this.cover.material.uniforms;
          cu.tGround.value = loaded[0];
          cu.groundMix.value = 0.85;
        }
      });
    }
    for (let tx = -1; tx <= 1; tx++) {
      for (let tz = -1; tz <= 1; tz++) {
        const m = new THREE.Mesh(geo, this.terrainMat);
        m.receiveShadow = true;
        m.position.set(tx * SIZE, 0, tz * SIZE);
        m.frustumCulled = true;
        m.geometry.boundingSphere.center.set(SIZE / 2, def.amp / 2, SIZE / 2);
        m.geometry.boundingSphere.radius = SIZE * 0.75;
        g.add(m);
      }
    }

    // Sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, depthWrite: false, side: THREE.BackSide,
      uniforms: {
        top: { value: toLinear(def.sky.top) }, horizon: { value: toLinear(def.sky.horizon) }, fogColor: { value: fog },
        sunDir: { value: sun }, time: { value: 0 }, cover: { value: CLOUD_COVER[def.palette] ?? 0.45 },
        cloudTint: { value: new THREE.Color(...(CLOUD_TINT[def.palette] || [1, 1, 1])) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    g.add(this.sky);
    // Lens flare riding on the sky dome (which follows the camera), hidden when terrain blocks the sun
    const flare = new Lensflare();
    const flareTint = new THREE.Color().setRGB(...def.sky.horizon, THREE.SRGBColorSpace).lerp(new THREE.Color(0xffffff), 0.5);
    flare.addElement(new LensflareElement(flareTexture('glow'), 420, 0, flareTint));
    flare.addElement(new LensflareElement(flareTexture('ring'), 70, 0.45, flareTint));
    flare.addElement(new LensflareElement(flareTexture('hex'), 50, 0.62));
    flare.addElement(new LensflareElement(flareTexture('hex'), 90, 0.8));
    flare.addElement(new LensflareElement(flareTexture('ring'), 140, 1.0));
    flare.position.copy(sun).multiplyScalar(2800);
    this.sky.add(flare);

    this.buildStructures(g, world);
    this.buildFlags(g, world);
    this.buildObjects(g, world);
    this.sceneryGroup = buildScenery(world);
    g.add(this.sceneryGroup);
    // Ground cover and fluids sample the heightmap on the GPU
    this.hmap = heightTexture(world);
    const skyTop = new THREE.Color().setRGB(...def.sky.top, THREE.SRGBColorSpace);
    const skyHorizon = new THREE.Color().setRGB(...def.sky.horizon, THREE.SRGBColorSpace);
    this.cover = buildGroundCover(world, this.hmap, sun, fog, def.fogDensity);
    if (this.cover) {
      this.cover.receiveShadow = true;
      this.cover.material.uniforms.skyColor.value.copy(this.terrainMat.uniforms.skyColor.value);
      this.cover.material.uniforms.sunColor.value.copy(this.terrainMat.uniforms.sunColor.value);
      g.add(this.cover);
    }
    this.fluid = buildFluid(world, this.hmap, sun, fog, def.fogDensity, skyTop, skyHorizon);
    if (this.fluid) g.add(this.fluid);
    this.decor = buildBaseDecor(world);
    g.add(this.decor);
    this.buildMissionBounds(g, world);
    castShadows(g);
  }

  // Shadow map resolution; 0 turns sun shadows off
  setShadowQuality(size) {
    this.shadowSize = size;
    if (!this.sun) return;
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  // Keep the shadow box centred on the camera, snapped to whole shadow texels so
  // edges don't crawl as you move
  updateShadows(camPos) {
    if (!this.sun?.castShadow) return;
    const texel = (SHADOW_RANGE * 2) / this.shadowSize;
    const t = this.sun.target.position;
    t.set(Math.round(camPos.x / texel) * texel, Math.round(camPos.y / texel) * texel, Math.round(camPos.z / texel) * texel);
    this.sun.position.copy(t).addScaledVector(this.sunDir, 400);
  }

  // Per-vertex occlusion: how much of the sky each terrain vertex can see,
  // plus soft contact shadows under structures, trees and boulders.
  bakeOcclusion(world) {
    const N = GRID + 1;
    const ao = new Float32Array(N * N);
    const dirs = 8, steps = [1, 2, 4, 7, 11];
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const h = world.rawHeight(ix, iz);
        let occ = 0;
        for (let d = 0; d < dirs; d++) {
          const a = d / dirs * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
          let maxSlope = 0;
          for (const st of steps) {
            const hh = world.rawHeight(Math.round(ix + cx * st), Math.round(iz + cz * st));
            maxSlope = Math.max(maxSlope, (hh - h) / (st * CELL));
          }
          occ += maxSlope / Math.sqrt(1 + maxSlope * maxSlope); // sine of the horizon angle
        }
        ao[iz * N + ix] = 1 - Math.min(0.75, (occ / dirs) * 1.3);
      }
    }
    const darken = (x, z, r, strength) => {
      const r2 = r + CELL;
      for (let iz = Math.floor((z - r2) / CELL); iz <= Math.ceil((z + r2) / CELL); iz++) {
        for (let ix = Math.floor((x - r2) / CELL); ix <= Math.ceil((x + r2) / CELL); ix++) {
          if (ix < 0 || iz < 0 || ix > GRID || iz > GRID) continue;
          const d = Math.hypot(ix * CELL - x, iz * CELL - z);
          const k = 1 - Math.min(1, Math.max(0, (d - r * 0.6) / (r2 - r * 0.6)));
          ao[iz * N + ix] *= 1 - strength * k;
        }
      }
    };
    for (const b of world.boxes) {
      if (b.min[1] > world.height((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2) + 3) continue; // floating decks
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      darken(cx, cz, Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) * 0.6, 0.45);
    }
    for (const sc of world.scenery) {
      if (sc.kind === 'rock') continue;
      darken(sc.x, sc.z, sc.kind === 'spire' ? 6 * sc.s : sc.kind === 'boulder' ? sc.s * 1.3 : 3.2 * sc.s, 0.3);
    }
    // Wrap the seam rows like the heights do
    for (let i = 0; i < N; i++) { ao[GRID * N + i] = ao[i]; ao[i * N + GRID] = ao[i * N]; }
    return ao;
  }

  fixSeamNormals(geo, world) {
    const N = GRID + 1;
    const nrm = geo.attributes.normal;
    const tmp = [0, 1, 0];
    for (let i = 0; i < N; i++) {
      for (const [ix, iz] of [[i, 0], [i, GRID], [0, i], [GRID, i]]) {
        // Average a finite-difference normal using the wrapped heightfield
        const hL = world.rawHeight(ix - 1, iz), hR = world.rawHeight(ix + 1, iz);
        const hD = world.rawHeight(ix, iz - 1), hU = world.rawHeight(ix, iz + 1);
        tmp[0] = (hL - hR) / (2 * CELL); tmp[1] = 1; tmp[2] = (hD - hU) / (2 * CELL);
        const l = Math.hypot(...tmp);
        nrm.setXYZ(iz * N + ix, tmp[0] / l, tmp[1] / l, tmp[2] / l);
      }
    }
  }

  buildStructures(g, world) {
    const metal = metalTexture();
    const mats = {};
    const matFor = (kind, team) => {
      const key = kind + team;
      if (mats[key]) return mats[key];
      const tint = new THREE.Color(STRUCTURE_COLOR[kind] || 0xdddddd);
      if (kind !== 'crate') tint.multiply(new THREE.Color(STRUCTURE_TINT[world.def.palette] ?? 0xffffff));
      const m = new THREE.MeshLambertMaterial({ map: metal, color: tint });
      // Generated surface once loaded: cladding, concrete or ribbed crate steel, bump from its own detail
      const [id, repeat] = { wall: ['concrete', 1], barrier: ['concrete', 1], stair: ['concrete', 1], crate: ['cargo_crate', 3] }[kind] || ['hull_panels', 1];
      loadSurface(id).then((t) => {
        if (!t) return;
        if (repeat !== 1) { t = t.clone(); t.repeat.set(repeat, repeat); }
        m.map = m.bumpMap = t;
        m.bumpScale = 2;
        m.color.multiplyScalar(0.85);
        m.needsUpdate = true;
      });
      mats[key] = m;
      return m;
    };
    // One merged mesh per material per base (a keep is a couple of hundred boxes),
    // copied into the neighbouring terrain tiles
    const groups = new Map();
    for (const b of world.boxes) {
      if (b.kind === 'gen' || b.kind === 'turret') continue; // drawn as their own models
      const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      // Scale UVs to world size so panels don't stretch
      const uv = geo.attributes.uv, nrm = geo.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
        const w = nx > 0.5 ? sz : sx, h = ny > 0.5 ? sz : sy;
        uv.setXY(i, uv.getX(i) * w / 8, uv.getY(i) * h / 8);
      }
      geo.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      const key = `${b.kind}:${b.team}`;
      if (!groups.has(key)) groups.set(key, { mat: matFor(b.kind, b.team), geos: [] });
      groups.get(key).geos.push(geo);
      if (TRIMMED.has(b.kind)) {
        // Glowing team trim around the top edge
        const trim = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.15, 0.3, sz + 0.15),
          new THREE.MeshBasicMaterial({ color: TEAM_COLORS[b.team], fog: true }));
        trim.position.set((b.min[0] + b.max[0]) / 2, b.max[1] - 0.2, (b.min[2] + b.max[2]) / 2);
        g.add(trim);
      }
    }
    for (const { mat, geos } of groups.values()) {
      const merged = mergeGeometries(geos);
      geos.forEach((x) => x.dispose());
      merged.computeBoundingSphere();
      for (let tx = -1; tx <= 1; tx++) {
        for (let tz = -1; tz <= 1; tz++) {
          const m = new THREE.Mesh(merged, mat);
          m.position.set(tx * SIZE, 0, tz * SIZE);
          g.add(m);
        }
      }
    }
  }

  buildFlags(g, world) {
    this.flagMeshes = [];
    this.beacons = [];
    for (let team = 0; team < 2; team++) {
      const grp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.3, 10), new THREE.MeshLambertMaterial({ color: 0xc8ccd2, map: metalTexture() }));
      pole.position.y = 1.65;
      // Glowing finial in team colour on top of the pole
      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(TEAM_COLORS[team]).lerp(new THREE.Color(0xffffff), 0.35) }));
      finial.position.y = 3.4;
      const clothGeo = new THREE.PlaneGeometry(1.9, 1.2, 12, 6);
      clothGeo.translate(0.95, 0, 0);
      const cloth = new THREE.Mesh(clothGeo, new THREE.MeshLambertMaterial({ map: flagTexture(team), side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: flagTexture(team), emissiveIntensity: 0.35 }));
      cloth.position.y = 2.65;
      grp.add(pole, finial, cloth);
      grp.userData = { cloth, base: clothGeo.attributes.position.array.slice() };
      const stand = world.flagStands[team];
      const beacon = new THREE.Group();
      const beamTex = beamTexture();
      for (const [r, op] of [[0.9, 0.12], [0.25, 0.3]]) {
        beacon.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 420, 16, 1, true).translate(0, 210, 0),
          new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], map: beamTex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
      }
      beacon.position.set(stand[0], stand[1], stand[2]);
      g.add(beacon);
      this.beacons[team] = beacon;
      g.add(grp);
      this.flagMeshes.push(grp);

      // Stand ring
      const s = world.flagStands[team];
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.15, 6, 32), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(s[0], s[1] + 0.1, s[2]);
      g.add(ring);
    }
  }

  // Faint wall at the edge of the play area
  buildMissionBounds(g, world) {
    const h = world.boundsHalf, c = world.center;
    // A grid that lights up only around you as you approach the edge
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { camPos: { value: new THREE.Vector3() }, strength: { value: 0 }, time: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 camPos; uniform float strength, time; varying vec3 vW;
        void main() {
          float d = distance(vW, camPos);
          float reveal = smoothstep(45.0, 6.0, d) * strength;
          vec2 g = abs(fract(vec2(vW.x + vW.z, vW.y) / 3.0) - 0.5);
          float line = smoothstep(0.44, 0.5, max(g.x, g.y));
          float pulse = 0.6 + 0.4 * sin(time * 3.0 - d * 0.25);
          gl_FragColor = vec4(vec3(1.0, 0.35, 0.25), reveal * (0.03 + line * 0.38 * pulse));
        }`,
    });
    this.boundsMat = mat;
    const geo = new THREE.PlaneGeometry(h * 2, 600);
    for (const [x, z, ry] of [[c[0], c[1] - h, 0], [c[0], c[1] + h, 0], [c[0] - h, c[1], Math.PI / 2], [c[0] + h, c[1], Math.PI / 2]]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 250, z);
      m.rotation.y = ry;
      g.add(m);
    }
  }

  buildObjects(g, world) {
    this.objParent = g;
    this.objMeshes = world.objects.map((o) => {
      const m = o.type === 'gen' ? createGenerator(o.team)
        : o.type === 'turret' ? createTurret(o.team)
        : o.type === 'station' ? createStation(o.team)
        : createVehiclePad(o.team);
      if (o.type === 'gen') m.position.set(o.pos[0], o.box.min[1], o.pos[2]);
      else if (o.type === 'turret') m.position.set(o.pos[0], o.box.max[1] - 0.6, o.pos[2]);
      else m.position.set(o.pos[0], o.pos[1] + 0.01, o.pos[2]);
      castShadows(m);
      g.add(m);
      return m;
    });
  }

  // Swap in generated trees and rocks that finished loading after the map was built
  rebuildScenery(world) {
    if (!this.sceneryGroup) return;
    this.mapGroup.remove(this.sceneryGroup);
    this.sceneryGroup = buildScenery(world);
    castShadows(this.sceneryGroup);
    this.mapGroup.add(this.sceneryGroup);
  }

  // Swap in models that finished loading after the map was built
  rebuildObjects(world) {
    if (!this.objMeshes) return;
    for (const m of this.objMeshes) this.objParent.remove(m);
    this.buildObjects(this.objParent, world);
  }

  // ob: per object [hp, disabled, yaw, pitch]; power: per team 0/1
  updateObjects(world, ob, power, dt) {
    if (!this.objMeshes || !ob) return;
    const dead = new THREE.Color(0x30302e);
    world.objects.forEach((o, i) => {
      const m = this.objMeshes[i], s = ob[i];
      if (!m || !s) return;
      const on = !s[1] && power[o.team];
      const u = m.userData;
      if (o.type === 'gen') {
        u.coreMat.color.copy(s[1] ? dead : u.color);
        u.rings.forEach((r, k) => { r.visible = !s[1]; r.rotation.z += dt * (1.5 + k * 0.7) * (k % 2 ? -1 : 1); });
        if (u.glowMats) for (const mat of u.glowMats) { mat.emissiveIntensity = s[1] ? 0 : u.glow; mat.color.setScalar(s[1] ? 0.4 : 1); }
      } else if (o.type === 'turret') {
        u.head.rotation.y = s[2];
        u.tilt.rotation.x = s[3];
        u.eyeMat.color.copy(on ? u.color : dead);
        if (u.glowMats) for (const mat of u.glowMats) { mat.emissiveIntensity = on ? u.glow : 0; mat.color.setScalar(on ? 1 : 0.4); }
      } else if (o.type === 'station') {
        u.beam.visible = on;
        u.padMat.opacity = on ? 0.55 : 0.12;
        if (on) u.ring.rotation.z += dt;
      }
    });
  }

  // Grass follows the camera; water, lava, clouds and base effects animate
  updateEnv(camPos, t) {
    this.updateShadows(camPos);
    animateScenery(t);
    if (this.cover) this.cover.userData.update(camPos, t);
    if (this.fluid) this.fluid.userData.update(t);
    if (this.terrainMat) this.terrainMat.uniforms.time.value = t;
    if (this.decor) this.decor.userData.animate(t);
    // Boundary walls only appear as you get close to the edge of the play area
    if (this.boundsMat && this.world) {
      const w = this.world;
      const edge = w.boundsHalf - Math.max(Math.abs(camPos.x - w.center[0]), Math.abs(camPos.z - w.center[1]));
      const k = Math.max(0, Math.min(1, 1 - edge / 80));
      this.boundsMat.uniforms.strength.value = k;
      this.boundsMat.uniforms.camPos.value.copy(camPos);
      this.boundsMat.uniforms.time.value = t;
      this.boundsMat.visible = k > 0;
    }
  }

  updateFlags(flagState, dt) {
    this.time += dt;
    for (let i = 0; i < this.flagMeshes.length; i++) {
      const grp = this.flagMeshes[i];
      const f = flagState[i];
      if (!f) continue;
      grp.visible = f.visible !== false;
      if (this.beacons[i]) this.beacons[i].visible = f.state === 0;
      grp.position.set(f.pos[0], f.pos[1] - (f.state === 1 ? 1.2 : 0), f.pos[2]);
      const { cloth, base } = grp.userData;
      const arr = cloth.geometry.attributes.position.array;
      for (let v = 0; v < arr.length; v += 3) {
        const x = base[v];
        arr[v + 2] = Math.sin(x * 2.4 - this.time * 7 + i) * 0.18 * x;
      }
      cloth.geometry.attributes.position.needsUpdate = true;
      grp.rotation.y += dt * 0.4;
    }
    if (this.skyMat) this.skyMat.uniforms.time.value = this.time;
    // Tower beacons blink in a slow double pulse
    if (this.decor) {
      const on = (this.time % 2.4) < 0.15 || ((this.time % 2.4) > 0.35 && (this.time % 2.4) < 0.5);
      for (const b of this.decor.userData.beacons) b.visible = on;
    }
  }
}

// Lens flare sprites, drawn once
const flareCache = {};
function flareTexture(kind) {
  if (flareCache[kind]) return flareCache[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (kind === 'glow') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.15, 'rgba(255,248,230,0.7)');
    grad.addColorStop(0.4, 'rgba(255,230,200,0.15)'); grad.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  } else if (kind === 'ring') {
    const grad = g.createRadialGradient(64, 64, 40, 64, 64, 62);
    grad.addColorStop(0, 'rgba(200,230,255,0)'); grad.addColorStop(0.7, 'rgba(200,230,255,0.22)'); grad.addColorStop(1, 'rgba(200,230,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  } else {
    g.fillStyle = 'rgba(180,220,255,0.16)';
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); }
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (flareCache[kind] = t);
}

// Vertical fade for the flag beacon: bright at the base, gone at the top
let beamTexCache;
function beamTexture() {
  if (beamTexCache) return beamTexCache;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  return (beamTexCache = new THREE.CanvasTexture(c));
}
