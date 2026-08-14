/**
 * Render the generation notation markup on the worksheet/homework surfaces.
 *
 * The Assessment Studio and the quiz editor turn the contract markup
 * (\frac{a}{b}, $…$, [[vmath]]) into rich editor nodes and render those.
 * Worksheets and homework have no editor pipeline — their documents store the
 * model's strings and their four renderers (two print windows, two DOCX
 * exporters, plus the React views) printed them verbatim, so with the prompts
 * now on the contract they would have printed raw markup, which is worse than
 * the "7/10 =" they replaced.
 *
 * This module is the one parser those surfaces share. It turns a markup string
 * into typed blocks and inline parts, and offers an HTML rendering; the DOCX
 * exporters map the same parts to their own runs, so the print window and Word
 * cannot disagree about what a string means. Reused pieces, not re-invented:
 * `latexToSegments` (the repo's only LaTeX→text converter) reads the $…$
 * bodies, and `parseVmathToken` reads the column-sum token exactly as the quiz
 * editor does.
 *
 * Plain text passes through untouched — the fast path is a string with no
 * markup in it, which is every legacy document and most sentences.
 *
 * Block vocabulary:  { kind: 'line', parts }  |  { kind: 'vmath', attrs }
 * Inline vocabulary: { type: 'text', value }
 *                  | { type: 'script', script: 'sub'|'sup', value }
 *                  | { type: 'fraction', whole, num, den }
 */

import { latexToSegments } from './latexToUnicode.js'
import { parseVmathToken } from '../shared/utils/importRichText.js'

const VMATH_LINE_RE = /^\s*\[\[\s*vmath\b([^\]]*)\]\]\s*$/i
const FRACTION_RE = /(\d+)?\\frac\{([^{}]*)\}\{([^{}]*)\}/
const DOLLAR_RE = /\$([^$]+)\$/

/** Does this string carry anything the renderers below would transform? */
export function hasToolMarkup(text) {
  const s = String(text ?? '')
  return FRACTION_RE.test(s) || DOLLAR_RE.test(s) || VMATH_LINE_RE.test(s) ||
    /\[\[\s*vmath\b/i.test(s)
}

/** One line of markup → inline parts. */
export function parseInlineMarkup(line) {
  const parts = []
  let rest = String(line ?? '')
  const pushText = (value) => {
    if (value) parts.push({ type: 'text', value })
  }
  while (rest) {
    const frac = FRACTION_RE.exec(rest)
    const dollar = DOLLAR_RE.exec(rest)
    // Take whichever construct appears first, so mixed sentences keep order.
    const next = [frac, dollar].filter(Boolean).sort((a, b) => a.index - b.index)[0]
    if (!next) {
      pushText(rest)
      break
    }
    pushText(rest.slice(0, next.index))
    if (next === frac) {
      parts.push({
        type: 'fraction',
        whole: frac[1] || '',
        num: frac[2].trim(),
        den: frac[3].trim(),
      })
    } else {
      // The $…$ body goes through the repo's LaTeX reader, which yields text
      // segments with sub/sup marked — the two things Word and print both
      // render natively. Anything it cannot model comes back as readable text.
      for (const seg of latexToSegments(dollar[1])) {
        if (!seg.text) continue
        if (seg.script) {
          // latexToSegments says 'sub' / 'super'; the HTML tags are sub / sup.
          parts.push({
            type: 'script',
            script: seg.script === 'sub' ? 'sub' : 'sup',
            value: seg.text,
          })
        }
        else pushText(seg.text)
      }
    }
    rest = rest.slice(next.index + next[0].length)
  }
  return parts
}

/** A whole field → typed blocks (lines and column sums). */
export function parseMarkupBlocks(text) {
  const blocks = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const vmath = VMATH_LINE_RE.exec(line)
    if (vmath) {
      blocks.push({ kind: 'vmath', attrs: parseVmathToken(vmath[1]) })
    } else {
      blocks.push({ kind: 'line', parts: parseInlineMarkup(line) })
    }
  }
  // Trailing blank lines render as nothing; drop them so a single-line field
  // stays a single block.
  while (blocks.length > 1) {
    const last = blocks[blocks.length - 1]
    if (last.kind === 'line' && !last.parts.length) blocks.pop()
    else break
  }
  return blocks
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline parts → HTML. The stacked fraction is real structure, not a glyph. */
export function inlinePartsToHtml(parts) {
  let out = ''
  for (const part of parts) {
    if (part.type === 'text') out += escapeHtml(part.value)
    else if (part.type === 'script') {
      out += `<${part.script}>${escapeHtml(part.value)}</${part.script}>`
    } else if (part.type === 'fraction') {
      out += (part.whole ? `<span class="tn-whole">${escapeHtml(part.whole)}</span>` : '')
        + `<span class="tn-frac"><span class="tn-num">${escapeHtml(part.num)}</span>`
        + `<span class="tn-den">${escapeHtml(part.den)}</span></span>`
    }
  }
  return out
}

/**
 * A whole field → HTML for the print windows and the React views.
 *
 * A plain string comes back escaped but otherwise untouched (no wrapper), so
 * legacy content renders exactly as it always has.
 */
export function markupToHtml(text) {
  const s = String(text ?? '')
  if (!hasToolMarkup(s)) return escapeHtml(s)
  return parseMarkupBlocks(s).map((block) => {
    if (block.kind === 'vmath') {
      const { operator, lines, answer } = block.attrs
      const rows = lines.map((value, i) =>
        `<span class="tn-va-row">${i === lines.length - 1 ? `<span class="tn-va-op">${escapeHtml(operator)}</span>` : ''}${escapeHtml(value)}</span>`,
      ).join('')
      // The rule under the operands is the answer row's top border — drawn
      // even when the answer is left for the learner, as an empty ruled row,
      // because the line is part of how a column sum is set out.
      const ans = `<span class="tn-va-row tn-va-answer">${answer ? escapeHtml(answer) : '&nbsp;'}</span>`
      return `<span class="tn-va">${rows}${ans}</span>`
    }
    return inlinePartsToHtml(block.parts)
  }).join('<br>')
}

/**
 * The stylesheet the HTML above needs, exported so both print windows embed
 * the same one. Fraction: numerator over a border over denominator, vertically
 * centred beside the text. Column sum: right-aligned rows, the operator on the
 * left of the bottom operand, a rule above the answer — the way learners set
 * out working.
 */
export const TOOL_NOTATION_CSS = `
.tn-frac{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 2px;line-height:1.1}
.tn-frac .tn-num{border-bottom:1.2px solid #1c1612;padding:0 4px}
.tn-frac .tn-den{padding:0 4px}
.tn-whole{margin-right:2px}
.tn-va{display:inline-flex;flex-direction:column;align-items:flex-end;font-variant-numeric:tabular-nums;margin:4px 0;line-height:1.35}
.tn-va-row{display:block;min-width:64px;text-align:right}
.tn-va-op{float:left;margin-right:10px}
.tn-va-answer{border-top:1.4px solid #1c1612;margin-top:2px;padding-top:2px}
`
