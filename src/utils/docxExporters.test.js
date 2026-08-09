/**
 * Golden-file regression tests for the studio Word (.docx) exporters.
 *
 * One harness, fifteen exporters across sixteen cases (two of them are
 * schemeOfWorkToDocx's official and legacy shapes).
 *
 * The flashcard case LEFT here in Phase 2, moving to
 * src/features/flashcards/export/ with its exporter, and came BACK in Phase 4
 * (#2176): behind the feature index, that exporter gave the public share page,
 * the locked-studio sample and the /teachers marketing page a static edge to a
 * 382 kB docx-vendor chunk. The exporter is back in src/utils/ until
 * src/engines/export-engine/ exists — where §12 puts document exporters — so
 * its case is back here with it. The rubric exporter never moved, for the same
 * reason. Each case builds its document from a small
 * inline fixture, unzips the .docx (a ZIP of XML parts) and asserts
 *   1. distinctive fixture strings landed in word/document.xml (the body),
 *   2. `{ attribution: true }` adds the diagonal watermark (a `textpath`
 *      shape in a word/headerN.xml part) AND the "Made with ZedExams" footer,
 *   3. `{ attribution: false }` stays completely clean of both.
 *
 * Every case runs inside its own try/catch so one broken exporter can't hide
 * the rest. Fixtures are inline (NOT imported from src/data/studioSamples.js —
 * its import chain pulls a .webp asset that plain node can't load).
 *
 * Run: node src/utils/docxExporters.test.js
 */

import { registerHooks } from 'node:module'
import { assertExporterDocument, unzipDoc } from './docxExportChecks.js'

// Some exporters use Vite-style extensionless relative imports (e.g.
// schemeOfWorkToDocx.js imports './weeklyForecast'). Plain node refuses
// those, so retry failed relative resolutions with '.js' appended — scoped to
// this process only. The exporter modules are loaded dynamically BELOW this
// call: static imports of them would resolve before the hook registers.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.js`, context)
      }
      throw err
    }
  },
})

/**
 * Import one exporter module, returning null (with a console note) when its
 * import chain breaks under plain node — the matching cases are then skipped
 * instead of crashing the whole suite.
 */
async function loadModule(path) {
  try {
    return await import(path)
  } catch (err) {
    console.error(`  note: ${path} failed to import under node — ${err?.message || err}`)
    return null
  }
}

const flashcardsMod = await loadModule('../engines/export-engine/flashcardsToDocx.js')
const worksheetMod = await loadModule('../engines/export-engine/worksheetToDocx.js')
const notesMod = await loadModule('../engines/export-engine/notesToDocx.js')
const rubricMod = await loadModule('../engines/export-engine/rubricToDocx.js')
const homeworkMod = await loadModule('../engines/export-engine/homeworkToDocx.js')
const schemeMod = await loadModule('../engines/export-engine/schemeOfWorkToDocx.js')
const sbaTaskMod = await loadModule('./sbaTaskToDocx.js')
const sbaTrackerMod = await loadModule('./sbaTrackerToDocx.js')
const sbaPlannerMod = await loadModule('./sbaPlannerToDocx.js')
const recordOfWorkMod = await loadModule('./recordOfWorkToDocx.js')
const weeklyForecastMod = await loadModule('../engines/export-engine/weeklyForecastToDocx.js')
const classTimetableMod = await loadModule('./classTimetableToDocx.js')
const reportCardsMod = await loadModule('./reportCardsToDocx.js')
const markScheduleMod = await loadModule('./markScheduleToDocx.js')
const activityMod = await loadModule('./activityToDocx.js')

let failures = 0
let assertions = 0
function assert(cond, msg) {
  assertions += 1
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

/** Pack + unzip a docx Document and pull out the parts the assertions read. */
/* ── Inline fixtures ─────────────────────────────────────────────────── */

const WORKSHEET = {
  header: {
    title: 'Long Division Practice',
    subject: 'Mathematics',
    grade: 'Grade 6',
    topic: 'Division',
    subtopic: 'Dividing by two digits',
    duration: '40 minutes',
    totalMarks: 20,
    instructions: 'Show all your working in the space provided.',
  },
  sections: [
    {
      title: 'Section A: Calculations',
      instructions: 'Work out each division.',
      questions: [
        { number: 1, type: 'calculation', prompt: 'Work out 672 divided by 12.', marks: 2, answer: '56' },
        { number: 2, type: 'multiple_choice', prompt: 'Which number is a multiple of 15?', marks: 1, options: ['45', '50', '52', '58'], answer: '45' },
      ],
    },
  ],
  answerKey: { markingNotes: 'Award one mark for correct working.', totalMarks: 20 },
}

const FLASHCARDS = {
  header: { title: 'Photosynthesis Flashcards', grade: 'Grade 8', subject: 'Science', topic: 'Plants' },
  cards: [
    { front: 'What gas do plants absorb for photosynthesis?', back: 'Carbon dioxide', example: 'Leaves take in air through stomata', hint: 'It is what we breathe out' },
    { front: 'Where does photosynthesis happen?', back: 'In the chloroplasts' },
  ],
}

const NOTES = {
  header: {
    school: 'Kabulonga Primary School',
    subject: 'mathematics',
    teacherName: 'Mr. Banda',
    grade: 'Grade 5',
    topic: 'Fractions',
    subtopic: 'Equivalent fractions',
    durationMinutes: 40,
  },
  introduction: { hook: 'Cut an orange into equal pieces to share.', whyItMatters: 'Fractions describe fair sharing.' },
  keyConcepts: [{ name: 'Equivalent fractions', explanation: 'Fractions that name the same amount.' }],
  workedExamples: [{ problem: 'Find a fraction equivalent to one half.', steps: ['Multiply top and bottom by 2'], answer: 'Two quarters' }],
  glossary: [{ term: 'Numerator', definition: 'The top number of a fraction.' }],
}

const RUBRIC = {
  header: {
    title: 'Persuasive Essay Rubric',
    taskDescription: 'Write a persuasive essay about keeping our school clean.',
    grade: 'Grade 9',
    subject: 'English',
    taskType: 'Essay',
    totalMarks: 20,
    gradeBands: [
      { symbol: 'D1', name: 'Distinction', range: '18-20' },
      { symbol: 'M2', name: 'Merit', range: '14-17' },
    ],
  },
  markingNotes: 'Mark the essay holistically before applying the criteria.',
  criteria: [
    {
      name: 'Argument quality',
      maxMarks: 10,
      keyCompetencies: ['Critical thinking'],
      levels: [
        { levelName: 'Excellent', marks: 10, descriptor: 'Arguments are convincing and well sequenced' },
        { levelName: 'Good', marks: 7, descriptor: 'Arguments are clear with minor gaps' },
      ],
    },
  ],
}

const HOMEWORK = {
  header: { title: 'Water Cycle Homework', topic: 'The Water Cycle', grade: 'Grade 7', subject: 'Science', term: 2, estimatedMinutes: 30 },
  instructions: 'Answer every question in full sentences.',
  questions: [
    { number: 1, prompt: 'Name the process where water vapour turns to liquid.', answer: 'Condensation', workingNotes: 'Accept condensing.' },
    { number: 2, prompt: 'What drives evaporation from lakes and rivers?', answer: 'Heat from the sun' },
  ],
  parentNote: 'Please let your child observe steam from a boiling pot safely.',
  answerKey: { markingNotes: 'One mark per correct term.' },
}

// Official CDC 9-column scheme (schemaVersion 2.0 — the v2 generator shape).
const OFFICIAL_SCHEME = {
  schemaVersion: '2.0',
  header: { subject: 'Mathematics', grade: 'G4', term: 1, year: 2026, periodsPerWeek: 5, school: 'Chelstone Primary', teacherName: 'Mrs. Mwansa' },
  weeks: [
    {
      week: 1,
      topic: 'Whole Numbers',
      subtopic: 'Place value up to 10 000',
      specificCompetences: ['Identify place value of digits up to ten thousands'],
      learningActivities: ['Building numbers with place value charts'],
      expectedStandard: 'Place value identified correctly',
      methods: ['Demonstration'],
      tlAids: ['Place value charts'],
      references: 'CDC Maths Syllabus p.12',
    },
  ],
}

// Legacy v1 scheme (weekNumber/specificOutcomes/materials — pre-CDC-grid shape).
const LEGACY_SCHEME = {
  header: { school: 'Matero East Primary', teacherName: 'Mr. Phiri', class: '5B', subject: 'Science', term: 2, numberOfWeeks: 10, academicYear: '2026', mediumOfInstruction: 'English' },
  overview: { termTheme: 'Living things and their habitats', overallCompetencies: ['Observation'], overallValues: ['Curiosity'] },
  weeks: [
    {
      weekNumber: 1,
      topic: 'Habitats',
      subtopics: ['Local habitats around the school'],
      specificOutcomes: ['Describe what living things need from a habitat'],
      keyCompetencies: ['Analysis'],
      values: ['Respect for nature'],
      teachingLearningActivities: ['Nature walk around the school grounds'],
      materials: ['Hand lenses'],
      assessment: 'Oral questions during the walk',
    },
  ],
}

const SBA_TASK = {
  header: {
    title: 'Measuring Length Practical',
    subject: 'mathematics',
    grade: 'G5',
    term: 'Term 1',
    totalMarks: 10,
    duration: '40 minutes',
    taskType: 'Practical task',
    bloomLevels: ['Apply'],
    outcomeRefs: ['M5.3.1'],
  },
  instructions: 'Use your ruler to measure each object carefully.',
  stimulus: 'You have a pencil, an exercise book and a desk in front of you.',
  administration: 'Give each pupil a 30 cm ruler before the task begins.',
  questions: [
    {
      number: 1,
      prompt: 'Measure the length of your pencil in centimetres.',
      marks: 4,
      answer: 'Any measurement between 10 cm and 20 cm recorded correctly',
      markAllocation: [{ description: 'Correct unit written', marks: 2 }],
    },
  ],
  markingScheme: {
    style: 'method_marks',
    notes: 'Allow a tolerance of half a centimetre.',
    criteria: [{ name: 'Accuracy of measurement', maxMarks: 6, descriptor: 'Measurement within tolerance' }],
  },
}

const SBA_TRACKER = {
  header: { subjectLabel: 'English Language', gradeLabel: 'Grade 6', school: 'Libala Primary', className: '6A', year: 2026 },
  columns: [
    { key: 't1_reading', label: 'T1 Reading aloud', max: 20 },
    { key: 't1_writing', label: 'T1 Guided composition', max: 20 },
  ],
  pupils: [
    { name: 'Chanda Mulenga', marks: { t1_reading: 15, t1_writing: 12 } },
    { name: 'Bwalya Musonda', marks: { t1_reading: 18, t1_writing: 16 } },
  ],
  total: 40,
}

const SBA_PLAN = {
  groups: [
    {
      group: 'Term 1: Listening and Speaking',
      columns: [{ key: 't1_oral', label: 'Oral presentation task', max: 20 }],
      summary: { done: 1, total: 1 },
    },
  ],
  summary: { done: 1, total: 4, percentComplete: 25 },
  total: 80,
  statuses: { t1_oral: 'marked' },
}
const SBA_PLAN_HEADER = { subjectLabel: 'Zambian Languages', gradeLabel: 'Grade 5', school: 'Kamwala Primary', className: '5C', year: 2026 }

const RECORD_OF_WORK = {
  header: { grade: 'G3', subject: 'Mathematics', term: 1, year: 2026, school: 'Woodlands Primary', teacherName: 'Ms. Tembo' },
  weeks: [
    {
      week: 1,
      weekEnding: '16/01/2026',
      topic: 'Addition',
      subtopic: 'Adding with carrying',
      workDone: ['Taught carrying tens using bundles of sticks'],
      coverage: '',
      remarks: 'Re-teach carrying to the slower group',
    },
  ],
}

const WEEKLY_FORECAST = {
  header: { grade: 'G4', subject: 'Science', term: 2, year: 2026, school: 'Northmead Primary', teacherName: 'Mr. Zulu', weekNumber: '3', weekBeginning: '11/05/2026', weekEnding: '15/05/2026' },
  days: [
    {
      day: 'Monday',
      topic: 'Soil',
      subtopic: 'Types of soil',
      specificCompetence: 'Distinguish clay, loam and sandy soil',
      learningActivities: ['Comparing soil samples in groups'],
      expectedStandard: 'Soil types distinguished correctly',
      resources: ['Soil samples'],
      remarks: '',
    },
  ],
}

const TIMETABLE = {
  header: { school: 'Olympia Park Primary', className: '2 Blue', grade: 'G2', term: 1, year: 2026, teacherName: 'Mrs. Lungu' },
  days: ['Monday', 'Tuesday'],
  periods: [
    { id: 'p1', kind: 'lesson', start: '07:30', end: '08:10' },
    { id: 'b1', kind: 'break', start: '08:10', end: '08:30', label: 'BREAK TIME' },
    { id: 'p2', kind: 'lesson', start: '08:30', end: '09:10' },
  ],
  slots: {
    p1: { Monday: 'Literacy Hour', Tuesday: 'Numeracy' },
    p2: { Monday: 'Creative Arts', Tuesday: 'Physical Education' },
  },
}

// A completed mark-schedule artifact: pupils already ranked (sn/total/position/
// comment set), the shape MarkScheduleView saves and both exporters read.
const MARK_SCHEDULE = {
  header: { school: 'Avondale Primary School', grade: 'G7', term: 3, year: 2026, nextTermOpens: '12 January 2027' },
  subjects: [
    { key: 'eng', label: 'English', max: 100 },
    { key: 'mat', label: 'Mathematics', max: 100 },
  ],
  pupils: [
    { sn: 1, name: 'Mutale Chileshe', marks: { eng: 72, mat: 81 }, total: 153, position: 1, comment: 'An excellent term. Keep it up, Mutale.' },
    { sn: 2, name: 'Natasha Sakala', marks: { eng: 64, mat: 58 }, total: 122, position: 2, comment: 'A solid effort with room to grow in Mathematics.' },
  ],
}

const ACTIVITY = {
  kind: 'exercise',
  header: { title: 'Parts of a Plant Exercise', topic: 'Plants', subtopic: 'Plant structure', grade: 'Grade 3', subject: 'science', term: 1, difficulty: 'medium', estimatedMinutes: 20, totalMarks: 6 },
  instructions: 'Answer all the questions in the spaces given.',
  questions: [
    { number: 1, type: 'multiple_choice', prompt: 'Which part of the plant takes in water from the soil?', marks: 1, options: ['Roots', 'Leaves', 'Flower', 'Stem'], answer: 'Roots' },
    { number: 2, type: 'short_answer', prompt: 'Name the part of the plant that makes food.', marks: 2, answer: 'The leaves', workingNotes: 'Accept leaf.' },
  ],
  answerKey: { markingNotes: 'One mark per correct plant part.' },
}

/* ── Cases ───────────────────────────────────────────────────────────── */

// { name, build(opts) → Document | Promise<Document>, expected: [body strings],
//   attribution: whether the exporter honours opts.attribution,
//   extra: optional async fn for exporter-specific assertions }
const CASES = [
  {
    name: 'worksheetToDocx (mode: worksheet)',
    mod: worksheetMod,
    build: (opts) => worksheetMod.buildWorksheetDocument(WORKSHEET, { mode: 'worksheet', ...opts }),
    expected: ['WORKSHEET', 'Long Division Practice', 'Section A: Calculations', 'Work out 672 divided by 12.'],
    attribution: true,
  },
  {
    name: 'flashcardsToDocx',
    mod: flashcardsMod,
    build: (opts) => flashcardsMod.buildFlashcardsDocument(FLASHCARDS, { mode: 'cutout', ...opts }),
    expected: ['Photosynthesis Flashcards', 'What gas do plants absorb for photosynthesis?', 'Carbon dioxide', 'In the chloroplasts'],
    attribution: true,
  },
  {
    name: 'notesToDocx',
    mod: notesMod,
    build: (opts) => notesMod.buildNotesDocument(NOTES, opts),
    expected: ['Kabulonga Primary School', 'MATHEMATICS TEACHING NOTES', 'Equivalent fractions', 'Find a fraction equivalent to one half.'],
    attribution: true,
  },
  {
    name: 'rubricToDocx',
    mod: rubricMod,
    build: (opts) => rubricMod.buildRubricDocument(RUBRIC, opts),
    expected: ['Persuasive Essay Rubric', 'Argument quality', 'Arguments are convincing and well sequenced', 'Distinction'],
    attribution: true,
  },
  {
    name: 'homeworkToDocx',
    mod: homeworkMod,
    build: (opts) => homeworkMod.buildHomeworkDocument(HOMEWORK, opts),
    expected: ['Water Cycle Homework', 'Name the process where water vapour turns to liquid.', 'Condensation', 'Please let your child observe steam from a boiling pot safely.'],
    attribution: true,
    extra: async () => {
      const pupil = await unzipDoc(homeworkMod.buildHomeworkDocument(HOMEWORK, { includeAnswers: false }))
      assert(!pupil.docXml.includes('Condensation'), 'includeAnswers:false omits the answer text')
      assert(!pupil.docXml.includes('Answer Key (teacher)'), 'includeAnswers:false omits the answer-key section')
      const teacher = await unzipDoc(homeworkMod.buildHomeworkDocument(HOMEWORK, { includeAnswers: true }))
      assert(teacher.docXml.includes('Condensation'), 'includeAnswers:true includes the answer text')
      assert(teacher.docXml.includes('Answer Key (teacher)'), 'includeAnswers:true includes the answer-key section')
    },
  },
  {
    name: 'schemeOfWorkToDocx (official CDC 9-column)',
    mod: schemeMod,
    build: (opts) => schemeMod.buildOfficialSchemeOfWorkDocument(OFFICIAL_SCHEME, opts),
    expected: ['MATHEMATICS SCHEMES OF WORK', 'Place value up to 10 000', 'Identify place value of digits up to ten thousands', 'CDC Maths Syllabus p.12'],
    attribution: true,
  },
  {
    name: 'schemeOfWorkToDocx (legacy v1)',
    mod: schemeMod,
    build: (opts) => schemeMod.buildSchemeOfWorkDocument(LEGACY_SCHEME, opts),
    expected: ['SCHEME OF WORK', 'Living things and their habitats', 'Describe what living things need from a habitat', 'Nature walk around the school grounds'],
    attribution: true,
  },
  {
    name: 'sbaTaskToDocx (async paper export)',
    mod: sbaTaskMod,
    build: (opts) => sbaTaskMod.buildSbaTaskDocument(SBA_TASK, opts),
    expected: [
      'Use your ruler to measure each object carefully.',
      'Measure the length of your pencil in centimetres.',
      'Any measurement between 10 cm and 20 cm recorded correctly',
      'Correct unit written',
      'Allow a tolerance of half a centimetre.',
      // Criteria-table cells — regression for the cell() helper stringifying
      // a passed Paragraph into "[object Object]" (teacher-copy tables were
      // unreadable in downloaded documents).
      'Accuracy of measurement',
    ],
    extra: async () => {
      const teacher = await unzipDoc(await sbaTaskMod.buildSbaTaskDocument(SBA_TASK, { includeAnswers: true }))
      assert(!teacher.docXml.includes('[object Object]'), 'no cell renders as [object Object]')
    },
    // The banner lives in a real Word header even on clean exports, so only
    // the textpath / footer checks apply — those still hold through
    // paperSectionShell (watermark composed into the banner header).
    attribution: true,
  },
  {
    name: 'sbaTrackerToDocx',
    mod: sbaTrackerMod,
    build: (opts) => sbaTrackerMod.buildSbaTrackerDocument(SBA_TRACKER, opts),
    expected: ['SBA Mark Schedule', 'Chanda Mulenga', 'T1 Reading aloud /20', 'Libala Primary'],
    attribution: true,
  },
  {
    name: 'sbaPlannerToDocx (three positional args)',
    mod: sbaPlannerMod,
    build: (opts) => sbaPlannerMod.buildSbaPlannerDocument(SBA_PLAN, SBA_PLAN_HEADER, opts),
    expected: ['SBA Year Plan', 'Term 1: Listening and Speaking', 'Oral presentation task', 'Kamwala Primary'],
    attribution: true,
  },
  {
    name: 'recordOfWorkToDocx',
    mod: recordOfWorkMod,
    build: (opts) => recordOfWorkMod.buildRecordOfWorkDocument(RECORD_OF_WORK, opts),
    expected: ['RECORD OF WORK', 'Adding with carrying', 'Taught carrying tens using bundles of sticks', 'Re-teach carrying to the slower group'],
    attribution: true,
  },
  {
    name: 'weeklyForecastToDocx',
    mod: weeklyForecastMod,
    build: (opts) => weeklyForecastMod.buildWeeklyForecastDocument(WEEKLY_FORECAST, opts),
    expected: ['WEEKLY FORECAST', 'Types of soil', 'Distinguish clay, loam and sandy soil', 'Comparing soil samples in groups'],
    attribution: true,
  },
  {
    name: 'classTimetableToDocx',
    mod: classTimetableMod,
    build: (opts) => classTimetableMod.buildClassTimetableDocument(TIMETABLE, opts),
    expected: ['CLASS TIMETABLE', 'Olympia Park Primary', 'Literacy Hour', 'BREAK TIME'],
    attribution: true,
  },
  {
    name: 'reportCardsToDocx',
    mod: reportCardsMod,
    build: (opts) => reportCardsMod.buildReportCardsDocument(MARK_SCHEDULE, opts),
    expected: ['PROGRESS REPORT', 'Mutale Chileshe', 'An excellent term. Keep it up, Mutale.', 'NEXT TERM OPENS'],
    attribution: true,
  },
  {
    name: 'markScheduleToDocx (mode: marks)',
    mod: markScheduleMod,
    build: (opts) => markScheduleMod.buildMarkScheduleDocument(MARK_SCHEDULE, { mode: 'marks', ...opts }),
    expected: ['MARK SCHEDULE', 'Natasha Sakala', 'REPORT COMMENTS SHEET', 'A solid effort with room to grow in Mathematics.'],
    attribution: true,
  },
  {
    name: 'activityToDocx',
    mod: activityMod,
    build: (opts) => activityMod.buildActivityDocument(ACTIVITY, opts),
    expected: ['Parts of a Plant Exercise', 'Which part of the plant takes in water from the soil?', 'Roots', 'Name the part of the plant that makes food.'],
    attribution: true,
  },
]

/* ── Harness ─────────────────────────────────────────────────────────── */

let passedCases = 0
for (const c of CASES) {
  console.log(`\n${c.name}`)
  const before = failures
  try {
    await assertExporterDocument(c, assert)
    if (c.extra) await c.extra()
  } catch (err) {
    failures += 1
    console.error(`  ✗ threw: ${err && err.stack ? err.stack.split('\n')[0] : err}`)
  }
  if (failures === before) passedCases += 1
}

console.log(`\n${'─'.repeat(60)}`)
console.log(`${passedCases}/${CASES.length} exporter cases passed · ${assertions - failures}/${assertions} assertions passed`)
if (failures) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log('All docx exporter assertions passed')
