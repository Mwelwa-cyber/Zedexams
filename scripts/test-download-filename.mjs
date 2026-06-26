/**
 * Unit tests for the human-readable download filename builder.
 *
 *   node scripts/test-download-filename.mjs
 */
import { buildDownloadName, buildAssessmentName, gradeLabel, subjectLabel } from '../src/utils/downloadFilename.js'

let passed = 0
let failed = 0
function eq(actual, expected, msg) {
  if (actual === expected) {
    passed++
  } else {
    failed++
    console.error(`✗ ${msg}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`)
  }
}

// --- gradeLabel ---------------------------------------------------------
eq(gradeLabel('G4'), 'Grade 4', 'G4 → Grade 4')
eq(gradeLabel('g4'), 'Grade 4', 'lowercase g4 → Grade 4')
eq(gradeLabel('4'), 'Grade 4', 'bare number 4 → Grade 4')
eq(gradeLabel('Grade 5'), 'Grade 5', 'already "Grade 5" stays')
eq(gradeLabel('G8'), 'Grade 8', 'dual-name G8 trims "/ Form 1"')
eq(gradeLabel('ECE_N'), 'Nursery', 'ECE band drops age parenthetical')
eq(gradeLabel(''), '', 'empty grade → empty')

// --- subjectLabel -------------------------------------------------------
eq(subjectLabel('mathematics'), 'Mathematics', 'mathematics → Mathematics')
eq(subjectLabel('integrated_science'), 'Integrated Science', 'integrated_science → Integrated Science')
eq(subjectLabel('Integrated Science'), 'Integrated Science', 'already-label passes through')
eq(subjectLabel('social_studies'), 'Social Studies', 'social_studies → Social Studies')
eq(subjectLabel('unknown_subject'), 'Unknown Subject', 'unknown slug title-cased')

// --- buildDownloadName --------------------------------------------------
eq(
  buildDownloadName({ docType: 'Lesson Plan', grade: 'G4', subject: 'mathematics' }),
  'Grade 4 Mathematics Lesson Plan.docx',
  'lesson plan, no topic',
)
eq(
  buildDownloadName({ docType: 'Notes', grade: 'G4', subject: 'science' }),
  'Grade 4 Science Notes.docx',
  'science notes (science is not a teacher-tools value → title-cased)',
)
eq(
  buildDownloadName({ docType: 'Notes', grade: 'G4', subject: 'integrated_science', topic: 'Plants' }),
  'Grade 4 Integrated Science Notes - Plants.docx',
  'notes with topic',
)
eq(
  buildDownloadName({ docType: 'Worksheet', grade: 'G5', subject: 'mathematics', topic: 'Fractions', variant: 'Answer Key' }),
  'Grade 5 Mathematics Worksheet - Fractions (Answer Key).docx',
  'worksheet answer key variant',
)
eq(
  buildDownloadName({ docType: 'Mark Schedule', grade: 'G4', term: 1, year: 2026 }),
  'Grade 4 Mark Schedule - Term 1 2026.docx',
  'term/year doc with no subject',
)
eq(
  buildDownloadName({ docType: 'Weekly Forecast', grade: 'G4', term: 2, week: 3, ext: 'docx' }),
  'Grade 4 Weekly Forecast - Term 2 Week 3.docx',
  'week-based doc',
)
eq(
  buildDownloadName({ docType: 'Class Timetable', extra: 'Blue Class', ext: 'xlsx' }),
  'Class Timetable - Blue Class.xlsx',
  'xlsx extension + extra detail, no grade/subject',
)
eq(
  buildDownloadName({ docType: 'Assessment', grade: 'G4', subject: 'mathematics', topic: 'Mathematics' }),
  'Grade 4 Mathematics Assessment.docx',
  'redundant topic equal to subject is not duplicated',
)
eq(
  // Illegal filesystem characters must be stripped, spaces preserved.
  buildDownloadName({ docType: 'Worksheet', grade: 'G4', subject: 'mathematics', topic: 'Money: K10/K20' }),
  'Grade 4 Mathematics Worksheet - Money K10 K20.docx',
  'illegal characters stripped',
)
eq(
  buildDownloadName({}),
  'Document.docx',
  'empty input falls back to Document',
)

// --- buildAssessmentName ------------------------------------------------
eq(
  // Auto-generated title already leads with grade/subject → used as-is.
  buildAssessmentName({ title: 'Grade 4 Integrated Science - Fractions', grade: '4', subject: 'integrated_science' }),
  'Grade 4 Integrated Science - Fractions.docx',
  'auto-titled assessment kept as-is (no duplication)',
)
eq(
  // Custom title with no grade/subject context → context prepended, title kept.
  buildAssessmentName({ title: 'My Test Paper', grade: '4', subject: 'integrated_science' }),
  'Grade 4 Integrated Science - My Test Paper.docx',
  'custom-titled assessment keeps grade/subject context',
)
eq(
  buildAssessmentName({ title: 'My Test Paper', grade: '4', subject: 'integrated_science', variant: 'Marking Key' }),
  'Grade 4 Integrated Science - My Test Paper (Marking Key).docx',
  'custom title + marking key variant',
)
eq(
  buildAssessmentName({ grade: '4', subject: 'mathematics' }),
  'Grade 4 Mathematics Assessment.docx',
  'no title falls back to grade/subject Assessment',
)
eq(
  // No grade available → title used directly rather than producing "Document".
  buildAssessmentName({ title: 'My Test Paper' }),
  'My Test Paper.docx',
  'custom title with no grade uses the title directly',
)

if (failed > 0) {
  console.error(`\n${failed} test(s) failed, ${passed} passed.`)
  process.exit(1)
}
console.log(`✓ all ${passed} download-filename tests passed`)
