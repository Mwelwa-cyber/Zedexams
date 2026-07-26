/**
 * The paper code must never cost a sheet of paper (§4.6).
 *
 * vr-005 printed a second page carrying one thing: `G8/Mathematics/Term /2026`.
 * Measured, page 1 had 21.7mm free below its last ink, 16mm of that the bottom
 * margin, leaving 5.7mm usable against the ~10.4mm the footer wanted — an 18pt
 * top margin plus a 9.5pt line. It missed by 4.7mm and cost a whole sheet, on
 * every learner's copy.
 *
 * Trimming that margin would have bought about 6mm and left 0.3mm of headroom.
 * That is not a fix; it is the same failure waiting for a paper one line longer.
 * So the footer leaves the flow in print, and these tests pin the properties
 * that makes true — measured on real renders, because the whole reason the bug
 * survived is that reading the stylesheet says nothing about where ink lands.
 *
 * Run: node scripts/visual/footerBand.test.js
 */

import { fixtureById } from './fixtures.js'
import { renderFixture } from './renderStages.js'
import {
  footerBand, bodyBand, RESERVED_BOTTOM_MM, FOOTER_MM, pageMarginRule,
} from '../../src/config/paperPageGeometry.js'

let failures = 0
let passed = 0
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); return }
  failures += 1
  console.error(`  ✗   ${msg}`)
}

/** Ink fraction within a horizontal band of a decoded page. */
function bandInk(page, fromFraction, toFraction) {
  const y0 = Math.max(0, Math.floor(fromFraction * page.height))
  const y1 = Math.min(page.height, Math.ceil(toFraction * page.height))
  let ink = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < page.width; x += 1) {
      const i = (y * page.width + x) * 4
      if (page.data[i + 3] < 8) continue
      if (page.data[i] < 235 || page.data[i + 1] < 235 || page.data[i + 2] < 235) ink += 1
    }
  }
  const area = (y1 - y0) * page.width
  return area ? ink / area : 0
}

console.log('\n— the geometry states its own relationship —')

assert(
  RESERVED_BOTTOM_MM === FOOTER_MM.offset + FOOTER_MM.lineHeight + FOOTER_MM.clearance,
  'reserved bottom margin = footer offset + line height + clearance',
)
assert(
  pageMarginRule().endsWith(`${RESERVED_BOTTOM_MM}mm`),
  `the @page rule reserves exactly that — ${pageMarginRule()}`,
)
{
  // The bands must not overlap, or "body never touches the footer" is unstated
  // rather than untrue.
  const f = footerBand()
  const b = bodyBand()
  assert(b.bottom < f.top, 'the body band ends above the footer band')
  assert(
    Math.abs((f.top - b.bottom) * 297 - FOOTER_MM.clearance) < 0.01,
    `the gap between them is the declared clearance (${FOOTER_MM.clearance}mm)`,
  )
}

const FOOTER = footerBand()
const BODY = bodyBand()

/**
 * The footer's box holds the footer and nothing else.
 *
 * The same paper code prints on every page, so its band should carry the same
 * ink on every page. A page where body content has reached into that box shows
 * up as an outlier — which is the property the owner asked to pin, expressed in
 * something measurable rather than in a pixel-by-pixel guess at whose ink is
 * whose.
 */
function assertFooterBandIsOnlyTheFooter(render) {
  const inks = render.pages.map((p) => bandInk(p, FOOTER.top, FOOTER.bottom))
  const max = Math.max(...inks)
  const min = Math.min(...inks)
  assert(
    max - min < 0.002,
    `every page's footer box carries the same ink — ${inks.map((v) => v.toFixed(5)).join(', ')}`,
  )
  assert(max > 0, 'and that ink is the paper code, present on every page')
}

console.log('\n— vr-005: the paper that lost a sheet —')
{
  const fixture = fixtureById('vr-005')
  const render = await renderFixture(fixture, 'browser-print', { mode: 'paper' })

  // 1. one page.
  assert(render.pages.length === 1, `vr-005/browser-print is one page — got ${render.pages.length}`)

  // 2. the final meaningful anchor is still on page 1.
  assert(render.layout.anchors.question_2 === 1, 'question 2 is still on page 1')

  // 3. no trailing page whose only ink is the footer.
  for (const page of render.pages) {
    const body = bandInk(page, BODY.top, BODY.bottom)
    assert(
      body > 0,
      `page ${page.pageNumber} carries body content, not just a paper code (${body.toFixed(5)})`,
    )
  }

  // 5. body content never reaches the footer's own box.
  //
  // Measured by comparing pages rather than by trying to tell body ink from
  // footer ink pixel by pixel: every page carries the same short centred code,
  // so a page whose footer band holds materially more ink than the others has
  // body content in it.
  assertFooterBandIsOnlyTheFooter(render)

  // The check that stops this passing because content was CLIPPED: the paper
  // still prints everything it did before, and the question count is unchanged.
  const questions = Object.keys(render.layout.anchors).filter((id) => /^question_\d+$/.test(id))
  assert(
    questions.length === fixture.questions.length,
    `all ${fixture.questions.length} questions still print — found ${questions.length}`,
  )
  const printed = render.pages
    .flatMap((p) => p.textItems.map((t) => t.text))
    .join(' ')
    .replace(/\s+/g, '')
  for (const needle of ['Maize', 'Groundnuts', 'Cassava']) {
    assert(printed.includes(needle), `the table still prints "${needle}" — nothing was clipped away`)
  }
}

console.log('\n— vr-006: the footer repeats on every page —')
{
  const render = await renderFixture(fixtureById('vr-006'), 'browser-print', { mode: 'paper' })
  assert(render.pages.length > 1, `vr-006 is multi-page — got ${render.pages.length}`)

  // 4. every page carries the footer.
  for (const page of render.pages) {
    assert(
      bandInk(page, FOOTER.top, FOOTER.bottom) > 0,
      `page ${page.pageNumber} of ${render.pages.length} carries the paper code`,
    )
  }
  // 5. and no page lets body content into the footer's box.
  assertFooterBandIsOnlyTheFooter(render)
  // Nothing below the footer band at all — the reserved margin stays blank.
  for (const page of render.pages) {
    assert(
      bandInk(page, FOOTER.bottom, 1) === 0,
      `page ${page.pageNumber} prints nothing below the footer`,
    )
  }
}

console.log(
  failures === 0
    ? `\n✓ footer band — ${passed} assertions passed`
    : `\n✗ footer band — ${failures} of ${passed + failures} assertions FAILED`,
)
process.exit(failures ? 1 : 0)
