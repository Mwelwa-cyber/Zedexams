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

function metaFor(resource) {
  return [toolLabel(resource.tool), resource.grade, resource.subject]
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
    grade: String(r.grade || '').trim(),
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
 * Honest Feed & Status items — every entry is verified in data:
 *  - success: something was saved in the last 7 days
 *  - warning: draft test papers with no questions yet
 *  - error:   the library fetch itself failed (caller passes gensError)
 */
export function feedFromState({ resources = [], gensError = false, now = Date.now() } = {}) {
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
      title: 'Couldn’t load your library',
      body: 'Check your connection and try again.',
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

/** "15 Jul — Term 2 • Week 10" from the MoE forecast-week calendar. */
export function termChipLabel(calendar, now = Date.now()) {
  if (!calendar) return ''
  const bits = []
  if (Number.isFinite(calendar.termNumber)) bits.push(`Term ${calendar.termNumber}`)
  if (Number.isFinite(calendar.weekNumber)) bits.push(`Week ${calendar.weekNumber}`)
  if (!bits.length) return ''
  return `${shortDate(now)} — ${bits.join(' • ')}`
}
