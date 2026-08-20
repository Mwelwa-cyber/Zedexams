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
import {
  QUESTION_TYPES,
  canonicalizeQuestionType,
  questionTypeLabel,
  QUESTION_TYPE_LABELS,
  normalizeMarks,
  MARKS_BOUNDS,
} from '../../utils/questionType.js'
import { hydrateTableData } from '../../utils/tableData.js'
import { ACTIVITY_IDS as QUESTION_ACTIVITY_IDS } from '../../config/questionActivities.js'

// The canonical question-type helpers now live in src/utils/questionType.js
// (the single source of truth shared by the editor, importers, scorer, and
// exporters). Re-export them here so the many modules that import them from this
// schema file keep working unchanged.
export { canonicalizeQuestionType, questionTypeLabel, QUESTION_TYPE_LABELS }

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
 * (src/curriculum/diagrams/diagramCatalog.js). The renderer looks up the
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

const DIFFICULTIES = ['easy', 'medium', 'hard']
// Bloom's revised taxonomy, lower-order → higher-order. An optional cognitive
// level the teacher tags so the studio can show the spread of thinking skills.
const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']
// MCQ subtypes mirror the Zambian PRISCA exam-paper categories. They are a
// PURE display/preset hint — the underlying answer model is still 4-option MCQ.
const SUBTYPES = ['vocab', 'spelling', 'punctuation', 'sentence_ordering']
// Per-question rollup of the shared Document Understanding Engine's structural
// verdict. 'ok' = passed; 'warning' = imported but has a soft issue (e.g. an
// [UNCLEAR] span, no answer key); 'error' = a hard problem (e.g. an MCQ missing
// an option). Kept in sync with functions/documentEngine/validationEngineCore.js
// via scripts/test-document-engine-parity.mjs.
const VALIDATION_STATUSES = ['ok', 'warning', 'error']

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
    // Cap raised from 10 to 20 so legitimate past-paper questions (the
    // ECZ end-of-section "long answer" items can be 10-20 marks) survive
    // import without auto-save throwing "Invalid input at 'marks'". The
    // editor's clampInt() and the importer's marksMatch clamp keep the
    // value inside this range for typed input and `[N marks]` text matches.
    marks: z.number().int().min(MARKS_BOUNDS.quiz.min).max(MARKS_BOUNDS.quiz.max),
    difficulty: z.enum(DIFFICULTIES).optional(),
    // Optional Bloom's cognitive level the teacher tags (no inference — a
    // question is only counted as a level once explicitly set).
    bloom: z.enum(BLOOM_LEVELS).optional(),
    // The ACTIVITY the question is — "tracing", "picture_matching", or simply
    // its own type for a plain question. Distinct from `type`, which is only the
    // render structure that carries it. Validated against the activity registry
    // so a typo cannot invent an activity, and optional so every existing
    // question stays valid under .strict().
    activityType: z.enum(QUESTION_ACTIVITY_IDS).optional(),
    // The syllabus outcome the question targets. Free text because it is quoted
    // from the curriculum module, not chosen from an enum — but bounded, and
    // optional so every existing question stays valid under .strict().
    learningOutcome: z.string().max(300).optional(),
    // ── CBC curriculum tagging + import provenance ──
    // These sit alongside `topic` (already above) so an imported past-paper
    // question can carry its full CBC placement, and the shared Document
    // Understanding Engine can stamp how confident it was and whether the
    // question passed structural validation. All default to a neutral value so
    // legacy docs + hand-authored questions never carry surprising data and the
    // auto-save loop can't fail mid-edit on a missing field.
    subtopic: z.string().max(200).default(''),
    competency: z.string().max(200).default(''),
    specificOutcome: z.string().max(500).default(''),
    curriculum: z.string().max(100).default(''),
    // 0..1 confidence the importer/OCR attaches to this question (null = not
    // set, e.g. hand-authored). Nullable so the editor can clear it back to
    // "unknown" rather than implying a false 0.
    aiConfidence: z.number().min(0).max(1).nullable().default(null),
    // Rollup of the validation engine's verdict for this card, surfaced as a
    // status chip in the editor. 'ok' on legacy/hand-authored questions.
    validationStatus: z.enum(VALIDATION_STATUSES).default('ok'),
    order: z.number().int().min(0).max(10000),

    // ── Past-paper quiz coaching (spec §4.1) ──
    //
    // What practice mode says AFTER a learner has answered: why the right
    // answer is right, why the option THEY picked is wrong, and something to
    // remember it by. Every field is optional, so every question written
    // before this existed stays valid under `.strict()` — and this schema is
    // strict, which is why they have to be declared here at all: a teacher
    // opening a coached question in the quiz editor would otherwise fail to
    // save it, on a field they never touched and cannot see.
    //
    // `explanationStatus` is the gate the whole feature turns on. Only
    // 'approved' lets prose reach a child (functions/shared/paperQuiz/
    // explanationGate.js), and the enum lives THERE rather than being
    // duplicated here as a z.enum: the gate reads any unrecognised value as
    // `missing` and shows the answer alone, so the browser, the server and
    // this schema cannot disagree about what counts as approved. Defaulted to
    // 'missing' rather than left undefined so an unexplained question says so
    // rather than being silent about it.
    //
    // Field-level bounds are HERE and not in firestore.rules on purpose. See
    // the ⚠️ EXPRESSION BUDGET note above `validQuestionFields` — a previous
    // version of that function validated ~35 fields and every scanned
    // past-paper import started failing to save with an opaque permissions
    // error once a real question crossed the 1000-expression cap.
    explanationStatus: z.enum(['missing', 'ai_draft', 'approved']).default('missing'),
    // ≤ 40 words (§6). The character cap is the backstop; the word limit is
    // the drafter's and the reviewer's job.
    why: z.string().max(2000).default(''),
    // Keyed by option LETTER — {A: '…', C: '…'} — which is what an author
    // writes and what the marking scheme uses. The panel converts from the
    // index it holds, so "why C is wrong" is scoped to the option the learner
    // actually picked rather than to a generic wrong one.
    distractors: z.record(z.string().max(2), z.string().max(1500)).default({}),
    // A worked line or a memory hook ("one collar, two sleeves"), never a rule
    // restated.
    example: z.string().max(2000).default(''),
    // The stable id topic mastery is keyed on (§4.3). Falls back to `topic`
    // when absent, so a paper authored before this existed still contributes.
    topicId: z.string().max(120).default(''),
    // Where to send a learner who wants more: the note for this topic, and a
    // game that covers it. Curriculum LINKS rather than generated prose, which
    // is why the explanation gate does not strip them.
    noteRef: z.string().max(200).default(''),
    gameSlug: z.string().max(80).default(''),
    // Who approved the prose, and when. Written only by the studio's review
    // queue (server-side); the editor never sets them.
    approvedBy: z.string().max(128).default(''),
    approvedAt: z.any().nullable().default(null),

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

    // ── Assessment-paper answer fields (numeric / matching / sequence) ──
    // These power the Assessment Studio's essay/numeric/matching/sequence
    // blocks and their printed marking keys. They're OPTIONAL (not
    // `.default([])`) so a question that isn't one of these types simply
    // omits them rather than writing empty arrays to every Firestore doc.
    //
    // `numericTolerance` / `numericUnit` are the assessment-side numeric
    // fields (the learner-quiz path uses `tolerance` above; the persistence
    // layer keeps both in sync for numeric questions).
    numericTolerance: z.number().min(0).max(1_000_000).optional(),
    numericUnit: z.string().max(40).optional(),
    // `matchingLeft[i]` pairs with `matchingRight[matchingAnswer[i]]`.
    matchingLeft: z.array(z.string().max(500)).max(20).optional(),
    matchingRight: z.array(z.string().max(500)).max(20).optional(),
    matchingAnswer: z.array(z.number().int().min(-1).max(20)).max(20).optional(),
    // `sequenceItems` shown to the learner; `sequenceAnswer[i]` is the 1-based
    // position item i belongs in (0 = unset). The pre-publish checklist
    // (collectQuizIssues) enforces a complete permutation before save.
    sequenceItems: z.array(z.string().max(500)).max(20).optional(),
    sequenceAnswer: z.array(z.number().int().min(0).max(20)).max(20).optional(),

    // Parallel, index-aligned media for each option. A `null` entry means the
    // option is text-only (the original shape). Stored as a separate array so
    // every existing reader of `options[i]` (the AI grader, Firestore rules,
    // the editor's text inputs) keeps working untouched. Renderers that opt
    // into media options read `optionMedia[i]` alongside `options[i]`.
    //
    // Each slot may hold an uploaded `imageUrl`, a library `diagram`, or both
    // (the renderer prefers the diagram if present).
    //
    // `alt` is required for accessibility + the AI grader, but only at
    // PUBLISH time. The pre-publish checklist (collectQuizIssues) is the
    // canonical enforcement layer — it surfaces every image-without-alt as
    // a blocking issue. We can't reject empty alt at the schema level
    // because auto-save fires every few seconds while the teacher is still
    // typing in the alt field; rejecting "image uploaded, alt half-typed"
    // would make every image option crash the auto-save loop and the
    // teacher would lose the uploaded URL on reload.
    optionMedia: z
      .array(
        z.union([
          z.null(),
          z.object({
            imageUrl: z.string().min(1).max(2000).optional(),
            diagram: diagramRef.optional(),
            alt: z.string().max(2000).default(''),
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
    // Alt-text description for the question image — read by screen readers in
    // the exported paper and supplied to the AI marker as context for the
    // figure. Empty string when no image or no description has been written.
    imageAlt: z.string().max(2000).default(''),
    // A library-diagram alternative to `imageUrl`. The two are not mutually
    // exclusive at the schema level — the renderer prefers the diagram when
    // both are set. Legacy docs have no `imageDiagram` field; renderer falls
    // back to `imageUrl`-only behaviour.
    imageDiagram: diagramRef.nullable().default(null),
    // Where the question's image sits relative to the question text.
    // `null` (or absent on legacy docs) → renderer falls back to 'above',
    // which is the only behaviour that existed before this field was added.
    imagePosition: z.enum(['above', 'below', 'left', 'right', 'inline']).nullable().default(null),
    // How wide the question image renders, as a friendly preset (resolved to a
    // percentage of the content width by the studio preview and the PDF / DOCX
    // exporters). Absent on legacy docs → renderer falls back to full width.
    imageWidth: z.enum(['small', 'medium', 'large', 'full']).default('full'),
    // Additional figures beyond the primary `imageUrl`, rendered STACKED BELOW
    // it. Populated when a scanned question has more than one detected figure
    // (the importer keeps the largest as `imageUrl` and the rest here). Each
    // carries its own url/alt/width; the inner object strips unknown keys, so a
    // transient import-only `imageAssetId` is dropped on parse. Empty on the
    // overwhelming majority of questions, so legacy/single-image docs are
    // unaffected.
    images: z
      .array(
        z.object({
          url: z.string(),
          alt: z.string().max(2000).default(''),
          width: z.enum(['small', 'medium', 'large', 'full']).default('full'),
        }),
      )
      .max(6)
      .default([]),
    diagramText: z.string().max(2000).nullable().default(null),

    // ── Diagram label overlays / inline table / drawing canvas ──
    // Power the Assessment Studio's labelled-diagram, image-identify,
    // data-table and draw-&-label questions. All optional (absent on plain
    // questions) so legacy docs and MCQs don't carry empty values.
    //   diagramLabels — draggable labels on the question image. x/y are 0..1
    //                   ratios of the image so they stay anchored across the
    //                   preview / PDF / DOCX renderers.
    //                   tx/ty (optional) are the 0..1 ratio coordinates of the
    //                   PART the label points at. When present the renderer
    //                   draws a leader line from the label box (x,y) to the
    //                   part (tx,ty) — so a label POINTS at the part instead of
    //                   sitting on top of it. Absent on legacy labels and on
    //                   maths-dimension figures, where the text sits in place.
    //   diagramMode   — 'labeled' prints the label text on the image;
    //                   'identify' prints numbers and the student names each.
    //   tableData     — inline table { headers[], rows[][] }.
    //   drawingHeight — blank Draw & Label canvas height in points.
    diagramLabels: z
      .array(
        z.object({
          id: z.string().max(64).optional(),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          tx: z.number().min(0).max(1).optional(),
          ty: z.number().min(0).max(1).optional(),
          text: z.string().max(80).default(''),
        }).strict()
      )
      .max(20)
      .optional(),
    diagramMode: z.enum(['labeled', 'identify']).optional(),
    //   NOTE the persisted rows shape: Firestore rejects nested arrays, so a
    //   row is stored as { cells: [...] } rather than a bare array. The editor
    //   holds rows as string[][]; src/utils/tableData.js folds/unfolds at the
    //   write/read boundaries. (The old rows: [[...]] schema shape could never
    //   actually reach Firestore — every data-table save threw "Nested arrays
    //   are not supported" in the SDK before the write left the browser.)
    //   Caps are 10 × 16 (not the hand-editor's 6 × 12) because reconstructed
    //   scan tables — e.g. a school timetable — legitimately run 7-8 columns.
    //   This schema deliberately accepts ONLY the persisted { cells } shape:
    //   the single parse gateway is normalizeQuestionPayload
    //   (src/utils/questionWritePayload.js), which calls serializeTableData
    //   BEFORE the safeParse, so an in-memory string[][] table never reaches
    //   this validator. Rejecting bare nested arrays here is a feature — it
    //   keeps the Firestore "Nested arrays are not supported" crash out of
    //   any future write path that skips the fold.
    tableData: z
      .object({
        headers: z.array(z.string().max(60)).max(10).default([]),
        rows: z
          .array(
            z.object({ cells: z.array(z.string().max(60)).max(10).default([]) }).strict()
          )
          .max(16)
          .default([]),
      })
      .strict()
      .nullable()
      .optional(),
    drawingHeight: z.number().int().min(80).max(500).nullable().optional(),

    // ── Answer-space settings (stimulus / structured sub-questions) ──
    // How much blank space prints under the question. 'lines' renders N ruled
    // lines, 'none' renders nothing (answered on the diagram), 'labelled_blanks'
    // renders one "Label: ____" row per `blankLabels` entry. Absent on legacy
    // docs → renderer falls back to the per-type default line count.
    answerFormat: z.enum(['lines', 'none', 'labelled_blanks']).optional(),
    // Explicit ruled-line count for the 'lines' format. Null/absent → per-type
    // default. Capped well above any sane hand-set value.
    answerLines: z.number().int().min(0).max(40).nullable().optional(),
    // Labels for the 'labelled_blanks' format, e.g. ['P','Q','R'].
    blankLabels: z.array(z.string().max(24)).max(26).optional(),
    // Optional word bank printed above the answer space (candidate answers the
    // student chooses from). Used by structured / stimulus sub-questions AND
    // the dedicated Fill-in-the-Blanks type (`type: 'fill_blanks'`).
    wordBank: z.array(z.string().max(120)).max(40).optional(),
    // Whether the word bank's words may be reused across blanks. Only
    // meaningful for `type: 'fill_blanks'`; a display/marking hint, not
    // enforced at grade time. Absent on legacy docs → treated as false.
    wordBankReuse: z.boolean().optional(),
    // Dedicated Fill-in-the-Blanks statements. Each statement prints on its
    // own line as "A. … ____ …" and carries the expected answer for each of
    // its blanks (index-aligned to the underscore runs in `text`). Only
    // present on `type: 'fill_blanks'` questions, so it stays optional and a
    // plain MCQ never carries an empty array (keeps the .strict() schema lean
    // and the doc small).
    statements: z
      .array(
        z.object({
          text: z.string().max(2000).default(''),
          answers: z.array(z.string().max(200)).max(12).default([]),
        }).strict()
      )
      .max(40)
      .optional(),

    // Short-answer SUB-PARTS — the "(a) … (b) … (c) …" structure under one
    // instruction stem (the question's `text`). Each part has its own sentence,
    // model answer, marks and answer-space format. The question's `marks`
    // auto-sum the parts. Only present on multi-part short-answer questions, so
    // it stays optional (keeps the .strict() schema lean for every other type).
    subParts: z
      .array(
        z.object({
          text: z.string().max(2000).default(''),
          answer: z.string().max(1000).default(''),
          marks: z.number().int().min(0).max(99).default(1),
          answerFormat: z.enum(['inline', 'lines', 'none']).default('inline'),
          answerLines: z.number().int().min(0).max(20).nullable().optional(),
        }).strict()
      )
      .max(12)
      .optional(),

    requiresReview: z.boolean().default(false),
    reviewNotes: z.array(z.string().max(2000)).default([]),
    importWarnings: z.array(z.string().max(2000)).default([]),
    sourcePage: z.union([z.string(), z.number(), z.null()]).default(null),
    // The PRINTED question number on the source paper (e.g. 47), as read by the
    // importer. Distinct from `sourcePage`, whose meaning varies by import path
    // (page index for scans, question number for the server past-paper import).
    // Drives the Document Understanding Engine's numbering analysis (missing /
    // duplicate / out-of-order) in the editor — including after a reload.
    // null for hand-authored questions and papers with no usable numbering.
    sourceQuestionNumber: z.number().int().min(1).max(9999).nullable().default(null),
    // Where this question's OWN printed figure sits on the uploaded source
    // paper (importer-written): 1-based page + an optional {x,y,w,h}
    // fractional crop box. Feeds the editor's "Crop from page" (which page to
    // open, and the AI-detected initial crop rectangle). Optional so every
    // existing question stays valid under .strict(); only written when the
    // importer located a figure.
    figureMeta: z
      .object({
        sourcePage: z.number().int().min(1).max(9999).nullable().default(null),
        box: z
          .object({
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
          })
          .strict()
          .nullable()
          .default(null),
      })
      .strict()
      .optional(),
    // Lineage for a question inserted from the Central Question Bank: the
    // questionBank doc id it was deep-cloned from. Present only on bank-sourced
    // copies (hand-authored / imported / AI questions omit it). Lets the bank's
    // usage analytics and future de-dup trace a paper question back to its source.
    sourceBankId: z.string().max(64).optional(),

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
 * Sibling of coerceQuiz / coerceAttempt — see src/shared/schemas/quiz.js + attempt.js
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

  // Fold known aliases ('truefalse' → 'tf', etc.) before the enum check so a
  // legacy/aliased doc reads back as its true type rather than collapsing to
  // 'mcq'. Anything still outside the enum falls back to 'mcq'.
  const canonicalType = canonicalizeQuestionType(raw.type)
  const type = QUESTION_TYPES.includes(canonicalType) ? canonicalType : 'mcq'

  const options = Array.isArray(raw.options)
    ? raw.options.map(o => (typeof o === 'string' ? o : String(o ?? '')))
    : []

  const optionMedia = Array.isArray(raw.optionMedia)
    ? raw.optionMedia.map(m => (isPlainObject(m) ? m : null))
    : []

  // Additional stacked figures. Drop invalid entries, default alt/width, and
  // strip any transient import-only keys (e.g. imageAssetId) so only the
  // persisted shape ({ url, alt, width }) survives.
  const images = Array.isArray(raw.images)
    ? raw.images
        .filter(im => isPlainObject(im) && typeof im.url === 'string' && im.url)
        .map(im => ({
          url: im.url,
          alt: typeof im.alt === 'string' ? im.alt : '',
          width: ['small', 'medium', 'large', 'full'].includes(im.width) ? im.width : 'full',
        }))
    : []

  // Cap mirrors the write schema's `marks: z.number().int().min(1).max(20)`.
  // normalizeMarks (src/utils/questionType.js) is the single shared marks
  // policy: it used to clamp at 10 here, which silently truncated legitimate
  // 11–20 mark past-paper questions on read-back even though they saved fine.
  const marks = normalizeMarks(raw.marks, MARKS_BOUNDS.quiz)

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

  // CBC tagging + import provenance — coerce to safe shapes so a legacy or
  // partially-broken doc never blanks the editor. Strings fall back to '';
  // aiConfidence clamps to [0,1] or null; validationStatus falls back to 'ok'.
  const str = (v, max) => {
    if (v == null) return ''
    const s = typeof v === 'string' ? v : String(v)
    return s.length > max ? s.slice(0, max) : s
  }
  const rawConfidence = Number(raw.aiConfidence)
  const aiConfidence = raw.aiConfidence == null || !Number.isFinite(rawConfidence)
    ? null
    : Math.max(0, Math.min(1, rawConfidence))
  const validationStatus = VALIDATION_STATUSES.includes(raw.validationStatus)
    ? raw.validationStatus
    : 'ok'
  const rawSourceNumber = Number(raw.sourceQuestionNumber)
  const sourceQuestionNumber =
    Number.isInteger(rawSourceNumber) && rawSourceNumber >= 1 && rawSourceNumber <= 9999
      ? rawSourceNumber
      : null

  return {
    ...raw,
    type,
    options,
    optionMedia,
    images,
    marks,
    tolerance,
    correctRegion,
    // Unfold the persisted { cells } rows back to the renderer's string[][]
    // shape (see src/utils/tableData.js). Docs without a table keep null.
    tableData: hydrateTableData(raw.tableData),
    subtopic: str(raw.subtopic, 200),
    competency: str(raw.competency, 200),
    specificOutcome: str(raw.specificOutcome, 500),
    curriculum: str(raw.curriculum, 100),
    aiConfidence,
    validationStatus,
    sourceQuestionNumber,
  }
}

export const QUESTION_TYPES_LIST = QUESTION_TYPES
export const DIFFICULTIES_LIST = DIFFICULTIES
export const BLOOM_LEVELS_LIST = BLOOM_LEVELS
export const SUBTYPES_LIST = SUBTYPES
export const VALIDATION_STATUSES_LIST = VALIDATION_STATUSES
