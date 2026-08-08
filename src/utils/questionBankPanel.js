/**
 * Pure logic for the Assessment Paper Studio's embedded Question Bank side panel.
 *
 * The panel fetches a bounded set of bank rows once (owner + Master Bank) and
 * then narrows them entirely on the client, so all of the context-awareness
 * and filtering lives here as small, side-effect-free helpers that a plain
 * `node` test can exercise without Firestore.
 *
 * Two stages:
 *   1. deriveContext()   — auto-scope to the paper's grade + subject, then to
 *                          its topic. Falls back from topic → subject level
 *                          (flagging `widened`) so the panel is never empty
 *                          just because no question is tagged to the exact
 *                          topic string.
 *   2. applyPanelFilters — the teacher's own search box + difficulty / marks /
 *                          type filters, layered on top of the auto-scope.
 */

import { bankRowMatches, byNewest } from './questionBankCore.js'

/** Normalise a grade label so "Grade 4", "G4", "grade  4" and "4" all match. */
export function normalizeGrade(value) {
  return String(value ?? '')
    .toLowerCase()
    // Drop a leading "grade" word or a "g" that prefixes the number (so "G4",
    // "Grade 4" and "4" all normalise to "4").
    .replace(/grade/g, ' ')
    .replace(/\bg(?=\s*\d)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Grade match is lenient: an untagged row is kept, otherwise grades must align. */
export function gradeMatches(row, grade) {
  const want = normalizeGrade(grade)
  if (!want) return true
  const have = normalizeGrade(row?.grade)
  if (!have) return true
  return have === want || have.includes(want) || want.includes(have)
}

/** Subject match is lenient + case-insensitive; an untagged row is kept. */
export function subjectMatches(row, subject) {
  const want = String(subject ?? '').toLowerCase().trim()
  if (!want) return true
  const have = String(row?.subject ?? '').toLowerCase().trim()
  if (!have) return true
  return have === want || have.includes(want) || want.includes(have)
}

/**
 * Does a bank row belong to the paper's topic? The paper's topic can be a
 * single string or a "a; b, c"-style list (the studio joins cumulative-paper
 * topics), so we split on `;`/`,` and match if the row's topic overlaps any
 * of them (substring either direction — a row tagged "Common Fractions" still
 * matches a paper on "Fractions").
 */
export function topicMatches(row, topic) {
  const raw = String(topic ?? '').toLowerCase().trim()
  if (!raw) return false
  const have = String(row?.topic ?? '').toLowerCase().trim()
  if (!have) return false
  const wanted = raw.split(/[;,]/).map(s => s.trim()).filter(Boolean)
  return wanted.some(w => have.includes(w) || w.includes(have))
}

/**
 * Auto-scope rows to the paper's context.
 *
 * Returns { rows, scope, widened, subjectCount, topicCount }:
 *   - scope 'topic'   — questions tagged to the paper's topic (preferred).
 *   - scope 'subject' — no topic-level match (or no topic set); shows the whole
 *                       grade+subject set. `widened` is true only when a topic
 *                       WAS requested but had no matches, so the UI can say
 *                       "widened to subject".
 */
export function deriveContext(rows, { grade = '', subject = '', topic = '' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const subjectRows = list.filter(r => gradeMatches(r, grade) && subjectMatches(r, subject))
  const topicClean = String(topic ?? '').trim()

  if (topicClean) {
    const topicRows = subjectRows.filter(r => topicMatches(r, topicClean))
    if (topicRows.length) {
      return {
        rows: topicRows, scope: 'topic', widened: false,
        subjectCount: subjectRows.length, topicCount: topicRows.length,
      }
    }
    return {
      rows: subjectRows, scope: 'subject', widened: true,
      subjectCount: subjectRows.length, topicCount: 0,
    }
  }
  return {
    rows: subjectRows, scope: 'subject', widened: false,
    subjectCount: subjectRows.length, topicCount: 0,
  }
}

/** How many bank rows match the paper's exact topic (drives the passive nudge). */
export function countTopicMatches(rows, { grade = '', subject = '', topic = '' } = {}) {
  if (!String(topic ?? '').trim()) return 0
  const list = Array.isArray(rows) ? rows : []
  return list.filter(r =>
    gradeMatches(r, grade) && subjectMatches(r, subject) && topicMatches(r, topic),
  ).length
}

/**
 * The teacher's manual filters, layered on top of the auto-scope:
 *   - term       free-text search over the stem / keywords (bankRowMatches)
 *   - difficulty exact (case-insensitive)
 *   - marks      exact numeric
 *   - type       exact question type
 */
export function applyPanelFilters(rows, { term = '', difficulty = '', marks = '', type = '' } = {}) {
  let out = Array.isArray(rows) ? rows : []
  if (type) out = out.filter(r => r.type === type)
  if (difficulty) {
    const d = String(difficulty).toLowerCase()
    out = out.filter(r => String(r.difficulty ?? '').toLowerCase() === d)
  }
  if (marks !== '' && marks != null) {
    out = out.filter(r => Number(r.marks) === Number(marks))
  }
  const t = String(term ?? '').trim()
  if (t) out = out.filter(r => bankRowMatches(r, t))
  return out
}

/**
 * The full browser filter set, layered on one cached unfiltered fetch.
 *
 * The bank is browsed from two places now — the studio's Question Bank view
 * and the builder's insert drawer — and both narrow the SAME cached snapshot
 * rather than re-querying Firestore per filter change. So the whole filter set
 * lives here as one pure function instead of half of it in a Firestore helper
 * and half in a component.
 *
 * Grade and subject use the lenient matchers above rather than string equality:
 * a row stored as "Grade 5" and a picker offering "5" are the same grade, and a
 * row a teacher saved without a grade is theirs to find. Exact comparison would
 * hide questions behind a formatting difference the teacher cannot see.
 *
 * `scope` is resolved against `uid` — 'mine' is ownership, not the absence of a
 * Master flag, because a teacher's own question that Qix approved is both.
 *
 * @param {Array}  rows    unfiltered bank rows
 * @param {object} filters `{ scope, grade, subject, topic, subtopic, type,
 *                            difficulty, marks, source, withDiagram, term }`
 * @param {string} uid     the signed-in teacher, for the 'mine' scope
 */
export function applyBankBrowserFilters(rows, filters = {}, uid = '') {
  let out = Array.isArray(rows) ? rows : []
  const {
    scope = 'all', grade = '', subject = '', topic = '', subtopic = '',
    source = '', withDiagram = '', favouritesOnly = false, favouriteIds = null,
  } = filters

  if (scope === 'mine') out = out.filter(r => r?.ownerId === uid)
  else if (scope === 'master') out = out.filter(r => r?.masterEligible === true)

  if (grade) out = out.filter(r => gradeMatches(r, grade))
  if (subject) out = out.filter(r => subjectMatches(r, subject))
  if (topic) out = out.filter(r => topicMatches(r, topic))
  if (subtopic) {
    const want = String(subtopic).toLowerCase().trim()
    out = out.filter(r => String(r?.subtopic ?? '').toLowerCase().includes(want))
  }
  if (source) out = out.filter(r => r?.source === source)
  if (withDiagram === 'yes' || withDiagram === true) out = out.filter(r => Boolean(r?.hasDiagram))
  else if (withDiagram === 'no' || withDiagram === false) out = out.filter(r => !r?.hasDiagram)
  if (favouritesOnly && favouriteIds) out = out.filter(r => favouriteIds.has(r?.id))

  // term / difficulty / marks / type — the same predicates the insert drawer
  // has always used, so the two surfaces cannot answer "does this match?"
  // differently.
  return applyPanelFilters(out, filters)
}

/** Order rows for display. Unknown sort keys fall back to newest-first. */
export function sortBankRows(rows, sort = 'newest') {
  const out = [...(Array.isArray(rows) ? rows : [])]
  if (sort === 'mostUsed') {
    return out.sort((a, b) => (Number(b?.usageCount) || 0) - (Number(a?.usageCount) || 0))
  }
  return out.sort(byNewest)
}

/** Distinct difficulty / marks values present in a row set, for filter dropdowns. */
export function facetOptions(rows) {
  const list = Array.isArray(rows) ? rows : []
  const difficulties = new Set()
  const marks = new Set()
  const types = new Set()
  for (const r of list) {
    if (r?.difficulty) difficulties.add(String(r.difficulty))
    if (Number(r?.marks) > 0) marks.add(Number(r.marks))
    if (r?.type) types.add(String(r.type))
  }
  return {
    difficulties: [...difficulties].sort(),
    marks: [...marks].sort((a, b) => a - b),
    types: [...types].sort(),
  }
}
