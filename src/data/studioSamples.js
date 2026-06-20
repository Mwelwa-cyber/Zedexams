/**
 * Locked-studio sample artifacts.
 *
 * On the Free plan a teacher can only OPEN the Lesson Plan studio. Every other
 * generator studio is closed until they upgrade to Pro or Max — instead of the
 * working studio they see a read-only SAMPLE of what the studio produces, so
 * they can judge the quality before paying. <LockedStudio> renders these.
 *
 * Where the public /teachers landing page already curates a real artifact
 * (src/data/teacherSamples.js) we reuse it verbatim so the marketing sample and
 * the in-app locked sample never drift. The remaining studios get a hand-curated
 * artifact here, shaped to feed the studio's own read-only View component
 * (NotesView, RubricView, SbaTaskView, …) so the preview matches a real
 * generation exactly.
 *
 * Each entry:
 *   tool      — the usage-meter tool key (also the gate key in App.jsx)
 *   emoji     — studio glyph for the page header
 *   eyebrow   — studio name ("Worksheet Studio")
 *   title     — what the sample shows
 *   subtitle  — one-line description
 *   feature   — human label passed to the paywall ("Worksheets")
 *   artifact  — the data the matching View renders
 *   render    — which View <LockedStudio> should use (it switches on this)
 */

import { TEACHER_SAMPLES } from './teacherSamples'
import { getSbaBlueprint } from '../config/sba'
import { buildPeriods } from '../utils/classTimetable'

// Index the curated marketing samples by tool so we can reuse their artifacts.
const byTool = Object.fromEntries(TEACHER_SAMPLES.map((s) => [s.tool, s]))

// ── SBA blueprint-derived samples ──────────────────────────────────────────
// Build the tracker columns + planner statuses straight from the official
// Grade 6 Social Studies blueprint so the keys always match what the views
// expect (no hand-typed column keys to drift).
const SBA_SUBJECT = 'social_studies'
const SBA_GRADE = 'G6'
const sbaBlueprint = getSbaBlueprint(SBA_SUBJECT, SBA_GRADE)
const sbaColumns = sbaBlueprint?.columns || []

// A plausible mid-year mark sheet for ten (fictional) pupils. Marks are only
// filled for the Term 1 columns — the later terms read as "not yet marked".
const sbaTerm1Keys = sbaColumns.filter((c) => /Term 1/i.test(c.group)).map((c) => c.key)
const SBA_PUPIL_NAMES = [
  'Natasha Zulu', 'Emmanuel Tembo', 'Chimwemwe Banda', 'Joseph Mwewa',
  'Lushomo Hamoonga', 'Grace Mulenga', 'Kondwani Sakala', 'Thandiwe Ngoma',
  'Mapalo Kabwe', 'Chanda Mwansa',
]
function sbaPupil(name, i) {
  const marks = {}
  sbaTerm1Keys.forEach((key, k) => {
    const col = sbaColumns.find((c) => c.key === key)
    const max = col?.max || 20
    // Deterministic spread so positions look real but nothing is hand-tuned.
    marks[key] = Math.max(6, Math.min(max, Math.round(max * (0.62 + ((i + k) % 4) * 0.1))))
  })
  return { name, marks }
}

// Planner statuses: Term 1 marked, Term 2 partly administered/planned, Term 3
// untouched — a believable picture of a teacher mid-way through the year.
const sbaStatuses = {}
sbaColumns.forEach((c) => {
  if (/Term 1/i.test(c.group)) sbaStatuses[c.key] = 'marked'
  else if (/Term 2/i.test(c.group)) sbaStatuses[c.key] = 'planned'
})
if (sbaColumns[3]) sbaStatuses[sbaColumns[3].key] = 'administered'

// ── Class timetable sample ─────────────────────────────────────────────────
// Periods come from the studio's own builder so the row ids (p1…p8, breaks)
// line up with what ClassTimetableView reads out of `slots`.
const timetablePeriods = buildPeriods({})
const TIMETABLE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
// A balanced Grade 5 week. Keyed p1…p8 (the lesson rows); break rows span all
// days and carry no subject.
const TIMETABLE_GRID = {
  p1: ['Mathematics', 'English', 'Mathematics', 'English', 'Mathematics'],
  p2: ['English', 'Mathematics', 'English', 'Mathematics', 'English'],
  p3: ['Integrated Science', 'Social Studies', 'Integrated Science', 'Social Studies', 'Integrated Science'],
  p4: ['Social Studies', 'Integrated Science', 'Social Studies', 'Integrated Science', 'Zambian Language'],
  p5: ['Zambian Language', 'Zambian Language', 'Creative & Tech', 'Zambian Language', 'Social Studies'],
  p6: ['Creative & Tech', 'P.E.', 'Zambian Language', 'Creative & Tech', 'Creative & Tech'],
  p7: ['P.E.', 'Creative & Tech', 'P.E.', 'P.E.', 'Library / Reading'],
  p8: ['Library / Reading', 'Library / Reading', 'Library / Reading', 'Creative & Tech', 'P.E.'],
}
const timetableSlots = {}
for (const [pid, row] of Object.entries(TIMETABLE_GRID)) {
  timetableSlots[pid] = {}
  TIMETABLE_DAYS.forEach((day, i) => { timetableSlots[pid][day] = row[i] })
}

/* ════════════════════════════════════════════════════════════════════════ */

export const STUDIO_SAMPLES = {
  worksheet: {
    tool: 'worksheet',
    render: 'worksheet',
    emoji: '📝',
    eyebrow: 'Worksheet Studio',
    title: 'Sample worksheet',
    subtitle: 'Pupil-ready questions with marks and a one-tap answer key for marking.',
    feature: 'Worksheets',
    artifact: byTool.worksheet?.artifact,
  },

  flashcards: {
    tool: 'flashcards',
    render: 'flashcards',
    emoji: '🃏',
    eyebrow: 'Flashcards Studio',
    title: 'Sample flashcards',
    subtitle: 'Tap to flip — drill definitions and formulas, or print as cut-outs.',
    feature: 'Flashcards',
    artifact: byTool.flashcards?.artifact,
  },

  scheme_of_work: {
    tool: 'scheme_of_work',
    render: 'scheme_of_work',
    emoji: '🗓️',
    eyebrow: 'Schemes of Work Studio',
    title: 'Sample scheme of work',
    subtitle: 'The official CDC 9-column term plan — competences, activities, methods and references.',
    feature: 'Schemes of work',
    artifact: byTool.scheme_of_work?.artifact,
  },

  weekly_forecast: {
    tool: 'weekly_forecast',
    render: 'weekly_forecast',
    emoji: '📅',
    eyebrow: 'Weekly Forecast Studio',
    title: 'Sample weekly forecast',
    subtitle: 'The week broken down day by day, with a progress-remarks column.',
    feature: 'Weekly forecasts',
    artifact: byTool.weekly_forecast?.artifact,
  },

  record_of_work: {
    tool: 'record_of_work',
    render: 'record_of_work',
    emoji: '🗂️',
    eyebrow: 'Record of Work Studio',
    title: 'Sample record of work',
    subtitle: 'What was actually taught each week, with coverage and head-teacher remarks.',
    feature: 'Records of work',
    artifact: byTool.record_of_work?.artifact,
  },

  mark_schedule: {
    tool: 'mark_schedule',
    render: 'mark_schedule',
    emoji: '🧮',
    eyebrow: 'Mark Schedule Studio',
    title: 'Sample mark schedule',
    subtitle: 'Enter the marks — totals, class positions and report comments fill themselves in.',
    feature: 'Mark schedules',
    artifact: byTool.mark_schedule?.artifact,
  },

  exam_paper: {
    tool: 'exam_paper',
    render: 'test_paper',
    emoji: '📄',
    eyebrow: 'Exam Studio',
    title: 'Sample exam paper',
    subtitle: 'A complete ECZ-style paper, ready to print — with the marking scheme.',
    feature: 'Exam papers',
    artifact: byTool.term_test?.artifact,
  },

  assessment: {
    tool: 'assessment',
    render: 'test_paper',
    emoji: '📋',
    eyebrow: 'Test Paper Studio',
    title: 'Sample test paper',
    subtitle: 'Mid-term and end-of-term papers, ready to print, with answer keys.',
    feature: 'Test papers',
    artifact: byTool.term_test?.artifact,
  },

  // ── Hand-curated artifacts (no marketing sample to reuse) ────────────────

  notes: {
    tool: 'notes',
    render: 'notes',
    emoji: '🦉',
    eyebrow: 'Teaching Notes Studio',
    title: 'Sample teaching notes',
    subtitle: 'Hooks, worked examples, common pupil questions and misconceptions to watch for.',
    feature: 'Teaching notes',
    artifact: {
      header: {
        school: 'Chilenje Primary School',
        teacherName: 'Ms. Mwansa',
        date: '',
        grade: '5B',
        subject: 'mathematics',
        topic: 'Fractions & Decimals',
        subtopic: 'Adding fractions with the same denominator',
        durationMinutes: 40,
        language: 'English',
      },
      introduction: {
        hook: 'Fold a paper strip into 8 equal parts in front of the class, shade 3 of them and ask: "If I shade 2 more, how much is shaded now?" Let them feel the answer before any rule is written.',
        whyItMatters: 'Fractions describe fair sharing — of nshima, money, land and time. Adding like fractions is the first step toward decimals and percentages later this term.',
        priorKnowledge: 'Learners can already name fractions from shaded diagrams and identify the numerator and denominator from Grade 4.',
      },
      keyConcepts: [
        { name: 'Like denominators', explanation: 'Fractions with the same bottom number describe parts of the SAME size, so they can be counted and added directly.' },
        { name: 'The addition rule', explanation: 'Add the numerators and keep the denominator the same: 2/8 + 3/8 = 5/8. The denominator never changes because the size of each part has not changed.' },
        { name: 'Simplest form', explanation: 'A sum like 4/8 can be written with smaller numbers (1/2) by dividing the top and bottom by the same number.' },
      ],
      workedExamples: [
        {
          problem: 'Add 2/7 + 3/7.',
          steps: ['The denominators are the same (7), so add the numerators: 2 + 3 = 5.', 'Keep the denominator: the answer is 5/7.', 'Check: 5/7 cannot be simplified, so it is already in simplest form.'],
          answer: '5/7',
        },
        {
          problem: 'Mother gives you 2/6 of a chitenge length, then 3/6 more. What fraction do you have?',
          steps: ['Add the numerators: 2 + 3 = 5.', 'Keep the denominator 6: you have 5/6 of the length.'],
          answer: '5/6 of the chitenge',
        },
      ],
      studentQuestions: [
        { question: 'Do I add the bottom numbers too?', answer: 'No. The denominator tells you the SIZE of each part. That size has not changed, so it stays the same — only the numerators are added.' },
        { question: 'What if the answer is bigger than the whole, like 7/6?', answer: 'That is fine for now — it means more than one whole. We will write these as mixed numbers in a later lesson.' },
      ],
      misconceptions: [
        { misconception: 'Adding the denominators: 2/8 + 3/8 = 5/16.', correction: 'Go back to the paper strip — the parts are still eighths, so the answer is 5/8, not 5/16.' },
        { misconception: 'Thinking 4/8 and 1/2 are different amounts.', correction: 'Line them up on the fraction wall: 4/8 reaches exactly the same point as 1/2. They are equal.' },
      ],
      discussionPrompts: [
        'Where in real life do we add fractions of the same size?',
        'Why does the denominator stay the same but the numerator changes?',
      ],
      quickChecks: [
        'Solve 1/5 + 3/5 on your mini chalkboard and hold it up.',
        'Write 6/8 in its simplest form.',
      ],
      glossary: [
        { term: 'Numerator', definition: 'The top number of a fraction — how many parts you have.' },
        { term: 'Denominator', definition: 'The bottom number — how many equal parts the whole is divided into.' },
        { term: 'Simplest form', definition: 'A fraction written with the smallest possible whole numbers.' },
      ],
      references: [
        "Mathematics Learner's Book Grade 5, pages 24–27",
        'CDC Mathematics Syllabus Grades 4–7 (2023 Competency-Based Curriculum)',
      ],
    },
  },

  rubric: {
    tool: 'rubric',
    render: 'rubric',
    emoji: '📐',
    eyebrow: 'Rubric Studio',
    title: 'Sample marking rubric',
    subtitle: 'Clear criteria, level descriptors and grade bands — mark consistently and defend every mark.',
    feature: 'Rubrics',
    artifact: {
      header: {
        taskDescription: 'Grade 6 Integrated Science investigation: "Which local material keeps water warmest?"',
        grade: 'Grade 6',
        subject: 'Integrated Science',
        taskType: 'Practical investigation',
        totalMarks: 20,
        assessmentType: 'School Based Assessment',
        gradeBands: [
          { symbol: 'A', name: 'Distinction', range: '16–20' },
          { symbol: 'B', name: 'Merit', range: '12–15' },
          { symbol: 'C', name: 'Credit', range: '8–11' },
          { symbol: 'D', name: 'Pass', range: '5–7' },
          { symbol: 'U', name: 'Developing', range: '0–4' },
        ],
      },
      markingNotes: 'Award marks for the science thinking, not neat handwriting. A learner who explains a "wrong" result sensibly still earns the reasoning marks.',
      criteria: [
        {
          name: 'Planning a fair test',
          maxMarks: 5,
          keyCompetencies: ['Scientific inquiry'],
          levels: [
            { levelName: 'Excellent', marks: 5, descriptor: 'States the variable changed, what is measured, and two things kept the same.' },
            { levelName: 'Good', marks: 4, descriptor: 'Identifies the variable and the measurement; one control named.' },
            { levelName: 'Satisfactory', marks: 2, descriptor: 'A basic plan with no controls described.' },
            { levelName: 'Needs Improvement', marks: 1, descriptor: 'Little or no plan; copies the question.' },
          ],
        },
        {
          name: 'Recording results',
          maxMarks: 5,
          keyCompetencies: ['Data handling'],
          levels: [
            { levelName: 'Excellent', marks: 5, descriptor: 'Neat table with units; readings taken at fair intervals.' },
            { levelName: 'Good', marks: 4, descriptor: 'Table with units; most readings present.' },
            { levelName: 'Satisfactory', marks: 2, descriptor: 'Some readings recorded; units missing.' },
            { levelName: 'Needs Improvement', marks: 1, descriptor: 'Few or muddled readings.' },
          ],
        },
        {
          name: 'Conclusion & explanation',
          maxMarks: 6,
          keyCompetencies: ['Critical thinking', 'Communication'],
          levels: [
            { levelName: 'Excellent', marks: 6, descriptor: 'Correct conclusion linked to the data AND explained using insulation.' },
            { levelName: 'Good', marks: 4, descriptor: 'Correct conclusion supported by the data.' },
            { levelName: 'Satisfactory', marks: 2, descriptor: 'A conclusion stated but not tied to results.' },
            { levelName: 'Needs Improvement', marks: 1, descriptor: 'No clear conclusion.' },
          ],
        },
        {
          name: 'Safety & teamwork',
          maxMarks: 4,
          keyCompetencies: ['Collaboration'],
          levels: [
            { levelName: 'Excellent', marks: 4, descriptor: 'Handles hot water safely and shares tasks fairly throughout.' },
            { levelName: 'Good', marks: 3, descriptor: 'Mostly safe; co-operates with the group.' },
            { levelName: 'Satisfactory', marks: 2, descriptor: 'Needs reminders on safety or sharing.' },
            { levelName: 'Needs Improvement', marks: 1, descriptor: 'Unsafe or does not participate.' },
          ],
        },
      ],
    },
  },

  homework: {
    tool: 'homework',
    render: 'homework',
    emoji: '🏠',
    eyebrow: 'Homework Studio',
    title: 'Sample homework',
    subtitle: 'Pupil questions with a marking key and a short note for parents.',
    feature: 'Homework',
    artifact: {
      header: {
        grade: 'Grade 6',
        subject: 'Integrated Science',
        topic: 'Ecosystems & Food Chains',
        subtopic: 'Producers, consumers and energy flow',
      },
      instructions: 'Do all the questions in your homework book. Use full sentences for questions 4 and 5.',
      questions: [
        { number: 1, prompt: 'Name ONE producer and ONE consumer found near your home.', answer: 'Any correct local example, e.g. producer: maize / star grass; consumer: chicken / goat.', workingNotes: '1 mark each.' },
        { number: 2, prompt: 'Write a food chain with four organisms found in Zambia. Use arrows.', answer: 'e.g. star grass → grasshopper → lizard → snake eagle.', workingNotes: 'Arrows must point toward the eater.' },
        { number: 3, prompt: 'What do the arrows in a food chain show?', answer: 'The direction in which energy flows when one organism eats another.', workingNotes: '' },
        { number: 4, prompt: 'Farmers sprayed chemicals that killed most grasshoppers. Explain what could happen to the birds that eat them.', answer: 'The birds lose their food, so they may go hungry, move away or die — showing how organisms depend on each other.', workingNotes: 'Reward cause-and-effect reasoning.' },
        { number: 5, prompt: 'Give ONE reason decomposers are important.', answer: 'They break down dead plants and animals and return nutrients to the soil for producers to use.', workingNotes: 'Needs both ideas for full marks.' },
      ],
      parentNote: 'Please ask your child to read their food chain aloud to you. Talking it through helps the idea stick — no writing needed from you.',
      answerKey: {
        markingNotes: 'Total 10 marks. Accept any sensible local examples. Question 4 carries the reasoning — mark the thinking, not the spelling.',
      },
    },
  },

  class_timetable: {
    tool: 'class_timetable',
    render: 'class_timetable',
    emoji: '📌',
    eyebrow: 'Class Timetable Studio',
    title: 'Sample class timetable',
    subtitle: 'A balanced week auto-filled from the curriculum, ready to print for the classroom wall.',
    feature: 'Class timetables',
    artifact: {
      header: {
        school: 'Chilenje Primary School',
        className: '5B',
        grade: 'G5',
        term: '1',
        year: '2026',
        teacherName: 'Ms. Mwansa',
      },
      days: TIMETABLE_DAYS,
      periods: timetablePeriods,
      slots: timetableSlots,
    },
  },

  sba_task: {
    tool: 'sba_task',
    render: 'sba_task',
    emoji: '🧪',
    eyebrow: 'SBA Studio',
    title: 'Sample SBA task',
    subtitle: 'A printable school-based assessment task with its full marking scheme.',
    feature: 'SBA tasks',
    artifact: {
      header: {
        schoolName: 'Chilenje Primary School',
        title: 'Heat & Insulation Investigation',
        subject: 'integrated_science',
        grade: 'G6',
        term: 'Term 1',
        totalMarks: 20,
        duration: '60 minutes',
        taskType: 'Experiment',
        component: '',
        skill: 'Scientific inquiry',
        bloomLevels: ['Apply', 'Analyse'],
        outcomeRefs: ['6.2.1.1'],
      },
      instructions: 'Work in pairs. Carry out the investigation, record your readings, then answer all the questions in the spaces provided.',
      stimulus: 'You are given a cup of hot water, a thermometer, and three local materials: a cotton cloth, dry grass and newspaper. You will find out which material keeps the water warmest.',
      questions: [
        { number: 1, prompt: 'Write down what you will change, what you will measure, and two things you will keep the same.', marks: 5, answer: 'Change: the wrapping material. Measure: water temperature after 10 minutes. Keep the same: amount of water, starting temperature, size of cup.', markAllocation: [{ description: 'Variable changed', marks: 1 }, { description: 'Measurement stated', marks: 2 }, { description: 'Two controls', marks: 2 }] },
        { number: 2, prompt: 'Record your temperature readings in a neat table with units.', marks: 5, answer: 'A table with material vs. temperature (°C) at 0 and 10 minutes.', markAllocation: [{ description: 'Table with headings and units', marks: 3 }, { description: 'All readings present', marks: 2 }] },
        { number: 3, prompt: 'Which material kept the water warmest? Explain why, using the word "insulation".', marks: 6, answer: 'Dry grass (or whichever trapped the most air). Trapped air is a good insulator, so it slows heat loss.', markAllocation: [{ description: 'Correct material from data', marks: 2 }, { description: 'Links to data', marks: 2 }, { description: 'Explains using insulation', marks: 2 }] },
        { number: 4, prompt: 'Describe ONE way you worked safely with the hot water.', marks: 4, answer: 'e.g. poured carefully, did not touch the hot cup directly, kept water away from the edge of the desk.', markAllocation: [{ description: 'Sensible safety measure', marks: 2 }, { description: 'Relevant to hot water', marks: 2 }] },
      ],
      markingScheme: {
        style: 'criteria_rubric',
        notes: 'Mark the science thinking, not neat handwriting. A learner who explains an unexpected result sensibly still earns the reasoning marks.',
        criteria: [
          { name: 'Planning a fair test', maxMarks: 5, descriptor: 'Variable changed, measurement and two controls all identified.' },
          { name: 'Recording results', maxMarks: 5, descriptor: 'Neat table with units and complete readings.' },
          { name: 'Conclusion & explanation', maxMarks: 6, descriptor: 'Correct conclusion from the data, explained using insulation.' },
          { name: 'Safety & teamwork', maxMarks: 4, descriptor: 'Works safely with hot water and shares the task fairly.' },
        ],
      },
      administration: 'Set up one tray of materials per pair before the lesson. Allow 10 minutes for the water to cool while readings are taken. Collect thermometers at the end.',
    },
  },

  sba_tracker: {
    tool: 'sba_tracker',
    render: 'sba_tracker',
    emoji: '📊',
    eyebrow: 'SBA Mark Tracker',
    title: 'Sample SBA mark sheet',
    subtitle: 'Record each task mark — the 10% SBA conversion is worked out for every pupil.',
    feature: 'SBA mark tracking',
    artifact: {
      header: {
        subjectLabel: 'Social Studies',
        gradeLabel: 'Grade 6',
        school: 'Chilenje Primary School',
        className: '6A',
        year: '2026',
      },
      columns: sbaColumns,
      total: sbaBlueprint?.total || 0,
      pupils: SBA_PUPIL_NAMES.map(sbaPupil),
    },
  },

  sba_planner: {
    tool: 'sba_planner',
    render: 'sba_planner',
    emoji: '🗓️',
    eyebrow: 'SBA Year Planner',
    title: 'Sample SBA year plan',
    subtitle: 'Track every official task from Planned → Administered → Marked across the year.',
    feature: 'SBA year planning',
    artifact: {
      header: {
        subject: SBA_SUBJECT,
        grade: SBA_GRADE,
        subjectLabel: 'Social Studies',
        gradeLabel: 'Grade 6',
        school: 'Chilenje Primary School',
        className: '6A',
        year: '2026',
      },
      statuses: sbaStatuses,
    },
  },
}

/** Tool keys that are gated to a sample on the Free plan (everything a
 *  StudioGate wraps). Lesson plans are deliberately absent — they stay open. */
export const SAMPLE_TOOL_KEYS = Object.keys(STUDIO_SAMPLES)

export function getStudioSample(tool) {
  return STUDIO_SAMPLES[tool] || null
}
