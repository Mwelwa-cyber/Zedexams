/**
 * Regression tests for the studio PDF exporters (rubric, notes, homework,
 * full lesson, scheme of work, SBA task).
 *
 * The flashcard exporter moved to src/features/flashcards/export/ with its
 * feature (architecture.md Phase 2); its case lives there, colocated, and
 * checks the same properties through printableHtmlChecks.js.
 *
 * For each exporter's pure `build*PrintableHtml` this guards:
 *   1. Content — the key strings from a realistic fixture land in the HTML.
 *   2. Escaping — user content containing `<script>` is escaped, never raw.
 *   3. Pagination — keep-together rules (`page-break-inside:avoid`) live in
 *      the BASE stylesheet, not inside @media print. html2canvas reads SCREEN
 *      computed styles to decide where to cut a page; rules hidden behind
 *      @media print are invisible to it (see lessonPlanToPdf.test.js).
 *   4. Watermark — `attribution: true` on the download path injects the
 *      free-plan watermark style; without it the document stays clean.
 *
 * Run: node src/utils/studioPdfExporters.test.js
 */

import { buildRubricPrintableHtml } from '../engines/export-engine/rubricToPdf.js'
import { buildFlashcardsPrintableHtml } from '../engines/export-engine/flashcardsToPdf.js'
import { buildNotesPrintableHtml } from '../engines/export-engine/notesToPdf.js'
import { buildHomeworkPrintableHtml } from '../engines/export-engine/homeworkToPdf.js'
import { buildFullLessonPrintableHtml } from './fullLessonToPdf.js'
import { buildSchemeOfWorkPrintableHtml } from '../engines/export-engine/schemeOfWorkToPdf.js'
import { buildSbaTaskPrintableHtml } from './sbaTaskToPdf.js'
import { makePrintableHtmlChecks, XSS } from './printableHtmlChecks.js'

// NOTE: the fixtures below are trimmed copies of the locked-studio sample
// artifacts in src/data/studioSamples.js / teacherSamples.js. We can't import
// those modules here because their dependency chain pulls in a .webp asset
// import (teacherSamples.js) that only Vite can resolve — plain node throws
// ERR_MODULE_NOT_FOUND. Key strings are kept verbatim so the content
// assertions still exercise realistic data.

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

// ── Shared checks ──────────────────────────────────────────────────
// One copy, in printableHtmlChecks.js, so the flashcard exporter's colocated
// test in src/features/flashcards/ checks the same properties as the six here.

const { checkEscaped, checkAll } = makePrintableHtmlChecks(assert)

// ── Rubric ─────────────────────────────────────────────────────────

{
  console.log('\nrubric PDF')
  // Trimmed from the rubric sample artifact (studioSamples.js) — ECZ ladder
  // levels (Distinction … Fail) rather than the four standard CBC names.
  const sample = {
    header: {
      taskDescription: 'Grade 12 English Language Paper 2 — Directed Writing: formal letter to a newspaper editor (25 marks)',
      grade: 'Grade 12', subject: 'English Language',
      taskType: 'Directed writing — formal letter',
      totalMarks: 25, assessmentType: 'School Examination',
      gradeBands: [
        { symbol: 'A', name: 'Distinction', range: '21–25' },
        { symbol: 'B', name: 'Merit', range: '16–20' },
        { symbol: 'U', name: 'Fail', range: '0–5' },
      ],
    },
    markingNotes: 'Mark the quality of communication, not whether you agree with the argument.',
    criteria: [
      {
        name: 'Content & argument', maxMarks: 10,
        keyCompetencies: ['Critical thinking', 'Communication'],
        levels: [
          { levelName: 'Distinction', marks: 10, descriptor: 'Argument is clear, convincing and fully developed with at least three distinct points.' },
          { levelName: 'Merit', marks: 8, descriptor: 'Argument is clear with two or more developed points.' },
          { levelName: 'Credit', marks: 6, descriptor: 'Relevant content with a recognisable argument.' },
          { levelName: 'Pass', marks: 3, descriptor: 'Some relevant ideas but argument is thin or repetitive.' },
          { levelName: 'Fail', marks: 1, descriptor: 'Little relevant content. No discernible argument.' },
        ],
      },
      {
        name: 'Register, tone & format', maxMarks: 8,
        keyCompetencies: ['Communication'],
        levels: [
          { levelName: 'Distinction', marks: 8, descriptor: 'Formal register sustained throughout.' },
          { levelName: 'Merit', marks: 6, descriptor: 'Mainly formal with minor lapses.' },
          { levelName: 'Credit', marks: 4, descriptor: 'Register inconsistent (formal and informal mixed).' },
          { levelName: 'Pass', marks: 2, descriptor: 'Register often informal.' },
          { levelName: 'Fail', marks: 1, descriptor: 'No awareness of formal register or letter format.' },
        ],
      },
    ],
  }
  const html = buildRubricPrintableHtml(sample)
  checkAll(html, 'rubric')
  assert(html.includes('Content &amp; argument'), 'rubric: criterion name rendered')
  assert(html.includes('Distinction') && html.includes('Fail'), 'rubric: level columns derived from the data')
  assert(html.includes('Formal register sustained throughout.'), 'rubric: level descriptor rendered')
  assert(html.includes('Mark the quality of communication'), 'rubric: marking notes rendered')
  assert(html.includes('21–25'), 'rubric: grade band range rendered')
  assert(html.includes('size: A4 landscape'), 'rubric: print fallback uses landscape')

  // A standard 4-level rubric keeps the CBC columns.
  const std = buildRubricPrintableHtml({
    header: { title: 'Std', totalMarks: 10 },
    criteria: [{ name: `C ${XSS}`, maxMarks: 10, levels: [
      { levelName: 'Excellent', marks: 10, descriptor: XSS },
      { levelName: 'Good', marks: 7, descriptor: 'ok' },
      { levelName: 'Satisfactory', marks: 5, descriptor: 'ok' },
      { levelName: 'Needs Improvement', marks: 2, descriptor: 'ok' },
    ] }],
  })
  assert(std.includes('Excellent') && std.includes('Needs Improvement'), 'rubric: standard CBC levels rendered')
  checkEscaped(std, 'rubric')
}

// ── Notes ──────────────────────────────────────────────────────────

{
  console.log('\nnotes PDF')
  // Trimmed from the notes sample artifact (studioSamples.js).
  const sample = {
    header: {
      school: 'Matero Basic School', teacherName: 'Mr. Phiri', grade: '1A',
      subject: 'literacy', topic: 'Phonics & Early Reading',
      subtopic: 'Reading CVC words (consonant–vowel–consonant)',
      durationMinutes: 30, language: 'English',
    },
    introduction: {
      hook: 'Hold up a red cup and say "c … u … p". Clap one clap for each sound.',
      whyItMatters: 'Being able to sound out three-letter words unlocks a huge bank of everyday vocabulary.',
      priorKnowledge: 'Learners already know the letter names and sounds for all 26 letters.',
    },
    keyConcepts: [
      { name: 'CVC pattern', explanation: 'A CVC word has three sounds in the order Consonant–Vowel–Consonant (e.g. c-a-t, d-o-g, s-u-n).' },
      { name: 'Blending', explanation: 'Blending means pushing the individual sounds together smoothly until they make a word.' },
    ],
    workedExamples: [
      {
        problem: 'Read the word "sun".',
        steps: ['Point to s and say /s/.', 'Point to u and say the short vowel.', 'Push the sounds together.'],
        answer: 'sun',
      },
    ],
    studentQuestions: [
      { question: 'What if I do not know the sound for a letter?', answer: 'Go back to the alphabet chart on the wall.' },
    ],
    misconceptions: [
      { misconception: 'Saying the letter name instead of the sound.', correction: 'Practise "c says /k/" with a clap routine until it is automatic.' },
    ],
    discussionPrompts: ['Can you think of three CVC words that rhyme with "hat"?'],
    quickChecks: ['Show the word card "pig" — ask learners to blend it on mini chalkboards.'],
    glossary: [
      { term: 'Blend', definition: 'Push individual letter sounds together to make a word.' },
      { term: 'Vowel', definition: 'A letter that makes an open sound (a, e, i, o, u).' },
    ],
    references: ['Zambia CDC Grade 1 English Literacy Syllabus (2023 CBC)'],
  }
  const html = buildNotesPrintableHtml(sample)
  checkAll(html, 'notes')
  assert(html.includes('Matero Basic School'), 'notes: school heading rendered')
  assert(html.includes('Literacy Teaching Notes'), 'notes: subject title rendered')
  assert(html.includes('CVC pattern'), 'notes: key concept rendered')
  assert(html.includes('Read the word &quot;sun&quot;.'), 'notes: worked example rendered (escaped quotes)')
  assert(html.includes('Misconceptions to Watch For'), 'notes: misconceptions section rendered')
  assert(html.includes('Blend') && html.includes('Glossary'), 'notes: glossary rendered')

  const xss = buildNotesPrintableHtml({
    header: { school: XSS, subject: 'science', topic: XSS },
    keyConcepts: [{ name: XSS, explanation: XSS }],
    discussionPrompts: [XSS],
  })
  checkEscaped(xss, 'notes')
}

// ── Homework ───────────────────────────────────────────────────────

{
  console.log('\nhomework PDF')
  // Trimmed from the homework sample artifact (studioSamples.js).
  const sample = {
    header: {
      grade: 'Grade 7', subject: 'Mathematics',
      topic: 'Ratio and Proportion', subtopic: 'Dividing quantities in a given ratio',
    },
    instructions: 'Show all working clearly. Questions 4 and 5 carry method marks — a correct answer with no working earns only 1 mark.',
    questions: [
      { number: 1, prompt: 'Write the ratio 24 : 36 in its simplest form.', answer: '2 : 3', workingNotes: 'Divide both parts by the HCF (12).' },
      { number: 2, prompt: 'Divide K180 between Chanda and Mwamba in the ratio 2 : 3.', answer: 'Chanda gets K72, Mwamba gets K108.', workingNotes: 'Total parts = 5. One part = K36.' },
    ],
    parentNote: 'Ask your child to explain question 2 to you using real coins or notes.',
    answerKey: { markingNotes: 'Total 12 marks. Q1–Q3: 2 marks each (1 method, 1 answer). Accept equivalent working.' },
  }

  const pupil = buildHomeworkPrintableHtml(sample, { includeAnswers: false })
  checkAll(pupil, 'homework (pupil)')
  assert(pupil.includes('Write the ratio 24 : 36 in its simplest form.'), 'homework: question rendered')
  assert(pupil.includes('Show all working clearly.'), 'homework: instructions rendered')
  assert(pupil.includes('Note for Parent / Guardian'), 'homework: parent note rendered')
  assert(!pupil.includes('Answer Key (teacher)'), 'homework: pupil sheet omits the answer key')
  assert(!pupil.includes('Divide both parts by the HCF (12).'), 'homework: pupil sheet omits working notes')

  const teacher = buildHomeworkPrintableHtml(sample, { includeAnswers: true })
  assert(teacher.includes('Answer Key (teacher)'), 'homework: teacher copy has the answer key')
  assert(teacher.includes('2 : 3'), 'homework: answer rendered')
  assert(teacher.includes('Divide both parts by the HCF (12).'), 'homework: working notes rendered')
  assert(teacher.includes('Total 12 marks.'), 'homework: marking notes rendered')

  const xss = buildHomeworkPrintableHtml({
    header: { title: XSS },
    instructions: XSS,
    questions: [{ number: 1, prompt: XSS, answer: XSS, workingNotes: XSS }],
    parentNote: XSS,
    answerKey: { markingNotes: XSS },
  }, { includeAnswers: true })
  checkEscaped(xss, 'homework')
}

// ── Full lesson (no studio sample artifact — inline fixture) ───────

{
  console.log('\nfull lesson PDF')
  const lesson = {
    header: {
      title: 'Fractions: Adding with Unlike Denominators',
      topic: 'Fractions', subtopic: 'Unlike denominators',
      grade: 'G5', subject: 'mathematics', term: 2, durationMinutes: 40, language: 'English',
    },
    objectives: ['Add two fractions with unlike denominators', `Spot ${XSS} errors`],
    keyVocabulary: [{ term: 'Denominator', definition: 'The bottom number of a fraction.' }],
    introduction: { hook: 'Cut an orange into quarters in front of the class.', priorKnowledge: 'Equivalent fractions from Term 1.' },
    teaching: [{ heading: 'Finding a common denominator', explanation: 'List multiples of both denominators and pick the lowest one they share.' }],
    workedExamples: [{ problem: 'Work out 1/2 + 1/3.', steps: ['LCM of 2 and 3 is 6', 'Convert: 3/6 + 2/6', 'Add: 5/6'], answer: '5/6' }],
    guidedPractice: ['Try 1/4 + 1/2 on your mini whiteboard'],
    learnerActivities: ['Pair up and set each other one question'],
    assessment: { checks: ['What is 2/5 + 1/10?'], answers: ['5/10 = 1/2'] },
    summary: 'To add unlike fractions, rename them with a common denominator first.',
    homework: { task: 'Complete exercise 7B questions 1-5.', answerGuide: 'All answers simplify to halves or thirds.' },
    references: ['Grade 5 Mathematics Syllabus p.12'],
  }
  const html = buildFullLessonPrintableHtml(lesson)
  checkAll(html, 'full lesson')
  assert(html.includes('Fractions: Adding with Unlike Denominators'), 'full lesson: title rendered')
  assert(html.includes('Lesson Objectives'), 'full lesson: objectives section rendered')
  assert(html.includes('Denominator'), 'full lesson: vocabulary rendered')
  assert(html.includes('Cut an orange into quarters in front of the class.'), 'full lesson: hook rendered')
  assert(html.includes('Finding a common denominator'), 'full lesson: teaching heading rendered')
  assert(html.includes('LCM of 2 and 3 is 6'), 'full lesson: worked example steps rendered')
  assert(html.includes('Formative Checks') && html.includes('Answer Key'), 'full lesson: checks + answer key rendered')
  assert(html.includes('Complete exercise 7B questions 1-5.'), 'full lesson: homework rendered')
  checkEscaped(html, 'full lesson')
}

// ── Scheme of work (official + legacy shapes) ──────────────────────

{
  console.log('\nscheme of work PDF — official CDC shape')
  // Trimmed from the scheme-of-work sample artifact (teacherSamples.js) —
  // schemaVersion 'sow-table-1.0' routes through isOfficialScheme().
  const sample = {
    schemaVersion: 'sow-table-1.0',
    header: {
      subject: 'Integrated Science', grade: '4', term: 1, year: '2026',
      periodsPerWeek: '6 periods × 40 minutes',
    },
    weeks: [
      {
        week: '1',
        topic: '4.1 THE HUMAN BODY',
        subtopic: '4.1.1 The Respiratory System',
        specificCompetences: ['4.1.1.1 Demonstrate understanding of the respiratory system in the human body'],
        learningActivities: ['Describing the respiratory system in humans', 'Drawing the human respiratory system'],
        expectedStandard: 'Understanding of the respiratory system demonstrated satisfactorily',
        methods: ['Exposition', 'Q & A', 'Group work'],
        tlAids: ['Charts', 'Models', 'Science Module'],
        references: 'Grade 4 Science Syllabus p.1; Grade 4 Science Module',
      },
      {
        week: '2',
        topic: '4.1 THE HUMAN BODY',
        subtopic: '4.1.2 Blood Circulatory System',
        specificCompetences: ['4.1.2.1 Demonstrate understanding of the blood circulatory system'],
        learningActivities: ['Tracking the flow of blood in veins and arteries'],
        expectedStandard: 'Blood circulatory system described correctly',
        methods: ['Exposition', 'Collaborative drawing'],
        tlAids: ['Heart diagrams', 'Science Module'],
        references: 'Grade 4 Science Syllabus p.2',
      },
    ],
  }
  const html = buildSchemeOfWorkPrintableHtml(sample)
  checkAll(html, 'scheme (official)')
  assert(html.includes('INTEGRATED SCIENCE SCHEMES OF WORK'), 'scheme: official title rendered')
  assert(html.includes('SPECIFIC COMPETENCES') && html.includes('T/L AIDS'), 'scheme: 9-column CDC headers rendered')
  assert(html.includes('4.1.1 The Respiratory System'), 'scheme: week subtopic rendered')
  assert(html.includes('Drawing the human respiratory system'), 'scheme: learning activity rendered')
  assert(html.includes('size: A4 landscape'), 'scheme: print fallback uses landscape')

  console.log('\nscheme of work PDF — legacy v1 shape')
  const legacy = buildSchemeOfWorkPrintableHtml({
    schemaVersion: '1.0',
    header: { school: 'Kabwata Primary', teacherName: `Mrs ${XSS}`, class: '6B', subject: 'english', term: 2, numberOfWeeks: 2 },
    overview: { termTheme: 'Reading for meaning', overallCompetencies: ['Literacy'], overallValues: ['Cooperation'] },
    weeks: [{
      weekNumber: 1,
      topic: 'Comprehension',
      subtopics: ['Skimming', XSS],
      specificOutcomes: ['Answer literal questions from a passage'],
      keyCompetencies: ['Communication'],
      values: ['Patience'],
      teachingLearningActivities: ['Shared reading of a short passage'],
      materials: ['Reader', 'Chalkboard'],
      assessment: 'Oral questions',
    }],
  })
  assert(legacy.includes('SCHEME OF WORK'), 'scheme legacy: title rendered')
  assert(legacy.includes('Topic &amp; Sub-topics') && legacy.includes('Specific Outcomes'), 'scheme legacy: v1 column headers rendered')
  assert(legacy.includes('Kabwata Primary'), 'scheme legacy: metadata rendered')
  assert(legacy.includes('Reading for meaning'), 'scheme legacy: term theme rendered')
  assert(legacy.includes('Shared reading of a short passage'), 'scheme legacy: activities rendered')
  checkEscaped(legacy, 'scheme legacy')
}

// ── SBA task ───────────────────────────────────────────────────────

{
  console.log('\nSBA task PDF')
  // Trimmed from the sba_task sample artifact (studioSamples.js).
  const sample = {
    header: {
      schoolName: 'Chilenje Primary School',
      title: 'Heat & Insulation Investigation',
      subject: 'integrated_science', grade: 'G6', term: 'Term 1',
      totalMarks: 20, duration: '60 minutes', taskType: 'Experiment',
      skill: 'Scientific inquiry', bloomLevels: ['Apply', 'Analyse'], outcomeRefs: ['6.2.1.1'],
    },
    instructions: 'Work in pairs. Carry out the investigation, record your readings, then answer all the questions in the spaces provided.',
    stimulus: 'You are given a cup of hot water, a thermometer, and three local materials: a cotton cloth, dry grass and newspaper.',
    questions: [
      {
        number: 1,
        prompt: 'Write down what you will change, what you will measure, and two things you will keep the same.',
        marks: 5,
        answer: 'Change: the wrapping material. Measure: water temperature after 10 minutes.',
        markAllocation: [{ description: 'Variable changed', marks: 1 }, { description: 'Two controls', marks: 2 }],
      },
      {
        number: 2,
        prompt: 'Which material kept the water warmest? Explain why, using the word "insulation".',
        marks: 6,
        answer: 'Dry grass. Trapped air is a good insulator, so it slows heat loss.',
        markAllocation: [{ description: 'Correct material from data', marks: 2 }],
      },
    ],
    markingScheme: {
      style: 'criteria_rubric',
      notes: 'Mark the science thinking, not neat handwriting.',
      criteria: [
        { name: 'Planning a fair test', maxMarks: 5, descriptor: 'Variable changed, measurement and two controls all identified.' },
        { name: 'Conclusion & explanation', maxMarks: 6, descriptor: 'Correct conclusion from the data, explained using insulation.' },
      ],
    },
    administration: 'Set up one tray of materials per pair before the lesson. Collect thermometers at the end.',
  }

  const learner = buildSbaTaskPrintableHtml(sample, { includeAnswers: false, schoolName: 'Chilenje Primary School' })
  checkAll(learner, 'sba (learner)')
  assert(learner.includes('CHILENJE PRIMARY SCHOOL'), 'sba: school banner rendered')
  assert(learner.includes('SCHOOL BASED ASSESSMENT'), 'sba: paper title rendered')
  assert(learner.includes('INTEGRATED SCIENCE'), 'sba: subject rendered')
  assert(learner.includes('NAME:') && learner.includes('CLASS:'), 'sba: learner fields rendered')
  assert(learner.includes('Work in pairs.'), 'sba: instructions rendered')
  assert(learner.includes('You are given a cup of hot water'), 'sba: stimulus passage rendered')
  assert(learner.includes('END OF PAPER'), 'sba: end-of-paper rendered')
  assert(learner.includes('answer-line'), 'sba: ruled answer space rendered')
  assert(!learner.includes('Marking scheme'), 'sba: learner copy omits the marking scheme')
  assert(!learner.includes('Planning a fair test'), 'sba: learner copy omits the criteria table')

  const teacher = buildSbaTaskPrintableHtml(sample, { includeAnswers: true, schoolName: 'Chilenje Primary School' })
  assert(teacher.includes('Marking scheme'), 'sba: teacher copy has the marking scheme')
  assert(teacher.includes('Model answers &amp; mark allocation'), 'sba: model answers section rendered')
  assert(teacher.includes('Variable changed'), 'sba: mark allocation rendered')
  assert(teacher.includes('Planning a fair test'), 'sba: criteria table rendered')
  assert(teacher.includes('Set up one tray of materials per pair'), 'sba: administration guidance rendered')
  assert(teacher.includes('page-break-before:always'), 'sba: marking scheme starts on its own page')

  const xss = buildSbaTaskPrintableHtml({
    header: { title: XSS, subject: 'english', grade: 'G5', term: 'Term 1', totalMarks: 10, taskType: XSS },
    instructions: XSS,
    stimulus: XSS,
    questions: [{ number: 1, prompt: XSS, marks: 4, answer: XSS, markAllocation: [{ description: XSS, marks: 2 }] }],
    markingScheme: { style: 'criteria_rubric', notes: XSS, criteria: [{ name: XSS, maxMarks: 10, descriptor: XSS }] },
    administration: XSS,
  }, { includeAnswers: true, schoolName: XSS })
  checkEscaped(xss, 'sba')
}

// ── Flashcards ──────────────────────────────────────────────

{
  console.log('\nflashcards PDF')
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

// ── Result ─────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll studioPdfExporters tests passed.')
