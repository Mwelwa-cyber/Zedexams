/**
 * progressCore — the numbers behind My Progress and the Study Plan.
 *
 * Pure: no DOM, no React, no Firebase. Everything here is derived from
 * data the learner dashboard already loads (subject completion, quiz
 * results, note progress, the learner's streak).
 *
 * ONE RULE RUNS THROUGH ALL OF IT: nothing is displayed that is not
 * measured. The prototype's progress screen shows "3h 20m this week" and
 * a chart captioned "Minutes learned each day", and the app has no time
 * tracking whatsoever — no session timer, no duration on any result or
 * note-progress document. Rendering those would mean inventing a number
 * and putting it in front of a child as fact. The chart plots what IS
 * recorded — how many things they finished each day — and is captioned
 * as that.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Firestore Timestamp | {seconds} | ms | date-ish → epoch ms, or null. */
export function toMillis(v) {
  if (!v) return null
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Exam readiness: how much of the term's material this learner has
 * actually covered, averaged across the subjects they take.
 *
 * Deliberately the mean of the SAME per-subject percentages the subject
 * rows already show, rather than a new formula. A headline number that
 * disagrees with the list directly beneath it is worse than no headline
 * at all — and a second formula is a second thing to drift.
 *
 * Returns null when there is nothing to average. The screen then says so
 * instead of printing a confident 0%.
 */
export function examReadiness(subjects) {
  const rows = (Array.isArray(subjects) ? subjects : [])
    .filter((s) => s && Number.isFinite(Number(s.percent)))
  if (rows.length === 0) return null
  const total = rows.reduce((sum, s) => sum + Math.max(0, Math.min(100, Number(s.percent))), 0)
  return Math.round(total / rows.length)
}

/**
 * The last seven days, oldest → newest, each with what the learner
 * finished that day.
 *
 * `now` is injected so this is testable without freezing the clock, and
 * days are bucketed by LOCAL midnight — a learner in Lusaka who studies
 * at 21:00 must see that on today's bar, not tomorrow's.
 */
export function weeklyActivity(events, now = Date.now()) {
  const days = []
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(start.getTime() - i * DAY_MS)
    days.push({
      key: d.toISOString().slice(0, 10),
      // Single letter, Mon–Sun, as the prototype labels them.
      letter: 'SMTWTFS'[d.getDay()],
      at: d.getTime(),
      count: 0,
      isToday: i === 0,
    })
  }
  const first = days[0].at
  for (const e of Array.isArray(events) ? events : []) {
    const t = toMillis(e && (e.completedAt || e.createdAt || e.updatedAt || e.at))
    if (t == null || t < first) continue
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    const hit = days.find((x) => x.at === d.getTime())
    if (hit) hit.count += 1
  }
  const peak = days.reduce((m, d) => Math.max(m, d.count), 0)
  // Heights are relative to the busiest day, so a quiet week still reads
  // as a shape rather than seven flat stubs. A day with nothing stays at
  // zero — it is not given a token sliver it did not earn.
  return days.map((d) => ({
    ...d,
    percent: peak > 0 && d.count > 0 ? Math.max(8, Math.round((d.count / peak) * 100)) : 0,
  }))
}

/**
 * Weak topics → the Study Plan's "focus on these first" cards.
 *
 * Worst first, because the plan is a priority order and the learner is
 * expected to start at the top. `limit` keeps it to a list a child will
 * actually work through rather than an audit of everything they have
 * ever got wrong.
 */
export function buildStudyPlan(weakTopics, { limit = 5 } = {}) {
  return (Array.isArray(weakTopics) ? weakTopics : [])
    .filter((t) => t && t.topic)
    .map((t) => ({
      topic: t.topic,
      subject: t.subject || null,
      subjectLabel: t.subjectLabel || t.subject || null,
      percent: Number.isFinite(Number(t.percent)) ? Math.round(Number(t.percent)) : null,
      missed: Number.isFinite(Number(t.total)) && Number.isFinite(Number(t.correct))
        ? Math.max(0, Number(t.total) - Number(t.correct))
        : null,
    }))
    .sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))
    .slice(0, limit)
}

/**
 * The one-line reason under a focus card.
 *
 * Says what was actually counted ("missed 3 of 8 recently"), never a
 * judgement. A topic with no numbers behind it says nothing rather than
 * "needs work", which would be an opinion dressed as data.
 */
export function focusReason(item) {
  if (!item) return ''
  const subject = item.subjectLabel || ''
  if (item.missed != null && item.missed > 0) {
    return [subject, `missed ${item.missed} recently`].filter(Boolean).join(' · ')
  }
  return subject
}

/** Whole days from `now` until `at`, or null. Never negative. */
export function daysUntil(at, now = Date.now()) {
  const t = toMillis(at)
  if (t == null) return null
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(t); end.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS))
}
