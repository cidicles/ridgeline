import * as THREE from 'three';

// Small deterministic RNG so textures look the same every load
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Tileable value-noise field rendered into a canvas
function noiseField(size, seed, octaves = 5, base = 4) {
  const r = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const g = base << o;
    const lat = new Float32Array(g * g);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = x / size * g, fy = y / size * g;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = lat[(y0 % g) * g + (x0 % g)], b = lat[(y0 % g) * g + ((x0 + 1) % g)];
        const c = lat[((y0 + 1) % g) * g + (x0 % g)], d = lat[((y0 + 1) % g) * g + ((x0 + 1) % g)];
        out[y * size + x] += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
      }
    }
    total += amp; amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function makeTex(size, fill, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  fill(img.data, size);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Ground texture: noisy blend between two colours plus speckle
function groundTex(seed, c1, c2, speckle = 0.15, scale = 4) {
  const size = 256;
  const n = noiseField(size, seed, 6, scale);
  const r = rng(seed + 7);
  return makeTex(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const t = Math.min(1, Math.max(0, (n[i] - 0.3) * 2.2));
      const s = 1 + (r() - 0.5) * speckle;
      d[i * 4] = Math.min(255, (c1[0] + (c2[0] - c1[0]) * t) * s);
      d[i * 4 + 1] = Math.min(255, (c1[1] + (c2[1] - c1[1]) * t) * s);
      d[i * 4 + 2] = Math.min(255, (c1[2] + (c2[2] - c1[2]) * t) * s);
      d[i * 4 + 3] = 255;
    }
  });
}

// Rock: layered strata with cracks
function rockTex(seed, base) {
  const size = 256;
  const n = noiseField(size, seed, 6, 3);
  const n2 = noiseField(size, seed + 1, 4, 8);
  return makeTex(size, (d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const strata = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 9 + n[i] * 9);
        const crack = Math.abs(n2[i] - 0.5) < 0.02 ? 0.55 : 1;
        const v = (0.7 + strata * 0.2 + (n[i] - 0.5) * 0.5) * crack;
        d[i * 4] = Math.min(255, base[0] * v);
        d[i * 4 + 1] = Math.min(255, base[1] * v);
        d[i * 4 + 2] = Math.min(255, base[2] * v);
        d[i * 4 + 3] = 255;
      }
    }
  });
}

export const PALETTES = {
  temperate: {
    low: [[74, 104, 46], [104, 120, 58]],
    mid: [[112, 96, 70], [140, 124, 92]],
    high: [[232, 236, 242], [200, 208, 220]],
    rock: [128, 120, 112],
  },
  desert: {
    low: [[196, 150, 100], [176, 120, 78]],
    mid: [[160, 92, 60], [130, 76, 52]],
    high: [[214, 186, 150], [190, 160, 124]],
    rock: [120, 72, 56],
  },
  volcanic: {
    low: [[58, 52, 50], [78, 70, 64]],
    mid: [[104, 96, 90], [86, 80, 76]],
    high: [[176, 170, 162], [150, 144, 138]],
    rock: [74, 60, 56],
  },
  snow: {
    low: [[214, 222, 232], [190, 202, 218]],
    mid: [[170, 186, 204], [220, 228, 238]],
    high: [[244, 246, 250], [226, 232, 240]],
    rock: [92, 96, 106],
  },
};

const cache = {};
export function terrainTextures(palette) {
  if (cache[palette]) return cache[palette];
  const P = PALETTES[palette];
  const seed = palette.length * 97;
  cache[palette] = {
    low: groundTex(seed + 1, P.low[0], P.low[1], 0.22, 4),
    mid: groundTex(seed + 2, P.mid[0], P.mid[1], 0.18, 6),
    high: groundTex(seed + 3, P.high[0], P.high[1], 0.06, 3),
    rock: rockTex(seed + 4, P.rock),
    macro: makeTex(256, (d, size) => {
      const n = noiseField(size, seed + 5, 5, 2);
      for (let i = 0; i < size * size; i++) { const v = n[i] * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    }, { srgb: false }),
  };
  return cache[palette];
}

// Riveted metal panel for structures
let metal;
export function metalTexture() {
  if (metal) return metal;
  const size = 256;
  const n = noiseField(size, 77, 5, 8);
  metal = makeTex(size, (d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const px = x % 64, py = y % 128;
        const seam = (px < 2 || py < 2) ? 0.55 : (px < 4 || py < 4) ? 1.15 : 1;
        const rivet = ((px - 8) ** 2 + (py - 8) ** 2 < 5 || (px - 56) ** 2 + (py - 8) ** 2 < 5) ? 1.3 : 1;
        const v = (0.62 + n[i] * 0.3) * seam * rivet;
        d[i * 4] = Math.min(255, 205 * v);
        d[i * 4 + 1] = Math.min(255, 210 * v);
        d[i * 4 + 2] = Math.min(255, 218 * v);
        d[i * 4 + 3] = 255;
      }
    }
  });
  return metal;
}

// Soft round sprite for particles
let soft;
export function softTexture() {
  if (soft) return soft;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  soft = new THREE.CanvasTexture(c);
  return soft;
}

// ---------- generated surfaces (scripts/generate-textures.js) ----------

// Generated textures per palette: low ground, mid ground, high ground, cliff rock
export const TERRAIN_SETS = {
  temperate: { low: 'grass', mid: 'meadow_dirt', high: 'snow', rock: 'cliff_rock' },
  desert: { low: 'sand', mid: 'red_earth', high: 'pale_sand', rock: 'sandstone' },
  snow: { low: 'snow', mid: 'packed_snow', high: 'snow', rock: 'granite' },
  volcanic: { low: 'ash', mid: 'gravel', high: 'pale_ash', rock: 'basalt' },
};

let surfaceIndex = null;
const surfaces = {};
// Resolves to a repeating, mipmapped texture, or null when it hasn't been generated
export async function loadSurface(id, anisotropy = 8) {
  surfaceIndex ||= fetch('textures/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const index = await surfaceIndex;
  if (!index[id]) return null;
  surfaces[id] ||= new THREE.TextureLoader().loadAsync(`textures/${index[id]}`).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    return t;
  }).catch(() => null);
  return surfaces[id];
}
