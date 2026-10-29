# Ridgeline

A jetpack-skiing team capture-the-flag shooter for the browser. Three.js on the client, a Node + `ws` authoritative server, and bots that fill empty slots.

## Run

```
npm install
npm start            # http://localhost:8080
```

The page opens on a server browser. Join the always-on public game, or create your own with a name, starting map, bots per team, captures to win, max players and an optional password. In a game, press Esc and use **Copy invite link** to send friends a `#room=` link that drops them straight into it. Games with nobody in them close after two minutes (the public one stays), and a game only simulates while someone is in it.

Other machines on your network can browse and join at `http://<your-ip>:8080`.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP + WebSocket port |
| `TEAM_SIZE` | 4 | Public game: bots top each team up to this many players (0 = no bots) |
| `MAP` | 0 | Public game: starting map index (0–4) |
| `CAPS` | 5 | Public game: captures needed to win a map |
| `ROOM_NAME` | Public: Ridgeline | Public game's name in the browser |
| `TIME_LIMIT` | 20 | Public game: match length in minutes |
| `DEBUG_BOTS` | – | Log bot state, kills, flag and base events to the console |

## Controls

WASD move · mouse aim · left click fire · right click / Shift jetpack · Space jump, hold to ski · 1–5 / Q / wheel weapons · G grenade · H repair kit · B loadout · E board or leave a skiff · hold F repair · V third person · Tab scores · T / Y chat · Z quick chat & bot orders · middle mouse or X ping · F1 controls · M switch team · K respawn

## How it plays

- **Skiing**: holding Space removes ground friction, and landing on a slope keeps your velocity along it, so momentum carries downhill and up the next rise.
- **Jetpack**: energy drains while thrusting and regenerates when you stop. Thrust with a movement key held to push sideways.
- **Armor**: Light (fast, 3 weapons, can carry the laser rifle), Medium (4 weapons), Heavy (slow and tough, 5 weapons, can carry the mortar).
- **Loadouts**: press B to choose armor and weapons. The choice applies at your next spawn, or immediately on a powered inventory station inside your keep, which also refills health and ammo.
- **Packs**: one per loadout. Energy (+70% recharge), Repair (double repair speed and range, and hold F with nothing to fix to heal yourself), Shield (energy absorbs half of incoming damage) or Ammo (+60% ammo, extra grenades and a repair kit).
- **Consumables**: 3 hand grenades (G) and 1 repair kit (H, +50 armor) per life, refilled at stations. Dead players drop a supply crate with ammo, armor and a grenade.
- **Environment**: Glasswater Basin has a lake (it slows you and floats you; jet out), and Ashfall Crater has lava pockets that burn about 48 armor a second. Green maps have wind-blown grass, the desert has dry scrub, and every map has drifting cloud shadows plus its own ambient particles (motes, dust, snow or ash).
- **Bases**: a light column marks each flag stand while the flag is home. Towers carry window strips, armor bands and floodlights, and crate stacks and barriers give cover around the plinth. Base materials are tinted to suit each map.
- **Weapons**: disc launcher, chaingun, grenade launcher, plasma rifle, mortar (Heavy), laser rifle (Light, costs energy per shot). Projectiles inherit part of your velocity, and splash damage knocks you back, including yourself, so you can disc-jump.
- **The keep**: each base's walk-in building behind the flag. The ground floor has a front door and a door on each side (all behind force fields), an entrance hall with two inventory stations and lit staircases up both sides, and the generator room behind a single doorway. Upstairs, a gallery looks out over the flag through wide windows and a control room above the generator holds a third station. Jet up the lit shaft in the middle of the hall to reach the parapeted roof. You spawn inside it. The layout lives in `shared/base.js`.
- **Base defenses**: each keep holds a generator that powers two tower turrets and three inventory stations. Destroy the enemy generator to shut them down. Hold F next to your own damaged generator or turret to repair it, and repairing it to full brings it back online.
- **Skiff**: a single-seat hover vehicle parked on a pad beside each base. Press E to board or leave. Jet/Space lifts it, and ramming enemies at speed hurts them. A destroyed skiff respawns on its pad after 20 seconds.
- **CTF**: grab the enemy flag and touch it to your own flag while your flag is home. Dropped flags return after 30 seconds or when a defender touches them. First team to 5 captures wins, and then the server rotates through five maps: Glasswater Basin, Cinder Shelf, Whiteout Pass, Thornwood Mesa and Ashfall Crater.
- **Scoring**: kills 10, assists 5, killing a flag carrier +15, taking the flag from its stand 10, returning your flag 15, capturing 50, destroying a generator 30 or a turret 10, and 2 points for every 60 armor repaired (+10 for bringing something back online). The scoreboard (Tab) shows score, K/D/A, caps, returns, armor class and ping.
- **Matches**: first to the capture limit wins, or the most captures when the timer runs out (a tie is a draw). The end screen shows the winner, MVP awards and your stats, then the next map loads.
- **Spawn protection**: 3 seconds of invulnerability after spawning, ended early by firing.
- **Team comms**: Z opens quick chat. "Attack" and "Defend" switch your team's bots to that role for a minute, "Cover me" sends the three nearest bots to escort you, and a bot acknowledges. Middle mouse (or X) pings the spot under your crosshair for your team.
- **Map vote**: the end-of-match screen offers three maps (the next in rotation plus two others); press 1, 2 or 3. Most votes wins, and ties go to the rotation.
- **Bots**: bots play one of three roles. Attackers run the flag, raiders fight into the enemy keep and shell the generator from its doorway, and defenders patrol and repair. Inside a keep they follow a waypoint graph (A*, with line-of-sight shortcuts); `node scripts/sim-bots.js <map> <minutes>` fast-forwards a bots-only match and reports how they cope.

## Sound effects

Sounds are generated with ElevenLabs Sound Effects v2 (via fal.ai or ElevenLabs directly) from the prompts in `scripts/sfx-manifest.js`, and saved to `public/audio/sfx/`. Any sound without a file falls back to synthesis, so the game always has audio.

```
node scripts/generate-sfx.js --dry-run              # price it (whole set ≈ $0.46)
FAL_KEY=... node scripts/generate-sfx.js            # or ELEVENLABS_API_KEY=..., or --env-file path
node scripts/generate-sfx.js --only fire_disc --force   # redo one sound
```

Files already on disk are never requested again, so reruns only pay for what is missing. On load, the game trims leading silence from one-shots, normalizes levels, picks a random variant with slight pitch variation, and places sounds in stereo. Per-sound loudness is the `gain` field in the manifest.

## 3D models

Some models are AI-generated on fal.ai from `scripts/model-manifest.js`: a reference image (nano-banana), then Meshy image-to-3D (rigged with walk and run clips for characters), then web optimisation into `public/models/` (meshopt geometry, 1024px WebP textures). Anything without a generated model uses the procedural one in `public/js/models.js`.

```
node scripts/generate-models.js --dry-run           # price it (image ≈ $0.04, mesh $0.80)
FAL_KEY=... node scripts/generate-models.js --images-only   # review references first
FAL_KEY=... node scripts/generate-models.js         # meshes for every reviewed reference
node scripts/inspect-glb.js public/models/skiff.glb # bounds, triangles, textures, bones
```

Raw downloads are cached in `assets-src/models/<id>/` (not deployed), so reruns only pay for what's missing. `public/js/assets3d.js` normalises each model (size, facing, glow and reflection strength in `FIT`), shifts orange accents to the other team's hue, and drives rigged characters: walk/run clips synced to ground speed, with aim, ski crouch and airborne poses layered on procedurally. Open `/modelview.html` to inspect models and poses (`?id=…&rig=ski&weapon=4&dist=0.3`). Generated so far: all three armour classes, the skiff, all six weapons, the generator, the turret head, the supply crate, and the scenery (pine, snowy pine, broadleaf, dead tree, rock spire, boulder - drawn instanced in 256 m chunks, see `GENERATED` in `public/js/scenery.js`); stations and vehicle pads stay procedural.

## Surface textures

Ground and structure textures are generated with nano-banana from `scripts/texture-manifest.js`, made seamless (a two-pass, variance-preserving offset blend; grid-like panels skip it) and saved as 1024px WebP in `public/textures/`.

```
node scripts/generate-textures.js --dry-run         # price it (≈ $0.04 each)
FAL_KEY=... node scripts/generate-textures.js       # generate anything missing, rebuild the WebPs
FAL_KEY=... node scripts/generate-textures.js --only sand --redo   # re-roll one
```

`TERRAIN_SETS` in `public/js/textures.js` picks four per map palette (low, mid, high ground and cliff rock). The terrain shader blends them by altitude, slope and texture height, hides tiling with a second rotated sample, projects rock triplanar, bumps the lighting from the textures and takes sun shadows; grass blades take the ground colour beneath them. Procedural textures stand in until (or unless) the generated ones load.

## Lighting

The sun casts real-time shadows in a 190 m box that follows the camera (2048 px on High, 1024 on Medium, off on Low). Sunlight is tinted from each map's horizon colour; clouds are lit from the sun's side, with cover and tint per palette (`CLOUD_COVER`, `CLOUD_TINT` in `public/js/scene.js`).

## Layout

```
server.js           lobby: static files, /api/rooms (list + create), routes WebSockets into rooms, ticks rooms
server/room.js      one match: players, bots, combat, flags, base objects, vehicles, snapshots
shared/world.js     deterministic tiling heightmap, maps, base layout and objects, raycasts
shared/base.js      the keep: walls, floors, stairs, stations, spawns and the bots' waypoint graph
shared/physics.js   player movement and armor classes (client prediction and server bots)
shared/weapons.js   weapon stats, loadout rules and projectile flight
shared/vehicles.js  skiff hover physics
public/js/          client: scene, models, effects, HUD, audio, netcode, loadout UI
```

Movement is client-predicted for both players and skiff drivers, and the client sends its state at 30 Hz. Your own shots are drawn the moment you fire, then handed over to the server's copy when it arrives. The server simulates projectiles, turrets and empty vehicles, and applies damage, knockback, repairs and flag logic. It runs at 60 Hz and sends snapshots at 20 Hz. Remote players and vehicles are drawn with a 100 ms interpolation buffer.

Add `?debug` to the URL to expose client state as `window.__rl` for automated testing.

## Built with

Written with [Claude Code](https://claude.com/claude-code). Model: Claude Opus 5.5 (`claude-opus-5-5`), 2026-10-27 to 2026-10-28.

Play it at https://aislop.cloud/ridgeline/. Part of the [aislop.cloud](https://aislop.cloud) portfolio.
