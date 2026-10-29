// AI-generated 3D models. Each asset is made in three steps:
//   1. a reference image from `image` (fal-ai/nano-banana), in one consistent style
//   2. a 3D model from that image (Meshy image-to-3D on fal), with a polygon budget
//   3. web optimisation (smaller textures, WebP) into public/models/<id>.glb
// Characters are generated empty-handed in an A-pose so the auto-rig works, and
// weapons are attached to the hand bone in game.

const NATURE = 'stylised realistic 3D game asset render, natural materials, soft studio lighting, isolated on a plain white background, no text';
const STYLE ='clean stylised 3D game asset render, smooth bevelled hard-surface panels, soft studio lighting, isolated on a plain white background, no text, no logo';

export const MODELS = [
  {
    id: 'soldier_medium_ember',
    kind: 'character',
    image: `Full body game character, a sci-fi power-armoured soldier wearing sleek rounded armour plates in gunmetal grey with bright orange accent panels on the chest and shoulder pauldrons, a helmet with a glowing amber visor, a compact jetpack on the back, standing in a neutral A-pose with arms angled away from the body, empty open hands, front view, centred, entire body visible from head to boots, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 12000, enable_rigging: true, rigging_height_meters: 2.0, pose_mode: 'a-pose', symmetry_mode: 'on', enable_pbr: true },
  },
  {
    id: 'skiff',
    kind: 'vehicle',
    image: `A single-seat sci-fi hover bike vehicle with no wheels, a sleek wedge-shaped armoured hull tapering to a pointed nose, an open cockpit seat with a small glass windscreen, two side engine pods with glowing blue exhaust rings, orange accent stripes, three-quarter front view, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 8000, symmetry_mode: 'on', enable_pbr: true },
  },
  {
    id: 'disc_launcher',
    kind: 'weapon',
    image: `A chunky handheld sci-fi disc launcher gun with a round glass chamber on top holding a glowing pale-blue energy disc, a flared barrel, a grip and fore-grip, gunmetal and brushed steel with small orange accents, side view, no hands, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'off', enable_pbr: true },
  },
  {
    id: 'soldier_light_ember',
    kind: 'character',
    image: `Full body game character, a slim agile sci-fi scout soldier in lightweight fitted power armour, gunmetal grey with bright orange accent panels on the chest and forearms, small shoulder plates, a sleek narrow helmet with a long glowing amber visor and a small crest fin, a slim compact jetpack on the back, standing in a neutral A-pose with arms angled away from the body, empty open hands, front view, centred, entire body visible from head to boots, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 12000, enable_rigging: true, rigging_height_meters: 1.9, pose_mode: 'a-pose', symmetry_mode: 'on', enable_pbr: true },
  },
  {
    id: 'soldier_heavy_ember',
    kind: 'character',
    image: `Full body game character, a massive bulky sci-fi juggernaut soldier in thick heavy power armour, broad chest, huge rounded shoulder pauldrons, gunmetal grey with bright orange accent panels on the chest and pauldrons, a heavy helmet sunk between the shoulders with a narrow glowing amber visor slit, a large four-nozzle jetpack on the back, thick armoured legs and boots, standing in a neutral A-pose with arms angled away from the body, empty open hands, front view, centred, entire body visible from head to boots, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 14000, enable_rigging: true, rigging_height_meters: 2.4, pose_mode: 'a-pose', symmetry_mode: 'on', enable_pbr: true },
  },
  {
    id: 'chaingun',
    kind: 'weapon',
    image: `A heavy handheld sci-fi rotary chaingun with a cluster of six static barrels (no motion blur), a boxy receiver, a round ammo drum on the side, a carry handle on top, a grip and fore-grip, gunmetal and brushed steel with small orange accents, side view, no hands, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'off', enable_pbr: true },
  },
  {
    id: 'grenade_launcher',
    kind: 'weapon',
    image: `A chunky handheld sci-fi grenade launcher with a short wide barrel, a large revolving cylinder magazine holding glowing amber grenades, a stock, a grip and fore-grip, gunmetal and brushed steel with small orange accents, side view, no hands, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'off', enable_pbr: true },
  },
  {
    id: 'plasma_rifle',
    kind: 'weapon',
    image: `A sleek handheld sci-fi plasma rifle with glowing magenta-pink energy coils wrapped around the barrel, a transparent energy cell in the receiver, vented muzzle, a grip and fore-grip, gunmetal and brushed steel with small orange accents, side view, no hands, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'off', enable_pbr: true },
  },
  {
    id: 'mortar',
    kind: 'weapon',
    image: `A huge shoulder-carried sci-fi mortar cannon with a very wide stubby tube, a heavy breech with a glowing amber shell chamber, armoured side plates, a grip and carry handle, gunmetal and brushed steel with small orange accents, side view, no hands, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'off', enable_pbr: true },
  },
  {
    id: 'laser_rifle',
    kind: 'weapon',
    image: `A long slender sci-fi laser sniper rifle with a long thin barrel, a large scope on top, a glowing red energy cell, a skeletal stock, a grip, gunmetal and brushed steel with small orange accents, side view, no hands, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'off', enable_pbr: true },
  },
  {
    id: 'generator',
    kind: 'prop',
    image: `A tall upright sci-fi base power generator machine, clearly taller than it is wide, a heavy armoured tower-shaped housing with rounded edges, glowing orange energy core windows on both sides, cooling fins, thick pipes and cables, a circular emitter on top, gunmetal grey and steel with orange accents, three-quarter view, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 8000, symmetry_mode: 'on', enable_pbr: true },
  },
  {
    id: 'turret_head',
    kind: 'prop',
    image: `A compact sci-fi automated defence turret head with no base or legs, an armoured rounded dome housing with twin cannon barrels pointing straight forward, a glowing orange sensor eye between the barrels, gunmetal grey and steel with orange accents, side view, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 5000, symmetry_mode: 'on', enable_pbr: true },
  },
  {
    id: 'supply_crate',
    kind: 'prop',
    image: `A small rugged sci-fi supply crate, a metal case with reinforced corners, latches and a carry handle, glowing green plus-sign (+) medical cross markings on the sides, olive drab and steel, three-quarter view, ${STYLE}`,
    meshy: { model_type: 'standard', target_polycount: 2000, symmetry_mode: 'on', enable_pbr: true },
  },
  // Scenery: drawn instanced by the hundred, so kept to a few thousand triangles
  {
    id: 'pine_tree',
    kind: 'scenery',
    aspect: '3:4',
    image: `A single tall stylised conifer pine tree, a straight brown trunk, dense layered dark green needle branches starting low near the ground so only a short stub of trunk shows, forming a full tall cone, full tree visible from the base of the trunk to the tip, no ground, ${NATURE}`,
    meshy: { model_type: 'standard', target_polycount: 3000, symmetry_mode: 'auto', enable_pbr: true },
  },
  {
    id: 'snow_pine',
    kind: 'scenery',
    aspect: '3:4',
    image: `A single tall stylised conifer pine tree heavily laden with thick white snow on top of every branch layer, dark green needles showing underneath, a straight brown trunk, tall narrow cone shape, full tree visible from the base of the trunk to the tip, no ground, ${NATURE}`,
    meshy: { model_type: 'standard', target_polycount: 3000, symmetry_mode: 'auto', enable_pbr: true },
  },
  {
    id: 'broadleaf_tree',
    kind: 'scenery',
    aspect: '3:4',
    image: `A single tall stylised deciduous forest tree with realistic proportions, a straight sturdy trunk, and a full tall rounded canopy made of several large clumps of green leaves with lighter tips, not a bonsai, full tree visible from the base of the trunk to the top, no ground, ${NATURE}`,
    meshy: { model_type: 'standard', target_polycount: 3000, symmetry_mode: 'auto', enable_pbr: true },
  },
  {
    id: 'dead_tree',
    kind: 'scenery',
    aspect: '3:4',
    image: `A single dead charred tree, black and dark grey burnt bark with glowing faint ember cracks near the base, bare twisted branches reaching upward, no leaves, full tree visible from the base of the trunk to the top, no ground, ${NATURE}`,
    meshy: { model_type: 'standard', target_polycount: 2500, symmetry_mode: 'auto', enable_pbr: true },
  },
  {
    id: 'rock_spire',
    kind: 'scenery',
    aspect: '3:4',
    image: `A tall natural rock spire hoodoo, layered horizontal sandstone strata in warm red and ochre bands, eroded and weathered, wide base tapering to a narrower top, full spire visible, no ground, ${NATURE}`,
    meshy: { model_type: 'standard', target_polycount: 3000, symmetry_mode: 'auto', enable_pbr: true },
  },
  {
    id: 'boulder',
    kind: 'scenery',
    image: `A single large weathered grey granite boulder, rounded but faceted with cracks, chips and subtle lichen speckles, neutral grey colour, full boulder visible, no ground, ${NATURE}`,
    meshy: { model_type: 'standard', target_polycount: 1500, symmetry_mode: 'auto', enable_pbr: true },
  },
];

export const USD = { image: 0.039, mesh: 0.8 };
