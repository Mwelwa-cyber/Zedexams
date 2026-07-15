// Guards the syllabus word-spacing repair (scripts/fix-syllabus-word-spacing.mjs).
//
// The CDC syllabi were extracted from PDFs, which scattered single spaces
// *inside* words ("Communicating" -> "Communicatin g", "and" -> "a nd"). In
// the Syllabi Studio table (src/components/teacher/SyllabiLibrary.jsx) these
// read as words broken mid-letter. This test asserts:
//   1. fixSpacing repairs the broken forms (every category of break),
//   2. it leaves genuine multi-word phrases untouched (no over-merging),
//   3. it is idempotent,
//   4. fixCurriculumData only rewrites string values, never structure, and
//   5. the committed data files are already clean (the migration was applied
//      and stays a no-op), keeping the public/functions copies in lock-step.
//
// Plain `node` assertion script — run via `npm run test:syllabus-word-spacing`
// (auto-discovered by scripts/run-all-tests.mjs).

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORRECTIONS,
  fixSpacing,
  fixCurriculumData,
  normaliseNumericPrefix,
  repairString,
} from './fix-syllabus-word-spacing.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

let passed = 0
function check(label, fn) {
  fn()
  passed++
  console.log(`  ✓ ${label}`)
}

// ── 1. Broken words are repaired (one per category) ───────────────────────
console.log('\nrepairs broken words')

// Trailing/leading single-letter shards inside a word.
check('mid-word trailing shard: "Communicatin g" -> "Communicating"', () => {
  assert.strictEqual(fixSpacing('Communicatin g knowledge'), 'Communicating knowledge')
})
check('leading shard: "F orm a series" -> "Form a series"', () => {
  assert.strictEqual(fixSpacing('0.1.11.9.1.F orm a series of shapes'),
    '0.1.11.9.1.Form a series of shapes')
})
check('split across left neighbour: "to s olve" -> "to solve"', () => {
  assert.strictEqual(fixSpacing('light to s olve problems'), 'light to solve problems')
})
check('trailing-e shard: "solv e" -> "solve"', () => {
  assert.strictEqual(fixSpacing('use of light to solv e problems'),
    'use of light to solve problems')
})
check('function word: "a nd" / "an d" -> "and"', () => {
  assert.strictEqual(fixSpacing('shape a nd size'), 'shape and size')
  assert.strictEqual(fixSpacing('Agro-processing an d Entrepreneurship'),
    'Agro-processing and Entrepreneurship')
})
check('function word: "o f" -> "of", "t he" -> "the", "i n" -> "in"', () => {
  assert.strictEqual(fixSpacing('understanding o f degradation'), 'understanding of degradation')
  assert.strictEqual(fixSpacing('Describing t he shape'), 'Describing the shape')
  assert.strictEqual(fixSpacing('findings i n class'), 'findings in class')
})
check('proper adjective: "Africa n" -> "African"', () => {
  assert.strictEqual(fixSpacing('Service in Africa n Tradition'), 'Service in African Tradition')
})
check('Mathematics OCR: broken words + fused words', () => {
  assert.strictEqual(fixSpacing('Transpos ing matric es'), 'Transposing matrices')
  assert.strictEqual(fixSpacing('the fir st principle'), 'the first principle')
  assert.strictEqual(fixSpacing('Exploring three-dimension al shapes'),
    'Exploring three-dimensional shapes')
  assert.strictEqual(fixSpacing('Distinguishingvariables and coefficients'),
    'Distinguishing variables and coefficients')
  assert.strictEqual(fixSpacing('problems usingPythagoras Theorem'),
    'problems using Pythagoras Theorem')
  assert.strictEqual(fixSpacing('lines and compering their gradients'),
    'lines and comparing their gradients')
})
check('Mathematics OCR: scrambled set-operation symbols', () => {
  assert.strictEqual(
    fixSpacing('(intersection∩∩∪, union ∩∪∪ c o mplement(Ac), set difference (-))'),
    '(intersection(∩), union (∪) complement(Ac), set difference (-))')
})
check('capitalised command word: "M ake"/"R ead"/"W rite"/"S how"/"U se"', () => {
  assert.strictEqual(fixSpacing('M ake a business plan'), 'Make a business plan')
  assert.strictEqual(fixSpacing('R ead the given passages'), 'Read the given passages')
  assert.strictEqual(fixSpacing('W rite informal letters'), 'Write informal letters')
  assert.strictEqual(fixSpacing('S how ways'), 'Show ways')
  assert.strictEqual(fixSpacing('U se batters in cookery'), 'Use batters in cookery')
})
check('trailing plural shard: "word s" -> "words", "Specie s" -> "Species"', () => {
  assert.strictEqual(fixSpacing('Parts of speech: noun s'), 'Parts of speech: nouns')
  assert.strictEqual(fixSpacing('Plant Specie s in Zambia'), 'Plant Species in Zambia')
  assert.strictEqual(fixSpacing('TYPES OF NOUN S'.replace('NOUN S', 'CRAFT S')),
    'TYPES OF CRAFTS')
})
check('double break resolves fully: "p reser ves" -> "preserves"', () => {
  assert.strictEqual(fixSpacing('types of p reser ves: (jam, pickles)'),
    'types of preserves: (jam, pickles)')
})
// Auditor-derived internal-space rejoins (scripts/audit-syllabus-word-breaks.mjs
// AUTO class): each joined form is a frequent corpus word and the trailing shard
// is a non-word fragment, so the rejoin is evidence-based, not a guess.
check('auditor AUTO rejoins across subjects', () => {
  assert.strictEqual(fixSpacing('promoted accord ingly'), 'promoted accordingly')
  assert.strictEqual(fixSpacing('Preserve foods using tradit ional methods'),
    'Preserve foods using traditional methods')
  assert.strictEqual(fixSpacing('planning, produ ction, tracking'),
    'planning, production, tracking')
  assert.strictEqual(fixSpacing('management practi ces'), 'management practices')
  assert.strictEqual(fixSpacing('the locus of poi nts'), 'the locus of points')
  assert.strictEqual(fixSpacing('Colle cting data'), 'Collecting data')
  assert.strictEqual(fixSpacing('the len gth, area and volume'),
    'the length, area and volume')
  assert.strictEqual(fixSpacing('4.5. GEOMETRICAL TRANSFORMATI ONS'),
    '4.5. GEOMETRICAL TRANSFORMATIONS')
  assert.strictEqual(fixSpacing('3.3 PRODUCTIV ITY TOOLS'), '3.3 PRODUCTIVITY TOOLS')
  assert.strictEqual(fixSpacing('1.4.MATE RIALS'), '1.4.MATERIALS')
  assert.strictEqual(fixSpacing('3.10.1 Infer ences'), '3.10.1 Inferences')
  assert.strictEqual(fixSpacing('Bl ack Friday'), 'Black Friday')
  assert.strictEqual(fixSpacing('effects of human traffi cking'),
    'effects of human trafficking')
  assert.strictEqual(fixSpacing('medicine, cha rcoal, fruits'),
    'medicine, charcoal, fruits')
  assert.strictEqual(fixSpacing('phases of the moon, st ars, eclipses'),
    'phases of the moon, stars, eclipses')
  assert.strictEqual(fixSpacing('curvature in satell ite positioning'),
    'curvature in satellite positioning')
  assert.strictEqual(fixSpacing('Professional ism in the Hospitality Industry'),
    'Professionalism in the Hospitality Industry')
  assert.strictEqual(fixSpacing('Hin duism,Islam'), 'Hinduism,Islam')
})
check('auditor rejoin chains a residual second break: "Entrepren eur ship" -> "Entrepreneurship"', () => {
  assert.strictEqual(fixSpacing('1.12.1 Sports Entrepren eur ship'),
    '1.12.1 Sports Entrepreneurship')
})

// ── 2. Genuine phrases are NOT over-merged ────────────────────────────────
console.log('\npreserves legitimate text')

const PRESERVE = [
  'Listen to a simple story', // "a simple" is a real phrase, not a broken word
  'I am fine',
  'As in formation of polymers', // "in formation" must NOT become "information"
  'prevention of blindness: (Vit A deficiency)', // "Vit A" = Vitamin A
  'Recognising own name on a name card',
  'such as a pencil',
  'a basic pattern for a simple garment',
  'tools to be used',
  'a cylinder and a triangular prism',
  'the digestive system in human beings', // must NOT become "inhuman"
  'Draw lessons of fish farming',
  'Newton’s law of motion', // possessive "’s law" must stay
  'Interpreting the theme/s and title of a story',
  'safety precautions in a work environment',
  're-arranged in a logical order correctly',
  'Sort different types of food',
  'Roleplaying in groups',
]
for (const phrase of PRESERVE) {
  check(`unchanged: ${JSON.stringify(phrase)}`, () => {
    assert.strictEqual(fixSpacing(phrase), phrase)
  })
}

check('"Bacteria, fungi and viruses" mangle is left alone (not "fungian")', () => {
  const s = 'Draw structures of bacteria,f ungian dvi ruses'
  assert.ok(!fixSpacing(s).includes('fungian'),
    'must not invent the word "fungian"')
})

// ── 3. Idempotency ────────────────────────────────────────────────────────
console.log('\nidempotency')
check('fixSpacing(fixSpacing(x)) === fixSpacing(x)', () => {
  for (const [broken] of Object.entries(CORRECTIONS)) {
    const once = fixSpacing(`prefix ${broken} suffix`)
    assert.strictEqual(fixSpacing(once), once, `not idempotent for ${JSON.stringify(broken)}`)
  }
})

// ── 4. fixCurriculumData preserves structure ──────────────────────────────
console.log('\nfixCurriculumData')
check('rewrites string values only; keys/arrays/structure untouched', () => {
  const data = {
    'A Subject': {
      'Grade 1': {
        title: 'Communicatin g basics',
        columns: ['TOPIC', 'SUB-TOPIC'],
        rows: [
          { type: 'data', cells: { TOPIC: 'shape a nd size', 'SUB-TOPIC': 'a simple thing' } },
          { type: 'section', label: 'F orm a series' },
        ],
      },
    },
  }
  const changed = fixCurriculumData(data)
  assert.strictEqual(changed, 3) // title, TOPIC, label
  assert.deepStrictEqual(Object.keys(data), ['A Subject'])
  assert.deepStrictEqual(Object.keys(data['A Subject']['Grade 1']), ['title', 'columns', 'rows'])
  assert.strictEqual(data['A Subject']['Grade 1'].title, 'Communicating basics')
  assert.deepStrictEqual(data['A Subject']['Grade 1'].columns, ['TOPIC', 'SUB-TOPIC'])
  assert.strictEqual(data['A Subject']['Grade 1'].rows[0].cells.TOPIC, 'shape and size')
  assert.strictEqual(data['A Subject']['Grade 1'].rows[0].cells['SUB-TOPIC'], 'a simple thing')
  assert.strictEqual(data['A Subject']['Grade 1'].rows[1].label, 'Form a series')
})

// ── 4b. Numeric code-prefix normalisation ─────────────────────────────────
console.log('\nnormaliseNumericPrefix (Lesson Plan Studio topic codes)')
check('inserts missing space after code: "3.2.1Food" -> "3.2.1 Food"', () => {
  assert.strictEqual(normaliseNumericPrefix('3.2.1Food'), '3.2.1 Food')
  assert.strictEqual(normaliseNumericPrefix('4.4ENTREPRENEURSHIP'), '4.4 ENTREPRENEURSHIP')
})
check('collapses stray spaces inside the code', () => {
  assert.strictEqual(normaliseNumericPrefix('1. 1.4Sources'), '1.1.4 Sources')
  assert.strictEqual(normaliseNumericPrefix('3.4 .6Grains'), '3.4.6 Grains')
  assert.strictEqual(normaliseNumericPrefix('4 .6.10The'), '4.6.10 The')
})
check('leaves non-code numeric starts alone ("3D", "21st")', () => {
  assert.strictEqual(normaliseNumericPrefix('3D shapes'), '3D shapes')
  assert.strictEqual(normaliseNumericPrefix('21st Century'), '21st Century')
})
check('does NOT split the "code.Text" ECE outcome style', () => {
  // a dot (not a letter) directly follows the code -> untouched
  assert.strictEqual(normaliseNumericPrefix('0.1.11.9.1.Form a series'),
    '0.1.11.9.1.Form a series')
})
check('idempotent', () => {
  for (const s of ['3.2.1Food', '1. 1.4Sources', '4 .6.10The']) {
    const once = normaliseNumericPrefix(s)
    assert.strictEqual(normaliseNumericPrefix(once), once)
  }
})

// ── 4c. The reported bug + its siblings ───────────────────────────────────
console.log('\nrepairString fixes the reported Lesson Plan Studio labels')
const LABEL_FIXES = [
  ['4.2 NUTRITION ANDHEALTH', '4.2 NUTRITION AND HEALTH'],
  ['4.1 THE HUMA N BODY', '4.1 THE HUMAN BODY'],
  ['2.6 ORGANISATION ANDM ANAGEMENT OF GAMES AND SPORTS EVENTS.',
    '2.6 ORGANISATION AND MANAGEMENT OF GAMES AND SPORTS EVENTS.'],
  ['1. 5.2Tr ust', '1.5.2 Trust'],
  ['4 .6.10The Middle East Cri ses', '4.6.10 The Middle East Crises'],
  ['4.3.2Obligationsand Dutiesof Citizen s', '4.3.2 Obligations and Duties of Citizens'],
  ['4.8.1 Basicso f pSreadsheet', '4.8.1 Basics of Spreadsheet'],
  ['4.6WEATHERAND CLIMATE', '4.6 WEATHER AND CLIMATE'],
  // #1436 follow-up: labels the first sweep still left garbled in the pickers.
  ['0.1.11.8 Creative Expressio n', '0.1.11.8 Creative Expression'],
  ['0.1.11.10 Copying Own Nam e', '0.1.11.10 Copying Own Name'],
  ['2.1 SLAVERY AND SLAVE TRAD E', '2.1 SLAVERY AND SLAVE TRADE'],
  ['4.8.1 Basic S ewing Skills', '4.8.1 Basic Sewing Skills'],
  ['1.17 LETTERIN G', '1.17 LETTERING'],
  ['2.8 COMPUTE R', '2.8 COMPUTER'],
  ['4.5. ENTREPRENEURS HIP', '4.5. ENTREPRENEURSHIP'],
  ['• Movementpattern s and Movement expl oration',
    '• Movement patterns and Movement exploration'],
  // Contraction question tags: the shard after an apostrophe is the
  // contraction's tail, not a broken word — "t he" must NOT join to "the"
  // here (English Forms 1-4 grammar activities are full of these).
  ['…isn’t he? She hasn’t been to school, has she?',
    '…isn’t he? She hasn’t been to school, has she?'],
  ["He is coming tomorrow, isn't he?", "He is coming tomorrow, isn't he?"],
  // Single-token OCR misspellings (dropped/altered letter).
  ['3.5 LECTROMAGNETISM', '3.5 ELECTROMAGNETISM'],
  ['0.2.7 VISUAL DESCRIMINATION', '0.2.7 VISUAL DISCRIMINATION'],
  ['4.5 ...INTERNATIONAL COOPORATING PARTNERS', '4.5 ...INTERNATIONAL COOPERATING PARTNERS'],
]
for (const [broken, fixed] of LABEL_FIXES) {
  check(`${JSON.stringify(broken)} -> ${JSON.stringify(fixed)}`, () => {
    const once = repairString(broken)
    assert.strictEqual(once, fixed)
    assert.strictEqual(repairString(once), once, 'must be idempotent')
  })
}

// ── 5. The committed data files are already clean ─────────────────────────
console.log('\ncommitted data is clean (migration applied + stays a no-op)')
const FILES = [
  'public/syllabi/curriculum-data.json',
  'public/syllabi/curriculum-data-2013.json',
  'functions/data/curriculum-data.json',
  'functions/data/curriculum-data-2013.json',
]
for (const rel of FILES) {
  const file = path.join(ROOT, rel)
  if (!fs.existsSync(file)) continue
  check(`${rel}: no remaining repairs`, () => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const numericPrefix = !rel.includes('2013')
    const remaining = fixCurriculumData(data, { numericPrefix })
    assert.strictEqual(remaining, 0,
      `${remaining} broken string(s) remain — run: node scripts/fix-syllabus-word-spacing.mjs`)
  })
}

console.log(`\nAll ${passed} syllabus word-spacing checks passed.`)
