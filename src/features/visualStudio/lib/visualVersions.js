/**
 * Visual Studio — label + version logic (pure, dependency-free).
 *
 * A "label" placed on a diagram is `{ id, x, y, text, letter }`:
 *   • x, y   — 0..1 ratios of the image box (so a label stays anchored when
 *              the image is resized between editor / PDF / DOCX).
 *   • text   — the full term, e.g. "Trachea".
 *   • letter — the exam letter shown to learners, e.g. "Q". Zambian papers
 *              conventionally start at P, Q, R… (not A or 1), so that's the
 *              default sequence.
 *
 * From one set of labels we derive three printable versions (item 5 of the
 * brief):
 *   • teacher    — the diagram shows the full words.
 *   • learner    — the diagram shows P, Q, R; blank "P: ____" lines print below.
 *   • answerKey  — same letters on the diagram + a "P = Trachea" legend.
 * plus a label-free "picture" version.
 *
 * These helpers decide WHAT text to bake onto each version and build the
 * question-field patch handed to Assessment Studio — they do not draw pixels
 * (that's VisualCanvas) so they stay unit-testable under plain `node`.
 */

// Exam-style letter sequence — Zambian papers start at P.
export const LETTER_SEQUENCE = [
  'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
]

export const VERSIONS = ['teacher', 'learner', 'answerKey', 'picture']

function clampRatio(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

let _labelCounter = 0
function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `lbl-${crypto.randomUUID()}`
  }
  _labelCounter += 1
  return `lbl-${Date.now()}-${_labelCounter}`
}

/**
 * Assign exam letters (P, Q, R…) to a list of labels in array order,
 * returning a NEW array (does not mutate input). Letters already present are
 * overwritten so the sequence is always contiguous and gap-free.
 */
export function assignLetters(labels = []) {
  return labels.map((label, i) => ({
    ...label,
    letter: LETTER_SEQUENCE[i] || `#${i + 1}`,
  }))
}

/** Create a normalised label object from a partial. */
export function makeLabel({ x, y, text = '', letter } = {}) {
  return {
    id: nextId(),
    x: clampRatio(x),
    y: clampRatio(y),
    text: String(text || '').slice(0, 80),
    letter: letter || '',
  }
}

/**
 * What text should be drawn on the image for a given label + version.
 *   • teacher          → the full word
 *   • learner / answerKey → the exam letter
 *   • picture          → nothing (label-free image)
 * @returns {string}
 */
export function labelTextForVersion(label, version) {
  if (!label) return ''
  if (version === 'picture') return ''
  if (version === 'teacher') return String(label.text || label.letter || '')
  // learner + answerKey show the letter on the diagram
  return String(label.letter || '')
}

/** Build the "P = Trachea" answer-key legend lines. */
export function answerKeyLines(labels = []) {
  return assignLetters(labels)
    .filter((l) => String(l.text || '').trim())
    .map((l) => `${l.letter} = ${String(l.text).trim()}`)
}

/** Just the letters, e.g. ['P','Q','R'] — used for blank answer rows. */
export function blankLabelsFor(labels = []) {
  return assignLetters(labels).map((l) => l.letter)
}

/**
 * Default instruction for an assessment-style diagram question.
 */
export const DEFAULT_DIAGRAM_INSTRUCTION =
  'Study the diagram below and answer the questions that follow.'

/**
 * Build the Assessment-Studio question patch for a diagram + its labels.
 *
 * The flat PNG (with letters already baked in for the learner/answer-key
 * version) is passed as `imageUrl` — so the image is a single raster that
 * cannot "fall out" of a PDF/DOCX export. The blank "P: ____" rows and the
 * answer-key legend are real question fields, kept separate from the image so
 * the questions are never trapped inside the picture (item 3 of the brief).
 *
 * @returns {object} a patch to spread onto a question object.
 */
export function buildQuestionPatch({
  imageUrl,
  imageAlt = '',
  imageWidth = 'full',
  labels = [],
  version = 'learner',
  instruction = DEFAULT_DIAGRAM_INSTRUCTION,
  caption = '',
} = {}) {
  const lettered = assignLetters(labels)
  const hasLabels = lettered.length > 0
  const wantsBlanks = hasLabels && (version === 'learner' || version === 'answerKey')

  const patch = {
    imageUrl: String(imageUrl || ''),
    imageAlt: String(imageAlt || '').slice(0, 300),
    imageWidth: imageWidth || 'full',
    diagramText: String(caption || '').slice(0, 200),
    text: String(instruction || DEFAULT_DIAGRAM_INSTRUCTION),
  }

  if (wantsBlanks) {
    patch.answerFormat = 'labelled_blanks'
    patch.blankLabels = lettered.map((l) => l.letter)
  }

  // The answer key always travels with the question so the marking copy shows
  // the terms even when the learner sheet hides them.
  const keyLines = answerKeyLines(lettered)
  if (keyLines.length) {
    patch.explanation = keyLines.join('; ')
  }

  return patch
}
