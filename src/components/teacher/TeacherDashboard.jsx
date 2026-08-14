import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { useTeacherUsage } from '../../hooks/useTeacherUsage'
import {
  listMyGenerations,
  summarizeGenerations,
  titleForGeneration,
  formatDate,
  duplicateGeneration,
  CLIENT_CREATED_TOOLS,
  TOOL_META as LIB_TOOL_META,
} from '../../utils/teacherLibraryService'
import { getDocumentActions } from '../../utils/documentActions'
import { useToast } from '../ui/Toast'
import { resolveTeacherPlan } from '../../utils/teacherPlans'
import { isExamPaperType, assessmentEditPath } from './paperTaxonomy'
import {
  getTimeGreeting,
  buildAiMessage,
  buildActivityStats,
  buildCelebrations,
  formatTrend,
} from '../../utils/teacherDashboardIntel'
import { buildProfileRecommendations } from '../../utils/teacherRecommendations'
import { buildWeekPrep, genSubject, genTerm, normSubject } from '../../utils/prepareThisWeek'
import { termCoverageSummary, currentWeekForRecord } from '../../utils/recordOfWorkStatus'
import { writeActiveAssignmentSeed } from '../../utils/activeAssignmentSeed'
import { resolveActiveAssignmentId } from '../../utils/teachingProfileCore'
import { setActiveAssignmentId as persistActiveAssignmentId } from '../../utils/teachingProfileService'
import useRemoteAssignmentAdoption from '../../hooks/useRemoteAssignmentAdoption'
import { dashboardAdoptionPlan } from './dashboardAssignmentAdoption'
import { seedLabel } from './generate/teachingAssignmentChangeNoticeCore'
import { useTeachingProfile } from '../../features/teacherSettings/lib/useTeachingProfile'
import { daysUntil, fmtDate, getActiveTerm, getCurrentForecastWeek, getNextTerm } from '../../utils/moeCalendar'
import { capture } from '../../utils/analytics'
import SeoHelmet from '../seo/SeoHelmet'
import UsageReminderBanner from '../subscription/UsageReminderBanner'
import AiRecommendations from './AiRecommendations'
import { FreeAllowanceNotice, PlanUsageCard } from '../../features/teacherPaywall'
import PrepareThisWeek from './PrepareThisWeek'
import QuickCreate from './QuickCreate'
import RecentDocuments from './RecentDocuments'
import TeacherOnboardingTour from './TeacherOnboardingTour'
import TeacherWorkspace from './TeacherWorkspace'
import { FeedbackButton, SuggestionNudge } from '../../features/feedback'
import PushPermissionPrompt from '../ui/PushPermissionPrompt'
import Icon from '../ui/Icon'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheckList,
  ClipboardList,
  DocumentTextIcon,
  FileText,
  FolderOpen,
  GraduationCap,
  Layers,
  PencilLine,
  Play,
  Search,
  Sparkles,
  Target,
} from '../ui/icons'
// Premium hero illustration — 3D study-desk scene that matches the brand teal,
// so it blends straight into the hero gradient. Compressed to ~20KB WebP.
import heroDesk from '../../assets/teacher/hero-desk.webp'

const TOOL_META = {
  lesson_plan: { icon: PencilLine, accent: '#fde2c4', label: 'Lesson Plan' },
  scheme_of_work: { icon: CalendarDays, accent: '#faecb8', label: 'Scheme of Work' },
  class_timetable: { icon: CalendarDays, accent: '#e3dcf5', label: 'Class Timetable' },
  worksheet: { icon: FileText, accent: '#d8ecd0', label: 'Worksheet' },
  flashcards: { icon: Layers, accent: '#fde9b8', label: 'Flashcards' },
  rubric: { icon: ClipboardCheckList, accent: '#f0d6e0', label: 'Rubric' },
  notes: { icon: DocumentTextIcon, accent: '#dbe7f4', label: 'Teacher Notes' },
  assessment: { icon: BarChart3, accent: '#e8d8f0', label: 'Test Paper' },
  assessments: { icon: BarChart3, accent: '#e8d8f0', label: 'Test Paper' },
  // 'quiz' stays for generations saved before the studio was retired (#909).
  quiz: { icon: ClipboardList, accent: '#cfe9f5', label: 'Quiz' },
  // 'full_lesson' stays for lessons saved before the studio was retired.
  full_lesson: { icon: Sparkles, accent: '#cfe9f5', label: 'Full Lesson' },
  exam_paper: { icon: GraduationCap, accent: '#dbdcf7', label: 'Exam Paper' },
  sba_task: { icon: GraduationCap, accent: '#d8e6f0', label: 'SBA Task' },
  sba_mark_sheet: { icon: Calculator, accent: '#dcefe2', label: 'SBA Mark Sheet' },
  sba_plan: { icon: Target, accent: '#dbe7f4', label: 'SBA Year Plan' },
}

// Per-activity-card icon + colour tone for the coloured badges on the
// "Your activity" stat cards.
const ACTIVITY_META = {
  plans: { icon: FileText, tone: 'green' },
  notes: { icon: BookOpen, tone: 'purple' },
  tests: { icon: ClipboardList, tone: 'blue' },
  week: { icon: BarChart3, tone: 'orange' },
  library: { icon: FolderOpen, tone: 'blue' },
}

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  return new Date(t).getTime() || 0
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ')
}

function SectionLabel({ children }) {
  return <div className="teacher-dashboard-eyebrow">{children}</div>
}

/* ── Continue cards: recent work with a real progress signal ──────────────
   A saved generation is a finished artifact ("Ready"); a draft test paper
   reflects how far it actually is (has questions vs empty). No fabricated
   percentages on finished work. */
function progressFor(resource) {
  if (resource.status !== 'draft') return { pct: 100, label: 'Ready' }
  if (resource.questionCount > 0) return { pct: 65, label: 'Draft' }
  return { pct: 25, label: 'Started' }
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getMyAssessments, updateAssessment } = useFirestore()
  const navigate = useNavigate()
  const toast = useToast()

  // "Current plan" reflects the teacher's actual studio entitlement
  // (users.teacherPlan, same field the usage meter + server gate on), not the
  // learner-style isPremium flag — otherwise a premium learner with no Pro
  // teacher plan would falsely read "Pro" while the meter still showed Free.
  const teacherPlan = resolveTeacherPlan(userProfile)
  // Free teachers can only open the Lesson Plan studio; other tiles open a
  // read-only sample, so they're badged "Sample" on the workspace grid.
  const isFreePlan = teacherPlan === 'free'

  const { data: usage, loading: usageLoading } = useTeacherUsage(currentUser?.uid)

  const [generations, setGenerations] = useState([])
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  // True when the generations fetch itself failed (not merely returned
  // empty) — Prepare This Week shows its error state with a retry instead
  // of a misleading "set up your week" empty state.
  const [gensError, setGensError] = useState(false)
  // True when the assessments fetch failed (not merely empty) — shown as an
  // inline error notice so the teacher knows their papers are not really gone.
  const [papersError, setPapersError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [activityRange, setActivityRange] = useState('week')
  // Activity statistics live behind a collapsed disclosure at the bottom of
  // the page (redesign §7) — Quick Create owns their old slot.
  const [activityOpen, setActivityOpen] = useState(false)
  // Workspace shows three primary groups; the rest expand in place (§10).
  // State lives here so Quick Create's "View all teacher tools" can expand
  // it before scrolling down.
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false)

  // One "viewed" event per dashboard mount (§19) — covers the workspace too.
  useEffect(() => {
    capture('teacher_dashboard_viewed', {})
  }, [])

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
      // A failed summary query hides saved-count badges rather than showing
      // wrong zeros — record it so we can see how often that path is hit.
      if (gensFailed) capture('workspace_count_query_failed', {})
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentUser, getMyAssessments, reloadKey])

  // byTool keys stay snake_cased (the Firestore tool ids) — StudioCard
  // normalizes its dash-cased libraryKey before looking up.
  const librarySummary = useMemo(() => summarizeGenerations(generations), [generations])

  // One normalised list of everything the teacher has made — the single input
  // the intelligence helpers (greeting message, insights, stats, celebrations,
  // continue cards) all read from. Sorted newest-first.
  const resources = useMemo(() => {
    const fromGens = generations.map((g) => ({
      id: g.id,
      kind: 'generation',
      tool: g.tool,
      subject: g.inputs?.subject || g.output?.header?.subject || '',
      grade: g.inputs?.grade || g.output?.header?.grade || '',
      topic: g.output?.header?.topic || g.inputs?.topic || '',
      createdAt: toMs(g.createdAt),
      modifiedAt: 0, // generations carry no updatedAt — createdAt is the truth
      title: titleForGeneration(g),
      to: `/teacher/library/${g.id}`,
      status: 'ready',
      questionCount: 0,
      // The raw doc, kept for duplicateGeneration (it needs inputs/output/library).
      raw: g,
    }))
    // Tests and examinations both live in the `assessments` collection and
    // are edited by the one Assessment Paper Studio, at one canonical route
    // — assessmentEditPath no longer branches on the paper's type.
    const fromAssessments = assessments.map((a) => {
      const isExam = isExamPaperType(a.assessmentType)
      return {
        id: a.id,
        kind: 'assessment',
        tool: 'assessment',
        subject: a.subject || '',
        grade: a.grade || a.targetGrade || '',
        topic: a.topic || '',
        createdAt: toMs(a.createdAt),
        modifiedAt: toMs(a.updatedAt), // stamped by updateAssessment on every edit
        title: a.title || a.topic || `Untitled ${isExam ? 'exam' : 'test'} paper`,
        to: assessmentEditPath(a),
        // Papers with at least one question are ready artifacts; only empty
        // papers are genuinely unfinished drafts.
        status: (typeof a.questionCount === 'number' && a.questionCount > 0) ? 'ready' : 'draft',
        questionCount: typeof a.questionCount === 'number' ? a.questionCount : 0,
      }
    })
    return [...fromGens, ...fromAssessments].sort((a, b) => b.createdAt - a.createdAt)
  }, [generations, assessments])

  const firstName = useMemo(() => {
    const name = (userProfile?.displayName || '').trim()
    if (!name) return 'Teacher'
    // Keep an honorific if present ("Mr. Mwelwa"), else first token.
    const parts = name.split(/\s+/)
    if (/^(mr|mrs|ms|miss|dr|sir|madam)\.?$/i.test(parts[0]) && parts.length > 1) {
      return `${parts[0]} ${parts[1]}`
    }
    return parts[0]
  }, [userProfile])

  const greeting = useMemo(() => getTimeGreeting(Date.now(), firstName), [firstName])
  const aiMessage = useMemo(
    () => buildAiMessage({ resources, usage, now: Date.now() }),
    [resources, usage],
  )
  const activityStats = useMemo(
    () => buildActivityStats({ resources, now: Date.now(), range: activityRange }),
    [resources, activityRange],
  )
  const celebration = useMemo(
    () => buildCelebrations({ resources })[0] || null,
    [resources],
  )

  // The last subject context the dashboard resolved for this teacher —
  // persisted so Prepare This Week + AI Recommendations never silently
  // switch subject just because a document in another subject was edited
  // more recently.
  //
  // The Teaching Profile's active assignment is now the source of truth for
  // which grade + subject "this week" is about: the persisted last choice, else
  // the profile default, else the first active assignment. A multi-subject
  // teacher switches it on the card (handleSelectAssignment below).
  const teachingProfile = useTeachingProfile()
  const activeTeachingAssignments = useMemo(
    () => teachingProfile.assignments.filter((a) => a.isActive),
    [teachingProfile.assignments],
  )
  // Legacy subject-only context — kept for teachers who have not set up a
  // Teaching Profile yet (no active assignments).
  const prepContextKey = currentUser ? `zedexams:prep-context:${currentUser.uid}` : null
  const legacyPreferredSubject = useMemo(() => {
    if (!prepContextKey) return ''
    try { return localStorage.getItem(prepContextKey) || '' } catch { return '' }
  }, [prepContextKey])

  // The active assignment is persisted by its ID (assignment-level), so a
  // teacher who teaches the same subject in two grades keeps the exact one —
  // the subject-only selector can no longer resolve back to the wrong grade.
  const prepAssignmentKey = currentUser ? `zedexams:prep-assignment:${currentUser.uid}` : null
  const [activeAssignmentId, setActiveAssignmentId] = useState(() => {
    if (!prepAssignmentKey) return ''
    try { return localStorage.getItem(prepAssignmentKey) || '' } catch { return '' }
  })

  const activeAssignment = useMemo(() => {
    const list = activeTeachingAssignments
    if (!list.length) return null
    // Cross-device source of truth: this device's last pick (localStorage) →
    // the assignment synced from any device (profile.activeAssignmentId) →
    // effective default → only active. So a fresh device that hasn't opened the
    // dashboard before still lands on the last assignment used elsewhere,
    // without requiring the local cache to be populated first.
    const { id } = resolveActiveAssignmentId(teachingProfile.profile, list, { deviceId: activeAssignmentId })
    return (id && list.find((a) => a.id === id)) || list[0]
  }, [activeTeachingAssignments, activeAssignmentId, teachingProfile.profile])

  // Persist the active assignment's grade/subject/curriculum to localStorage so
  // every generate-studio can synchronously pre-fill from the SAME teaching
  // context the dashboard shows — without its own Firestore round-trip. Cleared
  // (null assignment) when the teacher has no active assignment.
  useEffect(() => {
    if (!currentUser?.uid) return
    writeActiveAssignmentSeed(currentUser.uid, activeAssignment)
  }, [currentUser?.uid, activeAssignment])

  // Repair a dangling cross-device reference: if profile.activeAssignmentId
  // points at a deleted/deactivated assignment, write the freshly-resolved id
  // back once so other devices stop inheriting the stale value. Guarded per
  // resolved value so it can't loop (the profile hook loads once, not live).
  const repairedActiveRef = useRef('')
  useEffect(() => {
    const uid = currentUser?.uid
    if (!uid || !teachingProfile.hasProfile) return
    const { id, storedInvalid } = resolveActiveAssignmentId(
      teachingProfile.profile,
      activeTeachingAssignments,
      { deviceId: activeAssignmentId },
    )
    if (storedInvalid && id && repairedActiveRef.current !== id) {
      repairedActiveRef.current = id
      persistActiveAssignmentId(uid, id).catch(() => { /* best-effort repair */ })
    }
  }, [currentUser?.uid, teachingProfile.hasProfile, teachingProfile.profile, activeTeachingAssignments, activeAssignmentId])

  // Feed the active assignment's subject + grade to every weekly-preparation
  // surface so Prepare This Week, Quick Create and AI Recommendations all show
  // the SAME resolved grade + subject. Grade is authoritative (see
  // prepareThisWeek.resolveWeekContext), so progress is never combined across
  // grades and the grade never silently switches.
  const profileSubject = activeAssignment?.subject || userProfile?.subject || ''
  const profileGrade = activeAssignment?.grade || ''
  const effectivePreferredSubject = activeAssignment ? activeAssignment.subject : legacyPreferredSubject

  // The MoE calendar context both weekly-preparation surfaces share. During
  // holidays the calendar points at Week 1 of the next term; isActiveTermNow
  // + the opening-date extras switch the cards into "next term" behaviour.
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

  // Weekly preparation model — derived from the SAME generations fetch the
  // rest of the dashboard uses (no extra Firestore reads).
  const weekPrep = useMemo(
    () => buildWeekPrep({
      generations,
      calendar: prepCalendar,
      profileSubject,
      profileGrade,
      preferredSubject: effectivePreferredSubject,
      activeAssignment,
      now: Date.now(),
    }),
    [generations, prepCalendar, profileSubject, profileGrade, effectivePreferredSubject, activeAssignment],
  )

  // Persist whatever context was resolved so the next visit sticks with it.
  useEffect(() => {
    const subject = weekPrep?.context?.subject
    if (!prepContextKey || !subject) return
    try { localStorage.setItem(prepContextKey, subject) } catch { /* storage unavailable */ }
  }, [weekPrep, prepContextKey])

  // Persist the active assignment to the Teaching Profile so other devices pick
  // it up. Non-blocking (never gates the UI); one silent retry covers a transient
  // failure, then a soft warning — the local selection is kept, never cleared.
  const syncActiveAssignment = async (assignmentId) => {
    const uid = currentUser?.uid
    if (!uid || !assignmentId) return
    try {
      await persistActiveAssignmentId(uid, assignmentId)
    } catch {
      try {
        await persistActiveAssignmentId(uid, assignmentId) // one silent retry
      } catch {
        toast.info("We changed the assignment on this device, but couldn't sync it across your other devices.")
      }
    }
  }

  // Live cross-device adoption: the dashboard owns the selector and carries no
  // draft form state, so when useActiveAssignmentSync adopts a validated remote
  // change, an open dashboard updates the selector automatically — every
  // assignment-derived surface (Prepare This Week, recommendations, Quick
  // Create, term coverage) re-derives from the new id — and shows a small
  // informational notice. Studios, which DO carry drafts, keep their
  // Switch / Keep prompt instead. No Firestore write happens here: the sync
  // listener already mirrored localStorage before dispatching.
  const [remoteAssignmentNotice, setRemoteAssignmentNotice] = useState('')
  useRemoteAssignmentAdoption(currentUser?.uid, activeAssignment?.id || '', ({ id, seed, source }) => {
    // The full decision table (cross-tab silent adopt / unknown-id ignore /
    // remote adopt-with-notice + reload) is pure and node-tested — see
    // dashboardAssignmentAdoption.js for why unknown cross-tab ids are ignored.
    const plan = dashboardAdoptionPlan({ id, source, knownIds: activeTeachingAssignments.map((a) => a.id) })
    if (plan.action === 'ignore') return
    setActiveAssignmentId(id)
    setRemoteAssignmentNotice(plan.action === 'adopt-notice' ? (seedLabel(seed) || 'a different class') : '')
    if (plan.reload) teachingProfile.reload()
  })

  // Switching the active assignment on the card persists the choice (locally +
  // across devices) and re-seeds the weekly-preparation surfaces + Quick Create.
  const handleSelectAssignment = (assignment) => {
    if (!assignment) return
    setActiveAssignmentId(assignment.id)
    setRemoteAssignmentNotice('') // a manual pick supersedes the remote notice
    if (prepAssignmentKey) {
      try { localStorage.setItem(prepAssignmentKey, assignment.id) } catch { /* storage unavailable */ }
    }
    void syncActiveAssignment(assignment.id)
  }
  const activeQuickCreateContext = activeAssignment
    ? { grade: activeAssignment.grade, subject: activeAssignment.subject, term: prepCalendar?.termNumber }
    : null

  // Actionable AI Recommendations (replaces the passive insights) — same
  // inputs, no extra reads; every card's condition is verified in data.
  const recommendations = useMemo(
    () => buildProfileRecommendations({
      generations,
      assessments,
      calendar: prepCalendar,
      assignments: activeTeachingAssignments,
      profileSubject,
      profileGrade,
      preferredSubject: effectivePreferredSubject,
    }),
    [generations, assessments, prepCalendar, activeTeachingAssignments, profileSubject, profileGrade, effectivePreferredSubject],
  )

  // Term coverage rollup for the ACTIVE context's current-term Record of Work.
  // Derived from recorded coverage only (never inferred); restricted to a
  // record whose term + year match the live calendar so a past-year record
  // can't inflate "behind". generations arrive newest-first, so find() picks
  // the latest matching record. Null (→ nothing rendered) when there's no
  // record, no calendar context, or nothing due yet.
  const termCoverage = useMemo(() => {
    const fw = getCurrentForecastWeek()
    const termNumber = prepCalendar?.termNumber ?? null
    if (!fw || termNumber == null) return null
    const wantSubject = normSubject(profileSubject || effectivePreferredSubject)
    const record = generations.find((g) =>
      g.tool === 'record_of_work' && genTerm(g) === termNumber &&
      (!wantSubject || genSubject(g) === wantSubject))
    if (!record) return null
    const cw = currentWeekForRecord(record.output?.header, fw)
    if (!Number.isFinite(cw) || cw <= 0) return null
    const summary = termCoverageSummary(record.output?.weeks, cw)
    return summary ? { ...summary, recordId: record.id } : null
  }, [generations, prepCalendar, profileSubject, effectivePreferredSubject])

  const continueItems = useMemo(() => {
    // Drafts (genuinely unfinished) first, then the most recent saved work.
    const drafts = resources.filter((r) => r.status === 'draft')
    const rest = resources.filter((r) => r.status !== 'draft')
    return [...drafts, ...rest].slice(0, 4)
  }, [resources])

  // Recent documents — newest first by last edit (assessments carry
  // updatedAt; generations only createdAt), shaped for the RecentDocuments
  // rows. Capabilities come from the central resolver so the menu never
  // offers an action this document type can't honour.
  const recentItems = useMemo(() => {
    return [...resources]
      .sort((a, b) => (b.modifiedAt || b.createdAt) - (a.modifiedAt || a.createdAt))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        tool: r.tool,
        icon: LIB_TOOL_META[r.tool]?.icon || '📄',
        title: r.title,
        typeLabel: LIB_TOOL_META[r.tool]?.label || TOOL_META[r.tool]?.label || 'Document',
        grade: r.grade,
        subject: formatSubject(r.subject),
        timeLabel: `${r.modifiedAt && r.modifiedAt !== r.createdAt ? 'Edited' : 'Created'} ${formatDate(r.modifiedAt || r.createdAt)}`,
        status: r.status === 'draft' ? 'draft' : 'ready',
        to: r.to,
        actions: getDocumentActions(r, { clientCreatedTools: CLIENT_CREATED_TOOLS }),
        raw: r.raw,
      }))
  }, [resources])

  async function handleDuplicateRecent(item) {
    try {
      await duplicateGeneration(item.raw, currentUser?.uid)
      toast.success('Document duplicated — a copy has been added to Recent documents.')
      // One server-confirmed refetch of the existing limited query; no new
      // listeners, no full-page reload, scroll position untouched.
      setLoading(true)
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err?.message || 'We could not duplicate this document. The original document was not changed.')
    }
  }

  async function handleRenameRecent(item, title) {
    try {
      await updateAssessment(item.id, { title })
      setAssessments((prev) => prev.map((a) => (a.id === item.id ? { ...a, title } : a)))
      toast.success('Renamed.')
    } catch {
      toast.error('Could not rename. Try again.')
    }
  }

  const lastItem = continueItems[0] || null

  function handleSearch(e) {
    e.preventDefault()
    const term = searchTerm.trim()
    navigate(term ? `/teacher/library?q=${encodeURIComponent(term)}` : '/teacher/library')
  }

  return (
    <div className="teacher-dashboard-surface">
      <SeoHelmet title="Teacher dashboard" noIndex />
      <TeacherOnboardingTour />

      {celebration && (
        <div className="teacher-celebrate" role="status">
          <span className="teacher-celebrate__emoji" aria-hidden="true">{celebration.emoji}</span>
          <span className="teacher-celebrate__text">{celebration.text}</span>
        </div>
      )}

      {/* Audit A5.1 — push opt-in for teachers (self-gates on push support +
          unasked + permission 'default', so it renders nothing once handled). */}
      <PushPermissionPrompt variant="teacher" />

      {/* One-time "your free allowance increased" notice (self-gates on plan
          + a per-catalogue-revision seen flag). */}
      <FreeAllowanceNotice
        plan={teacherPlan}
        onViewAllowance={() => {
          document.getElementById('teacher-plan-usage')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
        }}
      />

      {/* ── AI Workspace hero ─────────────────────────────────────── */}
      <section className={`teacher-hero teacher-hero--${greeting.part}`}>
        <img
          className="teacher-hero__illus"
          src={heroDesk}
          alt=""
          aria-hidden="true"
          width="880"
          height="660"
          fetchPriority="high"
          decoding="async"
        />
        <div className="teacher-hero__content">
          <h1 className="teacher-hero__greeting">
            <span className="teacher-hero__greeting-top">
              <span className="teacher-hero__time-icon" aria-hidden="true">{greeting.emoji}</span>
              {greeting.label},
            </span>
            <span className="teacher-hero__greeting-name">
              {firstName} <span aria-hidden="true">👋</span>
            </span>
          </h1>
          <p className="teacher-hero__message">{aiMessage}</p>

          {lastItem ? (
            <Link to={lastItem.to} className="teacher-hero__continue">
              <span
                className="teacher-hero__continue-icon"
                style={{ '--c-bg': (TOOL_META[lastItem.tool]?.accent) || '#dcefe2' }}
              >
                <Icon as={(TOOL_META[lastItem.tool]?.icon) || DocumentTextIcon} size="sm" />
              </span>
              <div className="teacher-hero__continue-info">
                <span className="teacher-hero__continue-label">Last opened</span>
                <p className="teacher-hero__continue-title">
                  {formatSubject(lastItem.subject) || lastItem.title}
                </p>
                <span className="teacher-hero__continue-sub">
                  {[lastItem.grade, lastItem.topic ? `Lesson: ${lastItem.topic}` : '']
                    .filter(Boolean).join(' • ') || (TOOL_META[lastItem.tool]?.label || '')}
                </span>
              </div>
              <span className="teacher-hero__continue-time">{formatDate(lastItem.createdAt)}</span>
              <span className="teacher-hero__cta">
                Continue plan
                <Icon as={ArrowRight} size="sm" />
              </span>
            </Link>
          ) : (
            <Link to="/teacher/lesson-plans/new" className="teacher-hero__continue teacher-hero__continue--empty">
              <div className="teacher-hero__continue-info">
                <span className="teacher-hero__continue-label">Get started</span>
                <p className="teacher-hero__continue-title">Create your first lesson</p>
                <span className="teacher-hero__continue-sub">CBC-aligned • under a minute</span>
              </div>
              <span className="teacher-hero__cta">
                <Icon as={PencilLine} size="sm" />
                Create Your First Lesson
              </span>
            </Link>
          )}
        </div>
      </section>

      {/* ── Universal search ──────────────────────────────────────── */}
      <form className="teacher-universal-search" onSubmit={handleSearch} role="search">
        <Icon as={Search} size="sm" className="teacher-universal-search__icon" />
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search lessons, notes, tests, worksheets…"
          aria-label="Search all your teaching materials"
          className="teacher-universal-search__input"
        />
        <button type="submit" className="teacher-universal-search__filter" aria-label="Search your library">
          <Icon as={ArrowRight} size="sm" />
        </button>
      </form>

      {/* ── Soft usage reminder (~80% of an allowance used) ───────── */}
      <UsageReminderBanner />

      {/* ── Cross-device assignment change (informational — the switch has
             already happened; a manual pick or dismiss clears it) ───── */}
      {remoteAssignmentNotice && (
        <div className="teacher-celebrate" role="status">
          <span className="teacher-celebrate__emoji" aria-hidden="true">🔄</span>
          <span className="teacher-celebrate__text">
            Teaching assignment updated — another device changed your active assignment to {remoteAssignmentNotice}.
          </span>
          <button
            type="button"
            className="teacher-celebrate__dismiss"
            onClick={() => setRemoteAssignmentNotice('')}
            aria-label="Dismiss assignment update notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Prepare This Week (weekly preparation guide) ──────────── */}
      <PrepareThisWeek
        loading={loading}
        error={gensError}
        prep={weekPrep}
        assignments={activeTeachingAssignments}
        activeAssignmentId={activeAssignment?.id}
        onSelectAssignment={handleSelectAssignment}
        onRetry={() => { setLoading(true); setReloadKey((k) => k + 1) }}
        termCoverage={termCoverage}
      />

      {/* ── Continue where you left off ───────────────────────────── */}
      <section className="teacher-continue">
        <div className="teacher-section-head">
          <SectionLabel>Continue where you left off</SectionLabel>
          {lastItem && (
            <Link to="/teacher/library" className="teacher-section-head__link">View all</Link>
          )}
        </div>
        {loading ? (
          <div className="teacher-continue-feature teacher-continue-feature--skeleton" />
        ) : !lastItem ? (
          <div className="teacher-empty-state">
            <span className="teacher-empty-state__icon"><Icon as={FolderOpen} size="xl" /></span>
            <p className="teacher-empty-state__title">Nothing recent yet</p>
            <p className="teacher-empty-state__text">Choose a workspace below — your most recent work will appear here.</p>
          </div>
        ) : (
          (() => {
            const meta = TOOL_META[lastItem.tool] || { icon: DocumentTextIcon, accent: '#f0eee8', label: 'Item' }
            const prog = progressFor(lastItem)
            const steps = lastItem.tool === 'lesson_plan' ? 6 : null
            const curStep = steps ? Math.max(1, Math.round((prog.pct / 100) * steps)) : null
            return (
              <div className="teacher-continue-feature">
                <span className="teacher-continue-feature__icon" style={{ '--c-bg': meta.accent }}>
                  <Icon as={meta.icon} size="md" />
                </span>
                <div className="teacher-continue-feature__body">
                  <p className="teacher-continue-feature__title">{lastItem.topic || lastItem.title}</p>
                  <p className="teacher-continue-feature__meta">
                    {[formatSubject(lastItem.subject), lastItem.grade].filter(Boolean).join(' • ') || meta.label}
                  </p>
                  <div className="teacher-continue-feature__bar">
                    <div className="teacher-continue-feature__fill" style={{ width: `${prog.pct}%` }} />
                  </div>
                  <div className="teacher-continue-feature__foot">
                    <span>{curStep ? `Step ${curStep} of ${steps}` : meta.label}</span>
                    <span>{prog.pct}% complete</span>
                  </div>
                </div>
                <Link to={lastItem.to} className="teacher-continue-feature__cta">
                  <Icon as={Play} size="sm" />
                  Continue
                </Link>
              </div>
            )
          })()
        )}
      </section>

      {/* ── Quick create (the four primary studio actions) ────────── */}
      <QuickCreate
        context={activeQuickCreateContext}
        onViewAllTools={() => setWorkspaceExpanded(true)}
      />

      {/* ── AI Recommendations (actionable; replaces AI insights) ─── */}
      {!loading && <AiRecommendations recommendations={recommendations} />}

      {/* ── Assessment papers load error (network blip, offline-cache miss) ──
           Shown only when the read threw — never on a genuine empty library.
           "Try again" triggers the same reload as PrepareThisWeek's retry. */}
      {papersError && !loading && (
        <div className="teacher-celebrate" role="alert">
          <span className="teacher-celebrate__text" style={{ flex: 1 }}>
            Couldn't load your assessment papers — your saved tests and exam papers may not be showing.
          </span>
          <button
            type="button"
            className="teacher-section-head__link"
            style={{ flexShrink: 0 }}
            onClick={() => { setLoading(true); setPapersError(false); setReloadKey((k) => k + 1) }}
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Recent documents ──────────────────────────────────────── */}
      <RecentDocuments
        items={recentItems}
        loading={loading}
        onDuplicate={handleDuplicateRecent}
        onRename={handleRenameRecent}
      />

      {/* ── Teacher workspace (studios) — three primary groups; the rest
          expand in place behind "View all teacher tools" ───────────── */}
      <TeacherWorkspace
        librarySummary={librarySummary}
        isFreePlan={isFreePlan}
        expanded={workspaceExpanded}
        onToggle={setWorkspaceExpanded}
      />

      {/* ── Your activity (collapsed disclosure — the stats moved out of
          the main flow when Quick Create took their slot; the numbers and
          honest trends stay one tap away) ──────────────────────────── */}
      {!loading && (
        <section className="teacher-activity teacher-defer">
          <button
            type="button"
            className="teacher-activity__toggle"
            aria-expanded={activityOpen}
            onClick={() => {
              setActivityOpen((v) => {
                if (!v) capture('dashboard_activity_expanded', {})
                return !v
              })
            }}
          >
            <span className="teacher-dashboard-eyebrow">Your activity</span>
            <span className="teacher-activity__toggle-hint">
              {activityOpen ? 'Hide' : 'View'}
              <Icon
                as={ChevronDown}
                size="xs"
                className={activityOpen ? 'teacher-usage-card__chevron is-open' : 'teacher-usage-card__chevron'}
              />
            </span>
          </button>
          {activityOpen && (
            <>
              <div className="teacher-section-head">
                <span className="sr-only">Activity statistics</span>
                <label className="teacher-range">
                  <select
                    value={activityRange}
                    onChange={(e) => setActivityRange(e.target.value)}
                    aria-label="Activity range"
                  >
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                  </select>
                  <Icon as={ChevronDown} size="xs" />
                </label>
              </div>
              <div className="teacher-activity__grid">
                {activityStats.filter((s) => s.key !== 'library').map((s) => {
                  const am = ACTIVITY_META[s.key] || { icon: DocumentTextIcon, tone: 'slate' }
                  // 'new' shares the positive (green) styling with 'up'.
                  const toneDir = s.trend.dir === 'new' ? 'up' : s.trend.dir
                  return (
                    <div key={s.key} className="teacher-activity-card">
                      <div className="teacher-activity-card__top">
                        <span className={`teacher-activity-card__badge teacher-activity-card__badge--${am.tone}`}>
                          <Icon as={am.icon} size="sm" />
                        </span>
                        <p className="teacher-activity-card__value">{s.period}</p>
                      </div>
                      <p className="teacher-activity-card__label">{s.label}</p>
                      <span className={`teacher-activity-card__trend teacher-activity-card__trend--${toneDir}`}>
                        {formatTrend(s.trend, s.basis)}
                      </span>
                    </div>
                  )
                })}
              </div>
              {(() => {
                const lib = activityStats.find((s) => s.key === 'library')
                if (!lib) return null
                return (
                  <Link to="/teacher/library" className="teacher-activity-total">
                    <span className="teacher-activity-card__badge teacher-activity-card__badge--blue">
                      <Icon as={FolderOpen} size="sm" />
                    </span>
                    <div className="teacher-activity-total__body">
                      <p className="teacher-activity-total__value">{lib.total}</p>
                      <p className="teacher-activity-total__label">Total in library</p>
                    </div>
                    <Icon as={ChevronRight} size="sm" className="teacher-activity-total__arrow" />
                  </Link>
                )
              })()}
            </>
          )}
        </section>
      )}

      {/* ── Compact plan + usage — ONE card, bottom of the page by design:
          the dashboard leads with teaching work, not usage statistics; the
          full breakdown stays one tap away behind "View details". ───── */}
      <section id="teacher-plan-usage" className="teacher-usage-section teacher-defer">
        <div className="teacher-section-head">
          <SectionLabel>Plan &amp; usage</SectionLabel>
        </div>
        <PlanUsageCard usage={usage} loading={usageLoading} />
      </section>

      <div className="mt-6">
        <FeedbackButton source="teacher-dashboard" />
      </div>

      <SuggestionNudge source="teacher-dashboard" />
    </div>
  )
}
