/**
 * src/utils/pastPaperNormalize.js
 *
 * Content-normalization pipeline for PAST PAPERS — one place that canonicalizes
 * a paper's grade, subject, title casing, exam board, year, paper number, and
 * derives a stable SEO slug. Applied on write (createPaper / updatePaper in
 * src/utils/pastPapers.js) so every authored or edited paper lands with
 * consistent metadata, instead of whatever casing/spelling the admin happened
 * to type.
 *
 * Why this exists (see scripts/test-past-paper-normalize.mjs for the locked
 * behaviour): the past-paper write path did no normalization — it trusted the
 * studio dropdowns. That's fine until a legacy doc, a bulk edit, or a future
 * importer writes `grade: 7` (number), `subject: 'Maths'` (label, not id),
 * `examBoard: 'ecz'`, or `title: 'MATHEMATICS PAPER 1'`. Exact-match Firestore
 * queries (`where('grade','==','7')`, `where('subject','==','mathematics')`)
 * then silently miss those rows, and the archive shows inconsistent titles for
 * what is the same paper. This pipeline closes those gaps deterministically.
 *
 * Pure module (no Firebase, no React) so the node tests can import it directly.
 * Imports only from src/config/curriculum.js (the subject source of truth) —
 * never from pastPapers.js, to avoid an import cycle.
 */

import { normalizeSubject, PAPER_SUBJECTS } from '../config/curriculum.js'

// ── Grade ─────────────────────────────────────────────────────────────────
/**
 * Canonical stored grade form: the bare token the archive filters on.
 * 'Grade 7' / 'G7' / 7 → '7'; ECE / form codes pass through untouched.
 */
export function normalizeGrade(value) {
  if (value == null) return value
  let g = String(value).trim()
  if (!g) return g
  // Strip a leading "Grade " or a bare "G" prefix on a numeric grade.
  g = g.replace(/^grade\s+/i, '')
  if (/^g\d+$/i.test(g)) g = g.slice(1)
  return g
}

// ── Subject ─────────────────────────────────────────────────────────────
// Resolve any subject spelling (id, display label, underscore/space variant)
// onto the canonical PAPER_SUBJECTS id the archive stores and filters on.
const SUBJECT_ID_BY_KEY = (() => {
  const map = new Map()
  for (const s of PAPER_SUBJECTS) {
    map.set(s.id.toLowerCase(), s.id)
    map.set(s.label.toLowerCase(), s.id)
    map.set(s.id.replace(/-/g, '_'), s.id)
    map.set(s.id.replace(/-/g, ' '), s.id)
  }
  return map
})()

// Common human spellings the curriculum's label map doesn't carry but the
// archive should still fold (the hub itself labels mathematics as "Maths").
const SUBJECT_EXTRA_ALIASES = {
  maths: 'mathematics',
  math: 'mathematics',
}

/** Canonical PAPER_SUBJECTS id, or a slugified fallback if truly unknown. */
export function normalizeSubjectId(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return raw
  const lc = raw.toLowerCase()
  if (SUBJECT_EXTRA_ALIASES[lc]) return SUBJECT_EXTRA_ALIASES[lc]
  const direct = SUBJECT_ID_BY_KEY.get(lc)
  if (direct) return direct
  // Fold through the curriculum's label normalizer, then map label → id.
  const viaLabel = SUBJECT_ID_BY_KEY.get(String(normalizeSubject(raw)).toLowerCase())
  if (viaLabel) return viaLabel
  // Unknown subject: return a stable slug rather than guessing a wrong id, so
  // the value is at least consistent and the studio dropdown can flag it.
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── Title casing ──────────────────────────────────────────────────────────
const TITLE_ACRONYMS = new Set(['ecz', 'ece', 'ecde', 'ict', 'cbc', 'gce', 'igcse', 'sba', 'jets', 'pe', 're'])
const TITLE_MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via'])
const ROMAN = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})$/i

function titleCaseWord(word, isEdge) {
  if (!word) return word
  // Tokens with digits ("1", "(2023)", "P1") carry deliberate form — leave them.
  if (/\d/.test(word)) return word
  const lower = word.toLowerCase()
  // Known acronyms win first so all-caps ones (IGCSE) aren't mistaken for caps
  // to flatten.
  if (TITLE_ACRONYMS.has(lower)) return word.toUpperCase()
  if (ROMAN.test(word) && lower !== 'i' && lower !== 'x') return word.toUpperCase()
  // Preserve deliberately MIXED-case words ("McX", "iPhone") — but NOT all-caps
  // words like "MATHEMATICS", which should be title-cased.
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word
  if (!isEdge && TITLE_MINOR.has(lower)) return lower
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function titleCaseToken(token, isEdge) {
  // Title-case each hyphen-separated part ("mid-term" → "Mid-Term").
  return token
    .split('-')
    .map((part, i, arr) => titleCaseWord(part, isEdge && (i === 0 || i === arr.length - 1)))
    .join('-')
}

/** Trim, collapse internal whitespace, and apply smart title-casing. */
export function normalizeTitle(value) {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return raw
  const tokens = raw.split(' ')
  return tokens
    .map((t, i) => titleCaseToken(t, i === 0 || i === tokens.length - 1))
    .join(' ')
}

// ── Exam board ────────────────────────────────────────────────────────────
const EXAM_BOARD_ALIASES = {
  ecz: 'ECZ',
  'exam council of zambia': 'ECZ',
  'examinations council of zambia': 'ECZ',
  'examination council of zambia': 'ECZ',
  gce: 'GCE',
  cambridge: 'Cambridge',
}

/** Canonical exam-board form; defaults to ECZ when blank. */
export function normalizeExamBoard(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 'ECZ'
  const hit = EXAM_BOARD_ALIASES[raw.toLowerCase()]
  if (hit) return hit
  // A short token is almost certainly an acronym ("nied" → "NIED").
  if (raw.length <= 5 && !raw.includes(' ')) return raw.toUpperCase()
  return raw
}

// ── Year ──────────────────────────────────────────────────────────────────
/** Coerce to a number and validate the range; null when implausible. */
export function normalizeYear(value) {
  const n = Number(value)
  const max = new Date().getFullYear() + 1
  if (!Number.isInteger(n) || n < 1990 || n > max) return null
  return n
}

// ── Paper number ──────────────────────────────────────────────────────────
/** Integer 1–5, or null. */
export function normalizePaperNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 5) return null
  return n
}

// ── Slug ──────────────────────────────────────────────────────────────────
function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Stable, SEO-friendly slug from a paper's identity:
 *   grade-7-mathematics-2023-paper-1  (paper number omitted when absent)
 * Deterministic from the normalized fields, so the same paper always slugs the
 * same way. Stored on the doc for SEO / shareable URLs; routing still resolves
 * by Firestore id, so the slug is additive and safe.
 */
export function paperSlug(fields = {}) {
  const parts = []
  const g = normalizeGrade(fields.grade)
  if (g) parts.push(`grade-${g}`)
  const subj = normalizeSubjectId(fields.subject)
  if (subj) parts.push(subj)
  const year = normalizeYear(fields.year)
  if (year) parts.push(String(year))
  const pn = normalizePaperNumber(fields.paperNumber)
  if (pn) parts.push(`paper-${pn}`)
  return slugify(parts.join('-'))
}

// ── The pipeline ──────────────────────────────────────────────────────────
/**
 * Normalize the fields of a past-paper write. Only touches keys that are
 * PRESENT on the input (so a status-only update doesn't clobber title/grade),
 * and (re)derives `slug` whenever grade + subject + year are all available.
 */
export function normalizePaperFields(fields = {}) {
  const out = { ...fields }
  if ('grade' in out) out.grade = normalizeGrade(out.grade)
  if ('subject' in out) out.subject = normalizeSubjectId(out.subject)
  if ('title' in out) out.title = normalizeTitle(out.title)
  if ('examBoard' in out) out.examBoard = normalizeExamBoard(out.examBoard)
  if ('year' in out) out.year = normalizeYear(out.year)
  if ('paperNumber' in out) out.paperNumber = normalizePaperNumber(out.paperNumber)
  if (out.grade && out.subject && out.year) out.slug = paperSlug(out)
  return out
}
