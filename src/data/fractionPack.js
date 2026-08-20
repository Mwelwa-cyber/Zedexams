/**
 * The Fraction Ladder's content — nine levels, thirty-one stages, as DATA.
 *
 * It sits in `src/data/` beside `gamesSeed.js`, which imports it, for two
 * reasons. The seed file is the pack catalogue and was already long enough
 * that a sixty-question ladder inside it would bury the other forty-six games.
 * And `src/data/` may not import `src/features/` (`test:import-boundaries`),
 * so content that lives here cannot accidentally acquire a dependency on the
 * engine that plays it — which is what keeps "add a level" a content change.
 *
 * ── The shape of a question ────────────────────────────────────────
 *
 *   id            stable; the review queue and the resume snapshot key on it
 *   level         one of the nine ladder ids (fractionLadderCore.FRACTION_LEVELS)
 *   stage         the short session inside that level, 1-based
 *   skill         what it TEACHES — mastery and review are per skill, so two
 *                 questions on the same skill are two chances at one thing
 *   type          choice | shade | select | write | compare | order
 *   prompt        the question, in Grade 4 English
 *   caption       what the picture is, when there is one
 *   visual        { shape, object, parts, numerator, shaded, shares, expectEqual }
 *                 — checked by `validateVisual`: the region count IS the bottom
 *                 number and the shaded count IS the top one
 *   options       for choice/order — each { id, label?, fraction?, visual? }
 *   answer        the option id, the symbol, or the ordered list
 *   want          for shade/select — how many regions
 *   value         for write — the fraction it is marked against
 *   form          'lowest' | 'mixed' | 'improper' | 'decimal', where the FORM
 *                 is the question. Absent means every equivalent form is right.
 *   explanation   what a correct answer is told — the teaching, not "well done"
 *   misconceptions[] { answer, code, explanation, step } — the named mistake
 *                 behind a specific wrong answer
 *   workingSteps[] { title, math } — revealed one at a time, then taken away
 *
 * ── Rules the content itself has to keep ───────────────────────────
 *
 *   PICTURES BEFORE THE SYMBOL. Level 1 stage 1 has no written fraction in any
 *   prompt, caption or option — the symbol appears in the feedback after a
 *   correct answer and nowhere else. `validateQuestion` fails the build on a
 *   leak, because a rule nobody measures drifts inside a week.
 *
 *   NO "NUMERATOR" OR "DENOMINATOR" ANYWHERE IN LEVEL 1. "The top" and "the
 *   bottom" until the idea is solid; the formal words are level 2's first
 *   stage, taught rather than assumed.
 *
 *   EVERY WRONG ANSWER WORTH PREDICTING IS PREDICTED. A misconception entry is
 *   a mistake a Zambian teacher sees, keyed to exactly what the learner would
 *   have written. An unpredicted answer still gets a human sentence — never
 *   "Incorrect" — but the predicted ones get the name of the mistake.
 *
 *   THE SAME FRACTION ON DIFFERENT THINGS. One half turns up on a round
 *   orange, a bun cut as a bar, a chitenge strip and a basket of six, inside
 *   level 1. A child who only ever sees circles binds the idea to circles and
 *   stalls the moment the shape changes.
 *
 *   ZAMBIAN OBJECTS AND ZAMBIAN MONEY. Oranges, buns, chitenge, mealie meal,
 *   kwacha. It costs nothing and it is what ECZ papers do.
 */

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 1 — WHAT A FRACTION IS
 *  Five stages: see it and name it · equal parts · the top and the
 *  bottom · the same fraction on different things · a fraction of a
 *  group. Ported from docs/learner/zedexams-fractions-level1.html.
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_1 = [
  /* ── stage 1 — see it, say it, then write it ───────────────────── */
  {
    id: 'fr-b1-1', level: 'basics', stage: 1, skill: 'name-unit-fraction',
    stageTitle: 'Cutting things up',
    stageBlurb: 'A picture first, then the name, then how it is written.',
    type: 'choice',
    kicker: 'An orange, cut up',
    prompt: 'What do we call the piece that was taken?',
    caption: 'The orange is cut into 4 equal pieces. One piece is taken.',
    visual: { shape: 'circle', object: 'orange', parts: 4, numerator: 1, shaded: 1 },
    options: [{ id: 'half', label: 'One half' }, { id: 'third', label: 'One third' }, { id: 'quarter', label: 'One quarter' }],
    answer: 'quarter',
    rightHeadline: 'Yes — one quarter',
    explanation: '4 equal pieces, and you take 1. We say one quarter. The bottom is how many pieces it was cut into; the top is how many were taken.',
    reveal: { n: 1, d: 4 },
    misconceptions: [
      { answer: 'half', code: 'wrong_piece_count', explanation: 'A half is when there are only 2 pieces. Count again — this orange was cut into 4.' },
      { answer: 'third', code: 'wrong_piece_count', explanation: 'A third is when there are 3 pieces. Count again — this one has 4.' },
    ],
  },
  {
    id: 'fr-b1-2', level: 'basics', stage: 1, skill: 'name-unit-fraction',
    type: 'choice',
    kicker: 'A different thing, the same idea',
    prompt: 'What do we call the strip that was cut off?',
    caption: 'The chitenge is cut into 3 equal strips. One strip is cut off.',
    visual: { shape: 'strip', object: 'chitenge', parts: 3, numerator: 1, shaded: 1 },
    options: [{ id: 'half', label: 'One half' }, { id: 'third', label: 'One third' }, { id: 'quarter', label: 'One quarter' }],
    answer: 'third',
    rightHeadline: 'Yes — one third',
    explanation: '3 equal strips, and you take 1. We say one third. A fraction works on a long strip the same way it works on a round orange.',
    reveal: { n: 1, d: 3 },
    misconceptions: [
      { answer: 'half', code: 'wrong_piece_count', explanation: 'A half is when there are only 2 pieces. This chitenge is cut into 3.' },
      { answer: 'quarter', code: 'wrong_piece_count', explanation: 'A quarter is when there are 4 pieces. Count them — this one has 3.' },
    ],
  },
  {
    id: 'fr-b1-3', level: 'basics', stage: 1, skill: 'shade-a-fraction',
    type: 'shade',
    kicker: 'Now you do one',
    prompt: 'Shade one half of this bun.',
    caption: 'Tap the pieces to shade them.',
    visual: { shape: 'bar', object: 'bun', parts: 4 },
    want: 2,
    rightHeadline: "That's one half",
    explanation: 'The bun has 4 pieces. Half means the same amount on each side, so 2 pieces. Two of the four pieces and one half are the same amount, with two names.',
    reveal: { n: 2, d: 4, also: { n: 1, d: 2 } },
    misconceptions: [
      { answer: '1', code: 'wrong_piece_count', explanation: 'One piece out of 4 is a quarter, not a half. Half needs the same amount on each side.' },
      { answer: '3', code: 'wrong_piece_count', explanation: 'Three pieces out of 4 is more than half. The other side would only have 1 piece left.' },
      { answer: '4', code: 'wrong_piece_count', explanation: 'That is the whole bun. Half means the shaded part and the rest are the same size.' },
    ],
  },

  /* ── stage 2 — equal parts, taught on purpose ──────────────────── */
  {
    id: 'fr-b2-1', level: 'basics', stage: 2, skill: 'equal-parts',
    stageTitle: 'Are they really halves?',
    stageBlurb: 'Two pieces are not halves unless they are the same size.',
    type: 'choice',
    kicker: 'Careful with this one',
    prompt: 'Which one has been cut into halves?',
    caption: 'All three are cut into 2 pieces.',
    options: [
      { id: 'a', label: 'A', visual: { shape: 'circle', object: 'orange', parts: 2, numerator: 1, shaded: 1, shares: [0.33, 0.67], expectEqual: false } },
      { id: 'b', label: 'B', visual: { shape: 'circle', object: 'orange', parts: 2, numerator: 1, shaded: 1 } },
      { id: 'c', label: 'C', visual: { shape: 'circle', object: 'orange', parts: 2, numerator: 1, shaded: 1, shares: [0.2, 0.8], expectEqual: false } },
    ],
    answer: 'b',
    rightHeadline: 'Only B',
    explanation: 'A and C are cut into 2 pieces too, but the pieces are not the same size. For halves, thirds and quarters the pieces must always be equal.',
    reveal: { n: 1, d: 2 },
    misconceptions: [
      { answer: 'a', code: 'ignored_equal_parts', explanation: 'A is in 2 pieces, but one is a bit bigger than the other. Halves must be the same size.' },
      { answer: 'c', code: 'ignored_equal_parts', explanation: 'C is in 2 pieces, but one is much bigger than the other. Halves must be the same size.' },
    ],
  },
  {
    id: 'fr-b2-2', level: 'basics', stage: 2, skill: 'equal-parts',
    type: 'choice',
    kicker: 'Same test, three pieces',
    prompt: 'Which bun has been cut into thirds?',
    caption: 'All three are cut into 3 pieces.',
    options: [
      { id: 'a', label: 'A', visual: { shape: 'bar', object: 'bun', parts: 3, numerator: 1, shaded: 1, shares: [0.2, 0.5, 0.3], expectEqual: false } },
      { id: 'b', label: 'B', visual: { shape: 'bar', object: 'bun', parts: 3, numerator: 1, shaded: 1 } },
      { id: 'c', label: 'C', visual: { shape: 'bar', object: 'bun', parts: 3, numerator: 1, shaded: 1, shares: [0.5, 0.25, 0.25], expectEqual: false } },
    ],
    answer: 'b',
    rightHeadline: 'B is the one',
    explanation: 'Thirds are three pieces of the same size. A and C are in three pieces, but you would rather have one of them than the others — so they are not thirds.',
    reveal: { n: 1, d: 3 },
    misconceptions: [
      { answer: 'a', code: 'ignored_equal_parts', explanation: 'A has three pieces, but the middle one is much bigger. Thirds are all the same size.' },
      { answer: 'c', code: 'ignored_equal_parts', explanation: 'C has three pieces, but the first is twice the size of the others. Thirds are all the same size.' },
    ],
  },
  {
    id: 'fr-b2-3', level: 'basics', stage: 2, skill: 'equal-parts',
    type: 'choice',
    kicker: 'Yes or no',
    prompt: 'Has this cake been cut into quarters?',
    caption: 'The cake is in 4 pieces.',
    visual: { shape: 'circle', object: 'cake', parts: 4, numerator: 1, shaded: 1, shares: [0.15, 0.35, 0.15, 0.35], expectEqual: false },
    options: [{ id: 'yes', label: 'Yes — there are 4 pieces' }, { id: 'no', label: 'No — the pieces are not the same size' }],
    answer: 'no',
    rightHeadline: 'No, and you spotted why',
    explanation: 'Four pieces is not enough. Quarters are four pieces of the same size, so everyone gets the same amount of cake.',
    reveal: { n: 1, d: 4 },
    misconceptions: [
      { answer: 'yes', code: 'ignored_equal_parts', explanation: 'Counting to 4 is not enough. Look at the sizes — two pieces are much bigger than the other two, so nobody would call these quarters.' },
    ],
  },

  /* ── stage 3 — what the two numbers mean ───────────────────────── */
  {
    id: 'fr-b3-1', level: 'basics', stage: 3, skill: 'meaning-of-bottom',
    stageTitle: 'The top and the bottom',
    stageBlurb: 'Two numbers, and each one has a job.',
    type: 'choice',
    kicker: 'Look at the bottom number',
    prompt: 'The bottom number is 4. What does it tell us?',
    caption: 'Three of the pieces of this bun are covered in jam.',
    fraction: { n: 3, d: 4 },
    visual: { shape: 'bar', object: 'bun', parts: 4, numerator: 3, shaded: 3 },
    options: [
      { id: 'cut', label: 'The bun was cut into 4 equal pieces' },
      { id: 'jam', label: '4 pieces have jam on them' },
      { id: 'buns', label: 'There are 4 buns' },
    ],
    answer: 'cut',
    rightHeadline: 'Yes — the bottom counts the pieces',
    explanation: 'The bottom number tells you how many equal pieces the whole was cut into. Here that is 4, so each piece is a quarter of the bun.',
    misconceptions: [
      { answer: 'jam', code: 'inverted', explanation: 'That is what the TOP number says — 3 pieces have jam. The bottom counts every piece, jam or no jam.' },
      { answer: 'buns', code: 'inverted', explanation: 'There is one bun. The 4 counts the pieces it was cut into, not how many buns there are.' },
    ],
  },
  {
    id: 'fr-b3-2', level: 'basics', stage: 3, skill: 'meaning-of-top',
    type: 'choice',
    kicker: 'Now the top number',
    prompt: 'The top number is 3. What does it tell us?',
    caption: 'Three of the pieces of this bun are covered in jam.',
    fraction: { n: 3, d: 4 },
    visual: { shape: 'bar', object: 'bun', parts: 4, numerator: 3, shaded: 3 },
    options: [
      { id: 'have', label: '3 of those pieces are the ones we mean' },
      { id: 'cut', label: 'The bun was cut into 3 pieces' },
      { id: 'left', label: '3 pieces are left over' },
    ],
    answer: 'have',
    rightHeadline: 'Yes — the top counts the ones we mean',
    explanation: 'The top number tells you how many of the pieces we are talking about. Three pieces with jam, out of four pieces altogether.',
    misconceptions: [
      { answer: 'cut', code: 'inverted', explanation: 'That is the BOTTOM number\'s job. The bun was cut into 4; the 3 says how many of them have jam.' },
      { answer: 'left', code: 'counted_remaining', explanation: 'Only 1 piece is left without jam. The 3 counts the pieces we are talking about — the ones with jam.' },
    ],
  },
  {
    id: 'fr-b3-3', level: 'basics', stage: 3, skill: 'read-a-fraction',
    type: 'choice',
    kicker: 'Read the picture',
    prompt: 'What fraction of this chitenge is printed?',
    caption: 'The chitenge is folded into 5 equal parts. 2 of them are printed.',
    visual: { shape: 'strip', object: 'chitenge', parts: 5, numerator: 2, shaded: 2 },
    options: [
      { id: 'a', fraction: { n: 2, d: 5 } },
      { id: 'b', fraction: { n: 5, d: 2 } },
      { id: 'c', fraction: { n: 3, d: 5 } },
    ],
    answer: 'a',
    rightHeadline: 'Two fifths',
    explanation: '5 equal parts altogether, so 5 goes on the bottom. 2 of them are printed, so 2 goes on top.',
    misconceptions: [
      { answer: 'b', code: 'inverted', explanation: 'The two numbers are the wrong way round. The number of pieces the whole was cut into always goes on the bottom.' },
      { answer: 'c', code: 'counted_remaining', explanation: '3 is the part with no print on it. The question asks for the printed part — count the printed pieces.' },
    ],
  },

  /* ── stage 4 — change the object, keep the fraction ────────────── */
  {
    id: 'fr-b4-1', level: 'basics', stage: 4, skill: 'fraction-across-shapes',
    stageTitle: 'The same fraction, different things',
    stageBlurb: 'One half is one half, whatever it is cut from.',
    type: 'shade',
    kicker: 'A long one this time',
    prompt: 'Shade one half of this chitenge.',
    caption: 'It is folded into 6 equal parts. Tap to shade.',
    visual: { shape: 'strip', object: 'chitenge', parts: 6 },
    want: 3,
    rightHeadline: 'Three of the six',
    explanation: 'Half means the same amount on each side. 6 parts split evenly is 3 and 3 — so three sixths is one half, exactly like two quarters was.',
    reveal: { n: 3, d: 6, also: { n: 1, d: 2 } },
    misconceptions: [
      { answer: '2', code: 'wrong_piece_count', explanation: 'Two of the six leaves four on the other side, so the two sides are not the same. Try one more.' },
      { answer: '1', code: 'wrong_piece_count', explanation: 'One part out of 6 is a sixth. Half needs the same amount on each side — count how many that would be.' },
      { answer: '4', code: 'wrong_piece_count', explanation: 'Four of the six leaves only two on the other side. Half means both sides match.' },
    ],
  },
  {
    id: 'fr-b4-2', level: 'basics', stage: 4, skill: 'fraction-across-shapes',
    type: 'choice',
    kicker: 'Which picture?',
    prompt: 'Which picture shows one quarter shaded?',
    caption: 'Look at how many pieces there are, and how many are coloured.',
    options: [
      { id: 'a', label: 'A', visual: { shape: 'circle', object: 'orange', parts: 4, numerator: 1, shaded: 1 } },
      { id: 'b', label: 'B', visual: { shape: 'bar', object: 'bun', parts: 3, numerator: 1, shaded: 1 } },
      { id: 'c', label: 'C', visual: { shape: 'circle', object: 'cake', parts: 4, numerator: 2, shaded: 2 } },
    ],
    answer: 'a',
    rightHeadline: 'A — one of four',
    explanation: 'A quarter is one piece out of four equal pieces. It does not matter whether the thing is round or long.',
    misconceptions: [
      { answer: 'b', code: 'wrong_piece_count', explanation: 'B has one piece shaded out of 3, so that is one third, not one quarter.' },
      { answer: 'c', code: 'wrong_piece_count', explanation: 'C has four pieces, which is right — but TWO of them are shaded, so that is two quarters, which is one half.' },
    ],
  },
  {
    id: 'fr-b4-3', level: 'basics', stage: 4, skill: 'read-a-fraction',
    type: 'choice',
    kicker: 'Round this time',
    prompt: 'What fraction of this cake has been eaten?',
    caption: 'The cake was cut into 8 equal slices. 3 have been eaten.',
    visual: { shape: 'circle', object: 'cake', parts: 8, numerator: 3, shaded: 3 },
    options: [
      { id: 'a', fraction: { n: 3, d: 8 } },
      { id: 'b', fraction: { n: 5, d: 8 } },
      { id: 'c', fraction: { n: 8, d: 3 } },
    ],
    answer: 'a',
    rightHeadline: 'Three eighths',
    explanation: '8 slices altogether goes on the bottom, 3 eaten goes on top. The same rule as the bun and the chitenge.',
    misconceptions: [
      { answer: 'b', code: 'counted_remaining', explanation: '5 slices are still there. The question asks for the part that was eaten.' },
      { answer: 'c', code: 'inverted', explanation: 'The wrong way round. The number of slices the cake was cut into — 8 — always goes on the bottom.' },
    ],
  },

  /* ── stage 5 — a fraction of a group ───────────────────────────── */
  {
    id: 'fr-b5-1', level: 'basics', stage: 5, skill: 'fraction-of-a-group',
    stageTitle: 'A whole basket',
    stageBlurb: 'Nothing is cut up here — the whole is a group of things.',
    type: 'choice',
    kicker: 'Now a whole basket',
    prompt: 'What fraction of the oranges was taken?',
    caption: '6 oranges in the basket. 3 have been taken.',
    visual: { shape: 'group', object: 'orange', parts: 6, numerator: 3, shaded: 3 },
    options: [{ id: 'third', label: 'One third' }, { id: 'half', label: 'One half' }, { id: 'quarter', label: 'One quarter' }],
    answer: 'half',
    rightHeadline: 'One half',
    explanation: '3 taken and 3 left — the same amount on each side. Fractions work on a group of things too, not only on one thing cut up.',
    reveal: { n: 3, d: 6, also: { n: 1, d: 2 } },
    misconceptions: [
      { answer: 'third', code: 'counted_taken_as_bottom', explanation: '3 were taken, but count what is left as well — 3 taken and 3 left is the same on each side, so it is a half.' },
      { answer: 'quarter', code: 'wrong_piece_count', explanation: 'A quarter would be 1 taken out of 4. Here 3 were taken out of 6.' },
    ],
  },
  {
    id: 'fr-b5-2', level: 'basics', stage: 5, skill: 'fraction-of-a-group',
    type: 'select',
    kicker: 'Your turn',
    prompt: 'Tap one quarter of these sweets.',
    caption: '8 sweets. Tap the ones that make up a quarter.',
    visual: { shape: 'group', object: 'sweet', parts: 8 },
    want: 2,
    rightHeadline: 'Two of the eight',
    explanation: 'A quarter means 4 equal shares. 8 sweets in 4 shares is 2 sweets in each share, so a quarter of 8 is 2.',
    reveal: { n: 2, d: 8, also: { n: 1, d: 4 } },
    workingSteps: [
      { title: 'A quarter means four equal shares', math: '8 sweets, shared into 4' },
      { title: 'How many in each share?', math: '8 ÷ 4 = 2' },
    ],
    misconceptions: [
      { answer: '4', code: 'wrong_piece_count', explanation: '4 out of 8 is a half, not a quarter. A quarter is one of FOUR equal shares.' },
      { answer: '1', code: 'wrong_piece_count', explanation: 'One sweet is an eighth of 8. Share the 8 sweets into 4 equal piles and count one pile.' },
      { answer: '3', code: 'wrong_piece_count', explanation: '8 does not share into 4 piles of 3. Try sharing them out one at a time into 4 piles and see how many land in each.' },
    ],
  },
  {
    id: 'fr-b5-3', level: 'basics', stage: 5, skill: 'fraction-of-a-group',
    type: 'select',
    kicker: 'One more',
    prompt: 'Tap two thirds of these oranges.',
    caption: '9 oranges. Tap the ones that make up two thirds.',
    visual: { shape: 'group', object: 'orange', parts: 9 },
    want: 6,
    rightHeadline: 'Six of the nine',
    explanation: 'Thirds means 3 equal shares. 9 oranges in 3 shares is 3 each, and two of those shares is 6.',
    workingSteps: [
      { title: 'Share them into three equal piles', math: '9 ÷ 3 = 3 in each pile' },
      { title: 'Two thirds is two of those piles', math: '3 × 2 = 6' },
    ],
    misconceptions: [
      { answer: '3', code: 'found_unit_fraction_only', explanation: 'That is ONE third — one pile of three. The question asks for two of those piles.' },
      { answer: '2', code: 'counted_taken_as_bottom', explanation: 'The 2 in "two thirds" is not two oranges. Share the 9 into 3 piles first, then take two piles.' },
      { answer: '4', code: 'wrong_piece_count', explanation: '9 shared into 3 piles gives 3 in each pile, not 2. Count out the piles again.' },
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 2 — EQUAL FRACTIONS AND MAKING THEM SIMPLER
 *  The formal words arrive here, taught rather than assumed.
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_2 = [
  {
    id: 'fr-e1-1', level: 'equal', stage: 1, skill: 'numerator-denominator-words',
    stageTitle: 'The proper names',
    stageBlurb: 'The top and the bottom have real names. Here they are.',
    type: 'choice',
    kicker: 'New words',
    prompt: 'Which number is the denominator?',
    caption: 'The bun is in 4 pieces and 3 have jam.',
    fraction: { n: 3, d: 4 },
    visual: { shape: 'bar', object: 'bun', parts: 4, numerator: 3, shaded: 3 },
    options: [{ id: 'four', label: 'The 4 — the bottom one' }, { id: 'three', label: 'The 3 — the top one' }],
    answer: 'four',
    rightHeadline: 'Yes — the denominator is the bottom',
    explanation: 'Denominator is the proper name for the bottom number: how many equal parts the whole was divided into. Numerator is the top one: how many of those parts we mean.',
    misconceptions: [
      { answer: 'three', code: 'inverted', explanation: 'The 3 on top is the NUMERATOR. Denominator is the one underneath the line — it counts every equal part.' },
    ],
  },
  {
    id: 'fr-e1-2', level: 'equal', stage: 1, skill: 'equivalent-fractions',
    type: 'choice',
    kicker: 'Two ways to say it',
    prompt: 'Both buns are the same size. Is the shaded amount the same?',
    caption: 'The first is cut into 2, the second into 4.',
    options: [
      { id: 'same', label: 'Yes — the same amount, written two ways' },
      { id: 'more', label: 'No — the second one has more' },
      { id: 'less', label: 'No — the second one has less' },
    ],
    compare: [
      { visual: { shape: 'bar', object: 'bun', parts: 2, numerator: 1, shaded: 1 }, fraction: { n: 1, d: 2 } },
      { visual: { shape: 'bar', object: 'bun', parts: 4, numerator: 2, shaded: 2 }, fraction: { n: 2, d: 4 } },
    ],
    answer: 'same',
    rightHeadline: 'The same amount',
    explanation: 'One half and two quarters cover the same amount of bun. Fractions that look different can be worth the same — those are equivalent fractions.',
    misconceptions: [
      { answer: 'more', code: 'compared_by_numerator', explanation: 'The 2 on top is bigger, but the pieces are smaller. Look at how much bun is coloured — it is the same length on both.' },
      { answer: 'less', code: 'compared_by_denominator', explanation: 'A bigger bottom number means smaller pieces, not less shading. Two of those smaller pieces reach exactly as far as one big one.' },
    ],
  },
  {
    id: 'fr-e1-3', level: 'equal', stage: 1, skill: 'equivalent-fractions',
    type: 'write',
    kicker: 'Fill in the missing one',
    prompt: 'One half is the same as how many sixths? Write the whole fraction.',
    caption: 'The bar shows one half and the bar below it is cut into 6.',
    visual: { shape: 'bar', object: 'bar', parts: 6, numerator: 3, shaded: 3 },
    answer: '3/6', value: { n: 3, d: 6 }, form: 'denominator', requireDenominator: 6,
    rightHeadline: 'Three sixths',
    explanation: 'Multiply the top and the bottom by the same number: 1 × 3 over 2 × 3 gives 3 over 6. The amount does not change, only the size of the pieces.',
    workingSteps: [
      { title: 'What turns 2 into 6?', math: '2 × 3 = 6' },
      { title: 'Do the same to the top', math: '1 × 3 = 3' },
    ],
    misconceptions: [
      { answer: '1/6', code: 'partial_simplify', explanation: 'The bottom was multiplied by 3 but the top was left alone. Whatever you do to the bottom you must do to the top.' },
      { answer: '2/6', code: 'partial_simplify', explanation: 'Close. 2 became 6 by multiplying by 3, so the 1 on top has to be multiplied by 3 as well.' },
    ],
  },
  {
    id: 'fr-e2-1', level: 'equal', stage: 2, skill: 'simplify',
    stageTitle: 'Making them simpler',
    stageBlurb: 'The same amount, written with the smallest numbers that will do it.',
    type: 'write',
    prompt: 'Write 6/8 in its lowest terms.',
    answer: '3/4', value: { n: 3, d: 4 }, form: 'lowest',
    explanation: '6 and 8 both divide by 2, giving 3 over 4. Nothing divides into 3 and 4 except 1, so that is as simple as it goes.',
    workingSteps: [
      { title: 'Find a number that goes into both', math: '6 and 8 both divide by 2' },
      { title: 'Divide the top and the bottom by it', math: '6 ÷ 2 = 3,  and  8 ÷ 2 = 4' },
    ],
    misconceptions: [
      { answer: '3/8', code: 'partial_simplify', explanation: 'Only the top was divided. Both numbers have to be divided by the same thing, or the amount changes.' },
      { answer: '1/2', code: 'not_simplified', explanation: 'Half of 6 is 3 and half of 8 is 4, so it is three quarters. Three quarters is more than a half — check on a bar.' },
    ],
  },
  {
    id: 'fr-e2-2', level: 'equal', stage: 2, skill: 'simplify',
    type: 'write',
    prompt: 'Write 10/25 in its lowest terms.',
    answer: '2/5', value: { n: 2, d: 5 }, form: 'lowest',
    explanation: '10 and 25 both divide by 5, giving 2 over 5.',
    workingSteps: [
      { title: 'What goes into both 10 and 25?', math: '5' },
      { title: 'Divide them both by it', math: '10 ÷ 5 = 2,  and  25 ÷ 5 = 5' },
    ],
    misconceptions: [
      { answer: '5/12', code: 'partial_simplify', explanation: 'Both numbers are divided by the SAME number. 10 and 25 both divide by 5 — halving one and not the other changes the amount.' },
      { answer: '2/25', code: 'partial_simplify', explanation: 'The top was divided by 5 but the bottom was left. Do the same thing to both.' },
    ],
    traps: { '5/12': 'Both numbers are divided by the SAME number. 10 and 25 both divide by 5.' },
  },
  {
    id: 'fr-e2-3', level: 'equal', stage: 2, skill: 'simplify',
    type: 'write',
    prompt: 'Write 12/18 in its lowest terms.',
    answer: '2/3', value: { n: 2, d: 3 }, form: 'lowest',
    explanation: '12 and 18 both divide by 6, giving 2 over 3. If you divided by 2 or 3 first you get there in two steps instead of one — the answer is the same.',
    workingSteps: [
      { title: 'Both divide by 6', math: '12 ÷ 6 = 2,  and  18 ÷ 6 = 3' },
      { title: 'Can it go further?', math: 'Only 1 goes into both 2 and 3 — so no' },
    ],
    misconceptions: [
      { answer: '6/9', code: 'partial_simplify', explanation: 'Closer — but 6 and 9 both still divide by 3, so it can go one step further.' },
      { answer: '4/6', code: 'partial_simplify', explanation: 'You divided by 3. That is right as far as it goes, but 4 and 6 both still divide by 2.' },
    ],
    traps: { '6/9': 'Closer — but 6 and 9 both still divide by 3, so it can go one step further.' },
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 3 — WHICH ONE IS BIGGER
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_3 = [
  {
    id: 'fr-c1-1', level: 'compare', stage: 1, skill: 'compare-same-denominator',
    stageTitle: 'Same bottom, easy',
    stageBlurb: 'When the pieces are the same size, just count them.',
    type: 'compare',
    prompt: 'Put the right sign between them.',
    pair: [{ n: 3, d: 5 }, { n: 2, d: 5 }],
    answer: '>',
    explanation: 'The pieces are the same size — fifths — so three of them is more than two of them.',
    misconceptions: [
      { answer: '<', code: 'compared_by_numerator', explanation: 'Both are fifths, so the pieces are the same size. 3 pieces is more than 2 pieces.' },
      { answer: '=', code: 'compared_by_denominator', explanation: 'The bottoms match, but the tops do not — 3 fifths and 2 fifths are different amounts.' },
    ],
  },
  {
    id: 'fr-c1-2', level: 'compare', stage: 1, skill: 'compare-same-numerator',
    type: 'compare',
    prompt: 'Put the right sign between them.',
    pair: [{ n: 1, d: 3 }, { n: 1, d: 5 }],
    answer: '>',
    explanation: 'Cut a bun into 3 and you get big pieces; cut it into 5 and you get small ones. One big piece beats one small piece — a bigger bottom number means SMALLER pieces.',
    workingSteps: [
      { title: 'Same top, so compare the piece size', math: 'a third of a bun, next to a fifth of a bun' },
      { title: 'More pieces means smaller pieces', math: '5 pieces are smaller than 3 pieces' },
    ],
    misconceptions: [
      { answer: '<', code: 'compared_by_denominator', explanation: '5 is a bigger number than 3, but it means the bun was cut into MORE pieces, so each one is smaller. A fifth is less than a third.' },
      { answer: '=', code: 'compared_by_numerator', explanation: 'Both have a 1 on top, but the pieces are not the same size. A third is bigger than a fifth.' },
    ],
  },
  {
    id: 'fr-c1-3', level: 'compare', stage: 1, skill: 'compare-unlike',
    type: 'write',
    prompt: 'Which is bigger — 2/3 or 3/5? Write the bigger one.',
    answer: '2/3', value: { n: 2, d: 3 },
    explanation: 'Give them the same bottom: 2/3 is 10/15 and 3/5 is 9/15. Ten fifteenths beats nine.',
    workingSteps: [
      { title: 'Find a bottom they both go into', math: '3 and 5 both go into 15' },
      { title: 'Change them both', math: '2/3 = 10/15,  and  3/5 = 9/15' },
      { title: 'Now just compare the tops', math: '10 > 9' },
    ],
    misconceptions: [
      { answer: '3/5', code: 'compared_by_numerator', explanation: '3 is bigger than 2, but fifths are smaller than thirds. Give them the same bottom — 15 — and compare there.' },
    ],
    traps: { '3/5': 'Give them the same bottom to compare: 2/3 is 10/15 and 3/5 is 9/15.' },
  },
  {
    id: 'fr-c2-1', level: 'compare', stage: 2, skill: 'order-fractions',
    stageTitle: 'Putting them in order',
    stageBlurb: 'Smallest first.',
    type: 'order',
    prompt: 'Tap them in order, smallest first.',
    options: [
      { id: 'a', fraction: { n: 1, d: 2 } },
      { id: 'b', fraction: { n: 1, d: 4 } },
      { id: 'c', fraction: { n: 3, d: 4 } },
    ],
    answer: ['b', 'a', 'c'],
    explanation: 'All of them can be written in quarters: one quarter, two quarters, three quarters. Then the order is just 1, 2, 3.',
    workingSteps: [
      { title: 'Give them all the same bottom', math: '1/2 = 2/4' },
      { title: 'Now read the tops', math: '1/4, then 2/4, then 3/4' },
    ],
    misconceptions: [
      { answer: 'a>b>c', code: 'compared_by_denominator', explanation: 'A half is not the smallest. Change it into quarters — one half is two quarters, which is more than one quarter.' },
      { answer: 'c>a>b', code: 'compared_by_numerator', explanation: 'That is biggest first. The question asks for smallest first.' },
    ],
  },
  {
    id: 'fr-c2-2', level: 'compare', stage: 2, skill: 'compare-unlike',
    type: 'write',
    prompt: 'Which is smaller — 5/8 or 3/4? Write the smaller one.',
    answer: '5/8', value: { n: 5, d: 8 },
    explanation: '3/4 is 6/8, and 5 eighths is less than 6 eighths.',
    workingSteps: [
      { title: '4 goes into 8, so change only the second one', math: '3/4 = 6/8' },
      { title: 'Compare the tops', math: '5 < 6' },
    ],
    misconceptions: [
      { answer: '3/4', code: 'compared_by_denominator', explanation: 'The 8 on the bottom looks bigger, but it means smaller pieces — and there are 5 of them. Change 3/4 into 6/8 and compare.' },
    ],
    traps: { '3/4': '3/4 is 6/8, and 6 eighths is more than 5 eighths.' },
  },
  {
    id: 'fr-c2-3', level: 'compare', stage: 2, skill: 'compare-unlike',
    type: 'write',
    prompt: 'Which is bigger — 7/10 or 2/3? Write the bigger one.',
    answer: '7/10', value: { n: 7, d: 10 },
    explanation: '10 and 3 both go into 30: 7/10 is 21/30 and 2/3 is 20/30. Just one thirtieth in it.',
    workingSteps: [
      { title: 'A bottom they both go into', math: '10 × 3 = 30' },
      { title: 'Change them both', math: '7/10 = 21/30,  and  2/3 = 20/30' },
    ],
    misconceptions: [
      { answer: '2/3', code: 'compared_by_denominator', explanation: 'A bigger bottom does not mean a bigger fraction. 7/10 is 21/30 and 2/3 is 20/30 — so 7/10 wins, but only just.' },
    ],
    traps: { '2/3': 'A bigger bottom does not mean a bigger fraction. 7/10 is 21/30 and 2/3 is 20/30.' },
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 4 — ADDING. Four sub-skills in order, which is the whole
 *  reason this level has stages: same bottom, one bottom fits the
 *  other, no common bottom, answer bigger than one.
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_4 = [
  {
    id: 'fr-a1-1', level: 'add', stage: 1, skill: 'add-same-denominator',
    stageTitle: 'Same bottom',
    stageBlurb: 'The pieces already match — just count them.',
    type: 'write',
    prompt: '2/5 + 1/5',
    visual: { shape: 'bar', object: 'bar', parts: 5, numerator: 3, shaded: 3 },
    caption: 'Two fifths, and one more fifth.',
    answer: '3/5', value: { n: 3, d: 5 },
    explanation: 'The pieces are the same size, so the bottom stays 5. Two of them plus one more is three.',
    workingSteps: [
      { title: 'The bottoms already match', math: 'both are fifths' },
      { title: 'Add only the tops', math: '2 + 1 = 3, over 5' },
    ],
    misconceptions: [
      { answer: '3/10', code: 'added_denominators', explanation: 'The bottoms were added too. The bottom says how BIG the pieces are — adding two fifths to one fifth does not make the pieces smaller.' },
    ],
    traps: { '3/10': 'The bottoms were already the same size, so they stay 5. Only the tops are added.' },
  },
  {
    id: 'fr-a1-2', level: 'add', stage: 1, skill: 'add-same-denominator',
    type: 'write',
    prompt: '3/8 + 4/8',
    answer: '7/8', value: { n: 7, d: 8 },
    explanation: 'Both are eighths, so the answer is in eighths too: 3 + 4 = 7.',
    misconceptions: [
      { answer: '7/16', code: 'added_denominators', explanation: 'The bottoms were added. They stay as 8 — you are counting eighths, and the size of an eighth does not change.' },
    ],
  },
  {
    id: 'fr-a2-1', level: 'add', stage: 2, skill: 'add-one-fits',
    stageTitle: 'One bottom fits the other',
    stageBlurb: 'Change just one of them, then add.',
    type: 'write',
    prompt: '1/2 + 1/4',
    answer: '3/4', value: { n: 3, d: 4 },
    explanation: 'Halves and quarters are different sizes, so make them match first: one half is two quarters. Then two quarters plus one quarter is three quarters.',
    workingSteps: [
      { title: 'The bottoms are different — make them match', math: '1/2 = 2/4' },
      { title: 'Now add the tops only', math: '2/4 + 1/4 = 3/4' },
    ],
    misconceptions: [
      { answer: '2/6', code: 'added_denominators', explanation: 'The tops AND the bottoms were added. The bottom tells you the size of the piece — make the pieces the same size first (one half is two quarters), then add only the tops.' },
      { answer: '2/4', code: 'kept_unlike_denominators', explanation: 'The 1/2 was changed to 2/4 correctly, but then the other quarter was left out. Add both: 2/4 + 1/4.' },
    ],
    traps: { '2/6': 'The bottoms were added too. The bottom says how BIG the pieces are — make them the same size first (1/2 is 2/4), then add only the tops.' },
  },
  {
    id: 'fr-a2-2', level: 'add', stage: 2, skill: 'add-one-fits',
    type: 'write',
    prompt: '1/3 + 1/6 — give your answer in its lowest terms.',
    answer: '1/2', value: { n: 1, d: 2 }, form: 'lowest',
    explanation: '3 goes into 6, so change one third into two sixths. Two sixths plus one sixth is three sixths, which simplifies to one half.',
    workingSteps: [
      { title: '3 goes into 6, so change the first one', math: '1/3 = 2/6' },
      { title: 'Add the tops', math: '2/6 + 1/6 = 3/6' },
      { title: 'Lowest terms — both divide by 3', math: '3/6 = 1/2' },
    ],
    misconceptions: [
      { answer: '2/9', code: 'added_denominators', explanation: 'Tops and bottoms were both added. Change 1/3 into 2/6 first, then add only the tops.' },
      { answer: '3/6', code: 'not_simplified', explanation: 'Right amount — and this question asks for lowest terms. 3 and 6 both divide by 3.' },
    ],
    traps: { '2/9': 'Tops and bottoms were both added. Change 1/3 into 2/6 first, then add the tops.' },
  },
  {
    id: 'fr-a3-1', level: 'add', stage: 3, skill: 'add-common-denominator',
    stageTitle: 'Bottoms that do not match at all',
    stageBlurb: 'Find a bottom they both go into.',
    type: 'write',
    prompt: '1/3 + 1/4',
    answer: '7/12', value: { n: 7, d: 12 },
    explanation: '3 and 4 both go into 12. One third is four twelfths and one quarter is three twelfths, so together that is seven twelfths.',
    workingSteps: [
      { title: 'Find a bottom they both go into', math: '3 × 4 = 12' },
      { title: 'Change them both', math: '1/3 = 4/12,  and  1/4 = 3/12' },
      { title: 'Add the tops', math: '4 + 3 = 7, over 12' },
    ],
    misconceptions: [
      { answer: '2/7', code: 'added_denominators', explanation: 'Tops and bottoms were both added. Find a bottom they both go into — 12 — and change them both before adding.' },
      { answer: '2/12', code: 'kept_unlike_denominators', explanation: 'The bottom is right, but the tops were not changed with it. One third is FOUR twelfths, not one.' },
    ],
  },
  {
    id: 'fr-a3-2', level: 'add', stage: 3, skill: 'add-common-denominator',
    type: 'write',
    prompt: '2/5 + 1/3',
    answer: '11/15', value: { n: 11, d: 15 },
    explanation: '5 and 3 both go into 15. Two fifths is six fifteenths and one third is five fifteenths — eleven altogether.',
    workingSteps: [
      { title: 'A bottom they both go into', math: '5 × 3 = 15' },
      { title: 'Change them both', math: '2/5 = 6/15,  and  1/3 = 5/15' },
      { title: 'Add the tops', math: '6 + 5 = 11, over 15' },
    ],
    misconceptions: [
      { answer: '3/8', code: 'added_denominators', explanation: 'Tops and bottoms were both added. Change them both to fifteenths first.' },
    ],
  },
  {
    id: 'fr-a4-1', level: 'add', stage: 4, skill: 'improper-and-mixed',
    stageTitle: 'When the answer is bigger than one',
    stageBlurb: 'Two names for the same amount.',
    type: 'write',
    prompt: '3/4 + 3/4 — write your answer as a mixed number.',
    answer: '1 2/4', value: { n: 6, d: 4 }, form: 'mixed',
    explanation: 'Three quarters twice is six quarters. Four quarters make one whole, so that is one whole and two quarters left over.',
    workingSteps: [
      { title: 'Add the tops — the bottoms already match', math: '3 + 3 = 6, over 4' },
      { title: 'How many wholes is that?', math: '4 quarters = 1 whole' },
      { title: 'What is left', math: '6 − 4 = 2 quarters' },
    ],
    misconceptions: [
      { answer: '6/8', code: 'added_denominators', explanation: 'The bottoms were added. Both are quarters already, so the answer is in quarters too.' },
    ],
  },
  {
    id: 'fr-a4-2', level: 'add', stage: 4, skill: 'improper-and-mixed',
    type: 'write',
    prompt: 'Write 11/4 as a mixed number.',
    answer: '2 3/4', value: { n: 11, d: 4 }, form: 'mixed',
    explanation: 'How many fours go into 11? Two, with 3 left over — so two whole ones and three quarters.',
    workingSteps: [
      { title: 'How many wholes?', math: '11 ÷ 4 = 2, remainder 3' },
      { title: 'The remainder stays over the same bottom', math: '2 and 3/4' },
    ],
    misconceptions: [
      { answer: '3 2/4', code: 'mixed_improper_slip', explanation: 'The whole number and the remainder are swapped. 4 goes into 11 twice with 3 left over, so it is 2 whole ones and 3 quarters.' },
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 5 — TAKING AWAY
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_5 = [
  {
    id: 'fr-s1-1', level: 'sub', stage: 1, skill: 'subtract-same-denominator',
    stageTitle: 'Same bottom',
    stageBlurb: 'Take the tops away and leave the bottom alone.',
    type: 'write',
    prompt: '3/4 − 1/4 — give your answer in its lowest terms.',
    answer: '1/2', value: { n: 1, d: 2 }, form: 'lowest',
    explanation: 'Both are quarters, so take one away from three: two quarters. Two and four both divide by 2, giving one half.',
    workingSteps: [
      { title: 'Take the tops away', math: '3 − 1 = 2, over 4' },
      { title: 'Lowest terms', math: '2/4 = 1/2' },
    ],
    misconceptions: [
      { answer: '2/4', code: 'not_simplified', explanation: 'Right amount — and this one asks for lowest terms. 2 and 4 both divide by 2.' },
    ],
  },
  {
    id: 'fr-s1-2', level: 'sub', stage: 1, skill: 'subtract-from-whole',
    type: 'write',
    prompt: '1 − 1/3',
    caption: 'One whole chitenge. One third is cut off.',
    visual: { shape: 'strip', object: 'chitenge', parts: 3, numerator: 2, shaded: 2 },
    answer: '2/3', value: { n: 2, d: 3 },
    explanation: 'Write the whole as thirds first: one whole is three thirds. Three thirds take away one third is two thirds.',
    workingSteps: [
      { title: 'Write the whole in thirds', math: '1 = 3/3' },
      { title: 'Now take away', math: '3/3 − 1/3 = 2/3' },
    ],
    misconceptions: [
      { answer: '1/3', code: 'counted_remaining', explanation: 'That is the part taken away. The question asks what is LEFT — the whole is three thirds.' },
      { answer: '0/3', code: 'whole_not_converted', explanation: 'The 1 was treated as one third. One whole chitenge is THREE thirds, so there are two left.' },
    ],
    traps: { '1/3': 'That is the part taken away. The question asks what is LEFT — the whole is 3/3.' },
  },
  {
    id: 'fr-s2-1', level: 'sub', stage: 2, skill: 'subtract-unlike',
    stageTitle: 'Different bottoms',
    stageBlurb: 'Make them match, then take away.',
    type: 'write',
    prompt: '5/6 − 1/3 — give your answer in its lowest terms.',
    answer: '1/2', value: { n: 1, d: 2 }, form: 'lowest',
    explanation: '3 goes into 6, so one third is two sixths. Five sixths take away two sixths is three sixths, which is one half.',
    workingSteps: [
      { title: 'Make the bottoms match', math: '1/3 = 2/6' },
      { title: 'Take the tops away', math: '5/6 − 2/6 = 3/6' },
      { title: 'Lowest terms', math: '3/6 = 1/2' },
    ],
    misconceptions: [
      { answer: '4/3', code: 'added_denominators', explanation: 'The bottoms were subtracted too. Change 1/3 into 2/6 first, then take the tops away.' },
      { answer: '3/6', code: 'not_simplified', explanation: 'Right amount — and this one asks for lowest terms. 3 and 6 both divide by 3.' },
    ],
    traps: { '4/3': 'The bottoms were subtracted too. Change 1/3 into 2/6 first, then take the tops away.' },
  },
  {
    id: 'fr-s2-2', level: 'sub', stage: 2, skill: 'subtract-unlike',
    type: 'write',
    prompt: '3/4 − 2/5',
    answer: '7/20', value: { n: 7, d: 20 },
    explanation: '4 and 5 both go into 20: three quarters is fifteen twentieths and two fifths is eight twentieths. Fifteen take away eight is seven.',
    workingSteps: [
      { title: 'A bottom they both go into', math: '4 × 5 = 20' },
      { title: 'Change them both', math: '3/4 = 15/20,  and  2/5 = 8/20' },
      { title: 'Take the tops away', math: '15 − 8 = 7, over 20' },
    ],
    misconceptions: [
      { answer: '1/1', code: 'added_denominators', explanation: 'Tops and bottoms were both subtracted. Change them both to twentieths first.' },
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 6 — MULTIPLYING. Before dividing, because dividing IS
 *  multiplying by the flipped one.
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_6 = [
  {
    id: 'fr-m1-1', level: 'mult', stage: 1, skill: 'multiply-fractions',
    stageTitle: '"Of" means times',
    stageBlurb: 'Tops times tops, bottoms times bottoms.',
    type: 'write',
    prompt: '2/3 × 3/4 — give your answer in its lowest terms.',
    answer: '1/2', value: { n: 1, d: 2 }, form: 'lowest',
    explanation: 'Tops times tops and bottoms times bottoms: 2 × 3 over 3 × 4 is 6 over 12, which simplifies to one half.',
    workingSteps: [
      { title: 'Tops times tops', math: '2 × 3 = 6' },
      { title: 'Bottoms times bottoms', math: '3 × 4 = 12' },
      { title: 'Lowest terms', math: '6/12 = 1/2' },
    ],
    misconceptions: [
      { answer: '5/7', code: 'added_instead_of_multiplied', explanation: 'Those were added, not multiplied. Multiplying is tops times tops and bottoms times bottoms: 2 × 3 over 3 × 4.' },
      { answer: '6/12', code: 'not_simplified', explanation: 'Right amount — and this one asks for lowest terms. 6 and 12 both divide by 6.' },
    ],
    traps: { '5/7': 'Multiplying is not adding. Tops times tops, bottoms times bottoms: 2×3 over 3×4.' },
  },
  {
    id: 'fr-m1-2', level: 'mult', stage: 1, skill: 'multiply-fractions',
    type: 'write',
    prompt: '1/2 × 4/5 — give your answer in its lowest terms.',
    answer: '2/5', value: { n: 2, d: 5 }, form: 'lowest',
    explanation: '1 × 4 over 2 × 5 is 4 over 10, and both divide by 2 — two fifths.',
    workingSteps: [
      { title: 'Multiply straight across', math: '1 × 4 = 4,  and  2 × 5 = 10' },
      { title: 'Lowest terms', math: '4/10 = 2/5' },
    ],
    misconceptions: [
      { answer: '4/10', code: 'not_simplified', explanation: 'Right amount — and this one asks for lowest terms. 4 and 10 both divide by 2.' },
    ],
  },
  {
    id: 'fr-m2-1', level: 'mult', stage: 2, skill: 'fraction-of-a-quantity',
    stageTitle: 'A fraction of an amount',
    stageBlurb: 'Divide by the bottom, multiply by the top.',
    type: 'write',
    prompt: '3/4 of 2/5',
    answer: '3/10', value: { n: 3, d: 10 },
    explanation: '"Of" means times: 3 × 2 over 4 × 5 is 6 over 20, which is three tenths.',
    workingSteps: [
      { title: '"Of" means times', math: '3/4 × 2/5' },
      { title: 'Straight across', math: '3 × 2 = 6,  and  4 × 5 = 20' },
      { title: 'Lowest terms', math: '6/20 = 3/10' },
    ],
    misconceptions: [
      { answer: '5/9', code: 'added_instead_of_multiplied', explanation: '"Of" means times, not plus. Tops times tops, bottoms times bottoms.' },
    ],
    traps: { '5/9': '“Of” means times, not plus. Tops times tops, bottoms times bottoms.' },
  },
  {
    id: 'fr-m2-2', level: 'mult', stage: 2, skill: 'fraction-of-a-quantity',
    type: 'write',
    prompt: '3/4 of the 240 learners at Kabulonga Primary passed. How many passed?',
    caption: 'Three of the four parts passed.',
    visual: { shape: 'bar', object: 'bar', parts: 4, numerator: 3, shaded: 3 },
    answer: '180', value: { n: 180, d: 1 }, form: 'whole',
    explanation: 'Divide by the bottom and multiply by the top: a quarter of 240 is 60, and three of those is 180.',
    workingSteps: [
      { title: 'Find one quarter', math: '240 ÷ 4 = 60' },
      { title: 'You need three of them', math: '60 × 3 = 180' },
    ],
    misconceptions: [
      { answer: '320', code: 'divided_by_numerator', explanation: 'You divided by 3 and multiplied by 4 — it is the other way round. Divide by the BOTTOM first, then multiply by the top.' },
      { answer: '60', code: 'found_unit_fraction_only', explanation: 'That is one quarter. The question asks for three of them — multiply by the top number.' },
      { answer: '720', code: 'forgot_to_divide', explanation: 'You multiplied by 3 but forgot to divide by 4 first. Divide by the bottom, then multiply by the top.' },
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 7 — DIVIDING
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_7 = [
  {
    id: 'fr-d1-1', level: 'div', stage: 1, skill: 'divide-fractions',
    stageTitle: 'Turn it upside down',
    stageBlurb: 'Dividing by a fraction is multiplying by the flipped one.',
    type: 'write',
    prompt: '2/3 ÷ 4/5 — give your answer in its lowest terms.',
    answer: '5/6', value: { n: 5, d: 6 }, form: 'lowest',
    explanation: 'Flip the second one and multiply: 2/3 × 5/4 is 10 over 12, which is five sixths.',
    workingSteps: [
      { title: 'Flip the SECOND fraction', math: '4/5 becomes 5/4' },
      { title: 'Now multiply', math: '2/3 × 5/4 = 10/12' },
      { title: 'Lowest terms', math: '10/12 = 5/6' },
    ],
    misconceptions: [
      { answer: '8/15', code: 'multiplied_instead_of_divided', explanation: 'That is 2/3 × 4/5. Turn the SECOND fraction upside down first: 2/3 × 5/4.' },
    ],
    traps: { '8/15': 'That is 2/3 × 4/5. Turn the SECOND fraction upside down first: 2/3 × 5/4.' },
  },
  {
    id: 'fr-d1-2', level: 'div', stage: 1, skill: 'divide-fractions',
    type: 'write',
    prompt: '3/4 ÷ 1/2',
    answer: '3/2', value: { n: 3, d: 2 },
    explanation: 'Flip 1/2 to 2/1 and multiply: 3 × 2 over 4 × 1 is 6 over 4, which is three halves — one and a half.',
    workingSteps: [
      { title: 'Flip the second one', math: '1/2 becomes 2/1' },
      { title: 'Multiply', math: '3/4 × 2/1 = 6/4' },
      { title: 'Lowest terms', math: '6/4 = 3/2' },
    ],
    misconceptions: [
      { answer: '3/8', code: 'multiplied_instead_of_divided', explanation: 'That is 3/4 × 1/2. Turn 1/2 upside down and multiply: 3/4 × 2/1.' },
    ],
    traps: { '3/8': 'That is 3/4 × 1/2. Turn 1/2 upside down and multiply: 3/4 × 2/1.' },
  },
  {
    id: 'fr-d1-3', level: 'div', stage: 1, skill: 'divide-fractions',
    type: 'write',
    prompt: '1/3 ÷ 2/5 — give your answer in its lowest terms.',
    answer: '5/6', value: { n: 5, d: 6 }, form: 'lowest',
    explanation: 'Flip 2/5 to 5/2 and multiply: 1 × 5 over 3 × 2 is five sixths.',
    workingSteps: [
      { title: 'Flip the second one', math: '2/5 becomes 5/2' },
      { title: 'Multiply', math: '1/3 × 5/2 = 5/6' },
    ],
    misconceptions: [
      { answer: '2/15', code: 'multiplied_instead_of_divided', explanation: 'That is 1/3 × 2/5. The second fraction is turned upside down before you multiply.' },
    ],
    traps: { '2/15': 'That is 1/3 × 2/5. The second fraction is turned upside down before you multiply.' },
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 8 — FRACTIONS, DECIMALS AND PERCENTAGES
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_8 = [
  {
    id: 'fr-f1-1', level: 'fdp', stage: 1, skill: 'decimal-to-fraction',
    stageTitle: 'The same amount, three ways',
    stageBlurb: 'ECZ papers move between all three, so you should too.',
    type: 'write',
    prompt: 'Write 0.75 as a fraction in its lowest terms.',
    answer: '3/4', value: { n: 3, d: 4 }, form: 'lowest',
    explanation: '0.75 is 75 hundredths. 75 and 100 both divide by 25, giving three quarters.',
    workingSteps: [
      { title: 'Two decimal places means hundredths', math: '0.75 = 75/100' },
      { title: 'Lowest terms', math: '75 ÷ 25 = 3,  and  100 ÷ 25 = 4' },
    ],
    misconceptions: [
      { answer: '75/100', code: 'not_simplified', explanation: 'Right amount — and 75 and 100 both divide by 25, so it goes further.' },
    ],
    traps: { '75/100': 'Right amount — and 75 and 100 both divide by 25, so it goes further.' },
  },
  {
    id: 'fr-f1-2', level: 'fdp', stage: 1, skill: 'percent-to-fraction',
    type: 'write',
    prompt: 'Write 45% as a fraction in its lowest terms.',
    answer: '9/20', value: { n: 9, d: 20 }, form: 'lowest',
    explanation: 'Per cent means out of a hundred, so 45% is 45 hundredths. Both divide by 5, giving nine twentieths.',
    workingSteps: [
      { title: 'Per cent means out of 100', math: '45% = 45/100' },
      { title: 'Lowest terms', math: '45 ÷ 5 = 9,  and  100 ÷ 5 = 20' },
    ],
    misconceptions: [
      { answer: '45/100', code: 'not_simplified', explanation: 'Right amount — both numbers still divide by 5.' },
      { answer: '45/1', code: 'read_percent_as_amount', explanation: 'The 45 is not an amount on its own. Per cent means out of every hundred, so it starts as 45 over 100.' },
    ],
    traps: { '45/100': 'Right amount — both numbers still divide by 5.' },
  },
  {
    id: 'fr-f2-1', level: 'fdp', stage: 2, skill: 'fraction-to-decimal',
    stageTitle: 'Going the other way',
    stageBlurb: 'Divide the top by the bottom.',
    type: 'write',
    prompt: 'Write 3/8 as a decimal.',
    answer: '0.375', value: { n: 3, d: 8 }, form: 'decimal', tolerance: 0.001,
    explanation: '3 divided by 8 is exactly 0.375 — no rounding needed.',
    workingSteps: [
      { title: 'A fraction is a division', math: '3/8 means 3 ÷ 8' },
      { title: 'Work it out', math: '3 ÷ 8 = 0.375' },
    ],
    misconceptions: [
      { answer: '0.38', code: 'answered_the_wrong_part', explanation: 'Very close — that is 0.375 rounded. This one divides exactly, so write all three figures.' },
    ],
    traps: { '0.38': 'Very close. 3 ÷ 8 is exactly 0.375 — no rounding needed here.' },
  },
  {
    id: 'fr-f2-2', level: 'fdp', stage: 2, skill: 'fdp-matching',
    type: 'choice',
    prompt: 'Which of these is the same amount as 0.5?',
    options: [
      { id: 'a', fraction: { n: 1, d: 2 } },
      { id: 'b', fraction: { n: 1, d: 5 } },
      { id: 'c', fraction: { n: 5, d: 1 } },
    ],
    answer: 'a',
    explanation: '0.5 is five tenths, and five tenths simplifies to one half. It is also 50%.',
    misconceptions: [
      { answer: 'b', code: 'read_percent_as_amount', explanation: 'The 5 in 0.5 is five TENTHS, not one fifth. Five tenths is one half.' },
      { answer: 'c', code: 'inverted', explanation: 'That is five whole ones. 0.5 is less than one — it is half of one.' },
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════
 *  LEVEL 9 — FRACTIONS IN REAL LIFE. The capstone: work out WHICH
 *  operation, then do it.
 * ═══════════════════════════════════════════════════════════════════ */

const LEVEL_9 = [
  {
    id: 'fr-r1-1', level: 'real', stage: 1, skill: 'word-problem-subtract',
    stageTitle: 'Shop and market',
    stageBlurb: 'Work out which operation first.',
    type: 'write',
    prompt: 'A trader had 3/4 of a bag of mealie meal and sold 1/2 of the bag. What fraction of a bag is left?',
    answer: '1/4', value: { n: 1, d: 4 }, form: 'lowest',
    explanation: 'She sold half A BAG, so take one half away from three quarters. One half is two quarters, and three quarters take away two quarters is one quarter.',
    workingSteps: [
      { title: 'Which operation? She sold some, so take away', math: '3/4 − 1/2' },
      { title: 'Make the bottoms match', math: '1/2 = 2/4' },
      { title: 'Take the tops away', math: '3/4 − 2/4 = 1/4' },
    ],
    misconceptions: [
      { answer: '3/8', code: 'multiplied_instead_of_divided', explanation: 'She sold half A BAG, not half of what she had. Take 1/2 away from 3/4.' },
      { answer: '2/2', code: 'added_denominators', explanation: 'The bottoms were subtracted too. Change 1/2 into 2/4 first, then take the tops away.' },
    ],
    traps: { '3/8': 'She sold half A BAG, not half of what she had. Take 1/2 away from 3/4.' },
  },
  {
    id: 'fr-r1-2', level: 'real', stage: 1, skill: 'word-problem-remainder',
    type: 'write',
    prompt: 'Mutinta spent 2/5 of her K200 on books. What fraction of her money was left?',
    answer: '3/5', value: { n: 3, d: 5 },
    explanation: 'All her money is five fifths. She spent two fifths, so three fifths are left.',
    workingSteps: [
      { title: 'The whole is five fifths', math: '1 = 5/5' },
      { title: 'Take away what she spent', math: '5/5 − 2/5 = 3/5' },
    ],
    misconceptions: [
      { answer: '2/5', code: 'counted_remaining', explanation: 'That is the part she spent. The whole is 5/5, so what is left is 5/5 − 2/5.' },
      { answer: '3/10', code: 'added_denominators', explanation: 'The bottoms were changed. Both are fifths, so the answer is in fifths too.' },
    ],
    traps: { '2/5': 'That is the part she spent. The whole is 5/5, so what is left is 5/5 − 2/5.' },
  },
  {
    id: 'fr-r2-1', level: 'real', stage: 2, skill: 'word-problem-of',
    stageTitle: 'Time and distance',
    stageBlurb: '"Of" is still times, even in a story.',
    type: 'write',
    prompt: 'A journey takes 3/4 of an hour. Half of it has been travelled. What fraction of an hour is that?',
    answer: '3/8', value: { n: 3, d: 8 },
    explanation: 'Half OF three quarters means half times three quarters: 1 × 3 over 2 × 4 is three eighths.',
    workingSteps: [
      { title: '"Half of" means times a half', math: '1/2 × 3/4' },
      { title: 'Multiply straight across', math: '1 × 3 = 3,  and  2 × 4 = 8' },
    ],
    misconceptions: [
      { answer: '1/2', code: 'answered_the_wrong_part', explanation: 'Half OF three quarters, not a half of an hour. The journey is only three quarters of an hour to begin with.' },
      { answer: '3/2', code: 'multiplied_instead_of_divided', explanation: 'That is three quarters divided by a half. "Half of" means times a half: 1/2 × 3/4.' },
    ],
    traps: { '1/2': 'Half OF three quarters, not a half of an hour. 1/2 × 3/4.' },
  },
  {
    id: 'fr-r2-2', level: 'real', stage: 2, skill: 'word-problem-of',
    type: 'write',
    prompt: 'A chitenge is 6 metres long. Chanda cuts off 2/3 of it. How many metres did she cut?',
    caption: 'The chitenge in three equal parts. Two are cut off.',
    visual: { shape: 'strip', object: 'chitenge', parts: 3, numerator: 2, shaded: 2 },
    answer: '4', value: { n: 4, d: 1 }, form: 'whole',
    explanation: 'Divide by the bottom and multiply by the top: 6 ÷ 3 is 2, and two of those is 4 metres.',
    workingSteps: [
      { title: 'Find one third', math: '6 ÷ 3 = 2' },
      { title: 'You need two of them', math: '2 × 2 = 4' },
    ],
    misconceptions: [
      { answer: '9', code: 'divided_by_numerator', explanation: 'You divided by 2 and multiplied by 3 — the other way round. Divide by the BOTTOM first.' },
      { answer: '2', code: 'found_unit_fraction_only', explanation: 'That is one third of the chitenge. The question asks for two thirds.' },
      { answer: '12', code: 'forgot_to_divide', explanation: 'You multiplied by 2 but did not divide by 3 first. Divide by the bottom, then multiply by the top.' },
    ],
  },
]

/**
 * The whole ladder, in order. Order matters only for readability — every
 * question carries its own `level` and `stage`, and the engine groups on those.
 */
export const FRACTION_QUESTIONS = [
  ...LEVEL_1,
  ...LEVEL_2,
  ...LEVEL_3,
  ...LEVEL_4,
  ...LEVEL_5,
  ...LEVEL_6,
  ...LEVEL_7,
  ...LEVEL_8,
  ...LEVEL_9,
]

export default FRACTION_QUESTIONS
