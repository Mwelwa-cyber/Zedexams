// Picture-bank starter pack — a curated set of core Zambian-curriculum
// figures an admin can batch-generate so teacher searches hit from day
// one. Each entry feeds generateBankPicture (existing AI pipeline) with a
// print-friendly style: 'recraft' = B&W line art (default — photocopies
// crisply; rendered by gpt-image-1 now that Recraft is decommissioned),
// 'kie' = colour illustration for the few items where colour IS the content
// (also rendered by gpt-image-1). Names are what teachers will search;
// keywords widen the match. Pure data module — node-testable.

export const STARTER_SUBJECTS = Object.freeze([
  '_generic', 'integrated_science', 'mathematics', 'social_studies',
  'english', 'home_economics', 'technology_studies',
])

const sci = (name, prompt, keywords) => ({ name, prompt, keywords, subject: 'integrated_science', provider: 'recraft' })
const math = (name, prompt, keywords) => ({ name, prompt, keywords, subject: 'mathematics', provider: 'recraft' })
const ss = (name, prompt, keywords) => ({ name, prompt, keywords, subject: 'social_studies', provider: 'recraft' })

export const STARTER_PACK = [
  // ── Integrated Science ─────────────────────────────────────────────────
  sci('Human ear, labelled', 'Clean educational line-art diagram of the human ear in cross-section with label lines (no text labels) pointing to the earlobe, ear canal, eardrum, middle ear bones and cochlea', ['ear', 'hearing', 'senses', 'sound']),
  sci('Human eye, labelled', 'Clean educational line-art diagram of the human eye in cross-section with label lines pointing to the cornea, iris, pupil, lens and retina', ['eye', 'sight', 'senses', 'vision']),
  sci('Skin cross-section', 'Educational line-art cross-section of human skin showing the epidermis, dermis, a hair follicle and a sweat gland, with label lines', ['skin', 'epidermis', 'dermis', 'touch']),
  sci('Human digestive system', 'Educational line-art outline of a human torso showing the digestive system: mouth, oesophagus, stomach, small intestine, large intestine, with label lines', ['digestive system', 'digestion', 'stomach', 'body systems']),
  sci('Human respiratory system', 'Educational line-art outline of a human torso showing the respiratory system: nose, trachea, bronchi and lungs, with label lines', ['respiratory system', 'breathing', 'lungs', 'body systems']),
  sci('Human heart and circulation', 'Educational line-art diagram of the human heart with the four chambers visible and arrows showing blood flow', ['heart', 'circulatory system', 'blood', 'body systems']),
  sci('Human skeleton', 'Educational line-art front view of a human skeleton with label lines pointing to the skull, ribcage, spine, pelvis and femur', ['skeleton', 'bones', 'body']),
  sci('Flowering plant, labelled', 'Educational line-art drawing of a whole flowering plant with label lines pointing to the roots, stem, leaf, flower and fruit', ['plant', 'parts of a plant', 'roots', 'stem', 'leaf']),
  sci('Bean seedling stages', 'Educational line-art sequence of a bean seed germinating in four stages: seed, root emerging, shoot emerging, young seedling with leaves', ['germination', 'seed', 'seedling', 'plant growth']),
  sci('Parts of a flower', 'Educational line-art cross-section of a flower with label lines pointing to the petal, sepal, stamen, anther, stigma, style and ovary', ['flower', 'pollination', 'reproduction in plants']),
  sci('Water cycle', 'Educational line-art landscape diagram of the water cycle showing the sun, sea, evaporation arrows, cloud formation, rain over hills and a river returning to the sea', ['water cycle', 'evaporation', 'condensation', 'rain']),
  sci('Simple electric circuit', 'Clean line-art drawing of a simple electric circuit: a battery, a switch and a bulb connected by wires', ['circuit', 'electricity', 'battery', 'bulb']),
  sci('States of matter particles', 'Educational line-art diagram of three boxes showing particle arrangement in a solid, a liquid and a gas', ['matter', 'solid liquid gas', 'particles']),
  sci('Food chain example', 'Educational line-art food chain with arrows: grass, then a grasshopper, then a frog, then a snake, then an eagle', ['food chain', 'ecosystem', 'living things']),
  sci('Mosquito life cycle', 'Educational line-art circular life cycle of a mosquito: eggs on water, larva, pupa, adult, with arrows between stages', ['mosquito', 'life cycle', 'malaria', 'insects']),
  sci('Teeth types, labelled', 'Educational line-art diagram of a human jaw showing incisors, canines, premolars and molars with label lines', ['teeth', 'tooth', 'digestion', 'dental']),

  // ── Mathematics ────────────────────────────────────────────────────────
  math('Venn diagram, two sets', 'Clean line-art Venn diagram of two overlapping circles inside a rectangle, unlabelled and empty, ready for set questions', ['venn', 'sets', 'intersection', 'union']),
  math('Labelled rectangle', 'Clean line-art rectangle with small tick marks and clear side labels positions for length and width measurements', ['rectangle', 'perimeter', 'area', 'shapes']),
  math('Common 2D shapes', 'Clean line-art sheet of basic 2D shapes: circle, triangle, square, rectangle, pentagon and hexagon, evenly spaced', ['shapes', '2d shapes', 'geometry']),
  math('Common 3D solids', 'Clean line-art sheet of basic 3D solids: cube, cuboid, cylinder, cone, sphere and pyramid, evenly spaced', ['3d shapes', 'solids', 'geometry']),
  math('Clock face', 'Clean line-art analogue clock face with all twelve numbers and hour and minute hands', ['clock', 'time', 'telling time']),
  math('Fraction circles', 'Clean line-art set of four circles divided into halves, thirds, quarters and fifths, with one part shaded in each', ['fractions', 'halves', 'quarters', 'shaded']),
  math('Bar graph template', 'Clean line-art empty bar graph with a labelled-axis layout, gridlines and five blank bars of different heights', ['bar graph', 'data', 'statistics', 'chart']),
  math('Number line 0 to 20', 'Clean line-art horizontal number line from 0 to 20 with evenly spaced tick marks and numbers', ['number line', 'counting', 'numbers']),
  math('Types of angles', 'Clean line-art diagram showing an acute angle, a right angle with the square corner mark, an obtuse angle and a straight angle', ['angles', 'acute', 'obtuse', 'right angle']),
  math('Types of triangles', 'Clean line-art diagram of an equilateral, an isosceles, a scalene and a right-angled triangle with tick marks on equal sides', ['triangles', 'equilateral', 'isosceles', 'geometry']),

  // ── Social Studies ─────────────────────────────────────────────────────
  ss('Map of Zambia with provinces', 'Clean line-art outline map of Zambia showing the boundaries of all ten provinces, unlabelled', ['zambia', 'map', 'provinces']),
  ss('Map of Africa, Zambia highlighted', 'Clean line-art outline map of the African continent with Zambia shaded', ['africa', 'map', 'zambia location']),
  ss('Compass rose', 'Clean line-art compass rose showing the four cardinal directions North, South, East and West and the four intermediate points', ['compass', 'directions', 'north', 'map skills']),
  ss('Nuclear family', 'Friendly line-art drawing of a Zambian nuclear family: father, mother and two children standing together', ['family', 'nuclear family', 'members']),
  ss('Extended family', 'Friendly line-art drawing of a Zambian extended family group: grandparents, parents, children and an aunt and uncle together', ['family', 'extended family', 'relatives']),
  ss('Traffic lights and zebra crossing', 'Clean line-art street scene of a zebra crossing with a traffic light, for road-safety lessons', ['road safety', 'traffic', 'crossing']),
  ss('Weather symbols', 'Clean line-art sheet of weather symbols: sun, cloud, rain cloud, lightning, rainbow and wind lines', ['weather', 'symbols', 'rain', 'sun']),

  // ── English / generic ──────────────────────────────────────────────────
  { name: 'Market day scene', prompt: 'Friendly full-colour illustration of a busy Zambian open-air market with stalls of vegetables and fruit, traders and shoppers', keywords: ['market', 'trading', 'community', 'composition'], subject: 'english', provider: 'kie' },
  { name: 'Classroom scene', prompt: 'Friendly full-colour illustration of a Zambian primary school classroom with pupils at desks and a teacher at the chalkboard', keywords: ['classroom', 'school', 'pupils', 'composition'], subject: 'english', provider: 'kie' },
  { name: 'Village homestead scene', prompt: 'Friendly full-colour illustration of a Zambian village homestead with a round thatched house, a maize field and a family doing chores', keywords: ['village', 'home', 'rural', 'composition'], subject: 'english', provider: 'kie' },
  { name: 'Domestic animals', prompt: 'Clean line-art sheet of common domestic animals: cow, goat, chicken, dog, cat and pig, evenly spaced', keywords: ['domestic animals', 'farm animals', 'cow', 'goat'], subject: '_generic', provider: 'recraft' },
  { name: 'Wild animals of Zambia', prompt: 'Clean line-art sheet of Zambian wild animals: elephant, lion, zebra, hippo, giraffe and impala, evenly spaced', keywords: ['wild animals', 'wildlife', 'elephant', 'lion'], subject: '_generic', provider: 'recraft' },
  { name: 'Fruits and vegetables', prompt: 'Clean line-art sheet of common fruits and vegetables: mango, banana, orange, tomato, cabbage and maize cob, evenly spaced', keywords: ['fruits', 'vegetables', 'food', 'healthy eating'], subject: '_generic', provider: 'recraft' },

  // ── Home Economics / Technology Studies ────────────────────────────────
  { name: 'Balanced meal plate', prompt: 'Educational line-art plate divided into food groups: energy foods, body-building foods and protective foods, with simple food drawings in each part', keywords: ['food groups', 'balanced diet', 'nutrition'], subject: 'home_economics', provider: 'recraft' },
  { name: 'Hand-washing steps', prompt: 'Educational line-art sequence of four panels showing hand-washing steps: wetting, soaping, scrubbing, rinsing', keywords: ['hygiene', 'hand washing', 'health'], subject: 'home_economics', provider: 'recraft' },
  { name: 'Common hand tools', prompt: 'Clean line-art sheet of common hand tools: hammer, saw, screwdriver, pliers, spanner and tape measure, evenly spaced', keywords: ['tools', 'hand tools', 'workshop'], subject: 'technology_studies', provider: 'recraft' },
]
