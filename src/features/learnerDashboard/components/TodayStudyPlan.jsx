import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircleIcon,
  ChevronRight,
  Clock,
  PencilLine,
  Sparkles,
  Target,
  TrophyIcon,
  Users,
} from '../../../components/ui/icons'
import Icon from '../../../components/ui/Icon'
import Skeleton from '../../../components/ui/Skeleton'
import { SUBJECTS } from '../../../config/curriculum'
import { daysUntil, fmtDate, getActiveTerm, getNextTerm } from '../../../utils/moeCalendar'
import { useAuth } from '../../../contexts/AuthContext'
import {
  awardPlanStreak,
  getStudyPlanProgress,
  normaliseCompletedTaskKeys,
  normaliseStudyPlanProgress,
  saveStudyPlanProgress,
  toLocalDateKey,
  toWeekKey,
} from '../lib/studyPlanProgress'

function toDate(ts) {
  if (!ts) return null
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return Number.isNaN(d?.getTime?.()) ? null : d
}

function isToday(ts) {
  const d = toDate(ts)
  if (!d) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
}

function normaliseSubject(value) {
  if (!value) return null
  const raw = String(value).trim().toLowerCase()
  return SUBJECTS.find(subject => (
    subject.id.toLowerCase() === raw
    || subject.label.toLowerCase() === raw
    || subject.shortLabel?.toLowerCase() === raw
  )) || null
}

function getSubjectPath(grade, subject) {
  if (!grade || !subject?.id) return '/quizzes'
  return `/practise/${grade}/${subject.id}`
}

function buildCountdown() {
  const active = getActiveTerm()
  if (active?.term) {
    const days = Math.max(daysUntil(active.term.close), 0)
    return {
      label: days === 0 ? 'Term closes today' : `${days} days to term exams`,
      detail: `${active.term.name} closes ${fmtDate(active.term.close, 'day')}`,
      days,
    }
  }

  const next = getNextTerm()
  if (next?.term) {
    const days = Math.max(daysUntil(next.term.open), 0)
    return {
      label: days === 0 ? `${next.term.name} starts today` : `${days} days to ${next.term.name}`,
      detail: `School opens ${fmtDate(next.term.open, 'day')}`,
      days,
    }
  }

  return {
    label: 'Study plan ready',
    detail: 'Keep your revision rhythm steady this week',
    days: null,
  }
}

function toScore(value) {
  if (value === null || value === undefined || value === '') return null
  const score = Number(value)
  return Number.isFinite(score) ? Math.round(score) : null
}

function keyPart(value) {
  return String(value || 'mixed')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'mixed'
}

function getWeakFocus(weakTopics = []) {
  const weak = weakTopics
    .filter(topic => typeof topic?.percentage !== 'number' || topic.percentage < 70)
    .sort((a, b) => (a.percentage ?? 100) - (b.percentage ?? 100))[0]
  if (!weak) return null
  const subject = normaliseSubject(weak.subject)
  return {
    ...weak,
    subject,
    subjectLabel: subject?.shortLabel || subject?.label || weak.subject || 'your weak subject',
    score: typeof weak.percentage === 'number' ? weak.percentage : null,
  }
}

function buildFocusPool(weakTopics = []) {
  const seen = new Set()
  const weakFocuses = weakTopics
    .map(topic => {
      const subject = normaliseSubject(topic.subject)
      const subjectLabel = subject?.shortLabel || subject?.label || topic.subject || 'a focus subject'
      const topicLabel = topic.topic || subjectLabel
      const score = toScore(topic.percentage)

      return {
        topic: topicLabel,
        subject,
        subjectLabel,
        score,
        weak: score === null || score < 70,
      }
    })
    .filter(focus => focus.topic && focus.weak)
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
    .filter(focus => {
      const key = `${focus.subject?.id || focus.subjectLabel}:${focus.topic}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  const fallbackFocuses = SUBJECTS
    .filter(subject => !seen.has(`${subject.id}:${subject.shortLabel || subject.label}`.toLowerCase()))
    .map(subject => ({
      topic: subject.shortLabel || subject.label,
      subject,
      subjectLabel: subject.shortLabel || subject.label,
      score: null,
      weak: false,
    }))

  return [...weakFocuses, ...fallbackFocuses].slice(0, 5)
}

function buildWeeklyPlan({ weakTopics = [], grade, aiNotesOn = false, weekKey }) {
  const focuses = buildFocusPool(weakTopics)
  const safeFocuses = focuses.length > 0
    ? focuses
    : [{
        topic: 'Mixed revision',
        subject: null,
        subjectLabel: 'Mixed revision',
        score: null,
        weak: false,
      }]

  // AI notes live on the learner Notes reader at /notes — there has never been
  // an /ai-notes route, so the flagged-on arm used to land the learner on the
  // 404 page. StudentDashboard's AI banner links to /notes for the same flag.
  // Same trap it already documents for the deleted /ai-practice route (PR
  // #713): a feature flag must not be able to surface a dead link. Both arms
  // are pinned by scripts/test-route-targets.mjs.
  const notePath = aiNotesOn ? '/notes' : '/lessons'
  const steps = [
    {
      day: 'Today',
      icon: Target,
      tone: 'violet',
      minutes: 15,
      badge: 'Focus',
      action: 'Start',
      title: focus => `Fix ${focus.topic}`,
      detail: focus => `${focus.subjectLabel}${focus.score !== null ? ` is at ${focus.score}%` : ''}. Do a short retry and write one correction.`,
    },
    {
      day: 'Tomorrow',
      icon: PencilLine,
      tone: 'amber',
      minutes: 20,
      badge: 'Quiz',
      action: 'Practise',
      title: focus => `${focus.subjectLabel} quiz`,
      detail: focus => `Take one quiz, then redo the questions you missed in ${focus.topic}.`,
    },
    {
      day: 'Day 3',
      icon: aiNotesOn ? Sparkles : BookOpen,
      tone: 'blue',
      minutes: 10,
      badge: 'Notes',
      action: 'Read',
      to: notePath,
      title: focus => `Read ${focus.subjectLabel} notes`,
      detail: focus => `Review the lesson idea behind ${focus.topic} before the next attempt.`,
    },
    {
      day: 'Day 4',
      icon: Target,
      tone: 'violet',
      minutes: 15,
      badge: 'Repeat',
      action: 'Focus',
      title: focus => `Second pass: ${focus.topic}`,
      detail: () => `Try the same skill again and aim for 70% or higher this time.`,
    },
    {
      day: 'Day 5',
      icon: TrophyIcon,
      tone: 'emerald',
      minutes: 25,
      badge: 'Check',
      action: 'Test',
      to: '/exams',
      title: focus => `${focus.subjectLabel} mini test`,
      detail: () => `Finish the week with timed practice and review every missed mark.`,
    },
  ]

  return steps.map((step, index) => {
    const focus = safeFocuses[index % safeFocuses.length]
    const subjectKey = focus.subject?.id || focus.subjectLabel
    return {
      ...step,
      key: `week:${weekKey}:${index}:${keyPart(subjectKey)}:${keyPart(focus.topic)}`,
      title: step.title(focus),
      detail: step.detail(focus),
      to: step.to || getSubjectPath(grade, focus.subject),
    }
  })
}

function taskTone(tone) {
  return {
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  }[tone] || 'theme-bg-subtle theme-accent-text theme-border'
}

function TaskDoneButton({ completed, disabled, saving, onClick, autoDone = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      aria-pressed={completed}
      title={autoDone ? 'Completed from activity' : completed ? 'Mark as not done' : 'Mark as done'}
      className={`mt-2 inline-flex min-h-0 flex-shrink-0 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-xs font-black transition-colors sm:mt-1 ${
        completed
          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
          : 'theme-bg-subtle theme-accent-text ring-1 theme-border'
      } ${(disabled || saving) ? 'cursor-not-allowed opacity-70' : 'hover:opacity-90'}`}
    >
      <Icon as={CheckCircleIcon} size="xs" strokeWidth={2.4} />
      {saving ? 'Saving' : completed ? 'Done' : 'Mark done'}
    </button>
  )
}

function TaskRow({ task, completed, saving, onToggle }) {
  const tone = taskTone(task.tone)
  return (
    <div className="flex items-start gap-3 py-3 transition-colors hover:theme-bg-subtle sm:-mx-2 sm:rounded-2xl sm:px-2">
      <Link to={task.to} className="group flex min-w-0 flex-1 items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl ring-1 ${completed ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : tone}`}>
          <Icon as={completed ? CheckCircleIcon : task.icon} size="sm" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="theme-text text-sm font-black leading-snug">{task.title}</p>
            {task.badge && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${completed ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : tone}`}>
                {completed ? 'Done' : task.badge}
              </span>
            )}
          </div>
          <p className="theme-text-muted mt-0.5 text-xs font-bold leading-relaxed">{task.detail}</p>
        </div>
        <span className="mt-1 hidden flex-shrink-0 items-center gap-1 text-xs font-black theme-accent-text transition-transform group-hover:translate-x-0.5 sm:inline-flex">
          {task.action}
          <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
        </span>
      </Link>
      <TaskDoneButton
        completed={completed}
        disabled={task.done}
        saving={saving}
        autoDone={task.done}
        onClick={() => onToggle(task)}
      />
    </div>
  )
}

function WeekPlanRow({ item, completed, saving, onToggle }) {
  const tone = taskTone(item.tone)
  return (
    <div className="flex min-h-[64px] items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-white/70">
      <Link to={item.to} className="group flex min-w-0 flex-1 items-center gap-3">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ring-1 ${completed ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : tone}`}>
          <Icon as={completed ? CheckCircleIcon : item.icon} size="sm" strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="theme-text-muted text-[10px] font-black uppercase">{item.day}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${completed ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : tone}`}>
              {completed ? 'Done' : `${item.badge} · ${item.minutes} min`}
            </span>
          </div>
          <p className="theme-text mt-0.5 text-sm font-black leading-snug">{item.title}</p>
          <p className="theme-text-muted mt-0.5 text-xs font-bold leading-relaxed">{item.detail}</p>
        </div>
        <span className="hidden flex-shrink-0 items-center gap-1 text-xs font-black theme-accent-text transition-transform group-hover:translate-x-0.5 sm:inline-flex">
          {item.action}
          <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
        </span>
      </Link>
      <TaskDoneButton
        completed={completed}
        saving={saving}
        onClick={() => onToggle(item)}
      />
    </div>
  )
}


// Compact heuristic summary consumed by <StudyPlanCard> on the dashboard —
// mirrors this component's own task logic (daily exams, weak-spot practice)
// without the Firestore-backed checklist, so the card stays a zero-fetch
// teaser for the full /study-plan page.
export function buildStudyPlan({ results = [], weakTopics = [], dailyGoal = { done: 0, total: 0 } } = {}) {
  const countdown = buildCountdown()
  const todayResults = results.filter((r) => isToday(r.completedAt ?? r.createdAt))
  const weakFocus = getWeakFocus(weakTopics)
  const hasWorkedWeakSubject = Boolean(
    weakFocus?.subject?.id
      && todayResults.some((r) => normaliseSubject(r.subject)?.id === weakFocus.subject.id),
  )
  const hasDailyExamTarget = dailyGoal.total > 0
  const examDone = hasDailyExamTarget && dailyGoal.done >= dailyGoal.total
  const done = [hasDailyExamTarget ? examDone : todayResults.length > 0, hasWorkedWeakSubject]
  const doneCount = done.filter(Boolean).length
  const total = done.length
  return { countdown, doneCount, total, progress: total ? Math.round((doneCount / total) * 100) : 0 }
}

export default function TodayStudyPlan({
  results = [],
  weakTopics = [],
  grade,
  streak = 0,
  dailyGoal = { done: 0, total: 0 },
  loading = false,
  aiNotesOn = false,
}) {
  const { currentUser } = useAuth()
  const [showFullWeek, setShowFullWeek] = useState(false)
  const todayDateKey = useMemo(() => toLocalDateKey(), [])
  const currentWeekKey = useMemo(() => toWeekKey(), [])
  const [progress, setProgress] = useState(() => normaliseStudyPlanProgress({}, '', {
    dateKey: todayDateKey,
    weekKey: currentWeekKey,
  }))
  const [progressLoading, setProgressLoading] = useState(false)
  const [progressError, setProgressError] = useState('')
  const [savingTaskKeys, setSavingTaskKeys] = useState(() => new Set())
  const weakFocus = useMemo(() => getWeakFocus(weakTopics), [weakTopics])
  const countdown = buildCountdown()
  const todayResults = results.filter(result => isToday(result.completedAt ?? result.createdAt))
  const hasStudiedToday = todayResults.length > 0
  const hasWorkedWeakSubject = Boolean(
    weakFocus?.subject?.id
      && todayResults.some(result => normaliseSubject(result.subject)?.id === weakFocus.subject.id),
  )

  const hasDailyExamTarget = dailyGoal.total > 0
  const examDone = hasDailyExamTarget && dailyGoal.done >= dailyGoal.total
  const gradeLabel = grade ? `Grade ${grade}` : 'your grade'
  const weakSubjectPath = getSubjectPath(grade, weakFocus?.subject)

  const tasks = useMemo(() => [
    hasDailyExamTarget
      ? {
          key: `daily:${todayDateKey}:exams`,
          icon: TrophyIcon,
          tone: 'amber',
          title: examDone ? 'Daily exams complete' : 'Finish today\'s exams',
          detail: examDone
            ? 'You have cleared the scheduled daily exams. Use the next task to sharpen weak spots.'
            : `${dailyGoal.done}/${dailyGoal.total} daily exam${dailyGoal.total === 1 ? '' : 's'} done for ${gradeLabel}.`,
          badge: examDone ? 'Done' : `${dailyGoal.total - dailyGoal.done} left`,
          action: examDone ? 'Review' : 'Start',
          to: '/exams',
          done: examDone,
        }
      : {
          key: `daily:${todayDateKey}:quiz:${keyPart(weakFocus?.subject?.id || weakFocus?.subjectLabel || 'mixed')}`,
          icon: PencilLine,
          tone: 'amber',
          title: hasStudiedToday ? 'Keep the practice going' : 'Take one quiz today',
          detail: hasStudiedToday
            ? `${todayResults.length} attempt${todayResults.length === 1 ? '' : 's'} completed today. One more keeps momentum high.`
            : `Start with one short ${gradeLabel} quiz to wake up your recall.`,
          badge: hasStudiedToday ? 'Active' : 'First task',
          action: 'Practise',
          to: weakSubjectPath,
          done: hasStudiedToday,
        },
    weakFocus
      ? {
          key: `daily:${todayDateKey}:weak:${keyPart(weakFocus.subject?.id || weakFocus.subjectLabel)}:${keyPart(weakFocus.topic || weakFocus.subjectLabel)}`,
          icon: Target,
          tone: 'violet',
          title: `Practise ${weakFocus.topic || weakFocus.subjectLabel}`,
          detail: `${weakFocus.subjectLabel}${weakFocus.score !== null ? ` is at ${weakFocus.score}%` : ''}. Spend 15 minutes on this before moving on.`,
          badge: 'Weak spot',
          action: 'Focus',
          to: weakSubjectPath,
          done: hasWorkedWeakSubject,
        }
      : {
          key: `daily:${todayDateKey}:weak:discovery`,
          icon: Target,
          tone: 'violet',
          title: 'Build a stronger subject',
          detail: 'No weak topic is showing yet. Take more quizzes so ZedExams can personalise this slot.',
          badge: 'Discovery',
          action: 'Find',
          to: '/quizzes',
          done: false,
        },
    {
      key: `daily:${todayDateKey}:read:${keyPart(weakFocus?.subject?.id || weakFocus?.subjectLabel || 'lesson')}`,
      icon: aiNotesOn ? Sparkles : BookOpen,
      tone: 'blue',
      title: weakFocus ? `Read ${weakFocus.subjectLabel} notes` : 'Read one lesson',
      detail: weakFocus
        ? 'Review the idea first, then come back for a second practice attempt.'
        : 'A short reading session makes the next quiz feel easier.',
      badge: '10 min',
      action: 'Read',
      // /notes, never /ai-notes — see the note in buildWeeklyPlan above.
      to: aiNotesOn ? '/notes' : '/lessons',
      done: false,
    },
  ], [
    aiNotesOn,
    dailyGoal.done,
    dailyGoal.total,
    examDone,
    gradeLabel,
    hasDailyExamTarget,
    hasStudiedToday,
    hasWorkedWeakSubject,
    todayDateKey,
    todayResults.length,
    weakFocus,
    weakSubjectPath,
  ])

  const weeklyPlan = useMemo(
    () => buildWeeklyPlan({ weakTopics, grade, aiNotesOn, weekKey: currentWeekKey }),
    [weakTopics, grade, aiNotesOn, currentWeekKey],
  )
  const visibleWeeklyPlan = showFullWeek ? weeklyPlan : weeklyPlan.slice(0, 3)
  const validTaskKeys = useMemo(
    () => [...tasks, ...weeklyPlan].map(item => item.key),
    [tasks, weeklyPlan],
  )
  const completedTaskKeys = useMemo(
    () => new Set(normaliseCompletedTaskKeys(progress.completedTaskKeys, validTaskKeys)),
    [progress.completedTaskKeys, validTaskKeys],
  )
  const isTaskComplete = task => Boolean(task.done || completedTaskKeys.has(task.key))
  const doneCount = tasks.filter(isTaskComplete).length
  const weeklyDoneCount = weeklyPlan.filter(item => completedTaskKeys.has(item.key)).length
  const progressPercent = Math.round((doneCount / tasks.length) * 100)
  const weeklyProgress = Math.round((weeklyDoneCount / weeklyPlan.length) * 100)
  const dailyPlanComplete = doneCount === tasks.length
  const planStreakLabel = progressLoading
    ? 'Loading saved plan'
    : progress.lastCompletedDate === todayDateKey
      ? `Plan streak ${Math.max(progress.planStreak, 1)}d`
      : 'Finish today for streak credit'

  useEffect(() => {
    let cancelled = false

    async function loadProgress() {
      if (!currentUser?.uid) {
        setProgress(normaliseStudyPlanProgress({}, '', {
          dateKey: todayDateKey,
          weekKey: currentWeekKey,
        }))
        return
      }

      setProgressLoading(true)
      setProgressError('')
      try {
        const saved = await getStudyPlanProgress(currentUser.uid, {
          dateKey: todayDateKey,
          weekKey: currentWeekKey,
        })
        if (!cancelled) setProgress(saved)
      } catch (err) {
        console.error('getStudyPlanProgress:', err)
        if (!cancelled) setProgressError('Saved checklist could not load.')
      } finally {
        if (!cancelled) setProgressLoading(false)
      }
    }

    loadProgress()
    return () => { cancelled = true }
  }, [currentUser?.uid, todayDateKey, currentWeekKey])

  async function handleToggleTask(item) {
    if (!currentUser?.uid) {
      setProgressError('Sign in to save checklist progress.')
      return
    }
    if (item.done) return

    const wasComplete = completedTaskKeys.has(item.key)
    const nextKeys = wasComplete
      ? progress.completedTaskKeys.filter(key => key !== item.key)
      : normaliseCompletedTaskKeys([...progress.completedTaskKeys, item.key], validTaskKeys)
    const nextBase = {
      ...progress,
      userId: currentUser.uid,
      dateKey: todayDateKey,
      weekKey: currentWeekKey,
      completedTaskKeys: nextKeys,
    }
    const nextDailyDone = tasks.every(task => task.done || nextKeys.includes(task.key))
    const nextProgress = nextDailyDone
      ? awardPlanStreak(nextBase, todayDateKey)
      : nextBase

    setProgress(nextProgress)
    setProgressError('')
    setSavingTaskKeys(prev => new Set(prev).add(item.key))

    try {
      await saveStudyPlanProgress(currentUser.uid, nextProgress, validTaskKeys)
    } catch (err) {
      console.error('saveStudyPlanProgress:', err)
      setProgress(progress)
      setProgressError('Could not save. Your connection may be offline.')
    } finally {
      setSavingTaskKeys(prev => {
        const next = new Set(prev)
        next.delete(item.key)
        return next
      })
    }
  }

  if (loading) {
    return (
      <section className="zx-card theme-card rounded-3xl border theme-border p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Skeleton height={16} width={144} />
            <Skeleton height={12} width={192} className="mt-2" />
          </div>
          <Skeleton height={40} width={80} className="!rounded-full" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton width={36} height={36} className="!rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton height={12} width="66%" />
                <Skeleton height={12} />
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section
      role="region"
      aria-label="Today's study plan"
      className="zx-card theme-card overflow-hidden rounded-3xl border theme-border shadow-sm"
    >
      <div className="border-b theme-border bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(14,165,233,0.10))] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 text-emerald-700 ring-1 ring-emerald-200">
                <Icon as={Calendar} size="md" strokeWidth={2.2} />
              </div>
              <div>
                <p className="theme-text text-base font-black leading-tight">Today&apos;s Study Plan</p>
                <p className="theme-text-muted text-xs font-bold">{countdown.label} · {countdown.detail}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-200">
              <Icon as={CheckCircleIcon} size="xs" strokeWidth={2.4} />
              {doneCount}/{tasks.length} done
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-black text-sky-700 ring-1 ring-sky-200">
              <Icon as={Clock} size="xs" strokeWidth={2.4} />
              {streak > 0 ? `${streak}d streak` : 'Start streak'}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-black ring-1 ${
              dailyPlanComplete
                ? 'text-emerald-700 ring-emerald-200'
                : 'text-amber-700 ring-amber-200'
            }`}>
              <Icon as={Sparkles} size="xs" strokeWidth={2.4} />
              {planStreakLabel}
            </span>
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/70 ring-1 ring-white/80">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-[width] duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="divide-y divide-current/10 px-4 sm:px-5">
        {tasks.map(task => (
          <TaskRow
            key={task.key}
            task={task}
            completed={isTaskComplete(task)}
            saving={savingTaskKeys.has(task.key)}
            onToggle={handleToggleTask}
          />
        ))}
      </div>

      <div className="border-t theme-border bg-[linear-gradient(135deg,rgba(255,255,255,0.72),rgba(14,165,233,0.08))] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 text-sky-700 ring-1 ring-sky-200">
              <Icon as={Sparkles} size="sm" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <p className="theme-text text-sm font-black leading-tight">This week&apos;s plan</p>
              <p className="theme-text-muted text-xs font-bold">
                {weeklyDoneCount}/{weeklyPlan.length} complete · built from today&apos;s goal and weak topics.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/study-plan"
              className="inline-flex items-center justify-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:opacity-90"
            >
              Full plan
              <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
            </Link>
            <button
              type="button"
              onClick={() => setShowFullWeek(value => !value)}
              aria-expanded={showFullWeek}
              className="inline-flex items-center justify-center gap-1 rounded-full theme-bg-subtle px-3 py-1.5 text-xs font-black theme-accent-text hover:opacity-90"
            >
              {showFullWeek ? 'Show less' : 'Show 5 days'}
              <Icon
                as={ChevronRight}
                size="xs"
                strokeWidth={2.4}
                className={showFullWeek ? '-rotate-90 transition-transform' : 'rotate-90 transition-transform'}
              />
            </button>
          </div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 ring-1 ring-white/80">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-[width] duration-500"
            style={{ width: `${weeklyProgress}%` }}
          />
        </div>

        <div className="mt-3 divide-y divide-current/10">
          {visibleWeeklyPlan.map(item => (
            <WeekPlanRow
              key={item.key}
              item={item}
              completed={completedTaskKeys.has(item.key)}
              saving={savingTaskKeys.has(item.key)}
              onToggle={handleToggleTask}
            />
          ))}
        </div>

        {progressError && (
          <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
            {progressError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t theme-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="theme-text-muted flex items-center gap-1.5 text-xs font-bold">
          <Icon as={BarChart3} size="xs" strokeWidth={2.4} />
          Share progress after finishing today&apos;s plan.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/profile"
            className="inline-flex items-center justify-center gap-1 rounded-full theme-bg-subtle px-3 py-1.5 text-xs font-black theme-accent-text hover:opacity-90"
          >
            <Icon as={Users} size="xs" strokeWidth={2.4} />
            Parent share
            <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
          </Link>
        </div>
      </div>
    </section>
  )
}
