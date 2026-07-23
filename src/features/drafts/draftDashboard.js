/**
 * Pure helpers for the Recovery Centre / Draft Dashboard.
 *
 * No React, no Firebase, no browser APIs — so this unit-tests under plain node
 * (see draftDashboard.test.js). The page (RecoveryCentre.jsx) supplies the
 * draft lists (from listDraftsRemote + idbListDrafts) and the icon/label chrome.
 *
 * A "draft row" here is { draftId, studioId, savedAt, payload, source } where
 * source is 'local' | 'remote' | 'both' (drives the sync-status pill).
 */

// Human labels for every studioId the Universal Draft Manager persists under.
// TOOL_META (teacherLibraryService.js) covers most of these but pulls in
// Firebase and lacks the SBA ids, so we keep an independent map here.
export const STUDIO_LABELS = {
  worksheet: 'Worksheet',
  notes: 'Teacher Notes',
  homework: 'Homework',
  rubric: 'Rubric',
  scheme_of_work: 'Scheme of Work',
  flashcards: 'Flashcards',
  sba_task: 'SBA Task',
  lesson_plan: 'Lesson Plan',
  record_of_work: 'Record of Work',
  mark_schedule: 'Mark Schedule',
  class_timetable: 'Class Timetable',
  weekly_forecast: 'Weekly Forecast',
  sba_tracker: 'SBA Mark Tracker',
  sba_planner: 'SBA Year Planner',
}

export function studioLabel(studioId) {
  return STUDIO_LABELS[studioId] || String(studioId || 'Draft').replace(/_/g, ' ')
}

// Studios whose route path isn't the plain `_`→`-` transform of the studioId.
const ROUTE_OVERRIDES = {
  sba_task: '/teacher/generate/sba',
  // The Lesson Plan Studio moved into the dashboard shell at the canonical
  // /teacher/lesson-plans routes (the legacy generate path is a redirect).
  lesson_plan: '/teacher/lesson-plans/new',
}
// The two studios that key a draft per (subject, grade) via a composite draftId.
const SBA_COMBO_STUDIOS = new Set(['sba_tracker', 'sba_planner'])

function baseRoute(studioId) {
  return ROUTE_OVERRIDES[studioId] || `/teacher/generate/${String(studioId || '').replace(/_/g, '-')}`
}

/**
 * The route that resumes a draft. Navigating to a studio auto-offers recovery
 * on mount (draftIds are stable). SBA tracker/planner key by (subject, grade),
 * so we deep-link those two coordinates from the composite draftId
 * (`<studioId>-<subject>-<grade>`, subject may contain hyphens → split on the
 * LAST hyphen) so the studio opens on the right combo.
 */
export function resumeRoute(studioId, draftId) {
  const base = baseRoute(studioId)
  if (SBA_COMBO_STUDIOS.has(studioId) && typeof draftId === 'string') {
    const prefix = `${studioId}-`
    if (draftId.startsWith(prefix)) {
      const rest = draftId.slice(prefix.length) // "<subject>-<grade>"
      const cut = rest.lastIndexOf('-')
      if (cut > 0) {
        const subject = rest.slice(0, cut)
        const grade = rest.slice(cut + 1)
        const qs = new URLSearchParams({ subject, grade }).toString()
        return `${base}?${qs}`
      }
    }
  }
  return base
}

const GRADE_LABEL = (g) => {
  const s = String(g || '')
  if (/^G\d+$/.test(s)) return `Grade ${s.slice(1)}`
  if (/^F\d+$/.test(s)) return `Form ${s.slice(1)}`
  return s
}

const namedCount = (list, key = 'name') =>
  (Array.isArray(list) ? list : []).filter((x) => x && String(x[key] || '').trim()).length

/**
 * A best-effort one-line summary of a draft's content, from whatever shape the
 * studio persisted. Returns '' when nothing meaningful is present (the caller
 * falls back to the studio label).
 */
export function summarizeDraft(studioId, payload) {
  const p = payload || {}
  const grade = p.curr?.grade || p.lessonDetails?.grade || p.header?.grade || p.form?.grade || p.grade
  const subject =
    p.curr?.subjectLabel || p.curr?.subject ||
    p.lessonDetails?.subject || p.header?.subject || p.form?.subject || p.subjectLabel
  const topic = p.curr?.topic || p.topicData?.topic || p.form?.topic

  const bits = []
  if (grade) bits.push(GRADE_LABEL(grade))
  if (subject) bits.push(String(subject))
  if (topic) bits.push(String(topic))
  if (bits.length) return bits.join(' · ')

  // Content-count fallbacks for the hand-built / SBA studios with no header meta.
  if (Array.isArray(p.weeks) && p.weeks.length) return `${p.weeks.length} week${p.weeks.length === 1 ? '' : 's'}`
  const pupils = namedCount(p.pupils)
  if (pupils) return `${pupils} pupil${pupils === 1 ? '' : 's'}`
  if (p.statuses && Object.keys(p.statuses).length) return `${Object.keys(p.statuses).length} tasks planned`
  if (p.slots && Object.keys(p.slots).length) return `${Object.keys(p.slots).length} lessons placed`
  return ''
}

function normalizeRow(row) {
  return {
    draftId: row.draftId,
    studioId: row.studioId,
    savedAt: Number(row.savedAt) || Number(row.payload?.savedAt) || 0,
    payload: row.payload || null,
  }
}

/**
 * Merge the local (IndexedDB) and remote (Firestore) draft lists into one row
 * per draftId, freshest wins, tagged with a `source` for the sync pill. Sorted
 * newest-first.
 */
export function mergeDraftLists(local = [], remote = []) {
  const map = new Map()
  for (const r of remote) {
    if (!r?.draftId) continue
    map.set(r.draftId, { ...normalizeRow(r), source: 'remote' })
  }
  for (const l of local) {
    if (!l?.draftId) continue
    const ln = normalizeRow(l)
    const cur = map.get(l.draftId)
    if (!cur) { map.set(l.draftId, { ...ln, source: 'local' }); continue }
    const freshest = ln.savedAt >= cur.savedAt ? ln : cur
    map.set(l.draftId, {
      ...freshest,
      draftId: l.draftId,
      studioId: freshest.studioId || cur.studioId,
      source: 'both',
    })
  }
  return Array.from(map.values()).sort((a, b) => b.savedAt - a.savedAt)
}

/** Copy for the sync-status pill. */
export function syncStatus(source) {
  if (source === 'remote' || source === 'both') return { label: 'Synced', icon: '☁️' }
  return { label: 'On this device only', icon: '💾' }
}
