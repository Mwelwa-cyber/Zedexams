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

// ── Diagram-library reference shape ───────────────────────────────

/**
 * A reference to a parametrised diagram in the catalog
 * (src/components/diagrams/diagramCatalog.js). The renderer looks up the
 * entry by `libraryKey` and merges these `params` on top of the entry's
 * defaults. Stored as pure data so the teacher can re-open the picker
 * later and tweak labels.
 *
 * Why not store an SVG string? Two reasons:
 *   1. Catalog entries can be improved (better strokes, fixed bugs in the
 *      SVG markup) and every saved diagram benefits without a re-save.
 *   2. The teacher can re-edit labels without re-picking the shape.
 */
export const diagramRef = z
  .object({
    libraryKey: z.string().min(1).max(40),
    // Param values are free-form strings — the catalog render functions
    // coerce numerics as needed (e.g. parseFloat for number-line bounds).
    // Cap each value so a pasted essay can't bloat the doc.
    params: z.record(z.string().max(64), z.string().max(2000)).default({}),
  })
  .strict()

// ── Question shape ────────────────────────────────────────────────

const QUESTION_TYPES = ['mcq', 'tf', 'short_answer', 'diagram', 'fill', 'short', 'numeric', 'hotspot']
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
    // Option strings can hold either plain text (legacy) or a stringified
    // Tiptap JSON document (the same dual-format convention `text` uses).
    // 5000 chars is the practical ceiling: a serialised Tiptap doc for a
    // typical Grade-7 option (with a fraction, sup/sub, or number-base
    // node) runs 300–1500 bytes; 5000 gives ~3× headroom without letting
    // a teacher accidentally paste a 10-paragraph passage into Option A
    // (20 questions × 4 options × 5000 = 400 KB — well under Firestore's
    // 1 MB per-doc cap, with room to spare for the rest of the schema).
    options: z.array(z.string().max(5000)).max(20).default([]),
    // `correctAnswer` is either a numeric index into `options` (MCQ)
    // OR a short string for fill-in-the-blank / short-answer (compared
    // string-for-string by the runner). Keep this tight — a multi-KB
    // "correct answer" string would never match a learner's typed
    // response and indicates corrupt data, not a legitimate use case.
    correctAnswer: z.union([z.string().max(1000), z.number()]).default(0),

    // ── Numeric-answer fields ──
    // `tolerance` is the maximum absolute difference accepted as a correct
    // answer for `type: 'numeric'`. Set to 0 for exact-match. Ignored
    // entirely for all other question types — kept optional + nullable so
    // legacy docs without the field still parse cleanly.
    //
    // Worked example: `correctAnswer: 3.14`, `tolerance: 0.01` accepts any
    // typed answer in the range [3.13, 3.15].
    tolerance: z.number().min(0).max(1_000_000).nullable().default(null),

    // ── Hotspot-answer field ──
    // Normalised coordinates of the target region on the question's image
    // (or library diagram). x, y, radius are all in [0, 1] where (0, 0) is
    // top-left of the image and (1, 1) is bottom-right. Normalising means
    // the grading works correctly regardless of the screen size the
    // learner is on. Radius is normalised to the image's WIDTH (and the
    // editor renders it on the displayed image at the same proportion).
    //
    // Worked example: a heart-diagram labelling question targets the
    // right ventricle at the centre of the image with a 10% radius:
    //   { x: 0.5, y: 0.5, radius: 0.1 }
    //
    // Required for `type: 'hotspot'` (enforced in the superRefine below);
    // null on every other type.
    correctRegion: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        radius: z.number().min(0).max(0.5),
      })
      .nullable()
      .default(null),

    // Parallel, index-aligned media for each option. A `null` entry means the
    // option is text-only (the original shape). Stored as a separate array so
    // every existing reader of `options[i]` (the AI grader, Firestore rules,
    // the editor's text inputs) keeps working untouched. Renderers that opt
    // into media options read `optionMedia[i]` alongside `options[i]`.
    //
    // Each slot may hold an uploaded `imageUrl` (PR1), a library `diagram`
    // (PR2), or both (the renderer prefers the diagram if present). `alt` is
    // required whenever any media is set — accessibility plus the grader
    // uses it to know what the option represents.
    optionMedia: z
      .array(
        z.union([
          z.null(),
          z.object({
            imageUrl: z.string().min(1).max(2000).optional(),
            diagram: diagramRef.optional(),
            alt: z.string().min(1).max(2000),
          })
            .strict()
            .refine(
              o => Boolean(o.imageUrl) || Boolean(o.diagram),
              { message: 'Option media needs either an imageUrl or a diagram' },
            ),
        ])
      )
      .max(20)
      .default([]),

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
    // A library-diagram alternative to `imageUrl`. The two are not mutually
    // exclusive at the schema level — the renderer prefers the diagram when
    // both are set. Legacy docs have no `imageDiagram` field; renderer falls
    // back to `imageUrl`-only behaviour.
    imageDiagram: diagramRef.nullable().default(null),
    // Where the question's image sits relative to the question text.
    // `null` (or absent on legacy docs) → renderer falls back to 'above',
    // which is the only behaviour that existed before this field was added.
    imagePosition: z.enum(['above', 'below', 'left', 'right', 'inline']).nullable().default(null),
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
  // optionMedia must never be longer than options — they're index-aligned.
  // (A shorter optionMedia is fine; missing entries read as text-only.)
  .superRefine((q, ctx) => {
    if (q.optionMedia.length > q.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionMedia'],
        message: 'optionMedia must not be longer than options',
      })
    }

    // Numeric questions need a finite numeric correctAnswer (so the grader
    // can take an absolute difference) and conventionally have no options.
    // A string correctAnswer here would silently fail to grade anything,
    // which is exactly the kind of "feels broken in production" failure
    // we want to catch at write time.
    if (q.type === 'numeric') {
      if (typeof q.correctAnswer !== 'number' || !Number.isFinite(q.correctAnswer)) {
        ctx.addIssue({
          code: 'custom',
          path: ['correctAnswer'],
          message: 'numeric question requires a finite numeric correctAnswer',
        })
      }
      if (q.options.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'numeric questions should not have options — set type to mcq for that',
        })
      }
    }

    // Hotspot questions need a target region AND an image — without one
    // the learner has nothing to click on. Reject loudly so the editor
    // can surface a clear error instead of writing a useless quiz.
    if (q.type === 'hotspot') {
      if (!q.correctRegion) {
        ctx.addIssue({
          code: 'custom',
          path: ['correctRegion'],
          message: 'hotspot question requires a correctRegion (place a target on the image first)',
        })
      }
      if (!q.imageUrl && !q.imageDiagram) {
        ctx.addIssue({
          code: 'custom',
          path: ['imageUrl'],
          message: 'hotspot question requires an image (upload or pick a diagram from the library)',
        })
      }
      if (q.options.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'hotspot questions should not have options',
        })
      }
    }
  })
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

// ── Coerce helper (read-side, never throws) ──────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Normalise a raw Firestore question document for safe consumption by the
 * UI + the grader.
 *
 * Sibling of coerceQuiz / coerceAttempt — see src/schemas/quiz.js + attempt.js
 * for the established pattern. Same asymmetry: writes are strict, reads are
 * permissive so legacy/partial docs already in Firestore don't blank the UI.
 *
 * Guarantees on the returned object:
 *   - `type` is one of QUESTION_TYPES (unknown legacy values fall back to 'mcq')
 *   - `options` is always an array of strings
 *   - `optionMedia` is always an array (entries may be null)
 *   - `marks` is a finite integer ≥ 1 (legacy `marks: NaN` no longer crashes
 *     the runner's score totaller)
 *   - `tolerance` is null OR a finite ≥0 number (the numericGrading helper
 *     already defends, but defending here too keeps a corrupt doc out of
 *     downstream score arithmetic)
 *   - `correctRegion` is null OR a well-shaped { x, y, radius } object
 *   - HTML + JSON rich-text fields are always strings/null (never undefined)
 *
 * Returns null when the input isn't an object — callers should
 * `.filter(Boolean)` when mapping a query snapshot.
 */
export function coerceQuestion(raw) {
  if (!isPlainObject(raw)) return null

  const type = QUESTION_TYPES.includes(raw.type) ? raw.type : 'mcq'

  const options = Array.isArray(raw.options)
    ? raw.options.map(o => (typeof o === 'string' ? o : String(o ?? '')))
    : []

  const optionMedia = Array.isArray(raw.optionMedia)
    ? raw.optionMedia.map(m => (isPlainObject(m) ? m : null))
    : []

  const rawMarks = Number(raw.marks)
  const marks = Number.isFinite(rawMarks) && rawMarks >= 1
    ? Math.min(10, Math.floor(rawMarks))
    : 1

  const rawTolerance = Number(raw.tolerance)
  const tolerance = raw.tolerance == null
    ? null
    : Number.isFinite(rawTolerance) && rawTolerance >= 0
      ? rawTolerance
      : null

  let correctRegion = null
  if (isPlainObject(raw.correctRegion)) {
    const x = Number(raw.correctRegion.x)
    const y = Number(raw.correctRegion.y)
    const r = Number(raw.correctRegion.radius)
    if (
      Number.isFinite(x) && x >= 0 && x <= 1 &&
      Number.isFinite(y) && y >= 0 && y <= 1 &&
      Number.isFinite(r) && r >= 0 && r <= 0.5
    ) {
      correctRegion = { x, y, radius: r }
    }
  }

  return {
    ...raw,
    type,
    options,
    optionMedia,
    marks,
    tolerance,
    correctRegion,
  }
}

export const QUESTION_TYPES_LIST = QUESTION_TYPES
export const DIFFICULTIES_LIST = DIFFICULTIES
export const SUBTYPES_LIST = SUBTYPES
