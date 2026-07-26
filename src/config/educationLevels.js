/**
 * The Zambian education ladder — ONE declaration, as data.
 *
 * Every level a paper can target, from Nursery to Form 5, with the four
 * things the rest of the app kept re-deriving in different places:
 *
 *   value      what a saved paper stores and a picker selects
 *   kbGrade    the syllabus/KB grade code it grounds on
 *   aliases    every other spelling that means this same curriculum year
 *   band       which assessmentBands document sets its pedagogical rules
 *
 * The alias list is the point. A school that calls Form 3 "Grade 10" is naming
 * the SAME curriculum year, so both must resolve to one level and one syllabus
 * — never to two, and never to a duplicated copy of the content. The same holds
 * for the ECE rename: "Nursery" and "ECE_N" are what Baby Class used to be
 * called, so papers saved under those values keep opening, keep their syllabus,
 * and simply display the current name.
 *
 * `frameworks` records which curriculum actually defines a level: CBC abolished
 * Grade 7 in the 3-6-4-2 restructure and stops at Form 4, while the previous
 * (2013) syllabus runs Grade 1–7 and Form 1–5 and has no ECE bands at all. That
 * is a curriculum fact, not a UI preference, so it lives here with everything
 * else rather than in two hand-maintained arrays.
 *
 * Being offered in a picker needs one more thing on top of this: syllabus rows
 * actually on file for that grade (see getAvailableLevels in paperTaxonomy.js).
 * A level with no syllabus content is not offered, because a paper generated
 * against content we do not have would be invented.
 *
 * Pure — no React, no Firebase — so the plain-node suite imports it directly.
 */

/** Stage groupings, in ladder order. */
export const LEVEL_STAGES = ['ece', 'primary', 'secondary']

export const LEVEL_STAGE_LABELS = {
  ece: 'Early Childhood',
  primary: 'Primary',
  secondary: 'Secondary',
}

const BOTH = ['2023', '2013']

/**
 * Early Childhood — exactly two levels: Nursery then Reception. They line up
 * one-to-one with the two age bands the CBC ECE syllabus actually publishes
 * (3-4 and 4-5 years), so each has its own content and neither is an alias of
 * the other.
 *
 * "Baby Class" and "Middle Class" are NOT levels here and are never displayed.
 * They are accepted only as LEGACY aliases, so a record saved under either name
 * still opens — normalised onto Nursery rather than left pointing at a level no
 * picker offers. See LEGACY_LEVEL_ALIASES.
 */
const ECE_LEVELS = [
  {
    id: 'nursery',
    value: 'ECE_N',
    label: 'Nursery',
    stage: 'ece',
    order: 10,
    kbGrade: 'ECE_N',
    band: 'early_childhood',
    aliases: ['ECE_N', 'Nursery'],
    ageLabel: '3–4 yrs',
    frameworks: ['2023'],
  },
  {
    id: 'reception',
    value: 'ECE_R',
    label: 'Reception',
    stage: 'ece',
    order: 20,
    kbGrade: 'ECE_R',
    band: 'early_childhood',
    aliases: ['ECE_R', 'Reception'],
    ageLabel: '4–5 yrs',
    frameworks: ['2023'],
  },
]

/** Primary. Grade 7 exists only under the previous syllabus. */
const PRIMARY_LEVELS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: `grade-${n}`,
  value: String(n),
  label: `Grade ${n}`,
  stage: 'primary',
  order: 30 + n * 10,
  kbGrade: `G${n}`,
  band: n <= 4 ? 'lower_primary' : 'upper_primary',
  aliases: [`Grade ${n}`, `G${n}`],
  frameworks: n === 7 ? ['2013'] : BOTH,
}))

/**
 * Secondary. The syllabus keys these years G8–G12 and Zambian schools call them
 * Form 1–5, so the value stays the KB code while the label is the Form. Both
 * "Form 3" and "Grade 10" are declared aliases of the one level — that is the
 * whole point of the alias list, and why there is no second copy of the Grade
 * 10 syllabus sitting behind a different name. Form 5 exists only under the
 * previous syllabus.
 */
const SECONDARY_LEVELS = [1, 2, 3, 4, 5].map((n) => {
  const grade = n + 7
  return {
    id: `form-${n}`,
    value: `G${grade}`,
    label: `Form ${n}`,
    stage: 'secondary',
    order: 100 + n * 10,
    kbGrade: `G${grade}`,
    band: n <= 2 ? 'junior_secondary' : 'senior_secondary',
    // "Grade 10" is the display alias some schools use for Form 3.
    aliases: [`Form ${n}`, `Grade ${grade}`, `G${grade}`, `F${n}`],
    gradeAlias: `Grade ${grade}`,
    frameworks: n === 5 ? ['2013'] : BOTH,
  }
})

/** The complete ladder, Nursery → Form 5, in educational order. */
export const EDUCATION_LEVELS = Object.freeze(
  [...ECE_LEVELS, ...PRIMARY_LEVELS, ...SECONDARY_LEVELS]
    .sort((a, b) => a.order - b.order)
    .map((level) => Object.freeze({ ...level, aliases: Object.freeze(level.aliases) })),
)

const BY_VALUE = new Map(EDUCATION_LEVELS.map((l) => [l.value, l]))

/**
 * Retired spellings that must keep resolving so old records stay reachable, but
 * that are NEVER offered or displayed as levels.
 *
 * `ambiguous: true` marks a value that does not identify one level on its own —
 * a bare "ECE" spans both ECE years. It resolves to the youngest, because
 * pitching content down is harmless to an older child while pitching it up is
 * not, and levelResolution() reports it so the caller can log the fallback
 * rather than let it pass silently.
 */
export const LEGACY_LEVEL_ALIASES = Object.freeze({
  // Never levels in ZedExams. Accepted so a record written elsewhere (an import,
  // a hand-edited doc, an earlier build) still opens.
  'baby class': { levelId: 'nursery' },
  baby: { levelId: 'nursery' },
  ece_b: { levelId: 'nursery' },
  'middle class': { levelId: 'nursery' },
  middle: { levelId: 'nursery' },
  ece_m: { levelId: 'nursery' },
  // Pre-dates the age bands and covers both ECE years.
  ece: { levelId: 'nursery', ambiguous: true },
})

const BY_ID = new Map(EDUCATION_LEVELS.map((l) => [l.id, l]))

/** Every alias spelling → its level. Lower-cased, whitespace-collapsed. */
const BY_ALIAS = (() => {
  const map = new Map()
  const put = (key, level) => {
    const k = normalizeKey(key)
    // First declaration wins, so a spelling shared by two levels (none today)
    // can never silently flip which one it resolves to.
    if (k && !map.has(k)) map.set(k, level)
  }
  for (const level of EDUCATION_LEVELS) {
    put(level.value, level)
    put(level.label, level)
    put(level.id, level)
    for (const alias of level.aliases) put(alias, level)
  }
  return map
})()

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Resolve any spelling of a level — stored value, official label, display alias
 * ("Grade 10" for Form 3), legacy ECE code — to its single ladder entry.
 * Returns null for anything the ladder does not define, so callers can decide
 * whether to reject it or pass it through.
 */
export function resolveLevel(value) {
  return levelResolution(value).level
}

/**
 * resolveLevel with the provenance of the match, so a caller can log a legacy
 * or ambiguous value instead of silently accepting it.
 *
 * @param {string} value
 * @returns {{level: object|null, matchedBy: 'canonical'|'alias'|'grade-number'|'legacy'|'none',
 *            legacy: boolean, ambiguous: boolean, input: string}}
 */
export function levelResolution(value) {
  const raw = String(value ?? '').trim()
  const none = { level: null, matchedBy: 'none', legacy: false, ambiguous: false, input: raw }
  if (!raw) return none

  if (BY_VALUE.has(raw)) {
    return { level: BY_VALUE.get(raw), matchedBy: 'canonical', legacy: false, ambiguous: false, input: raw }
  }
  const key = normalizeKey(raw)
  if (BY_ALIAS.has(key)) {
    return { level: BY_ALIAS.get(key), matchedBy: 'alias', legacy: false, ambiguous: false, input: raw }
  }
  // Retired spellings — resolved so old records open, never offered as levels.
  const legacy = LEGACY_LEVEL_ALIASES[key]
  if (legacy) {
    return {
      level: BY_ID.get(legacy.levelId) || null,
      matchedBy: 'legacy',
      legacy: true,
      ambiguous: Boolean(legacy.ambiguous),
      input: raw,
    }
  }
  // A bare secondary number is the Form year under its Grade naming — "8" means
  // Grade 8 means Form 1. (Primary bare numbers are already values, so they hit
  // BY_VALUE above.) Callers that must preserve the historical "Grade 8"
  // WORDING for an old paper check isLegacySecondaryGrade before asking here.
  const bare = raw.match(/^(\d{1,2})$/)
  if (bare) {
    const n = Number(bare[1])
    if (n >= 8 && n <= 12 && BY_VALUE.has(`G${n}`)) {
      return {
        level: BY_VALUE.get(`G${n}`), matchedBy: 'grade-number',
        legacy: false, ambiguous: false, input: raw,
      }
    }
  }
  return none
}

/**
 * Log a legacy or ambiguous level value once per distinct input, so the
 * fallback is recorded without flooding the console on every render.
 * Returns the resolution so it can be used inline.
 */
const _reportedLegacy = new Set()
export function reportLevelResolution(value, where = '') {
  const res = levelResolution(value)
  if ((res.legacy || res.ambiguous) && res.level) {
    const key = `${where}|${res.input}`
    if (!_reportedLegacy.has(key)) {
      _reportedLegacy.add(key)
      const kind = res.ambiguous ? 'ambiguous legacy' : 'legacy'
      console.warn(
        `[educationLevels] ${kind} level value "${res.input}"` +
        `${where ? ` (${where})` : ''} resolved to ${res.level.label}. ` +
        'It is not an offered level; normalise the record on its next save.',
      )
    }
  }
  return res
}

/** The levels a curriculum framework defines, in ladder order. */
export function levelsForFramework(framework = '2023') {
  const fw = String(framework) === '2013' ? '2013' : '2023'
  return EDUCATION_LEVELS.filter((l) => l.frameworks.includes(fw))
}

/** The syllabus/KB grade code a level grounds on ('ECE_B' → 'ECE_N'). */
export function levelKbGrade(value) {
  return resolveLevel(value)?.kbGrade || ''
}

/** The assessmentBands document id governing a level. */
export function levelBandId(value) {
  return resolveLevel(value)?.band || ''
}

/** Official display label ('Form 3', 'Nursery'). */
export function levelLabel(value) {
  return resolveLevel(value)?.label || String(value ?? '')
}

/**
 * Why a level is or is not usable for the selected curriculum. A picker must be
 * able to tell these four apart, because they need different words: a level we
 * have never heard of is a different problem from a real level whose syllabus
 * has not been loaded yet, and neither should look like an empty dropdown.
 */
export const LEVEL_AVAILABILITY = {
  /** Declared by this curriculum AND syllabus rows are on file. */
  AVAILABLE: 'available',
  /** Declared by this curriculum, but no syllabus content has been loaded. */
  NO_CATALOGUE_DATA: 'no-catalogue-data',
  /** A real level, but the OTHER curriculum is the one that defines it. */
  OTHER_CURRICULUM_ONLY: 'other-curriculum-only',
  /** Not a level in the ladder at all. */
  UNKNOWN: 'unknown',
}

/**
 * Classify a level against a curriculum + the KB grade codes that actually have
 * syllabus rows. The message is teacher-facing and says what to do next; a
 * level is never silently swapped for one from another curriculum.
 *
 * @param {string} value level value/label/alias
 * @param {object} args
 * @param {'2023'|'2013'} args.framework
 * @param {Iterable<string>|null} args.gradeCodes KB codes present in the
 *   syllabus. null means "not resolved yet" — treated as available so a picker
 *   is never briefly empty.
 * @returns {{availability: string, level: object|null, message: string}}
 */
export function levelAvailability(value, { framework = '2023', gradeCodes = null } = {}) {
  const level = resolveLevel(value)
  if (!level) {
    return {
      availability: LEVEL_AVAILABILITY.UNKNOWN,
      level: null,
      message: `“${String(value ?? '').trim()}” is not a level ZedExams recognises.`,
    }
  }
  const fw = String(framework) === '2013' ? '2013' : '2023'
  const curriculumName = fw === '2013' ? 'the previous syllabus' : 'CBC'
  const otherName = fw === '2013' ? 'CBC' : 'the previous syllabus'

  if (!level.frameworks.includes(fw)) {
    return {
      availability: LEVEL_AVAILABILITY.OTHER_CURRICULUM_ONLY,
      level,
      message:
        `${level.label} is not part of ${curriculumName}. It is taught under ` +
        `${otherName} — switch curriculum to use it.`,
    }
  }
  if (gradeCodes) {
    const present = gradeCodes instanceof Set ? gradeCodes : new Set(gradeCodes)
    if (!present.has(level.kbGrade)) {
      return {
        availability: LEVEL_AVAILABILITY.NO_CATALOGUE_DATA,
        level,
        message:
          `${level.label} is recognised, but ${curriculumName} syllabus content ` +
          'has not yet been loaded for this level. Select an available curriculum ' +
          'or ask an administrator to add the verified syllabus.',
      }
    }
  }
  return { availability: LEVEL_AVAILABILITY.AVAILABLE, level, message: '' }
}

/**
 * Do two spellings mean the same curriculum year? "Form 3" and "Grade 10" do;
 * "Form 3" and "Grade 3" do not.
 */
export function isSameLevel(a, b) {
  const left = resolveLevel(a)
  const right = resolveLevel(b)
  return Boolean(left && right && left.id === right.id)
}
