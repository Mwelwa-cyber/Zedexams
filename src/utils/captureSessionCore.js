/**
 * captureSessionCore — turning several photographs of a hand-written class
 * list into ONE ordered list of learners.
 *
 * Pure module (no React / Firebase / DOM / camera) so the node suite covers it
 * directly. The browser side — camera, cropping, rotation, upload, the call to
 * the extraction function — lives in the capture components; every decision
 * about what the pages MEAN is made here.
 *
 * A teacher photographs page 1, page 2, page 3 of a register and expects 86
 * learners, in the order they are written. Three things reliably go wrong, and
 * each has a rule here:
 *
 *   The same page gets photographed twice. Phones make this easy — a shot
 *     looks blurred, the teacher retakes it, and both end up in the session.
 *     Importing both doubles a third of the class.
 *
 *   Consecutive pages OVERLAP. Photographing a bound register almost always
 *     catches the last few rows of the previous page at the top of the next
 *     frame, so the same learners appear on two pages.
 *
 *   Pages arrive out of order. Gallery pickers sort by filename or timestamp,
 *     neither of which is page order, so the teacher must be able to reorder —
 *     and the ORDER of the final list must follow the pages, not the shutter.
 *
 * None of these is resolved by guessing. Every decision this module makes is
 * reported (`decisions`) and every dropped row is preserved (`droppedRows`),
 * so the review screen can show a teacher exactly what happened and undo it.
 */

import { learnerNameKey, nameSimilarity } from './learnerDuplicates.js'

/** A row's identity for overlap/repeat comparison. */
function rowKey(row) {
  const adm = String(row?.admissionNumber ?? '').trim().toUpperCase()
  // An admission number identifies the row outright; without one, the
  // normalised name is the best available handle.
  return adm ? `#${adm}` : learnerNameKey(row?.fullName)
}

/** Whether two extracted rows are plausibly the same physical line. */
function rowsMatch(a, b) {
  const ka = rowKey(a)
  const kb = rowKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  // Both keyed by name and neither by admission number: allow for the fact
  // that the SAME line, read twice from two photographs, is read slightly
  // differently each time.
  if (ka.startsWith('#') || kb.startsWith('#')) return false
  return nameSimilarity(a?.fullName, b?.fullName) >= 0.8
}

// ── repeated photographs ─────────────────────────────────────────

/**
 * Is `candidate` a second photograph of a page we already have?
 *
 * Two signals, in order of authority:
 *   1. An identical image digest — the same file picked twice. Certain.
 *   2. The candidate's rows are almost entirely already present, in the same
 *      order, and it adds nothing new.
 *
 * The second test requires a MAJORITY overlap AND that the candidate is not
 * meaningfully longer, because a genuine page 2 that continues alphabetically
 * from page 1 shares no rows at all, while a re-shot page shares nearly every
 * row. A short page whose two rows both appear earlier is left alone (too
 * little evidence) — the reviewer's duplicate pass catches those.
 */
export function detectRepeatedPage(candidate, earlierPages) {
  const rows = candidate?.rows || []
  for (const page of (earlierPages || [])) {
    if (page.id === candidate?.id) continue
    if (candidate?.imageDigest && page.imageDigest && candidate.imageDigest === page.imageDigest) {
      return { repeatOf: page.id, reason: 'identical_image', overlap: 1 }
    }
    if (rows.length < 3 || (page.rows || []).length < 3) continue
    const earlierKeys = new Set((page.rows || []).map(rowKey).filter(Boolean))
    if (!earlierKeys.size) continue
    let shared = 0
    for (const row of rows) {
      const key = rowKey(row)
      if (key && earlierKeys.has(key)) shared += 1
    }
    const ratio = shared / rows.length
    // "Almost all of this page is already in that one, and it is not adding a
    // page's worth of new names."
    if (ratio >= 0.8 && rows.length <= (page.rows || []).length + 2) {
      return { repeatOf: page.id, reason: 'same_content', overlap: Number(ratio.toFixed(3)) }
    }
  }
  return null
}

// ── page overlap ─────────────────────────────────────────────────

const MAX_OVERLAP_ROWS = 12

/**
 * How many rows at the START of `next` repeat the END of `accumulated`.
 *
 * Looks for the LONGEST such run, because the shortest one is frequently a
 * coincidence: one repeated surname at a page break proves nothing, while six
 * consecutive matching rows is the page boundary. A run of one is therefore
 * only believed when the row carries an admission number, which cannot recur
 * by chance.
 */
export function detectPageOverlap(accumulated, next) {
  const tail = Array.isArray(accumulated) ? accumulated : []
  const head = Array.isArray(next) ? next : []
  const limit = Math.min(MAX_OVERLAP_ROWS, tail.length, head.length)
  for (let len = limit; len >= 1; len -= 1) {
    let allMatch = true
    for (let i = 0; i < len; i += 1) {
      if (!rowsMatch(tail[tail.length - len + i], head[i])) { allMatch = false; break }
    }
    if (!allMatch) continue
    if (len === 1) {
      const key = rowKey(head[0])
      if (!key.startsWith('#')) continue
    }
    return len
  }
  return 0
}

// ── the session ──────────────────────────────────────────────────

/**
 * @typedef {object} CapturePage
 * @property {string} id            stable id, assigned when the page is captured
 * @property {number} position      1-based page order, as the teacher arranged it
 * @property {string} [imageDigest] content hash of the image, for repeat detection
 * @property {Array}  rows          rows extracted from this page, TOP TO BOTTOM
 * @property {string} [status]      'captured' | 'extracting' | 'extracted' | 'failed'
 */

/**
 * Fold every captured page into one ordered import session.
 *
 * Pages are processed in the order the TEACHER arranged them, never the order
 * they were shot, and the resulting list preserves the order rows appear on
 * the pages — which is the order the school wrote them in, and the order the
 * printed register has to come back out in.
 *
 * @returns {{
 *   rows: Array,          the merged learner rows, in list order
 *   pages: Array,         each page annotated with what was done to it
 *   decisions: Array,     one entry per page that was skipped or trimmed
 *   droppedRows: Array,   every row removed, with the page and reason
 *   stats: object,        counts for the review screen's header
 * }}
 */
export function buildCaptureSession(pages) {
  const ordered = [...(Array.isArray(pages) ? pages : [])]
    .filter(Boolean)
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))

  const rows = []
  const annotatedPages = []
  const decisions = []
  const droppedRows = []
  const accepted = []

  for (const page of ordered) {
    const pageRows = Array.isArray(page.rows) ? page.rows : []

    if (page.status === 'failed') {
      // A page whose extraction FAILED is not an empty page. Saying so is the
      // difference between a teacher adding the missing names and a teacher
      // never learning that a third of the class was silently absent.
      decisions.push({ pageId: page.id, action: 'extraction_failed', rowsAffected: 0 })
      annotatedPages.push({ ...page, contributed: 0, skipped: true, skipReason: 'extraction_failed' })
      continue
    }

    const repeat = detectRepeatedPage({ ...page, rows: pageRows }, accepted)
    if (repeat) {
      decisions.push({
        pageId: page.id,
        action: 'skipped_repeat',
        repeatOf: repeat.repeatOf,
        reason: repeat.reason,
        rowsAffected: pageRows.length,
      })
      for (const row of pageRows) droppedRows.push({ row, pageId: page.id, reason: 'repeated_page' })
      annotatedPages.push({ ...page, contributed: 0, skipped: true, skipReason: 'repeated_page', repeatOf: repeat.repeatOf })
      continue
    }

    const overlap = detectPageOverlap(rows, pageRows)
    if (overlap > 0) {
      decisions.push({ pageId: page.id, action: 'trimmed_overlap', rowsAffected: overlap })
      for (let i = 0; i < overlap; i += 1) {
        droppedRows.push({ row: pageRows[i], pageId: page.id, reason: 'page_overlap' })
      }
    }

    const kept = pageRows.slice(overlap)
    kept.forEach((row, i) => {
      rows.push({
        ...row,
        sourcePageId: page.id,
        sourcePagePosition: Number(page.position) || annotatedPages.length + 1,
        // Where the row sat on its page, counted from the top of the ORIGINAL
        // page rather than from the trimmed slice, so "compare with the
        // original page image" points at the right line months later.
        sourceRowIndex: overlap + i,
      })
    })
    accepted.push({ ...page, rows: pageRows })
    annotatedPages.push({ ...page, contributed: kept.length, overlapTrimmed: overlap, skipped: false })
  }

  return {
    rows,
    pages: annotatedPages,
    decisions,
    droppedRows,
    stats: {
      pagesCaptured: ordered.length,
      pagesUsed: annotatedPages.filter((p) => !p.skipped).length,
      pagesSkipped: annotatedPages.filter((p) => p.skipped).length,
      pagesFailed: annotatedPages.filter((p) => p.skipReason === 'extraction_failed').length,
      rowsExtracted: ordered.reduce((n, p) => n + (Array.isArray(p.rows) ? p.rows.length : 0), 0),
      rowsAfterOverlap: rows.length,
      overlapRowsTrimmed: droppedRows.filter((d) => d.reason === 'page_overlap').length,
      repeatedPageRowsDropped: droppedRows.filter((d) => d.reason === 'repeated_page').length,
    },
  }
}

// ── page list management ─────────────────────────────────────────

/**
 * Move a page to a new position and renumber the rest. Pure: returns a new
 * array. Out-of-range indices are clamped rather than throwing, because this
 * is driven by drag gestures on a phone.
 */
export function reorderPages(pages, fromIndex, toIndex) {
  const list = [...(Array.isArray(pages) ? pages : [])]
  if (!list.length) return list
  const from = Math.min(Math.max(0, Number(fromIndex) || 0), list.length - 1)
  const to = Math.min(Math.max(0, Number(toIndex) || 0), list.length - 1)
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
  return list.map((p, i) => ({ ...p, position: i + 1 }))
}

/** Remove a page and close the gap in the numbering. */
export function removePage(pages, pageId) {
  return (Array.isArray(pages) ? pages : [])
    .filter((p) => p.id !== pageId)
    .map((p, i) => ({ ...p, position: i + 1 }))
}

/**
 * Replace one page's image in place — "retake page 2". The page keeps its
 * position and id, and its extraction is reset, because the rows belonged to
 * the photograph that was just discarded.
 */
export function retakePage(pages, pageId, replacement) {
  return (Array.isArray(pages) ? pages : []).map((p) => (
    p.id === pageId
      ? { ...p, ...replacement, id: p.id, position: p.position, rows: [], status: 'captured' }
      : p
  ))
}

/**
 * Is this session ready to extract? A teacher must not be able to press
 * "Finish scanning" on nothing, and must be told which page is still working.
 */
export function captureSessionReadiness(pages) {
  const list = Array.isArray(pages) ? pages : []
  if (!list.length) return { ready: false, reason: 'no_pages', message: 'Photograph at least one page first.' }
  const pending = list.filter((p) => p.status === 'extracting')
  if (pending.length) {
    return {
      ready: false,
      reason: 'extracting',
      message: `Still reading page ${pending.map((p) => p.position).join(', ')}…`,
    }
  }
  const failed = list.filter((p) => p.status === 'failed')
  if (failed.length === list.length) {
    return {
      ready: false,
      reason: 'all_failed',
      message: 'None of the pages could be read. Retake them in better light and try again.',
    }
  }
  return {
    ready: true,
    reason: 'ok',
    // Reported, not hidden: a session with one unreadable page still goes
    // forward, and the teacher is told the names from it are missing.
    warning: failed.length
      ? `Page ${failed.map((p) => p.position).join(', ')} could not be read — those learners are not in this list.`
      : null,
  }
}
