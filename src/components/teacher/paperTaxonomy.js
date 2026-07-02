// Paper-generation taxonomy for "Create paper with AI" (CreatePaperModal).
//
// Pure helpers only — no React, no Firebase — so the bulk test suite can
// import this directly (scripts/test-paper-taxonomy.mjs) and so the studio
// AI modals share one source of truth for:
//   - the grades a paper can target (now incl. ECE Nursery/Reception),
//   - the test types (Exercise removed → lives in Worksheets; Monthly test
//     added),
//   - how many topics each test type may cover (cumulative tests cover many),
//   - canonical subject-key resolution + friendly labels.
//
// The actual subject + topic OPTION LISTS are derived from the live syllabus
// in syllabusTopicOptions.js; this file holds the static taxonomy + the
// label/key plumbing those hooks lean on.

import { normalizeSubject } from '../../config/curriculum.js'

// ── Grades ─────────────────────────────────────────────────────────────────
// The studio's own grade picker stays 1–12 (assessmentStudioMeta.js); the AI
// paper modal additionally offers the ECE pre-primary bands, which are fully
// populated in the 2023 syllabus (ECE_N = Nursery 3–4, ECE_R = Reception 4–5)
// but were previously unreachable because the modal only listed numbered
// grades. Values match functions/teacherTools/assessmentAllowlists.js.
export const PAPER_GRADE_OPTIONS = [
  { value: 'ECE_N', label: 'ECE — Nursery (3–4 yrs)' },
  { value: 'ECE_R', label: 'ECE — Reception (4–5 yrs)' },
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
    .map((g) => ({ value: g, label: `Grade ${g}` })),
]

const PAPER_GRADE_VALUES = new Set(PAPER_GRADE_OPTIONS.map((g) => g.value))

export function isPaperGrade(value) {
  return PAPER_GRADE_VALUES.has(String(value || ''))
}

// Grade 7 was removed from primary in the 2023 curriculum: the system
// restructured from 4-7-2-3 to 3-6-4-2, so primary now ends at Grade 6
// (lower primary G1–G3, upper primary G4–G6). Grade 7 remains valid under
// the 2013 framework, which is still being phased out grade by grade.
export function paperGradeOptions(framework = '2023') {
  if (String(framework) === '2023') {
    return PAPER_GRADE_OPTIONS.filter((g) => g.value !== '7')
  }
  return PAPER_GRADE_OPTIONS
}

// Studio grade value ('4', 'ECE_N') → KB grade code ('G4', 'ECE_N'). The ECE
// family + already-prefixed G/F codes pass through unchanged; bare numbers
// get the G-prefix.
export function studioGradeToKbGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (!g) return ''
  return g.startsWith('G') || g.startsWith('F') || g.startsWith('ECE') ? g : `G${g}`
}

// ── Curriculum framework by grade ────────────────────────────────────────
// Zambia is rolling out the 2023 CBC grade by grade. These grades have NOT
// transitioned yet and remain on the 2013 OBC syllabus, so their topics live
// only in curriculum-data-2013.json. Currently live on CBC: ECE, G1, G2, G4,
// G8 (Form 1), G9 (Form 2); everything listed here stays on OBC until its
// grade is transitioned.
export const GRADES_2013 = new Set(['G3', 'G5', 'G6', 'G7', 'G10', 'G11', 'G12'])

// Resolve which curriculum framework actually applies to a grade. Grades still
// on the old syllabus force '2013' regardless of the requested framework —
// there is no valid 2023 curriculum for them, so both topic suggestions and AI
// generation must ground on 2013. Every other grade honours the requested
// framework (default '2023'). Normalises bare numbers ('7') and G-codes ('G7')
// alike via studioGradeToKbGrade.
export function resolveFramework(grade, frameworkProp = '2023') {
  if (grade && GRADES_2013.has(studioGradeToKbGrade(grade))) return '2013'
  return frameworkProp || '2023'
}

// True when the grade is locked to a single framework (see GRADES_2013), so a
// UI can render a read-only indicator instead of an inert framework toggle.
export function isFrameworkLockedGrade(grade) {
  return !!grade && GRADES_2013.has(studioGradeToKbGrade(grade))
}

// ── Test types ───────────────────────────────────────────────────────────
// The Test Paper Studio offers exactly four test types: a narrow topic
// recap, a weekly check, the mid-term and the end-of-term paper. 'exercise'
// belongs in the Worksheet studio; 'weekly_test' is grounded on the topic-test
// paper format server-side (FORMAT_TYPE_ALIASES) until dedicated weekly seeds
// exist. Order = increasing scope.
export const PAPER_TYPES = [
  { value: 'topic_test', label: 'Topic Test' },
  { value: 'weekly_test', label: 'Weekly Test' },
  { value: 'mid_term', label: 'Mid-Term Test' },
  { value: 'end_of_term', label: 'End-of-Term Test' },
]

// ── Exam paper types ───────────────────────────────────────────────────────
// The Exam Studio is the Test Paper Studio locked to exam standard: it offers
// only the three exam-grade papers and every one of them generates at full
// mock-exam / final-examination standard (cumulative, ECZ-style, exam-level
// difficulty). They all map to the server's `mock_exam` format profile (see
// CreatePaperModal) — the only thing that differs between them is the title
// printed on the cover (Mock Examination / Examination / Exam).
export const EXAM_PAPER_TYPES = [
  { value: 'mock', label: 'Mock Exam' },
  { value: 'examination', label: 'Examination' },
  { value: 'exam', label: 'Exam' },
]

const EXAM_PAPER_TYPE_VALUES = new Set(EXAM_PAPER_TYPES.map((t) => t.value))

export function isExamPaperType(value) {
  return EXAM_PAPER_TYPE_VALUES.has(String(value || ''))
}

// How many topics each test type may cover. Topic and weekly tests are
// narrow; an end-of-term paper is cumulative and should span everything the
// class has learned, so its cap is large and the modal offers an
// "Add all topics" shortcut for it. The exam types are all cumulative — an
// exam covers the whole syllabus — so they carry the largest cap.
const TOPIC_CAPS = {
  topic_test: 3,
  weekly_test: 3,
  mid_term: 6,
  end_of_term: 15,
  mock: 15,
  examination: 15,
  exam: 15,
}
const DEFAULT_TOPIC_CAP = 3

export function maxTopicsFor(assessmentType) {
  return TOPIC_CAPS[assessmentType] || DEFAULT_TOPIC_CAP
}

// Cumulative papers (end of term / mock) are expected to draw on every topic
// covered, so the modal surfaces a one-click "Add all topics" affordance.
export function isCumulativeType(assessmentType) {
  return maxTopicsFor(assessmentType) >= 6
}

// ── Subjects ────────────────────────────────────────────────────────────
// Canonical CBC subject keys (as stored in the syllabus / accepted by the
// generator) mapped to teacher-facing labels. Lower-primary + ECE bundle
// strands under keys that don't look like the upper-grade subjects, so the
// labels spell out what each one contains.
const SUBJECT_LABELS = {
  english: 'English',
  mathematics: 'Mathematics',
  integrated_science: 'Integrated Science',
  social_studies: 'Social Studies',
  expressive_arts: 'Expressive Arts',
  technology_studies: 'Technology Studies',
  home_economics: 'Home Economics',
  zambian_language: 'Zambian Language (Cinyanja etc.)',
  numeracy: 'Numeracy (Maths & Science)',
  literacy: 'Literacy',
  creative_and_technology_studies: 'Creative & Technology Studies',
  religious_education: 'Religious Education',
  civic_education: 'Civic Education',
  physical_education: 'Physical Education',
  environmental_science: 'Environmental Science',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  geography: 'Geography',
  history: 'History',
  accounts: 'Accounts',
  cinyanja: 'Cinyanja',
}

export function subjectLabel(key) {
  const k = String(key || '').trim()
  if (!k) return ''
  return SUBJECT_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Fallback subject list when the syllabus can't be loaded for a grade — keeps
// the dropdown usable rather than empty.
export const FALLBACK_SUBJECT_KEYS = [
  'english', 'mathematics', 'integrated_science', 'social_studies',
  'expressive_arts', 'technology_studies', 'home_economics', 'zambian_language',
]

// Display label / slug / canonical key → canonical CBC subject key. Idempotent
// for values that are already canonical keys, so the dynamic subject dropdown
// (which yields keys) and a display label coming from paperMeta both resolve.
const SUBJECT_FIXES = {
  expressive_art: 'expressive_arts',
  science: 'integrated_science',
  cinyanja: 'zambian_language',
}

export function toKbSubjectKey(subject) {
  const s = String(subject || '').trim()
  if (!s) return ''
  // Already a canonical-looking key (lowercase + underscores, no spaces).
  if (/^[a-z][a-z_]*$/.test(s)) {
    const k = s.replace(/^_+|_+$/g, '')
    return SUBJECT_FIXES[k] || k
  }
  const norm = normalizeSubject(s)
  const key = String(norm || s)
    .toLowerCase().trim().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '')
  return SUBJECT_FIXES[key] || key
}
