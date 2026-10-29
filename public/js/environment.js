import * as THREE from 'three';
import { GRID, CELL, SIZE } from '../shared/world.js';

// Terrain heights (R) and ground-cover density (G) as a float texture, so the
// GPU can place grass and measure water depth without any CPU work per frame.
function heightTexture(world) {
  const N = GRID + 1;
  const data = new Float32Array(N * N * 2);
  const n = [0, 1, 0];
  const def = world.def;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = ix * CELL, z = iz * CELL, h = world.rawHeight(ix, iz);
      world.normal(x + 0.1, z + 0.1, n);
      // Cover grows on gentle, low ground away from bases and above any fluid
      let d = Math.min(1, Math.max(0, (n[1] - 0.8) / 0.1));
      d *= 1 - Math.min(1, Math.max(0, (h / def.amp - 0.5) / 0.15));
      if (world.fluid) d *= Math.min(1, Math.max(0, (h - world.fluid.level - 0.5) / 2));
      for (const b of world.bases) {
        let dx = Math.abs(x - b.wx), dz = Math.abs(z - b.wz);
        dx = Math.min(dx, SIZE - dx); dz = Math.min(dz, SIZE - dz);
        d *= Math.min(1, Math.max(0, (Math.hypot(dx, dz) - 50) / 25));
      }
      data[(iz * N + ix) * 2] = h;
      data[(iz * N + ix) * 2 + 1] = d;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

// Shared GLSL: bilinear height/density lookup with wrap-around, via texelFetch
const sampleChunk = /* glsl */`
  uniform sampler2D hmap;
  vec2 hsample(vec2 xz) {
    vec2 g = xz / ${CELL.toFixed(1)};
    vec2 i = floor(g), f = g - i;
    ivec2 a = ivec2(mod(i, ${GRID.toFixed(1)}));
    ivec2 b = ivec2(mod(i + 1.0, ${GRID.toFixed(1)}));
    vec2 h00 = texelFetch(hmap, ivec2(a.x, a.y), 0).rg, h10 = texelFetch(hmap, ivec2(b.x, a.y), 0).rg;
    vec2 h01 = texelFetch(hmap, ivec2(a.x, b.y), 0).rg, h11 = texelFetch(hmap, ivec2(b.x, b.y), 0).rg;
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
`;

// ---------- grass / scrub ----------

function bladeTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  if (kind === 'grass') {
    for (let i = 0; i < 14; i++) {
      const x = 3 + i * 4.3 + Math.sin(i * 7.7) * 2, w = 1.8 + (i % 3) * 0.7, top = 10 + ((i * 17) % 26), lean = Math.sin(i * 3.3) * 7;
      g.beginPath(); g.moveTo(x - w, 64); g.quadraticCurveTo(x + lean * 0.3, 40, x + lean, top); g.quadraticCurveTo(x + lean * 0.4, 40, x + w, 64); g.fill();
    }
  } else {
    // Twiggy dry scrub
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    const branch = (x, y, a, len, w) => {
      if (len < 4) return;
      const x2 = x + Math.sin(a) * len, y2 = y - Math.cos(a) * len;
      g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      branch(x2, y2, a - 0.5, len * 0.68, w * 0.7);
      branch(x2, y2, a + 0.45, len * 0.62, w * 0.7);
    };
    branch(32, 64, -0.15, 22, 4); branch(26, 64, -0.7, 16, 3); branch(38, 64, 0.6, 17, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  return t;
}

const COVER = {
  grass: { count: 42000, radius: 72, w: 0.9, h: 0.5, base: [0.09, 0.15, 0.035], tip: [0.25, 0.34, 0.09] },
  scrub: { count: 2600, radius: 110, w: 1.3, h: 1.0, base: [0.22, 0.17, 0.1], tip: [0.46, 0.4, 0.24] },
};

export function buildGroundCover(world, hmap, sunDir, fogColor, fogDensity) {
  const kind = world.def.ground;
  const C = COVER[kind];
  if (!C) return null;
  // Three crossed quads per clump
  const quad = new THREE.PlaneGeometry(C.w, C.h).translate(0, C.h / 2, 0);
  const parts = [0, 1, 2].map((i) => quad.clone().rotateY((i * Math.PI) / 3));
  const pos = [], uv = [], idx = [];
  parts.forEach((p, k) => {
    pos.push(...p.attributes.position.array); uv.push(...p.attributes.uv.array);
    idx.push(...Array.from(p.index.array, (v) => v + k * 4));
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const off = new Float32Array(C.count * 2), rnd = new Float32Array(C.count * 2);
  let seed = 12345;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < C.count; i++) {
    off[i * 2] = (r() * 2 - 1) * C.radius; off[i * 2 + 1] = (r() * 2 - 1) * C.radius;
    rnd[i * 2] = r(); rnd[i * 2 + 1] = r();
  }
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute('rnd', new THREE.InstancedBufferAttribute(rnd, 2));
  geo.instanceCount = C.count;

  const mat = new THREE.ShaderMaterial({
    lights: true, // for the shadow map uniforms
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      // Ground texture under each blade (set once the generated texture loads), so blades match the terrain
      tGround: { value: null }, groundMix: { value: 0 }, texScale: { value: 7 },
      skyColor: { value: new THREE.Color(0.5, 0.55, 0.65) }, sunColor: { value: new THREE.Color(1.0, 0.92, 0.8) },
      hmap: { value: hmap }, map: { value: bladeTexture(kind) },
      camPos: { value: new THREE.Vector3() }, time: { value: 0 }, R: { value: C.radius },
      sunDir: { value: sunDir }, fogColor: { value: fogColor }, fogDensity: { value: fogDensity },
      baseCol: { value: new THREE.Color(...C.base) }, tipCol: { value: new THREE.Color(...C.tip) },
      fluidLevel: { value: world.fluid ? world.fluid.level : -1e4 },
      // Keep footprints (min x, min z, max x, max z): no grass through their floors
      noGrass: { value: world.navs.map((n) => new THREE.Vector4(n.min[0] - 0.5, n.min[2] - 0.5, n.max[0] + 0.5, n.max[2] + 0.5)) },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <shadowmap_pars_vertex>
      attribute vec2 offset;
      attribute vec2 rnd;
      uniform vec3 camPos;
      uniform float time, R, fluidLevel;
      uniform vec4 noGrass[2];
      varying vec2 vUv;
      varying float vShade;
      varying vec3 vWorld;
      ${sampleChunk}
      void main() {
        // Instances tile a square around the camera and wrap as it moves
        vec2 wxz = camPos.xz + mod(offset - camPos.xz, 2.0 * R) - R;
        vec2 hd = hsample(wxz);
        float dist = length(wxz - camPos.xz);
        float fade = 1.0 - smoothstep(R * 0.65, R, dist);
        float keep = step(rnd.x, hd.y) * step(fluidLevel + 0.3, hd.x);
        for (int k = 0; k < 2; k++) {
          vec4 r = noGrass[k];
          if (wxz.x > r.x && wxz.x < r.z && wxz.y > r.y && wxz.y < r.w) keep = 0.0;
        }
        float scale = (0.65 + rnd.y * 0.7) * fade * keep;
        float a = rnd.y * 6.2831;
        vec3 p = position * scale;
        p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
        // Wind: tips sway, gusts roll across the field
        float gust = sin(time * 0.7 + wxz.x * 0.02 + wxz.y * 0.015) * 0.5 + 0.5;
        p.x += sin(time * 2.1 + wxz.x * 0.35 + wxz.y * 0.2) * 0.12 * position.y * (0.6 + gust);
        p.z += cos(time * 1.7 + wxz.y * 0.31) * 0.06 * position.y;
        vec3 world = vec3(wxz.x, hd.x - 0.06, wxz.y) + p;
        vUv = uv;
        vShade = 0.75 + rnd.x * 0.5;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        // Shadow lookup at the blade's root, so a clump is shaded as one
        vec4 worldPosition = vec4(wxz.x, hd.x + 0.05, wxz.y, 1.0);
        vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
        #include <shadowmap_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <packing>
      uniform bool receiveShadow;
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      uniform sampler2D map, tGround;
      uniform vec3 sunDir, fogColor, baseCol, tipCol, skyColor, sunColor;
      uniform float fogDensity, groundMix, texScale;
      varying vec2 vUv;
      varying float vShade;
      varying vec3 vWorld;
      void main() {
        float a = texture2D(map, vUv).a;
        if (a < 0.5) discard;
        vec3 col = mix(baseCol, tipCol, vUv.y);
        if (groundMix > 0.0) {
          // Blades take the colour of the ground they grow from, lighter toward the tip
          vec3 g = texture2D(tGround, vWorld.xz / texScale, 3.0).rgb;
          col = mix(col, g * mix(0.75, 1.45, vUv.y) + vec3(0.03, 0.04, 0.0) * vUv.y, groundMix);
        }
        col *= vShade;
        float d = length(vWorld - cameraPosition);
        float shadow = mix(getShadowMask(), 1.0, smoothstep(66.0, 95.0, d));
        col *= skyColor * (0.55 + 0.45 * vUv.y) + sunColor * max(sunDir.y, 0.25) * shadow * (0.45 + 0.55 * vUv.y);
        float f = 1.0 - exp(-pow(fogDensity * d, 2.0));
        gl_FragColor = vec4(mix(col, fogColor, f), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.update = (cam, t) => { mat.uniforms.camPos.value.copy(cam); mat.uniforms.time.value = t; };
  mesh.userData.count = C.count;
  return mesh;
}

// ---------- water and lava ----------

export function buildFluid(world, hmap, sunDir, fogColor, fogDensity, skyTop, skyHorizon) {
  const fl = world.fluid;
  if (!fl) return null;
  const lava = fl.kind === 'lava';
  const geo = new THREE.PlaneGeometry(SIZE * 3, SIZE * 3, 1, 1).rotateX(-Math.PI / 2).translate(SIZE / 2, fl.level, SIZE / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: !lava,
    depthWrite: lava,
    uniforms: {
      hmap: { value: hmap }, time: { value: 0 }, level: { value: fl.level },
      sunDir: { value: sunDir }, fogColor: { value: fogColor }, fogDensity: { value: fogDensity },
      skyTop: { value: skyTop }, skyHorizon: { value: skyHorizon },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float time, level, fogDensity;
      uniform vec3 sunDir, fogColor, skyTop, skyHorizon;
      varying vec3 vWorld;
      ${sampleChunk}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
      void main() {
        float depth = level - hsample(vWorld.xz).x;
        if (depth < -0.2) discard;
        float d = length(vWorld - cameraPosition);
        float fog = 1.0 - exp(-pow(fogDensity * d, 2.0));
        ${lava ? `
        // Lava: slow churning crust with bright cracks
        vec2 p = vWorld.xz * 0.06;
        float flow = fbm(p + vec2(time * 0.05, time * 0.03));
        float crack = smoothstep(0.42, 0.5, fbm(p * 2.3 - vec2(time * 0.08, 0.0)));
        vec3 hot = mix(vec3(1.4, 0.35, 0.04), vec3(2.2, 1.2, 0.3), flow);
        vec3 crust = vec3(0.09, 0.05, 0.04) * (0.7 + flow);
        vec3 col = mix(hot, crust, crack * 0.85);
        col += vec3(1.5, 0.5, 0.1) * smoothstep(1.2, 0.0, depth) * 0.6; // glowing shoreline
        gl_FragColor = vec4(mix(col, fogColor, fog * 0.8), 1.0);
        ` : `
        // Water: wave normals, sky reflection, sun glint, depth tint and shoreline foam
        vec2 p = vWorld.xz;
        vec3 n = normalize(vec3(
          sin(p.x * 0.35 + time * 1.3) * 0.06 + sin(p.x * 0.9 + p.y * 0.4 + time * 2.1) * 0.03 + (noise(p * 0.5 + time * 0.4) - 0.5) * 0.08,
          1.0,
          cos(p.y * 0.3 + time * 1.1) * 0.06 + sin(p.y * 0.8 - p.x * 0.3 + time * 1.7) * 0.03 + (noise(p * 0.5 - time * 0.3) - 0.5) * 0.08));
        vec3 view = normalize(cameraPosition - vWorld);
        float fres = 0.08 + 0.92 * pow(1.0 - max(dot(n, view), 0.0), 4.0);
        vec3 refl = mix(skyHorizon, skyTop, clamp(reflect(-view, n).y * 2.0, 0.0, 1.0));
        vec3 deep = vec3(0.03, 0.12, 0.16), shallow = vec3(0.12, 0.32, 0.30);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 10.0, depth));
        col = mix(col, refl, fres);
        col += vec3(1.0, 0.95, 0.8) * pow(max(dot(reflect(-sunDir, n), view), 0.0), 120.0) * 2.5;
        float foam = smoothstep(0.9, 0.0, depth) * (0.55 + 0.45 * noise(p * 1.4 + time * 0.8));
        col = mix(col, vec3(0.9, 0.95, 1.0), foam * 0.75);
        float alpha = clamp(0.55 + depth * 0.1 + fres * 0.3, 0.0, 0.94);
        gl_FragColor = vec4(mix(col, fogColor, fog), alpha);
        `}
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.update = (t) => { mat.uniforms.time.value = t; };
  return mesh;
}

export { heightTexture };
