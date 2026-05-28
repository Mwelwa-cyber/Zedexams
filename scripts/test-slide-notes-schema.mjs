#!/usr/bin/env node
/**
 * Tests for the visual slide-notes validator + image-target walker.
 * Run: npm run test:slide-notes
 *
 * The validator is a CommonJS module in functions/, so we load it through
 * createRequire rather than an ESM import.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  validateSlideNotes,
  forEachImageTarget,
  MIN_SLIDES,
  DEFAULT_THEME,
} = require('../functions/teacherTools/slideNotesSchema.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// A complete, valid deck used as a baseline across tests.
function validDeck() {
  return {
    header: {
      title: 'Your Amazing Heart and Blood',
      grade: 'G5',
      subject: 'integrated_science',
      topic: 'The Circulatory System',
      subtopic: 'How blood moves',
      language: 'english',
    },
    theme: 'bright',
    slides: [
      {
        type: 'hero',
        title: 'Your Amazing Heart and Blood',
        subtitle: 'The super highway inside your body!',
        imagePrompt: 'A friendly cartoon heart pumping, simple line art',
        imageAlt: 'A cartoon heart',
      },
      {
        type: 'objectives',
        title: 'Our Awesome Mission',
        bullets: [
          'Identify the main parts of the circulatory system',
          'Explain how the heart works like a pump',
        ],
        imagePrompt: 'Outline of a child with the heart highlighted',
      },
      {
        type: 'vocab',
        title: 'Important Words',
        cards: [
          { term: 'Heart', definition: 'The organ that pumps blood.', imagePrompt: 'A simple heart' },
          { term: 'Vessels', definition: 'Tubes that carry blood.', imagePrompt: 'Blood vessels' },
        ],
      },
      {
        type: 'process',
        title: 'How the Blood Travels',
        intro: 'The blood travels in a giant loop.',
        steps: [
          { label: 'To the Lungs', text: 'Blood picks up fresh oxygen.', imagePrompt: 'Lungs line art' },
          { label: 'Back to the Heart', text: 'The heart prepares to pump.', imagePrompt: 'Heart line art' },
        ],
      },
      {
        type: 'diagram',
        title: 'Inside the Heart',
        caption: 'The four chambers of the heart.',
        imagePrompt: 'Cross-section of a human heart, four chambers, line art',
        labels: ['Left atrium', 'Right atrium', 'Left ventricle', 'Right ventricle'],
      },
      {
        type: 'concept',
        title: 'Why It Matters',
        body: 'Your heart beats about 100,000 times a day to keep you alive.',
      },
    ],
  }
}

console.log('\nslide-notes schema\n')

test('accepts a complete valid deck', () => {
  const res = validateSlideNotes(validDeck())
  assert(res.ok, `expected ok, got errors: ${(res.errors || []).join('; ')}`)
  assert(res.value.schemaVersion === '1.0', 'schemaVersion should be 1.0')
  assert(res.value.slides.length === 6, `expected 6 slides, got ${res.value.slides.length}`)
})

test('every slide carries an empty imageUrl ready for enrichment', () => {
  const { value } = validateSlideNotes(validDeck())
  for (const s of value.slides) {
    if ('imageUrl' in s) assert(s.imageUrl === '', `slide ${s.type} imageUrl should start empty`)
    if (Array.isArray(s.cards)) s.cards.forEach((c) => assert(c.imageUrl === '', 'vocab card imageUrl should start empty'))
    if (Array.isArray(s.steps)) s.steps.forEach((st) => assert(st.imageUrl === '', 'process step imageUrl should start empty'))
  }
})

test('preserves imagePrompt (not stripped like text-only validators)', () => {
  const { value } = validateSlideNotes(validDeck())
  assert(value.slides[0].imagePrompt.includes('cartoon heart'), 'hero imagePrompt was dropped')
  assert(value.slides[2].cards[0].imagePrompt === 'A simple heart', 'vocab card imagePrompt was dropped')
})

test('rejects a non-object payload', () => {
  const res = validateSlideNotes(null)
  assert(!res.ok, 'null payload should fail')
})

test('requires the core header fields', () => {
  const deck = validDeck()
  delete deck.header.topic
  const res = validateSlideNotes(deck)
  assert(!res.ok, 'missing topic should fail')
  assert(res.errors.some((e) => e.includes('topic')), 'should mention topic')
})

test('drops empty shell slides (vocab with no cards)', () => {
  const deck = validDeck()
  deck.slides.push({ type: 'vocab', title: 'Empty', cards: [] })
  const { value } = validateSlideNotes(deck)
  assert(!value.slides.some((s) => s.title === 'Empty'), 'empty vocab slide should be dropped')
})

test('drops unknown slide types', () => {
  const deck = validDeck()
  deck.slides.push({ type: 'video', title: 'Nope' })
  const { value } = validateSlideNotes(deck)
  assert(!value.slides.some((s) => s.title === 'Nope'), 'unknown slide type should be dropped')
})

test('falls back to default theme on bad theme', () => {
  const deck = validDeck()
  deck.theme = 'neon'
  const { value } = validateSlideNotes(deck)
  assert(value.theme === DEFAULT_THEME, `expected ${DEFAULT_THEME}, got ${value.theme}`)
})

test(`flags decks with fewer than ${MIN_SLIDES} usable slides`, () => {
  const deck = validDeck()
  deck.slides = deck.slides.slice(0, 2)
  const res = validateSlideNotes(deck)
  assert(!res.ok, 'too-short deck should fail')
})

test('flags a deck that does not open on a hero', () => {
  const deck = validDeck()
  deck.slides = deck.slides.slice(1) // drop the hero
  const res = validateSlideNotes(deck)
  assert(!res.ok, 'non-hero opener should be flagged')
  assert(res.errors.some((e) => e.toLowerCase().includes('hero')), 'should mention hero')
})

test('caps vocab cards at 6 and process steps at 6', () => {
  const deck = validDeck()
  const vocab = deck.slides.find((s) => s.type === 'vocab')
  vocab.cards = Array.from({ length: 10 }, (_, i) => ({ term: `T${i}`, definition: `D${i}` }))
  const { value } = validateSlideNotes(deck)
  const outVocab = value.slides.find((s) => s.type === 'vocab')
  assert(outVocab.cards.length === 6, `expected 6 vocab cards, got ${outVocab.cards.length}`)
})

test('forEachImageTarget walks slides, vocab cards and process steps', () => {
  const { value } = validateSlideNotes(validDeck())
  const prompts = []
  const count = forEachImageTarget(value, (t) => {
    prompts.push(t.imagePrompt)
    t.imageUrl = 'https://example.com/x.png'
  })
  // hero(1) + objectives(1) + 2 vocab cards + 2 process steps + diagram(1) = 7
  assert(count === 7, `expected 7 image targets, got ${count}`)
  assert(value.slides[0].imageUrl === 'https://example.com/x.png', 'hero imageUrl should be set by callback')
  const vocab = value.slides.find((s) => s.type === 'vocab')
  assert(vocab.cards[0].imageUrl === 'https://example.com/x.png', 'vocab card imageUrl should be set')
})

test('forEachImageTarget skips targets without an imagePrompt', () => {
  const deck = {
    schemaVersion: '1.0',
    header: {},
    theme: 'fresh',
    slides: [{ type: 'concept', title: 'No image', body: 'text only', imagePrompt: '', imageUrl: '' }],
  }
  const count = forEachImageTarget(deck, () => {})
  assert(count === 0, `expected 0 image targets, got ${count}`)
})

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
