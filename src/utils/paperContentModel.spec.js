/**
 * Parity between what the editor WRITES and what the paper model READS (§4.1).
 *
 * This is a Vitest spec rather than one of the plain-node scripts because it
 * drives the real `richTextToPaperHtml` — which sanitises through DOMPurify and
 * therefore needs a DOM. That matters: the point of the file is to compare the
 * content model against the ACTUAL print pipeline, not against a hand-written
 * approximation of it.
 *
 * The bug it exists for. `safeRender`'s hydrators have always accepted two
 * spellings of each structured maths node — the class (`.math-frac`) and the
 * data attribute (`[data-math-fraction]`) — because both exist in stored
 * content. The content model matched only the class. So a fraction stored the
 * other way hydrated correctly for print and was read here as the bare
 * characters "12": one half printing as twelve in the Word export, with nothing
 * anywhere to indicate it had happened.
 *
 * Both now resolve the same exported selector, so the failure cannot recur
 * quietly. These tests are what makes that a guarantee rather than a tidy-up.
 */

import { describe, it, expect } from 'vitest'
import { richTextToPaperHtml } from '../editor/utils/safeRender.js'
import { parsePaperContent, contentToPlainText, contentToHtml } from './paperContentModel.js'
import { FRACTION_SELECTOR } from '../editor/extensions/MathFraction.js'
import { NUMBER_BASE_SELECTOR } from '../editor/extensions/NumberBase.js'
import { VERTICAL_ARITHMETIC_SELECTOR } from '../editor/extensions/VerticalArithmetic.js'

/** Parse a stored rich value exactly as the paper layout does. */
const model = (html) => parsePaperContent(richTextToPaperHtml(html))

const flatten = (nodes) => {
  const out = []
  const walk = (list) => {
    for (const n of list || []) {
      out.push(n.type)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

describe('paper content model — every spelling the editor can store', () => {
  // Each pair is the SAME content in the two spellings the hydrators accept.
  const spellings = {
    fraction: [
      '<p><span class="math-frac" data-math-fraction="1" data-num="1" data-den="2"></span></p>',
      '<p><span data-math-fraction="1" data-numerator="1" data-denominator="2"></span></p>',
    ],
    numberBase: [
      '<p><span class="num-base" data-number-base="1" data-number="1011" data-base="2"></span></p>',
      '<p><span data-number-base="1" data-number="1011" data-base="2"></span></p>',
    ],
    verticalArithmetic: [
      '<div class="vert-arith" data-vertical-arithmetic="1" data-operator="+" data-lines="24|18" data-answer="42"></div>',
      '<div data-vertical-arithmetic="1" data-operator="+" data-lines="24|18" data-answer="42"></div>',
    ],
  }

  for (const [type, [withClass, withAttribute]] of Object.entries(spellings)) {
    it(`reads a ${type} the same either way it was stored`, () => {
      expect(flatten(model(withClass))).toContain(type)
      // THE regression: this one used to come back as plain text.
      expect(flatten(model(withAttribute))).toContain(type)
      expect(contentToPlainText(model(withAttribute)))
        .toBe(contentToPlainText(model(withClass)))
    })
  }

  it('a half never reads as twelve', () => {
    // Naming the specific wrong output, because "1/2" vs "12" is the difference
    // between a correct paper and a silently wrong one.
    for (const spelling of spellings.fraction) {
      expect(contentToPlainText(model(spelling))).toBe('1/2')
    }
  })

  it('keeps the working space a vertical sum asked for', () => {
    // `working` adds ruled lines for a learner to show their method. The model
    // dropped the flag, so the Word export removed the room the question gave.
    const [withWorking] = parsePaperContent(richTextToPaperHtml(
      '<div class="vert-arith" data-operator="+" data-lines="24|18"'
      + ' data-answer="42" data-working="true"></div>',
    ))
    expect(withWorking.working).toBe(true)
    const [without] = parsePaperContent(richTextToPaperHtml(
      '<div class="vert-arith" data-operator="+" data-lines="24|18" data-answer="42"></div>',
    ))
    expect(without.working).toBe(false)
  })

  it('decodes a sum\'s lines the way the editor encoded them', () => {
    // The model used to drop empty lines; the editor's own decoder keeps them,
    // and an empty line is a column a learner writes into.
    const [block] = parsePaperContent(richTextToPaperHtml(
      '<div class="vert-arith" data-operator="+" data-lines="24|" data-answer=""></div>',
    ))
    expect(block.lines).toEqual(['24', ''])
  })
})

describe('paper content model — the working space survives every hop', () => {
  it('round-trips through the HTML form', () => {
    const source = '<div class="vert-arith" data-operator="+" data-lines="24|18"'
      + ' data-answer="42" data-working="true"></div>'
    const once = parsePaperContent(richTextToPaperHtml(source))
    const html = contentToHtml(once)
    expect(html).toContain('data-working="true"')
    // A second parse must not lose it, or an export chain with two hops would
    // silently remove the space again.
    const twice = parsePaperContent(html)
    expect(twice[0].working).toBe(true)
  })

  it('is absent when the sum did not ask for it', () => {
    const source = '<div class="vert-arith" data-operator="+" data-lines="24|18" data-answer="42"></div>'
    const html = contentToHtml(parsePaperContent(richTextToPaperHtml(source)))
    expect(html).not.toContain('data-working')
    expect(html).not.toContain('___')
  })
})

describe('paper content model — the selectors are shared, not copied', () => {
  it('every selector matches both spellings it claims to', () => {
    // If someone re-qualifies one of these by tag, the pairs above stop being
    // equivalent — this fails first and says why.
    const cases = [
      [FRACTION_SELECTOR, 'span', { 'data-math-fraction': '1' }, 'math-frac'],
      [NUMBER_BASE_SELECTOR, 'span', { 'data-number-base': '1' }, 'num-base'],
      [VERTICAL_ARITHMETIC_SELECTOR, 'div', { 'data-vertical-arithmetic': '1' }, 'vert-arith'],
    ]
    for (const [selector, tag, attrs, cls] of cases) {
      const byAttribute = document.createElement(tag)
      for (const [k, v] of Object.entries(attrs)) byAttribute.setAttribute(k, v)
      expect(byAttribute.matches(selector), `${selector} vs attribute`).toBe(true)

      const byClass = document.createElement(tag)
      byClass.className = cls
      expect(byClass.matches(selector), `${selector} vs class`).toBe(true)
    }
  })
})

describe('paper content model — what it does NOT represent', () => {
  // Recorded deliberately. `textHtml` is still emitted from
  // richTextToPaperHtml rather than from the model, and this is the reason:
  // serialising the model back to print HTML would drop these constructs. A
  // test is a better record of that than a comment, because it fails the day
  // someone teaches the model one of them and forgets this is why.
  const unsupported = {
    'bullet list': '<ul><li><p>first</p></li><li><p>second</p></li></ul>',
    'numbered list': '<ol><li><p>one</p></li><li><p>two</p></li></ol>',
    heading: '<h3>A heading</h3>',
    blockquote: '<blockquote><p>quoted</p></blockquote>',
  }

  for (const [name, html] of Object.entries(unsupported)) {
    it(`flattens a ${name} to paragraphs (so the print HTML cannot come from the model yet)`, () => {
      const nodes = model(html)
      expect(nodes.every((n) => n.type === 'paragraph')).toBe(true)
      // The words survive — nothing is lost from Word, only the structure.
      expect(contentToPlainText(nodes).length).toBeGreaterThan(0)
    })
  }

  it('but the print HTML keeps them, which is why it is still generated separately', () => {
    expect(richTextToPaperHtml(unsupported['bullet list'])).toContain('<ul>')
    expect(richTextToPaperHtml(unsupported.heading)).toContain('<h3>')
  })
})
