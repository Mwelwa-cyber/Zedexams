/**
 * normaliseScannedQuestionV2 — browser-safe ES module copy of the V2 question
 * normaliser from functions/scannedQuizImportV2.js.
 *
 * This is a pure function with no Node.js dependencies, safe to run in the
 * browser. It maps each vision-detected questionType to the correct editor type
 * and derives requiresReview from the model's confidence score.
 *
 * Kept in sync with functions/scannedQuizImportV2.js:normaliseScannedQuestionV2
 * — if you update the logic there, update this file too.
 */

// vision type → editor question type
export const VISION_TYPE_TO_EDITOR = {
  mcq: 'mcq',
  true_false: 'tf',
  fill_blanks: 'fill_blanks',
  short_answer: 'short_answer',
  matching: 'matching',
  table_fill: 'short_answer',      // uses tableData field
  label_diagram: 'diagram',
  sequence: 'sequence',
  calculation: 'numeric',
  structured: 'short_answer',      // uses subParts[]
  diagram_question: 'diagram',
  word_problem: 'short_answer',
  essay: 'essay',
}

/**
 * Normalise one Claude V2 question object into the editor-facing shape.
 *
 * Unlike the V1 normaliser (which hardcodes type='mcq' and requiresReview=true
 * for everything), V2 maps each vision-detected questionType to the correct
 * editor type and derives requiresReview from the model's own confidence score.
 *
 * @param {object} raw  - Raw question object from the Claude tool output
 * @param {object} opts
 * @param {number} opts.sourcePageIndex - 0-based page index (default 0)
 * @returns {object} Normalised question for the editor
 */
export function normaliseScannedQuestionV2(raw, { sourcePageIndex = 0 } = {}) {
  const editorType = VISION_TYPE_TO_EDITOR[raw.questionType] ?? 'mcq'
  const lowConfidence = typeof raw.confidence === 'number' && raw.confidence < 0.6
  const importWarnings = []
  if (lowConfidence) {
    importWarnings.push(`Low confidence (${(raw.confidence * 100).toFixed(0)}%) — check this question`)
  }

  const base = {
    type: editorType,
    text: raw.prompt ?? '',
    options: raw.options ?? [],
    correctAnswer: '',
    marks: raw.marks ?? 1,
    answerLines: raw.answerLines ?? 0,
    hasDiagram: raw.hasDiagram ?? false,
    diagrams: raw.diagrams ?? [],
    requiresReview: lowConfidence,
    importWarnings,
    sourcePage: sourcePageIndex,
    optionsAreImages: raw.optionsAreImages ?? false,
    optionImageBoxes: raw.optionImageBoxes ?? [],
  }

  if (editorType === 'fill_blanks') {
    base.statements = raw.statements ?? []
    base.wordBank = raw.wordBank ?? []
  } else if (editorType === 'tf') {
    base.options = ['True', 'False']
    if (raw.tfStatement) base.text = raw.tfStatement
  } else if (editorType === 'matching') {
    base.matchingLeft = raw.matchingLeft ?? []
    base.matchingRight = raw.matchingRight ?? []
  } else if (editorType === 'short_answer' && raw.questionType === 'table_fill') {
    base.tableData = {
      headers: raw.tableHeaders ?? [],
      rows: raw.tableRows ?? [],
    }
  } else if (editorType === 'short_answer' && raw.questionType === 'structured') {
    base.subParts = (raw.subParts ?? []).map(sp => ({
      label: sp.label ?? '',
      text: sp.text ?? '',
      answer: '',
      marks: sp.marks ?? 1,
      answerFormat: 'lines',
      answerLines: sp.answerLines ?? 2,
    }))
  } else if (editorType === 'diagram' && raw.questionType === 'label_diagram') {
    base.diagramMode = 'identify'
    base.diagramLabels = (raw.labelSlots ?? []).map((slot, i) => ({
      id: `slot-${i}`,
      x: 0.1 + i * 0.15,
      y: 0.5,
      text: slot.answer ?? '',
    }))
  }

  return base
}
