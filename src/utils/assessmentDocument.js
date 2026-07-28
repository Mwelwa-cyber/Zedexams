/**
 * The canonical AssessmentDocument — the one object every renderer of a paper
 * is handed.
 *
 * ## What it is
 *
 * A resolved, rendering-agnostic description of a finished paper:
 *
 *     { version, mode, meta, layout, marks, choices, blocks, pageNumbering }
 *
 * `blocks` is the typed block list `assessmentPaperLayout` has always produced —
 * that part was already shared, and it is not being replaced. What the document
 * adds is everything the renderers were each deciding for themselves:
 *
 *   - `layout`  the resolved layout tokens (page, margins, fonts, spacing) so no
 *               renderer carries a literal
 *   - `meta`    the identifying strings, formatted exactly as they print
 *   - `marks`   question → section → paper totals, computed once
 *   - `choices` the answer-choice count that applies
 *
 * and one thing the block list never had: a stable `index` on every block, so a
 * measurement taken in one renderer can be mapped onto another. That is what
 * makes a paginated PREVIEW possible — the pages are measured in the print
 * renderer, and the preview draws the same blocks grouped by the same indices,
 * so "the preview shows the same number of pages as the PDF" is a property of
 * the data rather than a coincidence of two stylesheets.
 *
 * ## Four renderers, one document
 *
 * The in-studio preview, the print window, the PDF that comes out of it and the
 * Word export all consume this. The marking key is the same document built with
 * `mode: 'scheme'` — not a fifth renderer and not a second layout, which is what
 * §2's "do not generate a second independent question layout for Word" is
 * guarding against.
 *
 * ## Backward compatibility
 *
 * Every input field is optional and every default reproduces what the paper did
 * before this module existed. A saved assessment loads, resolves and renders
 * without carrying a single one of the new fields. That is deliberate and it is
 * tested: teacher content is never rewritten on read.
 */

import { buildPaperLayout, buildPaperTitle, buildFooterCode } from './assessmentPaperLayout.js'
import { resolvePaperLayout } from '../config/paperLayoutTokens.js'
import { buildPaperMetadata } from './paperMetadata.js'
import { computeMarksModel } from './paperMarksModel.js'
import { paperChoiceSettings } from './mcqChoices.js'

export const ASSESSMENT_DOCUMENT_VERSION = 'assessment-document.v1'

/**
 * Page numbering, and why it is a document-level decision.
 *
 * The footer is drawn by three renderers with three different mechanisms (a
 * fixed element in print, a `<tfoot>` reservation for the flow, a real Word
 * footer part), and each of them has to be told the same thing about whether to
 * number the page and how. A renderer deciding on its own is how the Word export
 * came to have page numbers the PDF did not.
 */
export function resolvePageNumbering(assessment = {}) {
  const show = assessment.showPageNumbers !== false
  const format = String(assessment.pageNumberFormat || 'page-of-total').trim()
  return {
    show,
    format: format === 'page-only' ? 'page-only' : 'page-of-total',
    /** Rendered by every renderer through this one function. */
    label: (page, total) => (format === 'page-only' ? `Page ${page}` : `Page ${page} of ${total}`),
  }
}

/**
 * The layout preferences a paper carries, gathered from wherever they are
 * stored.
 *
 * A paper may have them under a `layout` object (new papers) or as loose
 * top-level fields (papers saved by the studio before the object existed). Both
 * are read, the object winning, so a paper does not have to be migrated to be
 * rendered correctly.
 */
export function readLayoutPreferences(assessment = {}) {
  const nested = assessment.layout && typeof assessment.layout === 'object' ? assessment.layout : {}
  return {
    pageSize: nested.pageSize ?? assessment.pageSize,
    orientation: nested.orientation ?? assessment.orientation,
    margins: nested.margins ?? assessment.margins ?? assessment.marginPreset,
    bodyFont: nested.bodyFont ?? assessment.bodyFont,
    headingFont: nested.headingFont ?? assessment.headingFont,
    bodySize: nested.bodySize ?? assessment.bodySize ?? assessment.fontSize,
    lineSpacing: nested.lineSpacing ?? assessment.lineSpacing,
    spacing: nested.spacing ?? assessment.questionSpacing,
    optionIndent: nested.optionIndent ?? assessment.optionIndent,
  }
}

/**
 * Build the canonical document.
 *
 * @param {object} assessment the saved-or-in-progress paper
 * @param {Array}  questions  the flat ordered question list
 * @param {object} opts       {mode: 'paper' | 'scheme'}
 */
export function buildAssessmentDocument(assessment = {}, questions = [], { mode = 'paper' } = {}) {
  const resolvedMode = mode === 'scheme' ? 'scheme' : 'paper'
  const layout = resolvePaperLayout(readLayoutPreferences(assessment))
  const meta = buildPaperMetadata(assessment)
  const marks = computeMarksModel(assessment, questions)
  const choices = paperChoiceSettings(assessment)

  // The layout is built with the resolved context so a block carries its OWN
  // marks, choice count and figure box rather than a renderer re-deriving them.
  const blocks = buildPaperLayout(assessment, questions, {
    mode: resolvedMode,
    context: { layout, meta, marks, choices },
  })

  return {
    version: ASSESSMENT_DOCUMENT_VERSION,
    mode: resolvedMode,
    meta: {
      ...meta,
      title: buildPaperTitle(assessment),
      footerCode: assessment.footerCode || buildFooterCode(assessment),
    },
    layout,
    marks,
    choices,
    pageNumbering: resolvePageNumbering(assessment),
    blocks: indexBlocks(blocks),
    totalMarks: marks.totalMarks,
    questionCount: blocks.filter((b) => b.kind === 'question').length,
  }
}

/**
 * Stamp a stable index on every block.
 *
 * The index is the block's position in the document and nothing else, which is
 * exactly what makes it usable as a join key: the print renderer emits blocks in
 * this order, the preview renders them in this order, so a page assignment
 * measured in one applies to the other. An id derived from content would change
 * when the content changed and the mapping would break on the edit that most
 * needs it.
 */
export function indexBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).map((block, index) => (
    block && block.index === index ? block : { ...block, index }
  ))
}

/**
 * The blocks that flow in the paper's body.
 *
 * The paper code is not one: in print it is a fixed element repeated on every
 * sheet, so it contributes no height to the flow. `assessmentToPdf` has always
 * made this distinction; it is exported here so the preview makes the same one
 * rather than drawing the code as a block at the end of the last page.
 */
export function isBodyBlock(block) {
  return block?.kind !== 'footerCode'
}

/** The document's body blocks, in order, with their indices intact. */
export function bodyBlocks(document) {
  return (document?.blocks || []).filter(isBodyBlock)
}
