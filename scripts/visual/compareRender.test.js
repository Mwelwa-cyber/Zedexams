/**
 * Tests for the visual comparison engine (§4.6).
 *
 * The engine's whole justification is that a single percentage threshold cannot
 * separate "the font hinted differently" from "the decimal point is gone". So
 * that separation is what these tests measure, in both directions:
 *
 *  - rasterisation shimmer across a whole page must NOT fail, or the suite gets
 *    switched off within a week;
 *  - a handful of solid pixels disappearing MUST fail, even though it moves no
 *    percentage worth reporting.
 *
 * Every case here is built from synthetic pixels rather than screenshots,
 * because a decision this important should be testable without a browser.
 *
 * Run: node scripts/visual/compareRender.test.js
 */

import assert from 'node:assert/strict'
import {
  comparePages, summarisePageComparison,
  MINOR_AMPLITUDE, CLUSTER_LIMIT, STRICT_CLUSTER_LIMIT, SIGNIFICANT_MIN_PIXELS,
} from './compareRender.js'
import { comparePagination, paginationSummary } from './comparePagination.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`)
    process.exitCode = 1
  }
}

/** A white page. */
function page(width = 60, height = 60) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { width, height, data }
}

/** Paint a filled rectangle of one grey level. */
function paint(p, x, y, w, h, level = 0) {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      const i = ((y + dy) * p.width + (x + dx)) * 4
      p.data[i] = level
      p.data[i + 1] = level
      p.data[i + 2] = level
      p.data[i + 3] = 255
    }
  }
  return p
}

/**
 * Nudge the pixels ADJACENT TO INK by a sub-threshold amount, which is what
 * font hinting and anti-aliasing actually do. A whole-page nudge is a brightness
 * shift, not shimmer — and that genuinely should fail, because it means the
 * render environment changed. There is a test for that below.
 */
function shimmer(p, amount = MINOR_AMPLITUDE - 1) {
  const out = { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) }
  const isInk = (x, y) => {
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false
    return p.data[(y * p.width + x) * 4] < 128
  }
  for (let y = 0; y < p.height; y += 1) {
    for (let x = 0; x < p.width; x += 1) {
      const i = (y * p.width + x) * 4
      const onEdge = !isInk(x, y)
        && (isInk(x - 1, y) || isInk(x + 1, y) || isInk(x, y - 1) || isInk(x, y + 1))
      if (!onEdge) continue
      const delta = (x + y) % 2 === 0 ? -amount : amount
      for (let c = 0; c < 3; c += 1) {
        out.data[i + c] = Math.max(0, Math.min(255, out.data[i + c] + delta))
      }
    }
  }
  return out
}

/** Shift the WHOLE page's brightness — an environment change, not shimmer. */
function brighten(p, amount = 4) {
  const out = { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) }
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      out.data[i + c] = Math.max(0, Math.min(255, out.data[i + c] - amount))
    }
  }
  return out
}

/* ── the two directions that matter ─────────────────────────────────────── */

console.log('\n— noise versus content —')

test('an identical page is unchanged', () => {
  const a = paint(page(), 10, 10, 20, 8)
  const b = paint(page(), 10, 10, 20, 8)
  const r = comparePages(a, b)
  assert.equal(r.changed, false, r.reasons.join('; '))
  assert.equal(r.significantPixels, 0)
})

test('anti-aliasing shimmer along every glyph edge does NOT fail the build', () => {
  // THE false positive to avoid. Every pixel bordering ink differs, by less than
  // the ink threshold. A percentage rule set low enough to catch a lost decimal
  // point would fail on this, every build, until someone turned the suite off.
  const a = paint(page(), 10, 10, 20, 8)
  const r = comparePages(a, shimmer(a))
  assert.equal(r.significantPixels, 0, 'no pixel crossed the ink threshold')
  assert.ok(r.minorPixels > 0, 'and the noise was seen, not ignored')
  assert.equal(r.changed, false, r.reasons.join('; '))
})

test('a whole-page brightness shift DOES fail — the environment changed', () => {
  // Not shimmer. Every pixel moving together means a different renderer, font
  // stack or colour profile, which is what the pin list exists to prevent. If it
  // happens the suite must say so rather than absorb it as noise — a baseline
  // from one environment compared against another is a meaningless comparison.
  const a = paint(page(), 10, 10, 20, 8)
  const r = comparePages(a, brighten(a))
  assert.equal(r.significantPixels, 0, 'each pixel moved only slightly')
  assert.equal(r.changed, true, 'and it still fails, on the page fraction')
  assert.ok(r.reasons.some((m) => /allowing for rasterisation noise/.test(m)), r.reasons.join('; '))
})

test('a lost decimal point DOES fail, though it moves almost no percentage', () => {
  // THE regression this engine exists for. A 3×3 dot on a 60×60 page is 0.25%
  // of the pixels — and it is the difference between 1.5 and 15.
  const a = paint(page(), 10, 10, 3, 3)
  const b = page()
  const r = comparePages(a, b)
  assert.equal(r.changed, true)
  assert.ok(
    r.reasons.some((m) => /connected pixels changed together/.test(m)),
    `failed for the right reason: ${r.reasons.join('; ')}`,
  )
  assert.equal(r.largestCluster, 9)
})

test('…and it fails on the CLUSTER, not on the page fraction', () => {
  // Proving the mechanism rather than the outcome: a big enough page makes the
  // fraction negligible, and the finding must survive that.
  const a = paint(page(400, 400), 10, 10, 3, 3)
  const r = comparePages(a, page(400, 400))
  assert.ok(r.significantFraction < 0.0001, `fraction is negligible (${r.significantFraction})`)
  assert.equal(r.changed, true, 'and it still fails')
  assert.ok(r.reasons.some((m) => /connected pixels/.test(m)))
})

test('an isolated speck is left to the noise budget', () => {
  // One or two pixels of high-amplitude difference is a hinting artefact on a
  // glyph edge, not content. Failing on it is how a suite earns its reputation.
  const a = page()
  const b = paint(page(), 30, 30, 1, 1)
  const r = comparePages(a, b)
  assert.ok(r.largestCluster < CLUSTER_LIMIT, `cluster ${r.largestCluster}`)
  assert.equal(r.changed, false, r.reasons.join('; '))
})

test('the fraction rule is not scale-sensitive for a handful of pixels', () => {
  // The flaw this floor fixes: one stray pixel is 0.03% of a small region and
  // 0.00005% of an A4 page at 150dpi, so without a floor the SAME artefact
  // failed on one and passed on the other. Whether a few pixels are content is a
  // question about shape, and the cluster pass answers it.
  const small = comparePages(page(60, 60), paint(page(60, 60), 30, 30, 1, 1))
  const large = comparePages(page(600, 600), paint(page(600, 600), 30, 30, 1, 1))
  assert.equal(small.changed, large.changed, 'the verdict does not depend on page size')
  assert.equal(small.changed, false)
  assert.ok(SIGNIFICANT_MIN_PIXELS > 1)
})

test('but a lot of scattered ink changing DOES fail on the fraction', () => {
  // The case the fraction rule exists for, which the cluster rule would miss:
  // ink changed all over the page in pieces too small to be clusters.
  const a = page(60, 60)
  const b = page(60, 60)
  for (let i = 0; i < 40; i += 1) paint(b, (i * 7) % 58, (i * 11) % 58, 1, 1)
  const r = comparePages(a, b)
  assert.ok(r.largestCluster < CLUSTER_LIMIT, `no cluster (${r.largestCluster})`)
  assert.equal(r.changed, true, 'and it still fails')
  assert.ok(r.reasons.some((m) => /changed substantially/.test(m)), r.reasons.join('; '))
})

/* ── the owner's list, item by item ─────────────────────────────────────── */

console.log('\n— the failures anti-aliasing tolerance must not mask —')

const strict = [{ x: 5, y: 5, width: 30, height: 20 }]

test('a thin fraction bar disappearing is caught', () => {
  // One pixel tall, twelve long — the exact case a "small change" rule loses.
  const a = paint(page(), 8, 14, 12, 1)
  const r = comparePages(a, page(), { strictRegions: strict })
  assert.equal(r.changed, true, r.reasons.join('; '))
})

test('an arrowhead disappearing is caught', () => {
  const a = page()
  for (let i = 0; i < 4; i += 1) paint(a, 20 + i, 12 - i, 1, 1 + i * 2)
  const r = comparePages(a, page(), { strictRegions: strict })
  assert.equal(r.changed, true, r.reasons.join('; '))
})

test('a maths region is held to a stricter bar than ordinary text', () => {
  // A 2×2 mark: below the ordinary cluster limit, at the strict one. Same pixels,
  // different verdict depending on where they are — which is the point.
  const withMark = paint(page(), 10, 10, 2, 2)
  const plain = comparePages(withMark, page())
  const inMaths = comparePages(withMark, page(), { strictRegions: strict })
  assert.equal(plain.changed, false, 'ordinary text absorbs it')
  assert.equal(inMaths.changed, true, 'a maths region does not')
  assert.ok(inMaths.reasons.some((m) => /maths or label region/.test(m)))
  assert.ok(STRICT_CLUSTER_LIMIT < CLUSTER_LIMIT)
})

test('a changed symbol is caught even at the same ink volume', () => {
  // A "+" becoming a "−" changes few pixels and no pixel COUNT worth noticing.
  const plus = page()
  paint(plus, 20, 16, 9, 1)
  paint(plus, 24, 12, 1, 9)
  const minus = paint(page(), 20, 16, 9, 1)
  const r = comparePages(plus, minus, { strictRegions: strict })
  assert.equal(r.changed, true, r.reasons.join('; '))
})

/* ── page size is never resampled away ──────────────────────────────────── */

console.log('\n— a page that changed size —')

test('a different page size is the finding, not something to scale away', () => {
  const r = comparePages(page(60, 60), page(60, 80))
  assert.equal(r.changed, true)
  assert.equal(r.sizeChanged, true)
  assert.ok(r.reasons.some((m) => /page size changed/.test(m)))
})

test('an unreadable page fails rather than passing quietly', () => {
  // A render that produced nothing must never be reported as "no change".
  for (const bad of [null, undefined, {}, { width: 1, height: 1 }]) {
    const r = comparePages(page(), bad)
    assert.equal(r.changed, true, JSON.stringify(bad))
  }
  assert.equal(comparePages(null, page()).changed, true)
})

test('the summary names the fixture ID, not a title', () => {
  const r = comparePages(page(), page())
  const line = summarisePageComparison('vr-003-vertical-arithmetic', 2, r)
  assert.match(line, /vr-003-vertical-arithmetic/)
  assert.match(line, /page 2/)
  assert.match(line, /largest cluster/)
})

/* ── pagination is structural ───────────────────────────────────────────── */

console.log('\n— layout failures pixels cannot report —')

const layout = (pageCount, anchors, inkByPage = {}) => ({ pageCount, anchors, inkByPage })

test('an unchanged layout reports nothing', () => {
  const a = layout(2, { question_1: 1, question_2: 2 }, { 1: 0.2, 2: 0.2 })
  const r = comparePagination(a, a)
  assert.equal(r.changed, false)
  assert.match(paginationSummary('vr-006', r), /^ok/)
})

test('a question moving page is named, with both page numbers', () => {
  const before = layout(2, { question_12: 2 }, { 1: 0.2, 2: 0.2 })
  const after = layout(3, { question_12: 3 }, { 1: 0.2, 2: 0.2, 3: 0.2 })
  const r = comparePagination(before, after)
  assert.equal(r.changed, true)
  const moved = r.findings.find((f) => f.kind === 'anchor_moved')
  assert.ok(moved, 'reported as a move')
  assert.match(moved.message, /question_12 moved from page 2 to page 3/)
})

test('the page count is reported SEPARATELY from any pixel measure', () => {
  // The owner's point: a small pixel difference can hide a serious pagination
  // regression, so page count is its own finding with its own flag.
  const r = comparePagination(
    layout(2, { question_1: 1 }, { 1: 0.2, 2: 0.2 }),
    layout(3, { question_1: 1 }, { 1: 0.2, 2: 0.2, 3: 0.2 }),
  )
  assert.equal(r.pageCountChanged, true)
  const finding = r.findings.find((f) => f.kind === 'page_count')
  assert.ok(finding)
  assert.equal(finding.before, 2)
  assert.equal(finding.after, 3)
})

test('a diagram separating from its question is its own failure', () => {
  const r = comparePagination(
    layout(2, { question_4: 1, diagram_4: 1 }, { 1: 0.2, 2: 0.2 }),
    layout(2, { question_4: 1, diagram_4: 2 }, { 1: 0.2, 2: 0.2 }),
    { together: [['diagram_4', 'question_4']] },
  )
  const sep = r.findings.find((f) => f.kind === 'separated')
  assert.ok(sep, 'reported as a separation')
  assert.match(sep.message, /diagram_4 separated from question_4/)
})

test('…and it fails even when the baseline was already broken', () => {
  // A togetherness requirement is a standing property of the paper, not a
  // comparison. A baseline is not a licence to keep shipping it.
  const broken = layout(2, { question_4: 1, diagram_4: 2 }, { 1: 0.2, 2: 0.2 })
  const r = comparePagination(broken, broken, { together: [['diagram_4', 'question_4']] })
  assert.equal(r.changed, true)
  assert.ok(r.findings.some((f) => f.kind === 'separated'))
})

test('a marking-scheme answer leaving its question is caught', () => {
  const r = comparePagination(
    layout(1, { question_7: 1, answer_7: 1 }, { 1: 0.2 }),
    layout(2, { question_7: 1, answer_7: 2 }, { 1: 0.2, 2: 0.2 }),
    { together: [['answer_7', 'question_7']] },
  )
  assert.ok(r.findings.some((f) => f.kind === 'separated' && /answer_7/.test(f.message)))
})

test('a trailing blank page is caught', () => {
  const r = comparePagination(
    layout(1, { question_1: 1 }, { 1: 0.2 }),
    layout(2, { question_1: 1 }, { 1: 0.2, 2: 0 }),
  )
  const blank = r.findings.find((f) => f.kind === 'blank_page')
  assert.ok(blank, 'reported as blank')
  assert.equal(blank.page, 2)
})

test('a page with ink but no anchors is not called blank', () => {
  // A continuation page carrying only answer lines has no anchor on it and is
  // perfectly legitimate. Calling it blank would be a false positive on every
  // long paper.
  const r = comparePagination(
    layout(2, { question_1: 1 }, { 1: 0.2, 2: 0.05 }),
    layout(2, { question_1: 1 }, { 1: 0.2, 2: 0.05 }),
  )
  assert.equal(r.findings.filter((f) => f.kind === 'blank_page').length, 0)
})

test('a question vanishing entirely is not merely a move', () => {
  const r = comparePagination(
    layout(1, { question_1: 1, question_2: 1 }, { 1: 0.2 }),
    layout(1, { question_1: 1 }, { 1: 0.2 }),
  )
  const gone = r.findings.find((f) => f.kind === 'anchor_missing')
  assert.ok(gone)
  assert.match(gone.message, /question_2 is no longer on the paper/)
})

test('a missing layout map fails rather than passing', () => {
  assert.equal(comparePagination(null, layout(1, {})).changed, true)
  assert.equal(comparePagination(layout(1, {}), null).changed, true)
})

console.log(`\n✓ visual comparison — ${passed} tests passed`)
