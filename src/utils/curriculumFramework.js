/**
 * Central curriculum timetable configuration — the single authoritative
 * source of weekly subject allocations for Zambian school timetables.
 *
 * Consumed by the Class Timetable Studio (subjects, weekly periods, block
 * preferences, option groups), the Primary Curriculum reference pages (the
 * printed allocation tables), the Scheme of Work studio (per-subject weekly
 * period labels via frameworkSubjectMatch.js) and the timetable importer
 * (canonical subject names + aliases). Do NOT hard-code allocations in
 * components — read them from here.
 *
 * Curricula:
 *   - cbc-2023   2023 Competence-Based Curriculum (Curriculum Development
 *                Centre). Bands: ECE (30-min · 30/wk), Lower Primary G1–3
 *                (30-min · 42/wk), Upper Primary G4–6 (40-min · 42/wk).
 *                Grade 7 and secondary have NO prescribed allocation here —
 *                G7 must not silently inherit the Grades 4–6 table, so
 *                getFrameworkForGrade('G7') returns null and the studio
 *                falls back to a manual subject list.
 *   - adapted-2023  The adapted baseline for learners with intellectual
 *                disabilities (14 h 40 min · 22 periods · 40-min periods).
 *                Level-based, not grade-based; offered for any grade.
 *   - obc-2013   2013 Outcome-Based Curriculum. The PRIMARY allocations
 *                (Grades 1–7) ARE catalogued, straight from the 2013
 *                Curriculum Framework's contact-time tables: Lower Primary
 *                (Grades 1–4 · 30-min periods · 21 h · 42/wk) and Upper Primary
 *                (Grades 5–7 · 40-min periods · 28 h · 42/wk, its Table 5).
 *                Secondary (Grades 8–12) has no catalogued table, so the studio
 *                falls back to the manual subject list there. The curriculum's
 *                `hasAllocations` flag stays false on purpose: the Class
 *                Timetable Studio keys its allocation-driven mode off that flag,
 *                and OBC's uncatalogued secondary years must keep the manual
 *                fallback — the Scheme of Work reads the resolver directly, so
 *                it still benefits from the primary tables.
 *   - custom     A school's own structure; fully manual.
 *
 * Option groups model the framework's one-of choices (a class takes
 * Expressive Arts OR Home Economics, never both; ECE takes one language
 * provision). The unselected option contributes 0 periods and must not be
 * auto-filled.
 *
 * Kept DOM-free and side-effect-free so `node` can unit test it.
 */

export const FRAMEWORK_SOURCE =
  '2023 Approved National School Curriculum Framework · Curriculum Development Centre, Zambia'

/* ── Curricula ──────────────────────────────────────────────────── */

export const CURRICULA = [
  {
    id: 'cbc-2023',
    name: '2023 Competence-Based Curriculum',
    shortName: 'CBC 2023',
    hasAllocations: true,
  },
  {
    id: 'obc-2013',
    name: '2013 Outcome-Based Curriculum',
    shortName: 'OBC 2013',
    // Primary (Grades 1–7) IS catalogued (see the OBC bands below), but this
    // flag stays false: the Class Timetable Studio uses it to decide whether to
    // enforce a complete official allocation, and OBC's uncatalogued secondary
    // grades must keep the manual subject-list fallback. The Scheme of Work
    // reads the resolver directly, so it gets the primary tables regardless.
    hasAllocations: false,
  },
  {
    id: 'adapted-2023',
    name: 'Adapted curriculum (learners with intellectual disabilities)',
    shortName: 'Adapted',
    hasAllocations: true,
  },
  {
    id: 'custom',
    name: 'Custom school curriculum',
    shortName: 'Custom',
    hasAllocations: false,
  },
]

export const DEFAULT_CURRICULUM_ID = 'cbc-2023'

export function getCurriculum(curriculumId) {
  return CURRICULA.find((c) => c.id === curriculumId) || null
}

/* ── Cognitive load ───────────────────────────────────────────────
 * Drives the balanced auto-fill: "heavy" subjects are the cognitively
 * demanding ones that read best in the morning and should not pile up in a
 * single day; "light" subjects (practical / creative) sit comfortably later.
 */
export const LOAD_WEIGHT = { heavy: 3, medium: 2, light: 1 }

/** Classify a subject's cognitive load from its name. Tolerant of the many
 * label variants teachers type ("Maths", "Integrated Science", "Literacy"). */
export function subjectLoad(label = '') {
  const s = String(label).toLowerCase()
  if (/math|science|\benglish\b|literacy/.test(s)) return 'heavy'
  if (/social|zambian|\blanguage\b|history|geograph|civic|religious/.test(s)) return 'medium'
  return 'light'
}

/** Numeric load weight (heavy 3 → light 1) for a subject label. */
export function subjectLoadWeight(label = '') {
  return LOAD_WEIGHT[subjectLoad(label)] || LOAD_WEIGHT.medium
}

/* ── Grade → band ─────────────────────────────────────────────────
 * Accepts the internal 'G4' shorthand, the ECE band values ('ECE_N',
 * 'ECE_R', legacy 'ECE') and the academic 'Grade 4' form. */
export function bandForGrade(grade) {
  const raw = String(grade ?? '').trim()
  if (/^ECE(_[NR])?$/i.test(raw) || /early childhood|nursery|reception/i.test(raw)) return 'ece'
  const m = raw.match(/(\d{1,2})/)
  if (!m) return null
  const n = Number(m[1])
  if (n >= 1 && n <= 3) return 'lower_primary'
  // Upper Primary is Grades 4–6 in the 2023 framework. Grade 7 has no
  // prescribed allocation and must NOT inherit the 4–6 table.
  if (n >= 4 && n <= 6) return 'upper_primary'
  return null
}

const BAND_META = {
  ece: {
    label: 'Early Childhood Education',
    stageId: 'pre-primary',
    periodMinutes: 30,
    totalPeriods: 30,
    weeklyContactMinutes: 900, // 15 hours
    contactLabel: '15 hours',
  },
  lower_primary: {
    label: 'Lower Primary (Grades 1–3)',
    stageId: 'lower-primary',
    periodMinutes: 30,
    totalPeriods: 42,
    weeklyContactMinutes: 1260, // 21 hours
    contactLabel: '21 hours',
  },
  upper_primary: {
    label: 'Upper Primary (Grades 4–6)',
    stageId: 'upper-primary',
    periodMinutes: 40,
    totalPeriods: 42,
    weeklyContactMinutes: 1680, // 28 hours
    contactLabel: '28 hours',
  },
  adapted: {
    label: 'Adapted (intellectual disabilities)',
    stageId: 'adapted',
    periodMinutes: 40,
    totalPeriods: 22,
    weeklyContactMinutes: 880, // 14 h 40 min
    contactLabel: '14 h 40 min',
  },
  // ── 2013 OBC primary bands (from the 2013 Curriculum Framework) ──
  obc_lower_primary: {
    label: 'Lower Primary (Grades 1–4)',
    stageId: 'obc-lower-primary',
    periodMinutes: 30,
    totalPeriods: 42,
    weeklyContactMinutes: 1260, // 21 hours
    contactLabel: '21 hours',
  },
  obc_upper_primary: {
    label: 'Upper Primary (Grades 5–7)',
    stageId: 'obc-upper-primary',
    periodMinutes: 40,
    totalPeriods: 42,
    weeklyContactMinutes: 1680, // 28 hours
    contactLabel: '28 hours',
  },
}

/**
 * Which per-curriculum grade STRUCTURE a timetable curriculum id uses — the
 * bridge to the shared CURRICULUM_GRADE_STRUCTURES in config/teacherTaxonomy.js
 * (the same source Teaching Assignments / the Teaching Profile use). Only the
 * 2013 OBC uses the previous-era grade layout (Grades 1–7 primary, 8–12
 * secondary); the 2023 CBC, its adapted baseline and a custom school day all
 * use the CBC-era layout (ECE, LP 1–3, UP 4–6, Secondary Forms 1–4).
 */
export function gradeStructureModeFor(curriculumId) {
  return curriculumId === 'obc-2013' ? 'previous' : 'cbc'
}

/* ── Block preferences ────────────────────────────────────────────
 * Scheduling preferences (not statutory rules): `preferredBlocks` is the
 * shape auto-fill aims for (a 2 is a double period), `allowSingles` lets it
 * fall back, `maxBlockLength` caps joining. Teachers can override any of it.
 */
const SINGLES = (n) => ({ preferredBlocks: Array(n).fill(1), allowSingles: true, maxBlockLength: 2 })
const BLOCKS = (arr) => ({ preferredBlocks: arr, allowSingles: true, maxBlockLength: 2 })

/* ── Official subject allocations ─────────────────────────────────
 * Every subject carries: a stable id, the official canonical name, a short
 * display name for tight grids, safe aliases (import mapping), the official
 * weekly periods + minutes, whether it is compulsory, its option group (the
 * one-of choices), a broad subjectType, and a block preference.
 */

const ECE_SUBJECTS = [
  {
    id: 'ece-english', canonicalName: 'English Language', shortName: 'English',
    canonicalSubjectId: 'english',
    aliases: ['english', 'eng', 'english language'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: 'ece-language', subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'ece-sign-language', canonicalName: 'Sign Language Literacy', shortName: 'Sign Language',
    canonicalSubjectId: null,
    aliases: ['sign language', 'sign'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: 'ece-language', subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'ece-braille', canonicalName: 'Braille', shortName: 'Braille',
    canonicalSubjectId: null,
    aliases: ['braille literacy'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: 'ece-language', subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'ece-zambian-language', canonicalName: 'Zambian Language', shortName: 'Zambian Lang',
    canonicalSubjectId: 'zambian_language',
    aliases: ['zambian', 'zambian lang', 'local language'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    // The ECE syllabus names this area "Pre-Mathematics and Science". The older
    // "…and Pre-Science" spelling stays an alias so a saved timetable or an
    // imported allocation written against it still resolves to this subject.
    id: 'pre-mathematics-science', canonicalName: 'Pre-Mathematics and Science', shortName: 'Pre-Maths & Sci',
    canonicalSubjectId: 'numeracy',
    aliases: [
      'pre maths', 'pre mathematics', 'pre science', 'pre-maths and pre-science',
      'pre-mathematics and pre-science', 'pre-maths & science', 'pre-maths and science',
    ],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
  {
    id: 'ece-creative-technology', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    canonicalSubjectId: 'creative_and_technology_studies',
    aliases: ['cts', 'creative & technology studies', 'creative and technology'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
]

const LOWER_PRIMARY_SUBJECTS = [
  {
    id: 'literacy-language-english', canonicalName: 'Literacy and Language — English Language', shortName: 'English',
    canonicalSubjectId: 'english',
    aliases: ['english', 'eng', 'english language', 'literacy & language — english', 'literacy english', 'literacy-english'],
    weeklyPeriods: 11, weeklyMinutes: 330, timeAllocation: '5 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: BLOCKS([2, 2, 1, 1, 1, 1, 1, 1, 1]),
  },
  {
    id: 'literacy-language-zambian', canonicalName: 'Literacy and Language — Zambian Language', shortName: 'Zambian Lang',
    canonicalSubjectId: 'zambian_language',
    aliases: ['zambian', 'zambian language', 'zambian lang', 'literacy & language — zambian', 'literacy zambian', 'literacy-zambian', 'local language'],
    weeklyPeriods: 11, weeklyMinutes: 330, timeAllocation: '5 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: BLOCKS([2, 2, 1, 1, 1, 1, 1, 1, 1]),
  },
  {
    // Canonical id `mathematics-and-science`. The many display-name variants
    // teachers/import files use collapse onto THIS one subject via the aliases —
    // they must never spawn a second subject or cause the official area to be
    // dropped from the Grade 1–3 allocation.
    id: 'mathematics-and-science', canonicalName: 'Mathematics and Science', shortName: 'Maths & Science',
    canonicalSubjectId: 'numeracy',
    aliases: [
      'mathematics and science', 'maths and science', 'mathematics & science', 'maths & science',
      'maths', 'mathematics', 'science', 'mathematics-science',
      'mathematics and pre-science', 'pre-mathematics and pre-science', 'pre maths and science',
    ],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
  {
    id: 'creative-and-technology-studies', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    canonicalSubjectId: 'creative_and_technology_studies',
    aliases: ['cts', 'creative and technology studies', 'creative & technology studies', 'creative and technology', 'creative studies', 'creative-technology'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
]

const UPPER_PRIMARY_SUBJECTS = [
  {
    id: 'english-language', canonicalName: 'English Language', shortName: 'English',
    canonicalSubjectId: 'english',
    aliases: ['english', 'eng'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(6),
  },
  {
    id: 'mathematics', canonicalName: 'Mathematics', shortName: 'Maths',
    canonicalSubjectId: 'mathematics',
    aliases: ['maths', 'math'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(6),
  },
  {
    // Official canonical name is "Science" in the 2023 framework — Agricultural
    // Science content is integrated inside it, not a separate compulsory subject.
    id: 'science', canonicalName: 'Science', shortName: 'Science',
    canonicalSubjectId: 'integrated_science',
    aliases: ['integrated science', 'sci', 'science (incl. agricultural science)', 'agricultural science'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: BLOCKS([2, 1, 1, 1, 1]), // one double for experiments / practical work
  },
  {
    id: 'zambian-language', canonicalName: 'Zambian Language', shortName: 'Zambian Lang',
    canonicalSubjectId: 'zambian_language',
    aliases: ['zambian', 'zambian lang', 'local language', 'bemba', 'nyanja', 'tonga', 'lozi', 'kaonde', 'lunda', 'luvale'],
    weeklyPeriods: 5, weeklyMinutes: 200, timeAllocation: '3 h 20 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    // Mining content is included within Social Studies — never an extra subject.
    id: 'social-studies', canonicalName: 'Social Studies', shortName: 'Soc Studies',
    canonicalSubjectId: 'social_studies',
    aliases: ['ss', 'social', 'social studies (incl. mining content)'],
    weeklyPeriods: 5, weeklyMinutes: 200, timeAllocation: '3 h 20 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(5),
  },
  {
    id: 'technology-studies', canonicalName: 'Technology Studies', shortName: 'Tech Studies',
    canonicalSubjectId: 'technology_studies',
    aliases: ['tech studies', 'tech', 'ict', 'computers', 'computer studies'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'practical',
    blockPreference: BLOCKS([2, 2, 1, 1, 1]), // practical — prefer double periods
  },
  {
    id: 'expressive-arts', canonicalName: 'Expressive Arts', shortName: 'Expr Arts',
    canonicalSubjectId: 'expressive_arts',
    aliases: ['ea', 'art', 'arts', 'pe', 'physical education', 'music'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: 'practical', subjectType: 'practical',
    blockPreference: BLOCKS([2, 2, 1, 1, 1]),
  },
  {
    id: 'home-economics', canonicalName: 'Home Economics', shortName: 'Home Econ',
    canonicalSubjectId: 'home_economics',
    aliases: ['home ec', 'homeec', 'h/econ', 'home management'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: 'practical', subjectType: 'practical',
    blockPreference: BLOCKS([2, 2, 1, 1, 1]),
  },
]

const ADAPTED_SUBJECTS = [
  {
    id: 'adapted-maths-science', canonicalName: 'Mathematics and Science', shortName: 'Maths & Science',
    canonicalSubjectId: 'numeracy',
    aliases: ['maths and science', 'maths', 'mathematics', 'science'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: SINGLES(4),
  },
  {
    id: 'adapted-english', canonicalName: 'English Language', shortName: 'English',
    canonicalSubjectId: 'english',
    aliases: ['english', 'eng'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: 'adapted-language', subjectType: 'language',
    blockPreference: SINGLES(4),
  },
  {
    id: 'adapted-sign-language', canonicalName: 'Sign Language', shortName: 'Sign Language',
    canonicalSubjectId: null,
    aliases: ['sign', 'sign language literacy'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: 'adapted-language', subjectType: 'language',
    blockPreference: SINGLES(4),
  },
  {
    id: 'adapted-creative-technology', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    canonicalSubjectId: 'creative_and_technology_studies',
    aliases: ['cts', 'creative and technology'],
    weeklyPeriods: 10, weeklyMinutes: 400, timeAllocation: '6 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 2, 2]), // longer continuous learning blocks
  },
  {
    id: 'activities-daily-living', canonicalName: 'Activities for Daily Living', shortName: 'Daily Living',
    canonicalSubjectId: null,
    aliases: ['adl', 'daily living'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'living-skills',
    blockPreference: SINGLES(4),
  },
]

/* ── 2013 OBC primary allocations ─────────────────────────────────
 * Transcribed verbatim from the 2013 Curriculum Framework (Curriculum
 * Development Centre, Zambia) contact-time tables. Every subject is
 * compulsory and there are NO option groups at primary — the eight (Upper)
 * / five (Lower) learning areas sum exactly to the official 42 periods.
 *
 * Lower Primary (Grades 1–4): 30-min periods · 21 h · 42/wk.
 */
const OBC_LOWER_PRIMARY_SUBJECTS = [
  {
    id: 'obc-lp-literacy-languages', canonicalName: 'Literacy and Languages', shortName: 'Literacy & Lang',
    canonicalSubjectId: 'literacy',
    aliases: ['literacy', 'literacy and languages', 'literacy & languages', 'languages', 'english', 'zambian language', 'zambian languages', 'local language'],
    weeklyPeriods: 13, weeklyMinutes: 390, timeAllocation: '6 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(13),
  },
  {
    id: 'obc-lp-mathematics', canonicalName: 'Mathematics', shortName: 'Maths',
    canonicalSubjectId: 'mathematics',
    aliases: ['maths', 'math', 'numeracy'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(10),
  },
  {
    id: 'obc-lp-social-studies', canonicalName: 'Social Studies', shortName: 'Soc Studies',
    canonicalSubjectId: 'social_studies',
    aliases: ['ss', 'social', 'social studies'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(5),
  },
  {
    id: 'obc-lp-integrated-science', canonicalName: 'Integrated Science', shortName: 'Int Science',
    canonicalSubjectId: 'integrated_science',
    aliases: ['integrated science', 'science', 'sci', 'environmental science'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(5),
  },
  {
    id: 'obc-lp-creative-technology', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    canonicalSubjectId: 'creative_and_technology_studies',
    aliases: ['cts', 'creative and technology studies', 'creative & technology studies', 'creative and technology'],
    weeklyPeriods: 9, weeklyMinutes: 270, timeAllocation: '4 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1]),
  },
]

/* Upper Primary (Grades 5–7): 40-min periods · 28 h · 42/wk — the framework's
 * Table 5 (Grades 5 to 7 Time Allocations per Week). */
const OBC_UPPER_PRIMARY_SUBJECTS = [
  {
    id: 'obc-up-english', canonicalName: 'English Language', shortName: 'English',
    canonicalSubjectId: 'english',
    aliases: ['english', 'eng'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(6),
  },
  {
    id: 'obc-up-mathematics', canonicalName: 'Mathematics', shortName: 'Maths',
    canonicalSubjectId: 'mathematics',
    aliases: ['maths', 'math', 'numeracy'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(7),
  },
  {
    id: 'obc-up-integrated-science', canonicalName: 'Integrated Science', shortName: 'Int Science',
    canonicalSubjectId: 'integrated_science',
    aliases: ['integrated science', 'science', 'sci', 'environmental science'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: BLOCKS([2, 1, 1, 1, 1]), // one double for practical work
  },
  {
    id: 'obc-up-zambian-languages', canonicalName: 'Zambian Languages', shortName: 'Zambian Lang',
    canonicalSubjectId: 'zambian_language',
    aliases: ['zambian', 'zambian language', 'zambian languages', 'zambian lang', 'local language', 'bemba', 'nyanja', 'tonga', 'lozi', 'kaonde', 'lunda', 'luvale'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(6),
  },
  {
    id: 'obc-up-expressive-arts', canonicalName: 'Expressive Arts', shortName: 'Expr Arts',
    canonicalSubjectId: 'expressive_arts',
    aliases: ['ea', 'art', 'arts', 'pe', 'physical education', 'music'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'practical',
    blockPreference: BLOCKS([2, 1, 1]),
  },
  {
    id: 'obc-up-social-studies', canonicalName: 'Social Studies', shortName: 'Soc Studies',
    canonicalSubjectId: 'social_studies',
    aliases: ['ss', 'social', 'social studies'],
    weeklyPeriods: 5, weeklyMinutes: 200, timeAllocation: '3 h 20 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(5),
  },
  {
    id: 'obc-up-technology-studies', canonicalName: 'Technology Studies', shortName: 'Tech Studies',
    canonicalSubjectId: 'technology_studies',
    aliases: ['tech studies', 'tech', 'ict', 'computers', 'computer studies'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'practical',
    blockPreference: BLOCKS([2, 2]),
  },
  {
    id: 'obc-up-home-economics', canonicalName: 'Home Economics', shortName: 'Home Econ',
    canonicalSubjectId: 'home_economics',
    aliases: ['home ec', 'homeec', 'h/econ', 'home management'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'practical',
    blockPreference: BLOCKS([2, 2]),
  },
]

/* ── Option groups (one-of choices) ───────────────────────────── */

const OPTION_GROUPS = {
  practical: {
    id: 'practical',
    label: 'Which practical subject does this class take?',
    hint: 'Upper Primary classes take Expressive Arts OR Home Economics — one, not both.',
    defaultOptionId: 'expressive-arts',
  },
  'ece-language': {
    id: 'ece-language',
    label: 'Which language provision does this class use?',
    hint: 'English Language, Sign Language Literacy and Braille are alternative provisions — pick the one that applies.',
    defaultOptionId: 'ece-english',
  },
  'adapted-language': {
    id: 'adapted-language',
    label: 'Which language provision does this class use?',
    hint: 'English Language or Sign Language — pick the one that applies.',
    defaultOptionId: 'adapted-english',
  },
}

const BAND_SUBJECTS = {
  ece: ECE_SUBJECTS,
  lower_primary: LOWER_PRIMARY_SUBJECTS,
  upper_primary: UPPER_PRIMARY_SUBJECTS,
  adapted: ADAPTED_SUBJECTS,
  obc_lower_primary: OBC_LOWER_PRIMARY_SUBJECTS,
  obc_upper_primary: OBC_UPPER_PRIMARY_SUBJECTS,
}

/* ── OBC grade → band ─────────────────────────────────────────────
 * The 2013 OBC splits primary differently from the 2023 CBC: Lower Primary is
 * Grades 1–4 and Upper Primary is Grades 5–7 (the framework's own headings).
 * Grade 7 is therefore a PRIMARY grade under OBC and gets Table 5's allocation
 * — the opposite of CBC, where Grade 7 has no prescribed allocation. Only the
 * two PRIMARY bands are real resolveTimetableCurriculum bands. Senior Secondary
 * (Grades 10–12) is catalogued too, but as a flat per-subject lookup (see
 * obcSeniorSecondaryAllocation) rather than a band, because it is pathway-based
 * and has no single fixed weekly list. Junior Secondary (Grades 8–9) has no
 * catalogued table → null (manual fallback).
 */
function obcBandForGrade(grade) {
  const raw = String(grade ?? '').trim()
  const m = raw.match(/(\d{1,2})/)
  if (!m) return null
  const n = Number(m[1])
  if (n >= 1 && n <= 4) return 'obc_lower_primary'
  if (n >= 5 && n <= 7) return 'obc_upper_primary'
  return null
}

/* ── 2013 OBC Senior Secondary (Grades 10–12) subject allocations ──
 * Senior Secondary is organised by career PATHWAY (Social Sciences, Business,
 * Natural Sciences, Agriculture, Technology, Art & Design, Physical Education,
 * Home Economics) — a learner takes ONE compulsory+optional combination
 * totalling 44–45 periods, so there is no single fixed weekly list to model as
 * a band. What the Scheme of Work needs is only the per-SUBJECT weekly
 * allocation, and across the framework's Tables 8–16 (all 40-min periods) each
 * subject carries a stable count. Values transcribed verbatim from those
 * tables; the map is limited to the subjects that actually have a 2013
 * secondary syllabus (so it never asserts a number for a subject a teacher
 * cannot pick in the studio). Each pathway's "major" runs as a 12-period (8 h)
 * double.
 *
 * Biology is the one genuinely pathway-dependent subject: 5 periods as a
 * science-pathway subject (Natural Sciences / Technology / PE / Home Economics
 * tables) and 6 as the token science in Social Sciences / Business. We take the
 * majority 5; the teacher can override the periods by hand.
 *
 * Kept as a flat lookup, NOT a resolveTimetableCurriculum band, so it never
 * pollutes the Class Timetable Studio's OBC-secondary manual fallback.
 */
export const OBC_SENIOR_PERIOD_MINUTES = 40

const OBC_SENIOR_SUBJECT_PERIODS = {
  mathematics: 6,
  chemistry: 6,
  biology: 5, // pathway-dependent (5 or 6) — majority 5, overridable
  civic_education: 5,
  geography: 5,
  religious_education: 5,
  // A senior candidate sits RE 2044 or RE 2046; either way the framework
  // allocates the one Religious Education line of 5 periods.
  religious_education_2044: 5,
  religious_education_2046: 5,
  agricultural_science: 12,
  art_and_design: 12,
  food_nutrition: 12,
  home_management: 12,
  physical_education: 12,
}

/** Format a whole-week minute count as the framework's "H h MM min" label. */
function minutesToAllocationLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h} h ${String(m).padStart(2, '0')} min`
}

/**
 * The official 2013 OBC Senior Secondary (Grades 10–12) allocation for a
 * subject, or null when the grade isn't senior secondary or the subject isn't
 * catalogued. A flat per-subject lookup by KB slug (e.g. 'agricultural_science')
 * — deliberately NOT a resolveTimetableCurriculum band.
 *
 * @param {string} grade       KB grade code / label ('G11', 'Grade 11')
 * @param {string} subjectSlug KB subject slug ('biology', 'mathematics', …)
 * @returns {{ periodsPerWeek:number, periodMinutes:number, timeAllocation:string }|null}
 */
export function obcSeniorSecondaryAllocation(grade, subjectSlug) {
  const m = String(grade ?? '').match(/(\d{1,2})/)
  const n = m ? Number(m[1]) : NaN
  if (!(n >= 10 && n <= 12)) return null
  const periods = OBC_SENIOR_SUBJECT_PERIODS[String(subjectSlug || '').trim().toLowerCase()]
  if (!periods) return null
  return {
    periodsPerWeek: periods,
    periodMinutes: OBC_SENIOR_PERIOD_MINUTES,
    timeAllocation: minutesToAllocationLabel(periods * OBC_SENIOR_PERIOD_MINUTES),
  }
}

/* ── Resolution ─────────────────────────────────────────────────── */

function bandForCurriculum(curriculumId, grade) {
  if (curriculumId === 'adapted-2023') return 'adapted'
  if (curriculumId === 'obc-2013') return obcBandForGrade(grade)
  if (curriculumId && curriculumId !== 'cbc-2023' && curriculumId !== DEFAULT_CURRICULUM_ID) return null
  return bandForGrade(grade)
}

/** The option groups a band requires, each with its selectable options. */
export function optionGroupsForBand(band) {
  const subjects = BAND_SUBJECTS[band] || []
  const groups = new Map()
  for (const s of subjects) {
    if (!s.optionGroupId) continue
    if (!groups.has(s.optionGroupId)) {
      const meta = OPTION_GROUPS[s.optionGroupId] || { id: s.optionGroupId, label: 'Choose one', defaultOptionId: s.id }
      groups.set(s.optionGroupId, { ...meta, options: [] })
    }
    groups.get(s.optionGroupId).options.push({
      id: s.id, label: s.canonicalName, weeklyPeriods: s.weeklyPeriods,
    })
  }
  return [...groups.values()]
}

/**
 * Resolve the full timetable configuration for a curriculum + grade +
 * option selections. `selectedOptions` maps optionGroupId → subject id
 * (e.g. { practical: 'home-economics' }); missing groups resolve to their
 * default so a plain call still yields a valid, complete week.
 *
 * The unselected members of each option group are returned with
 * `weeklyPeriods: 0` and `selected: false` so callers can show the swap —
 * they must never be auto-filled.
 *
 * Returns null when the curriculum has no prescribed allocation for the
 * grade (OBC 2013, custom, CBC secondary, Grade 7).
 */
export function resolveTimetableCurriculum({
  curriculumId = DEFAULT_CURRICULUM_ID, grade, gradeId, selectedOptions = {},
} = {}) {
  // `gradeId` is the documented resolver param; `grade` is the long-standing
  // studio field. Accept either so the one resolver serves both callers.
  const gradeValue = grade ?? gradeId ?? null
  const curriculum = getCurriculum(curriculumId) || getCurriculum(DEFAULT_CURRICULUM_ID)
  const band = bandForCurriculum(curriculum.id, gradeValue)
  if (!band || !BAND_SUBJECTS[band]) return null
  const meta = BAND_META[band]
  const groups = optionGroupsForBand(band)

  const chosen = {}
  for (const g of groups) {
    const wanted = selectedOptions?.[g.id]
    chosen[g.id] = g.options.some((o) => o.id === wanted) ? wanted : g.defaultOptionId
  }

  const subjects = BAND_SUBJECTS[band].map((s) => {
    const selected = !s.optionGroupId || chosen[s.optionGroupId] === s.id
    return {
      ...s,
      subjectId: s.id, // canonical id under the documented resolver contract
      label: s.canonicalName, // legacy field name used across the studio
      selected,
      weeklyPeriods: selected ? s.weeklyPeriods : 0,
      periodsPerWeek: selected ? s.weeklyPeriods : 0, // legacy field name
      load: subjectLoad(s.canonicalName),
      category: s.optionGroupId ? 'optional' : 'core',
      choiceGroup: s.optionGroupId, // legacy field name
    }
  })

  return {
    curriculumId: curriculum.id,
    curriculumName: curriculum.name,
    stageId: meta.stageId,
    level: band,
    levelLabel: meta.label,
    band,
    bandLabel: meta.label,
    grade: gradeValue,
    gradeId: gradeValue,
    periodMinutes: meta.periodMinutes,
    periodLengthMinutes: meta.periodMinutes,
    totalPeriods: meta.totalPeriods,
    requiredWeeklyPeriods: meta.totalPeriods,
    weeklyContactMinutes: meta.weeklyContactMinutes,
    contactLabel: meta.contactLabel,
    optionGroups: groups.map((g) => ({ ...g, selectedOptionId: chosen[g.id] })),
    selectedOptions: chosen,
    subjects,
  }
}

/**
 * Back-compat wrapper: the official CBC 2023 allocation for a grade, or null
 * when there is no prescribed allocation (ECE handled too). Same shape the
 * studio has always consumed; option groups resolve to their defaults with
 * the alternative seeded at 0 periods.
 */
export function getFrameworkForGrade(grade, curriculumId = DEFAULT_CURRICULUM_ID) {
  return resolveTimetableCurriculum({ curriculumId, grade })
}

/** True when the framework prescribes an allocation for this grade. */
export function hasFramework(grade) {
  return getFrameworkForGrade(grade) != null
}

/* ── Reference-table rows (Curriculum pages) ─────────────────────
 * The printed allocation tables shown on the Curriculum reference pages,
 * derived from the same data the Timetable Studio uses — one source.
 */
export function allocationTableRows(band) {
  const subjects = BAND_SUBJECTS[band] || []
  const meta = BAND_META[band]
  if (!meta) return null
  // Collapse each option group into one "A OR B" row, counted once.
  const rows = []
  const seenGroups = new Set()
  let index = 0
  for (const s of subjects) {
    if (s.optionGroupId) {
      if (seenGroups.has(s.optionGroupId)) continue
      seenGroups.add(s.optionGroupId)
      const members = subjects.filter((x) => x.optionGroupId === s.optionGroupId)
      index += 1
      rows.push({
        index,
        label: members.map((m) => m.canonicalName).join(' OR '),
        timeAllocation: s.timeAllocation,
        periods: s.weeklyPeriods,
      })
      continue
    }
    index += 1
    rows.push({ index, label: s.canonicalName, timeAllocation: s.timeAllocation, periods: s.weeklyPeriods })
  }
  return {
    band,
    bandLabel: meta.label,
    periodMinutes: meta.periodMinutes,
    totalPeriods: meta.totalPeriods,
    contactLabel: meta.contactLabel,
    rows,
  }
}
