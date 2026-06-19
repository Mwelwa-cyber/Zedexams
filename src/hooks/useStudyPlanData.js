import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { usePlatformSettings } from '../contexts/PlatformSettingsContext'
import { useFirestore } from './useFirestore'
import { SUBJECTS } from '../config/curriculum'
import { computeStreak } from '../utils/streak'
import { getTodaysExamsBySubject, checkTodaysLocks } from '../utils/examService'

/**
 * Loads everything the Study Plan needs (results + streak, weak topics,
 * today's daily-exam goal, the AI-notes feature flag, the learner's grade).
 *
 * Mirrors the data GradeHub already feeds <TodayStudyPlan>, but self-contained
 * so the standalone /study-plan page can stand on its own without depending on
 * the dashboard's in-memory state. Reads fail soft to empty values.
 */
export function useStudyPlanData() {
  const { currentUser, userProfile } = useAuth()
  const { settings: platformSettings } = usePlatformSettings()
  const { getUserResults, getWeaknessAnalysis } = useFirestore()

  const [results, setResults] = useState([])
  const [weakTopics, setWeakTopics] = useState([])
  const [streak, setStreak] = useState(0)
  const [dailyGoal, setDailyGoal] = useState({ done: 0, total: 0 })
  const [loading, setLoading] = useState(true)

  const aiNotesOn = !!(platformSettings && platformSettings.learnerAi
    && platformSettings.learnerAi.showAiNotesToLearners)
  const grade = userProfile?.grade ?? null

  // Recent results (last 30 for an accurate streak) + the derived streak.
  useEffect(() => {
    if (!currentUser) {
      setResults([])
      setStreak(0)
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    getUserResults(currentUser.uid, 30).then(rows => {
      if (cancelled) return
      setResults(rows)
      setStreak(computeStreak(rows.map(r => r.completedAt ?? r.createdAt)))
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setResults([])
      setStreak(0)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [currentUser, getUserResults])

  // Weakest 3 topics under 70% — same slice GradeHub uses.
  useEffect(() => {
    if (!currentUser) {
      setWeakTopics([])
      return undefined
    }
    let cancelled = false
    getWeaknessAnalysis(currentUser.uid).then(rows => {
      if (cancelled) return
      setWeakTopics(rows.filter(r => r.percentage < 70).slice(0, 3))
    }).catch(() => { if (!cancelled) setWeakTopics([]) })
    return () => { cancelled = true }
  }, [currentUser, getWeaknessAnalysis])

  // Today's Goal — fan out across the CBC subjects for scheduled exams + locks,
  // identical to GradeHub / DailyExamsHub.
  useEffect(() => {
    if (!currentUser) {
      setDailyGoal({ done: 0, total: 0 })
      return undefined
    }
    let cancelled = false
    const g = userProfile?.grade || '5'
    Promise.all([
      getTodaysExamsBySubject(g),
      checkTodaysLocks(currentUser.uid),
    ]).then(([examMap, lockMap]) => {
      if (cancelled) return
      const rows = SUBJECTS.map(subject => ({
        exam: examMap.get(subject.label) || null,
        lock: lockMap.get(subject.label) || null,
      }))
      const scheduled = rows.filter(r => r.exam)
      const submitted = scheduled.filter(r => r.lock?.status === 'submitted')
      setDailyGoal({ done: submitted.length, total: scheduled.length })
    }).catch(() => { if (!cancelled) setDailyGoal({ done: 0, total: 0 }) })
    return () => { cancelled = true }
  }, [currentUser, userProfile?.grade])

  return { results, weakTopics, grade, streak, dailyGoal, aiNotesOn, loading }
}

export default useStudyPlanData
