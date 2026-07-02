// Shared Zambian reference lists for forms (Register, Teacher Settings,
// School profile). Pure data — safe to import from plain-node tests.
//
// ZAMBIAN_PROVINCES was extracted from Register.jsx so the signup form and
// the Teacher Settings → School panel share one source of truth.

export const ZAMBIAN_PROVINCES = [
  'Central',
  'Copperbelt',
  'Eastern',
  'Luapula',
  'Lusaka',
  'Muchinga',
  'Northern',
  'North-Western',
  'Southern',
  'Western',
]

// School classifications used by the School settings panel. Values are the
// stored slugs; labels are the display strings.
export const SCHOOL_TYPES = [
  { value: 'government_primary', label: 'Government Primary' },
  { value: 'government_secondary', label: 'Government Secondary' },
  { value: 'combined', label: 'Combined School' },
  { value: 'private', label: 'Private School' },
  { value: 'community', label: 'Community School' },
  { value: 'grant_aided', label: 'Grant-Aided School' },
]

// Teacher qualification levels (Teacher Settings → Profile).
export const TEACHER_QUALIFICATIONS = [
  { value: 'certificate', label: 'Teaching Certificate' },
  { value: 'diploma', label: 'Teaching Diploma' },
  { value: 'degree', label: "Bachelor's Degree" },
  { value: 'masters', label: "Master's Degree" },
  { value: 'phd', label: 'Doctorate (PhD)' },
  { value: 'other', label: 'Other' },
]

// Languages of instruction. Values mirror the server allowlist in
// functions/teacherTools/generateLessonPlan.js (ALLOWED_LANGUAGES) so a saved
// preference passes sanitizeInputs unchanged; labels match the studio's
// Medium-of-Instruction options (FormatOptionsForm MEDIUM_OPTIONS).
export const TEACHING_LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'bemba', label: 'Bemba' },
  { value: 'nyanja', label: 'Nyanja' },
  { value: 'tonga', label: 'Tonga' },
  { value: 'lozi', label: 'Lozi' },
  { value: 'kaonde', label: 'Kaonde' },
  { value: 'lunda', label: 'Lunda' },
  { value: 'luvale', label: 'Luvale' },
]

export const TEACHING_LANGUAGE_VALUES = TEACHING_LANGUAGES.map((l) => l.value)

// value → display label ('english' → 'English'). Used to map a saved
// teachingLanguage preference onto the studios' medium selects, which store
// the capitalised label.
export function teachingLanguageLabel(value) {
  const hit = TEACHING_LANGUAGES.find((l) => l.value === value)
  return hit ? hit.label : 'English'
}
