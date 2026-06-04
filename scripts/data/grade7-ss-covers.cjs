/**
 * grade7-ss-covers — the cover-illustration spec for the Grade 7 Social
 * Studies lessons in src/features/notes/seed/grade7Seed.json.
 *
 * This file holds ONLY data + the prompt template — no network, no keys —
 * so it can be imported by the batch runner (scripts/generate-grade7-ss-
 * covers.mjs) and unit-tested cheaply.
 *
 * Each entry maps a seed note (by seedKey) to:
 *   - subtopic: the lesson title, dropped into the {SUBTOPIC} slot
 *   - scene:    one concrete Zambian-context scene (2–3 elements max),
 *               dropped into the {scene} slot
 *   - file:     the output filename under public/notes/covers/
 *
 * buildCoverPrompt() fills COVER_TEMPLATE with a subtopic + scene. The
 * template is copied verbatim from the brief so the whole set keeps one
 * cohesive flat-vector textbook look.
 */

// The shared cover-illustration prompt. {SUBTOPIC} and {scene} are filled
// per lesson; everything else is fixed so the 25 covers look like a set.
const COVER_TEMPLATE = [
  'Educational illustration for a Grade 7 Social Studies lesson cover about "{SUBTOPIC}".',
  'Scene: {scene}.',
  'Flat vector illustration, soft smooth shading with gentle volume, bold clean dark',
  'outlines, warm saturated palette, rounded friendly shapes, bright clean light background.',
  'Single cohesive centered scene, cheerful textbook mood.',
  'No text, no words, no letters, no numbers, no UI.',
].join('\n')

// Fill the template for one lesson.
function buildCoverPrompt(subtopic, scene) {
  return COVER_TEMPLATE.replace('{SUBTOPIC}', subtopic).replace('{scene}', scene)
}

// One entry per Social Studies note in grade7Seed.json. seedKey + title are
// kept in lockstep with the seed (see scripts/test-grade7-ss-covers.mjs,
// which fails if they drift). Scenes lean on Zambian context where the topic
// is local, and stay true to place where the topic is a world region.
const COVERS = [
  {
    seedKey: 'g7sci_ss_1_1',
    subtopic: '1.1 What is Democracy?',
    scene: 'a line of Zambian voters dropping ballot papers into a ballot box, a smiling polling officer beside it',
    file: 'g7-ss-1-1-cover.png',
  },
  {
    seedKey: 'g7sci_ss_1_2',
    subtopic: '1.2 How Government Works',
    scene: 'the Zambian National Assembly chamber with seated members of parliament facing a raised speaker’s chair',
    file: 'g7-ss-1-2-cover.png',
  },
  {
    seedKey: 'g7sci_ss_1_3',
    subtopic: '1.3 What Government Does',
    scene: 'a Zambian community with a small health clinic, a school, and a freshly tarred road',
    file: 'g7-ss-1-3-cover.png',
  },
  {
    seedKey: 'g7sci_ss_1_4',
    subtopic: '1.4 Government Ministries',
    scene: 'three government office buildings flying the Zambian flag, with simple symbols for health, education and farming',
    file: 'g7-ss-1-4-cover.png',
  },
  {
    seedKey: 'g7sci_ss_1_5',
    subtopic: '1.5 The Constitution',
    scene: 'an open law book on a wooden stand beside a set of balance scales and the Zambian flag',
    file: 'g7-ss-1-5-cover.png',
  },
  {
    seedKey: 'g7sci_ss_2_1',
    subtopic: '2.1 The Continents',
    scene: 'a large globe on a stand showing the seven continents, with a Zambian child pointing to Africa',
    file: 'g7-ss-2-1-cover.png',
  },
  {
    seedKey: 'g7sci_ss_2_2',
    subtopic: '2.2 Physical Features of the World',
    scene: 'a landscape with a tall mountain, a winding river and a deep valley',
    file: 'g7-ss-2-2-cover.png',
  },
  {
    seedKey: 'g7sci_ss_3_1',
    subtopic: '3.1 Population Growth',
    scene: 'a busy Zambian town square crowded with families of different ages, simple houses behind them',
    file: 'g7-ss-3-1-cover.png',
  },
  {
    seedKey: 'g7sci_ss_3_2',
    subtopic: '3.2 Corruption',
    scene: 'a hand secretly offering an envelope of money under a desk while an honest official pushes it away',
    file: 'g7-ss-3-2-cover.png',
  },
  {
    seedKey: 'g7sci_ss_3_3',
    subtopic: '3.3 Food Shortages',
    scene: 'a Zambian farmer standing in a dry cracked maize field holding an almost-empty grain basket',
    file: 'g7-ss-3-3-cover.png',
  },
  {
    seedKey: 'g7sci_ss_3_4',
    subtopic: '3.4 HIV and AIDS',
    scene: 'a large red awareness ribbon beside a kind Zambian health worker talking with a young person',
    file: 'g7-ss-3-4-cover.png',
  },
  {
    seedKey: 'g7sci_ss_3_5',
    subtopic: '3.5 Pollution',
    scene: 'a river carrying floating litter beside a factory releasing dark smoke into the sky',
    file: 'g7-ss-3-5-cover.png',
  },
  {
    seedKey: 'g7sci_ss_3_6',
    subtopic: '3.6 Other World Challenges',
    scene: 'a globe cradled in two hands surrounded by small symbols of drought, flooding and conflict',
    file: 'g7-ss-3-6-cover.png',
  },
  {
    seedKey: 'g7sci_ss_4_1',
    subtopic: '4.1 Family Ties',
    scene: 'a happy Zambian extended family — grandparents, parents and children — gathered together under a tree',
    file: 'g7-ss-4-1-cover.png',
  },
  {
    seedKey: 'g7sci_ss_4_2',
    subtopic: '4.2 Parents and Children',
    scene: 'Zambian parents helping their children with homework and home chores in a warm living room',
    file: 'g7-ss-4-2-cover.png',
  },
  {
    seedKey: 'g7sci_ss_5_1',
    subtopic: '5.1 The Prairies',
    scene: 'a vast golden wheat prairie with a red tractor and a distant grain silo',
    file: 'g7-ss-5-1-cover.png',
  },
  {
    seedKey: 'g7sci_ss_5_2',
    subtopic: '5.2 The Pampas',
    scene: 'a wide green pampas plain with grazing cattle and a gaucho on horseback',
    file: 'g7-ss-5-2-cover.png',
  },
  {
    seedKey: 'g7sci_ss_5_3',
    subtopic: '5.3 The Downs',
    scene: 'gentle rolling green chalk hills dotted with grazing sheep under a soft sky',
    file: 'g7-ss-5-3-cover.png',
  },
  {
    seedKey: 'g7sci_ss_5_4',
    subtopic: '5.4 The Steppes',
    scene: 'a flat dry steppe grassland with wild horses galloping under a wide open sky',
    file: 'g7-ss-5-4-cover.png',
  },
  {
    seedKey: 'g7sci_ss_5_5',
    subtopic: '5.5 The Veld',
    scene: 'an African veld of tall grass and flat-topped acacia trees with grazing cattle',
    file: 'g7-ss-5-5-cover.png',
  },
  {
    seedKey: 'g7sci_ss_6_1',
    subtopic: '6.1 Building Africa Together',
    scene: 'diverse African people joining hands in a circle around a friendly map of Africa',
    file: 'g7-ss-6-1-cover.png',
  },
  {
    seedKey: 'g7sci_ss_6_2',
    subtopic: '6.2 Transport Systems',
    scene: 'a Zambian scene with a passenger bus, a cargo train and a small boat on a river',
    file: 'g7-ss-6-2-cover.png',
  },
  {
    seedKey: 'g7sci_ss_6_3',
    subtopic: '6.3 Communication Systems',
    scene: 'a mobile phone tower with a person making a call and a radio set broadcasting nearby',
    file: 'g7-ss-6-3-cover.png',
  },
  {
    seedKey: 'g7sci_ss_6_4',
    subtopic: '6.4 Road Safety (the Bicycle)',
    scene: 'a Zambian child wearing a helmet riding a bicycle across a zebra crossing beside a traffic light',
    file: 'g7-ss-6-4-cover.png',
  },
  {
    seedKey: 'g7sci_ss_6_5',
    subtopic: '6.5 Safe Cycling',
    scene: 'a young cyclist in a helmet signalling a turn with an outstretched arm on a tarred road',
    file: 'g7-ss-6-5-cover.png',
  },
]

module.exports = {COVER_TEMPLATE, buildCoverPrompt, COVERS}
