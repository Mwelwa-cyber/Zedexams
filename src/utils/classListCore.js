/**
 * classListCore — every decision the Class List makes about WHICH learners to
 * show and in WHAT order, with no React, Firebase or DOM in sight.
 *
 * The Class List has to stay usable at 120 learners on a low-cost Android
 * phone over a slow connection. That budget is spent on rendering, so the
 * filtering, sorting, searching and windowing all happen here, once per input
 * change, and hand the view a plain array to draw. The node suite covers this
 * file directly (scripts/test-class-list-core.mjs).
 *
 * The Class List is the SINGLE SOURCE OF TRUTH for who is in a class (§4). The
 * register reads it; nothing else keeps a second copy of a learner's name.
 */

import { isActiveLearner, normalizeLearnerStatus } from './learnerStatus.js'
import { duplicateLearnerIds, learnerNameKey, normalizeLearnerName } from './learnerDuplicates.js'

// ── sorting ──────────────────────────────────────────────────────

export const CLASS_LIST_SORTS = [
  { value: 'list_order', label: 'List order' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'admission_asc', label: 'Admission number' },
  { value: 'recent', label: 'Recently updated' },
]

/**
 * Compare two admission numbers the way a person reads them, so ADM-2 sorts
 * before ADM-10. A plain string sort puts ADM-10 first, which makes an
 * ordered class list look shuffled and is the reason "sort by admission
 * number" is worth having as its own option at all.
 */
export function compareAdmissionNumbers(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  if (!sa && !sb) return 0
  // A learner with no admission number sorts last, never interleaved: they are
  // exactly the rows a teacher is about to go and fill in.
  if (!sa) return 1
  if (!sb) return -1
  const chunk = /(\d+|\D+)/g
  const pa = sa.toUpperCase().match(chunk) || []
  const pb = sb.toUpperCase().match(chunk) || []
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

function nameForSort(learner) {
  return normalizeLearnerName(learner?.fullName)
}

function updatedMillis(learner) {
  const v = learner?.updatedAt ?? learner?.createdAt
  if (!v) return 0
  if (typeof v === 'number') return v
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  const parsed = Date.parse(v)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sortLearners(learners, sort = 'list_order') {
  const rows = [...(Array.isArray(learners) ? learners : [])]
  switch (sort) {
    case 'name_asc':
      return rows.sort((a, b) => nameForSort(a).localeCompare(nameForSort(b)))
    case 'name_desc':
      return rows.sort((a, b) => nameForSort(b).localeCompare(nameForSort(a)))
    case 'admission_asc':
      return rows.sort((a, b) => compareAdmissionNumbers(a?.admissionNumber, b?.admissionNumber))
    case 'recent':
      return rows.sort((a, b) => updatedMillis(b) - updatedMillis(a))
    case 'list_order':
    default:
      // Ties broken by name so the order is STABLE across reloads. Rows
      // imported in one batch share an order value, and an unstable sort would
      // shuffle them between renders — which reads as data changing by itself.
      return rows.sort((a, b) => {
        const d = (Number(a?.order) || 0) - (Number(b?.order) || 0)
        return d !== 0 ? d : nameForSort(a).localeCompare(nameForSort(b))
      })
  }
}

// ── searching ────────────────────────────────────────────────────

/**
 * Does this learner match what the teacher typed?
 *
 * Matches on name (accent- and order-insensitive), admission number, list
 * number and parent phone, because a teacher searching a class list is as
 * likely to have the admission number in front of them as the name.
 */
export function learnerMatchesQuery(learner, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return true
  const normalizedQuery = normalizeLearnerName(q)
  if (normalizedQuery) {
    const name = normalizeLearnerName(learner?.fullName)
    if (name.includes(normalizedQuery)) return true
    // Also match when the teacher typed the surname first.
    const tokens = normalizedQuery.split(' ').filter(Boolean)
    if (tokens.length > 1 && tokens.every((t) => name.includes(t))) return true
  }
  const digits = q.replace(/\D/g, '')
  if (String(learner?.admissionNumber ?? '').toLowerCase().includes(q)) return true
  if (String(learner?.learnerNumber ?? '').toLowerCase() === q) return true
  if (digits.length >= 3 && String(learner?.parentPhone ?? '').replace(/\D/g, '').includes(digits)) return true
  return false
}

// ── filtering ────────────────────────────────────────────────────

/**
 * @typedef {object} ClassListFilters
 * @property {string} [query]      free-text search
 * @property {string[]} [statuses] enrolment statuses to include; empty = all
 * @property {boolean} [needsReview]  only records awaiting confirmation
 * @property {boolean} [duplicates]   only records in a possible-duplicate pair
 * @property {boolean} [missingInfo]  only records missing an admission number,
 *                                    gender or parent phone
 */

export const DEFAULT_CLASS_LIST_FILTERS = {
  query: '',
  statuses: [],
  needsReview: false,
  duplicates: false,
  missingInfo: false,
}

export function learnerIsMissingInfo(learner) {
  return !learner?.admissionNumber || !learner?.gender
}

/**
 * Apply the filter set. Filters COMBINE (all must hold) rather than replace
 * each other, so "Active" + "Needs review" answers the question a teacher is
 * actually asking — which of the children I expect in class tomorrow have I
 * not confirmed yet — instead of showing everything flagged anywhere.
 */
export function filterLearners(learners, filters = {}) {
  const f = { ...DEFAULT_CLASS_LIST_FILTERS, ...filters }
  const rows = Array.isArray(learners) ? learners : []
  const dupIds = f.duplicates ? duplicateLearnerIds(rows) : null
  const statuses = new Set((f.statuses || []).map(normalizeLearnerStatus))

  return rows.filter((learner) => {
    if (statuses.size && !statuses.has(normalizeLearnerStatus(learner?.status))) return false
    if (f.needsReview && !learner?.needsReview) return false
    if (f.duplicates && !dupIds.has(learner?.id)) return false
    if (f.missingInfo && !learnerIsMissingInfo(learner)) return false
    if (!learnerMatchesQuery(learner, f.query)) return false
    return true
  })
}

// ── the one call a view makes ────────────────────────────────────

export const ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 'all']

/**
 * Everything the Class List needs to render, from the raw roster.
 *
 * One function rather than a chain of hooks because the ORDER matters and is
 * easy to get wrong: counts are taken from the whole roster (a teacher must
 * see "86 active" regardless of the filter they are looking through), the
 * duplicate scan runs on the whole roster (a duplicate whose twin is filtered
 * out is still a duplicate), and only the final page is sliced.
 *
 * @returns {{
 *   rows: Array,          the learners to draw, in order, for this page
 *   visible: Array,       every learner passing the filters (all pages)
 *   total: number,        learners on the class list
 *   counts: object,       per-status + review/duplicate counts, whole roster
 *   page: number, pageCount: number, pageSize: number|'all',
 *   duplicateIds: Set,
 * }}
 */
export function buildClassListView(learners, {
  filters = {},
  sort = 'list_order',
  page = 1,
  pageSize = 25,
} = {}) {
  const rows = Array.isArray(learners) ? learners : []
  const duplicateIds = duplicateLearnerIds(rows)

  const counts = {
    total: rows.length,
    active: 0,
    transferred: 0,
    withdrawn: 0,
    graduated: 0,
    deceased: 0,
    needsReview: 0,
    duplicates: duplicateIds.size,
    missingInfo: 0,
  }
  for (const learner of rows) {
    const status = normalizeLearnerStatus(learner?.status)
    if (status in counts) counts[status] += 1
    if (learner?.needsReview) counts.needsReview += 1
    if (learnerIsMissingInfo(learner)) counts.missingInfo += 1
  }

  const visible = sortLearners(filterLearners(rows, filters), sort)

  const size = pageSize === 'all' ? visible.length || 1 : Math.max(1, Number(pageSize) || 25)
  const pageCount = Math.max(1, Math.ceil(visible.length / size))
  // A filter that shrinks the list below the current page must not leave the
  // teacher staring at an empty page with no way to tell why.
  const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount)
  const start = (safePage - 1) * size

  return {
    rows: visible.slice(start, start + size),
    visible,
    total: rows.length,
    counts,
    page: safePage,
    pageCount,
    pageSize,
    duplicateIds,
    rangeStart: visible.length ? start + 1 : 0,
    rangeEnd: Math.min(start + size, visible.length),
  }
}

/**
 * Which page a learner number lands on — the "jump to learner number" control.
 * Returns null when nothing on the list carries that number, so the caller can
 * say so rather than jumping somewhere arbitrary.
 */
export function pageForLearnerNumber(visible, learnerNumber, pageSize) {
  const wanted = String(learnerNumber ?? '').trim()
  if (!wanted) return null
  const rows = Array.isArray(visible) ? visible : []
  const index = rows.findIndex((l, i) => {
    const printed = String(l?.learnerNumber ?? '').trim()
    return printed ? printed === wanted : String(i + 1) === wanted
  })
  if (index < 0) return null
  const size = pageSize === 'all' ? rows.length || 1 : Math.max(1, Number(pageSize) || 25)
  return { page: Math.floor(index / size) + 1, index, learner: rows[index] }
}

// ── windowed rendering ───────────────────────────────────────────

/**
 * The slice of a long list that is worth mounting, given where the scroll is.
 *
 * A class of 120 learners with a status control, a menu and a phone number per
 * row is several thousand DOM nodes; on the low-cost Android phones this
 * product targets, mounting all of them is the difference between a list that
 * scrolls and one that stutters. `overscan` rows are kept mounted above and
 * below the viewport so a fast flick does not reveal blank space.
 *
 * Returned as offsets rather than as styles: the caller decides whether to
 * spend them on padding (a table) or on absolute positioning (a card list).
 */
export function windowRange({ total, rowHeight, viewportHeight, scrollTop = 0, overscan = 8 }) {
  const count = Math.max(0, Number(total) || 0)
  const h = Math.max(1, Number(rowHeight) || 1)
  const viewport = Math.max(0, Number(viewportHeight) || 0)
  const top = Math.max(0, Number(scrollTop) || 0)
  if (count === 0) return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0, totalHeight: 0 }
  const first = Math.max(0, Math.floor(top / h) - overscan)
  const visibleRows = Math.ceil(viewport / h) + overscan * 2
  const last = Math.min(count, first + visibleRows + 1)
  return {
    startIndex: first,
    endIndex: last,
    paddingTop: first * h,
    paddingBottom: Math.max(0, (count - last) * h),
    totalHeight: count * h,
  }
}

// ── bulk actions ─────────────────────────────────────────────────

/**
 * What a bulk action will actually do, before it does it.
 *
 * Returns the learners that WILL change and the ones that will not, with a
 * reason — so the confirmation can say "this changes 12 of the 15 you
 * selected; 3 are already transferred" instead of a bare count that turns out
 * to be wrong.
 */
export function planBulkStatusChange(selected, nextStatus) {
  const target = normalizeLearnerStatus(nextStatus)
  const changing = []
  const unchanged = []
  for (const learner of (Array.isArray(selected) ? selected : [])) {
    if (normalizeLearnerStatus(learner?.status) === target) {
      unchanged.push({ learner, reason: 'already_set' })
    } else {
      changing.push(learner)
    }
  }
  return { changing, unchanged, nextStatus: target }
}

/**
 * The class headline: "86 active learners". Counts the class list, which is
 * the same number the register expects to mark — there is no second roster to
 * disagree with.
 */
export function activeLearnerCount(learners) {
  return (Array.isArray(learners) ? learners : []).filter(isActiveLearner).length
}

/**
 * Learner names that appear more than once, for the header warning. Uses the
 * strict name key (exact match after normalisation) rather than the fuzzy
 * duplicate scan, because a headline count has to be one a teacher can verify
 * by looking.
 */
export function repeatedNameCount(learners) {
  const seen = new Map()
  for (const learner of (Array.isArray(learners) ? learners : [])) {
    const key = learnerNameKey(learner?.fullName)
    if (!key) continue
    seen.set(key, (seen.get(key) || 0) + 1)
  }
  let repeated = 0
  for (const n of seen.values()) if (n > 1) repeated += n
  return repeated
}
