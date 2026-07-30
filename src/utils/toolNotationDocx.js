/**
 * The Word half of the worksheet/homework notation rendering.
 *
 * Maps the SAME typed parts toolNotationRender parses into `docx` runs and
 * paragraphs, so the print window and the Word download cannot disagree about
 * what a string means. Fractions follow the assessment exporter's settled
 * decision (see fractionRuns in assessmentToDocx.js): superscript numerator,
 * U+2044 fraction slash, subscript denominator — the form Word renders
 * dependably as text a teacher can still edit. Column sums are right-aligned
 * tabular paragraphs with a rule row, the way learners set out working.
 *
 * Separate from toolNotationRender.js so the React views can use the HTML
 * half without pulling the 2MB `docx` dependency into their bundle.
 */

import { AlignmentType, Paragraph, TextRun } from 'docx'
import { sanitizeXmlText } from './xmlText.js'
import { hasToolMarkup, parseMarkupBlocks } from './toolNotationRender.js'

const FRACTION_SLASH = '⁄'

/** Inline parts → TextRun[], all carrying the caller's base options. */
export function inlineMarkupRuns(parts, baseOpts = {}) {
  const runs = []
  for (const part of parts) {
    if (part.type === 'text') {
      runs.push(new TextRun({ text: sanitizeXmlText(part.value), ...baseOpts }))
    } else if (part.type === 'script') {
      runs.push(new TextRun({
        text: sanitizeXmlText(part.value),
        ...baseOpts,
        ...(part.script === 'sub' ? { subScript: true } : { superScript: true }),
      }))
    } else if (part.type === 'fraction') {
      if (part.whole) runs.push(new TextRun({ text: sanitizeXmlText(part.whole), ...baseOpts }))
      runs.push(new TextRun({ text: sanitizeXmlText(part.num), ...baseOpts, superScript: true }))
      runs.push(new TextRun({ text: FRACTION_SLASH, ...baseOpts }))
      runs.push(new TextRun({ text: sanitizeXmlText(part.den), ...baseOpts, subScript: true }))
    }
  }
  return runs
}

/** A `[[vmath]]` block → the paragraphs of a set-out column sum. */
export function vmathParagraphs(attrs, baseOpts = {}) {
  const { operator, lines, answer } = attrs
  const width = Math.max(...lines.map((l) => l.length), String(answer || '').length, 4)
  const pad = (v) => String(v ?? '').padStart(width + 2, ' ')
  const out = []
  lines.forEach((value, i) => {
    const last = i === lines.length - 1
    out.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({
        text: (last ? operator : ' ') + pad(value),
        font: 'Courier New',
        ...baseOpts,
        ...(last ? { underline: {} } : {}),
      })],
      spacing: { after: 0 },
    }))
  })
  out.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [new TextRun({
      text: ' ' + pad(answer || ' '.repeat(width)),
      font: 'Courier New',
      ...baseOpts,
      underline: {},
    })],
    spacing: { after: 80 },
  }))
  return out
}

/**
 * A whole field, for a caller building one paragraph.
 *
 * Returns `{ runs, extraParagraphs }`: the first line's runs join the caller's
 * own paragraph (after its number/label runs); every later line and every
 * column sum becomes its own paragraph to append. A plain string comes back as
 * a single ordinary run, so legacy content takes exactly the old path.
 */
export function markupFieldToDocx(text, baseOpts = {}) {
  const s = String(text ?? '')
  if (!hasToolMarkup(s)) {
    return { runs: [new TextRun({ text: sanitizeXmlText(s), ...baseOpts })], extraParagraphs: [] }
  }
  const blocks = parseMarkupBlocks(s)
  let runs = []
  const extraParagraphs = []
  blocks.forEach((block, i) => {
    if (block.kind === 'vmath') {
      extraParagraphs.push(...vmathParagraphs(block.attrs, baseOpts))
    } else if (i === 0) {
      runs = inlineMarkupRuns(block.parts, baseOpts)
    } else if (block.parts.length) {
      extraParagraphs.push(new Paragraph({
        children: inlineMarkupRuns(block.parts, baseOpts),
        spacing: { after: 40 },
      }))
    }
  })
  return { runs, extraParagraphs }
}
