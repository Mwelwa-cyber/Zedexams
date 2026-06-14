/**
 * Pure grade/subject taxonomy for the teacher tools.
 *
 * These lists are the single source of truth for the studio dropdowns *and*
 * for resolving human-readable labels (e.g. download filenames). They live in
 * their own side-effect-free module so plain `node` test scripts can import
 * the labels without pulling in firebase/config (which reads import.meta.env
 * and would throw outside the Vite bundle).
 *
 * teacherTools.js re-exports both so existing
 * `import { TEACHER_GRADES } from '../utils/teacherTools'` callers keep working.
 */

// Grades grouped by Zambia CBC phase. Values use the canonical G-prefix the
// backend's ALLOWED_GRADES accepts (ECE, G1–G12). Labels show the
// "Grade 8 / Form 1" dual naming so secondary teachers still recognise them.
//
// Items with `group` (no `value`) render as <optgroup> labels in FieldSelect.
export const TEACHER_GRADES = [
  { group: 'Pre-Primary (ECE)' },
  // ECE is split by age band to match the curriculum reference (the Syllabi
  // Studio carries separate "3-4 Years" and "4-5 Years" sheets). Picking a
  // band scopes the topic/sub-topic suggestions to that band's syllabus.
  // Legacy 'ECE' is still accepted by the backend for older data, but it's
  // no longer offered here — authors choose Nursery or Reception instead.
  { value: 'ECE_N', label: 'Nursery (3–4 yrs)' },
  { value: 'ECE_R', label: 'Reception (4–5 yrs)' },
  { group: 'Lower Primary (Grades 1–4)' },
  { value: 'G1', label: 'Grade 1' },
  { value: 'G2', label: 'Grade 2' },
  { value: 'G3', label: 'Grade 3' },
  { value: 'G4', label: 'Grade 4' },
  { group: 'Upper Primary (Grades 5–7)' },
  { value: 'G5', label: 'Grade 5' },
  { value: 'G6', label: 'Grade 6' },
  { value: 'G7', label: 'Grade 7' },
  { group: 'Junior Secondary (Grades 8–9)' },
  { value: 'G8', label: 'Grade 8 / Form 1' },
  { value: 'G9', label: 'Grade 9 / Form 2' },
  { group: 'Senior Secondary (Grades 10–12)' },
  { value: 'G10', label: 'Grade 10 / Form 3' },
  { value: 'G11', label: 'Grade 11 / Form 4' },
  { value: 'G12', label: 'Grade 12 / Form 5' },
]

// Subjects grouped by curriculum area across all CBC phases.
export const TEACHER_SUBJECTS = [
  { group: 'Languages' },
  { value: 'english',          label: 'English' },
  { value: 'literacy',         label: 'Literacy' },
  { value: 'cinyanja',         label: 'Cinyanja' },
  { value: 'zambian_language', label: 'Zambian Language (other)' },
  { group: 'STEM' },
  { value: 'mathematics',          label: 'Mathematics' },
  { value: 'numeracy',             label: 'Numeracy' },
  { value: 'integrated_science',   label: 'Integrated Science' },
  { value: 'environmental_science',label: 'Environmental Science' },
  { value: 'biology',              label: 'Biology' },
  { value: 'chemistry',            label: 'Chemistry' },
  { value: 'physics',              label: 'Physics' },
  { group: 'Humanities' },
  { value: 'social_studies',   label: 'Social Studies' },
  { value: 'history',          label: 'History' },
  { value: 'geography',        label: 'Geography' },
  { value: 'civic_education',  label: 'Civic Education' },
  { value: 'religious_education', label: 'Religious Education' },
  { group: 'Business' },
  { value: 'accounts',         label: 'Principles of Accounts' },
  { group: 'Technical & Creative' },
  { value: 'technology_studies',              label: 'Technology Studies' },
  { value: 'creative_and_technology_studies', label: 'Creative & Technology Studies' },
  { value: 'home_economics',   label: 'Home Economics' },
  { value: 'expressive_arts',  label: 'Expressive Arts' },
  { value: 'physical_education', label: 'Physical Education' },
]
