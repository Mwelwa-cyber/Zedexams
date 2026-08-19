/**
 * src/utils/questionWritePayload.js
 *
 * The single question-write normaliser shared by every quiz/assessment save
 * path (see useFirestore.js: saveQuestions, saveAssessmentQuestions,
 * updateQuizWithQuestions, updateAssessmentWithQuestions).
 *
 * Extracted from useFirestore.js so it can be exercised by tests (the
 * Firestore-rules emulator suite replays REAL editor payloads through this
 * exact function) without dragging in firebase/config — this module is pure:
 * no Firestore imports, no side effects.
 */

import { questionWriteSchema } from '../editor/schema/question.js'
import { normalizeMarks, MARKS_BOUNDS, canonicalizeQuestionType } from './questionType.js'
import { normalizeSubParts } from './questionParts.js'
import { normaliseImageWidth } from './imageWidth.js'
import { serializeTableData } from './tableData.js'

/**
 * The rich-text write pipeline — `migrateContent` (HTML/legacy → Tiptap JSON)
 * and `normalizeRichTextPayload` (sanitised canonical HTML) — lives in the
 * editor runtime, which statically pulls @tiptap/core + ProseMirror + KaTeX
 * (~1.5 MB). It is only needed when SAVING question content, yet useFirestore
 * is imported by ~36 components, so importing it at module scope hoisted the
 * entire editor into the eager `index` chunk — every learner downloaded it on
 * first paint. Loading it lazily (memoised, fetched once) keeps the editor out
 * of the entry chunk; the save path awaits normalizeQuestionPayload(), which
 * resolves this before it touches any rich-text field. See vite.config.js.
 */
let _writePipelinePromise
function loadWritePipeline() {
  if (!_writePipelinePromise) {
    _writePipelinePromise = Promise.all([
      import('../editor/utils/migration.js'),
      import('./quizRichText.js'),
      import('./quizEngineAdapter.js'),
    ]).then(([migration, quizRichText, quizEngineAdapter]) => ({
      migrateContent: migration.migrateContent,
      normalizeRichTextPayload: quizRichText.normalizeRichTextPayload,
      questionValidationStatus: quizEngineAdapter.questionValidationStatus,
    }))
  }
  return _writePipelinePromise
}

/**
 * Coerce a diagram-ref `params` bag into the shape Zod expects: a record of
 * `string -> string`. Anything not stringifiable is dropped; absurdly long
 * values are truncated to the schema cap so we fail loudly on the form, not
 * silently on the write.
 */
function normalizeDiagramParams(params) {
  if (!params || typeof params !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof key !== 'string' || !key) continue
    if (value == null) continue
    const stringValue = typeof value === 'string' ? value : String(value)
    out[key.slice(0, 64)] = stringValue.slice(0, 2000)
  }
  return out
}

/**
 * The ADDITIONAL figures a question carries beside its primary `imageUrl` —
 * the stacked `images[]` a multi-figure scanned question produces.
 *
 * This normaliser was missing entirely, and because `questionSchema` gives
 * `images` a `.default([])`, its absence did not present as a dropped field:
 * every save wrote an empty array over whatever was stored. So a question
 * that HAD extra figures lost them on the next autosave, silently, while the
 * read side (`coerceQuestion`), the paper layout, three learner runners and
 * the Storage-cleanup cascade all went on expecting the field to be there.
 *
 * Entries without a usable `url` are dropped rather than written as empty
 * slots — the renderers already filter on exactly that, so an entry they
 * would never draw has no reason to reach Firestore.
 *
 * The `.max(6)` cap is applied by SLICING rather than by letting Zod throw.
 * A teacher whose scanned page yielded a seventh figure did not choose that
 * and cannot act on a validation error about it, and turning a save that
 * currently succeeds into one that fails is a worse trade than keeping the
 * six the schema admits. Unknown keys (a transient `imageAssetId`) are left
 * for the schema's inner object to strip.
 */
function normalizeExtraImages(images) {
  if (!Array.isArray(images)) return []
  return images
    .filter(img => img && typeof img === 'object' && typeof img.url === 'string' && img.url.trim())
    .slice(0, 6)
    .map(img => ({
      url: img.url.trim(),
      alt: String(img.alt ?? '').trim().slice(0, 2000),
      width: normaliseImageWidth(img.width),
    }))
}

/**
 * Normalise a question for Firestore, emitting the dual HTML+JSON format
 * (contentVersion: 3).
 *
 * Readers that only know about HTML fields keep working unchanged.
 * New readers can prefer the *JSON fields for lossless rendering.
 *
 * Zod validates the complete record before we hand it to Firestore so a typo
 * in a field name, an over-size payload, or an invalid question type fails
 * loudly on the client instead of silently writing garbage.
 */
export async function normalizeQuestionPayload(q, order) {
  // Lazily fetch the editor-backed rich-text helpers (see loadWritePipeline).
  // The promise is memoised, so this resolves instantly after the first call.
  const { migrateContent, normalizeRichTextPayload, questionValidationStatus } = await loadWritePipeline()
  // Convert a rich-text field to its Tiptap JSON for persistence. null/empty →
  // null; HTML/plain string or Tiptap JSON → migrateContent handles every case.
  const toRichTextJSON = (value) => {
    if (value == null) return null
    if (typeof value === 'string' && !value.trim()) return null
    return migrateContent(value)
  }
  // Fold known type aliases onto the schema enum BEFORE deriving the per-type
  // flags below, so a question authored as 'truefalse' (QuizSectionsEditor, the
  // document importer) or 'fill_in_blank' (Assessment Studio picker) saves as
  // 'tf' / 'fill_blanks' instead of throwing "Invalid question payload at 'type'"
  // — the bug where MCQ questions save but true/false ones silently fail.
  const type = canonicalizeQuestionType(q.type) || 'mcq'
  // Short-answer / diagram / essay collect a written response, not an option
  // list — no options array, correctAnswer is a (possibly blank) string.
  const isShortAnswer = type === 'short_answer' || type === 'diagram' || type === 'essay'
  // Numeric questions also have no options array — they collect a single
  // typed number from the learner instead. Treated alongside short-answer
  // for option-clearing; correctAnswer normalisation diverges below.
  const isNumeric = type === 'numeric'
  // Hotspot questions present an image and capture a click — also no
  // options array. The "answer" is a normalised (x, y) coordinate, graded
  // against the teacher-placed correctRegion at submit time.
  const isHotspot = type === 'hotspot'
  // Matching / sequence carry their answer in dedicated arrays
  // (matchingAnswer / sequenceAnswer); they have no options either.
  const isMatching = type === 'matching'
  const isSequence = type === 'sequence'
  // Fill-in-the-Blanks stores its prompt/answer in dedicated `statements[]`
  // (each with its own answers) + an optional `wordBank`; no options array and
  // correctAnswer is an (often empty) string, like short-answer.
  const isFillBlanks = type === 'fill_blanks'
  const noOptions = isShortAnswer || isNumeric || isHotspot || isMatching || isSequence || isFillBlanks
  const options = noOptions
    ? []
    : Array.isArray(q.options)
      ? q.options.map(opt => String(opt ?? '').trim())
      : []

  // Align optionMedia to options.length: short-answer/diagram → []; otherwise
  // truncate or pad with nulls so the parallel arrays stay in lock-step.
  // A slot collapses to null when it has neither an imageUrl nor a diagram.
  const rawMedia = Array.isArray(q.optionMedia) ? q.optionMedia : []
  const optionMedia = noOptions
    ? []
    : options.map((_, i) => {
        const m = rawMedia[i]
        if (!m || typeof m !== 'object') return null
        const hasImage = !!m.imageUrl
        const hasDiagram = !!(m.diagram && m.diagram.libraryKey)
        if (!hasImage && !hasDiagram) return null
        // Build the slot one key at a time — Zod's .strict() will reject
        // stray fields, and Firestore rejects `undefined`. Including the
        // optional keys only when set keeps both gates happy.
        const slot = { alt: String(m.alt ?? '').trim() }
        if (hasImage) slot.imageUrl = String(m.imageUrl).trim()
        if (hasDiagram) {
          slot.diagram = {
            libraryKey: String(m.diagram.libraryKey).trim(),
            params: normalizeDiagramParams(m.diagram.params),
          }
        }
        return slot
      })

  const imageDiagram = q.imageDiagram && q.imageDiagram.libraryKey
    ? {
        libraryKey: String(q.imageDiagram.libraryKey).trim(),
        params: normalizeDiagramParams(q.imageDiagram.params),
      }
    : null

  const candidate = {
    sharedInstruction: normalizeRichTextPayload(q.sharedInstruction),
    options,
    optionMedia,
    passageId:     q.passageId || null,
    partId:        q.partId ?? null,
    subtype:       q.subtype ?? null,
    correctAnswer: isShortAnswer || isMatching || isSequence || isFillBlanks
      // Short-answer/essay store the written answer; matching/sequence keep
      // their correctness in their own arrays below, and fill-blanks keeps its
      // answers on each statement, so correctAnswer is an (often empty) string.
      ? String(q.correctAnswer ?? '').trim()
      : isNumeric
        // Numeric questions store a real number — Number() converts strings
        // typed by the teacher in the editor. NaN falls back to 0 so the
        // schema's required-finite-number check fires loudly instead of
        // silently writing `NaN`, which Firestore would reject in any case.
        ? (Number.isFinite(Number(q.correctAnswer)) ? Number(q.correctAnswer) : 0)
        : Number.isInteger(q.correctAnswer)
          ? q.correctAnswer
          : Number(q.correctAnswer) || 0,
    // Type-specific answer fields. Spread only for the relevant type so a
    // plain MCQ never carries empty matching/sequence arrays, and the
    // schema's .strict() gate never sees an unexpected key.
    ...(isNumeric ? {
      numericTolerance: Number.isFinite(Number(q.numericTolerance)) && Number(q.numericTolerance) >= 0
        ? Number(q.numericTolerance)
        : 0,
      numericUnit: String(q.numericUnit ?? '').trim().slice(0, 40),
    } : {}),
    ...(isMatching ? {
      matchingLeft: (Array.isArray(q.matchingLeft) ? q.matchingLeft : []).map(s => String(s ?? '').slice(0, 500)).slice(0, 20),
      matchingRight: (Array.isArray(q.matchingRight) ? q.matchingRight : []).map(s => String(s ?? '').slice(0, 500)).slice(0, 20),
      matchingAnswer: (Array.isArray(q.matchingAnswer) ? q.matchingAnswer : [])
        .map(v => { const n = Number(v); return Number.isInteger(n) && n >= -1 ? n : -1 }).slice(0, 20),
    } : {}),
    ...(isSequence ? {
      sequenceItems: (Array.isArray(q.sequenceItems) ? q.sequenceItems : []).map(s => String(s ?? '').slice(0, 500)).slice(0, 20),
      sequenceAnswer: (Array.isArray(q.sequenceAnswer) ? q.sequenceAnswer : [])
        .map(v => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : 0 }).slice(0, 20),
    } : {}),
    // Tolerance only matters for numeric. Stored as null on every other type
    // so the schema's union-with-null lines up across the board. The learner
    // quiz runner reads `tolerance`; the assessment studio writes
    // `numericTolerance` — keep them in lock-step so a numeric question grades
    // the same whichever surface created it.
    tolerance:    isNumeric
      ? (Number.isFinite(Number(q.tolerance)) && Number(q.tolerance) >= 0
          ? Number(q.tolerance)
          : (Number.isFinite(Number(q.numericTolerance)) && Number(q.numericTolerance) >= 0 ? Number(q.numericTolerance) : 0))
      : null,
    // correctRegion only matters for hotspot. Coerce x/y to [0, 1] and
    // radius to a sensible cap. A teacher who never clicked the image
    // ends up with null here, and the schema's superRefine rejects the
    // write loudly so the form can prompt them.
    correctRegion: isHotspot && q.correctRegion && typeof q.correctRegion === 'object'
      ? {
          x: Math.max(0, Math.min(1, Number(q.correctRegion.x) || 0)),
          y: Math.max(0, Math.min(1, Number(q.correctRegion.y) || 0)),
          radius: Math.max(0, Math.min(0.5, Number(q.correctRegion.radius) || 0.05)),
        }
      : null,
    text:          normalizeRichTextPayload(q.text),
    explanation:   normalizeRichTextPayload(q.explanation),
    topic:         String(q.topic ?? '').trim(),
    // Clamp to the schema's accepted [1, 20] range so a parsing typo
    // ("[15 marks]" in an imported past-paper question, or a UI bug
    // overshoot) never throws "Invalid question payload at 'marks'" on
    // auto-save. The cap exactly matches questionWriteSchema's max.
    marks:         normalizeMarks(q.marks, MARKS_BOUNDS.quiz),
    type,
    detectedType:  q.detectedType || type,
    difficulty:    q.difficulty || undefined,
    bloom:         q.bloom || undefined,
    // The ACTIVITY the question is (tracing / picture_matching / …), distinct
    // from `type`, which is only how it is laid out. Persisted so a mapped
    // activity keeps its identity for the picker, analytics, reopening the paper
    // and the migration that will give it a real layout.
    activityType:  q.activityType || undefined,
    // The syllabus outcome the question targets, quoted from the verified
    // curriculum by the blueprint. Persisted so a saved paper can be checked
    // against what it set out to assess.
    learningOutcome: q.learningOutcome || undefined,
    imageUrl:      q.imageUrl || null,
    imageAlt:      String(q.imageAlt ?? '').trim(),
    imageDiagram,
    imagePosition: q.imagePosition || null,
    imageWidth:    normaliseImageWidth(q.imageWidth),
    // The stacked extras beside the primary image — see normalizeExtraImages.
    images:        normalizeExtraImages(q.images),
    diagramText:   q.diagramText || null,
    // Answer-space settings. Only persisted when the teacher set a non-default
    // value so a plain MCQ never carries them (keeps the .strict() schema happy
    // and the doc small). 'lines' + null + [] is the implicit default.
    ...(q.answerFormat && q.answerFormat !== 'lines' ? { answerFormat: q.answerFormat } : {}),
    ...(Number.isInteger(q.answerLines) && q.answerLines >= 0
      ? { answerLines: Math.min(40, q.answerLines) }
      : {}),
    ...(Array.isArray(q.blankLabels) && q.blankLabels.length
      ? { blankLabels: q.blankLabels.map(l => String(l ?? '').trim().slice(0, 24)).filter(Boolean).slice(0, 26) }
      : {}),
    ...(Array.isArray(q.wordBank) && q.wordBank.length
      ? { wordBank: q.wordBank.map(w => String(w ?? '').trim().slice(0, 120)).filter(Boolean).slice(0, 40) }
      : {}),
    // Fill-in-the-Blanks statements + word-bank-reuse flag. Only persisted for
    // the dedicated type so other questions never carry an empty array
    // (keeps the .strict() schema lean). Each statement clamps to the schema's
    // caps (text ≤ 2000, ≤ 12 answers ≤ 200 chars, ≤ 40 statements).
    ...(isFillBlanks ? {
      statements: (Array.isArray(q.statements) ? q.statements : [])
        .map(s => ({
          text: String(s?.text ?? '').slice(0, 2000),
          answers: (Array.isArray(s?.answers) ? s.answers : [])
            .map(a => String(a ?? '').trim().slice(0, 200))
            .slice(0, 12),
        }))
        .slice(0, 40),
      wordBankReuse: Boolean(q.wordBankReuse),
    } : {}),
    // Short-answer sub-parts — "(a) … (b) … (c) …" under the question's
    // instruction stem. Only persisted when present so a plain question never
    // carries an empty array (keeps the .strict() schema lean). Each part maps
    // to the exact schema shape; answerLines is omitted unless it's a number so
    // Firestore never sees `undefined`.
    ...((() => {
      const sp = normalizeSubParts(q.subParts)
      if (!sp.length) return {}
      return {
        subParts: sp.map(p => ({
          text: String(p.text ?? '').slice(0, 2000),
          answer: String(p.answer ?? '').slice(0, 1000),
          marks: Math.max(0, Math.min(99, Math.round(Number(p.marks) || 0))),
          answerFormat: ['inline', 'lines', 'none'].includes(p.answerFormat) ? p.answerFormat : 'inline',
          ...(Number.isInteger(p.answerLines) && p.answerLines >= 0
            ? { answerLines: Math.min(20, p.answerLines) }
            : {}),
        })),
      }
    })()),
    // Diagram label overlays, identify-mode flag, inline data table, and the
    // Draw & Label canvas height. These power the Assessment Studio's labelled
    // diagram / image-identify / data-table / draw-and-label questions. Without
    // persisting them, a saved paper reopened from Firestore (rather than the
    // local draft) lost its labels, table and canvas. Only written when set so
    // a plain MCQ never carries them (keeps the .strict() schema lean).
    ...(Array.isArray(q.diagramLabels) && q.diagramLabels.length
      ? {
        diagramLabels: q.diagramLabels
          .map(l => {
            const label = {
              id: typeof l?.id === 'string' && l.id ? l.id : `lbl-${Math.random().toString(36).slice(2, 10)}`,
              x: Math.max(0, Math.min(1, Number(l?.x) || 0)),
              y: Math.max(0, Math.min(1, Number(l?.y) || 0)),
              text: String(l?.text ?? '').slice(0, 80),
            }
            // Leader-line target — the point on the image the label POINTS at
            // (the teacher drags a tip onto the exact part). Persist only when
            // both coords are real numbers; an absent tx/ty means "no leader
            // line" to the renderer. Dropping these silently lost every
            // teacher-placed leader line when a saved paper was reopened from
            // Firestore — the same "saved → reopened → gone" failure the rest
            // of this block guards against.
            const tx = Number(l?.tx)
            const ty = Number(l?.ty)
            if (Number.isFinite(tx) && Number.isFinite(ty)) {
              label.tx = Math.max(0, Math.min(1, tx))
              label.ty = Math.max(0, Math.min(1, ty))
            }
            return label
          })
          .slice(0, 20),
        // diagramMode only matters alongside labels; persist it with them.
        diagramMode: q.diagramMode === 'identify' ? 'identify' : 'labeled',
      }
      : {}),
    // Inline data table. Firestore rejects nested arrays, so the editor's
    // rows: [[...]] shape is folded to rows: [{ cells: [...] }] here and
    // unfolded again at every read boundary — see src/utils/tableData.js.
    ...(q.tableData && Array.isArray(q.tableData.headers) && q.tableData.headers.length
      ? { tableData: serializeTableData(q.tableData) }
      : {}),
    ...(Number.isFinite(Number(q.drawingHeight)) && Number(q.drawingHeight) > 0
      ? { drawingHeight: Math.max(80, Math.min(500, Math.round(Number(q.drawingHeight)))) }
      : {}),
    requiresReview: Boolean(q.requiresReview),
    reviewNotes:   Array.isArray(q.reviewNotes) ? q.reviewNotes.map(note => String(note ?? '').trim()).filter(Boolean) : [],
    importWarnings: Array.isArray(q.importWarnings) ? q.importWarnings.map(note => String(note ?? '').trim()).filter(Boolean) : [],
    sourcePage:    q.sourcePage || null,
    // Printed source-paper question number — persisted so the editor's
    // structural numbering analysis (missing/duplicate/out-of-order) still
    // works after a reload, not just in the import session. Distinct from
    // sourcePage (page index on scans). Clamped to the schema's 1..9999.
    sourceQuestionNumber: (() => {
      const n = Number(q.sourceQuestionNumber)
      return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null
    })(),
    // Source-paper figure location ({ sourcePage, box }) — only written when
    // the importer located this question's own printed figure, so "Crop from
    // page" keeps its page + auto-box across saves. Keeps the .strict()
    // schema lean for every other question.
    ...(q.figureMeta && (q.figureMeta.sourcePage != null || q.figureMeta.box)
      ? {
        figureMeta: {
          sourcePage: (() => {
            const n = Number(q.figureMeta.sourcePage)
            return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null
          })(),
          box: (() => {
            const b = q.figureMeta.box
            if (!b || typeof b !== 'object') return null
            const x = Number(b.x)
            const y = Number(b.y)
            const w = Number(b.w)
            const h = Number(b.h)
            return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0
              ? { x, y, w, h }
              : null
          })(),
        },
      }
      : {}),
    // Bank lineage — only written when the question was inserted from the
    // Central Question Bank (keeps the .strict() schema lean for every other
    // question). See questionWriteSchema.sourceBankId.
    ...(q.sourceBankId ? { sourceBankId: String(q.sourceBankId).slice(0, 64) } : {}),
    // CBC curriculum tagging + import provenance. Always written (the schema
    // defaults them) so a teacher-cleared field actually clears in Firestore.
    subtopic:        String(q.subtopic ?? '').trim().slice(0, 200),
    competency:      String(q.competency ?? '').trim().slice(0, 200),
    specificOutcome: String(q.specificOutcome ?? '').trim().slice(0, 500),
    curriculum:      String(q.curriculum ?? '').trim().slice(0, 100),
    // aiConfidence falls back to the scanned importer's in-session
    // ocrConfidence so a scan's per-question score survives the first save
    // instead of living only in editor memory.
    aiConfidence: (() => {
      const raw = q.aiConfidence ?? q.ocrConfidence
      return raw == null || !Number.isFinite(Number(raw))
        ? null
        : Math.max(0, Math.min(1, Number(raw)))
    })(),
    // Recomputed LIVE at save time by the shared Document Understanding
    // Engine, so the stored value always reflects the question's current
    // structural state — a teacher fixing a flagged card flips it back to
    // 'ok' in Firestore, not just on the in-editor chip.
    validationStatus: questionValidationStatus(q),
    order,

    // ── Tiptap JSON mirrors (canonical source going forward) ──
    // If the caller already had JSON in hand (e.g. the Tiptap QuizEditor),
    // prefer that. Otherwise derive JSON from the HTML we just produced.
    sharedInstructionJSON: toRichTextJSON(q.sharedInstructionJSON ?? q.sharedInstruction),
    textJSON:              toRichTextJSON(q.textJSON ?? q.text),
    passageJSON:           toRichTextJSON(q.passageJSON ?? q.passage),
    explanationJSON:       toRichTextJSON(q.explanationJSON ?? q.explanation),

    contentVersion: 3,
  }

  // Firestore doesn't accept `undefined` — strip any optional-missing keys.
  const cleaned = Object.fromEntries(
    Object.entries(candidate).filter(([, v]) => v !== undefined)
  )

  // Validate the final shape. If Zod rejects, the caller sees a clear error
  // with the exact field at fault — AND the question's display order — so
  // the teacher can find the failing card in a 60-question past paper
  // instead of staring at a generic "Auto-save failed".
  const parsed = questionWriteSchema.safeParse(cleaned)
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    const path = first?.path?.join('.') || '(root)'
    const where = order ? ` (question ${order})` : ''
    throw new Error(
      `Invalid question payload at "${path}"${where}: ${first?.message || 'schema violation'}`
    )
  }
  return parsed.data
}
