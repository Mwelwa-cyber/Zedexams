/**
 * Regression guard for the studio download fix.
 *
 * Teachers reported that "Download PDF" only opened a print preview (never a
 * file) and "Download Word" silently failed. The fix:
 *   • A shared real-PDF helper (src/utils/htmlToPdf.js) rasterises the export
 *     HTML and saves a real .pdf, falling back to window.print() on failure.
 *   • Every studio PDF button calls the async download wrapper, not the bare
 *     print function.
 *   • The Lesson Plan Studio's Word export loads a LOCALLY-vendored html-docx
 *     converter instead of a flaky CDN script.
 *
 * These are static (text-level) checks — same style as
 * test-pdf-export-window.test.js. They don't execute the browser-only code;
 * they assert the wiring can't silently regress to the old behaviour.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let failures = 0
const read = (rel) => readFileSync(join(root, rel), 'utf8')
function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`)
  } else {
    console.error(`✗ ${msg}`)
    failures += 1
  }
}

// 1. Shared real-PDF helper.
const htmlToPdf = read('src/utils/htmlToPdf.js')
check(/export async function downloadHtmlAsPdf/.test(htmlToPdf), 'htmlToPdf exports downloadHtmlAsPdf')
check(/export async function htmlToPdfBlob/.test(htmlToPdf), 'htmlToPdf exports htmlToPdfBlob')
check(/import\(['"]html2canvas['"]\)/.test(htmlToPdf), 'htmlToPdf lazy-imports html2canvas')
check(/import\(['"]jspdf['"]\)/.test(htmlToPdf), 'htmlToPdf lazy-imports jspdf')
check(/onFallback/.test(htmlToPdf), 'htmlToPdf supports a print fallback (onFallback)')

// 2. Shared blob saver.
const saveBlob = read('src/utils/saveBlob.js')
check(/export async function saveBlob/.test(saveBlob), 'saveBlob exports saveBlob()')
check(/file-saver/.test(saveBlob) && /a\.download/.test(saveBlob), 'saveBlob uses file-saver with an <a download> fallback')

// 3. Each ToPdf util has a real-download wrapper AND keeps the print fallback.
//    The assessment exporter is intentionally NOT here: PDF export was removed
//    from the Assessment Studio + list (html2canvas mangled the paper), leaving
//    Word (.docx) as the only download. See section 9 for the Word-only guard.
const pdfUtils = {
  'src/utils/lessonPlanToPdf.js': {
    download: /export async function downloadLessonPlanPdf/,
    print: /export function printLessonPlanAsPdf/,
  },
  'src/utils/classTimetableToPdf.js': {
    download: /export async function downloadClassTimetablePdf/,
    print: /export function printClassTimetableAsPdf/,
  },
}
for (const [rel, { download, print }] of Object.entries(pdfUtils)) {
  const src = read(rel)
  check(download.test(src), `${rel} exports an async real-PDF download wrapper`)
  check(print.test(src), `${rel} keeps the print() fallback`)
  check(/downloadHtmlAsPdf/.test(src), `${rel} routes through the shared real-PDF helper`)
}

// 4. PDF buttons in the remaining PDF surfaces call the async download wrapper,
//    not the bare print function (which only opened a dialog).
const componentNoBarePrint = {
  'src/components/teacher/generate/ClassTimetableStudio.jsx': /downloadClassTimetablePdf/,
  'src/components/teacher/library/LibraryItemDetail.jsx': /downloadClassTimetablePdf/,
}
for (const [rel, re] of Object.entries(componentNoBarePrint)) {
  check(re.test(read(rel)), `${rel} calls the async PDF download wrapper`)
}

// 5. Lesson Plan Studio (vanilla) export script is Word-only: the PDF + HTML
//    download paths were removed, leaving Word (.docx) as the sole export.
const exportJs = read('public/studio/10-export.js')
check(/\/studio\/vendor\/html-docx\.min\.js/.test(exportJs), '10-export.js loads the locally-vendored Word converter')
check(!/cdn\.jsdelivr|cdnjs|unpkg/.test(exportJs), '10-export.js no longer pulls the Word converter from a CDN')
check(/exportWordLegacy/.test(exportJs), '10-export.js keeps the .doc fallback')
check(!/function exportPDF|function exportHTML/.test(exportJs), '10-export.js has no PDF/HTML export functions')
check(!/__zxDownloadPdf/.test(exportJs), '10-export.js no longer uses the PDF bridge')
// The Word (.docx) download must route through the bundled saveBlob bridge so
// large files aren't truncated into "unreadable content" on Android Chrome.
check(/window\.__zxSaveBlob/.test(exportJs), '10-export.js prefers the bundled saveBlob bridge for downloads')
check(/legacyTriggerDownload/.test(exportJs), '10-export.js keeps a legacy download fallback when the bridge is absent')

// 6. Vendored converter is actually present.
check(
  existsSync(join(root, 'public/studio/vendor/html-docx.min.js')),
  'vendored html-docx converter exists in public/studio/vendor/',
)

// 7. React wrapper is Word-only: no PDF bridge, and only the Word export button
//    survives in the export menu.
const studioJsx = read('src/components/teacher/generate/LessonPlanStudio.jsx')
check(!/__zxDownloadPdf/.test(studioJsx), 'LessonPlanStudio no longer registers the PDF bridge')
check(!/downloadHtmlAsPdf/.test(studioJsx), 'LessonPlanStudio no longer imports the real-PDF helper')
check(/data-export="word"/.test(studioJsx), 'LessonPlanStudio keeps the Word export button')
check(!/data-export="pdf"|data-export="html"/.test(studioJsx), 'LessonPlanStudio has no PDF/HTML export buttons')
check(/window\.__zxSaveBlob\s*=/.test(studioJsx), 'LessonPlanStudio registers the __zxSaveBlob bridge')
check(/delete window\.__zxSaveBlob/.test(studioJsx), 'LessonPlanStudio cleans up the saveBlob bridge on unmount')

// 8. The PDF libraries get their own lazy chunk (kept out of the eager vendor).
const viteConfig = read('vite.config.js')
check(
  /jspdf/.test(viteConfig) && /html2canvas/.test(viteConfig) && /pdf-vendor/.test(viteConfig),
  'vite.config splits jspdf + html2canvas into a lazy pdf-vendor chunk',
)

// 9. The Assessment Studio + list are Word-only: they export via
//    downloadAssessmentDocx and must NOT reintroduce a PDF download path
//    (the assessmentToPdf util was deleted). Guards the "remove PDF, keep
//    Word" change from silently regressing.
const wordOnlySurfaces = [
  'src/components/teacher/AssessmentStudio.jsx',
  'src/components/teacher/AssessmentList.jsx',
]
for (const rel of wordOnlySurfaces) {
  const src = read(rel)
  check(/downloadAssessmentDocx/.test(src), `${rel} exports assessments as Word (.docx)`)
  check(!/assessmentToPdf|downloadAssessmentPdf|downloadAnswerSheetPdf/.test(src), `${rel} has no PDF assessment download path`)
}
check(
  !existsSync(join(root, 'src/utils/assessmentToPdf.js')),
  'assessmentToPdf util is gone (assessment PDF export removed)',
)

if (failures) {
  console.error(`\n✗ studio-downloads guard FAILED (${failures} issue(s)).`)
  process.exit(1)
}
console.log('\n✓ studio-downloads guard passed.')
