// Shared progress derivation for the Progress & Performance card + detail panel.
// One place that fetches recent results (+ live gamification stats) and derives
// every figure the UI shows, plus deterministic "smart" insight lines. No AI
// call — every number and nudge is computed from real data, so it never lies.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useLearnerFirestore } from '../../../hooks/useLearnerFirestore'
import useLearnerStats from '../../../hooks/useLearnerStats'
import { SUBJECT_MAP } from '../../../config/curriculum'

export function subjectLabel(id) {
  return SUBJECT_MAP?.[id]?.label || (id ? String(id).replace(/_/g, ' ') : 'General')
}

function toDate(value) {
  if (!value) return null
  const d = value?.toDate?.() ?? new Date(value)
  return Number.isNaN(d?.getTime?.()) ? null : d
}

function daysSince(date) {
  if (!date) return Infinity
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

// Pure: turn results + a weakness list into up to 3 friendly insight lines.
// Each line is { emoji, text, tone } where tone is a hex used for the accent.
export function computeInsights(results, weakness) {
  const out = []
  const bySubject = {}
  for (const r of results) {
    const s = r.subject || r.subjectId || 'general'
    const when = toDate(r.completedAt || r.createdAt)
    if (!bySubject[s]) bySubject[s] = { pcts: [], last: null, order: [] }
    bySubject[s].pcts.push(Number(r.percentage) || 0)
    bySubject[s].order.push({ pct: Number(r.percentage) || 0, when })
    if (when && (!bySubject[s].last || when > bySubject[s].last)) bySubject[s].last = when
  }

  // Weakest subject → "struggling" nudge.
  const subjectAverages = Object.entries(bySubject).map(([s, v]) => ({
    subject: s,
    avg: Math.round(v.pcts.reduce((a, b) => a + b, 0) / v.pcts.length),
  }))
  const weakest = [...subjectAverages].sort((a, b) => a.avg - b.avg)[0]
  if (weakest && weakest.avg < 60) {
    out.push({ emoji: '🎯', tone: '#ef4444', text: `You're finding ${subjectLabel(weakest.subject)} tricky — a short practice could lift it.` })
  }

  // Quiet subject → "haven't practised in N days".
  const quiet = Object.entries(bySubject)
    .map(([s, v]) => ({ subject: s, gap: daysSince(v.last) }))
    .filter((x) => x.gap >= 5 && x.gap < 1000)
    .sort((a, b) => b.gap - a.gap)[0]
  if (quiet) {
    out.push({ emoji: '⏰', tone: '#f59e0b', text: `You haven't practised ${subjectLabel(quiet.subject)} in ${quiet.gap} days.` })
  }

  // Improving subject → compare newer half vs older half.
  for (const [s, v] of Object.entries(bySubject)) {
    if (v.order.length < 4) continue
    const ordered = v.order.filter((o) => o.when).sort((a, b) => a.when - b.when)
    if (ordered.length < 4) continue
    const mid = Math.floor(ordered.length / 2)
    const older = ordered.slice(0, mid)
    const newer = ordered.slice(mid)
    const avg = (arr) => arr.reduce((a, b) => a + b.pct, 0) / arr.length
    if (avg(newer) - avg(older) >= 8) {
      out.push({ emoji: '📈', tone: '#22c55e', text: `You're improving in ${subjectLabel(s)} — keep it up!` })
      break
    }
  }

  // Best revision topic from the weakness list.
  const topic = Array.isArray(weakness) ? weakness[0] : null
  if (topic && out.length < 3) {
    out.push({ emoji: '💡', tone: '#2563eb', text: `Today's best revision topic is ${topic.topic}.` })
  }

  // Reachable target — encouraging headline when we have an average.
  if (out.length < 3 && subjectAverages.length) {
    const overall = Math.round(subjectAverages.reduce((a, b) => a + b.avg, 0) / subjectAverages.length)
    const target = Math.min(95, overall + 7)
    if (target > overall) out.push({ emoji: '🚀', tone: '#7c3aed', text: `You can reach ${target}% this week — you're close.` })
  }

  return out.slice(0, 3)
}

export default function useProgressData() {
  const { userProfile, currentUser } = useAuth()
  const { getUserResults, getWeaknessAnalysis } = useLearnerFirestore()
  const { stats, level } = useLearnerStats(currentUser?.uid)
  const [results, setResults] = useState([])
  const [weakness, setWeakness] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const uid = currentUser?.uid
    if (!uid) { setLoading(false); return undefined }
    let cancelled = false
    setLoading(true)
    Promise.all([
      getUserResults(uid, 100).catch(() => []),
      getWeaknessAnalysis(uid).catch(() => []),
    ]).then(([r, w]) => {
      if (cancelled) return
      setResults(Array.isArray(r) ? r : [])
      setWeakness(Array.isArray(w) ? w : [])
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [currentUser?.uid, getUserResults, getWeaknessAnalysis])

  const derived = useMemo(() => {
    const pcts = results.map((r) => Number(r.percentage) || 0)
    const average = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0
    const questionsAnswered = results.reduce((sum, r) => {
      const q = Number(r.totalQuestions ?? r.questionCount ?? r.totalMarks ?? 0)
      return sum + (Number.isFinite(q) ? q : 0)
    }, 0)
    const minutes = results.reduce((sum, r) => {
      const secs = Number(r.timeSpent ?? r.durationSeconds ?? 0)
      return sum + (Number.isFinite(secs) ? secs : 0)
    }, 0) / 60

    const bySubject = {}
    for (const r of results) {
      const s = r.subject || r.subjectId || 'general'
      if (!bySubject[s]) bySubject[s] = []
      bySubject[s].push(Number(r.percentage) || 0)
    }
    const subjectAverages = Object.entries(bySubject).map(([s, arr]) => ({
      subject: s,
      avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    }))
    const sorted = [...subjectAverages].sort((a, b) => b.avg - a.avg)
    const strongest = sorted[0] || null
    const weakest = sorted.length > 1 ? sorted[sorted.length - 1] : null

    const weakCount = weakness.filter((t) => (Number(t.percentage) || 0) < 50).length
    const strongCount = weakness.filter((t) => (Number(t.percentage) || 0) >= 75).length

    return {
      average,
      questionsAnswered,
      testsCompleted: results.length,
      subjectsEnrolled: subjectAverages.length,
      strongest,
      weakest,
      weakCount,
      strongCount,
      studyMinutes: Math.round(minutes),
    }
  }, [results, weakness])

  const insights = useMemo(() => computeInsights(results, weakness), [results, weakness])

  const streak = stats?.currentStreak ?? userProfile?.currentStreak ?? 0
  const examsCompleted = stats?.examsCompleted ?? 0
  const grade = userProfile?.grade ?? null

  return { loading, results, weakness, derived, insights, stats, level, streak, examsCompleted, grade }
}
