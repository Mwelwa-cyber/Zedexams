/**
 * The question stem and the answer choices are two fields, and papers exist in
 * which they are one and a half.
 *
 * ## The defect
 *
 * A generated or imported question arrives with its choices baked into the end
 * of the stem — "Which organ pumps blood? A. Lung B. Heart C. Liver D. Kidney" —
 * AND stored separately in `options`. Every renderer draws the stem and then
 * draws the option list, so the learner reads the choices twice, once as prose
 * and once as a list. On question 13 of the paper that prompted this work the
 * inline run wrapped mid-line and the printed list started at B, which is the
 * version of this bug a teacher notices at the photocopier.
 *
 * ## Why removal has to be conservative
 *
 * The obvious fix — strip anything matching `A. … B. … C. …` — deletes real
 * content. A comprehension question legitimately says "Arrange in order: A. seed
 * B. seedling C. tree", and a labelling question's stem legitimately names the
 * parts. Both look exactly like the defect.
 *
 * What distinguishes the defect is not the SHAPE of the run but its
 * RELATIONSHIP to the stored options: the run duplicates a list the question
 * already has. So a run is only removed when the question has structured options
 * and the run's items are those options. A run with nothing to duplicate is
 * either the question's real content or the ONLY copy of its choices, and
 * deleting either loses teacher content — this module reports those and changes
 * nothing.
 *
 * ## What it does to the stored value
 *
 * A stem can be a plain string, print HTML, or Tiptap JSON, and the run has to
 * be removed from whichever it is. When the removal cannot be performed
 * confidently on the stored shape, the result says so (`applied: false`) rather
 * than falling back to the plain-text version and throwing away the stem's
 * formatting.
 */

import { richTextToPlainText } from '../../../utils/quizRichText.js'
import { normalizeOptionText, OPTION_LETTERS } from '../../../utils/mcqChoices.js'

/** The most items an inline run may carry before it stops looking like choices. */
const MAX_RUN_ITEMS = 8
/** An "option" longer than this is prose, not a choice. */
const MAX_ITEM_CHARS = 200
/** Fewer than this and the run is a sentence that happens to start with "A.". */
const MIN_RUN_ITEMS = 2

/**
 * Find a trailing run of labelled items in a plain-text stem.
 *
 * Returns `null` when there is no run, otherwise the run's character offset and
 * its items. The offset is into the SAME string that was passed in, so a caller
 * can slice it.
 *
 * Recognised delimiters after the letter: `.` `)` `:` `-` `–` `—` or a closing
 * bracket form `(A)`. A bare letter followed by a space is NOT a label — "a car"
 * would match, and every stem containing the word "a" would grow a phantom run.
 */
export function findInlineOptionRun(plainText) {
  const text = String(plainText ?? '')
  if (!text.trim()) return null

  // Every position at which a label could begin. Anchored to a word boundary so
  // "Grade A. " matches but "NBA. " does not.
  // The `\s?` before the delimiter is for "A - red", which teachers type as
  // often as "A. red"; without it that whole family of stems reads as clean.
  const labelPattern = /(^|[\s(•·—–-])\(?([A-Za-z])\s?[).:–—-]\s+/g
  const found = []
  let match = labelPattern.exec(text)
  while (match) {
    found.push({ letter: match[2].toUpperCase(), start: match.index + match[1].length, textStart: match.index + match[0].length })
    match = labelPattern.exec(text)
  }
  if (found.length < MIN_RUN_ITEMS) return null

  // Walk backwards from the end for the longest tail whose letters are A, B,
  // C… in order with no gaps. Backwards because the run we care about is the
  // one that ENDS the stem; a labelled list in the middle of a stem is content.
  let best = null
  for (let startIdx = 0; startIdx < found.length; startIdx += 1) {
    const run = found.slice(startIdx)
    if (run.length < MIN_RUN_ITEMS || run.length > MAX_RUN_ITEMS) continue
    const sequential = run.every((item, i) => item.letter === OPTION_LETTERS[i])
    if (!sequential) continue
    best = run
    break
  }
  if (!best) return null

  const items = best.map((item, i) => {
    const end = i + 1 < best.length ? best[i + 1].start : text.length
    return {
      letter: item.letter,
      index: i,
      text: text.slice(item.textStart, end).trim().replace(/[;,]$/, ''),
    }
  })
  if (items.some((item) => !item.text || item.text.length > MAX_ITEM_CHARS)) return null

  return {
    start: best[0].start,
    end: text.length,
    items,
    /** The stem with the run removed, trailing punctuation tidied. */
    stem: text.slice(0, best[0].start).replace(/[\s•·]+$/, '').trim(),
  }
}

/**
 * Does a detected run duplicate the question's stored options?
 *
 * Position-wise where the counts match, membership-wise otherwise — an imported
 * question sometimes has the inline run in a different order from the stored
 * array, and it is still the same list. Requires EVERY item to be accounted for:
 * a run that matches three of four options is not the option list, it is a stem
 * that mentions three of them.
 */
export function runDuplicatesOptions(run, options = []) {
  const stored = (Array.isArray(options) ? options : [])
    .map((opt) => normalizeOptionText(richTextToPlainText(String(opt ?? ''))))
    .filter(Boolean)
  if (stored.length === 0 || !run?.items?.length) return false
  const runTexts = run.items.map((item) => normalizeOptionText(item.text))
  if (runTexts.some((t) => !t)) return false
  const pool = [...stored]
  for (const text of runTexts) {
    const at = pool.findIndex((s) => s === text)
    if (at === -1) return false
    pool.splice(at, 1)
  }
  return true
}

/** Result codes, so a caller can explain itself without matching on prose. */
export const STEM_SANITIZE = Object.freeze({
  CLEAN: 'clean',
  REMOVED: 'removed',
  /** A run was found, duplicates the options, but the stored shape resisted. */
  NEEDS_REVIEW: 'needs-review',
  /** A run was found and is the only copy of the choices — never removed. */
  NOT_DUPLICATE: 'not-duplicate',
})

/**
 * Remove a duplicated inline option run from one question's stem.
 *
 * Never mutates. Returns `{ status, text, question, removed }`, where `text` is
 * the stem in its ORIGINAL stored shape with the run removed, and `question` is
 * the question with that stem substituted (the same object reference when
 * nothing changed, so a migration can tell "unchanged" without comparing
 * fields).
 */
export function sanitizeQuestionStem(question = {}) {
  const original = question?.text
  const plain = richTextToPlainText(original ?? '')
  const run = findInlineOptionRun(plain)
  if (!run) return { status: STEM_SANITIZE.CLEAN, text: original, question, removed: null }
  if (!runDuplicatesOptions(run, question.options)) {
    return { status: STEM_SANITIZE.NOT_DUPLICATE, text: original, question, removed: run }
  }
  const next = removeRunFromStored(original, run, plain)
  if (next === null) {
    return { status: STEM_SANITIZE.NEEDS_REVIEW, text: original, question, removed: run }
  }
  return {
    status: STEM_SANITIZE.REMOVED,
    text: next,
    question: { ...question, text: next },
    removed: run,
  }
}

/**
 * Remove the run from the stem in whatever shape it is stored.
 *
 * Returns `null` when it cannot be done confidently. Three shapes:
 *
 *  - a plain string: slice it, because the offsets are into that exact string.
 *  - Tiptap JSON: drop whole trailing nodes whose combined text IS the run, and
 *    when the run starts mid-node, trim that node's last text leaf. Anything
 *    more surgical would risk splitting a mark.
 *  - HTML: the same idea over trailing block elements.
 *
 * The bar in all three is the same — the removal must be provable against the
 * plain text — because the alternative is a stem that silently loses a sentence.
 */
function removeRunFromStored(stored, run, plain) {
  if (stored == null) return null
  if (typeof stored === 'string' && !looksLikeMarkup(stored)) {
    if (stored === plain || richTextToPlainText(stored) === plain) {
      // The stored string IS the plain text, so the offsets apply directly.
      const sliced = stored.length === plain.length ? stored.slice(0, run.start) : run.stem
      return sliced.replace(/[\s•·]+$/, '').trim()
    }
    return run.stem
  }

  const json = parseTiptap(stored)
  if (json) {
    const trimmed = trimTiptapTail(json, run)
    return trimmed === null ? null : JSON.stringify(trimmed)
  }

  if (typeof stored === 'string') {
    const trimmed = trimHtmlTail(stored, run)
    return trimmed === null ? null : trimmed
  }
  return null
}

function looksLikeMarkup(value) {
  const s = String(value)
  return s.includes('<') || (s.trim().startsWith('{') && s.includes('"type"'))
}

function parseTiptap(value) {
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && Array.isArray(parsed.content) ? parsed : null
  } catch {
    return null
  }
}

/** Plain text of a Tiptap node, matching how richTextToPlainText joins blocks. */
function nodeText(node) {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(nodeText).join('')
}

/**
 * Drop the trailing top-level nodes that carry the run.
 *
 * Only two cases are handled, and both are provable: the run occupies whole
 * trailing blocks, or it is the tail of the last block's last text leaf. A run
 * that straddles a mark boundary is left alone — the caller reports it.
 */
function trimTiptapTail(doc, run) {
  const blocks = doc.content
  const texts = blocks.map(nodeText)
  const runText = normalizeWhitespace(run.items.length ? sliceRunText(run) : '')

  for (let keep = blocks.length - 1; keep >= 0; keep -= 1) {
    const tail = normalizeWhitespace(texts.slice(keep).join(' '))
    if (tail === runText) {
      const kept = blocks.slice(0, keep)
      return kept.length ? { ...doc, content: kept } : null
    }
    if (tail.length > runText.length) break
  }

  // The run is the tail of the final block.
  const last = blocks[blocks.length - 1]
  const lastText = normalizeWhitespace(texts[texts.length - 1] || '')
  if (!last || !lastText.endsWith(runText)) return null
  const keepChars = lastText.length - runText.length
  const trimmedLast = trimNodeTail(last, keepChars)
  if (trimmedLast === null) return null
  const content = [...blocks.slice(0, -1)]
  if (nodeText(trimmedLast).trim()) content.push(trimmedLast)
  return content.length ? { ...doc, content } : null
}

/** Keep the first `keepChars` characters of a node's text, dropping the rest. */
function trimNodeTail(node, keepChars) {
  if (keepChars <= 0) return null
  let budget = keepChars
  const walk = (n) => {
    if (typeof n.text === 'string') {
      if (budget <= 0) return null
      const take = Math.min(budget, n.text.length)
      budget -= take
      const text = n.text.slice(0, take).replace(/[\s•·]+$/, '')
      return text ? { ...n, text } : null
    }
    if (!Array.isArray(n.content)) return n
    const content = n.content.map(walk).filter(Boolean)
    return { ...n, content }
  }
  const out = walk(node)
  return out
}

/** The same idea over trailing HTML blocks. */
function trimHtmlTail(html, run) {
  const runText = normalizeWhitespace(sliceRunText(run))
  const blocks = splitHtmlBlocks(html)
  if (!blocks.length) return null
  const texts = blocks.map((b) => normalizeWhitespace(richTextToPlainText(b)))
  for (let keep = blocks.length - 1; keep >= 0; keep -= 1) {
    const tail = normalizeWhitespace(texts.slice(keep).join(' '))
    if (tail === runText) {
      const kept = blocks.slice(0, keep).join('')
      return kept.trim() ? kept : null
    }
    if (tail.length > runText.length) break
  }
  return null
}

/**
 * Split HTML into top-level block chunks.
 *
 * Regex rather than a parser because this module must stay usable outside a
 * browser (the migration script runs under plain node), and the only thing being
 * split on is the block tags `richTextToPaperHtml` emits. A chunk that fails to
 * account for the whole string aborts the split — a partial split would drop
 * markup.
 */
function splitHtmlBlocks(html) {
  const s = String(html || '')
  const parts = s.match(/<(p|div|li|h[1-6])\b[^>]*>[\s\S]*?<\/\1>|<br\s*\/?>/gi)
  if (!parts) return []
  const rejoined = parts.join('')
  if (normalizeWhitespace(richTextToPlainText(rejoined)) !== normalizeWhitespace(richTextToPlainText(s))) return []
  return parts
}

function sliceRunText(run) {
  return run.items.map((item) => `${item.letter}. ${item.text}`).join(' ')
}

function normalizeWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Sanitise a whole paper.
 *
 * Returns the questions (same references where nothing changed) plus a report
 * naming every question touched and every question that LOOKS like the defect
 * but was left alone. The second list is the point: a migration that silently
 * skipped the hard cases would read as "12 papers cleaned" when three of them
 * still print their choices twice.
 */
export function sanitizePaperStems(questions = []) {
  const list = Array.isArray(questions) ? questions : []
  const cleaned = []
  const report = { removed: [], needsReview: [], notDuplicate: [] }
  list.forEach((question, index) => {
    const result = sanitizeQuestionStem(question)
    cleaned.push(result.question)
    const entry = { index, id: question?.localId ?? question?.id ?? null, items: result.removed?.items?.length ?? 0 }
    if (result.status === STEM_SANITIZE.REMOVED) report.removed.push(entry)
    else if (result.status === STEM_SANITIZE.NEEDS_REVIEW) report.needsReview.push(entry)
    else if (result.status === STEM_SANITIZE.NOT_DUPLICATE) report.notDuplicate.push(entry)
  })
  return { questions: cleaned, report, changed: report.removed.length > 0 }
}
