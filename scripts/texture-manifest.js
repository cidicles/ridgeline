// AI-generated ground and surface textures (fal-ai/nano-banana), made seamless
// by scripts/generate-textures.js. The terrain shader picks four per map palette
// (low ground, mid ground, high ground, cliff rock) - see TERRAIN_SETS in
// public/js/textures.js; structures use the last three. Grid-like ones
// (seamless: false) already tile at their panel seams, and the blend would ghost them.

const SHOT = 'seamless tileable game texture, a flat top-down orthographic photograph, evenly lit with soft diffuse overcast light, no shadows, no perspective, no horizon, no objects, fills the entire square frame edge to edge, crisp natural detail';
const PANEL = 'seamless tileable game texture, a flat front-on orthographic photograph, evenly lit with soft diffuse light, no perspective, no text, no logos, fills the entire square frame edge to edge, crisp detail';
const FACE = 'seamless tileable game texture, a flat face-on orthographic photograph of a vertical rock face, evenly lit with soft diffuse light, no perspective, no sky, fills the entire square frame edge to edge, crisp natural detail';

export const TEXTURES = [
  // Temperate
  { id: 'grass', prompt: `Dense short natural meadow grass, uniform even coverage, mixed green and slightly yellow-green blades, no clover, no flowers, no bright spots, ${SHOT}` },
  { id: 'meadow_dirt', prompt: `Dry brown earth and dirt with scattered small pebbles and sparse tufts of yellow-green grass, ${SHOT}` },
  { id: 'cliff_rock', prompt: `Grey weathered granite rock with cracks, ledges and subtle moss in the crevices, ${FACE}` },
  // Snow (fresh snow also caps temperate peaks)
  { id: 'snow', prompt: `Fresh soft white snow with gentle wind ripples and subtle sparkle, very slightly blue in the shadows, ${SHOT}` },
  { id: 'packed_snow', prompt: `Wind-packed snow and blue-tinted ice crust with fine cracks and a few exposed dark gravel specks, ${SHOT}` },
  { id: 'granite', prompt: `Dark blue-grey granite rock with frost and thin streaks of snow in the cracks, ${FACE}` },
  // Desert
  { id: 'sand', prompt: `Fine warm golden desert sand with soft small wind ripples, ${SHOT}` },
  { id: 'red_earth', prompt: `Cracked dry red clay desert earth with a polygon pattern of shallow cracks and scattered small stones, ${SHOT}` },
  { id: 'pale_sand', prompt: `Pale bleached sandy desert ground with fine gravel and small pebbles, ${SHOT}` },
  { id: 'sandstone', prompt: `Red and ochre layered sandstone with horizontal strata bands and erosion pits, ${FACE}` },
  // Volcanic
  { id: 'ash', prompt: `Dark grey volcanic ash ground with fine black cinders and small pumice pebbles, ${SHOT}` },
  { id: 'gravel', prompt: `Loose dark grey pebbles and small rough stones with a few reddish-brown stones mixed in, ${SHOT}` },
  { id: 'pale_ash', prompt: `Light grey settled volcanic ash dust with faint wind streaks and a few dark cinders, ${SHOT}` },
  { id: 'basalt', prompt: `Rough dark volcanic rock face, irregular fractured black and charcoal grey lava rock with pitted vesicles and faint reddish-brown oxidation, no regular columns, ${FACE}` },
  // Structures
  { id: 'hull_panels', seamless: false, prompt: `Sci-fi base wall cladding made of large light grey painted metal plates in a neat grid with recessed seams, small bolts at the corners, a few thin vents, subtle scratches, chipped paint and light grime, ${PANEL}` },
  { id: 'concrete', prompt: `Weathered poured concrete wall with faint formwork lines, small pits, hairline cracks and light water stains, ${PANEL}` },
  { id: 'cargo_crate', seamless: false, prompt: `Olive green painted ribbed steel cargo container panel with vertical corrugations, worn edges with bare metal showing, faint stencil-free surface, light dust, ${PANEL}` },
];

export const USD = 0.039;
