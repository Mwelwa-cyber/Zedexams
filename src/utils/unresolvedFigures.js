/**
 * A figure the paper asked for and did not get.
 *
 * ## Why this is its own module
 *
 * The record and its sentence were born inside `assessmentToDocx.js`, which is
 * the right place to DETECT the failure and the wrong place to keep the
 * vocabulary: the export gate has to say the same sentence about the same
 * failure BEFORE any of that runs, and importing the Word exporter into a
 * readiness check would pull `docx` into the studio's first paint. So the record
 * shape and the sentence live here, where both the gate and the exporter can
 * reach them, and neither owns the wording.
 *
 * That matters more than tidiness. Two modules each phrasing "the figure is
 * missing" in their own words is how a teacher ends up told one thing by a
 * banner and a different thing by a toast about the same question.
 *
 * ## What counts as unresolved
 *
 * Not "the figure looks wrong" — that is a quality warning and belongs with the
 * printability advisories. Unresolved means the paper declares a figure and the
 * renderer produced NONE: a placeholder, or nothing at all. A learner asked to
 * label a diagram that is not there cannot answer the question, so this is a
 * correctness failure and the export must not proceed.
 *
 * ## The stages, and which are knowable before rendering
 *
 *   catalog    the diagram is not in the catalog, or drew nothing.
 *              KNOWABLE STATICALLY — same call the exporters make, no document
 *              needed. This is what lets the gate refuse before the click.
 *   rasterise  the SVG would not turn into pixels (no canvas, no browser).
 *   embed      the bytes would not go into the file.
 *   composite  the label layer would not draw onto the figure. The figure still
 *              embeds, so this one is invisible in a page count and visible
 *              only here.
 *
 * The last three are properties of a render in progress and cannot be predicted;
 * the gate covers them by refusing to DELIVER a file that carries one.
 */

/** Every stage a figure can fail at, in the order the exporter reaches them. */
export const FIGURE_STAGES = Object.freeze(['catalog', 'rasterise', 'embed', 'composite'])

/** The stage a readiness check can decide without rendering anything. */
export const STATIC_STAGE = 'catalog'

/**
 * Normalise one unresolved-figure record.
 *
 * Every producer goes through here so the gate never has to ask whether a record
 * came from a static check or from a half-built document.
 */
export function unresolvedFigure(detail = {}) {
  return {
    kind: detail.kind || 'library_diagram',
    questionNumber: detail.questionNumber ?? null,
    questionId: detail.questionId ?? null,
    diagramKey: detail.diagramKey ?? null,
    stage: detail.stage || 'unknown',
    reason: detail.reason || '',
    // Kept alongside the identifiers because the placeholder prints it, and a
    // reviewer matching a diagnostic to a page needs the same words.
    label: detail.label || '',
  }
}

/** The one sentence the studio, the gate and the toast all show a teacher. */
export function unresolvedFigureMessage(entry) {
  const which = entry?.questionNumber != null
    ? `Question ${entry.questionNumber} requires a diagram`
    : 'A question on this paper requires a diagram'
  return `${which}, but the figure could not be rendered. `
    + 'Replace, regenerate or repair the diagram before exporting.'
}

/**
 * The sentence for a whole set, naming the first question and counting the rest.
 *
 * One unresolved figure gets the exact sentence above — a teacher fixing one
 * diagram should not have to parse a summary. More than one still leads with a
 * question number, because "3 figures could not be rendered" tells them nothing
 * about where to go.
 */
export function unresolvedFiguresMessage(entries = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  if (list.length === 0) return ''
  const first = unresolvedFigureMessage(list[0])
  if (list.length === 1) return first
  const others = list.length - 1
  return `${first} ${others === 1 ? '1 other figure' : `${others} other figures`} `
    + `on this paper ${others === 1 ? 'has' : 'have'} the same problem.`
}

/**
 * Every figure this paper declares that the catalog cannot draw.
 *
 * The resolver is injected rather than imported so this stays testable without a
 * catalog, and so the caller passes the SAME resolver the exporter will use — a
 * check against a different drawing function would be a check of nothing.
 *
 * @param {Array} questions        the paper's questions, in display order
 * @param {(key: string, params: object) => any} resolve  returns falsy when the
 *        catalog cannot draw the diagram
 * @returns {Array} unresolved-figure records, stage 'catalog'
 */
export function unresolvedRequiredFigures(questions = [], resolve) {
  if (typeof resolve !== 'function') {
    throw new TypeError('unresolvedRequiredFigures needs the resolver the exporter uses')
  }
  const out = []
  const list = Array.isArray(questions) ? questions : []
  list.forEach((question, index) => {
    if (!question) return
    // Position, because that is exactly how the studio numbers questions
    // (`buildQuestionNumberMap` is `index + 1` over this same serialized list).
    // Reading a field such as `order` instead would be a second numbering that
    // agrees with the printed page only until the two drift.
    const number = index + 1
    for (const [kind, diagram] of declaredFigures(question)) {
      const key = diagram?.libraryKey
      if (!key) continue
      let drawn = null
      try {
        drawn = resolve(key, diagram.params || {})
      } catch (err) {
        // A resolver that throws is a catalog that cannot draw it, which is the
        // same answer as one that returns nothing — and never a reason to let
        // the export through.
        drawn = null
        out.push(unresolvedFigure({
          kind,
          questionNumber: number,
          questionId: question.id ?? null,
          diagramKey: key,
          stage: STATIC_STAGE,
          reason: err?.message || 'the diagram could not be drawn',
          label: diagram.label || '',
        }))
        continue
      }
      if (drawn) continue
      out.push(unresolvedFigure({
        kind,
        questionNumber: number,
        questionId: question.id ?? null,
        diagramKey: key,
        stage: STATIC_STAGE,
        reason: 'the diagram is not in the catalog, or it rendered nothing',
        label: diagram.label || '',
      }))
    }
  })
  return out
}

/**
 * The library diagrams one question declares, paired with the kind the exporter
 * records them as.
 *
 * Kept beside the resolver because the two must agree: a figure the exporter
 * draws and this does not look for is a figure the gate cannot protect.
 */
function declaredFigures(question) {
  const found = []
  if (question.imageDiagram?.libraryKey) found.push(['library_diagram', question.imageDiagram])
  for (const option of question.options || []) {
    if (option?.imageDiagram?.libraryKey) found.push(['option_diagram', option.imageDiagram])
  }
  return found
}
