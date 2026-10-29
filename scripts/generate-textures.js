#!/usr/bin/env node
// Generate seamless surface textures on fal.ai (nano-banana) for the terrain.
//
//   node scripts/generate-textures.js --dry-run        price what would be generated
//   node scripts/generate-textures.js                  generate everything not yet cached
//   node scripts/generate-textures.js --only sand --redo   re-roll one texture
//
// Pay-once: raw images are cached in assets-src/textures/<id>.png. Every run then
// rebuilds public/textures/<id>.webp: made seamless with a two-pass offset blend
// (variance-preserving, so the blend zone keeps its contrast), 1024px WebP, plus
// index.json for the game. Needs FAL_KEY in the environment.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TEXTURES, USD } from './texture-manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src', 'textures');
const OUT = path.join(ROOT, 'public', 'textures');
const QUEUE = 'https://queue.fal.run';
const MODEL = 'fal-ai/nano-banana';
const SIZE = 1024;

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const redo = args.includes('--redo');
const dry = args.includes('--dry-run');

const raw = (id) => path.join(SRC, `${id}.png`);
const todo = TEXTURES.filter((t) => (!only || only.has(t.id)) && (redo || !fs.existsSync(raw(t.id))));
console.log(`To generate: ${todo.map((t) => t.id).join(', ') || 'nothing'} (~$${(todo.length * USD).toFixed(2)})`);
if (dry) process.exit(0);
const KEY = process.env.FAL_KEY;
if (todo.length && !KEY) { console.error('FAL_KEY is not set.'); process.exit(1); }

async function fal(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' } }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) return res.json();
    const body = await res.text();
    if ((res.status === 0 || res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt)); continue; }
    throw new Error(`${res.status}: ${body.slice(0, 300)}`);
  }
}

async function generate(t) {
  const sub = await fal(`${QUEUE}/${MODEL}`, { method: 'POST', body: JSON.stringify({ prompt: t.prompt, num_images: 1, aspect_ratio: '1:1', output_format: 'png' }) });
  for (;;) {
    const st = await fal(sub.status_url);
    if (st.status === 'COMPLETED') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const r = await fal(sub.response_url);
  const img = await fetch(r.images[0].url);
  fs.writeFileSync(raw(t.id), Buffer.from(await img.arrayBuffer()));
  console.log(`  ${t.id}: generated`);
}

// Blend the image with a copy shifted by half along one axis. The shifted copy
// tiles across that axis; the original covers the copy's seam in the middle.
// Rescaling the blend by sqrt(w^2 + (1-w)^2) keeps the blend zone's contrast.
function seamlessAxis(px, n, ch, alongX) {
  const out = new Float32Array(px.length), mean = new Float64Array(ch);
  for (let i = 0; i < px.length; i++) mean[i % ch] += px[i];
  for (let c = 0; c < ch; c++) mean[c] /= n * n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = (alongX ? x : y) / n, d = Math.abs(t - 0.5);
      const k = Math.min(1, Math.max(0, (d - 0.18) / 0.27));
      const w = 1 - k * k * (3 - 2 * k); // 1 in the middle, 0 at the edges
      const sx = alongX ? (x + n / 2) % n : x, sy = alongX ? y : (y + n / 2) % n;
      const norm = Math.sqrt(w * w + (1 - w) * (1 - w));
      for (let c = 0; c < ch; c++) {
        const a = px[(y * n + x) * ch + c], b = px[(sy * n + sx) * ch + c];
        out[(y * n + x) * ch + c] = (a * w + b * (1 - w) - mean[c]) / norm + mean[c];
      }
    }
  }
  return out;
}

async function process1(t) {
  const { data, info } = await sharp(raw(t.id)).resize(SIZE, SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let px = Float32Array.from(data);
  if (t.seamless !== false) {
    px = seamlessAxis(px, SIZE, info.channels, true);
    px = seamlessAxis(px, SIZE, info.channels, false);
  }
  const bytes = Uint8Array.from(px, (v) => Math.max(0, Math.min(255, Math.round(v))));
  await sharp(bytes, { raw: { width: SIZE, height: SIZE, channels: info.channels } }).webp({ quality: 86 }).toFile(path.join(OUT, `${t.id}.webp`));
}

fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const results = await Promise.allSettled(todo.map(generate));
results.forEach((r, i) => { if (r.status === 'rejected') console.error(`  FAILED ${todo[i].id}:`, r.reason.message); });
const index = {};
for (const t of TEXTURES) {
  if (!fs.existsSync(raw(t.id))) continue;
  await process1(t);
  index[t.id] = `${t.id}.webp`;
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
const kb = Object.values(index).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0) / 1024;
console.log(`index.json lists ${Object.keys(index).length} textures (${Math.round(kb)} KB).`);
