/**
 * Subject abbreviations + the printed legend.
 *
 * Real Zambian timetables are written in codes — MATHS, ENG, SCIE, ZIL,
 * TECH, S/S — because a hand-ruled cell is about two centimetres wide. The
 * studio derives the same codes automatically so a printed grid reads like
 * the one already pinned to the classroom wall, and prints a key underneath
 * so nothing is guessed at.
 *
 * Derivation is deliberately explicit for the official learning areas
 * (a pattern list, checked in order) and falls back to initials for anything
 * a school adds itself. Every abbreviation stays editable in the Subjects
 * step — this only decides the starting value.
 *
 * Pure and DOM-free so `node` can unit test it
 * (scripts/test-subject-abbreviations.mjs).
 */

/* Ordered — the FIRST match wins, so the more specific pattern comes first.
 * "Literacy and Language — English Language" must read ENG, not LIT, because
 * it is the Lower Primary English area; plain "Literacy" (a school subject
 * some private schools add) reads LIT. */
const PATTERNS = [
  [/\bhome\s*econ/i, 'HE'],
  [/\bexpressive\s*arts?\b/i, 'EA'],
  [/\btechnolog/i, 'TECH'],
  [/\bsocial\s*stud/i, 'SS'],
  [/\bzambian\b/i, 'ZIL'],
  [/\bsign\s*language\b/i, 'SIGN'],
  [/\bbraille\b/i, 'BRL'],
  [/\bengl?ish\b/i, 'ENG'],
  [/\bmath/i, 'MATHS'],
  [/\bscien/i, 'SCIE'],
  [/\bliterac/i, 'LIT'],
  [/\bcreative\b/i, 'CTS'],
  [/\bdaily\s*living\b/i, 'ADL'],
  [/\bphysical\s*education\b/i, 'PE'],
  [/\breligious\b/i, 'RE'],
  [/\bagricultur/i, 'AGRIC'],
  [/\bcomputer|\bict\b/i, 'ICT'],
  [/\bgeograph/i, 'GEOG'],
  [/\bhistor/i, 'HIST'],
  [/\bcivic/i, 'CIVIC'],
  [/\bbusiness\b/i, 'BUS'],
]

const STOP_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'a', 'an', 'in', 'with'])

/** Initials of the significant words, e.g. "Life Skills Club" → "LSC". */
function initials(label) {
  const words = String(label)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()))
  if (!words.length) return ''
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase()
  return words.map((w) => w[0]).join('').slice(0, 5).toUpperCase()
}

/**
 * The abbreviation a subject starts with. Language names are handled by the
 * caller passing the DISPLAY name (a school teaching Chinyanja passes
 * "Chinyanja" and gets CHINY, not ZIL) — see resolveSubjectAbbreviation.
 */
export function deriveAbbreviation(label) {
  const text = String(label || '').trim()
  if (!text) return ''
  for (const [pattern, code] of PATTERNS) {
    if (pattern.test(text)) return code
  }
  return initials(text)
}

/**
 * The abbreviation for one subject row, honouring (in order): the teacher's
 * own edit, the display name a language provision was relabelled to, then
 * the canonical subject name.
 *
 * @param {{abbreviation?:string, displayLabel?:string, label:string}} subject
 */
export function resolveSubjectAbbreviation(subject) {
  if (!subject) return ''
  const manual = String(subject.abbreviation || '').trim()
  if (manual) return manual.toUpperCase()
  const display = String(subject.displayLabel || '').trim()
  if (display && display !== subject.label) return deriveAbbreviation(display)
  return deriveAbbreviation(subject.label)
}

/**
 * The legend printed under an abbreviated grid.
 *
 * Only the abbreviations that actually APPEAR on the grid are listed
 * (`usedLabels`), because a key naming codes the reader cannot find is
 * noise. A relabelled language shows both names — "ZIL = Chinyanja (Zambian
 * Language)" — so the curriculum area is still identifiable.
 *
 * @param {Array} subjects  studio subject rows
 * @param {Set|Array} usedLabels  canonical labels present on the grid
 * @returns {Array<{abbr:string, label:string}>}
 */
export function buildAbbreviationLegend(subjects, usedLabels) {
  const used = usedLabels instanceof Set ? usedLabels : new Set(usedLabels || [])
  const seen = new Set()
  const out = []
  for (const s of Array.isArray(subjects) ? subjects : []) {
    if (!s?.label) continue
    if (used.size && !used.has(s.label)) continue
    const abbr = resolveSubjectAbbreviation(s)
    if (!abbr || seen.has(abbr)) continue
    seen.add(abbr)
    const display = String(s.displayLabel || '').trim()
    const label = display && display !== s.label ? `${display} (${s.label})` : s.label
    out.push({ abbr, label })
  }
  return out
}

/** The legend as one printable line: "ENG = English Language · ZIL = …". */
export function legendLine(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => `${e.abbr} = ${e.label}`)
    .join(' · ')
}
