// Learning Dashboard panel — a read-only progress snapshot built from real
// learner data (gamification stats + recent results). Progress rings + stat
// tiles; a deterministic study recommendation derived from the weakest subject
// (no AI call — honest and instant).

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import useLearnerStats from '../../../hooks/useLearnerStats'
import { SUBJECT_MAP } from '../../../config/curriculum'
import { Panel, Section, Stat, ProgressRing, Note } from '../components/ui'

function subjectLabel(id) {
  return SUBJECT_MAP?.[id]?.label || (id ? String(id) : 'General')
}

export default function DashboardPanel({ section }) {
  const { userProfile, currentUser } = useAuth()
  const { getUserResults } = useFirestore()
  const { stats } = useLearnerStats(currentUser?.uid)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const uid = currentUser?.uid
    if (!uid) { setLoading(false); return }
    let cancelled = false
    getUserResults(uid, 100)
      .then((r) => { if (!cancelled) { setResults(Array.isArray(r) ? r : []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser?.uid, getUserResults])

  const derived = useMemo(() => {
    const pcts = results.map((r) => Number(r.percentage) || 0)
    const average = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0
    // Per-subject averages for strongest / weakest.
    const bySubject = {}
    for (const r of results) {
      const s = r.subject || r.subjectId || 'general'
      if (!bySubject[s]) bySubject[s] = []
      bySubject[s].push(Number(r.percentage) || 0)
    }
    const subjectAverages = Object.entries(bySubject).map(([s, arr]) => ({
      subject: s,
      avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      count: arr.length,
    }))
    const sorted = [...subjectAverages].sort((a, b) => b.avg - a.avg)
    const strongest = sorted[0] || null
    const weakest = sorted.length > 1 ? sorted[sorted.length - 1] : null
    // Study minutes — sum any per-result time field we have.
    const minutes = results.reduce((sum, r) => {
      const secs = Number(r.timeSpent ?? r.durationSeconds ?? 0)
      return sum + (Number.isFinite(secs) ? secs : 0)
    }, 0) / 60
    return {
      average,
      testsCompleted: results.length,
      subjectsEnrolled: subjectAverages.length,
      strongest,
      weakest,
      studyMinutes: Math.round(minutes),
    }
  }, [results])

  const streak = stats?.currentStreak ?? userProfile?.currentStreak ?? 0
  const examsCompleted = stats?.examsCompleted ?? 0
  const studyLabel = derived.studyMinutes >= 60
    ? `${Math.round(derived.studyMinutes / 60)}h`
    : `${derived.studyMinutes}m`

  const recommendation = derived.weakest
    ? `Spend a little more time on ${subjectLabel(derived.weakest.subject)} — your average there is ${derived.weakest.avg}%. Try a short practice quiz to lift it.`
    : derived.testsCompleted === 0
      ? 'Take your first quiz to start building your progress picture.'
      : "You're doing well across the board — keep your streak going with a daily quiz."

  return (
    <Panel section={section}>
      <Section title="Progress" hint={loading ? 'Loading your latest results…' : 'Based on your recent quizzes and exams.'}>
        <div className="lset-progress-rings" style={{ marginBottom: 18 }}>
          <ProgressRing value={derived.average} sublabel="Quiz average" />
          <ProgressRing
            value={Math.min(100, streak * 10)}
            label={String(streak)}
            sublabel="Day streak"
          />
          <ProgressRing
            value={Math.min(100, derived.average)}
            label={derived.average >= 75 ? 'A' : derived.average >= 50 ? 'B' : 'C'}
            sublabel="Overall grade"
          />
        </div>
        <div className="lset-stats">
          <Stat value={`${derived.average}%`} label="Quiz average" accent />
          <Stat value={derived.testsCompleted} label="Tests completed" />
          <Stat value={examsCompleted} label="Exams completed" />
          <Stat value={streak} label="Current streak" />
          <Stat value={studyLabel} label="Total study time" />
          <Stat value={derived.subjectsEnrolled} label="Subjects" />
        </div>
      </Section>

      <Section title="Strengths & focus areas">
        <div className="lset-stats">
          <Stat value={derived.strongest ? subjectLabel(derived.strongest.subject) : '—'} label="Strongest subject" />
          <Stat value={derived.weakest ? subjectLabel(derived.weakest.subject) : '—'} label="Needs practice" />
        </div>
      </Section>

      <Section title="Study recommendation" hint="A quick nudge based on your results.">
        <Note tone="accent">💡 {recommendation}</Note>
      </Section>
    </Panel>
  )
}
