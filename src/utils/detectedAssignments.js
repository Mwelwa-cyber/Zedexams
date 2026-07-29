// Detected teaching assignments — pure normalisation + dedup layer (no
// Firebase, unit-testable).
//
// The Teaching Profile onboarding screen shows assignments INFERRED from a
// teacher's recent work (lesson plans, schemes, syllabi, test papers). Those
// documents carry messy display strings — "Mathematics Syllabus (Grades 4–6)",
// a bare grade "4", "Grade 4 · Integrated Science" — which must never surface
// as separate teaching assignments when they describe the same grade +
// subject + curriculum + class. This module turns raw candidates into a
// canonical, deduplicated list the UI can render directly:
//
//   { gradeId, gradeLabel, subjectId, subjectLabel,
//     curriculumId, curriculumLabel, curriculumConfirmed,
//     className, sourceCount, sourceDocumentIds, sources[], key }
//
// Rules (mirrored by scripts/test-detected-assignments.mjs):
//   • strip "Syllabus" and embedded grade-range/year parentheticals from
//     subject display text, then match case-insensitively against the
//     canonical curriculum taxonomy (config/teacherTaxonomy.js);
//   • canonicalise grades ("4" / "Grade 4" / "G4" → G4);
//   • dedupe on gradeId + subjectId + curriculumId + className, merging
//     source counts and source-document lists;
//   • NEVER merge CBC and OBC, never merge different grades;
//   • prefer structured curriculum metadata; a candidate with no structured
//     curriculum shows "Curriculum not confirmed" instead of a guess, and is
//     only folded into a sibling bucket when exactly ONE confirmed curriculum
//     exists for that grade + subject + class (unambiguous).
//
// Run tests: npm run test:detected-assignments

import { TEACHER_GRADES, TEACHER_SUBJECTS, ECE_SUBJECTS } from '../config/teacherTaxonomy.js'
import { normalizeCurriculumType, curriculumTypeLabel, gradeLabel } from './teachingProfileCore.js'
import { canonicalMathsScienceLabel } from '../config/mathsScienceArea.js'

const CURRICULUM_NOT_CONFIRMED_LABEL = 'Curriculum not confirmed'

function s(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

// ── grade canonicalisation ───────────────────────────────────────────────────

const ECE_CODES = new Set(['ECE', 'ECE_N', 'ECE_R'])

/**
 * Fold any spelling of a grade into the canonical G-code ('4', 'Grade 4',
 * 'grade4', 'G4', 'g4' → 'G4'; ECE band codes pass through). Returns '' when
 * the value cannot be recognised — the caller decides the fallback.
 */
export function canonicalGradeId(raw) {
  const v = s(raw)
  if (!v) return ''
  const upper = v.toUpperCase()
  if (ECE_CODES.has(upper)) return upper
  const m = upper.match(/^(?:G|GRADE\s*)?(\d{1,2})$/)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 12) return `G${n}`
  }
  return ''
}

// ── subject canonicalisation ─────────────────────────────────────────────────

// Case-insensitive lookup of taxonomy subjects by slug AND by display label.
const SUBJECT_LOOKUP = (() => {
  const map = new Map()
  for (const opt of [...TEACHER_SUBJECTS, ...ECE_SUBJECTS]) {
    if (!opt.value) continue
    map.set(opt.value.toLowerCase(), { subjectId: opt.value, subjectLabel: opt.label })
    // First label registered for a slug wins (TEACHER_SUBJECTS before ECE), but
    // every label still resolves to its canonical slug.
    if (!map.has(opt.label.toLowerCase())) {
      map.set(opt.label.toLowerCase(), { subjectId: opt.value, subjectLabel: opt.label })
    }
  }
  // Common shorthand seen in imported/scanned documents.
  const alias = (name, slug) => {
    const hit = map.get(slug)
    if (hit && !map.has(name)) map.set(name, hit)
  }
  alias('maths', 'mathematics')
  alias('math', 'mathematics')
  alias('maths and science', 'numeracy')
  alias('mathematics & science', 'numeracy')
  // Spellings of the combined maths/science area that documents still carry
  // from before it was named properly on screen.
  alias('numeracy (maths & science)', 'numeracy')
  alias('pre-maths & science', 'numeracy')
  alias('pre-maths and science', 'numeracy')
  alias('science', 'integrated_science')
  return map
})()

/**
 * Strip document-title noise from a subject string so only the subject name
 * remains: "(Grades 4–6)" / "(Grades 1–7, 2013)" parentheticals, the word
 * "Syllabus", a leading "Grade 4 ·" / "4 ·" prefix, duplicated punctuation and
 * stray separators. Purely textual — never used to infer a curriculum.
 */
export function cleanSubjectText(raw) {
  let v = s(raw)
  if (!v) return ''
  // Leading grade prefix inside the subject cell: "4 · Integrated Science",
  // "Grade 4 - Mathematics".
  v = v.replace(/^(?:grade\s*)?\d{1,2}\s*[·•:\-–—]\s*/i, '')
  // Parentheticals that are grade ranges / forms / years — title metadata, not
  // part of the subject name.
  v = v.replace(/\(\s*(?=[^)]*(?:grades?|forms?|\d{4}|\d\s*[–—-]\s*\d))[^)]*\)/gi, ' ')
  // The word "Syllabus" (and an immediately following year).
  v = v.replace(/\bsyllabus\b(\s*\d{4})?/gi, ' ')
  // Collapse duplicated separators / whitespace, trim dangling punctuation.
  v = v
    .replace(/\s{2,}/g, ' ')
    .replace(/(\s*[·•:\-–—,]\s*){2,}/g, ' · ')
    .replace(/^[\s·•:\-–—,]+|[\s·•:\-–—,]+$/g, '')
    .trim()
  return v
}

// One slug, two names: the ECE and Lower-Primary entries of the taxonomy share
// `numeracy`, so a slug lookup alone cannot say which name applies. Whichever
// of the two the lookup happened to return is re-resolved against the grade.
function nameForGrade(hit, grade) {
  const canonical = canonicalMathsScienceLabel(hit.subjectLabel, grade)
  return canonical ? { subjectLabel: canonical } : null
}

/**
 * Resolve a raw subject string to the canonical taxonomy subject. Falls back
 * to the cleaned display text (with a slugified id) when no taxonomy entry
 * matches, so unknown subjects are still shown — just not silently renamed.
 * Returns { subjectId, subjectLabel, matched }.
 *
 * `grade` is optional and only affects the combined maths/science area, which
 * one slug serves under two names ("Pre-Mathematics and Science" at Nursery /
 * Reception, "Mathematics and Science" from Grade 1).
 */
export function resolveSubject(raw, grade) {
  const rawStr = s(raw)
  // A raw slug ('integrated_science') matches directly.
  const direct = SUBJECT_LOOKUP.get(rawStr.toLowerCase())
  if (direct) return { ...direct, ...nameForGrade(direct, grade), matched: true }
  const cleaned = cleanSubjectText(rawStr)
  const hit = SUBJECT_LOOKUP.get(cleaned.toLowerCase())
  if (hit) return { ...hit, ...nameForGrade(hit, grade), matched: true }
  const fallbackId = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return { subjectId: fallbackId || rawStr.toLowerCase(), subjectLabel: cleaned || rawStr, matched: false }
}

// ── assignment normalisation ─────────────────────────────────────────────────

/**
 * Normalise ONE raw candidate. Input tolerates the inference layer's shape:
 *   { grade, subject, className, curriculumType, curriculumSource, sources[] }
 * where curriculumSource === 'structured' means the curriculum came from a
 * structured metadata field (never a parsed document title).
 */
export function normalizeDetectedAssignment(candidate = {}) {
  const c = candidate && typeof candidate === 'object' ? candidate : {}
  const gradeId = canonicalGradeId(c.grade) || s(c.grade)
  const subject = resolveSubject(c.subject, gradeId)
  const className = s(c.className)
  const curriculumConfirmed = c.curriculumSource === 'structured'
  const curriculumId = curriculumConfirmed ? normalizeCurriculumType(c.curriculumType) : ''
  const sources = Array.isArray(c.sources) ? c.sources.filter(Boolean) : []
  return {
    gradeId,
    gradeLabel: gradeLabel(gradeId),
    subjectId: subject.subjectId,
    subjectLabel: subject.subjectLabel,
    subjectMatched: subject.matched,
    curriculumId,
    curriculumLabel: curriculumConfirmed ? curriculumTypeLabel(curriculumId) : CURRICULUM_NOT_CONFIRMED_LABEL,
    curriculumConfirmed,
    className,
    sources,
    sourceDocumentIds: sources.map((src) => s(src.id)).filter(Boolean),
    sourceCount: sources.length || (Number.isFinite(c.count) ? c.count : 1),
  }
}

/** Stable dedup identity: gradeId + subjectId + curriculumId + className. */
export function detectedAssignmentKey(n) {
  return [n.gradeId, n.subjectId, n.curriculumId, s(n.className).toLowerCase()].join('::')
}

function mergeInto(target, extra) {
  const seen = new Set(target.sourceDocumentIds)
  for (const src of extra.sources) {
    const id = s(src.id)
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    target.sources.push(src)
  }
  target.sourceDocumentIds = Array.from(seen)
  // Anonymous sources (no ids) can't be identity-checked; sum counts, floor at
  // the number of known distinct documents.
  target.sourceCount = Math.max(target.sourceCount + extra.sourceCount, target.sourceDocumentIds.length)
}

/**
 * Normalise + deduplicate a list of raw candidates. Duplicates (same grade +
 * subject + curriculum + class) merge their source counts and documents. A
 * curriculum-unconfirmed bucket folds into a confirmed sibling ONLY when
 * exactly one confirmed curriculum exists for that grade + subject + class —
 * CBC and OBC are never merged with each other, and an ambiguous unconfirmed
 * bucket stays visible as "Curriculum not confirmed". Sorted by sourceCount
 * desc (strongest signal first), each entry carrying its dedup `key`.
 */
export function normalizeDetectedAssignments(candidates = []) {
  const byKey = new Map()
  for (const cand of Array.isArray(candidates) ? candidates : []) {
    const n = normalizeDetectedAssignment(cand)
    if (!n.gradeId || !n.subjectId) continue
    const key = detectedAssignmentKey(n)
    if (byKey.has(key)) mergeInto(byKey.get(key), n)
    else byKey.set(key, n)
  }

  // Second pass: fold unconfirmed-curriculum buckets into an unambiguous
  // confirmed sibling (same grade + subject + class).
  for (const [key, entry] of Array.from(byKey.entries())) {
    if (entry.curriculumId) continue // confirmed — stays put
    const siblings = Array.from(byKey.values()).filter(
      (o) =>
        o !== entry &&
        o.curriculumId &&
        o.gradeId === entry.gradeId &&
        o.subjectId === entry.subjectId &&
        o.className.toLowerCase() === entry.className.toLowerCase(),
    )
    if (siblings.length === 1) {
      mergeInto(siblings[0], entry)
      byKey.delete(key)
    }
  }

  const list = Array.from(byKey.values()).sort((a, b) => b.sourceCount - a.sourceCount)
  for (const n of list) n.key = detectedAssignmentKey(n)
  return list
}

// ── search + filtering (operates on NORMALISED assignments) ──────────────────

/**
 * Filter a normalised list by free-text query (matches grade, subject,
 * curriculum and class name) and/or exact grade / curriculum filters.
 */
export function filterDetectedAssignments(list, { query = '', gradeId = '', curriculumId = '' } = {}) {
  const q = s(query).toLowerCase()
  return (Array.isArray(list) ? list : []).filter((n) => {
    if (gradeId && n.gradeId !== gradeId) return false
    // 'unconfirmed' selects the curriculum-not-confirmed bucket (whose
    // curriculumId is '' — which would otherwise read as "no filter").
    if (curriculumId && (curriculumId === 'unconfirmed' ? n.curriculumId !== '' : n.curriculumId !== curriculumId)) return false
    if (!q) return true
    const hay = [n.gradeLabel, n.subjectLabel, n.curriculumLabel, n.className]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

/** Distinct grade options present in a normalised list (for the grade filter). */
export function gradeFilterOptions(list) {
  const seen = new Map()
  for (const n of Array.isArray(list) ? list : []) {
    if (n.gradeId && !seen.has(n.gradeId)) seen.set(n.gradeId, n.gradeLabel)
  }
  // Taxonomy order where known, unknown grades last alphabetically.
  const order = new Map(TEACHER_GRADES.filter((g) => g.value).map((g, i) => [g.value, i]))
  return Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => (order.get(a.value) ?? 99) - (order.get(b.value) ?? 99) || a.label.localeCompare(b.label))
}

/** Distinct curriculum options present in a normalised list. */
export function curriculumFilterOptions(list) {
  const seen = new Map()
  for (const n of Array.isArray(list) ? list : []) {
    const value = n.curriculumId || 'unconfirmed'
    if (!seen.has(value)) seen.set(value, n.curriculumLabel)
  }
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }))
}

export { CURRICULUM_NOT_CONFIRMED_LABEL }
