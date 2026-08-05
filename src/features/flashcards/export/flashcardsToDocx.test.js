/**
 * Golden-file regression test for the flashcard Word (.docx) exporter.
 *
 * Colocated with the exporter it tests (architecture.md §3). It moved here from
 * src/utils/docxExporters.test.js with the exporter itself in Phase 2; the
 * fixture and the expected strings are unchanged, and the assertions still come
 * from the one copy in docxExportChecks.js, so this case and the fourteen that
 * stayed behind cannot drift apart:
 *
 *   1. distinctive fixture strings land in word/document.xml (the body),
 *   2. `{ attribution: true }` adds the diagonal watermark (a `textpath` shape
 *      in a word/headerN.xml part) AND the "Made with ZedExams" footer,
 *   3. `{ attribution: false }` stays completely clean of both.
 *
 * The shared harness registers a module hook to retry extensionless relative
 * imports; this exporter writes its own with extensions, so no hook is needed.
 *
 * Run: node src/features/flashcards/export/flashcardsToDocx.test.js
 */

import { assertExporterDocument } from '../../../utils/docxExportChecks.js'
import { buildFlashcardsDocument } from './flashcardsToDocx.js'

let assertions = 0
let failures = 0
function assert(cond, msg) {
  assertions += 1
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const FLASHCARDS = {
  header: { title: 'Photosynthesis Flashcards', grade: 'Grade 8', subject: 'Science', topic: 'Plants' },
  cards: [
    { front: 'What gas do plants absorb for photosynthesis?', back: 'Carbon dioxide', example: 'Leaves take in air through stomata', hint: 'It is what we breathe out' },
    { front: 'Where does photosynthesis happen?', back: 'In the chloroplasts' },
  ],
}

console.log('flashcardsToDocx')

try {
  await assertExporterDocument({
    build: (opts) => buildFlashcardsDocument(FLASHCARDS, { mode: 'cutout', ...opts }),
    expected: [
      'Photosynthesis Flashcards',
      'What gas do plants absorb for photosynthesis?',
      'Carbon dioxide',
      'In the chloroplasts',
    ],
    attribution: true,
  }, assert)
} catch (err) {
  failures += 1
  console.error(`  ✗ threw: ${err && err.stack ? err.stack.split('\n')[0] : err}`)
}

console.log(`\n${assertions - failures}/${assertions} assertions passed`)
if (failures) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log('ok: flashcard docx exporter')
