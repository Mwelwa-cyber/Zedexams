// Rich-text format handling is now dual (HTML + Tiptap JSON) and lives in
// the serializeRichField / hydrateRichField / richFieldEmpty helpers below.
// ensureRichTextHtml from the legacy module is intentionally no longer used.

import { normalizeSubParts, sumSubPartMarks } from './questionParts.js'
import { hydrateTableData } from './tableData.js'

let localIdCounter = 0

function nextLocalId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  localIdCounter += 1
  return `${prefix}-${Date.now()}-${localIdCounter}`
}

export const QUESTION_LETTERS = ['A', 'B', 'C', 'D']

// Re-exported, not defined here: a question's identity is what the export
// gate's messages are keyed on, so the server has to agree with the studio
// about it. The implementation moved to the shared assessment package.
export { getQuestionKey } from '../../functions/shared/assessment/questionNumberingCore.js'

export function emptyQuestion(overrides = {}) {
  const nextQuestion = {
    localId: nextLocalId('question'),
    _id: null,
    sharedInstruction: '',
    text: '',
    options: ['', '', '', ''],
    correctAnswer: 0,
    explanation: '',
    topic: '',
    marks: 1,
    type: 'mcq',
    detectedType: 'mcq',
    subtype: null,
    partId: null,
    imageUrl: '',
    // Alt-text description for the question image — read by screen readers in
    // the exported paper and given to the AI marker as context for the figure.
    imageAlt: '',
    // Width preset for an inserted image ('small' | 'medium' | 'large' | 'full').
    imageWidth: 'full',
    // Where the image sits relative to the question text ('below' | 'left' |
    // 'right' | 'inline'); null = 'above', the pre-field default. Rendered by
    // the learner runner and the editor preview.
    imagePosition: null,
    imageUploading: false,
    imageUploadStep: '',
    imageAssetId: '',
    diagramText: '',
    // Exact library figure on the question stem: { libraryKey, params }.
    // Rendered deterministically via the diagram catalog (DiagramSvg) in the
    // preview/PDF and rasterised for DOCX. null when the stem has no shape.
    imageDiagram: null,
    requiresReview: false,
    reviewNotes: [],
    importWarnings: [],
    sourcePage: null,
    // Printed source-paper question number (importer-set; null when
    // hand-authored). Distinct from sourcePage — see the question schema.
    sourceQuestionNumber: null,
    // Where this question's OWN printed figure sits on the uploaded source
    // paper: { sourcePage, box } with box an {x,y,w,h} fractional crop, both
    // nullable. Importer-set; feeds the editor's "Crop from page" (page to
    // open + the AI-detected initial crop box). null for hand-authored
    // questions and imports without a located figure.
    figureMeta: null,
    // "This one is finished." A locked question is never rewritten by a
    // single-question regeneration, and no validation pass or migration may
    // overwrite it — see src/utils/questionRegeneration.js.
    locked: false,
    // Set the moment a human types into this question, so a rewrite can warn
    // before it replaces their work rather than discarding it silently.
    teacherEdited: false,
    // questionBank doc id when this question was inserted from the Central
    // Question Bank; null for hand-authored / imported / AI questions.
    sourceBankId: null,
    // CBC curriculum tagging + import provenance (mirrors the question
    // schema). Editable on the card footer; defaults keep legacy docs and
    // hand-authored questions neutral.
    subtopic: '',
    competency: '',
    specificOutcome: '',
    curriculum: '',
    aiConfidence: null,
    validationStatus: 'ok',
    passageId: null,
    // Numeric question fields. Defaulted on every question so the studio
    // doesn't have to special-case undefined when reading them; only the
    // 'numeric' type actually surfaces them in the UI.
    //   numericTolerance — accept answers within ±this value (default 0 = exact).
    //   numericUnit      — printed after the answer line (e.g. "kg", "%").
    numericTolerance: 0,
    numericUnit: '',
    // Matching question fields. Only the 'matching' type surfaces them.
    //   matchingLeft   — left-column prompts the student matches FROM.
    //   matchingRight  — right-column options the student matches TO.
    //   matchingAnswer — array of right-column indices: matchingAnswer[i]
    //                    is the index into matchingRight that pairs with
    //                    matchingLeft[i]. Length always equals matchingLeft.
    matchingLeft: [],
    matchingRight: [],
    matchingAnswer: [],
    // Sequence question fields. Only the 'sequence' type surfaces them.
    //   sequenceItems  — items shown to the student (typically jumbled
    //                    so they can't infer the order from display).
    //   sequenceAnswer — 1-based position each item should occupy in the
    //                    correct sequence. sequenceAnswer[i] = where
    //                    sequenceItems[i] should end up. A valid answer
    //                    is a permutation of [1..items.length]; 0 means
    //                    "not yet set".
    sequenceItems: [],
    sequenceAnswer: [],
    // Draggable label overlays for the question image. Only the diagram
    // type surfaces these in the editor, but the field is defaulted on
    // every question so renderers don't have to null-check.
    //   id   — stable string used as React key + label reordering
    //   x, y — 0..1 ratios of the image's width/height (so labels stay
    //          anchored when the image is resized between preview / PDF
    //          / DOCX renderers)
    //   text — short label string (e.g. "Epidermis"), ≤ 80 chars
    diagramLabels: [],
    // Diagram render mode:
    //   'labeled'   (default) — labels print as text overlays ON the image,
    //                            i.e. the student is shown the answers and
    //                            answers questions about them in the text.
    //   'identify'            — image overlays show NUMBERS (1, 2, 3…) for
    //                            each label; students write the matching
    //                            term on numbered blank lines below.
    diagramMode: 'labeled',
    // Inline data table attached to the question. Renders as an HTML
    // table in preview/PDF and a real Word table in DOCX. Defaulted to
    // null so questions without one don't render an empty table.
    //   headers — array of column header strings
    //   rows    — array of row arrays; rows[i].length === headers.length
    tableData: null,
    // Draw & Label canvas height in points. When set, the renderer emits
    // a blank bordered rectangle of this height under the question text
    // for the student to draw their own diagram in. null = no canvas.
    drawingHeight: null,
    // Answer-space settings — surfaced for stimulus/structured sub-questions so
    // a teacher can pick how much blank space prints under each follow-up.
    //   answerFormat — 'lines' (default; print N ruled lines), 'none' (no
    //                  space at all, e.g. the sub-part is answered on the
    //                  diagram), or 'labelled_blanks' (print "P: ____" rows).
    //   answerLines  — explicit ruled-line count for the 'lines' format.
    //                  null = fall back to the per-type default (2 for
    //                  short-answer, 4 for structured/diagram, etc.).
    //   blankLabels  — labels for the 'labelled_blanks' format, e.g.
    //                  ['P','Q','R'] → three "P: ____" rows. Renderers also
    //                  accept ['A','B','C'] / ['1','2','3'] / ['i','ii','iii'].
    answerFormat: 'lines',
    answerLines: null,
    blankLabels: [],
    // Optional word bank printed above the answer space (a row of candidate
    // answers the student picks from). Stored as an array of short strings.
    // Also the word bank for the dedicated Fill-in-the-Blanks type.
    wordBank: [],
    // Dedicated Fill-in-the-Blanks fields (type === 'fill_blanks').
    //   statements    — [{ text, answers }]; each prints "A. … ____ …" on its
    //                   own line. `text` uses underscore runs as blanks;
    //                   `answers[i]` is the expected answer for the i-th blank.
    //   wordBankReuse — may a word bank word be used in more than one blank?
    statements: [],
    wordBankReuse: false,
    // Short-answer SUB-PARTS — "(a) … (b) … (c) …" under one instruction stem.
    // See src/utils/questionParts.js. When non-empty, the question's `text` is
    // the instruction stem and its `marks` auto-sum the parts' marks. Each part
    // is { text, answer, marks, answerFormat, answerLines }; the (a)(b)(c) label
    // is derived from position, never stored.
    subParts: [],
    ...overrides,
  }

  // hydrateRichField is dual-format: it passes Tiptap JSON objects through,
  // parses JSON strings, and leaves HTML strings untouched. This lets
  // documentQuizImporter keep shipping HTML while the new editor ships JSON —
  // both flow through this constructor without being destroyed.
  return {
    ...nextQuestion,
    sharedInstruction: hydrateRichField(nextQuestion.sharedInstruction),
    text: hydrateRichField(nextQuestion.text),
    explanation: hydrateRichField(nextQuestion.explanation),
  }
}

export function emptyPassageQuestion(overrides = {}) {
  return emptyQuestion({
    type: 'mcq',
    detectedType: 'mcq',
    options: ['', '', '', ''],
    correctAnswer: 0,
    imageUrl: '',
    imageUploading: false,
    imageUploadStep: '',
    imageAssetId: '',
    diagramText: '',
    ...overrides,
  })
}

export function createStandaloneSection(questionOverrides = {}) {
  return {
    id: nextLocalId('section'),
    kind: 'standalone',
    question: emptyQuestion(questionOverrides),
  }
}

/**
 * Insert a fresh standalone question into `sections` at a chosen position,
 * so a teacher can add a question BETWEEN two existing ones (e.g. a
 * question the importer skipped between printed 31 and 32) without adding at
 * the bottom and shuffling it up by hand.
 *
 * Question numbers are derived purely from `sections[]` order (see
 * buildQuestionNumberMap / serializeQuizSections), so splicing the new section
 * into the right slot renumbers everything automatically — the inserted card
 * takes the next number and every card after it shifts up by one.
 *
 * Anchoring is by section id (stable across renders/reorders), not array index:
 *   - mode 'after'  → placed immediately after `anchorId`
 *   - mode 'before' → placed immediately before `anchorId`
 *   - anchorId null → placed at the very start of the paper
 * `partId` sets the new question's Part membership so it lands in the same
 * Part / Section group as its neighbours (null = ungrouped). An unknown
 * anchorId falls back to appending at the end rather than throwing.
 *
 * Pure: returns a NEW { sections, insertedId } — never mutates the input.
 */
export function insertStandaloneSection(sections = [], { anchorId = null, mode = 'after', partId = null, overrides = {} } = {}) {
  const list = Array.isArray(sections) ? sections : []
  const newSection = createStandaloneSection({ ...overrides, partId: partId ?? null })
  let at
  if (anchorId == null) {
    at = 0
  } else {
    const anchorIndex = list.findIndex(section => section.id === anchorId)
    // Unknown anchor (e.g. deleted mid-interaction) → append rather than throw.
    if (anchorIndex < 0) at = list.length
    else at = mode === 'before' ? anchorIndex : anchorIndex + 1
  }
  return {
    sections: [...list.slice(0, at), newSection, ...list.slice(at)],
    insertedId: newSection.id,
    // The new question's localId — callers scroll/focus the fresh card by its
    // [data-question-id] anchor (see EditQuizV2 scrollToQuestion).
    insertedQuestionId: newSection.question.localId,
  }
}

// A "Part" is a numbered grouping (e.g. "QUESTIONS 1-15") that wraps any
// number of standalone or passage sections. Parts live in a parallel array
// alongside `sections[]`; section membership is tracked via `question.partId`,
// not by nesting. This mirrors how `passages[]` is stored and keeps the
// section list flat for existing reorder/render code.
export function createPartGroup(overrides = {}) {
  const partId = overrides.id || nextLocalId('part')
  const part = {
    id: partId,
    title: overrides.title ?? '',
    instructions: hydrateRichField(overrides.instructions ?? ''),
    example: hydrateRichField(overrides.example ?? ''),
    order: overrides.order ?? 0,
  }
  // The section's marking and answer-choice settings, restored only when the
  // saved part actually carried them. Defaulting them here instead would give
  // every part saved before §3/§4 an explicit setting it never had, which is
  // the difference between "use the paper's" and "this section chose 4".
  // The list mirrors `serializeQuizSections` — a field in one and not the other
  // is saved and then silently lost on reload.
  if (overrides.marksMode === 'uniform' || overrides.marksMode === 'individual') {
    part.marksMode = overrides.marksMode
  }
  if (Number.isFinite(Number(overrides.marksPerQuestion))) {
    part.marksPerQuestion = Number(overrides.marksPerQuestion)
  }
  if (typeof overrides.showMarks === 'boolean') part.showMarks = overrides.showMarks
  if (Number.isFinite(Number(overrides.marks))) part.marks = Number(overrides.marks)
  if (Number.isFinite(Number(overrides.answerChoiceCount))) {
    part.answerChoiceCount = Number(overrides.answerChoiceCount)
  }
  return part
}

export const PASSAGE_KIND_COMPREHENSION = 'comprehension'
export const PASSAGE_KIND_MAP = 'map'
// Stimulus / source-based question kinds. A 'diagram' stimulus leads with an
// instruction, then a figure/picture/graph/table, then the follow-up
// sub-questions underneath. A 'source' stimulus is the document-study variant
// (passage extract, table, map, chart). Both reuse the passage data model —
// instruction = passage.instructions, the stimulus = passageText/imageUrl, and
// every follow-up lives in passage.questions[].
export const PASSAGE_KIND_DIAGRAM = 'diagram'
export const PASSAGE_KIND_SOURCE = 'source'

const PASSAGE_KINDS = new Set([
  PASSAGE_KIND_COMPREHENSION,
  PASSAGE_KIND_MAP,
  PASSAGE_KIND_DIAGRAM,
  PASSAGE_KIND_SOURCE,
])

function normalizePassageKind(value) {
  return PASSAGE_KINDS.has(value) ? value : PASSAGE_KIND_COMPREHENSION
}

// A passage's total marks normally auto-sum from its sub-questions, but a
// teacher can pin an explicit total (e.g. to match a printed paper). Returns a
// clamped integer or null (= auto).
export function normalizeManualMarks(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(999, Math.round(n))
}

// Sum the marks across a passage's sub-questions. Used for the auto total.
export function sumPassageMarks(questions = []) {
  return (questions || []).reduce((sum, q) => sum + (Number(q?.marks) || 0), 0)
}

const ANSWER_FORMATS = new Set(['lines', 'none', 'labelled_blanks'])

// Normalise the answer-space settings on the way in/out of storage so renderers
// can trust the shape. Returns { answerFormat, answerLines, blankLabels }.
export function normalizeAnswerSpace(question = {}) {
  const answerFormat = ANSWER_FORMATS.has(question.answerFormat) ? question.answerFormat : 'lines'
  // null/absent means "use the per-type default line count" and must stay
  // null — the renderers treat an explicit 0 as "print no lines" (the
  // answered-on-the-diagram case). Number(null) is 0 in JS, so coercing
  // before the null check silently rewrote every never-set count to an
  // explicit 0 on save: after one save → reload, short-answer questions
  // printed with NO ruled answer space.
  const rawLines = question.answerLines == null || question.answerLines === ''
    ? null
    : Number(question.answerLines)
  const answerLines = rawLines != null && Number.isFinite(rawLines) && rawLines >= 0
    ? Math.min(40, Math.round(rawLines))
    : null
  const blankLabels = Array.isArray(question.blankLabels)
    ? question.blankLabels.map(l => String(l ?? '').trim().slice(0, 24)).filter(Boolean).slice(0, 26)
    : []
  return { answerFormat, answerLines, blankLabels }
}

// A page break is a structural marker that forces a new page when the paper
// is printed (PDF) or exported (DOCX). It carries no question content; it
// just slots into the `sections[]` array between the questions either side
// and gets serialized to a separate `pagebreaks[]` array on the assessment
// doc (mirroring how passages are stored).
export function createPagebreakSection(overrides = {}) {
  return {
    id: overrides.id || nextLocalId('pagebreak'),
    kind: 'pagebreak',
    partId: overrides.partId ?? null,
  }
}

export function createPassageSection(passageOverrides = {}) {
  const passageId = passageOverrides.id || nextLocalId('passage')
  const questionOverrides = Array.isArray(passageOverrides.questions)
    ? passageOverrides.questions
    : [emptyPassageQuestion()]
  const nextPassage = {
    id: passageId,
    title: '',
    instructions: '',
    passageText: '',
    imageUrl: '',
    imageAlt: '',
    // imageAssetId points at the in-memory blob produced by documentQuizImporter
    // when a passage carries a diagram in the source document. It's the same
    // shape as question.imageAssetId, and the save pass uploads it to Firebase
    // Storage before persisting the passage so we never write a blob: URL.
    imageAssetId: '',
    imageUploading: false,
    imageUploadStep: '',
    collapsed: false,
    ...passageOverrides,
    passageKind: normalizePassageKind(passageOverrides.passageKind),
    // null = total marks auto-sum from the sub-questions; a number pins it.
    manualMarks: normalizeManualMarks(passageOverrides.manualMarks),
  }

  return {
    id: passageId,
    kind: 'passage',
    passage: {
      ...nextPassage,
      id: passageId,
      instructions: hydrateRichField(nextPassage.instructions),
      passageText: hydrateRichField(nextPassage.passageText),
      questions: questionOverrides.map(question =>
        emptyPassageQuestion({
          ...question,
          passageId,
        })),
    },
  }
}

function richFieldEmpty(value) {
  if (!value) return true
  if (typeof value === 'string') return !value.trim()
  // Tiptap JSON object
  if (typeof value === 'object' && value.type === 'doc') {
    const content = value.content || []
    if (content.length === 0) return true
    if (content.length === 1 && content[0].type === 'paragraph') {
      const inner = content[0].content || []
      return inner.length === 0 || (inner.length === 1 && !inner[0].text?.trim())
    }
    return false
  }
  return true
}

function serializeRichField(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  // Tiptap JSON object → store as JSON string
  if (typeof value === 'object' && value.type === 'doc') return JSON.stringify(value)
  return String(value)
}

/**
 * Serialise an array of answer-option values for Firestore. Each option
 * may be a plain string (legacy + simple cases) or a Tiptap JSON document
 * (rich math options). The schema declares `options: z.array(z.string())`
 * — so JSON objects must be stringified the same way `text` is.
 *
 * Returns a new array; never mutates the input.
 */
function serializeOptions(options) {
  if (!Array.isArray(options)) return []
  return options.map((opt) => {
    if (opt == null) return ''
    if (typeof opt === 'string') return opt
    if (typeof opt === 'object' && opt.type === 'doc') return JSON.stringify(opt)
    return String(opt)
  })
}

// A previous bug stored Tiptap docs as JSON strings in fields that the editor
// then re-opened as plain text. Each subsequent edit wrapped the visible JSON
// inside another doc as a text node, producing nested stringified docs in
// Firestore. We peel those layers off on read so the editor and previews see
// the underlying content. Bounded depth prevents pathological loops.
function unwrapNestedTiptapDoc(doc, depth = 0) {
  if (depth > 8) return doc
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc') return doc
  if (!Array.isArray(doc.content) || doc.content.length !== 1) return doc
  const para = doc.content[0]
  if (!para || para.type !== 'paragraph' || !Array.isArray(para.content) || para.content.length !== 1) return doc
  const textNode = para.content[0]
  if (!textNode || textNode.type !== 'text' || typeof textNode.text !== 'string') return doc
  const trimmed = textNode.text.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes('"type"')) return doc
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return unwrapNestedTiptapDoc(parsed, depth + 1)
    }
  } catch {
    // Not JSON — leave as-is so legitimate user text starting with `{` survives.
  }
  return doc
}

function hydrateRichField(value) {
  if (!value) return ''
  if (typeof value === 'object') return unwrapNestedTiptapDoc(value)
  if (typeof value === 'string') {
    // Try parsing as Tiptap JSON
    try {
      const parsed = JSON.parse(value)
      if (parsed && parsed.type === 'doc') return unwrapNestedTiptapDoc(parsed)
    } catch {
      // plain string
    }
    return value
  }
  return value
}

// Answer options are serialised the same way rich fields are: a Tiptap JSON
// option (rich math choice) is stored as a JSON string via serializeOptions.
// On load they must be hydrated back into objects — otherwise the option
// editor receives the literal `{"type":"doc",…}` string, RichEditor's
// migrateContent() treats it as plain text, and the raw JSON renders verbatim
// inside the answer box. Plain-string options (simple text/number choices)
// and empty slots pass straight through unchanged.
function hydrateOptions(options) {
  if (!Array.isArray(options)) return options
  return options.map((opt) => {
    if (opt == null || opt === '') return opt
    return hydrateRichField(opt)
  })
}

// When a question has both an HTML mirror (e.g. `text`) and a JSON mirror
// (e.g. `textJSON`), prefer the JSON. This rescues quizzes saved by an
// earlier build whose normaliser corrupted the HTML mirror by escaping the
// stringified Tiptap doc into <p>{&quot;type&quot;:&quot;doc&quot;...}</p>.
// The JSON mirror was always written via migrateContent so it's intact.
function pickRichField(jsonValue, htmlValue) {
  if (jsonValue && typeof jsonValue === 'object' && jsonValue.type === 'doc') return jsonValue
  return htmlValue ?? ''
}

export function isQuestionBlank(question = {}) {
  const options = Array.isArray(question.options) ? question.options : []
  const correctAnswer = typeof question.correctAnswer === 'string'
    ? question.correctAnswer.trim()
    : question.correctAnswer

  // For text-answer types (short_answer, fill) a non-empty correctAnswer
  // alone is enough to consider the question started, even if every other
  // field is empty. Otherwise the existing heuristic applies.
  const type = question.type ?? 'mcq'
  const isTextAnswerType = type === 'short_answer' || type === 'fill' || type === 'short' || type === 'diagram'
  if (isTextAnswerType && typeof correctAnswer === 'string' && correctAnswer.length > 0) {
    return false
  }

  // A Fill-in-the-Blanks question is "started" as soon as it has any statement
  // text — its answer lives on the statements, not in correctAnswer.
  if (type === 'fill_blanks' && Array.isArray(question.statements)
    && question.statements.some(s => String(s?.text ?? '').trim().length > 0)) {
    return false
  }

  // richFieldEmpty is format-aware (HTML string OR Tiptap JSON); the legacy
  // richTextHasContent only recognises HTML, so it would mark every Tiptap
  // JSON field as "blank" — which would make every new quiz fail validation.
  return richFieldEmpty(question.sharedInstruction) &&
    richFieldEmpty(question.text) &&
    richFieldEmpty(question.explanation) &&
    !String(question.topic ?? '').trim() &&
    !String(question.diagramText ?? '').trim() &&
    !String(question.imageUrl ?? '').trim() &&
    options.every(option => !String(option ?? '').trim()) &&
    (correctAnswer === '' || correctAnswer === 0)
}

export function hasOnlyEmptyStarterSection(sections = []) {
  return sections.length === 1 &&
    sections[0]?.kind === 'standalone' &&
    isQuestionBlank(sections[0]?.question)
}

/**
 * How many questions in this paper have something IN them.
 *
 * countQuizQuestions counts slots — including the blank starter question the
 * studio seeds a new paper with in local state. That distinction decides
 * whether a paper is worth persisting: gating an autosave on the raw count
 * filed a paper for every visit to the "new paper" route, each holding one
 * empty question. Nothing here counts a question the teacher has not begun.
 */
export function countAuthoredQuestions(sections = []) {
  return (sections || []).reduce((total, section) => {
    if (!section || section.kind === 'pagebreak') return total
    if (section.kind === 'passage') {
      const questions = section.passage?.questions || []
      return total + questions.filter(question => !isQuestionBlank(question)).length
    }
    return total + (isQuestionBlank(section.question) ? 0 : 1)
  }, 0)
}

export function countQuizQuestions(sections = []) {
  return sections.reduce((total, section) => {
    if (section.kind === 'passage') {
      return total + (section.passage?.questions?.length || 0)
    }
    // Page breaks are structural markers — they don't add to the count.
    if (section.kind === 'pagebreak') return total
    return total + 1
  }, 0)
}

export function countQuizMarks(sections = []) {
  return sections.reduce((total, section) => {
    if (section.kind === 'passage') {
      return total + (section.passage?.questions || []).reduce((sum, question) => sum + (question.marks || 1), 0)
    }
    return total + (section.question?.marks || 1)
  }, 0)
}

// Fisher-Yates shuffle of the order of an array. Returns a new array; does
// not mutate the input. Exported for tests.
export function shuffleArray(items = []) {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swap]] = [next[swap], next[index]]
  }
  return next
}

// Randomise the order of quiz questions while keeping structure intact:
//   • Ungrouped sections are shuffled among themselves.
//   • Each Part's member sections are shuffled within that Part.
//   • Each comprehension passage's sub-questions are shuffled within the passage.
// Sections never move across Parts; Parts themselves keep their order.
export function shuffleQuizSections(sections = []) {
  const ungrouped = []
  const groupedByPart = new Map()

  sections.forEach(section => {
    const partId = section.kind === 'passage'
      ? section.partId ?? null
      : section.question?.partId ?? null
    if (partId) {
      if (!groupedByPart.has(partId)) groupedByPart.set(partId, [])
      groupedByPart.get(partId).push(section)
    } else {
      ungrouped.push(section)
    }
  })

  const shuffleSubQuestions = section => {
    if (section.kind !== 'passage') return section
    const questions = section.passage?.questions || []
    if (questions.length < 2) return section
    return {
      ...section,
      passage: {
        ...section.passage,
        questions: shuffleArray(questions),
      },
    }
  }

  const shuffledUngrouped = shuffleArray(ungrouped).map(shuffleSubQuestions)
  const shuffledGroups = new Map(
    [...groupedByPart.entries()].map(([partId, members]) => (
      [partId, shuffleArray(members).map(shuffleSubQuestions)]
    )),
  )

  // Reassemble preserving the original "ungrouped first, then by Part order
  // discovered in the input" pattern that the editor already uses.
  const seenParts = new Set()
  const partOrderInOriginal = []
  sections.forEach(section => {
    const partId = section.kind === 'passage'
      ? section.partId ?? null
      : section.question?.partId ?? null
    if (partId && !seenParts.has(partId)) {
      seenParts.add(partId)
      partOrderInOriginal.push(partId)
    }
  })

  return [
    ...shuffledUngrouped,
    ...partOrderInOriginal.flatMap(partId => shuffledGroups.get(partId) || []),
  ]
}

/**
 * Order the renderable "groups" of a paper for display: the single block of
 * loose / ungrouped questions plus every Part (section). Parts sort by their
 * `order` field (kept in lock-step with their index in `parts[]`, which is what
 * drives the A/B/C section letter). The ungrouped block is positioned by
 * `ungroupedOrder` — the count of sections that should sit *before* it, so `0`
 * (the historical default) leads the paper with the loose questions, and a
 * higher value pushes them below that many sections. The ungrouped block sorts
 * just *ahead* of the section at that index (the `- 0.5`) so it always slots
 * cleanly between sections instead of tying with one.
 *
 * Returns an ordered array of descriptors:
 *   { type: 'ungrouped' }                — the loose-questions block
 *   { type: 'part', part, partIndex }    — a section; partIndex is its index in
 *                                          `parts[]` (→ its A/B/C letter)
 *
 * Pure + framework-agnostic so the studio builder, the shared paper layout, and
 * the reorder handler all agree on one ordering.
 */
export function orderPaperGroups(parts = [], ungroupedOrder = 0, hasUngrouped = true) {
  const groups = (parts || []).map((part, index) => ({
    type: 'part',
    part,
    partIndex: index,
    sortKey: typeof part.order === 'number' ? part.order : index,
  }))
  if (hasUngrouped) {
    const before = Number.isFinite(Number(ungroupedOrder)) ? Number(ungroupedOrder) : 0
    groups.push({ type: 'ungrouped', sortKey: before - 0.5 })
  }
  return groups.sort((a, b) => a.sortKey - b.sortKey)
}

export function serializeQuizSections(sections = [], parts = []) {
  // Dual-format safe: serializeRichField writes Tiptap JSON as a JSON string
  // (keeps objects out of Firestore document fields) and passes HTML strings
  // through untouched. Legacy quizzes still save as HTML until a teacher
  // edits them; new quizzes save as stringified Tiptap JSON from day one.
  const passages = []
  const questions = []
  const pagebreaks = []
  let questionOrder = 1

  // Allow-list of valid Part IDs. Any partId on a question that doesn't match
  // gets dropped — defensive against stale references after a Part deletion.
  const validPartIds = new Set((parts || []).map(part => part.id).filter(Boolean))
  const resolvePartId = candidate => (candidate && validPartIds.has(candidate) ? candidate : null)

  sections.forEach(section => {
    if (section.kind === 'pagebreak') {
      // Page breaks consume an order slot so they sit between the questions
      // either side of them in the rendered paper. They carry no question
      // content of their own.
      pagebreaks.push({
        id: section.id || nextLocalId('pagebreak'),
        order: questionOrder,
        partId: resolvePartId(section.partId),
      })
      questionOrder += 1
      return
    }
    if (section.kind === 'passage') {
      const passage = section.passage || {}
      const passageId = passage.id || nextLocalId('passage')
      const startOrder = questionOrder
      // All children of a passage share the same Part membership. Read it
      // off the passage section itself (set by assignSectionToPart) and fall
      // back to the first child's stored partId for round-trip compatibility.
      const passagePartId = resolvePartId(
        section.partId ?? passage.partId ?? (passage.questions?.[0]?.partId)
      )

      passages.push({
        id: passageId,
        title: String(passage.title ?? '').trim(),
        instructions: serializeRichField(passage.instructions),
        passageText: serializeRichField(passage.passageText),
        imageUrl: passage.imageUrl || '',
        imageAlt: String(passage.imageAlt || '').trim(),
        // Carried so the save pass can swap in a Firebase Storage download URL
        // before the doc reaches Firestore. Cleared on save when the upload
        // succeeds; never persisted long-term.
        imageAssetId: passage.imageAssetId || '',
        // Catalog shape diagram on the passage stimulus. Persisted so the
        // preview, PDF, and DOCX renderers can draw it after a save → reload.
        // null (old passages without a shape) is fully backward-compatible.
        imageDiagram: passage.imageDiagram && passage.imageDiagram.libraryKey
          ? { libraryKey: String(passage.imageDiagram.libraryKey), params: passage.imageDiagram.params || {} }
          : null,
        passageKind: normalizePassageKind(passage.passageKind),
        manualMarks: normalizeManualMarks(passage.manualMarks),
        // Importer-written source-paper figure location ({ sourcePage, box }).
        // Persisted so a failed figure attach can be retried and the manual
        // cropper keeps its page + auto-box after a save → reload.
        ...(passage.figureMeta ? { figureMeta: passage.figureMeta } : {}),
        order: startOrder,
        partId: passagePartId,
      })

      ;(passage.questions || []).forEach(question => {
        // Preserve the sub-question's real type. A passage can now hold
        // short-answer sub-questions alongside MCQ; hard-coding 'mcq' here
        // (the old behaviour) silently converted them to multiple-choice on
        // save, corrupting the marking key and the reopened paper.
        const subType = question.type || 'mcq'
        const subIsTextAnswer = subType === 'short_answer' || subType === 'diagram' || subType === 'essay'
        const subSubParts = normalizeSubParts(question.subParts)
        questions.push({
          ...question,
          sharedInstruction: serializeRichField(question.sharedInstruction),
          text: serializeRichField(question.text),
          explanation: serializeRichField(question.explanation),
          // Text-answer sub-questions carry no options; clear any stale ones
          // left over from a type switch so they don't round-trip as MCQ.
          options: subIsTextAnswer ? [] : serializeOptions(question.options),
          ...normalizeAnswerSpace(question),
          subParts: subSubParts,
          // A question with sub-parts owns no marks of its own — the total is
          // the sum of its parts. Keeps the marking key + paper total honest.
          ...(subSubParts.length ? { marks: sumSubPartMarks(subSubParts) } : {}),
          passageId,
          type: subType,
          detectedType: question.detectedType ?? subType,
          subtype: question.subtype ?? null,
          partId: passagePartId,
          order: questionOrder,
        })
        questionOrder += 1
      })
      return
    }

    const question = section.question || emptyQuestion()
    const stdSubParts = normalizeSubParts(question.subParts)
    questions.push({
      ...question,
      sharedInstruction: serializeRichField(question.sharedInstruction),
      text: serializeRichField(question.text),
      explanation: serializeRichField(question.explanation),
      options: serializeOptions(question.options),
      ...normalizeAnswerSpace(question),
      subParts: stdSubParts,
      // A question with sub-parts owns no marks of its own — the total is the
      // sum of its parts (auto). Otherwise keep the question's own marks.
      ...(stdSubParts.length ? { marks: sumSubPartMarks(stdSubParts) } : {}),
      passageId: null,
      subtype: question.subtype ?? null,
      partId: resolvePartId(question.partId),
      order: questionOrder,
    })
    questionOrder += 1
  })

  // The section's own settings ride on the part. They are written as an
  // explicit allow-list rather than spread, so a field added to the editor's
  // in-memory part cannot silently start being persisted — but a field listed
  // here and forgotten in `hydrateQuizSections` would be saved and then lost on
  // reload, which is why the two lists are stated together in both files.
  //
  // `undefined` is never written: Firestore rejects it, and "not set" has to
  // stay distinguishable from "set to nothing" — a section with no
  // answerChoiceCount uses the paper's, and a section with a null one is the
  // same thing said out loud.
  const serializedParts = (parts || []).map((part, index) => {
    const out = {
      id: part.id,
      title: String(part.title ?? '').trim(),
      instructions: serializeRichField(part.instructions),
      example: serializeRichField(part.example),
      order: typeof part.order === 'number' ? part.order : index,
    }
    // §4 — how this section awards marks.
    if (part.marksMode === 'uniform' || part.marksMode === 'individual') out.marksMode = part.marksMode
    if (Number.isFinite(Number(part.marksPerQuestion))) out.marksPerQuestion = Number(part.marksPerQuestion)
    if (typeof part.showMarks === 'boolean') out.showMarks = part.showMarks
    if (Number.isFinite(Number(part.marks))) out.marks = Number(part.marks)
    // §3 — the section's answer-choice override.
    if (Number.isFinite(Number(part.answerChoiceCount))) out.answerChoiceCount = Number(part.answerChoiceCount)
    return out
  })

  return {
    passages,
    pagebreaks,
    parts: serializedParts,
    questions,
    questionCount: questions.length,
    totalMarks: questions.reduce((sum, question) => sum + (question.marks || 1), 0),
  }
}

// Normalise a stored optionMedia array on the way back into the editor.
// Drops obviously-corrupt entries (non-objects, blob URLs left over from a
// half-failed upload, options with no media at all), but PRESERVES partial
// drafts where a teacher uploaded an image but hasn't typed the alt-text yet.
// That partial state is what the pre-publish checklist is for; the editor
// must surface it instead of silently dropping the image.
function hydrateOptionMedia(rawMedia) {
  if (!Array.isArray(rawMedia)) return []
  return rawMedia.map(slot => {
    if (!slot || typeof slot !== 'object') return null
    const rawUrl = typeof slot.imageUrl === 'string' ? slot.imageUrl.trim() : ''
    // Never round-trip a blob: URL — these only live in browser memory, so
    // a previous tab's blob URL is dead by the time we hydrate. Treat the
    // slot as text-only instead of rendering a broken <img>.
    const imageUrl = rawUrl && !rawUrl.startsWith('blob:') ? rawUrl : ''
    const diagram = slot.diagram && slot.diagram.libraryKey
      ? { libraryKey: String(slot.diagram.libraryKey), params: slot.diagram.params || {} }
      : null
    if (!imageUrl && !diagram) return null
    const out = { alt: typeof slot.alt === 'string' ? slot.alt : '' }
    if (imageUrl) out.imageUrl = imageUrl
    if (diagram) out.diagram = diagram
    return out
  })
}

// The saved image-position choice ('below' | 'left' | 'right' | 'inline';
// null = above). Hydrate uses explicit field lists, so before this helper
// existed the choice was silently DROPPED on reopen — the dropdown reset to
// "above" and the next save wrote null, un-setting what the admin picked.
const IMAGE_POSITIONS = new Set(['above', 'below', 'left', 'right', 'inline'])
function hydrateImagePosition(raw) {
  // 'above' is stored as null (the editor writes null for the default).
  if (raw == null || raw === 'above') return null
  return IMAGE_POSITIONS.has(raw) ? raw : null
}

// Where a question's/passage's printed figure sits on the uploaded source
// paper ({ sourcePage, box }) — importer-written, read back on hydrate so
// "Crop from page" still opens on the right page with the AI-detected box
// after a save → reload. Returns null unless at least one half is usable.
function hydrateFigureMeta(raw) {
  if (!raw || typeof raw !== 'object') return null
  const page = Number(raw.sourcePage)
  const sourcePage = Number.isInteger(page) && page >= 1 && page <= 9999 ? page : null
  let box = null
  const b = raw.box
  if (b && typeof b === 'object') {
    const x = Number(b.x)
    const y = Number(b.y)
    const w = Number(b.w)
    const h = Number(b.h)
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) box = { x, y, w, h }
  }
  if (sourcePage == null && !box) return null
  return { sourcePage, box }
}

// CBC tagging + import provenance — shared between the standalone and passage
// hydrate paths so a saved question's tags survive a reload on both card kinds.
// (hydrate uses explicit field lists, so anything not read here is dropped.)
function hydrateCbcMeta(question = {}) {
  const conf = Number(question.aiConfidence)
  const srcNum = Number(question.sourceQuestionNumber)
  return {
    subtopic: typeof question.subtopic === 'string' ? question.subtopic : '',
    competency: typeof question.competency === 'string' ? question.competency : '',
    specificOutcome: typeof question.specificOutcome === 'string' ? question.specificOutcome : '',
    curriculum: typeof question.curriculum === 'string' ? question.curriculum : '',
    aiConfidence: question.aiConfidence != null && Number.isFinite(conf)
      ? Math.max(0, Math.min(1, conf))
      : null,
    validationStatus: ['ok', 'warning', 'error'].includes(question.validationStatus)
      ? question.validationStatus
      : 'ok',
    sourceQuestionNumber: Number.isInteger(srcNum) && srcNum >= 1 && srcNum <= 9999
      ? srcNum
      : null,
    // A lock is the teacher saying "leave this one alone", so it has to survive
    // a reload — otherwise reopening the paper quietly re-exposes every locked
    // question to the next rewrite.
    locked: Boolean(question.locked),
    teacherEdited: Boolean(question.teacherEdited),
  }
}

function hydrateStandaloneQuestion(question = {}) {
  const type = question.type ?? 'mcq'
  // `fill` answers are stored as a comma-separated string and behave like
  // short_answer/diagram for the purpose of options/correctAnswer shape.
  // `numeric` also rides this path — correctAnswer is the number-as-string;
  // the actual numeric tolerance / unit live in their own fields below.
  // `matching` has its own correctness model (matchingAnswer index array)
  // and the legacy correctAnswer is unused, so we also flatten it here.
  // `sequence` rides the same path — correctness lives on sequenceAnswer.
  // `essay` has no options either — the answer is the learner's written
  // response, graded against an optional sample answer / rubric.
  const isTextAnswer = type === 'short_answer' || type === 'diagram' || type === 'essay' || type === 'fill' || type === 'fill_blanks' || type === 'short' || type === 'numeric' || type === 'matching' || type === 'sequence'

  return emptyQuestion({
    localId: question.id || question._id || question.localId || nextLocalId('question'),
    _id: question.id || question._id || null,
    sharedInstruction: hydrateRichField(pickRichField(question.sharedInstructionJSON, question.sharedInstruction)),
    text: hydrateRichField(pickRichField(question.textJSON, question.text)),
    options: isTextAnswer
      ? []
      : Array.isArray(question.options) && question.options.length
        ? hydrateOptions(question.options)
        : ['', '', '', ''],
    // optionMedia is parallel to options; persist it through the load so a
    // teacher reopening a draft sees the images they uploaded earlier.
    // emptyQuestion()'s ...overrides spread is the canonical way to feed
    // arbitrary persisted fields back into the in-memory shape.
    optionMedia: isTextAnswer ? [] : hydrateOptionMedia(question.optionMedia),
    correctAnswer: isTextAnswer
      ? String(question.correctAnswer ?? '')
      : question.correctAnswer ?? 0,
    explanation: hydrateRichField(pickRichField(question.explanationJSON, question.explanation)),
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    type,
    detectedType: question.detectedType ?? type,
    subtype: question.subtype ?? null,
    partId: question.partId ?? null,
    imageUrl: question.imageUrl ?? '',
    imageAssetId: question.imageAssetId ?? '',
    imageAlt: question.imageAlt ? String(question.imageAlt).trim() : '',
    imageWidth: question.imageWidth ?? 'full',
    imagePosition: hydrateImagePosition(question.imagePosition),
    diagramText: question.diagramText ?? '',
    imageDiagram: question.imageDiagram && question.imageDiagram.libraryKey
      ? { libraryKey: String(question.imageDiagram.libraryKey), params: question.imageDiagram.params || {} }
      : null,
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
    figureMeta: hydrateFigureMeta(question.figureMeta),
    passageId: question.passageId ?? null,
    imageUploading: false,
    imageUploadStep: '',
    numericTolerance: Number.isFinite(Number(question.numericTolerance))
      ? Number(question.numericTolerance)
      : 0,
    numericUnit: typeof question.numericUnit === 'string' ? question.numericUnit : '',
    matchingLeft: Array.isArray(question.matchingLeft)
      ? question.matchingLeft.map(s => String(s ?? '')).slice(0, 10)
      : [],
    matchingRight: Array.isArray(question.matchingRight)
      ? question.matchingRight.map(s => String(s ?? '')).slice(0, 10)
      : [],
    matchingAnswer: Array.isArray(question.matchingAnswer)
      ? question.matchingAnswer.map(v => {
        const n = Number(v)
        return Number.isInteger(n) && n >= 0 ? n : -1
      }).slice(0, 10)
      : [],
    sequenceItems: Array.isArray(question.sequenceItems)
      ? question.sequenceItems.map(s => String(s ?? '')).slice(0, 10)
      : [],
    sequenceAnswer: Array.isArray(question.sequenceAnswer)
      ? question.sequenceAnswer.map(v => {
        const n = Number(v)
        // 1-based positions; 0 = unset
        return Number.isInteger(n) && n >= 1 ? n : 0
      }).slice(0, 10)
      : [],
    diagramLabels: Array.isArray(question.diagramLabels)
      ? question.diagramLabels
        .map(l => {
          const out = {
            id: typeof l?.id === 'string' && l.id ? l.id : nextLocalId('label'),
            x: Math.max(0, Math.min(1, Number(l?.x) || 0)),
            y: Math.max(0, Math.min(1, Number(l?.y) || 0)),
            text: String(l?.text ?? '').slice(0, 80),
          }
          // Preserve the leader-line target (the part the label points at) so a
          // teacher's dragged blue tip survives save → reload. Only when both
          // coords are finite; a target-less label keeps the renderer default.
          if (Number.isFinite(Number(l?.tx)) && Number.isFinite(Number(l?.ty))) {
            out.tx = Math.max(0, Math.min(1, Number(l.tx)))
            out.ty = Math.max(0, Math.min(1, Number(l.ty)))
          }
          return out
        })
        .slice(0, 20)
      : [],
    diagramMode: question.diagramMode === 'identify' ? 'identify' : 'labeled',
    // Unfold the persisted { cells } rows back to the editor's string[][]
    // shape (see src/utils/tableData.js — Firestore rejects nested arrays).
    tableData: hydrateTableData(question.tableData),
    drawingHeight: Number.isFinite(Number(question.drawingHeight)) && Number(question.drawingHeight) > 0
      ? Math.max(80, Math.min(500, Math.round(Number(question.drawingHeight))))
      : null,
    wordBank: Array.isArray(question.wordBank)
      ? question.wordBank.map(w => String(w ?? '').trim()).filter(Boolean).slice(0, 40)
      : [],
    // Fill-in-the-Blanks statements + reuse flag. Listed explicitly (not via a
    // `...question` spread) so a saved fill-blanks paper reopened from
    // Firestore keeps its statements instead of resetting to the empty default.
    statements: Array.isArray(question.statements)
      ? question.statements.map(s => ({
        text: String(s?.text ?? '').slice(0, 2000),
        answers: Array.isArray(s?.answers)
          ? s.answers.map(a => String(a ?? '').slice(0, 200)).slice(0, 12)
          : [],
      })).slice(0, 40)
      : [],
    wordBankReuse: Boolean(question.wordBankReuse),
    // Short-answer sub-parts — restore them across a reload so a multi-part
    // question reopens with its (a)(b)(c) intact instead of one crammed stem.
    subParts: normalizeSubParts(question.subParts),
    ...normalizeAnswerSpace(question),
    ...hydrateCbcMeta(question),
  })
}

function hydratePassageQuestion(question = {}, passageId, partId = null) {
  // Preserve the sub-question's saved type. Passages can hold short-answer
  // sub-questions, not just MCQ; hard-coding 'mcq' on reopen (the old
  // behaviour) made a saved short-answer reopen as an empty multiple-choice.
  const type = question.type || 'mcq'
  const isTextAnswer = type === 'short_answer' || type === 'diagram' || type === 'essay'
  return emptyPassageQuestion({
    localId: question.id || question._id || question.localId || nextLocalId('question'),
    _id: question.id || question._id || null,
    type,
    detectedType: question.detectedType ?? type,
    sharedInstruction: hydrateRichField(pickRichField(question.sharedInstructionJSON, question.sharedInstruction)),
    text: hydrateRichField(pickRichField(question.textJSON, question.text)),
    options: isTextAnswer
      ? []
      : Array.isArray(question.options) && question.options.length
        ? hydrateOptions(question.options)
        : ['', '', '', ''],
    // Persist optionMedia so image options survive a reload — same reasoning
    // as in hydrateStandaloneQuestion above.
    optionMedia: isTextAnswer ? [] : hydrateOptionMedia(question.optionMedia),
    correctAnswer: isTextAnswer
      ? String(question.correctAnswer ?? '')
      : question.correctAnswer ?? 0,
    explanation: hydrateRichField(pickRichField(question.explanationJSON, question.explanation)),
    topic: question.topic ?? '',
    marks: question.marks ?? 1,
    subtype: question.subtype ?? null,
    partId: partId ?? question.partId ?? null,
    requiresReview: Boolean(question.requiresReview),
    reviewNotes: question.reviewNotes ?? [],
    importWarnings: question.importWarnings ?? [],
    sourcePage: question.sourcePage ?? null,
    figureMeta: hydrateFigureMeta(question.figureMeta),
    passageId,
    imageUploading: false,
    imageUploadStep: '',
    // Stimulus sub-questions may carry their own optional figure, table, word
    // bank and answer-space settings (e.g. "(a) Label the parts P, Q, R" with
    // labelled blanks). Preserve them across a reload instead of resetting to
    // the empty-question defaults.
    imageUrl: question.imageUrl ?? '',
    imageAlt: question.imageAlt ? String(question.imageAlt).trim() : '',
    imageWidth: question.imageWidth ?? 'full',
    imagePosition: hydrateImagePosition(question.imagePosition),
    imageDiagram: question.imageDiagram && question.imageDiagram.libraryKey
      ? { libraryKey: String(question.imageDiagram.libraryKey), params: question.imageDiagram.params || {} }
      : null,
    diagramText: question.diagramText ?? '',
    diagramLabels: Array.isArray(question.diagramLabels)
      ? question.diagramLabels
        .map(l => {
          const out = {
            id: typeof l?.id === 'string' && l.id ? l.id : nextLocalId('label'),
            x: Math.max(0, Math.min(1, Number(l?.x) || 0)),
            y: Math.max(0, Math.min(1, Number(l?.y) || 0)),
            text: String(l?.text ?? '').slice(0, 80),
          }
          // Preserve the leader-line target (the part the label points at) so a
          // teacher's dragged blue tip survives save → reload. Only when both
          // coords are finite; a target-less label keeps the renderer default.
          if (Number.isFinite(Number(l?.tx)) && Number.isFinite(Number(l?.ty))) {
            out.tx = Math.max(0, Math.min(1, Number(l.tx)))
            out.ty = Math.max(0, Math.min(1, Number(l.ty)))
          }
          return out
        })
        .slice(0, 20)
      : [],
    diagramMode: question.diagramMode === 'identify' ? 'identify' : 'labeled',
    // Unfold the persisted { cells } rows back to the editor's string[][]
    // shape (see src/utils/tableData.js — Firestore rejects nested arrays).
    tableData: hydrateTableData(question.tableData),
    wordBank: Array.isArray(question.wordBank)
      ? question.wordBank.map(w => String(w ?? '').trim()).filter(Boolean).slice(0, 40)
      : [],
    drawingHeight: Number.isFinite(Number(question.drawingHeight)) && Number(question.drawingHeight) > 0
      ? Math.max(80, Math.min(500, Math.round(Number(question.drawingHeight))))
      : null,
    subParts: normalizeSubParts(question.subParts),
    ...normalizeAnswerSpace(question),
    ...hydrateCbcMeta(question),
  })
}

export function hydrateQuizSections(questions = [], passages = [], parts = [], pagebreaks = []) {
  // Returns `{ sections, parts }`. Pre-PRISCA-format callers passed only
  // questions+passages; the new return shape is a breaking change consumed by
  // EditQuizV2/CreateQuizV2 which both treat `parts` as opt-in state. Empty
  // `parts[]` keeps legacy quizzes behaving identically.
  const sortedQuestions = [...questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const passageSections = new Map()
  // Look up Part membership by passage id when we hydrate child questions.
  const passagePartIdById = new Map(
    (passages || []).map(passage => [passage.id, passage.partId ?? null])
  )

  passages.forEach(passage => {
    const section = createPassageSection({
      id: passage.id,
      title: passage.title ?? '',
      instructions: hydrateRichField(passage.instructions ?? ''),
      passageText: hydrateRichField(passage.passageText ?? ''),
      imageUrl: passage.imageUrl ?? '',
      imageAssetId: passage.imageAssetId ?? '',
      // Restore the catalog shape diagram (if any) so it survives a
      // save → reload round-trip. createPassageSection spreads overrides
      // so this flows through to passage.imageDiagram automatically.
      imageDiagram: passage.imageDiagram && passage.imageDiagram.libraryKey
        ? { libraryKey: String(passage.imageDiagram.libraryKey), params: passage.imageDiagram.params || {} }
        : null,
      passageKind: passage.passageKind,
      manualMarks: passage.manualMarks,
      figureMeta: hydrateFigureMeta(passage.figureMeta),
      questions: [],
    })
    section.partId = passage.partId ?? null
    passageSections.set(passage.id, {
      order: passage.order ?? Number.MAX_SAFE_INTEGER,
      section,
    })
  })

  const standaloneSections = []

  sortedQuestions.forEach(question => {
    if (question.passageId) {
      const existing = passageSections.get(question.passageId)
      const inheritedPartId = passagePartIdById.has(question.passageId)
        ? passagePartIdById.get(question.passageId)
        : (question.partId ?? null)
      const container = existing || {
        order: question.order ?? Number.MAX_SAFE_INTEGER,
        section: (() => {
          const created = createPassageSection({
            id: question.passageId,
            questions: [],
          })
          created.partId = inheritedPartId
          return created
        })(),
      }

      container.section.passage.questions.push(
        hydratePassageQuestion(question, question.passageId, inheritedPartId)
      )
      if (!existing) {
        passageSections.set(question.passageId, container)
      }
      return
    }

    standaloneSections.push({
      order: question.order ?? Number.MAX_SAFE_INTEGER,
      section: createStandaloneSection(hydrateStandaloneQuestion(question)),
    })
  })

  // Page breaks slot into the same order space as questions/passages so
  // they end up at the right place between them once we sort.
  const pagebreakEntries = (pagebreaks || []).map(pb => ({
    order: pb.order ?? Number.MAX_SAFE_INTEGER,
    section: createPagebreakSection({ id: pb.id, partId: pb.partId ?? null }),
  }))

  const combined = [
    ...standaloneSections,
    ...Array.from(passageSections.values()).map(entry => {
      if (!entry.section.passage.questions.length) {
        entry.section.passage.questions = [
          emptyPassageQuestion({ passageId: entry.section.passage.id, partId: entry.section.partId ?? null }),
        ]
      }
      return entry
    }),
    ...pagebreakEntries,
  ]
    .sort((left, right) => left.order - right.order)
    .map(entry => entry.section)

  const sections = combined.length ? combined : [createStandaloneSection()]

  const hydratedParts = (parts || [])
    .map((part, index) => createPartGroup({
      ...part,
      id: part.id,
      title: part.title ?? '',
      instructions: part.instructions ?? '',
      example: part.example ?? '',
      order: typeof part.order === 'number' ? part.order : index,
    }))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))

  // Recovery pass: if parts exist but every question has partId=null (caused
  // by a pre-fix save that stripped partId), try to re-infer assignments from
  // number ranges encoded in part titles ("Questions 1 - 20", "21 - 25", …).
  // Only activates when ALL parts have parseable ranges so we don't make
  // partial/wrong assignments.
  const RANGE_RE = /\b(\d+)\s*[-–—]\s*(\d+)\b/
  const namedHydratedParts = hydratedParts.filter(p => String(p.title ?? '').trim())
  const partsBroken = namedHydratedParts.length > 0 && sections.every(s => {
    if (s.kind === 'standalone') return !s.question?.partId
    if (s.kind === 'passage') return !s.partId
    return true
  })
  if (partsBroken) {
    const partRanges = namedHydratedParts.map(p => {
      const m = p.title.match(RANGE_RE)
      return m ? { id: p.id, low: Number(m[1]), high: Number(m[2]) } : null
    })
    if (partRanges.every(Boolean)) {
      let qOrder = 0
      const recovered = sections.map(s => {
        if (s.kind === 'pagebreak') return s
        if (s.kind === 'passage') {
          const qCount = s.passage?.questions?.length || 0
          qOrder += qCount
          const mid = qOrder - Math.floor(qCount / 2)
          const match = partRanges.find(r => mid >= r.low && mid <= r.high)
          return match ? { ...s, partId: match.id } : s
        }
        qOrder++
        const match = partRanges.find(r => qOrder >= r.low && qOrder <= r.high)
        return match ? { ...s, question: { ...s.question, partId: match.id } } : s
      })
      return { sections: recovered, parts: namedHydratedParts }
    }
  }

  return { sections, parts: hydratedParts }
}

export function buildQuizDisplaySections(questions = [], passages = []) {
  // Defensive coercion: a quiz doc written with a non-array `passages` field
  // (e.g. an object map from an older import path) used to crash the exam
  // and quiz runners with `s.forEach is not a function`. Same applies if
  // `questions` arrives as something non-iterable. Coerce both at the
  // boundary so a single bad doc cannot blank the runner.
  const safeQuestions = (Array.isArray(questions) ? questions : []).filter(
    question => question && typeof question === 'object',
  )
  const safePassages = (Array.isArray(passages) ? passages : []).filter(
    passage => passage && typeof passage === 'object' && passage.id,
  )
  const sortedQuestions = [...safeQuestions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const passageBlocks = new Map()

  safePassages.forEach(passage => {
    passageBlocks.set(passage.id, {
      id: passage.id,
      kind: 'passage',
      order: passage.order ?? Number.MAX_SAFE_INTEGER,
      passage: {
        id: passage.id,
        title: passage.title ?? '',
        instructions: passage.instructions ?? '',
        passageText: passage.passageText ?? '',
        imageUrl: passage.imageUrl ?? '',
        passageKind: normalizePassageKind(passage.passageKind),
      },
      questions: [],
    })
  })

  const standaloneBlocks = []

  sortedQuestions.forEach(question => {
    const hydratedQuestion = hydrateStandaloneQuestion(question)

    if (question.passageId) {
      const existingBlock = passageBlocks.get(question.passageId)
      const block = existingBlock || {
        id: question.passageId,
        kind: 'passage',
        order: question.order ?? Number.MAX_SAFE_INTEGER,
        passage: {
          id: question.passageId,
          title: '',
          instructions: '',
          passageText: '',
          imageUrl: '',
          passageKind: PASSAGE_KIND_COMPREHENSION,
        },
        questions: [],
      }

      block.questions.push({
        ...hydratePassageQuestion(question, question.passageId),
        id: question.id || question._id,
      })

      if (!existingBlock) {
        passageBlocks.set(question.passageId, block)
      }
      return
    }

    standaloneBlocks.push({
      id: question.id || question._id || question.localId || nextLocalId('standalone'),
      kind: 'standalone',
      order: question.order ?? Number.MAX_SAFE_INTEGER,
      question: {
        ...hydratedQuestion,
        id: question.id || question._id,
      },
    })
  })

  const sections = [
    ...standaloneBlocks,
    ...Array.from(passageBlocks.values()),
  ]
    .sort((left, right) => left.order - right.order)
    .map(section => {
      if (section.kind === 'passage') {
        return {
          ...section,
          questions: [...section.questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
        }
      }
      return section
    })

  let questionNumber = 1
  const orderedQuestions = []

  const numberedSections = sections.map(section => {
    if (section.kind === 'passage') {
      const numberedQuestions = section.questions.map(question => {
        const nextQuestion = { ...question, questionNumber }
        orderedQuestions.push(nextQuestion)
        questionNumber += 1
        return nextQuestion
      })

      return {
        ...section,
        questions: numberedQuestions,
        startQuestionNumber: numberedQuestions[0]?.questionNumber ?? questionNumber,
      }
    }

    const numberedQuestion = {
      ...section.question,
      questionNumber,
    }
    orderedQuestions.push(numberedQuestion)
    questionNumber += 1

    return {
      ...section,
      question: numberedQuestion,
      startQuestionNumber: numberedQuestion.questionNumber,
    }
  })

  return {
    sections: numberedSections,
    questions: orderedQuestions,
  }
}

/**
 * Collect all Firestore `_id`s that would need to be deleted when a whole
 * section (standalone question or passage with its sub-questions) is removed
 * from the editor. Returns only ids that are already persisted (non-empty
 * strings), so freshly-created questions that have never been saved are
 * correctly skipped.
 *
 * Used by the quiz editor's remove handlers and extractable here so the
 * deletion logic can be unit-tested independently of the React component.
 *
 * @param {object} section — a section from the editor's `sections` state array
 * @returns {string[]} array of Firestore question document ids
 */
export function collectSectionFirestoreIds(section) {
  if (!section) return []
  if (section.kind === 'passage') {
    return (section.passage?.questions || [])
      .map(q => q._id)
      .filter(id => typeof id === 'string' && id.length > 0)
  }
  const id = section.question?._id
  return typeof id === 'string' && id.length > 0 ? [id] : []
}

/**
 * Return the Firestore `_id` of a single passage sub-question identified by
 * its section and question index, or `null` if the question has never been
 * saved (i.e. `_id` is absent or empty).
 *
 * Extracted alongside `collectSectionFirestoreIds` so the
 * `removePassageQuestion` handler in the quiz editor can be tested without
 * relying on React state.
 *
 * @param {object[]} sections — current sections array snapshot
 * @param {number}   sectionIndex  — index of the passage section
 * @param {number}   questionIndex — index of the sub-question within the passage
 * @returns {string|null}
 */
export function getPassageQuestionFirestoreId(sections, sectionIndex, questionIndex) {
  const section = sections?.[sectionIndex]
  const question = section?.passage?.questions?.[questionIndex]
  const id = question?._id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Patch the Firestore `_id` a save just assigned back into the sections state.
 *
 * After a create/update save, questions that started with `_id:null` (freshly
 * generated, imported, or hand-added) have real Firestore doc ids — returned by
 * saveAssessmentQuestions / updateAssessmentWithQuestions as an
 * `idMap` of `{ localId, id }`. Without folding those ids back into state, the
 * next autosave sees `_id:null` again and RE-CREATES every question, so the
 * subcollection grows by N on every save (the "30 → 60 → 90" duplication).
 *
 * Matches by the stable in-memory `localId` (never persisted to Firestore) and
 * only ever fills a MISSING `_id` — it never overwrites an existing one, so a
 * stale idMap can't repoint a question at the wrong doc.
 *
 * Pure: returns a NEW sections array only when something actually changed;
 * otherwise it returns the SAME reference so callers can skip a needless
 * re-render (and the extra autosave a new reference would trigger).
 *
 * @param {object[]} sections — current sections state
 * @param {{localId?: string, id?: string}[]} idMap — assigned ids from the save
 * @returns {object[]} sections (same ref if unchanged)
 */
export function patchSectionsWithAssignedIds(sections = [], idMap = []) {
  if (!Array.isArray(sections) || !Array.isArray(idMap) || idMap.length === 0) {
    return sections
  }
  const byLocalId = new Map(
    idMap
      .filter(entry => entry && entry.localId && entry.id)
      .map(({ localId, id }) => [localId, id]),
  )
  if (byLocalId.size === 0) return sections

  const patchQuestion = (question) => {
    if (question?.localId && !question._id && byLocalId.has(question.localId)) {
      return { ...question, _id: byLocalId.get(question.localId) }
    }
    return question
  }

  let changed = false
  const next = sections.map(section => {
    if (section?.kind === 'passage') {
      const questions = section.passage?.questions || []
      let sectionChanged = false
      const patched = questions.map(question => {
        const nextQuestion = patchQuestion(question)
        if (nextQuestion !== question) sectionChanged = true
        return nextQuestion
      })
      if (!sectionChanged) return section
      changed = true
      return { ...section, passage: { ...section.passage, questions: patched } }
    }
    if (section?.kind === 'standalone') {
      const nextQuestion = patchQuestion(section.question)
      if (nextQuestion === section.question) return section
      changed = true
      return { ...section, question: nextQuestion }
    }
    return section
  })

  return changed ? next : sections
}
