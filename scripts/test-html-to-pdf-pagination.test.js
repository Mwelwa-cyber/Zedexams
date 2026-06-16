/**
 * Regression guard for page-break-aware PDF pagination.
 *
 * The real "Download PDF" path (src/utils/htmlToPdf.js) rasterises the whole
 * export into one tall html2canvas bitmap, then slices it into A4 pages. The
 * original slicer cut at FIXED page-height intervals, so a question/passage/
 * table that happened to straddle a page boundary was chopped in half — the
 * exact "diagrams/questions don't come out right in the download" bug teachers
 * hit on multi-page exams (e.g. a fill-in table split across pages 1→2).
 *
 * `chooseSliceBottom` is the pure decision the slicer makes per page. These
 * tests pin the behaviour: keep blocks whole, honour explicit page breaks,
 * and always make forward progress so the loop can't stall.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import { chooseSliceBottom } from '../src/utils/htmlToPdf.js'

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

const PAGE = 1000 // canvas px that fit on one A4 page, for these scenarios

// 1. Content that fits within the remaining canvas → run to the bottom.
check(
  chooseSliceBottom({ sliceTop: 0, limit: 1000, canvasHeight: 800, atomic: [], forced: [] }) === 800,
  'final/short page runs to the bottom of the canvas',
)

// 2. No block straddles the boundary → cut exactly at the page limit.
check(
  chooseSliceBottom({
    sliceTop: 0,
    limit: PAGE,
    canvasHeight: 1500,
    atomic: [{ top: 100, bottom: 400 }, { top: 1100, bottom: 1400 }],
    forced: [],
  }) === PAGE,
  'cuts at the page limit when no block straddles it',
)

// 3. A question straddles the boundary → pull the cut up to its top so the
//    whole question moves to the next page intact. THIS is the reported bug.
check(
  chooseSliceBottom({
    sliceTop: 0,
    limit: PAGE,
    canvasHeight: 1500,
    atomic: [{ top: 900, bottom: 1100 }],
    forced: [],
  }) === 900,
  'straddling block is pushed wholesale onto the next page (no mid-question cut)',
)

// 3b. …and the next page then contains that block intact.
check(
  chooseSliceBottom({
    sliceTop: 900,
    limit: 1900,
    canvasHeight: 1500,
    atomic: [{ top: 900, bottom: 1100 }],
    forced: [],
  }) === 1500,
  'the pushed block lands intact on the following page',
)

// 4. Among several straddling candidates, take the highest top (earliest cut).
check(
  chooseSliceBottom({
    sliceTop: 0,
    limit: PAGE,
    canvasHeight: 2000,
    atomic: [{ top: 980, bottom: 1200 }, { top: 940, bottom: 1050 }],
    forced: [],
  }) === 940,
  'with multiple straddling blocks, cuts above the earliest one',
)

// 5. An explicit page break inside the page wins over block logic.
check(
  chooseSliceBottom({
    sliceTop: 0,
    limit: PAGE,
    canvasHeight: 1500,
    atomic: [{ top: 900, bottom: 1100 }],
    forced: [600],
  }) === 600,
  'explicit page break takes priority over keep-together blocks',
)

// 6. A page break beyond the page limit is ignored on this page.
check(
  chooseSliceBottom({
    sliceTop: 0,
    limit: PAGE,
    canvasHeight: 1500,
    atomic: [],
    forced: [1300],
  }) === PAGE,
  'a page break past the limit is left for a later page',
)

// 7. A block taller than a whole page (starts at the page top) can't be saved —
//    the hard cut stands so the loop still advances and never stalls.
const oversized = chooseSliceBottom({
  sliceTop: 0,
  limit: PAGE,
  canvasHeight: 3000,
  atomic: [{ top: 0, bottom: 2500 }],
  forced: [],
})
check(oversized === PAGE && oversized > 0, 'an oversized block is hard-cut (forward progress guaranteed)')

// 8. Earlier forced break is chosen when several fall inside the page.
check(
  chooseSliceBottom({
    sliceTop: 0,
    limit: PAGE,
    canvasHeight: 2000,
    atomic: [],
    forced: [800, 500, 950],
  }) === 500,
  'the earliest in-page break is taken first',
)

if (failures) {
  console.error(`\n✗ html-to-pdf pagination guard FAILED (${failures} issue(s)).`)
  process.exit(1)
}
console.log('\n✓ html-to-pdf pagination guard passed.')
