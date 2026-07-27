/**
 * The DOM implementation and the shared DOM-free one, on the same corpus.
 *
 * `richTextHasContent` decides the most-hit blocking rule on a paper — "this
 * question is empty" — and it moved from a DOMParser walk in the browser to one
 * implementation both runtimes run. Swapping it on the strength of "the tests
 * still pass" would be swapping it on the strength of tests written for other
 * things.
 *
 * So the old implementation is kept in this file, verbatim, and both are run
 * over the same corpus. Where they agree, that is the proof. Where they
 * DELIBERATELY differ, the difference is named below with the reason — an
 * unexplained difference fails.
 *
 * This is a Vitest spec rather than a node script because the old implementation
 * needs a DOM to be itself. Running it without one would compare the new code
 * against the old code's own fallback, which is not the thing being replaced.
 */
import { describe, it, expect } from 'vitest'
import { richTextHasContent as shared } from '../../functions/shared/assessment/richTextContentCore.js'
import { ensureRichTextHtml, richTextToPlainText } from './quizRichText.js'

/* ── the implementation being replaced, as it stood ─────────────────────── */

/**
 * `richTextHasContent` exactly as it was, rebuilt from the two helpers it was
 * three lines on top of.
 *
 * Rebuilt from the REAL helpers rather than reimplemented: `ensureRichTextHtml`
 * runs the TipTap→HTML conversion and the DOMPurify normalisation, and a
 * hand-written stand-in for those got the TipTap cases wrong in a way that made
 * the NEW code look broken. Comparing against an inaccurate copy of the old
 * behaviour proves nothing about the swap. Both helpers stay in quizRichText.js
 * and are unchanged by this work, so this reproduction stays faithful.
 */
function legacyHasContent(value) {
  const html = ensureRichTextHtml(value)
  if (!html) return false
  if (/\bdata-latex=/.test(html) || /<table\b/i.test(html)) return true
  return Boolean(richTextToPlainText(html).replace(/\s+/g, '').trim())
}

/* ── the corpus ─────────────────────────────────────────────────────────── */

/** What a teacher's paper actually contains, and what an editor leaves behind. */
const CORPUS = [
  ['', 'the empty string'],
  ['   ', 'spaces only'],
  ['\n\t ', 'whitespace only'],
  [null, 'null'],
  [undefined, 'undefined'],
  ['<p></p>', 'an empty paragraph'],
  ['<p><br></p>', 'a paragraph holding one line break'],
  ['<p>&nbsp;</p>', 'a paragraph holding a non-breaking space'],
  ['<p>&nbsp;&nbsp;&nbsp;</p>', 'several non-breaking spaces'],
  ['<p>&#160;</p>', 'a numeric non-breaking space'],
  ['<p>\u200b</p>', 'a zero-width space'],
  ['<p>\ufeff</p>', 'a byte-order mark'],
  ['<div><p></p><p><br></p></div>', 'two empty paragraphs in a wrapper'],
  ['Name the largest river in Zambia.', 'plain text'],
  ['<p>Name the largest river in Zambia.</p>', 'a real question'],
  ['<p><strong>Bold</strong> and <em>italic</em>.</p>', 'formatted text'],
  ['<p>Water is H<sub>2</sub>O.</p>', 'a subscript'],
  ['<p>Fill in: the capital of Zambia is ______.</p>', 'a written blank'],
  ['<p>______</p>', 'a blank and nothing else'],
  ['<ul><li>One</li><li>Two</li></ul>', 'a list'],
  ['<ul><li></li></ul>', 'an empty list item'],
  ['<span class="mnode" data-latex="\\frac{1}{2}"></span>', 'a maths node with no text'],
  ['<p><span data-latex="\\ce{H2O}"></span></p>', 'a chemistry node'],
  ['<table><tr><td>3</td><td>4</td></tr></table>', 'a table with values'],
  ['<p>Line one<br>Line two</p>', 'a paragraph with a break inside it'],
  [{ type: 'doc', content: [] }, 'an empty TipTap doc'],
  [{ type: 'doc', content: [{ type: 'paragraph' }] }, 'a TipTap doc of one empty paragraph'],
  [
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
    'a TipTap doc with text',
  ],
  [
    JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] }),
    'a TipTap doc as a JSON string',
  ],
  [
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] },
    'a TipTap doc whose only text is spaces',
  ],
]

/**
 * The differences that are INTENDED, each with the reason it is an improvement.
 * Anything not listed here must match, and anything listed here must actually
 * differ — a stale entry would quietly excuse a regression.
 */
const INTENDED = [
  {
    value: '<p><img src="figure.png" alt="A labelled leaf"></p>',
    what: 'a question that is only an image',
    legacy: false,
    now: true,
    why: 'the old check stripped the tag and found no text, so a labelled-diagram '
      + 'question read as blank and could not be exported. An image IS the question.',
  },
  {
    value: '<p><span data-math-fraction data-numerator="1" data-denominator="2"></span></p>',
    what: 'a structured fraction node',
    legacy: false,
    now: true,
    why: 'only the `data-latex` spelling was recognised. A fraction stored in the '
      + 'data-math-fraction spelling is the one that reached Word as the bare '
      + 'characters "12" (see paperContentModel) — it is content either way.',
  },
  {
    value: '<table><tr><td></td><td></td></tr></table>',
    what: 'an empty table',
    legacy: true,
    now: false,
    why: 'any <table> at all counted as content, so a teacher who inserted a grid '
      + 'and typed nothing had a question that passed the gate and printed blank.',
  },
  {
    value: '<p>&lt;p&gt;not markup&lt;/p&gt;</p>',
    what: 'escaped markup as visible text',
    legacy: true,
    now: true,
    why: 'both treat it as content; listed because entity decoding changed and '
      + 'this is the case that proves decoding did not turn text into tags.',
  },
]

describe('richTextHasContent — the DOM implementation and the shared one', () => {
  it.each(CORPUS)('agrees on %o (%s)', (value, what) => {
    expect(
      shared(value),
      `${what}: shared says ${shared(value)}, the DOM implementation says ${legacyHasContent(value)}`,
    ).toBe(legacyHasContent(value))
  })

  it.each(INTENDED)('differs deliberately on $what', ({ value, legacy, now }) => {
    expect(legacyHasContent(value)).toBe(legacy)
    expect(shared(value)).toBe(now)
  })

  it('every declared difference is a real one', () => {
    // A named difference that no longer differs is worse than an undeclared one:
    // it reads as a documented decision while excusing nothing.
    const notDifferent = INTENDED.filter((c) => c.legacy === c.now)
      .filter((c) => shared(c.value) !== legacyHasContent(c.value))
    expect(notDifferent).toEqual([])
    for (const c of INTENDED.filter((x) => x.legacy !== x.now)) {
      expect(
        shared(c.value) === legacyHasContent(c.value),
        `${c.what} is declared as a deliberate difference but the two now agree`,
      ).toBe(false)
    }
  })

  it('the corpus covers the cases the decision was specified against', () => {
    const strings = CORPUS.map(([v]) => (typeof v === 'string' ? v : '')).filter(Boolean)
    for (const required of ['<p></p>', '<p><br></p>', '<p>&nbsp;</p>']) {
      expect(strings).toContain(required)
      expect(shared(required)).toBe(false)
    }
  })
})
