import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { getClassPerformanceSeries } from '../../../utils/classPerformance'
import {
  listMyGenerations,
  summarizeGenerations,
  titleForGeneration,
} from '../../../utils/teacherLibraryService'
import { isExamPaperType, assessmentEditPath } from '../paperTaxonomy'
import { buildWeekPrep } from '../../../utils/prepareThisWeek'
import { buildProfileRecommendations } from '../../../utils/teacherRecommendations'
import { useTeachingProfile } from '../../../features/teacherSettings/lib/useTeachingProfile'
import { resolveActiveAssignmentId } from '../../../utils/teachingProfileCore'
import {
  daysUntil,
  fmtDate,
  getActiveTerm,
  getCurrentForecastWeek,
  getNextTerm,
} from '../../../utils/moeCalendar'
import {
  activityFromResources,
  activitySeriesFromResources,
  checklistFromWeekPrep,
  documentsFromResources,
  feedFromState,
  firstNameOf,
  initialsOf,
  lastOpenedFromResources,
  studioSavedCounts,
  termChipLabel,
} from './dashboardV2Data'

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  return new Date(t).getTime() || 0
}

/**
 * Fetches + derives the live view model for Teacher Dashboard V2.
 *
 * Reads the SAME sources the legacy dashboard used — one generations fetch,
 * one assessments fetch, the Teaching Profile, and the MoE calendar — then
 * derives every card's props through the pure helpers in dashboardV2Data.js.
 */
export default function useTeacherDashboardData() {
  const { currentUser, userProfile } = useAuth()
  const { getMyAssessments } = useFirestore()

  const [generations, setGenerations] = useState([])
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  const [gensError, setGensError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // Real class-performance series (Your Class vs platform average) — the
  // chart's preferred data. Fetched once (session-cached client-side);
  // null until it arrives or when the teacher has no chartable class data,
  // in which case the chart falls back to the documents-created trend.
  const [classPerformance, setClassPerformance] = useState(null)
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    getClassPerformanceSeries()
        .then((data) => {
          if (!cancelled && data?.hasData) setClassPerformance(data)
        })
        .catch(() => { /* baseline chart still renders from activity */ })
    return () => { cancelled = true }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    async function load() {
      let gensFailed = false
      const [gens, papers] = await Promise.all([
        listMyGenerations({ uid: currentUser.uid }).catch(() => { gensFailed = true; return [] }),
        getMyAssessments(currentUser.uid).catch(() => []),
      ])
      if (cancelled) return
      setGenerations(gens)
      setAssessments(papers)
      setGensError(gensFailed)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentUser, getMyAssessments, reloadKey])

  // Same normalized resource shape the legacy dashboard used — newest first.
  const resources = useMemo(() => {
    const fromGens = generations.map((g) => ({
      id: g.id,
      tool: g.tool,
      subject: g.inputs?.subject || g.output?.header?.subject || '',
      grade: g.inputs?.grade || g.output?.header?.grade || '',
      createdAt: toMs(g.createdAt),
      modifiedAt: 0,
      title: titleForGeneration(g),
      to: `/teacher/library/${g.id}`,
      status: 'ready',
      questionCount: 0,
    }))
    const fromAssessments = assessments.map((a) => {
      const isExam = isExamPaperType(a.assessmentType)
      return {
        id: a.id,
        tool: 'assessment',
        subject: a.subject || '',
        grade: a.grade || a.targetGrade || '',
        createdAt: toMs(a.createdAt),
        modifiedAt: toMs(a.updatedAt),
        title: a.title || a.topic || `Untitled ${isExam ? 'exam' : 'test'} paper`,
        to: assessmentEditPath(a),
        status: (typeof a.questionCount === 'number' && a.questionCount > 0) ? 'ready' : 'draft',
        questionCount: typeof a.questionCount === 'number' ? a.questionCount : 0,
      }
    })
    return [...fromGens, ...fromAssessments].sort((a, b) => b.createdAt - a.createdAt)
  }, [generations, assessments])

  // Teaching context (active assignment → subject/grade) for weekly prep +
  // recommendations; mirrors the legacy dashboard's resolution order.
  const teachingProfile = useTeachingProfile()
  const activeAssignments = useMemo(
    () => teachingProfile.assignments.filter((a) => a.isActive),
    [teachingProfile.assignments],
  )
  const activeAssignment = useMemo(() => {
    if (!activeAssignments.length) return null
    const { id } = resolveActiveAssignmentId(teachingProfile.profile, activeAssignments, {})
    return (id && activeAssignments.find((a) => a.id === id)) || activeAssignments[0]
  }, [activeAssignments, teachingProfile.profile])

  const profileSubject = activeAssignment?.subject || userProfile?.subject || ''
  const profileGrade = activeAssignment?.grade || ''

  // MoE calendar context (holiday-aware) — computed once per mount.
  const prepCalendar = useMemo(() => {
    const wk = getCurrentForecastWeek()
    if (!wk) return null
    const calendar = { ...wk, isActiveTermNow: Boolean(getActiveTerm()) }
    if (!calendar.isActiveTermNow) {
      const next = getNextTerm()
      if (next) {
        calendar.openLabel = fmtDate(next.term.open, 'full')
        calendar.daysToOpen = daysUntil(next.term.open)
      }
    }
    return calendar
  }, [])

  const weekPrep = useMemo(
    () => buildWeekPrep({
      generations,
      calendar: prepCalendar,
      profileSubject,
      profileGrade,
      preferredSubject: profileSubject,
      activeAssignment,
      now: Date.now(),
    }),
    [generations, prepCalendar, profileSubject, profileGrade, activeAssignment],
  )

  const recommendations = useMemo(
    () => buildProfileRecommendations({
      generations,
      assessments,
      calendar: prepCalendar,
      assignments: activeAssignments,
      profileSubject,
      profileGrade,
      preferredSubject: profileSubject,
    }),
    [generations, assessments, prepCalendar, activeAssignments, profileSubject, profileGrade],
  )

  const librarySummary = useMemo(() => summarizeGenerations(generations), [generations])

  const displayName = userProfile?.displayName || currentUser?.displayName || ''
  const teacher = useMemo(() => ({
    name: displayName || 'Teacher',
    firstName: firstNameOf(displayName),
    shortName: firstNameOf(displayName),
    initials: initialsOf(displayName),
    role: 'Teacher',
    email: userProfile?.email || currentUser?.email || '',
  }), [displayName, userProfile?.email, currentUser?.email])

  const now = Date.now()
  // Chips showing which teaching context the recommendations were built for.
  const recContext = {
    grade: String(profileGrade || '').trim() || null,
    subject: String(profileSubject || '').replace(/_/g, ' ').trim() || null,
  }
  const recommendationCards = recommendations.slice(0, 3).map((r, i) => ({
    id: r.id,
    title: r.title,
    text: r.text,
    actionLabel: r.actionLabel,
    to: r.to,
    context: i === 0 && (recContext.grade || recContext.subject) ? recContext : null,
  }))

  return {
    teacher,
    loading,
    termChip: termChipLabel(prepCalendar, now),
    lastOpened: lastOpenedFromResources(resources, now),
    documents: documentsFromResources(resources, { limit: 5, now }),
    savedCounts: gensError ? null : studioSavedCounts(librarySummary.byTool, assessments.length),
    checklist: checklistFromWeekPrep(weekPrep),
    feed: feedFromState({ resources, gensError, now }),
    activity: activityFromResources(resources, { limit: 3, now }),
    series: activitySeriesFromResources(resources, { now, weeks: 5 }),
    classPerformance,
    recommendations: recommendationCards,
    reload,
  }
}
