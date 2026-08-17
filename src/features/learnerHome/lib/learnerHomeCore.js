/**
 * learnerHomeCore — pure decision logic for the learner home experience.
 *
 * Everything here is deliberately dependency-free (no React, no Firebase,
 * no browser globals) so it runs under plain `node` in
 * `scripts/test-learner-home-core.mjs` and stays honest about inputs:
 * every function takes plain data and returns plain data. The
 * useLearnerDashboard hook is the only place that knows where the data
 * comes from (Firestore / localStorage / config).
 */

import { isMockPaperRecord } from '../../../utils/paperProvenance.js'

// ── Greeting ────────────────────────────────────────────────────────

export function getGreeting(hour) {
  const h = Number.isFinite(hour) ? hour : 12
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function firstNameOf(displayName) {
  if (typeof displayName !== 'string') return ''
  const trimmed = displayName.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0]
}

// ── Active term resolution ──────────────────────────────────────────
//
// Fallback order (spec §8): school-configured term → MoE/platform
// calendar → learner's last selected term → Term 1. Never hard-coded.

export function resolveActiveTerm({ schoolTerm, calendarTerm, savedTerm } = {}) {
  const valid = (t) => Number.isInteger(t) && t >= 1 && t <= 3
  if (valid(schoolTerm)) return { term: schoolTerm, source: 'school' }
  if (valid(calendarTerm)) return { term: calendarTerm, source: 'calendar' }
  if (valid(savedTerm)) return { term: savedTerm, source: 'saved' }
  return { term: 1, source: 'default' }
}

/** Normalize a term value from Firestore docs ('Term 1', '1', 1) → 1|2|3|null */
export function normalizeTerm(value) {
  if (value == null) return null
  if (Number.isInteger(value)) return value >= 1 && value <= 3 ? value : null
  const m = String(value).match(/([123])/)
  return m ? Number(m[1]) : null
}

// ── Learning resume selection ───────────────────────────────────────
//
// "Continue where you left off" resumes READING:
//   1. recently opened note      (noteProgress in-progress, then opened)
//   2. in-progress lesson        (the legacy slide player)
//   3. recommended next current-term item
//
// QUIZZES ARE NOT RESUMED HERE, and that is the fix rather than an
// omission. The card used to rank an in-progress quiz above every note,
// so a learner who had never deliberately opened one was met with
// "5.5 Metals and Non-metals — Practice Quiz · Continue quiz" on their
// home screen — a half-finished quiz session, surfaced as the single
// thing the app thought they were in the middle of. The prototype's card
// is a note ("1.1 The Digestive System · Continue learning"), and quizzes
// have their own front door in Today's Quiz. One card, one meaning.
//
// Each candidate: { kind, id, title, subject, grade, term, topic, percent,
//                   openedAt (ms), status }
// `grade` on the candidate must match the learner's grade — wrong-grade,
// completed, or unpublished candidates are filtered here.

const RESUME_PRIORITY = ['note', 'lesson', 'recommended']

/** Kinds this card will never resume into. See above. */
const RESUME_EXCLUDED_KINDS = new Set(['quiz', 'assignment'])

export function pickLearningResume(candidates, { grade } = {}) {
  if (!Array.isArray(candidates)) return null
  const eligible = candidates.filter((c) => {
    if (!c || !c.kind || !c.id) return false
    if (RESUME_EXCLUDED_KINDS.has(c.kind)) return false
    if (c.status === 'completed' || (Number(c.percent) || 0) >= 100) return false
    if (c.unpublished) return false
    if (grade != null && c.grade != null && String(c.grade) !== String(grade)) return false
    return true
  })
  if (!eligible.length) return null
  const rank = (c) => {
    const idx = RESUME_PRIORITY.indexOf(c.kind)
    return idx === -1 ? RESUME_PRIORITY.length : idx
  }
  eligible.sort((a, b) => {
    const byKind = rank(a) - rank(b)
    if (byKind !== 0) return byKind
    return (b.openedAt || 0) - (a.openedAt || 0)
  })
  return eligible[0]
}

// ── Recent activity ─────────────────────────────────────────────────
//
// Dedup key (spec §17): type + source resource id + attempt id +
// completion timestamp. Never the same attempt twice.

export function activityKey(item) {
  return [item.type || '', item.sourceId || '', item.attemptId || '', item.completedAt || ''].join('|')
}

export function buildRecentActivity(items, { limit = 3 } = {}) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const out = []
  const sorted = [...items]
    .filter((i) => i && i.type && (i.completedAt || i.openedAt))
    .sort((a, b) => (b.completedAt || b.openedAt || 0) - (a.completedAt || a.openedAt || 0))
  for (const item of sorted) {
    const key = activityKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

export function relativeTime(ts, now) {
  const t = Number(ts)
  const ref = Number(now) || Date.now()
  if (!Number.isFinite(t) || t <= 0) return ''
  const diff = Math.max(0, ref - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  return new Date(t).toLocaleDateString()
}

// ── Subject progress (weighted completion, spec §14) ────────────────
//
// Completion ≠ scores. Weighted model over what we can actually
// measure today:
//   notes read           45%  (noteProgress completed / published notes)
//   topic quiz coverage  45%  (topics with ≥1 completed quiz / topics)
//   daily-exam taken     10%  (any daily exam completed this term)
// Components with no denominator are excluded and the weights are
// renormalised, so a subject with no notes yet isn't stuck at 45% max.

export function computeSubjectCompletion({ notesRead, notesTotal, topicsAttempted, topicsTotal, examsDone, examsExpected } = {}) {
  const parts = []
  if (Number(notesTotal) > 0) parts.push({ w: 0.45, v: Math.min(1, Number(notesRead || 0) / Number(notesTotal)) })
  if (Number(topicsTotal) > 0) parts.push({ w: 0.45, v: Math.min(1, Number(topicsAttempted || 0) / Number(topicsTotal)) })
  if (Number(examsExpected) > 0) parts.push({ w: 0.10, v: Math.min(1, Number(examsDone || 0) / Number(examsExpected)) })
  const totalW = parts.reduce((s, p) => s + p.w, 0)
  if (totalW <= 0) return 0
  const score = parts.reduce((s, p) => s + p.w * p.v, 0) / totalW
  return Math.round(score * 100)
}

// ── Recommendations (spec §15) ──────────────────────────────────────
//
// Inputs are pre-aggregated signals; every recommendation carries a
// human-readable reason. Eligibility filters mirror the spec: never
// wrong grade/curriculum, never completed, never unpublished, no
// duplicates.

export function buildRecommendations({ weakTopics = [], resumeCandidates = [], nextTermItems = [], grade } = {}, { limit = 3 } = {}) {
  const out = []
  const seen = new Set()
  const push = (rec) => {
    if (!rec || !rec.id || seen.has(rec.id)) return
    if (grade != null && rec.grade != null && String(rec.grade) !== String(grade)) return
    if (rec.completed || rec.unpublished) return
    seen.add(rec.id)
    out.push(rec)
  }

  // 1. Weak topics (low quiz scores) — strongest signal.
  for (const w of weakTopics) {
    if (!w || !w.topic || !Number.isFinite(w.percent)) continue
    if (w.percent >= 60) continue
    push({
      id: `weak:${w.subject}:${w.topic}`,
      kind: 'practice',
      title: `Improve in ${w.topicLabel || w.topic}`,
      subject: w.subject,
      subjectLabel: w.subjectLabel,
      topic: w.topic,
      grade: w.grade,
      quizId: w.quizId || null,
      reason: `You scored ${Math.round(w.percent)}% in ${w.topicLabel || w.topic} — a focused practice can lift it.`,
    })
    if (out.length >= limit) return out.slice(0, limit)
  }

  // 2. Started but unfinished material.
  for (const c of resumeCandidates) {
    if (!c || !c.id || c.status === 'completed') continue
    push({
      id: `resume:${c.kind}:${c.id}`,
      kind: c.kind,
      title: c.title,
      subject: c.subject,
      subjectLabel: c.subjectLabel,
      grade: c.grade,
      targetId: c.id,
      reason: c.kind === 'note' ? 'You started reading these notes but haven’t finished.' : 'You started this but haven’t finished.',
    })
    if (out.length >= limit) return out.slice(0, limit)
  }

  // 3. Fallback: next incomplete current-term item.
  for (const n of nextTermItems) {
    if (!n || !n.id) continue
    push({
      id: `next:${n.kind}:${n.id}`,
      kind: n.kind,
      title: n.title,
      subject: n.subject,
      subjectLabel: n.subjectLabel,
      grade: n.grade,
      targetId: n.id,
      reason: 'Next up in your current term.',
    })
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}

// ── Weak-topic extraction from results ──────────────────────────────
//
// results docs carry topicScores: { [topic]: { correct, total } }.
// Aggregate across recent results per subject+topic; a topic qualifies
// as weak when it has ≥ minAttempted answered questions and < 60%.
//
// MOCK PAPERS ARE EXCLUDED. A past-paper quiz built from a PRISCA or school
// mock is written to a different standard from the real ECZ examination, so
// pooling both under one subject+topic average produces advice about a paper
// the learner will never sit. `paperIsOfficial` is stamped by the past-paper
// quiz converter (src/utils/paperToQuizConverter.js) and by the Past Paper
// Studio when it links a quiz.
//
// Absence is treated as ELIGIBLE, deliberately. The overwhelming majority of
// results come from ordinary CBC practice quizzes that have no paper behind
// them at all and never will; reading "no flag" as "a mock" would silently
// empty every learner's recommendations. Only a result that positively states
// it came from a non-official paper is dropped.

// The rule itself lives in src/utils/paperProvenance.js — `useFirestore`'s
// getWeaknessAnalysis applies the same one, and a feature-internal copy is how
// two aggregations of the same data end up disagreeing about what counts.

export function extractWeakTopics(results, { minAttempted = 4, excludeMocks = true } = {}) {
  const agg = new Map()
  for (const r of Array.isArray(results) ? results : []) {
    if (excludeMocks && isMockPaperRecord(r)) continue
    const scores = r && r.topicScores
    if (!scores || typeof scores !== 'object') continue
    for (const [topic, s] of Object.entries(scores)) {
      if (!s || !Number(s.total)) continue
      const key = `${r.subject || ''}|${topic}`
      const cur = agg.get(key) || { subject: r.subject, grade: r.grade, topic, correct: 0, total: 0 }
      cur.correct += Number(s.correct) || 0
      cur.total += Number(s.total) || 0
      agg.set(key, cur)
    }
  }
  return [...agg.values()]
    .filter((t) => t.total >= minAttempted)
    .map((t) => ({ ...t, percent: (t.correct / t.total) * 100 }))
    .filter((t) => t.percent < 60)
    .sort((a, b) => a.percent - b.percent)
}

// ── Official exam countdown (spec §12) ──────────────────────────────
//
// Phase machine over a list of sessions [{ startsAt, endsAt, label }]
// (ms timestamps, already timezone-resolved):
//   upcoming  → next session in the future, countdown to it
//   in_progress → a session is running now
//   completed → all sessions ended
//   none      → no timetable data

export function getExamCountdownState(sessions, nowMs) {
  const now = Number(nowMs) || Date.now()
  const list = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && Number.isFinite(s.startsAt))
    .sort((a, b) => a.startsAt - b.startsAt)
  if (!list.length) return { phase: 'none' }
  const current = list.find((s) => s.startsAt <= now && Number.isFinite(s.endsAt) && s.endsAt > now)
  if (current) return { phase: 'in_progress', session: current }
  const next = list.find((s) => s.startsAt > now)
  if (next) return { phase: 'upcoming', session: next, msRemaining: next.startsAt - now }
  return { phase: 'completed' }
}

export function countdownParts(msRemaining) {
  const ms = Math.max(0, Number(msRemaining) || 0)
  const totalMinutes = Math.floor(ms / 60000)
  return {
    days: Math.floor(totalMinutes / (60 * 24)),
    hours: Math.floor(totalMinutes / 60) % 24,
    minutes: totalMinutes % 60,
    seconds: Math.floor(ms / 1000) % 60,
  }
}

// ── Today's exams summary (spec §11) ────────────────────────────────
//
// exams: [{ examId, subject, questionCount, durationMinutes }]
// locks: { [subject]: { status } } from daily_exam_locks.
// Availability itself stays server-validated (startExam) — this only
// shapes the card.

export function buildTodaysExamsSummary(exams, locks) {
  const list = Array.isArray(exams) ? exams.filter((e) => e && e.examId) : []
  if (!list.length) return { hasExams: false, available: 0, completed: 0, total: 0, next: null }
  const lockFor = (subject) => (locks && locks[subject]) || null
  let completed = 0
  let next = null
  let inProgress = null
  for (const exam of list) {
    const lock = lockFor(exam.subject)
    if (lock && lock.status === 'submitted') { completed += 1; continue }
    if (lock && lock.status === 'in_progress' && !inProgress) { inProgress = exam; continue }
    if (!next) next = exam
  }
  // Resuming an interrupted attempt beats starting a fresh one.
  const target = inProgress || next
  return {
    hasExams: true,
    total: list.length,
    completed,
    available: list.length - completed,
    next: target ? { ...target, resume: Boolean(inProgress) } : null,
    allDone: completed >= list.length,
  }
}

// ── Topic ↔ term mapping for the subject page (spec §9) ─────────────
//
// Curriculum topics carry no term today; quizzes carry {topic, term}
// and notes carry {term}. Derive each topic's term by majority vote of
// its quizzes' term tags. Topics with no signal go to every term
// (`term: null`) rather than being invented into one.

export function deriveTopicTerms(quizzes) {
  const votes = new Map()
  for (const q of Array.isArray(quizzes) ? quizzes : []) {
    const topic = q && q.topic
    const term = normalizeTerm(q && q.term)
    if (!topic || !term) continue
    const t = votes.get(topic) || { 1: 0, 2: 0, 3: 0 }
    t[term] += 1
    votes.set(topic, t)
  }
  const out = new Map()
  for (const [topic, t] of votes) {
    const best = [1, 2, 3].reduce((a, b) => (t[b] > t[a] ? b : a), 1)
    if (t[best] > 0) out.set(topic, best)
  }
  return out
}

export function topicsForTerm(allTopics, topicTerms, term) {
  const topics = Array.isArray(allTopics) ? allTopics : []
  if (!topicTerms || topicTerms.size === 0) return topics // no term data → full syllabus on every tab
  return topics.filter((t) => {
    const assigned = topicTerms.get(typeof t === 'string' ? t : t.id)
    return assigned == null || assigned === term
  })
}

// ── "This week" counting (Profile page, prototype-v6) ───────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Firestore Timestamp | {seconds} | date-ish → epoch ms, or null. */
export function timestampMillis(v) {
  if (!v) return null
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** How many rows carry `field` within the last 7 days. Undated rows never count. */
export function countThisWeek(rows, field, now = Date.now()) {
  const cutoff = now - WEEK_MS
  return (rows || []).reduce((n, row) => {
    const t = timestampMillis(row?.[field])
    return t != null && t >= cutoff ? n + 1 : n
  }, 0)
}
