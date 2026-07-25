/**
 * The Zambian education ladder — ONE declaration, as data.
 *
 * Every level a paper can target, from Baby Class to Form 5, with the four
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
 * Early Childhood. Zambian schools run three ECE years — Baby Class, Middle
 * Class and Reception — while the CBC ECE syllabus is written in two age bands
 * (3-4 and 4-5 years). Middle Class and Reception therefore ground on the same
 * 4-5 band: they are two school years sharing one published syllabus, which is
 * an alias, not a duplication. `ECE_R` keeps its long-standing meaning of
 * Reception so every paper already saved under it is untouched.
 */
const ECE_LEVELS = [
  {
    id: 'baby-class',
    value: 'ECE_B',
    label: 'Baby Class',
    stage: 'ece',
    order: 10,
    kbGrade: 'ECE_N',
    band: 'early_childhood',
    // ECE_N / "Nursery" is what this level was called before; a paper saved
    // under either must keep working and simply show the current name.
    aliases: ['ECE_N', 'Nursery', 'Baby Class', 'Baby'],
    ageLabel: '3–4 yrs',
    frameworks: ['2023'],
  },
  {
    id: 'middle-class',
    value: 'ECE_M',
    label: 'Middle Class',
    stage: 'ece',
    order: 20,
    kbGrade: 'ECE_R',
    band: 'early_childhood',
    aliases: ['Middle Class', 'Middle'],
    ageLabel: '4–5 yrs',
    frameworks: ['2023'],
  },
  {
    id: 'reception',
    value: 'ECE_R',
    label: 'Reception',
    stage: 'ece',
    order: 30,
    kbGrade: 'ECE_R',
    band: 'early_childhood',
    aliases: ['Reception'],
    ageLabel: '5–6 yrs',
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

/** The complete ladder, Baby Class → Form 5, in educational order. */
export const EDUCATION_LEVELS = Object.freeze(
  [...ECE_LEVELS, ...PRIMARY_LEVELS, ...SECONDARY_LEVELS]
    .sort((a, b) => a.order - b.order)
    .map((level) => Object.freeze({ ...level, aliases: Object.freeze(level.aliases) })),
)

const BY_VALUE = new Map(EDUCATION_LEVELS.map((l) => [l.value, l]))

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
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const direct = BY_VALUE.get(raw) || BY_ALIAS.get(normalizeKey(raw))
  if (direct) return direct
  // A bare secondary number is the Form year under its Grade naming — "8" means
  // Grade 8 means Form 1. (Primary bare numbers are already values, so they hit
  // BY_VALUE above.) Callers that must preserve the historical "Grade 8"
  // WORDING for an old paper check isLegacySecondaryGrade before asking here.
  const bare = raw.match(/^(\d{1,2})$/)
  if (bare) {
    const n = Number(bare[1])
    if (n >= 8 && n <= 12) return BY_VALUE.get(`G${n}`) || null
  }
  return null
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

/** Official display label ('Form 3', 'Baby Class'). */
export function levelLabel(value) {
  return resolveLevel(value)?.label || String(value ?? '')
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
