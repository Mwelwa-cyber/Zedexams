// src/features/notes/lib/studySchema.js
//
// Zod schema for the `blocks[]` payload of a `noteFormat: 'study'` note.
// The Firestore rule for the lessons collection only checks that `blocks` is a
// list of a bounded length (it can't validate nested shapes), so per-element
// validation lives here and runs client-side before every write — the same
// split the rules comments describe for quiz questions.
//
// Two exports:
//   • studyBlocksWriteSchema — strict-ish per-type validation; .parse() before save.
//   • coerceStudyBlocks(raw) — permissive READ normaliser; never throws, drops
//     malformed blocks and guarantees array fields, so a partially-broken doc
//     still renders for learners instead of blanking the page.

import { z } from 'zod'

export const MAX_STUDY_BLOCKS = 600

const str   = z.string()
const strArr = z.array(z.string())

// Per-type block schemas. `.passthrough()` keeps any forward-compat fields.
const blockSchemas = {
  objectives: z.object({ id: str.optional(), type: z.literal('objectives'), items: strArr }),
  summary:    z.object({ id: str.optional(), type: z.literal('summary'),    items: strArr }),
  bullets:    z.object({ id: str.optional(), type: z.literal('bullets'),    items: strArr }),
  numbers:    z.object({ id: str.optional(), type: z.literal('numbers'),    items: strArr }),
  think:      z.object({ id: str.optional(), type: z.literal('think'),      lines: strArr }),
  note:       z.object({ id: str.optional(), type: z.literal('note'),       lines: strArr }),
  tip:        z.object({ id: str.optional(), type: z.literal('tip'),        lines: strArr }),
  heading:    z.object({ id: str.optional(), type: z.literal('heading'),    level: z.union([z.literal(2), z.literal(3)]), text: str }),
  paragraph:  z.object({ id: str.optional(), type: z.literal('paragraph'),  text: str }),
  keyidea:    z.object({ id: str.optional(), type: z.literal('keyidea'),    text: str }),
  // Firestore forbids arrays-of-arrays, so rows are maps, not [term, def] / cell tuples.
  keyterms:   z.object({ id: str.optional(), type: z.literal('keyterms'),   rows: z.array(z.object({ term: str, def: str.optional().default('') })) }),
  table:      z.object({ id: str.optional(), type: z.literal('table'),      headers: strArr, rows: z.array(z.object({ cells: strArr })) }),
  picture:    z.object({ id: str.optional(), type: z.literal('picture'),    caption: str, lines: strArr, url: str.optional(), prompt: str.optional() }),
  image:      z.object({ id: str.optional(), type: z.literal('image'),      url: str, caption: str.optional().default('') }),
  quickcheck: z.object({ id: str.optional(), type: z.literal('quickcheck'), q: str, a: str, level: str.optional().default('') }),
  exam:       z.object({ id: str.optional(), type: z.literal('exam'),       q: str, a: str }),
  mistake:    z.object({ id: str.optional(), type: z.literal('mistake'),    wrong: str, correct: str }),
  quiz:       z.object({ id: str.optional(), type: z.literal('quiz'),       quizId: str.optional().default(''), quizTitle: str.optional().default(''), questionCount: z.number().int().nullable().optional() }),

  // ── Reader-engine blocks (learner redesign step 3) ────────────────
  // The interactive vocabulary of the prototype-v3 note reader. Notes
  // regenerated through the pipeline carry these; their presence is what
  // routes a study note into the new ReaderEngine (see readerCore.js).
  // All shapes are maps/arrays-of-maps — Firestore forbids nested arrays.

  // Section key points — shown in Revise mode (Learn mode hides them the
  // way the prototype does; the practice blocks invert).
  keypoints: z.object({ id: str.optional(), type: z.literal('keypoints'), items: strArr }),

  // Keyword glossary — never rendered as a block. Paragraph text marks
  // keywords as [[word]]; the reader resolves them here and opens the
  // word-explainer sheet (meaning · how to use it · examples).
  glossary: z.object({
    id: str.optional(),
    type: z.literal('glossary'),
    entries: z.array(z.object({
      word: str,
      meaning: str,
      how: str.optional().default(''),
      examples: strArr.optional().default([]),
    })),
  }),

  // "YOUR TURN" practice: chips; wrong picks shake and stay tappable,
  // the correct pick locks the card with its feedback line.
  practice: z.object({
    id: str.optional(),
    type: z.literal('practice'),
    q: str,
    options: z.array(z.object({ text: str, correct: z.boolean().optional().default(false) })).min(2),
    correctNote: str.optional().default(''),
  }),

  // SECTION CHECK with remediation: a wrong pick opens "Let's look at it
  // again" — explanation + example + a similar retry question — instead
  // of just marking the answer red.
  sectioncheck: z.object({
    id: str.optional(),
    type: z.literal('sectioncheck'),
    label: str.optional().default(''),
    q: str,
    options: z.array(z.object({ text: str, correct: z.boolean().optional().default(false) })).min(2),
    remediation: z.object({
      explain: str,
      example: str.optional().default(''),
      retryQ: str,
      retryOptions: z.array(z.object({ text: str, correct: z.boolean().optional().default(false) })).min(2),
      retryHint: str.optional().default(''),
    }),
  }),

  // Label-the-diagram: drag each word onto its box (or tap word → tap
  // box). Anchors are normalised 0–1 fractions of the rendered image.
  labeldiagram: z.object({
    id: str.optional(),
    type: z.literal('labeldiagram'),
    url: str,
    alt: str.optional().default(''),
    instructions: str.optional().default(''),
    items: z.array(z.object({
      key: str.optional().default(''),
      label: str,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })).min(2),
  }),

  // ── The three shapes the Digestive System note needs ──────────────
  // Added when that note was authored to the mockup's depth. Each is a
  // distinct idea rather than a restyle of an existing block, which is
  // why none of them is `bullets` with a class name.

  // "STARTS IN 👄 Mouth → ENDS IN 🌀 Small intestine". Two labelled boxes
  // and an arrow: the one fact a learner is asked for most often, given
  // its own shape so it survives being skim-read.
  startend: z.object({
    id: str.optional(),
    type: z.literal('startend'),
    startLabel: str.optional().default('STARTS IN'),
    endLabel: str.optional().default('ENDS IN'),
    start: str,
    end: str,
  }),

  // An ordered pipeline drawn as cards with arrows between — the journey
  // of food. Deliberately NOT `numbers`: that renders an <ol>, and the
  // point here is that each step FEEDS the next, which a bare list does
  // not say. `note` is the trailing half of a step ("— teeth chew").
  flow: z.object({
    id: str.optional(),
    type: z.literal('flow'),
    steps: z.array(z.object({ text: str, note: str.optional().default('') })).min(2),
  }),

  // Tap-to-explore grid (the spec's `tapExplore`): a card per item, and
  // tapping one opens a sheet with a real picture and what it does.
  // `parts` is the optional extra paragraph the small and large
  // intestines carry ("2 parts: ① Duodenum … ② Ileum …").
  tapexplore: z.object({
    id: str.optional(),
    type: z.literal('tapexplore'),
    prompt: str.optional().default(''),
    items: z.array(z.object({
      key: str.optional().default(''),
      name: str,
      url: str.optional().default(''),
      role: str,
      parts: str.optional().default(''),
    })).min(2),
  }),
}

export const studyBlockSchema = z.discriminatedUnion(
  'type',
  Object.values(blockSchemas).map(s => s.passthrough()),
)

export const studyBlocksWriteSchema = z.array(studyBlockSchema).max(MAX_STUDY_BLOCKS)

/**
 * Read-side normaliser. Returns a clean blocks array — never throws.
 * Unknown/invalid blocks are dropped so the reader degrades gracefully.
 */
export function coerceStudyBlocks(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const b of raw) {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string') continue
    const schema = blockSchemas[b.type]
    if (!schema) continue
    const parsed = schema.passthrough().safeParse(b)
    if (parsed.success) out.push(parsed.data)
  }
  return out.slice(0, MAX_STUDY_BLOCKS)
}
