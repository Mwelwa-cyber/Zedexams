/**
 * schemeEditing — pure, immutable row operations for the Scheme of Work
 * editable table. The teacher is never locked into the AI draft: they can edit
 * any cell, add / delete / split / merge weekly rows, and move a topic to
 * another week. Keeping the logic here (React-free) means the studio editor and
 * the library editor share one implementation, and `node
 * src/utils/schemeEditing.test.js` can prove the tricky bits (split, merge,
 * renumber) without a browser.
 *
 * All functions take a whole scheme `{ header, weeks[] }` and return a NEW
 * scheme; the input is never mutated. Weeks are always renumbered 1..N so the
 * WEEK column stays contiguous after any structural edit.
 */

/** Fields carried on every week row (matches schemeOfWorkSchema.js). */
const LIST_FIELDS = ['specificCompetences', 'learningActivities', 'methods', 'tlAids']
const TEXT_FIELDS = ['topic', 'subtopic', 'expectedStandard', 'references']

/** A blank week row (week number is set by renumberWeeks). */
export function blankWeek() {
  return {
    week: 0,
    topic: '',
    subtopic: '',
    specificCompetences: [],
    learningActivities: [],
    expectedStandard: '',
    methods: [],
    tlAids: [],
    references: '',
    source: 'teacher',
  }
}

function cloneWeek(w) {
  return {
    ...blankWeek(),
    ...w,
    specificCompetences: [...(w?.specificCompetences || [])],
    learningActivities: [...(w?.learningActivities || [])],
    methods: [...(w?.methods || [])],
    tlAids: [...(w?.tlAids || [])],
  }
}

function withWeeks(scheme, weeks) {
  return { ...scheme, weeks: renumber(weeks) }
}

function renumber(weeks) {
  return weeks.map((w, i) => ({ ...w, week: i + 1 }))
}

/** Renumber a whole scheme's weeks to 1..N (contiguous). */
export function renumberWeeks(scheme) {
  const weeks = Array.isArray(scheme?.weeks) ? scheme.weeks.map(cloneWeek) : []
  return withWeeks(scheme, weeks)
}

/**
 * Set a single field on a week. List fields accept either an array or a
 * newline-separated string (how the textarea editor hands them back).
 */
export function updateCell(scheme, weekIndex, key, value) {
  const weeks = (scheme?.weeks || []).map(cloneWeek)
  if (weekIndex < 0 || weekIndex >= weeks.length) return scheme
  let v = value
  if (LIST_FIELDS.includes(key)) {
    v = Array.isArray(value)
      ? value.map((s) => String(s ?? '').trim()).filter(Boolean)
      : String(value ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  } else if (TEXT_FIELDS.includes(key)) {
    v = String(value ?? '')
  }
  weeks[weekIndex] = { ...weeks[weekIndex], [key]: v }
  return { ...scheme, weeks } // no renumber — cell edits don't change ordering
}

/** Insert a blank row after `weekIndex` (or at the end when out of range). */
export function addRow(scheme, weekIndex = -1) {
  const weeks = (scheme?.weeks || []).map(cloneWeek)
  const at = weekIndex >= 0 && weekIndex < weeks.length ? weekIndex + 1 : weeks.length
  weeks.splice(at, 0, blankWeek())
  return withWeeks(scheme, weeks)
}

/** Delete a row. */
export function deleteRow(scheme, weekIndex) {
  const weeks = (scheme?.weeks || []).map(cloneWeek)
  if (weekIndex < 0 || weekIndex >= weeks.length) return scheme
  weeks.splice(weekIndex, 1)
  return withWeeks(scheme, weeks)
}

/**
 * Split a week into two rows: the original stays as-is and a copy is inserted
 * directly after it, its subtopic marked "(cont.)". Used when a week's topic
 * genuinely needs two weeks of delivery.
 */
export function splitRow(scheme, weekIndex) {
  const weeks = (scheme?.weeks || []).map(cloneWeek)
  if (weekIndex < 0 || weekIndex >= weeks.length) return scheme
  const original = weeks[weekIndex]
  const copy = cloneWeek(original)
  const sub = String(copy.subtopic || '').trim()
  copy.subtopic = sub && !/\(cont\.?\)/i.test(sub) ? `${sub} (cont.)` : (sub || '(cont.)')
  weeks.splice(weekIndex + 1, 0, copy)
  return withWeeks(scheme, weeks)
}

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)))
const joinText = (a, b) => [a, b].map((s) => String(s || '').trim()).filter(Boolean).join('; ')

/**
 * Merge the week at `weekIndex` with the one after it into a single row.
 * Text fields are joined with '; ', list fields concatenated + de-duplicated,
 * and the merged row keeps the earlier week's topic when they match.
 */
export function mergeRows(scheme, weekIndex) {
  const weeks = (scheme?.weeks || []).map(cloneWeek)
  if (weekIndex < 0 || weekIndex >= weeks.length - 1) return scheme
  const a = weeks[weekIndex]
  const b = weeks[weekIndex + 1]
  const sameTopic = String(a.topic).trim() === String(b.topic).trim()
  const merged = {
    ...a,
    topic: sameTopic ? a.topic : joinText(a.topic, b.topic),
    subtopic: sameTopic ? joinText(a.subtopic, b.subtopic) : joinText(a.subtopic, b.subtopic),
    specificCompetences: uniq([...a.specificCompetences, ...b.specificCompetences]),
    learningActivities: uniq([...a.learningActivities, ...b.learningActivities]),
    expectedStandard: joinText(a.expectedStandard, b.expectedStandard),
    methods: uniq([...a.methods, ...b.methods]),
    tlAids: uniq([...a.tlAids, ...b.tlAids]),
    references: joinText(a.references, b.references),
  }
  weeks.splice(weekIndex, 2, merged)
  return withWeeks(scheme, weeks)
}

/**
 * Move the row at `fromIndex` so it becomes week number `toWeekNumber`
 * (1-based), shifting the others. Everything is renumbered afterwards.
 */
export function moveTopicToWeek(scheme, fromIndex, toWeekNumber) {
  const weeks = (scheme?.weeks || []).map(cloneWeek)
  if (fromIndex < 0 || fromIndex >= weeks.length) return scheme
  const target = Math.max(1, Math.min(weeks.length, Number(toWeekNumber) || 1)) - 1
  const [row] = weeks.splice(fromIndex, 1)
  weeks.splice(target, 0, row)
  return withWeeks(scheme, weeks)
}
