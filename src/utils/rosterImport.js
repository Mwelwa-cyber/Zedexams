/**
 * src/utils/rosterImport.js
 *
 * Class-register roster bulk-import primitives. Pure module — no React,
 * no Firebase, no DOM — so the node test suite can import it directly.
 *
 * Responsibilities:
 *   1. Define the canonical roster CSV format teachers download as a template.
 *   2. Turn pasted/CSV text (and, via rosterXlsx.js, an .xlsx grid) into
 *      shape-checked, normalised roster entries with per-row errors/warnings
 *      the import modal can surface inline before committing.
 *
 * The official Class Register roster fields:
 *   learnerNumber, fullName, gender ('M'|'F'|'other'), parentPhone (optional),
 *   status ('active'|'transferred'|'inactive').
 *
 * Three input shapes are accepted, in order of preference:
 *   - HEADER mode  — first row names the columns (template download). Columns
 *     can be in any order and use friendly synonyms ("No.", "Pupil name", …).
 *   - POSITIONAL   — no header; columns map by position. A leading numeric
 *     column is treated as the learner number.
 *   - BARE NAMES   — one full name per line (the most common teacher paste).
 *     A leading "1." / "1)" / "1 -" numbering is stripped into learnerNumber.
 *
 * Excel paste arrives tab-separated; CSV upload arrives comma-separated. Both
 * funnel through rowsToRoster() once split into a string grid.
 */

import { parseCsv } from './csvQuizImport.js'
import { LEARNER_STATUS_VALUES } from './learnerStatus.js'

// ── Canonical CSV template ───────────────────────────────────────

export const ROSTER_HEADERS = [
  'learnerNumber',
  'admissionNumber',
  'fullName',
  'gender',
  'parentPhone',
  'admissionDate',
  'status',
]

const TEMPLATE_EXAMPLE_ROWS = [
  ['1', 'ADM-001', 'Mary Banda', 'F', '0977123456', '2026-01-12', 'active'],
  ['2', 'ADM-002', 'John Phiri', 'M', '', '2026-01-12', 'active'],
  ['3', 'ADM-003', 'Grace Mwale', 'F', '0966555444', '2026-05-04', 'transferred'],
]

function encodeCsvRow(values) {
  return values.map((v) => {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }).join(',')
}

/** A download-ready CSV: header row + a few example learners. */
export function buildRosterCsvTemplate() {
  return [ROSTER_HEADERS, ...TEMPLATE_EXAMPLE_ROWS].map(encodeCsvRow).join('\n') + '\n'
}

// ── Field normalisers ────────────────────────────────────────────

export const GENDERS = ['M', 'F', 'other']

/**
 * The enrolment-status vocabulary, owned by ./learnerStatus.js. Re-exported
 * here because the importer and the schema were written against this name; the
 * list itself is declared once, so widening it does not have to be remembered
 * in two files.
 */
export const ROSTER_STATUSES = LEARNER_STATUS_VALUES

/** M/Male/Boy → 'M'; F/Female/Girl → 'F'; explicit other → 'other'; blank → null. */
export function normalizeGender(raw) {
  const k = String(raw ?? '').trim().toLowerCase()
  if (!k) return null
  if (['m', 'male', 'boy', 'b'].includes(k)) return 'M'
  if (['f', 'female', 'girl', 'g'].includes(k)) return 'F'
  return 'other'
}

/**
 * One of LEARNER_STATUS_VALUES, from whatever a teacher wrote in the column;
 * blank → 'active'. An unrecognised word reads as 'active' rather than being
 * rejected: a class list is imported to get learners onto the register, and
 * the worst outcome of guessing here is a learner who is expected in class and
 * is not, which the teacher sees on the very first day and can correct.
 */
export function normalizeStatus(raw) {
  const k = String(raw ?? '').trim().toLowerCase()
  if (!k) return 'active'
  if (['active', 'present', 'enrolled', 'enroled', 'a'].includes(k)) return 'active'
  if (['transferred', 'transfer', 'moved', 'left', 't'].includes(k)) return 'transferred'
  if (['inactive', 'dropped', 'withdrawn', 'withdrew', 'absent', 'i', 'w'].includes(k)) return 'withdrawn'
  if (['graduated', 'graduate', 'completed', 'g'].includes(k)) return 'graduated'
  if (['deceased', 'died', 'late'].includes(k)) return 'deceased'
  return 'active'
}

/**
 * A date a teacher typed, as 'YYYY-MM-DD', or null.
 *
 * Zambian school paperwork is written day-first, so an ambiguous 03/04/2026 is
 * read as 3 April — the opposite of the JS Date default, which would silently
 * file a third of every class list under the wrong month. Only an unambiguous
 * ISO string (or a first component above 12) is read any other way.
 */
export function normalizeAdmissionDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (iso) return isoOrNull(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const parts = /^(\d{1,4})[/.\-\s](\d{1,2})[/.\-\s](\d{2,4})$/.exec(s)
  if (!parts) return null
  const [, a, b, c] = parts
  // yyyy/mm/dd when the first component is a full year.
  if (a.length === 4) return isoOrNull(Number(a), Number(b), Number(c))
  const year = c.length === 2 ? 2000 + Number(c) : Number(c)
  // dd/mm/yyyy unless the first component cannot be a day-of-month.
  if (Number(a) > 12) return isoOrNull(year, Number(b), Number(a))
  return isoOrNull(year, Number(b), Number(a))
}

function isoOrNull(year, month, day) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  // Rejects 31 April rather than rolling it forward into May.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * An admission number as the school writes it, upper-cased with inner runs of
 * whitespace collapsed. Punctuation is KEPT — "ADM/2026/014" and "ADM-001" are
 * how Zambian schools actually number learners, and stripping it would make
 * two genuinely different learners compare equal.
 */
export function normalizeAdmissionNumber(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  return s ? s.slice(0, 40) : null
}

/** Keep a leading '+' and digits; collapse spaces. Returns null when empty. */
export function normalizePhone(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const cleaned = s.replace(/[^\d+]/g, '')
  return cleaned || null
}

// ── Header detection + column mapping ────────────────────────────

// Admission number is matched BEFORE learner number, and learner number no
// longer answers to "Adm No." — the two are different facts about a learner
// (position in the list vs. the school's permanent identifier for them) and
// collapsing them meant a class list carrying both lost one of them. A file
// whose only numeric column is headed "Adm No." therefore lands in
// admissionNumber, which is where the register, the duplicate check and the
// printed page all look for it.
const HEADER_PATTERNS = {
  admissionNumber: /^(adm(ission)?\s*(no\.?|number|#)?|admission|reg(istration)?\s*(no\.?|number)?|pupil\s*(no\.?|number)|student\s*(no\.?|id)|nrc)$/i,
  learnerNumber: /^(learner\s*(no\.?|number)?|no\.?|sn|s\/n|#|number|index|position)$/i,
  fullName: /^(full\s*name|name|pupil(\s*name)?|learner\s*name|student(\s*name)?)$/i,
  gender: /^(gender|sex|m\/f)$/i,
  parentPhone: /^(parent\s*phone|phone|contact|mobile|guardian(\s*phone)?|parent(\s*contact)?|cell)$/i,
  admissionDate: /^(admission\s*date|date\s*(of\s*)?admi(tted|ssion)|date\s*joined|joined(\s*on)?|enrol(l)?ed(\s*on)?)$/i,
  status: /^(status|state|enrol(l)?ment)$/i,
}

/**
 * If the first row looks like a header, return a { field: colIndex } map.
 * Returns null when no recognised header token is present.
 */
function detectHeaderMap(firstRow) {
  if (!Array.isArray(firstRow)) return null
  const map = {}
  let matched = 0
  firstRow.forEach((cell, i) => {
    const token = String(cell ?? '').trim()
    for (const [field, re] of Object.entries(HEADER_PATTERNS)) {
      if (map[field] == null && re.test(token)) {
        map[field] = i
        matched += 1
        break
      }
    }
  })
  // Require a name column to trust the header — otherwise a data row whose
  // first cell happens to be "1" or a name could be mis-read as a header.
  return matched >= 1 && map.fullName != null ? map : null
}

/** Heuristic mapping when there is no header row. */
function inferPositionalMap(grid) {
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0)
  if (maxCols <= 1) return { fullName: 0 }
  // If the first column is numeric on most rows, treat it as the number.
  const numericFirst = grid.filter((r) => /^\d+$/.test(String(r[0] ?? '').trim())).length
  const firstIsNumber = numericFirst >= Math.ceil(grid.length / 2)
  return firstIsNumber
    ? { learnerNumber: 0, fullName: 1, gender: 2, parentPhone: 3, status: 4 }
    : { fullName: 0, gender: 1, parentPhone: 2, status: 3 }
}

// ── Row → entry ──────────────────────────────────────────────────

// "1. Mary Banda" / "1) Mary" / "1 - Mary" / "1  Mary" → { number:'1', name:'Mary…' }
const LEADING_NUMBER_RE = /^\s*(\d{1,4})\s*[.)\-:]?\s+(.+)$/

function cellAt(cells, idx) {
  if (idx == null) return ''
  return String(cells[idx] ?? '').trim()
}

/**
 * Convert one parsed row (string[]) into a preview entry. Never throws.
 * `bareName` = single-column mode, where a leading number is split off the
 * name. Returns { entry, status:'ok'|'warning'|'error', errors[], warnings[] }.
 */
export function rowToRosterEntry(cells, mapping, { bareName = false } = {}) {
  const errors = []
  const warnings = []

  let learnerNumber = cellAt(cells, mapping.learnerNumber)
  let fullName = cellAt(cells, mapping.fullName)

  if (bareName && !learnerNumber) {
    const m = LEADING_NUMBER_RE.exec(fullName)
    if (m) {
      learnerNumber = m[1]
      fullName = m[2].trim()
    }
  }

  if (!fullName) errors.push('Full name is required')

  const genderRaw = cellAt(cells, mapping.gender)
  const gender = normalizeGender(genderRaw)
  if (genderRaw && gender === 'other' && !['other', 'o'].includes(genderRaw.toLowerCase())) {
    warnings.push(`Unrecognised gender "${genderRaw}" — saved as "other"`)
  }

  const parentPhone = normalizePhone(cellAt(cells, mapping.parentPhone))
  const status = normalizeStatus(cellAt(cells, mapping.status))
  const admissionNumber = normalizeAdmissionNumber(cellAt(cells, mapping.admissionNumber))

  const admissionDateRaw = cellAt(cells, mapping.admissionDate)
  const admissionDate = normalizeAdmissionDate(admissionDateRaw)
  // A date we could not read is reported, never guessed at — an admission date
  // is what decides which register days show N/A for this learner.
  if (admissionDateRaw && !admissionDate) {
    warnings.push(`Admission date "${admissionDateRaw}" could not be read — left blank`)
  }

  const entry = {
    learnerNumber: learnerNumber || '',
    admissionNumber,
    fullName,
    gender,
    parentPhone,
    admissionDate,
    status,
  }
  const computedStatus = errors.length ? 'error' : (warnings.length ? 'warning' : 'ok')
  return { entry, status: computedStatus, errors, warnings }
}

// ── Grid → preview rows ──────────────────────────────────────────

/**
 * Turn a raw string grid (already split into rows × cells) into preview rows.
 * Used by both the text path (parseRosterText) and the .xlsx path
 * (rosterXlsx.js → here) so the mapping + validation live in one place.
 */
export function rowsToRoster(grid) {
  const cleaned = (Array.isArray(grid) ? grid : [])
    .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []))
    .filter((r) => r.some((c) => c !== ''))

  if (cleaned.length === 0) {
    return { headerDetected: false, rows: [], summary: { total: 0, ok: 0, warning: 0, error: 0 } }
  }

  const headerMap = detectHeaderMap(cleaned[0])
  let mapping
  let dataRows
  let bareName = false
  if (headerMap) {
    mapping = headerMap
    dataRows = cleaned.slice(1)
  } else {
    mapping = inferPositionalMap(cleaned)
    dataRows = cleaned
    bareName = mapping.fullName === 0 && mapping.learnerNumber == null
      && cleaned.every((r) => r.length <= 1)
  }

  const rows = dataRows.map((cells, i) => ({
    index: i + 1,
    raw: cells,
    ...rowToRosterEntry(cells, mapping, { bareName }),
  }))

  const summary = { total: rows.length, ok: 0, warning: 0, error: 0 }
  rows.forEach((r) => { summary[r.status] += 1 })

  return { headerDetected: Boolean(headerMap), rows, summary }
}

/**
 * Parse pasted text or uploaded CSV. Excel paste is tab-separated; CSV is
 * comma-separated (RFC 4180 via parseCsv); a plain list is one name per line.
 */
export function parseRosterText(text) {
  const normalised = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  if (!normalised.trim()) {
    return { headerDetected: false, rows: [], summary: { total: 0, ok: 0, warning: 0, error: 0 } }
  }
  const hasTab = normalised.includes('\t')
  const grid = hasTab
    ? normalised.split('\n').map((line) => line.split('\t'))
    : parseCsv(normalised)
  return rowsToRoster(grid)
}

/** Convenience for callers that only want the committable entries. */
export function validRosterEntries(parsed) {
  return parsed.rows.filter((r) => r.status !== 'error').map((r) => r.entry)
}

// ── Duplicate detection ──────────────────────────────────────────

/**
 * Normalised key for duplicate detection: trimmed, inner whitespace collapsed,
 * lower-cased — so "  Mary   Banda " and "mary banda" match.
 */
export function rosterNameKey(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Split incoming entries into the genuinely-new ones vs. duplicates of the
 * existing roster (or of each other within the same import). A duplicate is an
 * exact account match (same linkedUid) OR an exact normalised-name match.
 * `existing` is the current roster as [{ fullName, linkedUid }].
 *
 * Name matching can in theory drop a legitimate namesake, but re-importing a
 * class list silently DOUBLING every learner is the far more common and
 * damaging failure — and the duplicate count is surfaced to the teacher, so a
 * real namesake can be re-added by hand.
 *
 * Returns { fresh, duplicates } where `duplicates` is a count.
 */
export function partitionNewRosterEntries(entries, existing = []) {
  const seenNames = new Set()
  const seenUids = new Set()
  const seenAdmission = new Set()
  for (const e of (Array.isArray(existing) ? existing : [])) {
    const k = rosterNameKey(e?.fullName)
    if (k) seenNames.add(k)
    if (e?.linkedUid) seenUids.add(e.linkedUid)
    const adm = normalizeAdmissionNumber(e?.admissionNumber)
    if (adm) seenAdmission.add(adm)
  }
  const fresh = []
  let duplicates = 0
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const uid = entry?.linkedUid || null
    const nameKey = rosterNameKey(entry?.fullName)
    // An admission number is the school's own identifier, so it is the
    // strongest signal available here — two rows carrying the same one are the
    // same learner even when the name was spelled differently on each page.
    const adm = normalizeAdmissionNumber(entry?.admissionNumber)
    const isDup = (uid && seenUids.has(uid))
      || (adm && seenAdmission.has(adm))
      || (nameKey && seenNames.has(nameKey))
    if (isDup) { duplicates += 1; continue }
    if (uid) seenUids.add(uid)
    if (nameKey) seenNames.add(nameKey)
    if (adm) seenAdmission.add(adm)
    fresh.push(entry)
  }
  return { fresh, duplicates }
}
