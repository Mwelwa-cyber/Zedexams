/**
 * Pure view-model derivations for the live Teacher Dashboard V2.
 *
 * Everything here operates on already-normalized inputs (the hook in
 * useTeacherDashboardData.js does the Firestore fetching and resource
 * normalization) so this module tests under plain `node` with no Firebase
 * dependency — see dashboardV2Data.test.js (npm run test:dashboard-v2-data).
 *
 * A "resource" is the dashboard's normalized artifact shape (same as the
 * legacy dashboard's): { id, tool, subject, grade, title, createdAt (ms),
 * modifiedAt (ms), to, status ('ready'|'draft'), questionCount }.
 */

import { paperGradeLabel } from '../paperTaxonomy.js'

const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(ms) {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "today" / "Nd ago" for the first fortnight, then a short date. */
export function relTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const days = Math.floor((now - ms) / DAY_MS)
  if (days <= 0) return 'today'
  if (days <= 14) return `${days}d ago`
  return shortDate(ms)
}

/** First name with an honorific kept ("Mr. Mwelwa"); 'Teacher' fallback. */
export function firstNameOf(displayName) {
  const name = String(displayName || '').trim()
  if (!name) return 'Teacher'
  const parts = name.split(/\s+/)
  if (/^(mr|mrs|ms|miss|dr|sir|madam)\.?$/i.test(parts[0]) && parts.length > 1) {
    return `${parts[0]} ${parts[1]}`
  }
  return parts[0]
}

/** Teacher identity for the V2 chrome (sidebar/header), from auth data. */
export function teacherFromAuth({ displayName, email } = {}) {
  return {
    name: String(displayName || '').trim() || 'Teacher',
    firstName: firstNameOf(displayName),
    shortName: firstNameOf(displayName),
    initials: initialsOf(displayName),
    role: 'Teacher',
    email: String(email || ''),
  }
}

export function initialsOf(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'T'
  const letters = parts
    .filter((p) => !/^(mr|mrs|ms|miss|dr|sir|madam)\.?$/i.test(p))
    .map((p) => p[0])
  const pick = letters.length ? letters : [parts[0][0]]
  return pick.slice(0, 2).join('').toUpperCase()
}

/** Human tool label for document metadata rows. */
export const TOOL_LABELS = {
  lesson_plan: 'Lesson Plan',
  scheme_of_work: 'Scheme of Work',
  weekly_forecast: 'Weekly Focus',
  worksheet: 'Worksheet',
  flashcards: 'Flashcards',
  rubric: 'Rubric',
  notes: 'Teacher Notes',
  homework: 'Homework',
  assessment: 'Test Paper',
  exam_paper: 'Exam Paper',
  sba_task: 'SBA Task',
  sba_mark_sheet: 'SBA Mark Sheet',
  sba_plan: 'SBA Year Plan',
  record_of_work: 'Record of Work',
  class_timetable: 'Class Timetable',
  mark_schedule: 'Mark Schedule',
  quiz: 'Quiz',
  full_lesson: 'Full Lesson',
}

export function toolLabel(tool) {
  return TOOL_LABELS[tool] || 'Document'
}

// Grade reaches us in whatever shape the writing studio used — '4' from the
// Assessment Studio, 'G4' from the server generators, 'Grade 4' from the
// Lesson Plan Studio. Listing all three side by side reads as a bug to a
// teacher (and it is one, upstream). paperGradeLabel resolves every stored
// shape onto its official label — including 'ECE_N' → Nursery and 'G8' →
// Form 1 — so labelling on read makes the list consistent today, independent
// of the write-side normalisation work.
function metaFor(resource) {
  return [toolLabel(resource.tool), paperGradeLabel(resource.grade), resource.subject]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' • ')
    .replace(/_/g, ' ')
}

/** Newest-first document rows for the Recent Documents card. */
export function documentsFromResources(resources = [], { limit = 5, now = Date.now() } = {}) {
  return resources.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title || 'Untitled document',
    meta: metaFor(r),
    date: relTime(r.modifiedAt || r.createdAt, now),
    status: r.status === 'draft' ? 'Draft' : 'Ready',
    tool: r.tool,
    to: r.to,
  }))
}

/** The most recently created/edited artifact, for the hero's LAST OPENED. */
export function lastOpenedFromResources(resources = [], now = Date.now()) {
  const r = resources[0]
  if (!r) return null
  const ts = r.modifiedAt || r.createdAt
  return {
    title: r.title || 'Untitled document',
    subject: String(r.subject || r.title || '').replace(/_/g, ' '),
    // Was printing a bare '4' under the hero's LAST OPENED card.
    grade: paperGradeLabel(r.grade),
    ago: relTime(ts, now),
    // Whole days since last touch — drives the hero's context subline
    // ("X hasn't been updated for N days").
    agoDays: Number.isFinite(ts) && ts > 0 ? Math.max(0, Math.floor((now - ts) / DAY_MS)) : null,
    to: r.to,
  }
}

/** Saved-count badges for the four Planning workspace tiles. */
export function savedCountsFromSummary(byTool = {}) {
  return {
    scheme_of_work: byTool.scheme_of_work || 0,
    weekly_forecast: byTool.weekly_forecast || 0,
    lesson_plan: byTool.lesson_plan || 0,
    record_of_work: byTool.record_of_work || 0,
  }
}

/**
 * Full saved-count map keyed by Firestore tool id for the app launcher —
 * every generation tool from the library summary, plus the assessment-paper
 * total (a separate collection). Purely a re-shape of counts the dashboard
 * already fetched; it never triggers a new query. Returns a plain number
 * map so `counts[countKey]` is safe for any studio.
 */
export function studioSavedCounts(byTool = {}, assessmentCount = 0) {
  const out = {}
  for (const [tool, n] of Object.entries(byTool || {})) {
    if (typeof n === 'number' && n > 0) out[tool] = n
  }
  if (typeof assessmentCount === 'number' && assessmentCount > 0) {
    // Assessment papers live in their own collection, not `byTool`.
    out.assessment = assessmentCount
  }
  return out
}

/**
 * Studios that currently need the teacher's attention, for the launcher's
 * warning-dot badge — derived ONLY from data the dashboard already fetched.
 * Today: draft assessment papers (no questions yet) flag the Assessment
 * Paper Studio. Returns an array of studio ids.
 */
export function launcherWarningsFromResources(resources = []) {
  const hasDraftPapers = resources.some((r) => r.tool === 'assessment' && r.status === 'draft')
  return hasDraftPapers ? ['assessment-papers'] : []
}

/** Checklist rows from buildWeekPrep()'s output (rows with a real target). */
export function checklistFromWeekPrep(weekPrep) {
  if (!weekPrep || weekPrep.empty || !Array.isArray(weekPrep.rows)) return []
  return weekPrep.rows
    .filter((row) => Number.isFinite(row?.target) && row.target > 0)
    .map((row) => ({
      id: row.key,
      label: row.label,
      done: Math.min(row.done || 0, row.target),
      total: row.target,
      to: row.to || null,
    }))
}

/**
 * AI Recommendation cards for the dashboard, from buildProfileRecommendations()'s
 * output.
 *
 * The scope chips come off the recommendation ITSELF — buildRecommendations
 * stamps gradeLabel/subjectName per card for exactly this, and the card's own
 * CTA link already uses them. They used to be re-derived from the teacher's
 * active assignment, which is a different assignment as soon as a teacher takes
 * more than one subject, so a card titled "English is not planned yet" was
 * chipped "technology studies" while its own button linked to English.
 *
 * A card that doesn't carry its own scope gets NO chip — a borrowed one is
 * worse than none, because the teacher can't tell it's borrowed.
 */
export function recommendationCardsFrom(recommendations = [], { limit = 3 } = {}) {
  return recommendations.slice(0, limit).map((r) => {
    const grade = r.gradeLabel || null
    const subject = r.subjectName || null
    return {
      id: r.id,
      title: r.title,
      text: r.text,
      actionLabel: r.actionLabel,
      to: r.to,
      context: grade || subject ? { grade, subject } : null,
    }
  })
}

/**
 * Honest Feed & Status items — every entry is verified in data:
 *  - success:  something was saved in the last 7 days
 *  - warning:  draft test papers with no questions yet
 *  - error:    a library or assessment-papers fetch failed (gensError / papersError)
 */
export function feedFromState({ resources = [], gensError = false, papersError = false, now = Date.now() } = {}) {
  const items = []
  const recent = resources.find((r) => r.status !== 'draft' && now - (r.createdAt || 0) < 7 * DAY_MS)
  if (recent) {
    items.push({
      id: 'feed-saved',
      kind: 'success',
      title: 'Saved to your library',
      body: `${recent.title} is ready to use.`,
      to: recent.to,
    })
  }
  const drafts = resources.filter((r) => r.status === 'draft')
  if (drafts.length > 0) {
    items.push({
      id: 'feed-drafts',
      kind: 'warning',
      title: drafts.length === 1 ? 'A test paper is still a draft' : `${drafts.length} test papers are still drafts`,
      body: 'Add questions to finish and export them.',
      to: '/teacher/assessment-papers',
    })
  }
  if (gensError) {
    items.push({
      id: 'feed-error',
      kind: 'error',
      title: "Couldn't load your library",
      body: 'Check your connection and try again.',
      retry: true,
    })
  }
  if (papersError) {
    items.push({
      id: 'feed-papers-error',
      kind: 'error',
      title: "Couldn't load your assessment papers",
      body: 'Your saved test and exam papers may not be showing. Check your connection and try again.',
      retry: true,
    })
  }
  return items
}

/** Recent Activity rows (top N, includes drafts). */
export function activityFromResources(resources = [], { limit = 3, now = Date.now() } = {}) {
  return resources.slice(0, limit).map((r) => ({
    id: r.id,
    title: `${toolLabel(r.tool)} ${r.modifiedAt && r.modifiedAt > r.createdAt ? 'updated' : 'created'}`,
    meta: metaFor(r),
    time: relTime(r.modifiedAt || r.createdAt, now),
    tool: r.tool,
    to: r.to,
  }))
}

/** Local-midnight Date from a "YYYY-MM-DD" string (never UTC-shifted). */
function parseLocalDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/**
 * Mon–Fri teaching days remaining in a MoE term — from today (inclusive,
 * when today is a teaching day) through the term's closing date, minus any
 * listed holidays that fall on weekdays. Drives the mobile hero's
 * "N teaching days left" line. Returns null without a usable term, 0 once
 * the term has closed.
 */
export function teachingDaysLeft(term, now = Date.now()) {
  const open = parseLocalDay(term?.open)
  const close = parseLocalDay(term?.close)
  if (!open || !close) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (today > close) return 0
  const holidays = new Set((term.holidays || []).map((h) => h?.date).filter(Boolean))
  const cursor = today < open ? new Date(open) : new Date(today)
  let count = 0
  while (cursor <= close) {
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
      if (!holidays.has(iso)) count += 1
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}

/** "15 Jul — Term 2 • Week 10" from the MoE forecast-week calendar. */
export function termChipLabel(calendar, now = Date.now()) {
  if (!calendar) return ''
  const bits = []
  if (Number.isFinite(calendar.termNumber)) bits.push(`Term ${calendar.termNumber}`)
  if (Number.isFinite(calendar.weekNumber)) bits.push(`Week ${calendar.weekNumber}`)
  if (!bits.length) return ''
  return `${shortDate(now)} — ${bits.join(' • ')}`
}
