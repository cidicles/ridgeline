#!/usr/bin/env node
// Generate the game's sound effects with ElevenLabs Sound Effects v2 on fal.ai.
//
//   node scripts/generate-sfx.js --dry-run           price the whole set, spend nothing
//   node scripts/generate-sfx.js                     generate everything not yet on disk
//   node scripts/generate-sfx.js --only fire_disc,boom_disc --force
//   node scripts/generate-sfx.js --env-file ../somewhere/.env
//
// Pay-once: a variant whose file already exists is never requested again, so a
// rerun after a failure only pays for what is missing. --force regenerates the
// listed sounds. Writes public/audio/sfx/<id>_<n>.mp3 plus index.json, which the
// game reads to know what exists (anything absent falls back to synthesis).
//
// Needs FAL_KEY (fal.ai) or ELEVENLABS_API_KEY (ElevenLabs direct, same model) in
// the environment, or in a KEY=value file passed with --env-file. fal is used
// when both are present.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX, estimate } from './sfx-manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'audio', 'sfx');
const ENDPOINT = 'fal-ai/elevenlabs/sound-effects/v2';
const QUEUE = 'https://queue.fal.run';
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const force = flag('--force');
const dry = flag('--dry-run');

const file = (id, i) => path.join(OUT, `${id}_${i}.mp3`);
const wanted = SFX.filter((e) => !only || only.has(e.id));
const jobs = [];
for (const e of wanted) {
  for (let i = 0; i < (e.n ?? 1); i++) {
    if (force || !fs.existsSync(file(e.id, i))) jobs.push({ e, i });
  }
}

function writeIndex() {
  // Only list variants that actually exist, so a partial set still plays
  const index = {};
  for (const e of SFX) {
    const have = [];
    for (let i = 0; i < (e.n ?? 1); i++) if (fs.existsSync(file(e.id, i))) have.push(i);
    if (have.length) index[e.id] = { variants: have, loop: !!e.loop, gain: e.gain ?? 1 };
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
  return Object.keys(index).length;
}

const pending = estimate(jobs.map(({ e }) => ({ d: e.d, n: 1 })));
const total = estimate(wanted);
console.log(`${wanted.length} sounds, ${jobs.length} variants to generate (${pending.seconds.toFixed(1)}s of audio, ~$${pending.usd.toFixed(3)}).`
  + ` Whole set: ${total.seconds.toFixed(0)}s, ~$${total.usd.toFixed(2)}.`);
if (dry || !jobs.length) {
  if (!dry) console.log('Nothing to do: every variant is already on disk.');
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`index.json lists ${writeIndex()} sounds.`);
  process.exit(0);
}

// Read one variable from the environment or the --env-file, never printing it
function readVar(name) {
  if (process.env[name]) return process.env[name];
  const envFile = opt('--env-file');
  if (envFile && fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`));
    if (line) return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  return null;
}
const FAL = readVar('FAL_KEY');
const ELEVEN = FAL ? null : readVar('ELEVENLABS_API_KEY');
if (!FAL && !ELEVEN) {
  console.error('No key found. Set FAL_KEY or ELEVENLABS_API_KEY, or pass --env-file <file containing one of them>.');
  process.exit(1);
}
console.log(`Provider: ${FAL ? 'fal.ai (fal-ai/elevenlabs/sound-effects/v2)' : 'ElevenLabs API (eleven_text_to_sound_v2)'}`);
const KEY = FAL;

async function falFetch(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (res.ok) return res.json();
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
}

// ElevenLabs direct: one synchronous request that returns the MP3 bytes
async function generateEleven({ e, i }) {
  const body = {
    text: e.text, model_id: 'eleven_text_to_sound_v2', prompt_influence: e.pi ?? 0.45,
    ...(e.d && { duration_seconds: e.d }), ...(e.loop && { loop: true }),
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST', headers: { 'xi-api-key': ELEVEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) { fs.writeFileSync(file(e.id, i), Buffer.from(await res.arrayBuffer())); return; }
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }
}

async function generate(job) {
  if (!FAL) return generateEleven(job);
  const { e, i } = job;
  const input = {
    text: e.text,
    prompt_influence: e.pi ?? 0.45,
    output_format: 'mp3_44100_128',
    ...(e.d && { duration_seconds: e.d }),
    ...(e.loop && { loop: true }),
  };
  const sub = await falFetch(`${QUEUE}/${ENDPOINT}`, { method: 'POST', body: JSON.stringify(input) });
  for (let waited = 0; ; waited += 1500) {
    const st = await falFetch(sub.status_url);
    if (st.status === 'COMPLETED') break;
    if (waited > 180000) throw new Error('timed out waiting for fal');
    await new Promise((r) => setTimeout(r, 1500));
  }
  const result = await falFetch(sub.response_url);
  const url = result?.audio?.url;
  if (!url) throw new Error(`no audio in result: ${JSON.stringify(result).slice(0, 200)}`);
  const audio = await fetch(url);
  if (!audio.ok) throw new Error(`download failed: ${audio.status}`);
  fs.writeFileSync(file(e.id, i), Buffer.from(await audio.arrayBuffer()));
}

fs.mkdirSync(OUT, { recursive: true });
let done = 0, failed = 0;
const queue = [...jobs];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const job = queue.shift();
    try {
      await generate(job);
      done++;
      console.log(`  [${done + failed}/${jobs.length}] ${job.e.id}_${job.i}`);
    } catch (err) {
      failed++;
      console.error(`  [${done + failed}/${jobs.length}] ${job.e.id}_${job.i} FAILED: ${err.message}`);
    }
  }
}));
console.log(`Generated ${done}, failed ${failed}. index.json lists ${writeIndex()} sounds.${failed ? ' Rerun to retry the failures (finished ones are not paid for again).' : ''}`);
