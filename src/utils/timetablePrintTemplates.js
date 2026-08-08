/**
 * Print templates for a class timetable — the document a head of school
 * actually signs.
 *
 * Two, and the difference between them is not decoration:
 *
 *   government  The Ministry format. Days down the LEFT, times across the
 *               top; no colour at all (schools print monochrome and
 *               photocopy the master); the title written the official way,
 *               "GRADE FOUR (4) A TIME TABLE"; BREAK and LUNCH spelled one
 *               letter per day-row down their own column — the recognised
 *               Zambian convention; signature lines and a clear space for
 *               the school stamp.
 *   modern      The same schedule with the palette's colour fills, merged
 *               doubles and an optional legend — what a private school
 *               hands out.
 *
 * A template only decides PRESENTATION. Both read the same saved schedule
 * and both honour day-specific structure (a half-day Friday prints its
 * shorter row) and assembly-day cells.
 *
 * Pure and DOM-free so `node` can unit test it
 * (scripts/test-timetable-print-templates.mjs).
 */

export const PRINT_TEMPLATES = [
  {
    id: 'government',
    label: 'Government / Ministry official',
    description: 'Black-and-white Ministry format — days down the left, official title, signature lines and stamp space.',
    layout: 'days-as-rows',
    colour: false,
    spellBands: true,
    ministryHeader: true,
    signatures: true,
    defaultCellText: 'abbrev',
  },
  {
    id: 'modern',
    label: 'Modern / colour',
    description: 'Colour-filled subject cells, merged double periods and an optional key.',
    layout: null,          // follows the teacher's print-orientation choice
    colour: true,
    spellBands: false,
    ministryHeader: false,
    signatures: false,
    defaultCellText: 'auto',
  },
]

export const DEFAULT_PRINT_TEMPLATE = 'modern'

/** Print orientation defaults to days-left: both reference documents (a
 * government primary timetable and a private one) use it, and it is what a
 * Zambian teacher recognises on paper. The on-screen editor keeps its own
 * days-across-the-top default. */
export const DEFAULT_PRINT_LAYOUT = 'days-as-rows'

export const CELL_TEXT_MODES = [
  { id: 'auto', label: 'Automatic', hint: 'Full names when the cells are wide enough, abbreviations when they are not.' },
  { id: 'full', label: 'Full names', hint: 'Always print the full subject name.' },
  { id: 'abbrev', label: 'Abbreviations', hint: 'Always print the short codes, with a key underneath.' },
]

export function getPrintTemplate(id) {
  return PRINT_TEMPLATES.find((t) => t.id === id) || PRINT_TEMPLATES.find((t) => t.id === DEFAULT_PRINT_TEMPLATE)
}

export const MINISTRY_HEADER_TEXT = 'MINISTRY OF EDUCATION'

/* ── The official title ───────────────────────────────────────── */

const ONES = [
  'ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
  'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY',
]

/** 4 → "FOUR". Only the range a school grade can occupy is needed. */
export function numberToWords(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v) || v < 0 || v > 20) return ''
  return ONES[v]
}

/**
 * The class/stream token printed after the grade — "A" from "Grade 4 A",
 * "4A" or a plain "A"; "BLUE" from "Grade 5 Blue". Returns '' when the class
 * name carries nothing beyond the grade itself.
 */
export function streamFromClassName(className, grade) {
  const raw = String(className || '').trim()
  if (!raw) return ''
  const gradeDigits = String(grade || '').match(/(\d{1,2})/)?.[1] || ''
  // Strip the grade wording so only the stream token is left.
  let rest = raw
    .replace(/\bgrades?\b/gi, ' ')
    .replace(/\bforms?\b/gi, ' ')
    .replace(/\bclass\b/gi, ' ')
  if (gradeDigits) {
    // "4A" → " A"; "Grade 4 A" → " A"
    rest = rest.replace(new RegExp(`\\b${gradeDigits}\\b`, 'g'), ' ')
    rest = rest.replace(new RegExp(`\\b${gradeDigits}(?=[A-Za-z])`, 'g'), ' ')
  }
  const token = rest.replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean).join(' ')
  return token.toUpperCase()
}

/**
 * The Ministry title format: grade in words AND numeral, then the stream.
 *
 *   { grade: 'G4', className: 'Grade 4 A' } → 'GRADE FOUR (4) A TIME TABLE'
 *   { grade: 'G4' }                        → 'GRADE FOUR (4) TIME TABLE'
 *
 * A grade with no numeral (Early Childhood bands) falls back to the class
 * name so the title still names the class rather than printing "GRADE  ()".
 */
export function officialTimetableTitle({ grade, className } = {}) {
  const digits = String(grade || '').match(/(\d{1,2})/)?.[1]
  const stream = streamFromClassName(className, grade)
  if (!digits) {
    const fallback = String(className || '').trim().toUpperCase()
    return fallback ? `${fallback} TIME TABLE` : 'TIME TABLE'
  }
  const words = numberToWords(Number(digits))
  const head = words ? `GRADE ${words} (${digits})` : `GRADE ${digits}`
  return [head, stream, 'TIME TABLE'].filter(Boolean).join(' ')
}

/* ── Cell text ────────────────────────────────────────────────── */

/**
 * Full names or abbreviations for this grid.
 *
 * 'auto' is a MEASUREMENT, not a preference: once a row of day columns is
 * narrower than roughly 22 mm of an A4 landscape page, a full subject name
 * cannot be read and the abbreviations (with their key) are the honest
 * choice. The threshold is expressed in columns because that is what the
 * renderers actually know before layout.
 */
export function resolveCellTextMode({ mode = 'auto', columnCount = 0, template } = {}) {
  const tpl = getPrintTemplate(template)
  const effective = mode === 'auto' && tpl?.defaultCellText && tpl.defaultCellText !== 'auto'
    ? tpl.defaultCellText
    : mode
  if (effective === 'full' || effective === 'abbrev') return effective
  return columnCount > 8 ? 'abbrev' : 'full'
}

/* ── Vertically spelled band columns ──────────────────────────── */

/**
 * BREAK spelled down its column, one letter per day-row.
 *
 * Both reference schools do this, and it only works in the days-left
 * orientation where a band column really does span every day row. Longer
 * words than there are days are truncated; shorter ones are padded with ''
 * so the column still lines up with the rows.
 */
export function verticalBandLetters(word, rowCount) {
  const letters = String(word || '').replace(/\s+/g, '').toUpperCase().split('')
  const n = Math.max(0, Math.round(Number(rowCount) || 0))
  const out = []
  for (let i = 0; i < n; i += 1) out.push(letters[i] ?? '')
  return out
}

/**
 * Should this band column be spelled vertically? Only when the template
 * asks for it, the layout puts days down the left, and the column really
 * does span every day row (one letter per row is meaningless otherwise).
 */
export function shouldSpellBand({ template, layout, spellBands, dayCount, wordLength }) {
  const tpl = getPrintTemplate(template)
  const on = spellBands === undefined ? tpl?.spellBands : spellBands
  if (!on) return false
  if (layout !== 'days-as-rows') return false
  return dayCount >= 2 && wordLength >= 2
}

/* ── One resolution, four renderers ───────────────────────────── */

/**
 * The template, orientation and cell text a printed timetable actually
 * renders with. Resolved ONCE here and consumed by the preview, the PDF,
 * the Word export and the Excel export, so a teacher cannot preview one
 * document and download another.
 *
 * Deliberately takes the grid MODEL rather than the artifact: the column
 * count that decides 'auto' cell text is a property of the built grid.
 */
export function resolvePrintSettings(model, { template } = {}) {
  const prefs = model?.displayPreferences || {}
  const tpl = getPrintTemplate(template || prefs.printTemplate)
  const layout = tpl.layout || prefs.printLayout || prefs.timetableLayout || DEFAULT_PRINT_LAYOUT
  const columnCount = layout === 'days-as-rows'
    ? (model?.rows?.length || 0) + 1
    : (model?.days?.length || 0) + 1
  const cellText = resolveCellTextMode({
    mode: prefs.cellText || 'auto',
    columnCount,
    template: tpl.id,
  })
  return {
    template: tpl,
    layout,
    columnCount,
    cellText,
    colour: tpl.colour,
    ministryHeader: tpl.ministryHeader && prefs.showMinistryHeader !== false,
    signatures: tpl.signatures,
    showLegend: cellText === 'abbrev' && prefs.showLegend !== false,
    spellBands: shouldSpellBand({
      template: tpl.id,
      layout,
      spellBands: prefs.spellBands,
      dayCount: model?.days?.length || 0,
      wordLength: 5,
    }),
  }
}
