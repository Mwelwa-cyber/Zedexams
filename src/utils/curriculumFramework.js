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
 *   - obc-2013   2013 Outcome-Based Curriculum — no allocation table is
 *                catalogued yet; the studio uses the manual subject list.
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
    periodMinutes: 30,
    totalPeriods: 30,
    weeklyContactMinutes: 900, // 15 hours
    contactLabel: '15 hours',
  },
  lower_primary: {
    label: 'Lower Primary (Grades 1–3)',
    periodMinutes: 30,
    totalPeriods: 42,
    weeklyContactMinutes: 1260, // 21 hours
    contactLabel: '21 hours',
  },
  upper_primary: {
    label: 'Upper Primary (Grades 4–6)',
    periodMinutes: 40,
    totalPeriods: 42,
    weeklyContactMinutes: 1680, // 28 hours
    contactLabel: '28 hours',
  },
  adapted: {
    label: 'Adapted (intellectual disabilities)',
    periodMinutes: 40,
    totalPeriods: 22,
    weeklyContactMinutes: 880, // 14 h 40 min
    contactLabel: '14 h 40 min',
  },
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
    aliases: ['english', 'eng', 'english language'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: 'ece-language', subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'ece-sign-language', canonicalName: 'Sign Language Literacy', shortName: 'Sign Language',
    aliases: ['sign language', 'sign'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: 'ece-language', subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'ece-braille', canonicalName: 'Braille', shortName: 'Braille',
    aliases: ['braille literacy'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: 'ece-language', subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'ece-zambian-language', canonicalName: 'Zambian Language', shortName: 'Zambian Lang',
    aliases: ['zambian', 'zambian lang', 'local language'],
    weeklyPeriods: 5, weeklyMinutes: 150, timeAllocation: '2 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    id: 'pre-mathematics-science', canonicalName: 'Pre-Mathematics and Pre-Science', shortName: 'Pre-Maths & Sci',
    aliases: ['pre maths', 'pre mathematics', 'pre science', 'pre-maths and pre-science'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
  {
    id: 'ece-creative-technology', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    aliases: ['cts', 'creative & technology studies', 'creative and technology'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
]

const LOWER_PRIMARY_SUBJECTS = [
  {
    id: 'literacy-english', canonicalName: 'Literacy and Language — English Language', shortName: 'English',
    aliases: ['english', 'eng', 'english language', 'literacy & language — english', 'literacy english'],
    weeklyPeriods: 11, weeklyMinutes: 330, timeAllocation: '5 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: BLOCKS([2, 2, 1, 1, 1, 1, 1, 1, 1]),
  },
  {
    id: 'literacy-zambian', canonicalName: 'Literacy and Language — Zambian Language', shortName: 'Zambian Lang',
    aliases: ['zambian', 'zambian language', 'zambian lang', 'literacy & language — zambian', 'literacy zambian', 'local language'],
    weeklyPeriods: 11, weeklyMinutes: 330, timeAllocation: '5 h 30 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: BLOCKS([2, 2, 1, 1, 1, 1, 1, 1, 1]),
  },
  {
    id: 'mathematics-science', canonicalName: 'Mathematics and Science', shortName: 'Maths & Science',
    aliases: ['maths and science', 'mathematics & science', 'maths & science', 'maths', 'mathematics', 'science'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
  {
    id: 'creative-technology', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    aliases: ['cts', 'creative & technology studies', 'creative and technology', 'creative studies'],
    weeklyPeriods: 10, weeklyMinutes: 300, timeAllocation: '5 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 1, 1, 1, 1]),
  },
]

const UPPER_PRIMARY_SUBJECTS = [
  {
    id: 'english-language', canonicalName: 'English Language', shortName: 'English',
    aliases: ['english', 'eng'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(6),
  },
  {
    id: 'mathematics', canonicalName: 'Mathematics', shortName: 'Maths',
    aliases: ['maths', 'math'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(6),
  },
  {
    // Official canonical name is "Science" in the 2023 framework — Agricultural
    // Science content is integrated inside it, not a separate compulsory subject.
    id: 'science', canonicalName: 'Science', shortName: 'Science',
    aliases: ['integrated science', 'sci', 'science (incl. agricultural science)', 'agricultural science'],
    weeklyPeriods: 6, weeklyMinutes: 240, timeAllocation: '4 h 00 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: BLOCKS([2, 1, 1, 1, 1]), // one double for experiments / practical work
  },
  {
    id: 'zambian-language', canonicalName: 'Zambian Language', shortName: 'Zambian Lang',
    aliases: ['zambian', 'zambian lang', 'local language', 'bemba', 'nyanja', 'tonga', 'lozi', 'kaonde', 'lunda', 'luvale'],
    weeklyPeriods: 5, weeklyMinutes: 200, timeAllocation: '3 h 20 min',
    compulsory: true, optionGroupId: null, subjectType: 'language',
    blockPreference: SINGLES(5),
  },
  {
    // Mining content is included within Social Studies — never an extra subject.
    id: 'social-studies', canonicalName: 'Social Studies', shortName: 'Soc Studies',
    aliases: ['ss', 'social', 'social studies (incl. mining content)'],
    weeklyPeriods: 5, weeklyMinutes: 200, timeAllocation: '3 h 20 min',
    compulsory: true, optionGroupId: null, subjectType: 'academic',
    blockPreference: SINGLES(5),
  },
  {
    id: 'technology-studies', canonicalName: 'Technology Studies', shortName: 'Tech Studies',
    aliases: ['tech studies', 'tech', 'ict', 'computers', 'computer studies'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'practical',
    blockPreference: BLOCKS([2, 2, 1, 1, 1]), // practical — prefer double periods
  },
  {
    id: 'expressive-arts', canonicalName: 'Expressive Arts', shortName: 'Expr Arts',
    aliases: ['ea', 'art', 'arts', 'pe', 'physical education', 'music'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: 'practical', subjectType: 'practical',
    blockPreference: BLOCKS([2, 2, 1, 1, 1]),
  },
  {
    id: 'home-economics', canonicalName: 'Home Economics', shortName: 'Home Econ',
    aliases: ['home ec', 'homeec', 'h/econ', 'home management'],
    weeklyPeriods: 7, weeklyMinutes: 280, timeAllocation: '4 h 40 min',
    compulsory: true, optionGroupId: 'practical', subjectType: 'practical',
    blockPreference: BLOCKS([2, 2, 1, 1, 1]),
  },
]

const ADAPTED_SUBJECTS = [
  {
    id: 'adapted-maths-science', canonicalName: 'Mathematics and Science', shortName: 'Maths & Science',
    aliases: ['maths and science', 'maths', 'mathematics', 'science'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: SINGLES(4),
  },
  {
    id: 'adapted-english', canonicalName: 'English Language', shortName: 'English',
    aliases: ['english', 'eng'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: 'adapted-language', subjectType: 'language',
    blockPreference: SINGLES(4),
  },
  {
    id: 'adapted-sign-language', canonicalName: 'Sign Language', shortName: 'Sign Language',
    aliases: ['sign', 'sign language literacy'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: 'adapted-language', subjectType: 'language',
    blockPreference: SINGLES(4),
  },
  {
    id: 'adapted-creative-technology', canonicalName: 'Creative and Technology Studies', shortName: 'CTS',
    aliases: ['cts', 'creative and technology'],
    weeklyPeriods: 10, weeklyMinutes: 400, timeAllocation: '6 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'integrated',
    blockPreference: BLOCKS([2, 2, 2, 2, 2]), // longer continuous learning blocks
  },
  {
    id: 'activities-daily-living', canonicalName: 'Activities for Daily Living', shortName: 'Daily Living',
    aliases: ['adl', 'daily living'],
    weeklyPeriods: 4, weeklyMinutes: 160, timeAllocation: '2 h 40 min',
    compulsory: true, optionGroupId: null, subjectType: 'living-skills',
    blockPreference: SINGLES(4),
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
}

/* ── Resolution ─────────────────────────────────────────────────── */

function bandForCurriculum(curriculumId, grade) {
  if (curriculumId === 'adapted-2023') return 'adapted'
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
export function resolveTimetableCurriculum({ curriculumId = DEFAULT_CURRICULUM_ID, grade, selectedOptions = {} } = {}) {
  const curriculum = getCurriculum(curriculumId) || getCurriculum(DEFAULT_CURRICULUM_ID)
  const band = bandForCurriculum(curriculum.id, grade)
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
    level: band,
    levelLabel: meta.label,
    band,
    bandLabel: meta.label,
    grade: grade ?? null,
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
