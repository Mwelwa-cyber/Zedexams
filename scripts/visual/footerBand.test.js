/**
 * The paper code must never cost a sheet of paper, and must never be printed on
 * (§4.6).
 *
 * Two defects, one band.
 *
 * vr-005 printed a second page carrying one thing: `G8/Mathematics/Term /2026`.
 * Measured, page 1 had 21.7mm free below its last ink, 16mm of that the bottom
 * margin, leaving 5.7mm usable against the ~10.4mm the footer wanted — an 18pt
 * top margin plus a 9.5pt line. It missed by 4.7mm and cost a whole sheet, on
 * every learner's copy. Taking the footer out of flow fixed that.
 *
 * It did not fix the other half. A fixed element is positioned against the PAGE
 * AREA, which is the box the body flows through, so the footer stopped creating
 * pages and started being printed on: vr-006 page 3 carried 0.09311 ink in the
 * footer band against 0.03154 on every other page — an answer line straight
 * through the paper code. The space is now RESERVED by a running <tfoot>, and
 * these tests pin the properties that makes true.
 *
 * Measured on real renders throughout, because the whole reason both defects
 * survived is that reading the stylesheet says nothing about where ink lands.
 *
 * Run: node scripts/visual/footerBand.test.js
 */

import { VISUAL_FIXTURES, fixtureById } from './fixtures.js'
import { renderFixture } from './renderStages.js'
import {
  footerBand, bodyBand, RESERVED_BOTTOM_MM, FOOTER_RESERVE_MM, PAGE_MARGIN_BOTTOM_MM,
  FOOTER_MM, PAGE_MM, pageMarginRule,
} from '../../src/config/paperPageGeometry.js'

let failures = 0
let passed = 0
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); return }
  failures += 1
  console.error(`  ✗   ${msg}`)
}

const FOOTER = footerBand()
const BODY = bodyBand()
const BODY_LIMIT_MM = BODY.bottom * PAGE_MM.height

/** Is this pixel inked? The same threshold the anchor extractor uses. */
function inked(page, x, y) {
  const i = (y * page.width + x) * 4
  if (page.data[i + 3] < 8) return false
  return page.data[i] < 235 || page.data[i + 1] < 235 || page.data[i + 2] < 235
}

/** Ink fraction within a horizontal band of a decoded page. */
function bandInk(page, fromFraction, toFraction) {
  const y0 = Math.max(0, Math.floor(fromFraction * page.height))
  const y1 = Math.min(page.height, Math.ceil(toFraction * page.height))
  let ink = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < page.width; x += 1) if (inked(page, x, y)) ink += 1
  }
  const area = (y1 - y0) * page.width
  return area ? ink / area : 0
}

/**
 * The lowest inked row above the footer band, in millimetres from the top.
 *
 * The footer is drawn by a fixed element the body cannot produce, so the lowest
 * ink above that band IS the body's bounding box — the thing that must not reach
 * the footer.
 */
function lowestBodyInkMm(page) {
  const limit = Math.floor(FOOTER.top * page.height)
  for (let y = limit - 1; y >= 0; y -= 1) {
    for (let x = 0; x < page.width; x += 1) {
      if (inked(page, x, y)) return (y / page.height) * PAGE_MM.height
    }
  }
  return 0
}

/** Every text string the render printed, whitespace removed. */
function printedText(render) {
  return render.pages.flatMap((p) => p.textItems.map((t) => t.text)).join(' ').replace(/\s+/g, '')
}

console.log('\n— the geometry states its own relationship —')

assert(
  RESERVED_BOTTOM_MM === FOOTER_MM.offset + FOOTER_MM.lineHeight + FOOTER_MM.clearance,
  'complete reserved zone = footer offset + line height + clearance',
)
assert(
  RESERVED_BOTTOM_MM === PAGE_MARGIN_BOTTOM_MM + FOOTER_RESERVE_MM,
  'and it is exactly the two enforceable halves: the page margin plus the in-flow reservation',
)
assert(
  pageMarginRule().endsWith(`${PAGE_MARGIN_BOTTOM_MM}mm`),
  `the @page rule carries the offset half — ${pageMarginRule()}`,
)
{
  // The bands must not overlap, or "body never touches the footer" is unstated
  // rather than untrue.
  assert(BODY.bottom < FOOTER.top, 'the body band ends above the footer band')
  assert(
    Math.abs((FOOTER.top - BODY.bottom) * PAGE_MM.height - FOOTER_MM.clearance) < 0.01,
    `the gap between them is the declared clearance (${FOOTER_MM.clearance}mm)`,
  )
  assert(
    Math.abs((1 - FOOTER.bottom) * PAGE_MM.height - FOOTER_MM.offset) < 0.01,
    `and the footer's bottom edge is the declared offset above the sheet (${FOOTER_MM.offset}mm)`,
  )
}

/**
 * The footer's box holds the footer and nothing else.
 *
 * The same paper code prints on every page, so its band carries the same ink on
 * every page. A page where body content has reached into that box shows up as an
 * outlier — measurable, rather than a pixel-by-pixel guess at whose ink is whose.
 */
function assertFooterBandIsOnlyTheFooter(label, render) {
  const inks = render.pages.map((p) => bandInk(p, FOOTER.top, FOOTER.bottom))
  const spread = Math.max(...inks) - Math.min(...inks)
  assert(
    spread < 0.002,
    `${label}: every page's footer box carries the same ink — ${inks.map((v) => v.toFixed(5)).join(', ')}`,
  )
  assert(Math.max(...inks) > 0, `${label}: and that ink is the paper code, present on every page`)
}

/**
 * No body-content bounding box intersects the footer box, on any page.
 *
 * The tolerance is ONE DEVICE PIXEL, derived from the page being measured rather
 * than written as a round number. A rule drawn exactly on the limit is
 * rasterised as a row of pixels whose top edge is the limit, so its measured
 * position is a fraction of a millimetre below it — 0.17mm at the 150dpi these
 * pages are rendered at. Anything larger would be a tolerance for overlap, which
 * is the one thing this test exists to refuse.
 */
function assertBodyClearsTheFooter(label, render) {
  for (const page of render.pages) {
    const onePixelMm = PAGE_MM.height / page.height
    const lowest = lowestBodyInkMm(page)
    assert(
      lowest <= BODY_LIMIT_MM + onePixelMm,
      `${label} p${page.pageNumber}: last body ink at ${lowest.toFixed(2)}mm, `
      + `within a pixel (${onePixelMm.toFixed(2)}mm) of the ${BODY_LIMIT_MM.toFixed(1)}mm limit`,
    )
  }
}

/** Nothing prints below the footer — the offset strip stays blank. */
function assertNothingBelowTheFooter(label, render) {
  for (const page of render.pages) {
    assert(
      bandInk(page, FOOTER.bottom, 1) === 0,
      `${label} p${page.pageNumber}: nothing prints below the footer`,
    )
  }
}

/** Every page carries the paper code. */
function assertCodeOnEveryPage(label, render) {
  for (const page of render.pages) {
    assert(
      bandInk(page, FOOTER.top, FOOTER.bottom) > 0,
      `${label} p${page.pageNumber} of ${render.pages.length}: carries the paper code`,
    )
  }
}

/** No page exists whose only ink is the paper code. */
function assertEveryPageHasBody(label, render) {
  for (const page of render.pages) {
    const body = bandInk(page, BODY.top, BODY.bottom)
    assert(
      body > 0,
      `${label} p${page.pageNumber}: carries body content, not just a paper code (${body.toFixed(5)})`,
    )
  }
}

/**
 * Nothing was achieved by clipping.
 *
 * The reservation shortens every page, so the failure mode to guard against is
 * no longer "a footer-only page" but "the last lines fell off". Every question
 * the fixture declares must still be found, and every figure with the question
 * it belongs to.
 */
function assertNothingWasClipped(label, fixture, render) {
  const questions = Object.keys(render.layout.anchors).filter((id) => /^question_\d+$/.test(id))
  assert(
    questions.length === fixture.questions.length,
    `${label}: all ${fixture.questions.length} question(s) still print — found ${questions.length}`,
  )
  const figures = fixture.questions.filter((q) => q.imageDiagram).length
  if (!figures) return
  const drawn = Object.keys(render.layout.anchors).filter((id) => /^diagram_/.test(id))
  assert(
    drawn.length >= figures,
    `${label}: all ${figures} figure(s) still print — found ${drawn.join(', ') || 'none'}`,
  )
  // A figure detached from its question would be numbered after a different
  // one, so the name carries the claim and the page confirms it.
  for (const id of drawn) {
    const q = `question_${id.replace(/^diagram_/, '').split('.')[0]}`
    assert(
      render.layout.anchors[id] === render.layout.anchors[q],
      `${label}: ${id} is on the same page as ${q}`,
    )
  }
}

console.log('\n— vr-005: the paper that lost a sheet —')
{
  const fixture = fixtureById('vr-005')
  const render = await renderFixture(fixture, 'browser-print', { mode: 'paper' })

  assert(render.pages.length === 1, `vr-005/browser-print is one page — got ${render.pages.length}`)
  assert(render.layout.anchors.question_2 === 1, 'question 2 is still on page 1')
  assertEveryPageHasBody('vr-005', render)
  assertCodeOnEveryPage('vr-005', render)
  assertBodyClearsTheFooter('vr-005', render)
  assertNothingBelowTheFooter('vr-005', render)
  assertFooterBandIsOnlyTheFooter('vr-005', render)
  assertNothingWasClipped('vr-005', fixture, render)

  // The table this fixture exists for still prints every row.
  const printed = printedText(render)
  for (const needle of ['Maize', 'Groundnuts', 'Cassava']) {
    assert(printed.includes(needle), `vr-005: the table still prints "${needle}" — nothing was clipped away`)
  }
}

console.log('\n— vr-006: the page that printed through the code —')
{
  const fixture = fixtureById('vr-006')
  const render = await renderFixture(fixture, 'browser-print', { mode: 'paper' })
  assert(render.pages.length > 1, `vr-006 is multi-page — got ${render.pages.length}`)

  assertCodeOnEveryPage('vr-006', render)
  assertBodyClearsTheFooter('vr-006', render)
  assertNothingBelowTheFooter('vr-006', render)
  assertFooterBandIsOnlyTheFooter('vr-006', render)
  assertEveryPageHasBody('vr-006', render)
  assertNothingWasClipped('vr-006', fixture, render)

  // THE defect, named: page 3's footer band held three times the ink of every
  // other page's. Checked directly and not only through the spread, so a
  // regression that moved the excess to another page still fails for this
  // reason rather than for a vaguer one.
  const inks = render.pages.map((p) => bandInk(p, FOOTER.top, FOOTER.bottom))
  const median = [...inks].sort((a, b) => a - b)[Math.floor(inks.length / 2)]
  const worst = Math.max(...inks)
  assert(
    worst < median * 1.5,
    `vr-006: no page's footer band carries excess body ink — worst ${worst.toFixed(5)} `
    + `against a median of ${median.toFixed(5)}`,
  )

  // Every answer line is still ruled: the reservation shortens the page, and a
  // page that silently dropped its last rule would look tidier and be wrong.
  assert(
    fixture.questions.every((q) => Number(q.answerLines) > 0),
    'vr-006 still declares answer space on every question',
  )
}

console.log('\n— every browser-printed fixture, BOTH copies —')
{
  // The defect appeared on one page of one fixture and was present in the layout
  // of all of them. A rule proved only against the paper it was written for is
  // the kind that comes back — and it did: with only the learner copies checked,
  // the reservation silently cost vr-004's MARKING KEY a footer-only second
  // page. The marking key is a printed document a teacher hands out, so it is
  // held to the same invariants rather than to a subset of them.
  for (const fixture of VISUAL_FIXTURES) {
    if (!fixture.targets.includes('browser-print')) continue
    for (const copy of fixture.renderBothModes ? ['paper', 'scheme'] : ['paper']) {
      if (copy === 'paper' && (fixture.id === 'vr-005' || fixture.id === 'vr-006')) continue
      const label = `${fixture.id}/${copy}`
      const render = await renderFixture(fixture, 'browser-print', { mode: copy })
      assertBodyClearsTheFooter(label, render)
      assertNothingBelowTheFooter(label, render)
      assertCodeOnEveryPage(label, render)
      assertEveryPageHasBody(label, render)
      assertNothingWasClipped(label, fixture, render)
    }
  }
}

console.log(
  failures === 0
    ? `\n✓ footer band — ${passed} assertions passed`
    : `\n✗ footer band — ${failures} of ${passed + failures} assertions FAILED`,
)
process.exit(failures ? 1 : 0)
