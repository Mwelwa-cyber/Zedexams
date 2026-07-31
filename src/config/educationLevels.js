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
 * WHERE THE RUNGS COME FROM
 * ─────────────────────────
 * The ladder is DERIVED from src/config/canonicalEducation.js — the one
 * declaration of which curriculum years exist and which curriculum defines
 * each. This module used to declare its own three arrays, which is how it came
 * to stop at Form 5 while the Curriculum Reference page advertised Forms 1-6.
 * What stays local here is everything paper-specific that the canonical model
 * deliberately does not model: the STORED `value` scheme (primary levels store
 * a bare number, secondary stores its G-code), the assessmentBands `band` id,
 * and the alias list.
 *
 * Pure — no React, no Firebase — so the plain-node suite imports it directly.
 */

import { CANONICAL_GRADES } from './canonicalEducation.js'

/** Stage groupings, in ladder order. */
export const LEVEL_STAGES = ['ece', 'primary', 'secondary']

export const LEVEL_STAGE_LABELS = {
  ece: 'Early Childhood',
  primary: 'Primary',
  secondary: 'Secondary',
}

/** Canonical curriculum id → the framework token this module speaks. */
const FRAMEWORK_FOR_CURRICULUM = { cbc: '2023', obc: '2013' }

/**
 * The assessmentBands document governing a rung. Bands are a pedagogical
 * grouping of the ladder — they are not curriculum structure, so they live here
 * with the rest of the paper-specific detail rather than in the canonical model.
 */
function bandForRung(rung) {
  if (rung.stage === 'ece') return 'early_childhood'
  if (rung.formNumber != null) return rung.formNumber <= 2 ? 'junior_secondary' : 'senior_secondary'
  return rung.gradeNumber <= 4 ? 'lower_primary' : 'upper_primary'
}

/**
 * The value a paper STORES for a rung. Primary levels store the bare number and
 * secondary levels store the G-code — a historical split that predates the
 * canonical model and that thousands of saved papers depend on, so it is
 * preserved exactly rather than normalised.
 */
function storedValueForRung(rung) {
  if (rung.stage === 'ece') return rung.code
  if (rung.formNumber != null) return rung.code
  return String(rung.gradeNumber)
}

/**
 * Every spelling that names a rung. "Form 3" and "Grade 10" are both declared
 * here — that is the whole point of the alias list, and why there is no second
 * copy of the Grade 10 syllabus sitting behind a different name.
 */
function aliasesForRung(rung) {
  if (rung.stage === 'ece') return [rung.code, rung.properName]
  if (rung.formNumber != null) {
    return [`Form ${rung.formNumber}`, `Grade ${rung.gradeNumber}`, rung.code, `F${rung.formNumber}`]
  }
  return [`Grade ${rung.gradeNumber}`, rung.code]
}

/**
 * The complete ladder, Nursery → Form 6, in educational order.
 *
 * "Baby Class" and "Middle Class" are NOT levels here and are never displayed.
 * They are accepted only as LEGACY aliases, so a record saved under either name
 * still opens — normalised onto Nursery rather than left pointing at a level no
 * picker offers. See LEGACY_LEVEL_ALIASES.
 */
export const EDUCATION_LEVELS = Object.freeze(
  CANONICAL_GRADES.map((rung) => {
    const isEce = rung.stage === 'ece'
    const isSecondary = rung.formNumber != null
    const level = {
      id: isEce ? rung.properName.toLowerCase() : rung.id,
      value: storedValueForRung(rung),
      label: isEce ? rung.properName : (isSecondary ? `Form ${rung.formNumber}` : `Grade ${rung.gradeNumber}`),
      stage: isSecondary ? 'secondary' : rung.stage,
      order: rung.order,
      kbGrade: rung.code,
      band: bandForRung(rung),
      aliases: Object.freeze(aliasesForRung(rung)),
      frameworks: Object.freeze(rung.curricula.map((c) => FRAMEWORK_FOR_CURRICULUM[c]).filter(Boolean)),
    }
    if (isEce) level.ageLabel = rung.ageLabel
    if (isSecondary) level.gradeAlias = `Grade ${rung.gradeNumber}`
    // Which TIER this rung sits in, per curriculum. The distinction only bites
    // at Form 5: under the 2013 set it is the final O-Level year (Grade 12),
    // under the CBC it is the first of the two A-Level years. Recorded per
    // framework rather than resolved to one answer, because both are true.
    level.tierByFramework = Object.freeze(Object.fromEntries(
      rung.curricula.map((c) => [
        FRAMEWORK_FOR_CURRICULUM[c],
        (rung.stageByCurriculum && rung.stageByCurriculum[c]) || rung.stage,
      ]),
    ))
    return Object.freeze(level)
  }),
)

/**
 * The Advanced-Level tier: the two post-School-Certificate years the 2023
 * framework introduces (§4.3.2, Form 5 → Form 6). It is deliberately NOT part
 * of the ladder `levelsForFramework` returns, because that ladder drives
 * O-Level paper generation and an A-Level paper is a different instrument with
 * no syllabus on file. Ask for it explicitly.
 */
export const ADVANCED_TIER = 'advanced'

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

/**
 * The levels a curriculum framework defines, in ladder order.
 *
 * The Advanced-Level tier is excluded by default. Under the CBC, Forms 5-6 are
 * A-Level years — a different instrument from the School Certificate papers
 * this ladder feeds, with no syllabus on file — so offering them in an O-Level
 * grade picker would dead-end the teacher. Under the 2013 set, Form 5 IS the
 * final O-Level year and is included, which is why the tier is read per
 * framework rather than off the rung.
 *
 * Pass `{ includeAdvanced: true }` for a surface that genuinely spans both
 * tiers (the Curriculum Reference page, an admin catalogue).
 */
export function levelsForFramework(framework = '2023', { includeAdvanced = false } = {}) {
  const fw = String(framework) === '2013' ? '2013' : '2023'
  return EDUCATION_LEVELS.filter((l) => (
    l.frameworks.includes(fw) &&
    (includeAdvanced || l.tierByFramework[fw] !== ADVANCED_TIER)
  ))
}

/** The A-Level rungs a framework defines, in ladder order. [] for the 2013 set. */
export function advancedLevelsForFramework(framework = '2023') {
  const fw = String(framework) === '2013' ? '2013' : '2023'
  return EDUCATION_LEVELS.filter((l) => (
    l.frameworks.includes(fw) && l.tierByFramework[fw] === ADVANCED_TIER
  ))
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
