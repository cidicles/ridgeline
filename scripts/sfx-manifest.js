// Every generated sound in the game. One entry per sound id; `n` variants are
// generated so repeats can be randomised. Prompts are written for ElevenLabs
// Sound Effects v2: say what it is, how long, and how dry, because a reverb
// tail on a gunshot reads as lag in a shooter.
//
//   d      duration in seconds (0.5–22); omit to let the model choose
//   loop   true for seamless loops (engines, jets, ambience)
//   n      variants to generate (default 1)
//   pi     prompt influence 0–1 (default 0.45; higher = more literal)
//   gain   playback gain multiplier applied by the game (loops are first matched to
//          -20 dBFS average loudness, one-shots to a common peak)

const DRY = 'isolated sound effect, close mic, dry, no reverb tail, no music';

export const SFX = [
  // ---------- weapons ----------
  { id: 'fire_disc', d: 0.9, n: 2, gain: 1, text: `Sci-fi disc launcher firing: heavy pneumatic thump with a rising electric whoosh as a spinning energy disc leaves the barrel, punchy, ${DRY}` },
  { id: 'fire_chaingun', d: 0.5, n: 3, gain: 0.55, text: `Single shot from a futuristic rotary chaingun, sharp metallic crack with mechanical clatter, very short, ${DRY}` },
  { id: 'fire_grenade', d: 0.7, n: 2, gain: 0.9, pi: 0.6, text: `Grenade launcher firing a single round: loud punchy hollow tube pop "thunk" with a metallic clank, clearly audible, ${DRY}` },
  { id: 'fire_plasma', d: 0.7, n: 2, gain: 0.8, text: `Plasma rifle shot, crackling electric zap with a hot sizzling whoosh, sci-fi, ${DRY}` },
  { id: 'fire_mortar', d: 1.2, n: 2, gain: 1, text: `Heavy energy mortar launch, deep booming thump with a rising whistle, powerful low end, ${DRY}` },
  { id: 'fire_laser', d: 1.0, n: 2, gain: 0.8, text: `Sniper laser rifle shot, piercing high energy beam crack with a short electric ring, sci-fi, ${DRY}` },
  { id: 'fire_turret', d: 0.7, n: 2, gain: 0.8, text: `Automated sci-fi base turret firing an energy bolt, mechanical clunk and electric pew, ${DRY}` },
  { id: 'throw_grenade', d: 0.6, n: 1, gain: 0.7, text: `Armored soldier throwing a grenade, quick whoosh of arm motion and a metal pin ping, ${DRY}` },
  { id: 'dry_fire', d: 0.5, n: 1, gain: 0.6, text: `Empty weapon trigger click, dry mechanical click with no shot, ${DRY}` },
  { id: 'weapon_switch', d: 0.6, n: 1, gain: 0.5, text: `Futuristic weapon being raised and armed, short servo whir and metallic latch clack, ${DRY}` },

  // ---------- impacts & explosions ----------
  { id: 'boom_disc', d: 1.6, n: 3, gain: 1, text: `Energy disc explosion, sharp concussive blast with crackling electric discharge and debris, mid-sized, ${DRY}` },
  { id: 'boom_grenade', d: 1.8, n: 2, gain: 1, text: `Grenade explosion outdoors, punchy blast with dirt and debris scatter, ${DRY}` },
  { id: 'boom_mortar', d: 2.5, n: 2, gain: 1.1, text: `Huge heavy mortar shell explosion, deep earth-shaking boom with rumbling debris and rolling low end` },
  { id: 'boom_plasma', d: 1.0, n: 2, gain: 0.85, text: `Plasma bolt impact, hissing sizzling energy splash with a soft pop, ${DRY}` },
  { id: 'impact_bullet', d: 0.5, n: 4, gain: 0.45, text: `Bullet ricochet off rock and metal, short sharp ping and dirt hit, ${DRY}` },
  { id: 'boom_distant', d: 3, n: 2, gain: 0.8, text: `Distant explosion far away across open hills, muffled low boom with long rolling echo` },
  { id: 'vehicle_explode', d: 2.5, n: 1, gain: 1.1, text: `Hover vehicle exploding, large metallic blast with tearing metal and scattering debris` },

  // ---------- player body ----------
  { id: 'hurt', d: 0.6, n: 3, gain: 0.7, text: `Armored soldier taking a hit, heavy metallic armor impact clank with a grunt, ${DRY}` },
  { id: 'gib', d: 1.4, n: 2, gain: 0.9, text: `Gory body explosion, wet splatter and meaty chunks with metal armor plates clattering, video game gore, ${DRY}` },
  { id: 'body_fall', d: 1.2, n: 2, gain: 0.8, text: `Heavy armored body collapsing onto the ground, metal suit thud and scrape, ${DRY}` },
  { id: 'step_light', d: 0.5, n: 4, gain: 0.45, pi: 0.75, text: `ONE single footfall only, one impact: a light armored boot stepping once on dirt and grass, short crunch, then silence, ${DRY}` },
  { id: 'step_heavy', d: 0.5, n: 4, gain: 0.55, pi: 0.75, text: `ONE single heavy footfall only, one impact: a large armored mech boot stomping once on dirt, metallic thud, then silence, ${DRY}` },
  { id: 'land', d: 0.8, n: 2, gain: 0.8, text: `Armored soldier landing hard on the ground after a jump, heavy thud with servo hiss, ${DRY}` },
  { id: 'jump', d: 0.5, n: 2, gain: 0.5, text: `Short burst of a jetpack kick plus a servo for an armored soldier jumping, ${DRY}` },
  { id: 'splash', d: 1.2, n: 2, gain: 0.9, text: `Heavy body splashing into a lake, big water splash, ${DRY}` },
  { id: 'lava_hiss', d: 1.5, n: 1, gain: 0.9, text: `Metal armor falling into molten lava, violent sizzle and steam hiss with a bubbling plop, ${DRY}` },
  { id: 'heartbeat', d: 1.0, n: 1, gain: 0.7, text: `Single slow heavy heartbeat thump-thump, low and muffled, ${DRY}` },

  // ---------- loops: movement & vehicles ----------
  { id: 'loop_jet', d: 4, loop: true, gain: 0.55, text: `Continuous jetpack thruster burn, roaring rocket hiss with steady airy rumble, seamless loop` },
  { id: 'loop_ski', d: 4, loop: true, gain: 0.4, text: `Continuous skiing slide over frozen ground, smooth gritty friction hiss, seamless loop` },
  { id: 'loop_wind_speed', d: 5, loop: true, gain: 0.45, text: `Strong wind rushing past at high speed, buffeting air roar, seamless loop` },
  { id: 'loop_skiff', d: 4, loop: true, gain: 0.6, text: `Futuristic hover bike engine idling and humming, anti-gravity whine with low turbine drone, seamless loop` },
  { id: 'loop_repair', d: 3, loop: true, gain: 0.4, text: `Sci-fi repair beam welding, crackling electric arc with soft hum, seamless loop` },

  // ---------- base ----------
  { id: 'loop_generator', d: 6, loop: true, gain: 0.4, text: `Large sci-fi power generator humming, deep electrical drone with subtle pulsing, seamless loop` },
  { id: 'gen_down', d: 3, n: 1, gain: 1, text: `Power generator failing, electrical overload crackle, explosion, power-down whine descending` },
  { id: 'station', d: 1.5, n: 1, gain: 0.8, text: `Sci-fi equipment station recharging armor, rising energy charge with mechanical clamps locking, ${DRY}` },
  { id: 'pickup', d: 0.8, n: 1, gain: 0.6, text: `Picking up an ammo and supply crate in a sci-fi game, quick satisfying metallic grab and chime, ${DRY}` },
  { id: 'kit', d: 1.0, n: 1, gain: 0.7, text: `Using a medical repair kit on power armor, injector hiss and soft healing chime, ${DRY}` },
  { id: 'spawn', d: 1.5, n: 1, gain: 0.7, text: `Soldier teleporting in to respawn, shimmering energy swell and materialize whoosh, sci-fi, ${DRY}` },
  { id: 'board', d: 1.0, n: 1, gain: 0.7, text: `Climbing into a hover vehicle, canopy latch clunk and engine spin-up, ${DRY}` },

  // ---------- flag & match stingers ----------
  { id: 'flag_grab', d: 2, n: 1, gain: 0.75, text: `Short heroic sci-fi game stinger, rising synth brass, achievement feel, two seconds` },
  { id: 'flag_lost', d: 2, n: 1, gain: 0.75, text: `Short urgent sci-fi alarm stinger, warning klaxon synth, danger, two seconds` },
  { id: 'flag_return', d: 1.5, n: 1, gain: 0.7, text: `Short bright positive confirmation chime, crystalline synth arpeggio, game UI` },
  { id: 'flag_drop', d: 1.2, n: 1, gain: 0.7, text: `Short tense descending two-note synth stinger, game event` },
  { id: 'cap_us', d: 3, n: 1, gain: 0.8, text: `Triumphant short victory fanfare, epic sci-fi synth and brass, team scored, three seconds` },
  { id: 'cap_them', d: 3, n: 1, gain: 0.8, text: `Short ominous defeat stinger, low dark synth brass falling, enemy scored, three seconds` },
  { id: 'win', d: 5, n: 1, gain: 0.8, text: `Epic victory fanfare for a sci-fi game, uplifting orchestral brass and synth, five seconds` },
  { id: 'lose', d: 5, n: 1, gain: 0.8, text: `Somber defeat music sting for a sci-fi game, slow low synth and strings, five seconds` },

  // ---------- UI ----------
  { id: 'hitmarker', d: 0.5, n: 1, gain: 0.5, text: `Crisp short hit confirmation tick for a shooter game UI, metallic tick, ${DRY}` },
  { id: 'kill', d: 0.8, n: 1, gain: 0.6, text: `Satisfying kill confirmation sound for a shooter game, punchy metallic ding with low thump, ${DRY}` },
  { id: 'radio', d: 0.6, n: 1, gain: 0.5, text: `Military radio squelch blip, short static burst and beep, ${DRY}` },
  { id: 'ping', d: 0.7, n: 1, gain: 0.55, text: `Tactical map ping marker sound, bright two-tone sonar blip, sci-fi UI, ${DRY}` },
  { id: 'callout', d: 1.2, n: 1, gain: 0.6, text: `Arcade multi-kill announcement stinger, energetic synth hit with whoosh, game UI` },
  { id: 'ui_click', d: 0.5, n: 1, gain: 0.4, pi: 0.6, text: `Single crisp clearly audible menu button click, short bright digital tick, sci-fi interface, ${DRY}` },

  // ---------- ambience beds (seamless loops) ----------
  { id: 'amb_meadow', d: 20, loop: true, gain: 0.28, text: `Peaceful open highland meadow ambience, gentle breeze through grass, distant birds, seamless loop` },
  { id: 'amb_desert', d: 20, loop: true, gain: 0.28, text: `Hot desert wind ambience, sand blowing over dunes, gusty dry wind, seamless loop` },
  { id: 'amb_snow', d: 20, loop: true, gain: 0.3, text: `Cold alpine mountain pass ambience, howling icy wind, blowing snow, seamless loop` },
  { id: 'amb_ash', d: 20, loop: true, gain: 0.26, text: `Volcanic wasteland ambience, low ominous rumble, hot wind and distant crackling, seamless loop` },
  { id: 'amb_lake', d: 15, loop: true, gain: 0.45, text: `Gentle lake water lapping against a rocky shore, soft small waves, seamless loop` },
  { id: 'amb_lava', d: 15, loop: true, gain: 0.5, text: `Molten lava pool bubbling and churning, thick blorps and hissing, seamless loop` },
];

// Rough cost at fal's $0.002 per generated second; durationless entries assume 3s
export const USD_PER_SECOND = 0.002;
export function estimate(list = SFX) {
  const seconds = list.reduce((sum, e) => sum + (e.d ?? 3) * (e.n ?? 1), 0);
  return { seconds, usd: seconds * USD_PER_SECOND };
}
