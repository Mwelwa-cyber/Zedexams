/**
 * Which question types the engine can DRAW, and what happens to the rest.
 *
 * ## The failure this exists to prevent
 *
 * A dispatcher that returns `null` for a type it does not handle renders a
 * question with no way to answer it — and renders it silently, at full
 * confidence, to a learner sitting an assessment. That is the same shape as the
 * answer-key defect (#2125): not a crash, not a red test, just a learner losing
 * marks for something nobody drew.
 *
 * So the rule is: **an unrenderable type is refused loudly, never drawn empty.**
 * The dispatcher throws, the boundary above it shows a "this question could not
 * be displayed" state, and the learner is told rather than quietly failed.
 *
 * ## The list is shrink-only
 *
 * `UNSUPPORTED` is Phase 1's idiom, applied here: entries may be REMOVED as
 * renderers land, and a new entry fails `renderCoverage.test.js`. Adding a type
 * to the engine's registry without either drawing it or deciding, in a diff,
 * that it stays unsupported is exactly how a gap becomes permanent.
 *
 * Every entry states what a learner meets today, because that — not the
 * engineering reason — is what decides whether the cutover may proceed for a
 * source containing one.
 */

/** Types the engine draws today. */
export const SUPPORTED = Object.freeze(['mcq', 'tf'])

/**
 * Types the engine does NOT draw yet. Shrink-only: removing an entry is the
 * work, adding one fails the coverage test.
 *
 * The choice types came first because they are the §4 contract item — the
 * vertical A/B/C/D layout with letter badges — and because every Phase 3 source
 * produces them: learner quizzes, past-paper quizzes and `timed_quiz` games are
 * all choice questions. The past-paper canary can therefore run on the engine's
 * renderers without meeting a single unsupported type, which is what makes a
 * zero-write canary meaningful rather than a partial one.
 */
export const UNSUPPORTED = Object.freeze({
  short_answer: 'a free-text field plus the AI-marking states (pending / graded / failed)',
  short: 'the legacy short-answer spelling; grades by equality, so it is NOT the AI-marked family',
  essay: 'a long-form field with its own answer-space sizing',
  diagram: 'a free-text answer about a figure — the figure renderer is the missing half',
  numeric: 'a numeric field, and the tolerance display that goes with it',
  hotspot: 'tap-a-region on an image; needs the image renderer and pointer capture',
  diagram_label: 'drag-or-tap markers on a figure',
  fill: 'the legacy single-blank spelling',
  fill_blanks: 'per-blank inputs aligned to the underscore runs in the statement',
  matching: 'two columns, with a per-row choice of which right-hand item pairs with each left',
  sequence: 'items the learner reorders into the right sequence, by drag or by position',
})

/** Can the engine draw this type? */
export function canRender(type) {
  return SUPPORTED.includes(type)
}

/**
 * The reason a type is not drawn, or null if it is.
 *
 * Returned rather than thrown so a caller deciding whether a whole assessment
 * is renderable — a cutover gate, say — can ask without exception handling.
 */
export function unsupportedReason(type) {
  if (canRender(type)) return null
  return UNSUPPORTED[type] ?? 'not a canonical question type'
}

/**
 * Every type in an assessment the engine cannot draw.
 *
 * This is the question a cutover asks: not "is this type supported" but "can
 * this learner be shown this whole paper". A source that can produce one
 * unsupported type must not be flipped, however well the rest renders.
 */
export function unrenderableTypes(assessment) {
  const out = []
  for (const question of assessment?.questions ?? []) {
    if (!canRender(question.type) && !out.includes(question.type)) out.push(question.type)
  }
  return out
}
