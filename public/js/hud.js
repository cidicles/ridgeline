import * as THREE from 'three';
import { TEAM_NAMES, TEAM_COLORS } from '../shared/world.js';
import { WEAPONS, PACKS } from '../shared/weapons.js';
import { ARMORS } from '../shared/physics.js';
import { SKIFF } from '../shared/vehicles.js';

const css = (hex, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
const FRIEND = '#7dff8a', FOE = '#ff5a4a';
const FONT = '12px "Share Tech Mono", monospace';
const v3 = new THREE.Vector3();

export const QUICK_CHAT = [
  'Attack the enemy flag!', 'Defend our flag!', 'Need repairs at base!', 'Enemy flag carrier spotted!',
  'Incoming enemies!', 'Going for their flag. Cover me!', 'Thanks!', 'Nice shot!', 'Acknowledged!',
];

const TIPS = [
  ['Ski', 'Hold SPACE on downhill slopes: no friction, you keep all your speed'],
  ['Jet', 'Right mouse or SHIFT burns energy; let go to recharge'],
  ['Lead', 'Shots inherit your speed and travel time: aim ahead of moving targets'],
  ['Flags', 'Grab theirs, bring it to your stand while yours is home'],
  ['Loadout', 'B picks armour, weapons and pack; stand on a station inside your keep'],
  ['Team', 'Z for quick orders (bots obey), middle mouse to ping a spot'],
];

const HELP = [
  ['WASD', 'Move'], ['Mouse / Left click', 'Aim / fire'], ['Right click or Shift', 'Jetpack'], ['Space', 'Jump, hold to ski'],
  ['1–5, Q, wheel', 'Weapons'], ['G / H', 'Grenade / repair kit'], ['E', 'Board or leave a skiff'], ['Hold F', 'Repair'],
  ['B', 'Loadout'], ['Z', 'Quick chat & orders'], ['Middle mouse or X', 'Ping a location'], ['V', 'Third person'],
  ['Tab', 'Scores'], ['T / Y', 'Chat / team chat'], ['M / K', 'Switch team / respawn'], ['F1', 'This help'],
];

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.feed = [];      // kill feed / chat {text, color, t}
    this.center = [];    // big centre messages {text, t}
    this.hitMarker = 0;
    this.damageFlash = 0;
    this.dmgDirs = [];
    this.points = [];
    this.banners = [];
    this.kills = [];
    this.weaponPopup = null;
    this.warn = null;
    this.marks = [];
    this.tips = null;
    this.fps = 0;
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.w = w; this.h = h;
  }

  pushFeed(text, color = '#e8eef5') {
    this.feed.push({ text, color, t: performance.now() });
    if (this.feed.length > 7) this.feed.shift();
  }
  pushCenter(text) {
    this.center.push({ text, t: performance.now() });
    if (this.center.length > 3) this.center.shift();
  }

  project(camera, p) {
    v3.set(p[0], p[1], p[2]).project(camera);
    if (v3.z > 1) return null;
    return [(v3.x * 0.5 + 0.5) * this.w, (-v3.y * 0.5 + 0.5) * this.h];
  }

  draw(s) {
    const { ctx } = this;
    const W = this.w, H = this.h;
    const now = performance.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';

    this.drawIFF(s);
    this.drawFlags(s);
    if (s.me.alive) { this.drawCrosshair(s); this.drawArcs(s); }
    this.drawCompass(s);
    this.drawTimer(s);
    this.drawRadar(s);
    this.drawKillFeed(s, now);
    this.drawScore(s);
    this.drawBase(s);
    this.drawFlagStatus(s);
    if (s.me.alive && s.vehicle) this.drawVehicle(s);
    else if (s.me.alive) { this.drawBars(s); this.drawWeapons(s); this.drawWeaponPopup(s, now); }
    if (s.me.alive && s.prompt) this.banner(s.prompt, H - 150, '#c8f0ff', 16);
    if (s.me.alive && s.protectLeft > 0) this.banner(`SPAWN PROTECTION ${s.protectLeft.toFixed(1)}s`, H * 0.62, '#9fe8ff', 14);
    if (s.me.alive && this.warn && now - this.warn.t < 900) this.banner(this.warn.text, H / 2 + 70, '#ffb08a', 15);
    this.drawMarks(s, now);
    this.drawPoints(now);
    this.drawFeed();
    if (s.qcOpen) this.drawQuickChat();
    if (this.tips) this.drawTips(now);
    if (s.showFps) this.drawFps();
    this.drawBanners(now);
    this.drawDamage(s, now);

    if (s.outOfBounds && s.me.alive) this.banner('LEAVING MISSION AREA', H * 0.32, '#ff7060');
    if (!s.me.alive && s.respawnIn != null && !s.end) this.drawDeath(s);
    if (s.end) this.drawEnd(s, now);
    else if (s.showScores) this.drawScoreboard(s);
    if (s.showHelp) this.drawHelp();
  }

  // ---------- combat feedback ----------

  // Red arc on the ring around the crosshair, pointing at whoever hit us
  addDamageDir(angle, amount) {
    this.dmgDirs.push({ angle, t: performance.now(), k: Math.min(1, 0.35 + amount / 40) });
    if (this.dmgDirs.length > 8) this.dmgDirs.shift();
  }

  drawDamage(s, now) {
    const { ctx } = this;
    const W = this.w, H = this.h, cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.17;
    this.dmgDirs = this.dmgDirs.filter((d) => now - d.t < 1400);
    for (const d of this.dmgDirs) {
      const a = 1 - (now - d.t) / 1400;
      // angle 0 = straight ahead (up on screen)
      const ang = d.angle - Math.PI / 2;
      ctx.strokeStyle = `rgba(255,40,30,${0.85 * a * d.k})`;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(cx, cy, r, ang - 0.28, ang + 0.28); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,140,120,${0.6 * a})`;
      ctx.beginPath(); ctx.arc(cx, cy, r + 7, ang - 0.18, ang + 0.18); ctx.stroke();
    }
    // Hit flash plus a pulsing red edge when armour is low
    let edge = Math.min(0.6, this.damageFlash);
    const low = s.me.alive ? Math.max(s.me.hp, 0) / s.maxHp : 1;
    if (low < 0.3) edge = Math.max(edge, (0.3 - low) * 1.6 * (0.65 + 0.35 * Math.sin(now / 160)));
    if (edge > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, H * 0.3, cx, cy, H * 0.85);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(200,10,10,${edge})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  }

  // Thin armour (right) and energy (left) arcs hugging the crosshair
  drawArcs(s) {
    if (s.vehicle) return;
    const { ctx } = this;
    const cx = this.w / 2, cy = this.h / 2, r = 38, span = 0.9;
    const hp = Math.max(0, s.me.hp) / s.maxHp, en = s.me.energy / s.maxEnergy;
    const arc = (from, frac, color, side) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(cx, cy, r, from - span / 2, from + span / 2); ctx.stroke();
      ctx.strokeStyle = color;
      ctx.beginPath();
      if (side > 0) ctx.arc(cx, cy, r, from + span / 2 - span * frac, from + span / 2);
      else ctx.arc(cx, cy, r, from - span / 2, from - span / 2 + span * frac);
      ctx.stroke();
    };
    arc(0, hp, hp > 0.3 ? 'rgba(125,255,138,0.75)' : 'rgba(255,90,74,0.9)', 1);
    arc(Math.PI, en, en > 0.2 ? 'rgba(90,200,255,0.75)' : 'rgba(255,176,74,0.9)', -1);
  }

  warning(text) { this.warn = { text, t: performance.now() }; }

  // "+10 Kill" style popups under the crosshair
  pushPoints(n, reason) {
    this.points.push({ text: `+${n} ${reason}`, t: performance.now() });
    if (this.points.length > 4) this.points.shift();
  }

  drawPoints(now) {
    const { ctx } = this;
    this.points = this.points.filter((p) => now - p.t < 1800);
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    this.points.forEach((p, i) => {
      const age = (now - p.t) / 1800;
      ctx.globalAlpha = Math.min(1, (1 - age) * 2.5);
      const y = this.h / 2 + 52 + (this.points.length - 1 - i) * -18 - age * 14;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(p.text, this.w / 2 + 1, y + 1);
      ctx.fillStyle = '#ffe28a'; ctx.fillText(p.text, this.w / 2, y);
    });
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.font = FONT;
  }

  showWeapon(name) { this.weaponPopup = { name, t: performance.now() }; }

  drawWeaponPopup(s, now) {
    const p = this.weaponPopup;
    if (!p || now - p.t > 1100) return;
    this.ctx.globalAlpha = Math.min(1, (1100 - (now - p.t)) / 400);
    this.banner(p.name.toUpperCase(), this.h - 110, '#e8eef5', 16);
    this.ctx.globalAlpha = 1;
  }

  // ---------- objective info ----------

  // Big team-coloured banner with an optional sub-line
  pushBanner(text, color, sub) {
    this.banners.push({ text, color, sub, t: performance.now() });
    if (this.banners.length > 3) this.banners.shift();
  }

  drawBanners(now) {
    const { ctx } = this;
    this.banners = this.banners.filter((b) => now - b.t < 3800);
    this.banners.forEach((b, i) => {
      const age = now - b.t;
      const a = Math.min(1, age / 150, (3800 - age) / 600);
      const y = 150 + i * 54;
      ctx.globalAlpha = a;
      const w = Math.min(this.w - 40, 560);
      const grad = ctx.createLinearGradient(this.w / 2 - w / 2, 0, this.w / 2 + w / 2, 0);
      grad.addColorStop(0, 'rgba(8,12,18,0)'); grad.addColorStop(0.2, 'rgba(8,12,18,0.7)');
      grad.addColorStop(0.8, 'rgba(8,12,18,0.7)'); grad.addColorStop(1, 'rgba(8,12,18,0)');
      ctx.fillStyle = grad; ctx.fillRect(this.w / 2 - w / 2, y - 22, w, b.sub ? 46 : 36);
      ctx.fillStyle = b.color; ctx.fillRect(this.w / 2 - w * 0.3, y - 22, w * 0.6, 2);
      this.banner(b.text, y - 4, b.color, 20);
      if (b.sub) this.banner(b.sub, y + 15, 'rgba(232,238,245,0.85)', 12);
    });
    ctx.globalAlpha = 1;
  }

  // Under the base status: where each flag is and who has it
  drawFlagStatus(s) {
    const { ctx } = this;
    for (let t = 0; t < 2; t++) {
      const f = s.flags[t];
      if (!f) continue;
      const y = 134 + t * 18;
      const carrier = f.state === 1 ? s.nameOf(f.carrier) : '';
      const d = Math.round(Math.hypot(f.pos[0] - s.camPos[0], f.pos[2] - s.camPos[2]));
      const text = f.state === 0 ? 'HOME' : f.state === 1 ? `${carrier} · ${d}m` : `DROPPED · returns ${f.returnIn}s`;
      ctx.fillStyle = 'rgba(10,16,22,0.45)'; ctx.fillRect(12, y - 8, 150, 16);
      ctx.fillStyle = css(TEAM_COLORS[t]); ctx.fillRect(12, y - 8, 4, 16);
      ctx.fillStyle = f.state === 0 ? '#c8d2dc' : f.state === 1 ? '#ffd060' : '#ff9a60';
      ctx.fillText('⚑ ' + (text.length > 20 ? text.slice(0, 19) + '…' : text), 22, y);
    }
  }

  drawTimer(s) {
    if (s.timeLeft == null) return;
    const { ctx } = this;
    const t = Math.max(0, Math.ceil(s.timeLeft));
    const txt = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.fillRect(this.w / 2 - 44, 38, 88, 20);
    ctx.fillStyle = t <= 60 ? '#ff9a60' : '#e8eef5';
    ctx.fillText(txt, this.w / 2, 48);
    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.fillStyle = 'rgba(200,215,230,0.7)';
    ctx.fillText(`FIRST TO ${s.capLimit}`, this.w / 2, 66);
    ctx.textAlign = 'left'; ctx.font = FONT;
  }

  // ---------- kill feed with weapon glyphs ----------

  pushKill(k) {
    this.kills.push({ ...k, t: performance.now() });
    if (this.kills.length > 6) this.kills.shift();
  }

  glyph(w, x, y, color) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.8;
    ctx.beginPath();
    switch (w) {
      case 0: ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillRect(-2, -1, 4, 2); break; // disc
      case 1: for (let i = 0; i < 4; i++) ctx.fillRect(-9 + i * 5, -1.5, 3, 3); break;                   // chaingun
      case 2: case 7: ctx.arc(0, 1, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-1.5, -6, 3, 3); break; // grenades
      case 3: ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 0.4; ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); break; // plasma
      case 4: ctx.moveTo(-9, 5); ctx.quadraticCurveTo(0, -12, 9, 5); ctx.stroke(); ctx.beginPath(); ctx.arc(9, 5, 2.5, 0, 7); ctx.fill(); break; // mortar
      case 5: ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineWidth = 2.5; ctx.stroke(); break;         // laser
      case 6: ctx.moveTo(-7, 5); ctx.lineTo(7, 5); ctx.lineTo(4, -1); ctx.lineTo(-4, -1); ctx.closePath(); ctx.fill(); ctx.fillRect(2, -4, 8, 2); break; // turret
      case -2: ctx.moveTo(-9, 3); ctx.lineTo(9, 0); ctx.lineTo(-9, -3); ctx.closePath(); ctx.fill(); break; // skiff
      default: ctx.arc(0, -1, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-3, 2, 6, 4); break;        // skull-ish: suicide/fall
    }
    ctx.restore();
  }

  drawKillFeed(s, now) {
    const { ctx } = this;
    this.kills = this.kills.filter((k) => now - k.t < 7000);
    const right = this.w - 16;
    let y = 172;
    ctx.font = '12px "Share Tech Mono", monospace';
    for (const k of this.kills) {
      const a = Math.min(1, (7000 - (now - k.t)) / 800);
      ctx.globalAlpha = a;
      const vw = ctx.measureText(k.victim).width, kw = k.killer ? ctx.measureText(k.killer).width : 0;
      const total = vw + 30 + (k.killer ? kw + 6 : 0);
      const mine = k.mine ? 'rgba(255,226,138,0.18)' : 'rgba(10,16,22,0.55)';
      ctx.fillStyle = mine; ctx.fillRect(right - total - 10, y - 10, total + 10, 20);
      let x = right - 5;
      ctx.textAlign = 'right';
      ctx.fillStyle = k.vColor; ctx.fillText(k.victim, x, y); x -= vw + 15;
      this.glyph(k.w, x, y, '#e8eef5'); x -= 15;
      if (k.killer) { ctx.fillStyle = k.kColor; ctx.fillText(k.killer, x - 1, y); }
      ctx.textAlign = 'left';
      y += 23;
    }
    ctx.globalAlpha = 1; ctx.font = FONT;
  }

  // ---------- death and end-of-match screens ----------

  drawDeath(s) {
    const H = this.h, d = s.deathInfo;
    if (d) {
      this.banner(d.self ? d.text : `Killed by ${d.killer}`, H * 0.6, d.color || '#ff9a8a', 22);
      if (d.sub) this.banner(d.sub, H * 0.6 + 26, 'rgba(232,238,245,0.85)', 14);
    }
    this.banner(s.respawnIn > 0 ? `Respawning in ${Math.ceil(s.respawnIn)}` : 'Respawning...', H * 0.7, '#e8eef5', 18);
    this.banner('B: change loadout for next spawn', H * 0.7 + 24, 'rgba(200,215,230,0.75)', 13);
  }

  drawEnd(s, now) {
    const { ctx } = this;
    const e = s.end;
    const W = Math.min(720, this.w - 32), H = Math.min(470, this.h - 32);
    const x = (this.w - W) / 2, y = (this.h - H) / 2;
    ctx.fillStyle = 'rgba(6,9,13,0.9)'; ctx.fillRect(x, y, W, H);
    const col = e.winner >= 0 ? css(TEAM_COLORS[e.winner]) : '#e8eef5';
    ctx.fillStyle = col; ctx.fillRect(x, y, W, 4);
    const won = e.winner === s.me.team;
    this.bannerAt(e.winner < 0 ? 'DRAW' : `${TEAM_NAMES[e.winner].toUpperCase()} WIN`, this.w / 2, y + 42, col, 34);
    this.bannerAt(e.winner < 0 ? 'Time ran out with the score level' : won ? 'Victory' : 'Defeat', this.w / 2, y + 74, 'rgba(232,238,245,0.8)', 15);
    this.bannerAt(`${TEAM_NAMES[0]} ${e.score[0]}  –  ${e.score[1]} ${TEAM_NAMES[1]}`, this.w / 2, y + 104, '#e8eef5', 18);

    // Awards
    ctx.font = '13px "Share Tech Mono", monospace';
    e.awards.forEach((a, i) => {
      const ax = x + 30 + (i % 2) * (W / 2 - 20), ay = y + 146 + Math.floor(i / 2) * 44;
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(ax, ay - 16, W / 2 - 50, 36);
      ctx.fillStyle = '#ffe28a'; ctx.fillText(a.title.toUpperCase(), ax + 10, ay - 4);
      ctx.fillStyle = css(TEAM_COLORS[a.team]); ctx.fillText(a.name, ax + 10, ay + 11);
      ctx.textAlign = 'right'; ctx.fillStyle = '#e8eef5'; ctx.fillText(String(a.value), ax + W / 2 - 60, ay + 3); ctx.textAlign = 'left';
    });

    // Your line
    const me = e.players.find((p) => p.id === s.me.id);
    if (me) {
      const my = y + 260;
      ctx.fillStyle = 'rgba(200,215,230,0.6)';
      ctx.fillText('YOUR MATCH', x + 30, my);
      const stats = [['Score', me.score], ['Kills', me.kills], ['Deaths', me.deaths], ['Assists', me.assists], ['Caps', me.caps], ['Returns', me.returns]];
      stats.forEach(([k, v], i) => {
        const sx = x + 30 + i * ((W - 60) / 6);
        ctx.fillStyle = '#e8eef5'; ctx.font = 'bold 20px "Share Tech Mono", monospace'; ctx.fillText(String(v), sx, my + 30);
        ctx.fillStyle = 'rgba(200,215,230,0.6)'; ctx.font = '11px "Share Tech Mono", monospace'; ctx.fillText(k.toUpperCase(), sx, my + 52);
      });
    }
    const left = Math.max(0, Math.ceil(e.in - (now - e.at) / 1000));
    if (e.options) {
      const oy = y + H - 92, ow = (W - 60 - 20) / 3;
      ctx.font = '12px "Share Tech Mono", monospace';
      ctx.fillStyle = 'rgba(200,215,230,0.7)';
      ctx.fillText(`VOTE FOR THE NEXT MAP (1 / 2 / 3) · ${left}s`, x + 30, oy - 12);
      e.options.forEach((o, i) => {
        const ox = x + 30 + i * (ow + 10);
        const mine = e.myVote === i, votes = (e.votes || [])[i] || 0;
        ctx.fillStyle = mine ? 'rgba(159,255,182,0.18)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(ox, oy, ow, 52);
        if (mine) { ctx.strokeStyle = '#9fffb6'; ctx.strokeRect(ox + 0.5, oy + 0.5, ow - 1, 51); }
        ctx.fillStyle = '#ffe28a'; ctx.font = 'bold 14px "Share Tech Mono", monospace'; ctx.fillText(String(i + 1), ox + 10, oy + 20);
        ctx.fillStyle = '#e8eef5'; ctx.fillText(o.name, ox + 28, oy + 20);
        ctx.font = '12px "Share Tech Mono", monospace'; ctx.fillStyle = 'rgba(200,215,230,0.75)';
        ctx.fillText(`${votes} vote${votes === 1 ? '' : 's'}${i === 0 ? ' · next in rotation' : ''}`, ox + 10, oy + 40);
      });
    } else {
      this.bannerAt(`Next map: ${e.next} in ${left}s`, this.w / 2, y + H - 34, '#9fffb6', 15);
    }
    ctx.font = FONT;
  }

  bannerAt(text, x, y, color, size) {
    const { ctx } = this;
    ctx.font = `bold ${size}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(text, x + 2, y + 2);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.textAlign = 'left'; ctx.font = FONT;
  }

  drawScoreboard(s) {
    const { ctx } = this;
    const W = Math.min(860, this.w - 32), x = (this.w - W) / 2;
    const rows = Math.max(...[0, 1].map((t) => s.roster.filter((r) => r.team === t).length), 1);
    const H = 120 + rows * 22, y = Math.max(16, (this.h - H) / 2);
    ctx.fillStyle = 'rgba(6,9,13,0.88)'; ctx.fillRect(x, y, W, H);
    const t = Math.max(0, Math.ceil(s.timeLeft || 0));
    this.bannerAt(`${s.mapName}  ·  ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} left  ·  first to ${s.capLimit}`, this.w / 2, y + 18, 'rgba(232,238,245,0.75)', 12);
    const colW = W / 2;
    const cols = [['SCORE', 150], ['K', 196], ['D', 226], ['A', 256], ['CAP', 290], ['RET', 330], ['PING', 372]];
    for (let team = 0; team < 2; team++) {
      const cx = x + 16 + team * colW;
      const list = s.roster.filter((r) => r.team === team).sort((a, b) => b.score - a.score);
      const pts = list.reduce((n, r) => n + r.score, 0);
      ctx.fillStyle = css(TEAM_COLORS[team]); ctx.fillRect(cx - 8, y + 34, colW - 16, 3);
      ctx.font = 'bold 18px "Share Tech Mono", monospace';
      ctx.fillText(`${TEAM_NAMES[team].toUpperCase()}  ${s.score[team] ?? 0}`, cx, y + 54);
      ctx.font = '11px "Share Tech Mono", monospace';
      ctx.fillStyle = 'rgba(200,215,230,0.6)';
      ctx.textAlign = 'right'; ctx.fillText(`${pts} pts`, cx + colW - 30, y + 54); ctx.textAlign = 'left';
      for (const [label, off] of cols) ctx.fillText(label, cx + off - (label === 'SCORE' ? 10 : 0), y + 78);
      ctx.fillText('NAME', cx, y + 78);
      ctx.font = '12px "Share Tech Mono", monospace';
      list.forEach((r, i) => {
        const ry = y + 100 + i * 22;
        if (r.id === s.me.id) { ctx.fillStyle = 'rgba(159,255,182,0.1)'; ctx.fillRect(cx - 8, ry - 10, colW - 16, 20); }
        const carrying = s.flags.some((f) => f && f.state === 1 && f.carrier === r.id);
        ctx.fillStyle = r.id === s.me.id ? '#ffffff' : '#c8d2dc';
        const armor = ['L', 'M', 'H'][r.armor ?? 1];
        ctx.fillStyle = 'rgba(200,215,230,0.5)'; ctx.fillText(armor, cx, ry);
        ctx.fillStyle = r.id === s.me.id ? '#ffffff' : '#c8d2dc';
        ctx.fillText((carrying ? '⚑ ' : '') + r.name.slice(0, 14), cx + 14, ry);
        const vals = [r.score, r.kills, r.deaths, r.assists, r.caps, r.returns, r.bot ? 'BOT' : r.ping];
        vals.forEach((v, j) => {
          ctx.fillStyle = j === 0 ? '#ffe28a' : '#c8d2dc';
          ctx.fillText(String(v ?? 0), cx + cols[j][1] - (j === 0 ? 10 : 0), ry);
        });
      });
    }
    ctx.font = FONT;
  }

  // ---------- comms ----------

  addMark(p, who, color) {
    this.marks = this.marks.filter((m) => m.who !== who);
    this.marks.push({ p, who, color, t: performance.now() });
  }

  drawMarks(s, now) {
    const { ctx } = this;
    this.marks = this.marks.filter((m) => now - m.t < 9000);
    for (const m of this.marks) {
      const pos = [m.p[0], m.p[1] + 1.5, m.p[2]];
      let sp = this.project(s.camera, pos);
      const W = this.w, H = this.h;
      let edge = false;
      if (!sp || sp[0] < 30 || sp[0] > W - 30 || sp[1] < 30 || sp[1] > H - 30) {
        const yaw = s.me.yaw, dx = pos[0] - s.camPos[0], dz = pos[2] - s.camPos[2];
        const x = dx * Math.cos(yaw) - dz * Math.sin(yaw), z = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
        const a = Math.atan2(x, z), r = Math.min(W, H) * 0.38;
        sp = [W / 2 + Math.sin(a) * r, H / 2 - Math.cos(a) * r];
        edge = true;
      }
      const age = (now - m.t) / 1000, pulse = 1 + 0.25 * Math.max(0, 1 - age) * Math.sin(age * 20);
      const d = Math.round(Math.hypot(pos[0] - s.camPos[0], pos[1] - s.camPos[1], pos[2] - s.camPos[2]));
      ctx.save(); ctx.translate(sp[0], sp[1]); ctx.scale(pulse, pulse);
      ctx.globalAlpha = Math.min(1, (9000 - (now - m.t)) / 1000);
      ctx.strokeStyle = m.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, 0); ctx.lineTo(0, 11); ctx.lineTo(-9, 0); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = m.color; ctx.fillRect(-2, -2, 4, 4);
      if (edge) { ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
      ctx.globalAlpha = Math.min(1, (9000 - (now - m.t)) / 1000);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(`${m.who} · ${d}m`, sp[0] + 1, sp[1] + 25);
      ctx.fillStyle = m.color; ctx.fillText(`${m.who} · ${d}m`, sp[0], sp[1] + 24);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }

  drawQuickChat() {
    const { ctx } = this;
    const x = 16, y = this.h / 2 - 120;
    ctx.fillStyle = 'rgba(8,12,18,0.82)'; ctx.fillRect(x, y, 290, 8 * 24 + 40);
    ctx.fillStyle = '#9fffb6'; ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillText('QUICK CHAT  (bots follow 1, 2, 6)', x + 12, y + 18);
    ctx.font = FONT;
    for (let i = 0; i < 8; i++) {
      const yy = y + 42 + i * 24;
      ctx.fillStyle = '#ffe28a'; ctx.fillText(String(i + 1), x + 14, yy);
      ctx.fillStyle = '#e8eef5'; ctx.fillText(QUICK_CHAT[i], x + 34, yy);
    }
  }

  showTips() { this.tips = { t: performance.now() }; }
  dismissTips() { if (this.tips && performance.now() - this.tips.t > 1500) this.tips = null; }

  drawTips(now) {
    if (now - this.tips.t > 30000) { this.tips = null; return; }
    const { ctx } = this;
    const W = Math.min(600, this.w - 32), H = TIPS.length * 42 + 64, x = this.w - W - 16, y = this.h / 2 - H / 2;
    ctx.globalAlpha = Math.min(1, (now - this.tips.t) / 400, (30000 - (now - this.tips.t)) / 800);
    ctx.fillStyle = 'rgba(8,12,18,0.86)'; ctx.fillRect(x, y, W, H);
    ctx.fillStyle = '#9fffb6'; ctx.fillRect(x, y, W, 3);
    ctx.font = 'bold 16px "Share Tech Mono", monospace'; ctx.fillStyle = '#e8eef5';
    ctx.fillText('HOW TO PLAY', x + 16, y + 24);
    TIPS.forEach(([k, v], i) => {
      const yy = y + 54 + i * 42;
      ctx.font = 'bold 13px "Share Tech Mono", monospace'; ctx.fillStyle = '#ffe28a'; ctx.fillText(k.toUpperCase(), x + 16, yy);
      ctx.font = FONT; ctx.fillStyle = '#c8d2dc'; ctx.fillText(v, x + 16, yy + 17);
    });
    ctx.fillStyle = 'rgba(200,215,230,0.55)'; ctx.fillText('Any key to close · F1 for all controls', x + 16, y + H - 12);
    ctx.globalAlpha = 1; ctx.font = FONT;
  }

  drawHelp() {
    const { ctx } = this;
    const W = 520, H = HELP.length * 22 + 60, x = (this.w - W) / 2, y = (this.h - H) / 2;
    ctx.fillStyle = 'rgba(8,12,18,0.9)'; ctx.fillRect(x, y, W, H);
    ctx.fillStyle = '#9fffb6'; ctx.fillRect(x, y, W, 3);
    ctx.font = 'bold 16px "Share Tech Mono", monospace'; ctx.fillStyle = '#e8eef5'; ctx.fillText('CONTROLS', x + 18, y + 26);
    ctx.font = FONT;
    HELP.forEach(([k, v], i) => {
      const yy = y + 54 + i * 22;
      ctx.fillStyle = '#9fffb6'; ctx.fillText(k, x + 18, yy);
      ctx.fillStyle = '#c8d2dc'; ctx.fillText(v, x + 220, yy);
    });
  }

  drawFps() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.fillRect(this.w / 2 - 150, 38, 54, 20);
    ctx.fillStyle = this.fps >= 55 ? '#9fffb6' : this.fps >= 30 ? '#ffe28a' : '#ff8a7a';
    ctx.fillText(`${Math.round(this.fps)} fps`, this.w / 2 - 144, 48);
  }

  banner(text, y, color, size = 22) {
    const { ctx } = this;
    ctx.font = `bold ${size}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(text, this.w / 2 + 2, y + 2);
    ctx.fillStyle = color; ctx.fillText(text, this.w / 2, y);
    ctx.textAlign = 'left';
    ctx.font = FONT;
  }

  drawCrosshair(s) {
    const { ctx } = this;
    const cx = this.w / 2, cy = this.h / 2;
    const spread = 6 + s.recoil * 20;
    ctx.strokeStyle = 'rgba(160,255,190,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (s.me.weapon === 1) {
      ctx.arc(cx, cy, spread + 6, 0, Math.PI * 2);
    } else if (s.me.weapon === 5) {
      ctx.moveTo(cx - 24, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 24, cy);
      ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 24);
    } else {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(cx + dx * spread, cy + dy * spread);
        ctx.lineTo(cx + dx * (spread + 8), cy + dy * (spread + 8));
      }
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,255,190,0.9)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    if (this.hitMarker > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${this.hitMarker * 3})`; ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(cx + dx * 6, cy + dy * 6); ctx.lineTo(cx + dx * 13, cy + dy * 13); }
      ctx.stroke();
    }
  }

  // Floating triangles over every player: green friends, red foes
  drawIFF(s) {
    const { ctx } = this;
    for (const o of s.others) {
      if (!o.alive) continue;
      const head = [o.pos[0], o.pos[1] + 2.8, o.pos[2]];
      const sp = this.project(s.camera, head);
      if (!sp) continue;
      const d = Math.hypot(o.pos[0] - s.camPos[0], o.pos[1] - s.camPos[1], o.pos[2] - s.camPos[2]);
      const friend = o.team === s.me.team;
      const carried = s.flags.find((f) => f && f.state === 1 && f.carrier === o.id);
      if (!friend && d > (carried ? 900 : 350)) continue;
      if (carried) {
        // Waving flag icon above a carrier, in the colour of the flag they hold
        ctx.save(); ctx.translate(sp[0], sp[1] - 40);
        ctx.strokeStyle = css(TEAM_COLORS[carried.team]); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(13, -5 + Math.sin(performance.now() / 150) * 2); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      const col = friend ? FRIEND : FOE;
      const sz = Math.max(4, 9 - d / 60);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(sp[0] - sz, sp[1] - sz * 1.4); ctx.lineTo(sp[0] + sz, sp[1] - sz * 1.4); ctx.lineTo(sp[0], sp[1]);
      ctx.closePath(); ctx.fill();
      if (d < (friend ? 600 : 160)) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(o.name, sp[0] + 1, sp[1] - sz * 1.4 - 9);
        ctx.fillStyle = col; ctx.fillText(o.name, sp[0], sp[1] - sz * 1.4 - 10);
        const hw = 26;
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sp[0] - hw / 2, sp[1] - sz * 1.4 - 4, hw, 3);
        ctx.fillStyle = col; ctx.fillRect(sp[0] - hw / 2, sp[1] - sz * 1.4 - 4, hw * Math.max(0, o.hp) / (o.maxHp || 100), 3);
        ctx.textAlign = 'left';
      }
    }
  }

  drawFlags(s) {
    const { ctx } = this;
    for (let i = 0; i < 2; i++) {
      const f = s.flags[i];
      if (!f) continue;
      const pos = [f.pos[0], f.pos[1] + 3.5, f.pos[2]];
      const d = Math.hypot(pos[0] - s.camPos[0], pos[1] - s.camPos[1], pos[2] - s.camPos[2]);
      let sp = this.project(s.camera, pos);
      const label = `${f.state === 0 ? '' : f.state === 1 ? 'TAKEN ' : 'DROPPED '}${Math.round(d)}m`;
      const W = this.w, H = this.h;
      let edge = false;
      if (!sp || sp[0] < 20 || sp[0] > W - 20 || sp[1] < 20 || sp[1] > H - 20) {
        // Clamp to a ring around the crosshair, pointing toward the flag
        const dir = [pos[0] - s.camPos[0], pos[2] - s.camPos[2]];
        const yaw = s.me.yaw;
        const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
        const x = dir[0] * right[0] + dir[1] * right[1], z = dir[0] * fwd[0] + dir[1] * fwd[1];
        const a = Math.atan2(x, z);
        const r = Math.min(W, H) * 0.42;
        sp = [W / 2 + Math.sin(a) * r, H / 2 - Math.cos(a) * r];
        edge = true;
      }
      const col = css(TEAM_COLORS[i]);
      ctx.save();
      ctx.translate(sp[0], sp[1]);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(12, -6); ctx.lineTo(0, -2); ctx.closePath(); ctx.fill();
      if (edge) { ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(label, 1, 21);
      ctx.fillStyle = col; ctx.fillText(label, 0, 20);
      ctx.restore();
    }
  }

  drawCompass(s) {
    const { ctx } = this;
    const W = this.w, cx = W / 2, y = 22, half = 180;
    ctx.fillStyle = 'rgba(10,16,22,0.45)'; ctx.fillRect(cx - half, y - 12, half * 2, 24);
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - half, y - 12, half * 2, 24); ctx.clip();
    const heading = ((-s.me.yaw * 180 / Math.PI) % 360 + 360) % 360; // 0 = -Z = "N"
    const pxPerDeg = 3;
    ctx.textAlign = 'center';
    for (let deg = 0; deg < 360; deg += 15) {
      let dd = deg - heading; if (dd > 180) dd -= 360; if (dd < -180) dd += 360;
      const x = cx + dd * pxPerDeg;
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
      ctx.fillStyle = label ? '#e8eef5' : 'rgba(200,220,235,0.6)';
      if (label) ctx.fillText(label, x, y); else ctx.fillRect(x - 0.5, y - 4, 1, 8);
    }
    for (let i = 0; i < 2; i++) {
      const f = s.flags[i]; if (!f) continue;
      const deg = (Math.atan2(f.pos[0] - s.camPos[0], -(f.pos[2] - s.camPos[2])) * 180 / Math.PI + 360) % 360;
      let dd = deg - heading; if (dd > 180) dd -= 360; if (dd < -180) dd += 360;
      ctx.fillStyle = css(TEAM_COLORS[i]);
      const x = cx + Math.max(-half + 6, Math.min(half - 6, dd * pxPerDeg));
      ctx.beginPath(); ctx.moveTo(x - 5, y + 12); ctx.lineTo(x + 5, y + 12); ctx.lineTo(x, y + 5); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#9fffb6'; ctx.fillRect(cx - 1, y - 12, 2, 6);
    ctx.textAlign = 'left';
  }

  drawRadar(s) {
    const { ctx } = this;
    const r = 70, cx = this.w - r - 16, cy = r + 16, range = 400;
    ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(160,255,190,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r / 2, 0, Math.PI * 2); ctx.stroke();
    const yaw = s.me.yaw;
    const toRadar = (p) => {
      const dx = p[0] - s.camPos[0], dz = p[2] - s.camPos[2];
      const x = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const z = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      let rx = x / range * r, rz = z / range * r;
      const l = Math.hypot(rx, rz);
      if (l > r - 4) { rx *= (r - 4) / l; rz *= (r - 4) / l; }
      return [cx + rx, cy + rz];
    };
    if (s.vehicles) {
      for (const v of s.vehicles) {
        if (!v.alive) continue;
        const [x, y] = toRadar(v.pos);
        ctx.strokeStyle = v.team === s.me.team ? FRIEND : 'rgba(255,200,120,0.8)';
        ctx.strokeRect(x - 3, y - 3, 6, 6);
      }
    }
    for (const o of s.others) {
      if (!o.alive) continue;
      const friend = o.team === s.me.team;
      if (!friend && !o.spotted) continue;
      const [x, y] = toRadar(o.pos);
      ctx.fillStyle = friend ? FRIEND : FOE;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    for (let i = 0; i < 2; i++) {
      const f = s.flags[i]; if (!f) continue;
      const [x, y] = toRadar(f.pos);
      ctx.fillStyle = css(TEAM_COLORS[i]);
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 4, cy + 4); ctx.lineTo(cx - 4, cy + 4); ctx.fill();
  }

  drawScore(s) {
    const { ctx } = this;
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    for (let i = 0; i < 2; i++) {
      const y = 22 + i * 24;
      ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.fillRect(12, y - 11, 150, 22);
      ctx.fillStyle = css(TEAM_COLORS[i]); ctx.fillRect(12, y - 11, 4, 22);
      ctx.fillStyle = i === s.me.team ? '#ffffff' : '#c8d2dc';
      ctx.fillText(TEAM_NAMES[i].toUpperCase(), 24, y);
      ctx.textAlign = 'right'; ctx.fillText(String(s.score[i] ?? 0), 154, y); ctx.textAlign = 'left';
      const f = s.flags[i];
      if (f && f.state !== 0) { ctx.fillStyle = f.state === 1 ? '#ffd060' : '#ff9a60'; ctx.fillText(f.state === 1 ? '⚑' : '!', 132, y); }
    }
    ctx.font = FONT;
    ctx.fillStyle = 'rgba(232,238,245,0.7)';
    ctx.fillText(s.mapName, 14, 74);
  }

  // Generator and turret status for both bases, under the score
  drawBase(s) {
    const { ctx } = this;
    if (!s.objects || !s.ob) return;
    for (let t = 0; t < 2; t++) {
      const y = 94 + t * 18;
      const gen = s.objects.find((o) => o.team === t && o.type === 'gen');
      if (!gen || !s.ob[gen.id]) continue;
      const turrets = s.objects.filter((o) => o.team === t && o.type === 'turret');
      const g = s.ob[gen.id];
      const pct = Math.round(100 * g[0] / gen.maxHp);
      const tOn = turrets.filter((o) => s.ob[o.id] && !s.ob[o.id][1] && s.power[t]).length;
      ctx.fillStyle = 'rgba(10,16,22,0.45)'; ctx.fillRect(12, y - 8, 150, 16);
      ctx.fillStyle = css(TEAM_COLORS[t]); ctx.fillRect(12, y - 8, 4, 16);
      ctx.fillStyle = g[1] ? '#ff6a5a' : pct < 100 ? '#ffd060' : '#c8d2dc';
      ctx.fillText(g[1] ? `GEN DOWN ${pct}%` : `GEN ${pct}%`, 22, y);
      ctx.fillStyle = tOn === turrets.length ? '#c8d2dc' : '#ffb08a';
      ctx.fillText(`TUR ${tOn}/${turrets.length}`, 112, y);
    }
  }

  drawBars(s) {
    const { ctx } = this;
    const A = ARMORS[s.me.armor];
    const x = 16, y = this.h - 70, w = 220;
    const hp = Math.max(0, s.me.hp) / A.hp, en = s.me.energy / A.maxEnergy;
    ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.fillRect(x - 6, y - 32, w + 70, 82);
    ctx.fillStyle = 'rgba(200,215,230,0.7)';
    ctx.fillText(`${A.name.toUpperCase()} · ${PACKS[s.me.pack]?.name.toUpperCase() ?? ''}${s.repairing ? ' · REPAIRING' : ''}`, x, y - 21);
    // Consumables: grenades (G) and repair kits (H)
    ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.fillRect(x + w + 70, y - 32, 74, 82);
    ctx.fillStyle = s.me.nades ? '#e8eef5' : '#ff6a5a'; ctx.fillText(`G  ◉ ${s.me.nades}`, x + w + 80, y - 12);
    ctx.fillStyle = s.me.kits ? '#e8eef5' : '#ff6a5a'; ctx.fillText(`H  ✚ ${s.me.kits}`, x + w + 80, y + 10);
    ctx.fillStyle = '#c8d2dc'; ctx.fillText('ARMOR', x, y - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 54, y - 8, w - 54, 10);
    ctx.fillStyle = hp > 0.35 ? '#7dff8a' : '#ff5a4a'; ctx.fillRect(x + 54, y - 8, (w - 54) * hp, 10);
    ctx.fillStyle = '#c8d2dc'; ctx.fillText('ENERGY', x, y + 15);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 54, y + 10, w - 54, 10);
    ctx.fillStyle = en > 0.2 ? '#5ac8ff' : '#ffb04a'; ctx.fillRect(x + 54, y + 10, (w - 54) * en, 10);
    const kmh = Math.round(s.speed * 3.6);
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = s.skiing ? '#9fe8ff' : '#e8eef5';
    ctx.fillText(`${kmh}`, x + w + 4, y + 4);
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.fillStyle = '#c8d2dc'; ctx.fillText(s.skiing ? 'KM/H SKI' : 'KM/H', x + w + 4, y + 22);
    ctx.font = FONT;
    if (s.carrying) this.banner('YOU HAVE THE FLAG — GET HOME', this.h - 120, '#ffd060');
  }

  drawVehicle(s) {
    const { ctx } = this;
    const v = s.vehicle;
    const x = 16, y = this.h - 70, w = 220;
    ctx.fillStyle = 'rgba(10,16,22,0.5)'; ctx.fillRect(x - 6, y - 32, w + 70, 82);
    ctx.fillStyle = 'rgba(200,215,230,0.7)'; ctx.fillText('SKIFF  ·  E to bail out', x, y - 21);
    ctx.fillStyle = '#c8d2dc'; ctx.fillText('HULL', x, y - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 54, y - 8, w - 54, 10);
    const hp = Math.max(0, v.hp) / SKIFF.hp;
    ctx.fillStyle = hp > 0.35 ? '#7dff8a' : '#ff5a4a'; ctx.fillRect(x + 54, y - 8, (w - 54) * hp, 10);
    ctx.fillStyle = '#c8d2dc'; ctx.fillText('LIFT', x, y + 15);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 54, y + 10, w - 54, 10);
    ctx.fillStyle = '#5ac8ff'; ctx.fillRect(x + 54, y + 10, (w - 54) * v.energy / SKIFF.energy, 10);
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = '#e8eef5';
    ctx.fillText(`${Math.round(s.speed * 3.6)}`, x + w + 4, y + 4);
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.fillStyle = '#c8d2dc'; ctx.fillText('KM/H', x + w + 4, y + 22);
    ctx.font = FONT;
    if (s.carrying) this.banner('YOU HAVE THE FLAG — GET HOME', this.h - 120, '#ffd060');
  }

  drawWeapons(s) {
    const { ctx } = this;
    const list = s.me.weapons;
    const x = this.w - 220, y0 = this.h - 24 - list.length * 22;
    list.forEach((wi, i) => {
      const w = WEAPONS[wi];
      const y = y0 + i * 22;
      const sel = wi === s.me.weapon;
      ctx.fillStyle = sel ? 'rgba(90,200,255,0.25)' : 'rgba(10,16,22,0.45)';
      ctx.fillRect(x, y - 10, 204, 20);
      ctx.fillStyle = sel ? '#ffffff' : 'rgba(200,215,230,0.7)';
      ctx.fillText(`${i + 1}  ${w.name}`, x + 8, y);
      ctx.textAlign = 'right';
      const a = s.me.ammo[wi];
      const label = w.energyCost ? `${w.energyCost}E` : a < 0 ? '∞' : String(a);
      const ok = w.energyCost ? s.me.energy >= w.energyCost : a !== 0;
      ctx.fillStyle = ok ? (sel ? '#9fffb6' : 'rgba(200,215,230,0.7)') : '#ff6a5a';
      ctx.fillText(label, x + 196, y);
      ctx.textAlign = 'left';
    });
  }

  drawFeed() {
    const { ctx } = this;
    const now = performance.now();
    this.feed = this.feed.filter((f) => now - f.t < 9000);
    let y = this.h - 190;
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      ctx.globalAlpha = Math.min(1, (9000 - (now - f.t)) / 1000);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(f.text, 17, y + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, 16, y);
      y -= 18;
    }
    ctx.globalAlpha = 1;
  }

  drawCenter() {
    const now = performance.now();
    this.center = this.center.filter((c) => now - c.t < 4500);
    this.center.forEach((c, i) => {
      this.ctx.globalAlpha = Math.min(1, (4500 - (now - c.t)) / 800);
      this.banner(c.text, 140 + i * 30, '#ffe6a0');
    });
    this.ctx.globalAlpha = 1;
  }
}
