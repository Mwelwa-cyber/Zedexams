/**
 * Regression guard for the PDF.js worker setup.
 *
 * Bug: on old Android System WebViews, PDF.js could not start its module
 * Worker, fell back to the "fake worker", and died with
 *   Setting up fake worker failed: "Unexpected token '{'".
 * That broke the in-app exam-timetable viewer, the past-paper viewer, and
 * the document-quiz importer on exactly the low-end devices the app targets.
 *
 * Fix: every PDF.js consumer goes through src/utils/pdfjsLoader.js, which
 * registers the worker handler on `globalThis.pdfjsWorker` so PDF.js runs
 * the worker on the main thread instead of spawning a Worker / re-importing
 * the worker URL.
 *
 * This is a text-level check (the loader can't run under plain node — it
 * uses `?url` imports and browser globals), in the same spirit as
 * test-firestore-rules-text.mjs.
 *
 * Run: node scripts/test-pdfjs-loader.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ok  - ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL - ${name}${detail ? `\n        ${detail}` : ''}`)
  }
}

console.log('PDF.js loader regression checks')

// 1. The shared loader registers the main-thread worker handler. This is the
//    line that actually fixes the "fake worker" failure — without it PDF.js
//    falls back to `new Worker(url, {type:'module'})` + import(url).
const loader = read('src/utils/pdfjsLoader.js')
check(
  'pdfjsLoader registers globalThis.pdfjsWorker',
  /globalThis\.pdfjsWorker\s*=/.test(loader),
  'src/utils/pdfjsLoader.js must assign the worker module to globalThis.pdfjsWorker',
)
check(
  'pdfjsLoader imports the worker module (not just the ?url asset)',
  /import\(['"]pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs['"]\)/.test(loader),
  'the bundled worker module is what runs on the main thread',
)
check(
  'pdfjsLoader exports loadPdfjs',
  /export\s+function\s+loadPdfjs|export\s+\{[^}]*loadPdfjs/.test(loader),
)

// 2. No PDF.js consumer may set GlobalWorkerOptions.workerSrc on its own —
//    that is the fragile inline-loader pattern this bug came from. Worker
//    setup must flow through the shared loader.
const consumers = [
  'src/shared/components/PdfScrollViewer.jsx',
  'src/shared/components/PdfJsViewer.jsx',
  'src/services/quizImport/documentQuizImporter.js',
]
for (const file of consumers) {
  const src = read(file)
  check(
    `${file} uses the shared loadPdfjs()`,
    /from ['"][^'"]*utils\/pdfjsLoader(\.js)?['"]/.test(src) && /loadPdfjs\s*\(/.test(src),
  )
  check(
    `${file} does not set GlobalWorkerOptions directly`,
    !/GlobalWorkerOptions/.test(src),
    'inline workerSrc setup re-introduces the fake-worker failure on old WebViews',
  )
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll PDF.js loader checks passed')
