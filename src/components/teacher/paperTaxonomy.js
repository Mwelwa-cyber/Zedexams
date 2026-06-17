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

// Studio grade value ('4', 'ECE_N') → KB grade code ('G4', 'ECE_N'). The ECE
// family + already-prefixed G/F codes pass through unchanged; bare numbers
// get the G-prefix.
export function studioGradeToKbGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (!g) return ''
  return g.startsWith('G') || g.startsWith('F') || g.startsWith('ECE') ? g : `G${g}`
}

// ── Test types ───────────────────────────────────────────────────────────
// 'exercise' deliberately omitted here — short practice belongs in the
// Worksheet studio. 'monthly_test' is new (grounded on the mid-term paper
// format server-side until dedicated seeds exist). Order = increasing scope.
export const PAPER_TYPES = [
  { value: 'topic_test', label: 'Topic test' },
  { value: 'monthly_test', label: 'Monthly test' },
  { value: 'mid_term', label: 'Mid-term test' },
  { value: 'end_of_term', label: 'End of term test' },
  { value: 'mock_exam', label: 'Mock examination' },
]

// How many topics each test type may cover. A topic test is narrow; an
// end-of-term or mock paper is cumulative and should span everything the
// class has learned, so the caps are large and the modal offers an
// "Add all topics" shortcut for them.
const TOPIC_CAPS = {
  topic_test: 3,
  monthly_test: 4,
  mid_term: 6,
  end_of_term: 15,
  mock_exam: 30,
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
