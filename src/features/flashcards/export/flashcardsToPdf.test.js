/**
 * Regression tests for the flashcard PDF exporter's pure
 * `buildFlashcardsPrintableHtml`.
 *
 * Colocated with the exporter it tests (architecture.md §3). It moved here from
 * src/utils/studioPdfExporters.test.js with the exporter itself in Phase 2 —
 * the four properties it checks are unchanged and still come from the one copy
 * in printableHtmlChecks.js, so this case and the six that stayed behind cannot
 * drift apart:
 *
 *   1. Content — the key strings from a realistic fixture land in the HTML.
 *   2. Escaping — user content containing `<script>` is escaped, never raw.
 *   3. Pagination — keep-together rules live in the BASE stylesheet, not inside
 *      @media print (html2canvas reads screen computed styles).
 *   4. Watermark — `attribution: true` injects the free-plan watermark.
 *
 * Run: node src/features/flashcards/export/flashcardsToPdf.test.js
 */

import { buildFlashcardsPrintableHtml } from './flashcardsToPdf.js'
import { makePrintableHtmlChecks, XSS } from '../../../utils/printableHtmlChecks.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const { checkAll, checkEscaped } = makePrintableHtmlChecks(assert)

// ── Flashcards ─────────────────────────────────────────────────────

{
  console.log('flashcards PDF')
  // Trimmed from the flashcards sample artifact (teacherSamples.js). Kept
  // verbatim from the shared test so the content assertions still exercise
  // realistic data — that module cannot be imported here because its
  // dependency chain pulls in a .webp asset import only Vite can resolve.
  const sample = {
    schemaVersion: '1.0',
    header: {
      title: 'Social & Commercial Arithmetic — Quick Drill',
      subject: 'Mathematics', grade: 'Grade 7',
      topic: 'Unit 5: Social and Commercial Arithmetic', cardCount: 3,
    },
    cards: [
      {
        front: 'What is PROFIT?',
        back: 'The money gained when the selling price is higher than the cost price. Profit = Selling Price − Cost Price.',
        example: 'Bought a crate of drinks for K180, sold all for K240 → profit K60.',
        hint: 'Selling for MORE than you paid.',
      },
      {
        front: 'Formula for SIMPLE INTEREST',
        back: 'I = (P × R × T) ÷ 100, where P is the principal, R the rate per year, and T the time in years.',
        example: 'K500 at 10% for 2 years: I = (500 × 10 × 2) ÷ 100 = K100.',
        hint: 'P, R and T multiplied, then divide by 100.',
      },
      {
        front: 'What is a DISCOUNT?',
        back: 'An amount taken off the marked price to get the actual selling price.',
        example: null,
        hint: 'The shop "cuts" the price for you.',
      },
    ],
  }
  const html = buildFlashcardsPrintableHtml(sample)
  checkAll(html, 'flashcards')
  assert(html.includes('Social &amp; Commercial Arithmetic — Quick Drill') || html.includes('Quick Drill'), 'flashcards: title rendered')
  assert(html.includes('What is PROFIT?'), 'flashcards: card front rendered')
  assert(html.includes('Profit = Selling Price − Cost Price.'), 'flashcards: card back rendered')
  assert(html.includes('QUESTION') && html.includes('ANSWER'), 'flashcards: front/back labels rendered')
  assert(html.includes('Bought a crate of drinks for K180'), 'flashcards: example rendered')

  const xss = buildFlashcardsPrintableHtml({
    header: { title: `T ${XSS}` },
    cards: [{ front: `F ${XSS}`, back: `B ${XSS}`, example: XSS, hint: XSS }],
  })
  checkEscaped(xss, 'flashcards')
}

if (failures) {
  console.error(`\n${failures} flashcard PDF exporter failure(s).`)
  process.exit(1)
}
console.log('\nok: flashcard PDF exporter')
