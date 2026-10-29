#!/usr/bin/env node
// Generate 3D models on fal.ai: reference image -> Meshy image-to-3D -> web-optimised GLB.
//
//   node scripts/generate-models.js --dry-run          price what would be generated
//   node scripts/generate-models.js --images-only      make just the reference images, to review first
//   node scripts/generate-models.js                    run every step not yet cached
//   node scripts/generate-models.js --only skiff --redo image   re-roll a reference image (and its mesh)
//   node scripts/generate-models.js --redo mesh        rebuild meshes from existing references
//
// Pay-once: every step's output is cached under assets-src/models/<id>/ and a
// step whose output exists is skipped, so reruns only pay for what's missing.
// Optimised GLBs land in public/models/<id>.glb (+ animation clips for rigged
// characters) with an index.json the game reads. Needs FAL_KEY in the environment.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MODELS, USD } from './model-manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src', 'models');
const OUT = path.join(ROOT, 'public', 'models');
const QUEUE = 'https://queue.fal.run';
const IMAGE_MODEL = 'fal-ai/nano-banana';
const MESH_MODEL = 'fal-ai/meshy/v6/image-to-3d';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const redo = opt('--redo');            // 'image' (implies mesh) or 'mesh'
const dry = args.includes('--dry-run');
const imagesOnly = args.includes('--images-only'); // review references before paying for meshes

const assets = MODELS.filter((m) => !only || only.has(m.id));
const dir = (id) => path.join(SRC, id);
const has = (id, f) => fs.existsSync(path.join(dir(id), f));

// What each asset still needs
const plan = assets.map((m) => {
  const needImage = redo === 'image' || !has(m.id, 'ref.png');
  const needMesh = needImage || redo === 'mesh' || !has(m.id, 'meshy.json');
  return { m, needImage, needMesh };
});
const usd = plan.reduce((s, p) => s + (p.needImage ? USD.image : 0) + (p.needMesh ? USD.mesh : 0), 0);
console.log(plan.map((p) => `  ${p.m.id.padEnd(22)} ${p.needImage ? 'image ' : ''}${p.needMesh ? 'mesh' : ''}${!p.needImage && !p.needMesh ? 'cached' : ''}`).join('\n'));
console.log(`To generate: ~$${usd.toFixed(2)} on fal (image $${USD.image}, mesh $${USD.mesh} each).`);
if (dry) process.exit(0);

const KEY = process.env.FAL_KEY;
if (!KEY && usd > 0) { console.error('FAL_KEY is not set.'); process.exit(1); }

async function fal(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' } });
    if (res.ok) return res.json();
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt)); continue; }
    throw new Error(`${res.status}: ${body.slice(0, 400)}`);
  }
}

// Submit to the fal queue and wait for the result (Meshy takes 5-10 minutes)
async function run(endpoint, input, label) {
  const sub = await fal(`${QUEUE}/${endpoint}`, { method: 'POST', body: JSON.stringify(input) });
  const t0 = Date.now();
  for (;;) {
    const st = await fal(sub.status_url);
    if (st.status === 'COMPLETED') break;
    if (Date.now() - t0 > 20 * 60000) throw new Error('timed out after 20 minutes');
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`  ${label}: done in ${Math.round((Date.now() - t0) / 1000)}s`);
  return fal(sub.response_url);
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// Compress for the web: WebP textures capped at 1024px, meshopt geometry
function optimize(src, dst) {
  const cli = path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
  execFileSync(process.execPath, [cli, 'optimize', src, dst, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false'], { stdio: 'pipe' });
}

async function build({ m, needImage, needMesh }) {
  fs.mkdirSync(dir(m.id), { recursive: true });
  if (needImage) {
    const r = await run(IMAGE_MODEL, { prompt: m.image, num_images: 1, aspect_ratio: m.aspect || (m.kind === 'character' ? '3:2' : '4:3'), output_format: 'png' }, `${m.id} reference image`);
    const url = r.images[0].url;
    await download(url, path.join(dir(m.id), 'ref.png'));
    fs.writeFileSync(path.join(dir(m.id), 'ref.json'), JSON.stringify({ url, prompt: m.image }, null, 2));
  }
  if (needMesh && !imagesOnly) {
    const ref = JSON.parse(fs.readFileSync(path.join(dir(m.id), 'ref.json'), 'utf8'));
    const r = await run(MESH_MODEL, { image_url: ref.url, should_texture: true, ...m.meshy }, `${m.id} mesh`);
    fs.writeFileSync(path.join(dir(m.id), 'meshy.json'), JSON.stringify(r, null, 2));
    await download(r.model_glb.url, path.join(dir(m.id), 'model.glb'));
    if (r.rigged_character_glb) await download(r.rigged_character_glb.url, path.join(dir(m.id), 'rigged.glb'));
    // Walk/run clips: keep the skeleton-only GLBs (the full ones repeat the mesh, the rest are FBX)
    for (const [key, file] of Object.entries(r.basic_animations || {})) {
      const name = { walking_armature_glb: 'walk', running_armature_glb: 'run' }[key];
      if (name && file?.url) await download(file.url, path.join(dir(m.id), `anim_${name}.glb`));
    }
  }
}

fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const results = await Promise.allSettled(plan.filter((p) => p.needImage || p.needMesh).map(build));
results.forEach((r) => { if (r.status === 'rejected') console.error('  FAILED:', r.reason.message); });

// Optimise everything that has a source mesh and write the index
const index = {};
for (const m of MODELS) {
  const d = dir(m.id);
  const src = fs.existsSync(path.join(d, 'rigged.glb')) ? 'rigged.glb' : fs.existsSync(path.join(d, 'model.glb')) ? 'model.glb' : null;
  if (!src) continue;
  const entry = { kind: m.kind, file: `${m.id}.glb`, rigged: src === 'rigged.glb', anims: {} };
  optimize(path.join(d, src), path.join(OUT, entry.file));
  for (const f of fs.readdirSync(d).filter((f) => /^anim_.+\.glb$/.test(f))) {
    const name = f.slice(5, -4);
    optimize(path.join(d, f), path.join(OUT, `${m.id}_${name}.glb`));
    entry.anims[name] = `${m.id}_${name}.glb`;
  }
  const kb = Math.round(fs.statSync(path.join(OUT, entry.file)).size / 1024);
  console.log(`  ${m.id}: ${src} -> ${entry.file} (${kb} KB)${Object.keys(entry.anims).length ? ' + ' + Object.keys(entry.anims).join(', ') : ''}`);
  index[m.id] = entry;
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
console.log(`index.json lists ${Object.keys(index).length} models.`);
