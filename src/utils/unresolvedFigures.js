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

/**
 * "3", "3 and 7", "3, 7 and 9" — plain prose, never "Q3, Q7".
 *
 * Lives here rather than in the export gate because the gate imports this
 * module, so the other direction would be a cycle — and because the sentence
 * that needs it is here. The gate re-exports it, so its own callers are
 * unchanged and there is still exactly one implementation.
 */
export function listNumbers(numbers = []) {
  if (numbers.length === 0) return ''
  if (numbers.length === 1) return String(numbers[0])
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
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
 * The affected question numbers: distinct, ascending, and never question 0.
 *
 * `questionNumber == null` is rejected BEFORE the cast, because Number(null) is
 * 0 — a finite number, and question 0 does not exist. Uncaught, an unnumbered
 * figure badges the first card on the paper.
 */
export function affectedQuestionNumbers(entries = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  return [...new Set(
    list
      .filter((f) => f.questionNumber != null)
      .map((f) => Number(f.questionNumber))
      .filter((n) => Number.isFinite(n)),
  )].sort((a, b) => a - b)
}

/**
 * The sentence for a whole set, driven by the SAME numbers the gate badges.
 *
 * It used to lead with whichever entry happened to be first in the array while
 * the gate sorted and de-duplicated its numbers, so a paper could badge
 * questions 2 and 9 under a message that opened "Question 9 requires a
 * diagram". Both now come from `affectedQuestionNumbers`, which is the only way
 * they cannot disagree.
 *
 * Counting FIGURES would be the wrong unit: two broken diagrams on question 5
 * are one question to go and fix, and "2 figures could not be rendered" sends a
 * teacher looking for a second problem that is not there.
 */
export function unresolvedFiguresMessage(entries = []) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  if (list.length === 0) return ''
  const numbers = affectedQuestionNumbers(list)
  const unnumbered = list.length - list.filter((f) => f.questionNumber != null).length

  // Nothing is numbered: the generic form, unchanged.
  if (numbers.length === 0) return unresolvedFigureMessage({ questionNumber: null })
  // One question and nothing unaccounted for: the exact approved sentence.
  if (numbers.length === 1 && unnumbered === 0) {
    return unresolvedFigureMessage({ questionNumber: numbers[0] })
  }
  // One named question plus something this record cannot place. Naming only the
  // one would quietly drop the other, and a teacher who fixes question 5 would
  // meet the same block again with no idea why.
  const subject = numbers.length === 1
    ? `Question ${numbers[0]} and another question on this paper`
    : `Questions ${listNumbers(numbers)}`
  return `${subject} require diagrams, but the figures could not be rendered. `
    + 'Replace, regenerate or repair the diagrams before exporting.'
}

/**
 * Every figure this paper declares that the catalog cannot draw.
 *
 * The resolver is injected rather than imported so this stays testable without a
 * catalog, and so the caller passes the SAME resolver the exporter will use — a
 * check against a different drawing function would be a check of nothing.
 *
 * Takes the whole serialized paper rather than just its questions, because a
 * passage carries its own stimulus diagram in a separate array and the DOCX and
 * print renderers both draw it. Checking only the questions left every
 * diagram/map/source passage unprotected.
 *
 * @param {{questions: Array, passages: Array}|Array} paper  the serialized paper,
 *        or just its questions (accepted so a caller with no passages stays
 *        simple)
 * @param {(key: string, params: object) => any} resolve  returns falsy when the
 *        catalog cannot draw the diagram
 * @returns {Array} unresolved-figure records, stage 'catalog'
 */
export function unresolvedRequiredFigures(paper = [], resolve) {
  if (typeof resolve !== 'function') {
    throw new TypeError('unresolvedRequiredFigures needs the resolver the exporter uses')
  }
  const questions = Array.isArray(paper) ? paper : (paper?.questions || [])
  const passages = Array.isArray(paper) ? [] : (paper?.passages || [])
  const out = []

  const check = (diagram, record) => {
    const key = diagram?.libraryKey
    if (!key) return
    let drawn = null
    try {
      drawn = resolve(key, diagram.params || {})
    } catch (err) {
      // A resolver that throws is a catalog that cannot draw it, which is the
      // same answer as one that returns nothing — and never a reason to let the
      // export through.
      out.push(unresolvedFigure({
        ...record, diagramKey: key, stage: STATIC_STAGE,
        reason: err?.message || 'the diagram could not be drawn',
      }))
      return
    }
    if (drawn) return
    out.push(unresolvedFigure({
      ...record, diagramKey: key, stage: STATIC_STAGE,
      reason: 'the diagram is not in the catalog, or it rendered nothing',
    }))
  }

  ;(Array.isArray(questions) ? questions : []).forEach((question, index) => {
    if (!question) return
    // Position, because that is exactly how the studio numbers questions
    // (`buildQuestionNumberMap` is `index + 1` over this same serialized list).
    // Reading a field such as `order` instead would be a second numbering that
    // agrees with the printed page only until the two drift.
    const number = index + 1
    const base = { questionNumber: number, questionId: question.id ?? null }
    check(question.imageDiagram, { ...base, kind: 'library_diagram' })
    // Option diagrams live in `optionMedia[i].diagram`, NOT on the option
    // itself — that is the shape `assessmentToDocx` reads and the studio
    // writes. Looking at `options[i].imageDiagram` found nothing at all, which
    // is the worst possible outcome for a check: it reports every paper clean.
    for (const media of question.optionMedia || []) {
      check(media?.diagram, { ...base, kind: 'option_diagram' })
    }
  })

  for (const passage of Array.isArray(passages) ? passages : []) {
    if (!passage) continue
    // A passage has no question number — the exporter records its diagram the
    // same way, with the title as the label — so the sentence falls back to the
    // generic form rather than naming a question that does not exist.
    check(passage.imageDiagram, {
      kind: 'library_diagram',
      questionNumber: null,
      questionId: passage.id ?? null,
      label: passage.imageAlt || passage.title || '',
    })
  }
  return out
}

/**
 * A refused export, as an error rather than a return value.
 *
 * Returning `{delivered: false}` put the burden on every caller to look, and the
 * two library export routes did not: they awaited the download and toasted
 * "Paper download started" over a file that was never written. A caller that
 * does nothing must fail loudly, not quietly succeed — both of those routes
 * already wrap the export in a try/catch that surfaces the message.
 */
export class UnresolvedFigureError extends Error {
  constructor(entries = []) {
    super(unresolvedFiguresMessage(entries))
    this.name = 'UnresolvedFigureError'
    this.code = 'unresolved-figure'
    this.entries = entries
  }
}
