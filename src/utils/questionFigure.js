/**
 * One answer to "what figure does this question have, and where does it go".
 *
 * A question's figure can be a parametric LIBRARY DIAGRAM
 * (`imageDiagram.libraryKey`, drawn as inline SVG by DiagramSvg) or an
 * UPLOADED IMAGE (`imageUrl`), and `imagePosition` says where it sits relative
 * to the question text. Four surfaces render a question for a reader, and
 * before this module each had its own partial answer:
 *
 *   surface                    diagram   position
 *   QuizRunnerV2               yes       yes
 *   PublicQuizRunner           yes       NO
 *   DailyExamRunner            NO        yes
 *   QuizEditorPreviewPanel     NO        yes
 *
 * So a library-diagram question showed no figure at all in the editor preview
 * or a daily exam (BUG_REPORT RENDER-001), and a positioned question rendered
 * above-the-text on the public papers runner regardless of the choice — the
 * gap #2204 left behind when it described the problem as having three
 * surfaces. Copying the rules a fourth time is how that stays true, so the
 * rules live here and each surface renders the result with its own components.
 *
 * What this module does NOT own: how a figure is PRESENTED. The four surfaces
 * legitimately differ — ZoomableImage vs a plain <img>, theme-aware borders vs
 * the runner's hard slate, 80vh vs 72 vs 60vh caps — and collapsing that would
 * be a redesign, not a de-duplication. It also does not own per-surface
 * suppression: QuizRunnerV2 hides the plain figure for `diagram_label`
 * questions because its ANSWER UI draws a marked-up copy, which is a fact
 * about that surface's answer input rather than about the question.
 *
 * Pure: no React, no DOM, no Firebase. Tested by questionFigure.test.js.
 */

// Wrapper classes per position. `above` and `inline` deliberately map to the
// same plain stack the field's absence always produced — `inline` is accepted
// and stored but has never had a distinct rendering, and inventing one here
// would change existing papers silently.
export const IMAGE_POSITION_CLASSES = {
  above: 'flex flex-col gap-3',
  below: 'flex flex-col-reverse gap-3',
  left: 'flex flex-col gap-3 sm:flex-row sm:items-start',
  right: 'flex flex-col gap-3 sm:flex-row-reverse sm:items-start',
  inline: 'flex flex-col gap-3',
}

// The positions that keep the original stacked DOM rather than introducing a
// flex wrapper. Kept as data so `usesFigurePositionWrapper` and any future
// reader agree by construction.
const STACKED_POSITIONS = new Set(['above', 'inline'])

/**
 * Wrapper classes for a position. An unknown or absent value falls back to
 * `above` — the layout that existed before the field did, so bad data degrades
 * to the historical rendering rather than to no rendering.
 */
export function imagePositionClasses(value) {
  return IMAGE_POSITION_CLASSES[value] || IMAGE_POSITION_CLASSES.above
}

/**
 * Should this question's figure be wrapped in a position container at all?
 *
 * False for the stacked positions AND whenever there is no figure — a wrapper
 * around nothing would emit an empty flex box that still eats the parent's
 * vertical rhythm, and `data-image-position` on it would claim a layout the
 * question does not actually have.
 */
export function usesFigurePositionWrapper(position, hasFigure) {
  if (!hasFigure) return false
  if (!position) return false
  return !STACKED_POSITIONS.has(position)
}

/**
 * What figure does this question carry?
 *
 * Returns a discriminated descriptor rather than a boolean pair so a caller
 * cannot render both, and so "which one wins" is answered once. A library
 * diagram beats an uploaded image when both are set: the editor enforces
 * mutual exclusivity, so that only happens with stale Firestore data, and the
 * diagram is the authored intent (a leftover `imageUrl` is what the diagram
 * replaced).
 *
 * A diagram is only recognised when it carries a `libraryKey` — the field is
 * sometimes present as `{}` or with only `params`, which renders nothing.
 */
export function resolveQuestionFigure(question) {
  const libraryKey = question?.imageDiagram?.libraryKey
  if (libraryKey) {
    return {
      kind: 'diagram',
      libraryKey: String(libraryKey),
      params: question.imageDiagram.params || {},
      imageUrl: '',
    }
  }
  const imageUrl = question?.imageUrl
  if (imageUrl) {
    return { kind: 'image', libraryKey: '', params: null, imageUrl: String(imageUrl) }
  }
  return { kind: 'none', libraryKey: '', params: null, imageUrl: '' }
}

/** Convenience predicate — `resolveQuestionFigure(q).kind !== 'none'`. */
export function hasQuestionFigure(question) {
  return resolveQuestionFigure(question).kind !== 'none'
}
