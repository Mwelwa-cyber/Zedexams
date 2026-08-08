import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import {
  listMyGenerations,
  summarizeGenerations,
  titleForGeneration,
} from '../../../utils/teacherLibraryService'
import { isExamPaperType, assessmentEditPath } from '../paperTaxonomy'
import { buildWeekPrep } from '../../../utils/prepareThisWeek'
import { buildProfileRecommendations } from '../../../utils/teacherRecommendations'
import { useTeachingProfile } from '../../../features/teacherSettings/lib/useTeachingProfile'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import { resolveActiveAssignmentId } from '../../../utils/teachingProfileCore'
import {
  daysUntil,
  fmtDate,
  getActiveTerm,
  getCurrentForecastWeek,
  getNextTerm,
  getTermWeeks,
} from '../../../utils/moeCalendar'
import { getSchoolProfile } from '../../../utils/schoolProfileService'
import {
  activityFromResources,
  checklistFromWeekPrep,
  documentsFromResources,
  feedFromState,
  firstNameOf,
  launcherWarningsFromResources,
  initialsOf,
  lastOpenedFromResources,
  studioSavedCounts,
  teachingDaysLeft,
  termChipLabel,
  recommendationCardsFrom,
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
  const { filterEntries } = useStudioAvailability()

  const [generations, setGenerations] = useState([])
  const [assessments, setAssessments] = useState([])
  const [schoolName, setSchoolName] = useState('')
  const [loading, setLoading] = useState(true)
  const [gensError, setGensError] = useState(false)
  // True when the assessments fetch failed (not merely empty) — the feed shows
  // a retryable error card rather than hiding assessment papers silently.
  const [papersError, setPapersError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    async function load() {
      let gensFailed = false
      let papersFailed = false
      const [gens, papers] = await Promise.all([
        listMyGenerations({ uid: currentUser.uid }).catch(() => { gensFailed = true; return [] }),
        getMyAssessments(currentUser.uid).catch(() => { papersFailed = true; return [] }),
      ])
      if (cancelled) return
      setGenerations(gens)
      setAssessments(papers)
      setGensError(gensFailed)
      setPapersError(papersFailed)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentUser, getMyAssessments, reloadKey])

  // School name is mobile-hero branding only — loaded independently of the
  // primary reads above. A slow/failed schoolProfiles read must never hold the
  // already-fetched generations/assessments in the loading state, and it must
  // not delay desktop, which never renders the school name. A miss just leaves
  // the row hidden.
  useEffect(() => {
    if (!currentUser) return undefined
    let cancelled = false
    getSchoolProfile(currentUser.uid)
      .then((school) => { if (!cancelled) setSchoolName(school?.schoolName || '') })
      .catch(() => { if (!cancelled) setSchoolName('') })
    return () => { cancelled = true }
  }, [currentUser, reloadKey])

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

  // Mobile hero term context: "Term 2 · Week 10 of 14", a progress fraction,
  // and Mon–Fri teaching days left (holiday-aware). Null during holidays —
  // the hero then falls back to the next term's opening date via the
  // prepCalendar fields above.
  const heroTerm = useMemo(() => {
    const active = getActiveTerm()
    if (!active) return null
    const totalWeeks = getTermWeeks(active.year, active.term.number).length
    const weekNumber = Number.isFinite(prepCalendar?.weekNumber) ? prepCalendar.weekNumber : null
    return {
      termNumber: active.term.number,
      weekNumber,
      totalWeeks,
      daysLeft: teachingDaysLeft(active.term),
    }
  }, [prepCalendar])

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
  // Both of these carry a `to` into a studio, and a card or a checklist step
  // that opens a studio no longer on offer is an entry point wearing a
  // different hat — the recommendation to "create a worksheet" is exactly as
  // much of a doorway as the tile is. Filtering here (rather than teaching the
  // pure builders about feature flags) keeps the rule in one place and means
  // flipping the flag back on restores the nudge with it.
  // Filtered BEFORE the top-3 slice, or hiding one card would leave two.
  const recommendationCards = recommendationCardsFrom(filterEntries(recommendations))
  const checklistItems = filterEntries(checklistFromWeekPrep(weekPrep))

  return {
    teacher,
    loading,
    termChip: termChipLabel(prepCalendar, now),
    hero: {
      schoolName,
      term: heroTerm,
      // During holidays the mobile hero shows when the next term opens.
      nextTermOpens: !prepCalendar?.isActiveTermNow && prepCalendar?.openLabel
        ? prepCalendar.openLabel
        : null,
    },
    lastOpened: lastOpenedFromResources(resources, now),
    documents: documentsFromResources(resources, { limit: 5, now }),
    // Null when either fetch failed — showing a wrong zero is worse than hiding
    // the counts until retry succeeds.
    savedCounts: (gensError || papersError) ? null : studioSavedCounts(librarySummary.byTool, assessments.length),
    checklist: checklistItems,
    feed: feedFromState({ resources, gensError, papersError, now }),
    launcherWarnings: launcherWarningsFromResources(resources),
    activity: activityFromResources(resources, { limit: 3, now }),
    recommendations: recommendationCards,
    reload,
  }
}
