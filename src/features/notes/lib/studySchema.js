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

export const MAX_STUDY_BLOCKS = 200

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
  picture:    z.object({ id: str.optional(), type: z.literal('picture'),    caption: str, lines: strArr }),
  image:      z.object({ id: str.optional(), type: z.literal('image'),      url: str, caption: str.optional().default('') }),
  quickcheck: z.object({ id: str.optional(), type: z.literal('quickcheck'), q: str, a: str, level: str.optional().default('') }),
  exam:       z.object({ id: str.optional(), type: z.literal('exam'),       q: str, a: str }),
  mistake:    z.object({ id: str.optional(), type: z.literal('mistake'),    wrong: str, correct: str }),
  quiz:       z.object({ id: str.optional(), type: z.literal('quiz'),       quizId: str.optional().default(''), quizTitle: str.optional().default(''), questionCount: z.number().int().nullable().optional() }),
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
