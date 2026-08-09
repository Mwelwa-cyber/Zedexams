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
import { buildPeriods } from '../shared/utils/classTimetable'

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
    eyebrow: 'Assessment Paper Studio',
    title: 'Sample assessment paper',
    subtitle: 'Tests through formal examinations, ready to print, with answer keys.',
    feature: 'Assessment papers',
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
        school: 'Matero Basic School',
        teacherName: 'Mr. Phiri',
        date: '',
        grade: '1A',
        subject: 'literacy',
        topic: 'Phonics & Early Reading',
        subtopic: 'Reading CVC words (consonant–vowel–consonant)',
        durationMinutes: 30,
        language: 'English',
      },
      introduction: {
        hook: 'Hold up a red cup and say "c … u … p". Clap one clap for each sound. Ask learners to do the same with their name. After two minutes, introduce the word card "cup" and let pupils discover that three sounds = three letters.',
        whyItMatters: 'Being able to sound out three-letter words unlocks a huge bank of everyday vocabulary: cat, dog, sun, run, bed, hat. This is the engine that drives independent reading throughout Grade 1.',
        priorKnowledge: 'Learners already know the letter names and sounds for all 26 letters from the alphabet songs and matching activities in Term 1.',
      },
      keyConcepts: [
        {
          name: 'CVC pattern',
          explanation: 'A CVC word has three sounds in the order Consonant–Vowel–Consonant (e.g. c-a-t, d-o-g, s-u-n). The vowel in the middle is always a short sound.',
        },
        {
          name: 'Blending',
          explanation: 'Blending means pushing the individual sounds together smoothly until they make a word: /k/ … /æ/ … /t/ → "cat". We move left to right, adding each sound to the last.',
        },
        {
          name: 'Segmenting',
          explanation: 'The reverse of blending — breaking a spoken word into its separate sounds so we can write it. "dog" → /d/ /ɒ/ /g/. One sound, one letter in a CVC word.',
        },
      ],
      workedExamples: [
        {
          problem: 'Read the word "sun".',
          steps: [
            'Point to s and say /s/.',
            'Point to u and say /ʌ/ (short vowel, like the beginning of "umbrella").',
            'Point to n and say /n/.',
            'Push the sounds together: /s/ … /ʌ/ … /n/ → "sun".',
          ],
          answer: 'sun',
        },
        {
          problem: 'Write the word the teacher says aloud: "bed".',
          steps: [
            'Listen for the first sound: /b/ — write b.',
            'Listen for the middle sound: /ɛ/ — write e.',
            'Listen for the last sound: /d/ — write d.',
          ],
          answer: 'b – e – d',
        },
      ],
      studentQuestions: [
        {
          question: 'What if I do not know the sound for a letter?',
          answer: 'Go back to the alphabet chart on the wall. Every letter has a picture beside it that gives you the sound (e.g. "a … apple").',
        },
        {
          question: 'Why does "cup" not sound like the letter name "C" (see)?',
          answer: 'Letter names and letter sounds are different. In reading we use the sound, not the name. The letter c makes the /k/ sound at the start of "cat" and "cup".',
        },
      ],
      misconceptions: [
        {
          misconception: 'Saying the letter name instead of the sound: reading "cat" as "see – ay – tee".',
          correction: 'Hold up the alphabet chart and ask the learner to give the sound, not the name. Practise "c says /k/" with a clap routine until it is automatic.',
        },
        {
          misconception: 'Forgetting the middle vowel sound and reading "ct" or "cn" for "cat".',
          correction: 'Tap the three squares on a sound-mat (one per sound). Insist on three taps before blending — the middle square forces them to find the vowel.',
        },
      ],
      discussionPrompts: [
        'Can you think of three CVC words that rhyme with "hat"?',
        'Look around the classroom — can you find an object whose name is a CVC word?',
      ],
      quickChecks: [
        'Show the word card "pig" — ask learners to blend it on mini chalkboards.',
        'Say "hot" aloud — learners write the three letters they hear.',
      ],
      glossary: [
        { term: 'Blend', definition: 'Push individual letter sounds together to make a word.' },
        { term: 'Segment', definition: 'Break a spoken word into its separate sounds.' },
        { term: 'Vowel', definition: 'A letter that makes an open sound (a, e, i, o, u).' },
        { term: 'Consonant', definition: 'Any letter that is not a vowel.' },
      ],
      references: [
        'Zambia CDC Grade 1 English Literacy Syllabus (2023 CBC)',
        "Grade 1 Literacy Learner's Book, Term 1, Unit 3",
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
        taskDescription: 'Grade 12 English Language Paper 2 — Directed Writing: formal letter to a newspaper editor (25 marks)',
        grade: 'Grade 12',
        subject: 'English Language',
        taskType: 'Directed writing — formal letter',
        totalMarks: 25,
        assessmentType: 'School Examination',
        gradeBands: [
          { symbol: 'A', name: 'Distinction', range: '21–25' },
          { symbol: 'B', name: 'Merit', range: '16–20' },
          { symbol: 'C', name: 'Credit', range: '11–15' },
          { symbol: 'D', name: 'Pass', range: '6–10' },
          { symbol: 'U', name: 'Fail', range: '0–5' },
        ],
      },
      markingNotes: 'Mark the quality of communication, not whether you agree with the argument. A strongly-argued view on either side earns full marks for content if the register is appropriate and evidence is used.',
      criteria: [
        {
          name: 'Content & argument',
          maxMarks: 10,
          keyCompetencies: ['Critical thinking', 'Communication'],
          levels: [
            { levelName: 'Distinction', marks: 10, descriptor: 'Argument is clear, convincing and fully developed with at least three distinct points. Counterargument addressed and rebutted. Evidence and examples are specific.' },
            { levelName: 'Merit', marks: 8, descriptor: 'Argument is clear with two or more developed points. Some use of evidence. Counterargument acknowledged.' },
            { levelName: 'Credit', marks: 6, descriptor: 'Relevant content with a recognisable argument. Points made but not always developed.' },
            { levelName: 'Pass', marks: 3, descriptor: 'Some relevant ideas but argument is thin or repetitive. Limited evidence.' },
            { levelName: 'Fail', marks: 1, descriptor: 'Little relevant content. No discernible argument.' },
          ],
        },
        {
          name: 'Register, tone & format',
          maxMarks: 8,
          keyCompetencies: ['Communication', 'Social values'],
          levels: [
            { levelName: 'Distinction', marks: 8, descriptor: 'Formal register sustained throughout. Correct letter format (address, date, salutation, complimentary close). Tone persuasive but respectful.' },
            { levelName: 'Merit', marks: 6, descriptor: 'Mainly formal with minor lapses. Letter format mostly correct. Tone generally appropriate.' },
            { levelName: 'Credit', marks: 4, descriptor: 'Register inconsistent (formal and informal mixed). Format partly followed.' },
            { levelName: 'Pass', marks: 2, descriptor: 'Register often informal. Letter format largely absent.' },
            { levelName: 'Fail', marks: 1, descriptor: 'No awareness of formal register or letter format.' },
          ],
        },
        {
          name: 'Language accuracy & range',
          maxMarks: 7,
          keyCompetencies: ['Literacy'],
          levels: [
            { levelName: 'Distinction', marks: 7, descriptor: 'Varied sentence structures used confidently. Vocabulary precise and appropriate. Rare errors that do not impede meaning.' },
            { levelName: 'Merit', marks: 5, descriptor: 'Mostly accurate grammar and punctuation. Some variety in sentence structure and vocabulary.' },
            { levelName: 'Credit', marks: 3, descriptor: 'Errors present but meaning generally clear. Limited sentence variety.' },
            { levelName: 'Pass', marks: 2, descriptor: 'Frequent errors that sometimes obscure meaning.' },
            { levelName: 'Fail', marks: 1, descriptor: 'Very frequent errors; meaning often unclear.' },
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
        grade: 'Grade 7',
        subject: 'Mathematics',
        topic: 'Ratio and Proportion',
        subtopic: 'Dividing quantities in a given ratio',
      },
      instructions: 'Show all working clearly. Questions 4 and 5 carry method marks — a correct answer with no working earns only 1 mark.',
      questions: [
        {
          number: 1,
          prompt: 'Write the ratio 24 : 36 in its simplest form.',
          answer: '2 : 3',
          workingNotes: 'Divide both parts by the HCF (12).',
        },
        {
          number: 2,
          prompt: 'Divide K180 between Chanda and Mwamba in the ratio 2 : 3.',
          answer: 'Chanda gets K72, Mwamba gets K108.',
          workingNotes: 'Total parts = 5. One part = K36. 2 × 36 = 72; 3 × 36 = 108.',
        },
        {
          number: 3,
          prompt: 'A recipe uses flour and sugar in the ratio 5 : 2. If you use 350 g of flour, how much sugar do you need?',
          answer: '140 g',
          workingNotes: 'One part = 350 ÷ 5 = 70 g. Sugar = 2 × 70 = 140 g.',
        },
        {
          number: 4,
          prompt: 'A school has boys and girls in the ratio 3 : 4. There are 84 girls. How many pupils are in the school altogether?',
          answer: '147 pupils',
          workingNotes: 'One part = 84 ÷ 4 = 21. Total = 7 × 21 = 147. Method marks: 1 for finding one part, 1 for the total.',
        },
        {
          number: 5,
          prompt: 'Farmer Banda mixes compost and soil in the ratio 1 : 4 to fill a bag. The bag holds 25 kg. How many kilograms of compost does he use? How many kilograms of soil?',
          answer: '5 kg of compost and 20 kg of soil.',
          workingNotes: 'Total parts = 5. One part = 25 ÷ 5 = 5 kg. Compost = 1 × 5 = 5 kg; soil = 4 × 5 = 20 kg.',
        },
      ],
      parentNote: 'Ask your child to explain question 2 to you using real coins or notes. If they can teach it, they understand it.',
      answerKey: {
        markingNotes: 'Total 12 marks. Q1–Q3: 2 marks each (1 method, 1 answer). Q4–Q5: 3 marks each (2 method, 1 final answer). Accept equivalent working.',
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
