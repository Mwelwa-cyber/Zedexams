/**
 * schemeFormat — the single source of truth for a scheme of work's (and its
 * downstream weekly forecast's) columns per curriculum.
 *
 * Zambian schools run two curricula side by side and their scheme documents
 * are NOT the same shape:
 *
 *   • CBC — Competency-Based Curriculum (the 2023 framework). The official
 *     CDC 9-column grid:
 *       WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES | LEARNING ACTIVITIES |
 *       EXPECTED STANDARD | METHODS | T/L AIDS | REF
 *   • OBC — Outcome-Based Curriculum (the 2013 "Previous" framework). A leaner
 *     7-column grid with NO learning-activities and NO expected-standard
 *     columns, and "SPECIFIC OUTCOMES" in place of "SPECIFIC COMPETENCES":
 *       WEEK | TOPIC | SUBTOPIC | SPECIFIC OUTCOMES | METHODS | T/L AIDS | REF
 *
 * The two must never be mixed. To keep the on-screen view, the DOCX + PDF
 * exporters, and the in-studio editable table perfectly in step, they all read
 * their columns from `schemeColumns()` here — one definition, four consumers.
 *
 * IMPORTANT: the stored week keys are identical for both curricula.
 * `specificCompetences` carries the specific *outcomes* under OBC; an OBC week
 * simply leaves `learningActivities: []` and `expectedStandard: ''`. That means
 * a scheme can be re-labelled between curricula without a data migration.
 *
 * Dependency-free (no React, no DOM) so `node src/utils/schemeFormat.test.js`
 * can unit-test it, per repo convention.
 */

/** The two curricula, as stored on `header.curriculum`. */
export const SCHEME_CURRICULA = ['cbc', 'obc']

/**
 * Normalise any curriculum-ish value to 'cbc' | 'obc'. Accepts the studio's
 * curriculum selector vocabulary ('previous'), the framework year ('2013'),
 * and the stored 'obc'/'cbc'. Everything else (incl. undefined) is CBC — the
 * historical default, which is what every legacy 9-column scheme is.
 */
export function normalizeCurriculum(value) {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'obc' || v === 'previous' || v === '2013' || v === 'outcome' || v === 'outcome-based') {
    return 'obc'
  }
  return 'cbc'
}

/**
 * The curriculum a saved scheme output is in. Reads `header.curriculum` first;
 * falls back to inferring from a stored framework/curriculum hint; defaults to
 * CBC for older docs that predate the field.
 */
export function schemeCurriculum(scheme) {
  const h = scheme?.header || {}
  if (h.curriculum) return normalizeCurriculum(h.curriculum)
  if (h.framework) return normalizeCurriculum(h.framework)
  if (scheme?.curriculum) return normalizeCurriculum(scheme.curriculum)
  return 'cbc'
}

/** Human label for a curriculum ('CBC' | 'OBC'). */
export function curriculumLabel(curriculum) {
  return normalizeCurriculum(curriculum) === 'obc' ? 'OBC' : 'CBC'
}

/** Long human label ('Competency-Based Curriculum (CBC)' etc). */
export function curriculumLongLabel(curriculum) {
  return normalizeCurriculum(curriculum) === 'obc'
    ? 'Outcome-Based Curriculum (OBC)'
    : 'Competency-Based Curriculum (CBC)'
}

/** The template name shown in the preview card ('CBC Scheme' | 'OBC Scheme'). */
export function templateLabel(curriculum) {
  return `${curriculumLabel(curriculum)} Scheme`
}

// Column descriptors. `key` maps to a week field; `type` drives the renderer:
//   'week' → the week number, 'text' → a single string, 'list' → string[].
// `width` is the printed-table percentage (columns sum to ~100 for each set).
const WEEK_COL = { key: 'week', label: 'WEEK', type: 'week', width: 4 }
const TOPIC_COL = { key: 'topic', label: 'TOPIC', type: 'text', width: 11 }
const SUBTOPIC_COL = { key: 'subtopic', label: 'SUBTOPIC', type: 'text', width: 12 }
const METHODS_COL = { key: 'methods', label: 'METHODS', type: 'list', width: 9 }
const TLAIDS_COL = { key: 'tlAids', label: 'T/L AIDS', type: 'list', width: 9 }
const REF_COL = { key: 'references', label: 'REF', type: 'text', width: 6 }

const CBC_COLUMNS = [
  WEEK_COL,
  TOPIC_COL,
  SUBTOPIC_COL,
  { key: 'specificCompetences', label: 'SPECIFIC COMPETENCES', type: 'list', width: 17 },
  { key: 'learningActivities', label: 'LEARNING ACTIVITIES', type: 'list', width: 20 },
  { key: 'expectedStandard', label: 'EXPECTED STANDARD', type: 'text', width: 13 },
  METHODS_COL,
  TLAIDS_COL,
  REF_COL,
]

const OBC_COLUMNS = [
  { ...WEEK_COL, width: 5 },
  { ...TOPIC_COL, width: 15 },
  { ...SUBTOPIC_COL, width: 16 },
  // Same storage key as CBC, but labelled "SPECIFIC OUTCOMES" under OBC.
  { key: 'specificCompetences', label: 'SPECIFIC OUTCOMES', type: 'list', width: 30 },
  { ...METHODS_COL, width: 12 },
  { ...TLAIDS_COL, width: 12 },
  { ...REF_COL, width: 10 },
]

/**
 * The ordered column spec for a curriculum. Pass a raw curriculum value (it is
 * normalised) or a whole scheme's resolved curriculum. Returns fresh copies so
 * callers can safely tweak widths without mutating the shared definition.
 */
export function schemeColumns(curriculum) {
  const cols = normalizeCurriculum(curriculum) === 'obc' ? OBC_COLUMNS : CBC_COLUMNS
  return cols.map((c) => ({ ...c }))
}

/** True when this curriculum omits Learning Activities + Expected Standard. */
export function isOutcomeBased(curriculum) {
  return normalizeCurriculum(curriculum) === 'obc'
}

/* ── Cell value hygiene ───────────────────────────────────────────────────
 * A generator occasionally leaks a filler phrase ("I don't know", "N/A", …)
 * into a cell when it can't source a value. On an official printed scheme of
 * work that reads as an error, so the view + both exporters run every cell
 * through these helpers and render an em-dash instead. Kept here (dependency-
 * free) so the on-screen view, the DOCX and the PDF all strip the same set.
 */
const FILLER_CELL = /^\s*(i\s*(do\s*not|don'?t|dont)\s*know|i'?m\s*not\s*sure|not\s*sure|unknown|not\s*applicable|n\s*\/?\s*a|tbd|to\s*be\s*(decided|determined|confirmed))\s*[.!]?\s*$/i

/** Trim a single cell string; blank out obvious filler ("I don't know"). */
export function cleanCellText(value) {
  if (value === null || value === undefined) return ''
  const s = String(value).trim()
  if (!s) return ''
  // Match against a copy with curly apostrophes normalised, but return the
  // original text so real content keeps its typography.
  if (FILLER_CELL.test(s.replace(/[’‘`]/g, "'"))) return ''
  return s
}

/** Clean a list cell: drop empties + filler entries, keep real ones in order. */
export function cleanCellList(items) {
  const list = Array.isArray(items) ? items : (items === null || items === undefined || items === '' ? [] : [items])
  return list.map((i) => cleanCellText(i)).filter(Boolean)
}

/* ── Weekly Forecast columns ──────────────────────────────────────────────
 * The forecast repeats a scheme week across the teaching DAYS, so it carries a
 * DAY column and singular field names (specificCompetence, not the array). It
 * shares the CBC-vs-OBC divergence: OBC drops LEARNING ACTIVITY + EXPECTED
 * STANDARD and relabels SPECIFIC COMPETENCE → SPECIFIC OUTCOME.
 */
const FORECAST_CBC_COLUMNS = [
  { key: 'day', label: 'DAY', type: 'text', width: 4 },
  { key: 'topic', label: 'TOPIC', type: 'text', width: 10 },
  { key: 'subtopic', label: 'SUB-TOPIC / TO BE DONE', type: 'text', width: 12 },
  { key: 'specificCompetence', label: 'SPECIFIC COMPETENCE', type: 'text', width: 15 },
  { key: 'learningActivities', label: 'LEARNING ACTIVITY', type: 'list', width: 20 },
  { key: 'expectedStandard', label: 'EXPECTED STANDARD', type: 'text', width: 13 },
  { key: 'resources', label: 'T/L RESOURCES', type: 'list', width: 12 },
  { key: 'remarks', label: 'REMARKS / COMMENTS ON PROGRESS', type: 'text', width: 10 },
]

const FORECAST_OBC_COLUMNS = [
  { key: 'day', label: 'DAY', type: 'text', width: 5 },
  { key: 'topic', label: 'TOPIC', type: 'text', width: 14 },
  { key: 'subtopic', label: 'SUB-TOPIC / TO BE DONE', type: 'text', width: 16 },
  { key: 'specificCompetence', label: 'SPECIFIC OUTCOME', type: 'text', width: 28 },
  { key: 'resources', label: 'T/L RESOURCES', type: 'list', width: 16 },
  { key: 'remarks', label: 'REMARKS / COMMENTS ON PROGRESS', type: 'text', width: 17 },
]

/** The ordered per-day column spec for a weekly forecast in this curriculum. */
export function forecastColumns(curriculum) {
  const cols = normalizeCurriculum(curriculum) === 'obc' ? FORECAST_OBC_COLUMNS : FORECAST_CBC_COLUMNS
  return cols.map((c) => ({ ...c }))
}

/** The curriculum a saved forecast is in (mirrors schemeCurriculum). */
export function forecastCurriculum(forecast) {
  const h = forecast?.header || {}
  if (h.curriculum) return normalizeCurriculum(h.curriculum)
  if (h.framework) return normalizeCurriculum(h.framework)
  return 'cbc'
}
