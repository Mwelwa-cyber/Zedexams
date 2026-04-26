/**
 * src/editor/schema/question.js
 *
 * Single source of truth for the shape of a quiz question.
 *
 * Two concerns:
 *   1. What a Tiptap JSON document looks like (recursive tree of nodes).
 *   2. What a full question record looks like once normalised for Firestore.
 *
 * The schema is intentionally PERMISSIVE about which Tiptap node types are
 * allowed — that's already enforced by the extension list in
 * src/editor/extensions/buildExtensions.js. This schema only guarantees the
 * SHAPE (doc root, content array, nodes have string `type`, etc.) so garbage
 * can never reach Firestore.
 *
 * Why dual-format?
 *   - Existing readers (learner, admin, preview) read `text`, `passage`,
 *     `explanation`, `sharedInstruction` as HTML strings. Changing that would
 *     break 18 files across the codebase.
 *   - Forward: we add `textJSON`, `passageJSON`, `explanationJSON`,
 *     `sharedInstructionJSON` as Tiptap JSON. New consumers prefer JSON;
 *     old consumers ignore the new fields.
 *   - Once all readers are migrated, a follow-up PR drops the HTML fields.
 *
 * `contentVersion` tracks the format:
 *     null|1 → HTML-only (legacy)
 *     2      → Tiptap JSON was migrated in memory but never persisted
 *     3      → Both HTML and JSON are present in Firestore (current target)
 */

import { z } from 'zod'

// ── Tiptap JSON shape ─────────────────────────────────────────────

/**
 * A Tiptap mark (applied to a text node): bold, italic, color, etc.
 * `type` is the extension name; `attrs` is a free-form bag.
 */
export const tiptapMark = z.object({
  type: z.string().min(1).max(40),
  attrs: z.record(z.string(), z.any()).optional(),
})

/**
 * A Tiptap node. Recursive: `content` is an array of more nodes.
 *
 * We cap:
 *   - `type` length (40) — reasonable for an extension name
 *   - `text` length (50000) — any single text run longer than this is almost
 *     certainly pasted junk or a malformed extraction from OCR.
 *   - nesting depth is NOT enforced here because Zod's recursive types make
 *     depth enforcement awkward. Depth is instead bounded by the top-level
 *     JSON size check on the assembled document (see questionSchema below).
 */
export const tiptapNode = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(40),
    attrs: z.record(z.string(), z.any()).optional(),
    content: z.array(tiptapNode).optional(),
    marks: z.array(tiptapMark).optional(),
    text: z.string().max(50000).optional(),
  })
)

/**
 * A full Tiptap document — the root shape emitted by editor.getJSON().
 * `null` is allowed for empty fields (matches current codebase convention).
 */
export const tiptapDoc = z
  .object({
    type: z.literal('doc'),
    content: z.array(tiptapNode).default([]),
  })
  .nullable()

// ── Question shape ────────────────────────────────────────────────

const QUESTION_TYPES = ['mcq', 'tf', 'short_answer', 'diagram', 'fill', 'short']
const DIFFICULTIES = ['easy', 'medium', 'hard']
// MCQ subtypes mirror the Zambian PRISCA exam-paper categories. They are a
// PURE display/preset hint — the underlying answer model is still 4-option MCQ.
const SUBTYPES = ['vocab', 'spelling', 'punctuation', 'sentence_ordering']

/**
 * The question record AFTER normalisation, ready to persist.
 * Must be backward-compatible with the 18 existing readers.
 *
 * Legacy HTML fields remain as the primary read surface:
 *   - sharedInstruction, text, passage, explanation
 *
 * New JSON fields carry the canonical format going forward:
 *   - sharedInstructionJSON, textJSON, passageJSON, explanationJSON
 *
 * The two are REDUNDANT by design during the dual-format transition.
 * Writes must populate both or Zod rejects the record.
 */
export const questionSchema = z
  .object({
    // ── Identity & meta ──
    // `id` is optional because Firestore assigns doc IDs at write time via
    // `doc(collection(...))`. When saving from the client we don't know it yet.
    id: z.string().optional(),
    type: z.enum(QUESTION_TYPES),
    detectedType: z.string().optional(),
    topic: z.string().max(200).default(''),
    marks: z.number().int().min(1).max(10),
    difficulty: z.enum(DIFFICULTIES).optional(),
    order: z.number().int().min(0).max(10000),

    // ── Rich-text: HTML (legacy, kept for read-path compat) ──
    sharedInstruction: z.string().max(100000).default(''),
    text: z.string().max(100000).default(''),
    passage: z.string().max(200000).optional(),
    explanation: z.string().max(100000).default(''),

    // ── Rich-text: Tiptap JSON (new canonical source) ──
    sharedInstructionJSON: tiptapDoc.default(null),
    textJSON: tiptapDoc.default(null),
    passageJSON: tiptapDoc.default(null),
    explanationJSON: tiptapDoc.default(null),

    // ── Answer fields ──
    options: z.array(z.string().max(1000)).max(20).default([]),
    correctAnswer: z.union([z.string().max(1000), z.number()]).default(0),

    // ── Grouping & subtype (PRISCA mock-paper format) ──
    // `partId` mirrors `passageId` — points at an entry in the quiz doc's
    // `parts[]` array when the question belongs to a numbered Part.
    // `subtype` narrows the MCQ flavour for editor-side presets (vocab,
    // spelling, punctuation, sentence-ordering). Unknown to the runner.
    subtype: z.enum(SUBTYPES).nullable().default(null),
    partId: z.string().max(64).nullable().default(null),

    // ── Misc ──
    passageId: z.string().nullable().default(null),
    imageUrl: z.string().nullable().default(null),
    diagramText: z.string().max(2000).nullable().default(null),
    requiresReview: z.boolean().default(false),
    reviewNotes: z.array(z.string().max(2000)).default([]),
    importWarnings: z.array(z.string().max(2000)).default([]),
    sourcePage: z.union([z.string(), z.number(), z.null()]).default(null),

    // ── Versioning ──
    contentVersion: z.literal(3),
  })
  // Forbid stray fields so a typo (e.g. `teext` instead of `text`) never reaches
  // Firestore. If a legitimate new field is needed, add it to the schema.
  .strict()
  // Size sanity check: after stringification the whole record must fit comfortably
  // under Firestore's 1 MiB doc limit. 500 KiB leaves room for server overhead.
  .refine(
    (q) => JSON.stringify(q).length <= 512_000,
    { message: 'Question too large — Firestore limit is 1 MiB, max safe is 512 KiB' }
  )

/**
 * Same as questionSchema but for records being WRITTEN to Firestore —
 * `id` isn't present yet (Firestore generates it).
 */
export const questionWriteSchema = questionSchema

export const QUESTION_TYPES_LIST = QUESTION_TYPES
export const DIFFICULTIES_LIST = DIFFICULTIES
export const SUBTYPES_LIST = SUBTYPES
