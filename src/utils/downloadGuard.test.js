/**
 * Unit tests for the deterministic download guard.
 *
 *   node src/utils/downloadGuard.test.js
 *
 * Plain-node assertion script (throws on failure) — the util is pure, so it
 * imports cleanly without firebase/config or jsdom.
 */
import { inspectFilename, checkDownload } from './downloadGuard.js'

let passed = 0
let failed = 0

function ok(cond, msg) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`✗ ${msg}`)
  }
}

// ── inspectFilename: bad names ──────────────────────────────────────────
ok(!inspectFilename('').ok, 'empty string flagged')
ok(inspectFilename('').code === 'empty', 'empty → code "empty"')
ok(!inspectFilename('   ').ok, 'whitespace-only flagged')
ok(!inspectFilename('Grade 4 Mathematics Worksheet').ok, 'no extension flagged')
ok(inspectFilename('Grade 4 Mathematics Worksheet').code === 'no-extension', 'no-extension code')
ok(!inspectFilename('download').ok, 'bare "download" flagged (no ext)')
ok(!inspectFilename('download.docx').ok, 'generic "download.docx" flagged')
ok(inspectFilename('download.docx').code === 'generic-default', 'generic-default code')
ok(!inspectFilename('worksheet.docx').ok, 'generic "worksheet.docx" flagged')
ok(!inspectFilename('lesson-plan.docx').ok, 'generic "lesson-plan.docx" flagged')
ok(!inspectFilename('assessment.docx').ok, 'generic "assessment.docx" flagged')
ok(!inspectFilename('sba-task.docx').ok, 'generic "sba-task.docx" flagged')
ok(!inspectFilename('DOWNLOAD.DOCX').ok, 'generic match is case-insensitive')
ok(
  !inspectFilename('5fee66fe-1c3a-4b9d-9c2a-1234567890ab.docx').ok,
  'UUID filename flagged',
)
ok(
  inspectFilename('5fee66fe-1c3a-4b9d-9c2a-1234567890ab.docx').code === 'uuid-name',
  'uuid-name code',
)
ok(
  !inspectFilename('a1b2c3d4e5f6a7b8c9d0e1f2.docx').ok,
  'long hex gibberish flagged',
)

// ── inspectFilename: good names pass ────────────────────────────────────
ok(inspectFilename('Grade 4 Mathematics Worksheet.docx').ok, 'good name passes')
ok(inspectFilename('Grade 4 Integrated Science Notes - Plants.pdf').ok, 'good name w/ topic passes')
ok(inspectFilename('Grade 8 English Lesson Plan.docx').ok, 'good lesson-plan name passes')
// "Worksheet" with real grade/subject context is NOT the bare generic default.
ok(inspectFilename('Grade 5 English Worksheet.docx').ok, 'real worksheet name not flagged as generic')

// ── checkDownload: filename problem surfaces ────────────────────────────
{
  const r = checkDownload({ tool: 'worksheet', filename: 'download.docx', output: { header: { title: 'X' } } })
  ok(!r.ok, 'checkDownload flags junk filename')
  ok(r.problems.some((p) => p.code === 'generic-default'), 'junk filename problem code present')
}

// ── checkDownload: missing title ────────────────────────────────────────
{
  const r = checkDownload({
    tool: 'worksheet',
    filename: 'Grade 4 Mathematics Worksheet.docx',
    output: { header: {} },
  })
  ok(!r.ok, 'missing title flagged')
  ok(r.problems.some((p) => p.code === 'missing-title'), 'missing-title code present')
}

// Title accepted from any of the three locations.
ok(
  checkDownload({ filename: 'Grade 4 Mathematics Worksheet.docx', output: { title: 'My Worksheet' } }).ok,
  'output.title accepted',
)
ok(
  checkDownload({ filename: 'Grade 4 Mathematics Lesson Plan.docx', output: { header: { topic: 'Fractions' } } }).ok,
  'lesson-plan header.topic accepted as title',
)

// ── checkDownload: grade/subject mismatch ───────────────────────────────
{
  const r = checkDownload({
    tool: 'worksheet',
    filename: 'Grade 6 English Worksheet.docx',
    output: { header: { title: 'W' } },
    inputs: { grade: 'G4', subject: 'integrated_science' },
  })
  ok(!r.ok, 'grade/subject mismatch flagged')
  ok(r.problems.some((p) => p.code === 'name-mismatch'), 'name-mismatch code present')
  const m = r.problems.find((p) => p.code === 'name-mismatch')
  ok(/Grade 4/.test(m.message) && /Integrated Science/.test(m.message), 'mismatch names expected grade + subject')
}

// Matching name + grade + subject passes.
ok(
  checkDownload({
    tool: 'worksheet',
    filename: 'Grade 4 Integrated Science Worksheet.docx',
    output: { header: { title: 'W' } },
    inputs: { grade: 'G4', subject: 'integrated_science' },
  }).ok,
  'matching name+grade+subject passes',
)

// ── checkDownload: empty sections ───────────────────────────────────────
{
  const r = checkDownload({
    tool: 'worksheet',
    filename: 'Grade 4 Mathematics Worksheet.docx',
    output: { header: { title: 'W' }, sections: [] },
  })
  ok(!r.ok, 'empty sections array flagged')
  ok(r.problems.some((p) => p.code === 'empty-document'), 'empty-document code present')
}
{
  const r = checkDownload({
    tool: 'worksheet',
    filename: 'Grade 4 Mathematics Worksheet.docx',
    output: { header: { title: 'W' }, sections: [{ questions: [] }, { questions: [] }] },
  })
  ok(!r.ok, 'sections with no questions flagged')
}
// Non-empty sections pass.
ok(
  checkDownload({
    filename: 'Grade 4 Mathematics Worksheet.docx',
    output: { header: { title: 'W' }, sections: [{ questions: [{ q: '1+1?' }] }] },
  }).ok,
  'non-empty sections pass',
)

// ── checkDownload: tool WITHOUT sections is not false-flagged ────────────
ok(
  checkDownload({
    tool: 'sbaTask',
    filename: 'Grade 6 English SBA Task.docx',
    output: { header: { title: 'Task' }, questions: [{ q: 'Describe…' }] },
  }).ok,
  'sectionless tool (SBA task) not false-flagged as empty',
)
// SBA task with no questions array at all (oral/practical) — still no false empty flag.
ok(
  checkDownload({
    filename: 'Grade 6 English SBA Task.docx',
    output: { header: { title: 'Task' }, markingScheme: { criteria: [{ c: 'x' }] } },
  }).ok,
  'sectionless tool with no questions array not flagged empty',
)

// ── summary ─────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`✓ downloadGuard: ${passed} passed`)
