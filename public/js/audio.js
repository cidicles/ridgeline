// Game audio. Sounds come from AI-generated samples (public/audio/sfx, made by
// scripts/generate-sfx.js) when they exist, and from on-the-fly synthesis when
// they don't, so the game always has sound even with no files at all.

const FIRE = ['fire_disc', 'fire_chaingun', 'fire_grenade', 'fire_plasma', 'fire_mortar', 'fire_laser', 'fire_turret', 'throw_grenade'];
const BOOM = { 0: 'boom_disc', 2: 'boom_grenade', 7: 'boom_grenade', 4: 'boom_mortar', 3: 'boom_plasma', 6: 'boom_plasma' };
const FLAG = { grab: 'flag_grab', lost: 'flag_lost', drop: 'flag_drop', ret: 'flag_return', capUs: 'cap_us', capThem: 'cap_them', win: 'win', lose: 'lose' };
const AMBIENCE = { motes: 'amb_meadow', dust: 'amb_desert', snow: 'amb_snow', ash: 'amb_ash' };

export class Audio {
  constructor() {
    this.ctx = null;
    this.listener = { pos: [0, 0, 0], right: [1, 0, 0] };
    this.samples = {};   // id -> { buffers: AudioBuffer[], gain, loop }
    this.loops = {};     // id -> { src, g } running sample loops
    this.base = '';
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume ?? 0.5;
    // A gentle limiter keeps stacked explosions from clipping
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 6;
    limiter.attack.value = 0.003; limiter.release.value = 0.2;
    this.master.connect(limiter).connect(this.ctx.destination);
    // White noise buffer for the synthesized fallbacks
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.jet = this.noiseLoop(800, 0);
    this.wind = this.noiseLoop(400, 0, 'lowpass');
    this.ski = this.noiseLoop(2500, 0, 'highpass');
    this.ambWind = this.noiseLoop(500, 0, 'bandpass');
    this.ambWater = this.noiseLoop(700, 0, 'lowpass');
    this.ambLava = this.noiseLoop(140, 0, 'lowpass');
    this.hum = this.ctx.createOscillator(); this.hum.type = 'sine'; this.hum.frequency.value = 58;
    this.humGain = this.ctx.createGain(); this.humGain.gain.value = 0;
    this.hum.connect(this.humGain).connect(this.master); this.hum.start();
    this.music = this.ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.nextChirp = 0; this.nextBubble = 0; this.nextChord = 0; this.chord = 0; this.repairAt = -1;
    this.loadSamples();
  }

  // ---------- sample bank ----------

  async loadSamples() {
    let index;
    try {
      const r = await fetch(`${this.base}audio/sfx/index.json`, { cache: 'no-cache' });
      if (!r.ok) return;
      index = await r.json();
    } catch { return; }
    await Promise.all(Object.entries(index).map(async ([id, info]) => {
      const buffers = [];
      for (const v of info.variants) {
        try {
          const r = await fetch(`${this.base}audio/sfx/${id}_${v}.mp3`);
          if (!r.ok) continue;
          const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
          // One-shots: peak-normalised transients. Loops are continuous, so they're
          // matched on average loudness instead, or a quiet bed would come out louder than a gunshot.
          buffers.push(info.loop ? normalizeRms(seamless(this.ctx, buf), -20) : normalize(trimStart(this.ctx, buf), 0.95));
        } catch { /* a bad file just means that variant is skipped */ }
      }
      if (buffers.length) this.samples[id] = { buffers, gain: info.gain ?? 1, loop: info.loop };
    }));
    this.samplesReady = true;
  }

  has(id) { return !!this.samples[id]; }

  // One-shot sample: random variant, slight pitch variation, optional 3D position
  play(id, { pos = null, vol = 1, rate = 1, range = 300, dur = 0 } = {}) {
    const s = this.samples[id];
    if (!this.ctx || !s) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffers[Math.floor(Math.random() * s.buffers.length)];
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = s.gain * vol;
    src.connect(g).connect(pos ? this.spatial(pos, range) : this.master);
    const t = this.ctx.currentTime;
    src.start(t);
    if (dur) { g.gain.setValueAtTime(s.gain * vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur); src.stop(t + dur + 0.02); }
    return true;
  }

  // A sample loop that runs silently until its gain is raised
  sampleLoop(id) {
    if (this.loops[id]) return this.loops[id];
    const s = this.samples[id];
    if (!this.ctx || !s) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffers[0]; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(g).connect(this.master);
    src.start(this.ctx.currentTime, Math.random() * s.buffers[0].duration);
    return (this.loops[id] = { src, g, gain: s.gain });
  }

  // Fade a sample loop toward a level (0..1 before the sound's own gain); false if absent
  setLoop(id, level, tc = 0.1, rate = null) {
    const l = this.sampleLoop(id);
    if (!l) return false;
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(level * l.gain, t, tc);
    if (rate != null) l.src.playbackRate.setTargetAtTime(rate, t, 0.15);
    return true;
  }

  // ---------- routing ----------

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  setMusicVolume(v) { this.musicVolume = v; }
  setListener(pos, right) { this.listener.pos = pos; this.listener.right = right; }

  // Distance attenuation + stereo pan
  spatial(pos, range = 300) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    if (pos) {
      const L = this.listener;
      const dx = pos[0] - L.pos[0], dy = pos[1] - L.pos[1], dz = pos[2] - L.pos[2];
      const d = Math.hypot(dx, dy, dz);
      g.gain.value = Math.max(0, 1 / (1 + d / 25)) * Math.max(0, 1 - d / range);
      p.pan.value = d > 0.1 ? Math.max(-1, Math.min(1, (dx * L.right[0] + dz * L.right[2]) / d)) : 0;
    }
    g.connect(p).connect(this.master);
    return g;
  }

  distance(pos) {
    const L = this.listener.pos;
    return Math.hypot(pos[0] - L[0], pos[1] - L[1], pos[2] - L[2]);
  }

  // ---------- weapons & impacts ----------

  fire(w, pos) {
    if (!this.ctx) return;
    if (this.play(FIRE[w], { pos, range: w === 4 ? 500 : 300 })) return;
    const out = this.spatial(pos);
    if (w === 0) {
      this.tone(out, { f0: 320, f1: 90, dur: 0.25, type: 'sawtooth', vol: 0.35 });
      this.noiseBurst(out, { dur: 0.25, freq: 3000, sweepTo: 400, vol: 0.6 });
    } else if (w === 1) {
      this.noiseBurst(out, { dur: 0.06, freq: 2200, q: 2, type: 'bandpass', vol: 0.9 });
      this.tone(out, { f0: 160, f1: 80, dur: 0.05, type: 'square', vol: 0.15 });
    } else if (w === 2) {
      this.tone(out, { f0: 140, f1: 50, dur: 0.18, type: 'triangle', vol: 0.7 });
      this.noiseBurst(out, { dur: 0.15, freq: 600, vol: 0.5 });
    } else if (w === 4) {
      this.tone(out, { f0: 90, f1: 35, dur: 0.4, type: 'sine', vol: 0.9 });
      this.noiseBurst(out, { dur: 0.35, freq: 400, vol: 0.7 });
    } else if (w === 5) {
      this.tone(out, { f0: 2400, f1: 300, dur: 0.3, type: 'sawtooth', vol: 0.18 });
      this.tone(out, { f0: 1200, f1: 1100, dur: 0.15, type: 'square', vol: 0.08 });
    } else if (w === 7) {
      this.noiseBurst(out, { dur: 0.12, freq: 900, type: 'bandpass', vol: 0.4 });
    } else if (w === 6) {
      this.tone(out, { f0: 600, f1: 200, dur: 0.15, type: 'square', vol: 0.15 });
      this.noiseBurst(out, { dur: 0.12, freq: 1500, type: 'bandpass', vol: 0.4 });
    } else {
      this.tone(out, { f0: 200, f1: 1400, dur: 0.18, type: 'sawtooth', vol: 0.2 });
      this.noiseBurst(out, { dur: 0.15, freq: 4000, type: 'highpass', vol: 0.3 });
    }
  }

  explosion(pos, big = true, w = 0) {
    if (!this.ctx) return;
    if (!big) { if (!this.play('impact_bullet', { pos, range: 150 })) this.noiseBurst(this.spatial(pos, 600), { dur: 0.08, freq: 1800, type: 'bandpass', vol: 0.4 }); return; }
    // Far away blasts get the muffled distant rumble instead of the close crack
    const far = this.distance(pos) > 220;
    if (far ? this.play('boom_distant', { pos, range: 900, vol: 1.4 }) : this.play(BOOM[w] || 'boom_disc', { pos, range: 600 })) return;
    const out = this.spatial(pos, 600);
    this.noiseBurst(out, { dur: 1.1, freq: 1200, sweepTo: 80, vol: 1.6 });
    this.tone(out, { f0: 90, f1: 30, dur: 0.6, type: 'sine', vol: 0.9 });
  }

  hitmarker() { if (this.ctx && !this.play('hitmarker')) this.blip(1800, 0.04, 0.12); }
  killConfirm() { if (this.ctx && !this.play('kill')) this.blip(900, 0.12, 0.2); }
  click() { if (this.ctx && !this.play('dry_fire')) this.noiseBurst(this.master, { dur: 0.03, freq: 2500, type: 'highpass', vol: 0.25 }); }

  // ---------- body ----------

  hurt() {
    if (!this.ctx || this.play('hurt')) return;
    this.noiseBurst(this.master, { dur: 0.15, freq: 500, vol: 0.6 });
    this.tone(this.master, { f0: 220, f1: 110, dur: 0.15, type: 'square', vol: 0.15 });
  }

  step(armor) {
    if (!this.ctx) return;
    if (this.play(armor === 2 ? 'step_heavy' : 'step_light', { rate: armor === 0 ? 1.12 : 1, vol: armor === 0 ? 0.8 : 1 })) return;
    this.noiseBurst(this.master, { dur: 0.07 + armor * 0.02, freq: 420 - armor * 90, vol: 0.18 + armor * 0.06 });
  }

  land(speed) {
    if (!this.ctx) return;
    const k = Math.min(1, speed / 30);
    if (this.play('land', { vol: 0.5 + k * 0.6 })) return;
    this.noiseBurst(this.master, { dur: 0.15 + k * 0.2, freq: 300, vol: 0.25 + k * 0.5 });
    this.tone(this.master, { f0: 90, f1: 45, dur: 0.15, type: 'sine', vol: 0.2 + k * 0.3 });
  }

  splash(pos, lava) {
    if (!this.ctx || this.play(lava ? 'lava_hiss' : 'splash', { pos, range: 200 })) return;
    const out = this.spatial(pos, 200);
    if (lava) { this.noiseBurst(out, { dur: 0.6, freq: 500, sweepTo: 120, vol: 0.9 }); this.tone(out, { f0: 80, f1: 40, dur: 0.4, type: 'sine', vol: 0.5 }); }
    else { this.noiseBurst(out, { dur: 0.5, freq: 1800, sweepTo: 300, vol: 0.9 }); this.noiseBurst(out, { dur: 0.25, freq: 4000, type: 'highpass', vol: 0.3 }); }
  }

  heartbeat() {
    if (!this.ctx || this.play('heartbeat')) return;
    this.tone(this.master, { f0: 70, f1: 45, dur: 0.12, type: 'sine', vol: 0.5 });
    setTimeout(() => this.tone(this.master, { f0: 60, f1: 40, dur: 0.14, type: 'sine', vol: 0.38 }), 180);
  }

  // A death: gibs splatter, corpses thud
  death(pos, gib) {
    if (!this.ctx) return;
    if (!this.play(gib ? 'gib' : 'body_fall', { pos, range: 200 })) this.noiseBurst(this.spatial(pos, 200), { dur: 0.3, freq: 400, vol: 0.6 });
  }

  // Short jet puff for a remote player, placed in the stereo field
  jetPuff(pos) {
    if (!this.ctx) return;
    if (this.play('loop_jet', { pos, range: 90, dur: 0.3, vol: 0.9 })) return;
    this.noiseBurst(this.spatial(pos, 90), { dur: 0.18, freq: 900, type: 'bandpass', vol: 0.5 });
  }

  // ---------- events & UI ----------

  // Named one-shots with no synthesized equivalent worth having: spawn, station, board, switch, jump, pickup, kit, ui_click
  event(id, opts) { if (this.ctx) this.play(id, opts); }

  pickup() { if (this.ctx && !this.play('pickup')) this.tone(this.master, { f0: 700, f1: 1400, dur: 0.12, type: 'triangle', vol: 0.25 }); }

  radio(kind = 'qc') {
    if (!this.ctx || this.play(kind === 'mark' ? 'ping' : 'radio')) return;
    this.noiseBurst(this.master, { dur: 0.05, freq: 2600, type: 'bandpass', q: 3, vol: 0.2 });
    const f = kind === 'mark' ? 1320 : 990;
    setTimeout(() => this.tone(this.master, { f0: f, f1: f, dur: 0.08, type: 'square', vol: 0.06 }), 50);
    if (kind === 'mark') setTimeout(() => this.tone(this.master, { f0: f * 1.5, f1: f * 1.5, dur: 0.08, type: 'square', vol: 0.06 }), 140);
  }

  callout() {
    if (!this.ctx || this.play('callout')) return;
    this.tone(this.master, { f0: 300, f1: 900, dur: 0.25, type: 'sawtooth', vol: 0.12 });
    setTimeout(() => this.tone(this.master, { f0: 900, f1: 900, dur: 0.2, type: 'triangle', vol: 0.22 }), 180);
  }

  alarm() {
    if (!this.ctx || this.play('gen_down')) return;
    [0, 0.35, 0.7].forEach((d) => setTimeout(() => this.tone(this.master, { f0: 880, f1: 440, dur: 0.3, type: 'square', vol: 0.12 }), d * 1000));
  }

  // Distinct stingers per flag event, so you can tell what happened without looking
  flagEvent(kind) {
    if (!this.ctx || this.play(FLAG[kind])) return;
    const seq = {
      grab: [[523, 0], [659, 0.09], [784, 0.18]],
      lost: [[740, 0], [587, 0.14], [466, 0.28], [370, 0.42]],
      drop: [[392, 0], [330, 0.12]],
      ret: [[880, 0], [1175, 0.1]],
      capUs: [[523, 0], [659, 0.1], [784, 0.2], [1046, 0.3], [1318, 0.45]],
      capThem: [[392, 0], [311, 0.16], [262, 0.32]],
      win: [[523, 0], [659, 0.15], [784, 0.3], [1046, 0.45], [1046, 0.75]],
      lose: [[440, 0], [349, 0.2], [294, 0.4], [220, 0.6]],
    }[kind];
    if (!seq) return;
    const type = kind === 'lost' ? 'square' : 'triangle';
    for (const [f, d] of seq) setTimeout(() => this.tone(this.master, { f0: f, f1: f, dur: 0.24, type, vol: kind === 'lost' ? 0.14 : 0.28 }), d * 1000);
  }

  blip(f = 1400, dur = 0.06, vol = 0.25) {
    if (!this.ctx) return;
    this.tone(this.master, { f0: f, f1: f * 1.02, dur, type: 'square', vol });
  }

  jingle(notes, step = 0.11) {
    if (!this.ctx) return;
    notes.forEach((n, i) => setTimeout(() => this.tone(this.master, { f0: n, f1: n, dur: 0.22, type: 'triangle', vol: 0.3 }), i * step * 1000));
  }

  // ---------- continuous sound ----------

  // Jet, speed wind and ski hiss follow the local player
  setMovement({ jetting, speed, skiing, onGround }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const jet = jetting ? 1 : 0, rush = Math.min(1, Math.max(0, (speed - 15) / 60)), ski = skiing && onGround ? Math.min(1, speed / 40) : 0;
    if (this.setLoop('loop_jet', jet, 0.05)) this.jet.g.gain.setTargetAtTime(0, t, 0.05);
    else { this.jet.g.gain.setTargetAtTime(jet * 0.35, t, 0.05); this.jet.f.frequency.setTargetAtTime(jetting ? 900 : 600, t, 0.1); }
    if (this.setLoop('loop_wind_speed', rush, 0.2, 0.85 + rush * 0.4)) this.wind.g.gain.setTargetAtTime(0, t, 0.2);
    else { this.wind.g.gain.setTargetAtTime(Math.min(0.6, Math.max(0, (speed - 15) / 100)), t, 0.2); this.wind.f.frequency.setTargetAtTime(200 + speed * 8, t, 0.2); }
    if (this.setLoop('loop_ski', ski, 0.05, 0.8 + ski * 0.4)) this.ski.g.gain.setTargetAtTime(0, t, 0.05);
    else this.ski.g.gain.setTargetAtTime(skiing && onGround ? Math.min(0.12, speed / 400) : 0, t, 0.05);
    // Repair beam: on while repairTick keeps being called
    this.setLoop('loop_repair', t - this.repairAt < 0.2 ? 1 : 0, 0.06);
  }

  repairTick() {
    if (!this.ctx) return;
    this.repairAt = this.ctx.currentTime;
    if (!this.has('loop_repair') && Math.random() < 0.15) this.noiseBurst(this.master, { dur: 0.05, freq: 3000 + Math.random() * 2000, type: 'bandpass', q: 4, vol: 0.12 });
  }

  // Skiff engine: pitch climbs with speed
  setEngine(on, speed, lifting) {
    if (!this.ctx) return;
    if (this.setLoop('loop_skiff', on ? (lifting ? 1 : 0.8) : 0, 0.15, 0.8 + Math.min(speed, 100) / 140)) return;
    if (!this.engine) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o.connect(f).connect(g).connect(this.master); o.start();
      this.engine = { o, f, g };
    }
    const t = this.ctx.currentTime;
    this.engine.g.gain.setTargetAtTime(on ? 0.12 + (lifting ? 0.06 : 0) : 0, t, 0.1);
    this.engine.o.frequency.setTargetAtTime(55 + speed * 1.4, t, 0.1);
    this.engine.f.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
  }

  // Per-map ambience. near: { water, lava, gen } proximity weights 0..1
  setAmbience(kind, near, t) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Only the current map's bed plays; the others fade out
    let bedSample = false;
    for (const [k, id] of Object.entries(AMBIENCE)) {
      if (this.setLoop(id, k === kind ? 1 : 0, 1.5) && k === kind) bedSample = true;
    }
    const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.07 + 1.3);
    const windLevel = { snow: 0.16, dust: 0.13, ash: 0.08, motes: 0.05 }[kind] ?? 0.06;
    this.ambWind.g.gain.setTargetAtTime(bedSample ? 0 : windLevel * (0.4 + 0.6 * gust), now, 0.5);
    this.ambWind.f.frequency.setTargetAtTime((kind === 'snow' ? 900 : 450) + gust * 500, now, 0.5);
    const water = this.setLoop('amb_lake', near.water, 0.3);
    this.ambWater.g.gain.setTargetAtTime(water ? 0 : 0.12 * near.water * (0.6 + 0.4 * Math.sin(t * 1.3)), now, 0.2);
    const lava = this.setLoop('amb_lava', near.lava, 0.4);
    this.ambLava.g.gain.setTargetAtTime(lava ? 0 : 0.35 * near.lava, now, 0.4);
    const gen = this.setLoop('loop_generator', near.gen, 0.3);
    this.humGain.gain.setTargetAtTime(gen ? 0 : 0.05 * near.gen, now, 0.3);
    // Synth birds and lava pops only when the recorded beds are missing
    if (!bedSample && kind === 'motes' && t > this.nextChirp) {
      this.nextChirp = t + 3 + Math.random() * 7;
      const f = 2200 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) setTimeout(() => this.tone(this.master, { f0: f, f1: f * 1.25, dur: 0.07, type: 'sine', vol: 0.025 }), i * 110);
    }
    if (!lava && near.lava > 0.1 && t > this.nextBubble) {
      this.nextBubble = t + 0.3 + Math.random() * 1.2;
      this.tone(this.master, { f0: 90 + Math.random() * 80, f1: 40, dur: 0.18, type: 'sine', vol: 0.25 * near.lava });
    }
  }

  // Slow generative pad for the lobby and the end screen
  setMusic(on, t) {
    if (!this.ctx) return;
    const target = on ? (this.musicVolume ?? 0.35) * 0.5 : 0;
    this.music.gain.setTargetAtTime(target, this.ctx.currentTime, on ? 1.2 : 0.6);
    if (!on || t < this.nextChord) return;
    this.nextChord = t + 6;
    const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 233.1, 293.7]];
    const notes = chords[this.chord++ % chords.length];
    const at = this.ctx.currentTime;
    for (const f of [...notes, notes[0] / 2]) {
      for (const det of [-4, 4]) {
        const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const flt = this.ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 700; flt.Q.value = 0.5;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.035, at + 2.5); g.gain.linearRampToValueAtTime(0, at + 7);
        o.connect(flt).connect(g).connect(this.music); o.start(at); o.stop(at + 7.2);
      }
    }
  }

  // ---------- synthesis building blocks ----------

  noiseLoop(freq, gain, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { f, g };
  }

  noiseBurst(out, { dur = 0.2, freq = 1000, q = 1, type = 'lowpass', vol = 1, sweepTo = null }) {
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  tone(out, { f0, f1, dur, type = 'sine', vol = 0.5 }) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
}

// Drop the silence a generator leaves before the attack, so shots fire instantly
function trimStart(ctx, buf) {
  const ch = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const thresh = Math.max(0.01, peak * 0.04);
  let start = 0;
  while (start < ch.length && Math.abs(ch[start]) < thresh) start++;
  start = Math.max(0, start - Math.floor(buf.sampleRate * 0.004));
  if (start < buf.sampleRate * 0.005) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length - start, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(start), c);
  return out;
}

// Crossfade a loop's tail into its head so the wrap-around can't click, whatever
// the generator produced. The result is shorter by the fade length.
function seamless(ctx, buf) {
  const fade = Math.min(Math.floor(buf.sampleRate * 0.4), Math.floor(buf.length * 0.12));
  if (fade < 64) return buf;
  const len = buf.length - fade;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < fade; i++) {
      const k = i / fade; // equal-power: tail fades out as the head fades in
      dst[i] = src[i] * Math.sin(k * Math.PI / 2) + src[len + i] * Math.cos(k * Math.PI / 2);
    }
  }
  return out;
}

// Scale to a target average level in dBFS, without letting the peak clip
function normalizeRms(buf, targetDb) {
  let sum = 0, n = 0, peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { sum += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
    n += d.length;
  }
  const rms = Math.sqrt(sum / n);
  if (rms < 1e-5) return buf;
  const k = Math.min(Math.pow(10, targetDb / 20) / rms, 0.98 / peak);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}

// Scale to a common peak so the manifest gains are the only loudness knob
function normalize(buf, target) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak < 1e-4) return buf;
  const k = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}
