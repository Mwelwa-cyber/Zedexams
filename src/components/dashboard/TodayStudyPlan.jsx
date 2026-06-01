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
} from '../ui/icons'
import Icon from '../ui/Icon'
import { SUBJECTS } from '../../config/curriculum'
import { daysUntil, fmtDate, getActiveTerm, getNextTerm } from '../../utils/moeCalendar'

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

function taskTone(tone) {
  return {
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  }[tone] || 'theme-bg-subtle theme-accent-text theme-border'
}

function TaskRow({ task }) {
  const tone = taskTone(task.tone)
  return (
    <Link
      to={task.to}
      className="group flex items-center gap-3 rounded-2xl py-3 transition-colors hover:theme-bg-subtle sm:-mx-2 sm:px-2"
    >
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ring-1 ${task.done ? 'bg-emerald-100 text-emerald-700 ring-emerald-200' : tone}`}>
        <Icon as={task.done ? CheckCircleIcon : task.icon} size="sm" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="theme-text text-sm font-black leading-snug">{task.title}</p>
          {task.badge && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${tone}`}>
              {task.badge}
            </span>
          )}
        </div>
        <p className="theme-text-muted mt-0.5 text-xs font-bold leading-relaxed">{task.detail}</p>
      </div>
      <span className="inline-flex flex-shrink-0 items-center gap-1 self-center rounded-full theme-bg-subtle px-2.5 py-1.5 text-xs font-black theme-accent-text transition-transform group-hover:translate-x-0.5">
        <span className="hidden sm:inline">{task.action}</span>
        <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
      </span>
    </Link>
  )
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
  const weakFocus = getWeakFocus(weakTopics)
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

  const tasks = [
    hasDailyExamTarget
      ? {
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
      icon: aiNotesOn ? Sparkles : BookOpen,
      tone: 'blue',
      title: weakFocus ? `Read ${weakFocus.subjectLabel} notes` : 'Read one lesson',
      detail: weakFocus
        ? 'Review the idea first, then come back for a second practice attempt.'
        : 'A short reading session makes the next quiz feel easier.',
      badge: '10 min',
      action: 'Read',
      to: aiNotesOn ? '/ai-notes' : '/lessons',
      done: false,
    },
  ]

  const doneCount = tasks.filter(task => task.done).length
  const progress = Math.round((doneCount / tasks.length) * 100)

  if (loading) {
    return (
      <section className="zx-card theme-card rounded-3xl border theme-border p-4 shadow-sm animate-pulse">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="h-4 w-36 rounded bg-current/10" />
            <div className="mt-2 h-3 w-48 rounded bg-current/10" />
          </div>
          <div className="h-10 w-20 rounded-full bg-current/10" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-current/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 rounded bg-current/10" />
                <div className="h-3 w-full rounded bg-current/10" />
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
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-current/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="divide-y divide-current/10 px-4 sm:px-5">
        {tasks.map(task => <TaskRow key={task.title} task={task} />)}
      </div>

      <div className="flex flex-col gap-2 border-t theme-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="theme-text-muted flex items-center gap-1.5 text-xs font-bold">
          <Icon as={BarChart3} size="xs" strokeWidth={2.4} />
          Share progress after finishing today&apos;s plan.
        </p>
        <Link
          to="/profile"
          className="inline-flex items-center justify-center gap-1 rounded-full theme-bg-subtle px-3 py-1.5 text-xs font-black theme-accent-text hover:opacity-90"
        >
          <Icon as={Users} size="xs" strokeWidth={2.4} />
          Parent share
          <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
        </Link>
      </div>
    </section>
  )
}
