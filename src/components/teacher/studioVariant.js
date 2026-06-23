// Shared configuration for the two flavours of the block-based paper studio.
// Both run on the SAME components — AssessmentStudio (the builder),
// AssessmentList (the library) and CreatePaperModal (the "Create with AI"
// modal) — so this module is the single source of truth for the route base,
// wording and paper-type list each flavour uses:
//
//   • 'test' → Test Paper Studio  (/teacher/test-papers)
//       topic / weekly / mid-term / end-of-term tests.
//   • 'exam' → Exam Studio        (/teacher/exam-papers)
//       mock / examination / exam — locked to exam standard. Every exam type
//       generates a cumulative, ECZ-style, exam-level paper (the server maps
//       all three to its `mock_exam` format profile).
//
// Pure data + helpers only (no React, no Firebase) so it stays cheap to import
// and easy to unit-test.

import { PAPER_TYPES, EXAM_PAPER_TYPES, isExamPaperType } from './paperTaxonomy.js'

export { isExamPaperType }

const STUDIO_VARIANTS = {
  test: {
    key: 'test',
    routeBase: '/teacher/test-papers',
    studioName: 'Test Paper Studio',
    // Singular/plural nouns used throughout the copy. `Noun` is the
    // sentence-case form (start of a sentence / heading).
    noun: 'test paper',
    nounPlural: 'test papers',
    Noun: 'Test paper',
    NounPlural: 'Test papers',
    eyebrow: '📄 Teacher-only · Test Paper Studio',
    heroTitle: 'My test papers',
    // The assessmentType values offered in the studio's own meta picker.
    types: ['topic', 'weekly', 'mid_term', 'end_of_term'],
    defaultType: 'end_of_term',
    // The list offered by CreatePaperModal ({ value, label }).
    paperTypes: PAPER_TYPES,
    // Default assessmentType the AI modal opens on.
    aiDefaultType: 'end_of_term',
  },
  exam: {
    key: 'exam',
    routeBase: '/teacher/exam-papers',
    studioName: 'Exam Studio',
    noun: 'exam paper',
    nounPlural: 'exam papers',
    Noun: 'Exam paper',
    NounPlural: 'Exam papers',
    eyebrow: '🎓 Teacher-only · Exam Studio',
    heroTitle: 'My exam papers',
    types: ['mock', 'examination', 'exam'],
    defaultType: 'mock',
    paperTypes: EXAM_PAPER_TYPES,
    aiDefaultType: 'mock',
  },
}

export function getStudioVariant(variant) {
  return STUDIO_VARIANTS[variant === 'exam' ? 'exam' : 'test']
}
