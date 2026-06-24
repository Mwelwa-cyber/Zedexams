/**
 * src/utils/diagramLabelGrading.js
 *
 * Shared helpers for the "Label the Diagram" question type
 * (`type: 'diagram_label'`). The teacher uploads an image and drops numbered
 * markers on the parts to be named; each marker carries the correct label
 * text. The learner sees the image with the numbers and types the name of
 * each part into a numbered blank below.
 *
 *   {
 *     type: 'diagram_label',
 *     imageUrl: 'https://…/my-plate.png',
 *     diagramMode: 'identify',                 // numbers on the image
 *     diagramLabels: [
 *       { x: 0.20, y: 0.30, text: 'Protein' },        // marker 1
 *       { x: 0.55, y: 0.18, text: 'Grains' },         // marker 2
 *       { x: 0.50, y: 0.70, text: 'Vegetable/Vegetables' }, // marker 3 (variants)
 *     ],
 *   }
 *
 * Markers live in the same `diagramLabels` array the labelled-diagram /
 * image-identify questions already use — here a marker's `text` is the
 * EXPECTED ANSWER for that numbered part rather than a caption printed on the
 * image. Only markers with non-empty text are gradeable; an empty marker is
 * skipped (it can never be matched and would make the question impossible to
 * complete), so the runner and the grader both walk the same "active" list and
 * stay index-aligned.
 *
 * Grading is deterministic (no AI) and reuses `fillBlankMatches` from
 * fillBlanks.js — so a typed answer is matched case-insensitively,
 * whitespace-tolerantly, and an expected label may list interchangeable
 * variants separated by `/` or `|` ("Vegetable/Vegetables").
 *
 * Pure + dependency-light (only the fill-blanks matcher) so it can be
 * unit-tested with plain `node` and shared across the editor, the learner
 * quiz runner and the scorer without dragging in React or Firebase.
 */

import { fillBlankMatches } from './fillBlanks.js'

/**
 * The markers that count: those with non-empty answer text, in author order.
 * Returns one entry per gradeable marker with its on-image position, the
 * 1-based number shown to the learner, and the flat index its answer occupies
 * in the learner-response array.
 */
export function diagramLabelLayout(question) {
  const labels = Array.isArray(question?.diagramLabels) ? question.diagramLabels : []
  const out = []
  for (const label of labels) {
    const text = String(label?.text ?? '').trim()
    if (!text) continue
    const x = Number(label?.x)
    const y = Number(label?.y)
    out.push({
      index: out.length,
      number: out.length + 1,
      x: Number.isFinite(x) ? x : 0.5,
      y: Number.isFinite(y) ? y : 0.5,
      text,
    })
    if (out.length >= 20) break
  }
  return out
}

/**
 * Flat answer key: the expected label text for each gradeable marker, in the
 * same order the learner-response array is aligned to.
 */
export function diagramLabelAnswerKey(question) {
  return diagramLabelLayout(question).map(label => label.text)
}

/** True when a diagram-label question has at least one gradeable marker. */
export function hasDiagramLabelContent(question) {
  return diagramLabelLayout(question).length > 0
}

/**
 * Grade a diagram-label response deterministically (no AI — the answer key is
 * exact). `response` is a flat array of learner strings aligned to
 * `diagramLabelAnswerKey(question)`.
 *
 * Returns { totalLabels, correctLabels, perLabel: boolean[], allCorrect }.
 */
export function gradeDiagramLabels(question, response) {
  const key = diagramLabelAnswerKey(question)
  const resp = Array.isArray(response) ? response : []
  const perLabel = key.map((expected, i) => fillBlankMatches(expected, resp[i]))
  const totalLabels = key.length
  const correctLabels = perLabel.filter(Boolean).length
  return {
    totalLabels,
    correctLabels,
    perLabel,
    allCorrect: totalLabels > 0 && correctLabels === totalLabels,
  }
}
