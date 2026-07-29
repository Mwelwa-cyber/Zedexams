/**
 * lessonPlanFormat — the single declaration of how much paper a lesson plan is
 * allowed to use, and what that costs it.
 *
 * A generated plan is printed by FOUR things that must agree: the studio
 * preview (`renderPlanHtml`), the print/PDF window (`lessonPlanToPdf`), the
 * Word export (`lessonPlanToDocx`), and the generation prompt itself (which
 * decides how many words end up in each cell). Before this module each of them
 * carried its own idea of margins, font sizes and section visibility, so a
 * teacher who chose "1 page" got a one-page preview and a four-page Word file.
 *
 * Everything here is data plus pure functions — no React, no DOM, no Firebase —
 * so the exporters, the prompt builder and the plain-node tests all import the
 * same copy. `scripts/test-lesson-plan-format.mjs` is the guard.
 *
 * Vocabulary
 *   pageBudget      '1' | '2' | 'none' — how much paper the teacher agreed to
 *   writingStyle    'point' | 'simple' | 'standard' | 'professional'
 *   density         'comfortable' | 'compact'
 *   environment     'simple' | 'detailed' — how LEARNING ENVIRONMENT prints
 *   headerStyle     'school' | 'ministry'
 */

// ── Page budget ───────────────────────────────────────────────────────────────

export const PAGE_BUDGETS = ['1', '2', 'none']

export const PAGE_BUDGET_LABELS = {
  1: '1 page',
  2: '2 pages',
  none: 'No limit',
}

/** Target sheet count, or null when the teacher asked for no limit. */
export const PAGE_BUDGET_TARGET = {
  1: 1,
  2: 2,
  none: null,
}

// ── Margins ───────────────────────────────────────────────────────────────────

export const MARGIN_PRESETS = { normal: 15, narrow: 10, minimum: 6 }

/** Preset order, widest first — the Fit-to-page ladder walks this downwards. */
export const MARGIN_PRESET_ORDER = ['normal', 'narrow', 'minimum']

export const MARGIN_MIN_MM = 5
export const MARGIN_MAX_MM = 20

/**
 * Most home and school printers cannot put ink in the outer ~5 mm of a sheet.
 * Below 8 mm we warn; at or below 5 mm the warning turns red. It is never a
 * block — a teacher who knows their printer is right more often than we are.
 */
export const MARGIN_SAFE_AREA_MM = 5
export const MARGIN_WARN_BELOW_MM = 8

const MARGIN_WARNING_AMBER =
  'Margins are close to the edge. Many printers cannot print the outer ~5 mm (dashed line) — text near it may be cut off. You can still print if your printer supports it.'
const MARGIN_WARNING_RED =
  'Text is at the paper’s edge. Most printers cannot print the outer ~5 mm — content on the dashed line will likely be cut off.'

/**
 * The printable-boundary verdict for a margin, in mm.
 * @param {number} mm
 * @returns {{ level: 'none' | 'amber' | 'red', message: string, showSafeArea: boolean }}
 */
export function marginWarning(mm) {
  const m = Number(mm)
  if (!Number.isFinite(m)) return { level: 'none', message: '', showSafeArea: false }
  if (m <= MARGIN_SAFE_AREA_MM) return { level: 'red', message: MARGIN_WARNING_RED, showSafeArea: true }
  if (m < MARGIN_WARN_BELOW_MM) return { level: 'amber', message: MARGIN_WARNING_AMBER, showSafeArea: true }
  return { level: 'none', message: '', showSafeArea: false }
}

// ── Typography presets ────────────────────────────────────────────────────────

/**
 * Per-budget defaults. `marginMm` is only the DEFAULT for the preset — an
 * explicit Paper Fit choice always wins (§2.5).
 */
export const TYPOGRAPHY_PRESETS = {
  1: { bodyPt: 10, tablePt: 9, cellPaddingPt: 2, marginMm: MARGIN_PRESETS.narrow, density: 'compact' },
  2: { bodyPt: 11, tablePt: 10, cellPaddingPt: 3, marginMm: MARGIN_PRESETS.normal, density: 'compact' },
  none: { bodyPt: 11.5, tablePt: 10.5, cellPaddingPt: 5, marginMm: MARGIN_PRESETS.normal, density: 'comfortable' },
}

/** Line height and inter-section spacing, by density. */
export const DENSITY_METRICS = {
  compact: { lineHeight: 1.25, cellSpaceAfterPt: 0, sectionGapPt: 4 },
  comfortable: { lineHeight: 1.45, cellSpaceAfterPt: 3, sectionGapPt: 8 },
}

// ── Optional sections (§2.4) ──────────────────────────────────────────────────

/**
 * Every section a teacher may drop. Order is the order they are offered in the
 * Advanced Options drawer.
 */
export const OPTIONAL_SECTIONS = [
  'rationale',
  'priorKnowledge',
  'references',
  'expectedStandard',
  'remedialWork',
  'extensionActivity',
  'homework',
  'lessonEvaluation',
]

export const OPTIONAL_SECTION_LABELS = {
  rationale: 'Rationale',
  priorKnowledge: 'Prior knowledge',
  references: 'References',
  expectedStandard: 'Expected standard',
  remedialWork: 'Remedial work',
  extensionActivity: 'Extension activity',
  homework: 'Homework row',
  lessonEvaluation: 'Lesson evaluation',
}

/**
 * Defaults per budget: everything on at 2 pages; at 1 page the three sections a
 * teacher is least likely to be inspected on come off so the rest fits.
 */
const SECTION_DEFAULTS_OFF_AT_ONE_PAGE = ['rationale', 'remedialWork', 'extensionActivity']

/**
 * @param {string} pageBudget
 * @returns {Record<string, boolean>}
 */
export function defaultSections(pageBudget) {
  const budget = normalizePageBudget(pageBudget)
  const out = {}
  for (const key of OPTIONAL_SECTIONS) {
    out[key] = budget === '1' ? !SECTION_DEFAULTS_OFF_AT_ONE_PAGE.includes(key) : true
  }
  return out
}

// ── Word budgets (§3.1) ───────────────────────────────────────────────────────

/**
 * Words a generated cell may use, per page budget. `null` means "no ceiling" —
 * NOT zero, so a caller that treats a missing budget as 0 fails loudly rather
 * than silently condensing every cell to nothing.
 *
 * `maxFragments` caps how many dash lines a cell may carry; the printed height
 * of a cell is driven at least as much by line count as by word count.
 */
export const WORD_BUDGETS = {
  1: {
    rationale: 20,
    lessonGoal: 20,
    priorKnowledge: 15,
    teacher: 20,
    pupils: 12,
    assessment: 10,
    remedialWork: 0,
    extensionActivity: 0,
    maxFragments: { teacher: 3, pupils: 2, assessment: 1 },
    expectedAnswers: false,
  },
  2: {
    rationale: 35,
    lessonGoal: 30,
    priorKnowledge: 25,
    teacher: 40,
    pupils: 25,
    assessment: 18,
    remedialWork: 25,
    extensionActivity: 25,
    maxFragments: { teacher: 4, pupils: 3, assessment: 2 },
    expectedAnswers: true,
    expectedAnswerWords: 8,
  },
  none: {
    rationale: null,
    lessonGoal: null,
    priorKnowledge: null,
    teacher: null,
    pupils: null,
    assessment: null,
    remedialWork: null,
    extensionActivity: null,
    maxFragments: { teacher: null, pupils: null, assessment: null },
    expectedAnswers: true,
    expectedAnswerWords: null,
  },
}

/**
 * How far over budget a cell may run before the length gate spends a model call
 * on it. A cell 10% long costs a line; one 40% long costs a page.
 */
export const LENGTH_GATE_TOLERANCE = 0.25

// ── Writing style ─────────────────────────────────────────────────────────────

export const WRITING_STYLES = ['point', 'simple', 'standard', 'professional']

export const WRITING_STYLE_LABELS = {
  point: 'Point form',
  simple: 'Simple',
  standard: 'Standard',
  professional: 'Professional',
}

/**
 * The instruction each style contributes to the generation prompt. Point form is
 * the one that changes LENGTH rather than tone, which is the whole reason the
 * old Simplified/Standard/Detailed knob never saved any paper.
 */
export const WRITING_STYLE_DIRECTIVES = {
  point:
    'Point form (as teachers write in a plan book) — sentence fragments in the imperative, no subject pronouns, no restating the stage name or the lesson context, no full sentences. Write "Draw and label nose, trachea, bronchi, lungs on chalkboard", never "The teacher will draw a simple outline of the human respiratory system on the chalkboard, showing…".',
  simple: 'Simple — short sentences and plain, everyday words a trainee teacher can follow.',
  standard: 'Standard — clear, formal teacher language.',
  professional: 'Professional — formal, sophisticated vocabulary suitable for a School Inspector.',
}

/** Point form is the default at any budget that actually limits pages. */
export function defaultWritingStyle(pageBudget) {
  return normalizePageBudget(pageBudget) === 'none' ? 'standard' : 'point'
}

// ── Learning environment display (§2.3) ───────────────────────────────────────

export const ENVIRONMENT_DISPLAYS = ['simple', 'detailed']

export const ENVIRONMENT_KEYS = ['natural', 'artificial', 'technological']

export const ENVIRONMENT_LABELS = {
  natural: 'Natural',
  artificial: 'Artificial',
  technological: 'Technological',
}

/**
 * Phrases a generator emits for a category the teacher did not pick. They must
 * never reach the page — "I. Natural: Not applicable for this lesson." is three
 * lines and a heading where the teacher writes one word.
 */
const NOT_APPLICABLE_RE =
  /^\s*(n\/?a\.?|none\.?|nil\.?|not\s+applicable(\s+(for|to)\s+this\s+lesson)?\.?|no[nt]\s+used\.?|-+)\s*$/i

/** True when a category's description says nothing, in any of its spellings. */
export function isBlankEnvironment(value) {
  const s = String(value == null ? '' : value).trim()
  return s === '' || NOT_APPLICABLE_RE.test(s)
}

// Keyword → place, most specific first. The place is what a teacher writes on
// the line: one word naming where the lesson happens. The last entry of each
// list is the fallback, used when the description names nothing recognisable —
// including when there is no description at all.
const PLACE_RULES = {
  artificial: [
    [/\blaborator|\blab\b/i, 'Laboratory'],
    [/\bworkshop/i, 'Workshop'],
    [/\blibrar/i, 'Library'],
    [/\bhall\b|\bassembly/i, 'School hall'],
  ],
  natural: [
    [/\bgarden/i, 'School garden'],
    [/\bfield|\bpitch\b/i, 'School field'],
    [/\bfarm/i, 'School farm'],
    [/\briver|\bstream|\bpond/i, 'Nearby stream'],
  ],
  technological: [
    [/\bmedia\b/i, 'Media room'],
  ],
}

const PLACE_FALLBACK = {
  artificial: 'Classroom',
  natural: 'School grounds',
  technological: 'Computer laboratory',
}

/**
 * The PLACE a category names — "Classroom", "School grounds", "Laboratory".
 * Derived from the category and its description; a teacher can always override
 * it with free text (see `resolveEnvironmentLines`' `place` argument).
 * @param {string} key
 * @param {string} [description]
 * @returns {string}
 */
export function environmentPlace(key, description) {
  const rules = PLACE_RULES[key]
  if (!rules) return ''
  const text = String(description || '')
  for (const [re, place] of rules) {
    if (re.test(text)) return place
  }
  return PLACE_FALLBACK[key] || ''
}

/**
 * Which environment categories actually print.
 *
 * A category is selected when the teacher picked it (`selected`, from the
 * Lesson Context step) or — for a plan saved before that list was recorded —
 * when the generator wrote something real about it. An unselected category is
 * dropped entirely; there is no placeholder line, in either display mode.
 *
 * @param {object} environment  the plan's learningEnvironment object
 * @param {string[]} [selected] teacher-picked category names ('Artificial', …)
 * @returns {Array<{ key: string, label: string, description: string }>}
 */
export function selectedEnvironments(environment, selected) {
  const env = environment && typeof environment === 'object' ? environment : {}
  const picked = Array.isArray(selected) && selected.length
    ? new Set(selected.map((s) => String(s || '').trim().toLowerCase()))
    : null
  return ENVIRONMENT_KEYS
    .map((key) => ({
      key,
      label: ENVIRONMENT_LABELS[key],
      // A "Not applicable" description is treated as no description at all, so
      // Detailed mode falls back to the derived place rather than printing the
      // generator's apology.
      description: isBlankEnvironment(env[key]) ? '' : String(env[key]).trim(),
    }))
    .filter((e) => (picked ? picked.has(e.key) : e.description !== ''))
}

/**
 * The one (or two) LEARNING ENVIRONMENT lines a plan prints.
 *
 * Simple   → `LEARNING ENVIRONMENT: Classroom`
 * Detailed → `LEARNING ENVIRONMENT (Artificial): Classroom with chalkboard, …`
 *
 * Returns [] when nothing was selected — an empty result prints no heading at
 * all, which is the point: a teacher who did not pick an environment should not
 * be given a blank label to explain.
 *
 * @param {object} opts
 * @param {object} opts.environment    plan.learningEnvironment
 * @param {string[]} [opts.selected]   teacher-picked categories
 * @param {string} [opts.display]      'simple' | 'detailed'
 * @param {string} [opts.place]        free-text override for Simple mode
 * @returns {Array<{ label: string, value: string }>}
 */
export function resolveEnvironmentLines({ environment, selected, display = 'simple', place } = {}) {
  const mode = display === 'detailed' ? 'detailed' : 'simple'
  const entries = selectedEnvironments(environment, selected)
  if (entries.length === 0) return []

  if (mode === 'simple') {
    const override = String(place || '').trim()
    const places = override
      ? [override]
      : entries.map((e) => environmentPlace(e.key, e.description)).filter(Boolean)
    const value = Array.from(new Set(places)).join(' and ')
    return value ? [{ label: 'Learning Environment', value }] : []
  }

  return entries
    .map((e) => ({
      label: `Learning Environment (${e.label})`,
      // Detailed still prints ONE line per selected category — the description
      // when the generator wrote one, the derived place when it did not, so the
      // line is never a bare label.
      value: e.description || environmentPlace(e.key, ''),
    }))
    .filter((l) => l.value)
}

// ── Header style (§4.3) ───────────────────────────────────────────────────────

export const HEADER_STYLES = ['school', 'ministry']

export const DEFAULT_MINISTRY_LINE = 'MINISTRY OF EDUCATION'

/**
 * The masthead lines above the metadata block, top to bottom.
 * @param {object} opts
 * @returns {string[]}
 */
export function headerLines({ headerStyle = 'school', ministryLine, school } = {}) {
  const lines = []
  if (headerStyle === 'ministry') {
    lines.push(String(ministryLine || DEFAULT_MINISTRY_LINE).trim().toUpperCase())
  }
  const name = String(school || '').trim()
  if (name) lines.push(name)
  return lines
}

// ── Fit to page (§2.5) ────────────────────────────────────────────────────────

/**
 * The order Fit to page tightens things. Each step is tried only when the
 * previous one left the plan over budget, and the ladder stops at the printable
 * safe area — a plan is never squeezed into margins the printer will crop.
 */
export const FIT_STEPS = ['density', 'margins', 'tableFont', 'condense']

/** Smallest table font Fit to page will drop to. Below this it stops asking. */
export const FIT_MIN_TABLE_PT = 8
const FIT_TABLE_PT_STEP = 0.5

/**
 * Apply the next tightening step to a resolved format.
 *
 * Returns `{ format, step, changed }`. `changed === false` means the ladder is
 * exhausted — the caller should fall through to the §3.2 condense pass, or tell
 * the teacher the plan cannot be made to fit without editing.
 *
 * @param {object} format  a resolved format (from `resolveLessonFormat`)
 * @returns {{ format: object, step: string | null, changed: boolean }}
 */
export function nextFitStep(format) {
  const f = resolveLessonFormat(format)

  if (f.density !== 'compact') {
    return { format: resolveLessonFormat({ ...f, density: 'compact' }), step: 'density', changed: true }
  }

  const narrower = MARGIN_PRESET_ORDER.find((name) => MARGIN_PRESETS[name] < f.marginMm)
  if (narrower && MARGIN_PRESETS[narrower] >= MARGIN_SAFE_AREA_MM) {
    return {
      format: resolveLessonFormat({ ...f, marginPreset: narrower, marginMm: MARGIN_PRESETS[narrower] }),
      step: 'margins',
      changed: true,
    }
  }

  const nextPt = Math.round((f.typography.tablePt - FIT_TABLE_PT_STEP) * 10) / 10
  if (nextPt >= FIT_MIN_TABLE_PT) {
    return {
      format: resolveLessonFormat({ ...f, tablePtOverride: nextPt }),
      step: 'tableFont',
      changed: true,
    }
  }

  return { format: f, step: null, changed: false }
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function oneOf(value, allowed, fallback) {
  const v = String(value == null ? '' : value).trim()
  return allowed.includes(v) ? v : fallback
}

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi)
}

/**
 * Accepts the pre-2026-07 Detail Level values so a saved draft or a stored
 * preference from before the Page Budget control existed still opens with a
 * sensible budget instead of silently reverting to the default.
 */
const LEGACY_DETAIL_TO_BUDGET = { simplified: '1', standard: '2', detailed: 'none' }

export function normalizePageBudget(value) {
  const v = String(value == null ? '' : value).trim()
  if (PAGE_BUDGETS.includes(v)) return v
  if (LEGACY_DETAIL_TO_BUDGET[v]) return LEGACY_DETAIL_TO_BUDGET[v]
  return '2'
}

/**
 * Resolve raw studio options into the single object every renderer and the
 * prompt builder read. Idempotent — resolving an already-resolved format
 * returns an equivalent one, which is what lets `nextFitStep` compose.
 *
 * @param {object} [options]
 * @returns {object} frozen resolved format
 */
export function resolveLessonFormat(options = {}) {
  const o = options && typeof options === 'object' ? options : {}

  const pageBudget = normalizePageBudget(o.pageBudget ?? o.detail)
  const preset = TYPOGRAPHY_PRESETS[pageBudget]

  const writingStyle = oneOf(o.writingStyle, WRITING_STYLES, defaultWritingStyle(pageBudget))
  const density = oneOf(o.density, ['comfortable', 'compact'], preset.density)

  // Margins: an explicit millimetre value wins over a preset name, which wins
  // over the budget's default. A teacher who dragged the slider to 7 mm must
  // not have it snapped back to a preset by a later re-resolve.
  const presetName = oneOf(o.marginPreset, MARGIN_PRESET_ORDER, null)
  const rawMm = Number(o.marginMm)
  const marginMm = Number.isFinite(rawMm)
    ? clamp(Math.round(rawMm * 10) / 10, MARGIN_MIN_MM, MARGIN_MAX_MM)
    : presetName
      ? MARGIN_PRESETS[presetName]
      : preset.marginMm

  // An already-resolved format carries its table size under `typography`, not
  // as an override key. Reading both is what makes resolution idempotent — and
  // without it the Fit-to-page ladder re-resolves back to the preset size every
  // step and shrinks the font forever without ever getting smaller.
  const tablePtOverride = Number(
    o.tablePtOverride != null ? o.tablePtOverride : o.typography?.tablePt,
  )
  const tablePt = Number.isFinite(tablePtOverride) && tablePtOverride > 0
    ? clamp(tablePtOverride, FIT_MIN_TABLE_PT, 14)
    : preset.tablePt

  const metrics = DENSITY_METRICS[density]

  const defaults = defaultSections(pageBudget)
  const rawSections = o.sections && typeof o.sections === 'object' ? o.sections : {}
  const sections = {}
  for (const key of OPTIONAL_SECTIONS) {
    sections[key] = typeof rawSections[key] === 'boolean' ? rawSections[key] : defaults[key]
  }

  return Object.freeze({
    pageBudget,
    pageTarget: PAGE_BUDGET_TARGET[pageBudget],
    writingStyle,
    density,
    marginMm,
    marginPreset:
      MARGIN_PRESET_ORDER.find((name) => MARGIN_PRESETS[name] === marginMm) || 'custom',
    environmentDisplay: oneOf(o.environmentDisplay, ENVIRONMENT_DISPLAYS, 'simple'),
    environmentPlace: String(o.environmentPlace || '').trim(),
    headerStyle: oneOf(o.headerStyle, HEADER_STYLES, 'school'),
    ministryLine: String(o.ministryLine || '').trim() || DEFAULT_MINISTRY_LINE,
    typography: Object.freeze({
      bodyPt: preset.bodyPt,
      tablePt,
      cellPaddingPt: density === 'compact' ? Math.min(preset.cellPaddingPt, 2) : preset.cellPaddingPt,
      lineHeight: metrics.lineHeight,
      cellSpaceAfterPt: metrics.cellSpaceAfterPt,
      sectionGapPt: metrics.sectionGapPt,
    }),
    wordBudgets: WORD_BUDGETS[pageBudget],
    sections: Object.freeze(sections),
  })
}

/**
 * The shape persisted to `teacherPreferences.lessonPlanFormat`. Deliberately
 * the RAW choices, not the resolved object — a stored resolved format would
 * pin last month's typography table into a teacher's profile and never pick up
 * a preset change.
 * @param {object} format
 * @returns {object}
 */
export function toStoredPreferences(format) {
  const f = resolveLessonFormat(format)
  return {
    pageBudget: f.pageBudget,
    writingStyle: f.writingStyle,
    density: f.density,
    marginMm: f.marginMm,
    environmentDisplay: f.environmentDisplay,
    headerStyle: f.headerStyle,
    ministryLine: f.ministryLine === DEFAULT_MINISTRY_LINE ? '' : f.ministryLine,
    sections: { ...f.sections },
  }
}

// ── Studio defaults ───────────────────────────────────────────────────────────

/**
 * The studio's starting Format & Options.
 *
 * Everything that decides how much paper a plan uses is derived from the page
 * budget rather than written out twice — a second copy of "narrow margins at 1
 * page" here would drift from the presets the exporters read.
 */
export function initialFormatOptions(pageBudget = '2') {
  const budget = normalizePageBudget(pageBudget)
  const preset = TYPOGRAPHY_PRESETS[budget]
  return {
    pageBudget: budget,
    writingStyle: defaultWritingStyle(budget),
    format: 'modern', // 'modern' | 'classic' | 'official'
    illustrations: 'none', // defaults to 'none' while the Illustrations bar is hidden (see SHOW_ILLUSTRATIONS in FormatOptionsForm)
    environmentDisplay: 'simple',
    environmentPlace: '',
    headerStyle: 'school',
    ministryLine: '',
    marginMm: preset.marginMm,
    density: preset.density,
    sections: defaultSections(budget),
    advanced: {
      compactMetadata: true,
      includeEnrolment: false,
      includeAttendance: false,
      autoIllustrations: false,
      localLanguage: false,
    },
  }
}

/**
 * Root state hook for the Lesson Plan Studio.
 * Returns all form state and setters used by StudioShell → LessonPlanWizard → sections.
 */
