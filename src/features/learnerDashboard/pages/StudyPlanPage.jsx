import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { generateAIStudyPlan } from '../../../utils/aiAssistant'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import {
  BarChart3,
  BookOpen,
  Calendar,
  ChevronRight,
  Clock,
  PencilLine,
  RefreshCw,
  Sparkles,
  Target,
} from '../../../shared/components/icons'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function taskIcon(type) {
  if (type === 'read') return BookOpen
  if (type === 'results') return BarChart3
  return PencilLine
}

function fmtDate(value) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-ZM', { weekday: 'short', day: 'numeric', month: 'short' })
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, offset) {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + offset)
  return d
}

function pickFocusAreas(results = [], weakTopics = []) {
  const weak = weakTopics
    .filter(item => typeof item?.percentage !== 'number' || item.percentage < 70)
    .map(item => ({
      label: item.topic || item.subject || 'Weak topic',
      subject: item.subject || '',
      reason: typeof item.percentage === 'number' ? `${item.percentage}% mastery` : 'Needs practice',
    }))

  if (weak.length) return weak.slice(0, 5)

  const subjects = new Map()
  results.forEach(result => {
    if (!result.subject || typeof result.percentage !== 'number') return
    const row = subjects.get(result.subject) || { subject: result.subject, sum: 0, count: 0 }
    row.sum += result.percentage
    row.count += 1
    subjects.set(result.subject, row)
  })
  const fromResults = [...subjects.values()]
    .map(row => ({
      label: row.subject,
      subject: row.subject,
      reason: `${Math.round(row.sum / Math.max(row.count, 1))}% average`,
    }))
    .sort((a, b) => Number(a.reason.match(/\d+/)?.[0] || 100) - Number(b.reason.match(/\d+/)?.[0] || 100))

  if (fromResults.length) return fromResults.slice(0, 5)

  return [
    { label: 'Mathematics', subject: 'Mathematics', reason: 'Start building practice data' },
    { label: 'English', subject: 'English', reason: 'Keep reading and vocabulary active' },
    { label: 'Integrated Science', subject: 'Integrated Science', reason: 'Review ideas before quizzes' },
  ]
}

function routeFor(type) {
  if (type === 'read') return '/lessons'
  if (type === 'results') return '/my-results'
  return '/quizzes'
}

function buildQuickPlan({ userProfile, results, weakTopics, days, minutesPerDay }) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const focusAreas = pickFocusAreas(results, weakTopics)
  const warmup = Math.max(5, Math.round(minutesPerDay * 0.2))
  const practice = Math.max(10, Math.round(minutesPerDay * 0.55))
  const review = Math.max(5, minutesPerDay - warmup - practice)

  return {
    title: `Grade ${userProfile?.grade || '-'} study plan`,
    summary: 'A quick plan: revise the idea, practise with one quiz, then correct mistakes.',
    generatedAt: new Date().toISOString(),
    generatedBy: 'quick',
    focusAreas,
    days: Array.from({ length: days }, (_, index) => {
      const focus = focusAreas[index % focusAreas.length]
      const topic = focus.label || focus.subject || 'today'
      const subject = focus.subject || topic
      return {
        label: index === 0 ? 'Today' : `Day ${index + 1}`,
        date: toIsoDate(addDays(start, index)),
        focus: topic,
        checkpoint: 'Tick this day off after you review one mistake and one correct answer.',
        tasks: [
          {
            title: `Review ${topic}`,
            detail: 'Read a short note or lesson before answering questions.',
            minutes: warmup,
            type: 'read',
            subject,
            topic,
            route: routeFor('read'),
          },
          {
            title: `Practise ${subject}`,
            detail: 'Take one short quiz and aim for careful, calm answers.',
            minutes: practice,
            type: 'practice',
            subject,
            topic,
            route: routeFor('practice'),
          },
          {
            title: 'Correct and recap',
            detail: 'Open your result, write one mistake, then retry a similar question.',
            minutes: review,
            type: 'results',
            subject,
            topic,
            route: routeFor('results'),
          },
        ],
      }
    }),
    parentNudge: 'Share one completed task and one corrected mistake with a parent or teacher.',
    nextStep: 'Refresh after a new quiz result for a sharper plan.',
  }
}

function FocusPill({ item }) {
  return (
    <div className="rounded-2xl border theme-border theme-card px-3 py-2">
      <p className="theme-text text-xs font-black leading-tight">{item.label || item.subject}</p>
      <p className="theme-text-muted mt-0.5 text-[11px] font-bold leading-snug">
        {item.subject ? `${item.subject} · ` : ''}{item.reason || 'Focus area'}
      </p>
    </div>
  )
}

function TaskRow({ task }) {
  const TaskIcon = taskIcon(task.type)
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
        <Icon as={TaskIcon} size="sm" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="theme-text text-sm font-black leading-snug">{task.title}</p>
          {task.minutes ? (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700 ring-1 ring-sky-200">
              {task.minutes} min
            </span>
          ) : null}
        </div>
        <p className="theme-text-muted mt-0.5 text-xs font-bold leading-relaxed">{task.detail}</p>
      </div>
      <Link
        to={task.route || '/quizzes'}
        className="mt-1 inline-flex flex-shrink-0 items-center gap-1 rounded-full theme-bg-subtle px-2.5 py-1 text-xs font-black theme-accent-text"
      >
        Open
        <Icon as={ChevronRight} size="xs" strokeWidth={2.4} />
      </Link>
    </div>
  )
}

function DayCard({ day }) {
  return (
    <article className="zx-card theme-card overflow-hidden rounded-3xl border theme-border shadow-sm">
      <div className="border-b theme-border bg-[linear-gradient(135deg,rgba(14,165,233,0.11),rgba(16,185,129,0.10))] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="theme-text text-base font-black leading-tight">{day.label || fmtDate(day.date)}</p>
            <p className="theme-text-muted mt-1 text-xs font-bold">
              {fmtDate(day.date)}{day.focus ? ` · ${day.focus}` : ''}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-200">
            <Icon as={Target} size="xs" strokeWidth={2.4} />
            Focus
          </span>
        </div>
      </div>
      <div className="divide-y divide-current/10 px-4">
        {asArray(day.tasks).map((task, index) => (
          <TaskRow key={`${day.date || day.label}-${index}`} task={task} />
        ))}
      </div>
      {day.checkpoint ? (
        <div className="border-t theme-border px-4 py-3">
          <p className="theme-text-muted text-xs font-bold leading-relaxed">{day.checkpoint}</p>
        </div>
      ) : null}
    </article>
  )
}

export default function StudyPlanPage() {
  const { currentUser, userProfile, loading: authLoading } = useAuth()
  const { getUserResults, getWeaknessAnalysis } = useFirestore()
  const [minutesPerDay, setMinutesPerDay] = useState(45)
  const [days, setDays] = useState(7)
  const [examDate, setExamDate] = useState('')
  const [plan, setPlan] = useState(null)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function loadPlan(overrides = {}) {
    if (!currentUser) return
    setLoading(true)
    setError('')
    setWarning('')
    try {
      const payload = {
        minutesPerDay,
        days,
        examDate,
        ...overrides,
      }
      const [results, weakTopics] = await Promise.all([
        getUserResults(currentUser.uid, 30),
        getWeaknessAnalysis(currentUser.uid),
      ])
      const quickPlan = buildQuickPlan({
        userProfile,
        results,
        weakTopics,
        days: payload.days,
        minutesPerDay: payload.minutesPerDay,
      })
      setPlan(quickPlan)
      const response = await generateAIStudyPlan(payload)
      setPlan(response.plan || quickPlan)
      setWarning(response.warning || '')
    } catch (err) {
      setWarning('Showing a quick local plan. Deploy the study planner function to enable full AI planning.')
      setError('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && currentUser && !plan && !loading) {
      loadPlan()
    }
    // Initial load only; controls refresh through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, currentUser])

  const totalMinutes = useMemo(() => (
    asArray(plan?.days).reduce((sum, day) => (
      sum + asArray(day.tasks).reduce((taskSum, task) => taskSum + (Number(task.minutes) || 0), 0)
    ), 0)
  ), [plan])

  if (authLoading) {
    return <div className="max-w-3xl mx-auto p-6 theme-text-muted">Loading...</div>
  }

  if (!currentUser) return <Navigate to="/login?next=/study-plan" replace />

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <SeoHelmet title="AI Study Planner" path="/study-plan" noIndex />

      <section className="zx-card theme-card rounded-3xl border theme-border p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <Icon as={Sparkles} size="md" strokeWidth={2.2} />
              </div>
              <div>
                <h1 className="theme-text text-xl font-black leading-tight">AI Study Planner</h1>
                <p className="theme-text-muted text-xs font-bold">
                  Grade {userProfile?.grade || '-'} · {plan?.generatedBy === 'ai' ? 'Personalised' : 'Quick plan'}
                </p>
              </div>
            </div>
            {plan?.summary ? (
              <p className="theme-text-muted mt-3 text-sm font-bold leading-relaxed">{plan.summary}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full theme-bg-subtle px-2.5 py-1 text-xs font-black theme-text">
              <Icon as={Calendar} size="xs" strokeWidth={2.4} />
              {asArray(plan?.days).length || days} days
            </span>
            <span className="inline-flex items-center gap-1 rounded-full theme-bg-subtle px-2.5 py-1 text-xs font-black theme-text">
              <Icon as={Clock} size="xs" strokeWidth={2.4} />
              {totalMinutes || minutesPerDay * days} min
            </span>
          </div>
        </div>
      </section>

      <section className="zx-card theme-card rounded-3xl border theme-border p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="theme-text-muted text-xs font-black">Minutes per day</span>
            <input
              type="number"
              min="15"
              max="180"
              value={minutesPerDay}
              onChange={(e) => setMinutesPerDay(Number(e.target.value) || 45)}
              className="mt-1 w-full rounded-2xl border-2 theme-border theme-input px-3 py-2 text-sm font-bold focus:outline-none focus:border-current"
            />
          </label>
          <label className="block">
            <span className="theme-text-muted text-xs font-black">Plan length</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 7)}
              className="mt-1 w-full rounded-2xl border-2 theme-border theme-input px-3 py-2 text-sm font-bold focus:outline-none focus:border-current"
            >
              <option value={5}>5 days</option>
              <option value={7}>7 days</option>
              <option value={10}>10 days</option>
              <option value={14}>14 days</option>
            </select>
          </label>
          <label className="block">
            <span className="theme-text-muted text-xs font-black">Exam date</span>
            <input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 theme-border theme-input px-3 py-2 text-sm font-bold focus:outline-none focus:border-current"
            />
          </label>
          <Button
            onClick={() => loadPlan()}
            loading={loading}
            leadingIcon={<Icon as={RefreshCw} size="sm" />}
            className="w-full sm:w-auto"
          >
            Refresh
          </Button>
        </div>
      </section>

      {warning ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          {warning}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {error}
        </div>
      ) : null}

      {loading && !plan ? (
        <div className="theme-card rounded-3xl border theme-border p-8 text-center theme-text-muted font-bold">
          Building your plan...
        </div>
      ) : null}

      {asArray(plan?.focusAreas).length ? (
        <section className="space-y-2">
          <h2 className="theme-text text-sm font-black">Focus areas</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {asArray(plan.focusAreas).map((item, index) => (
              <FocusPill key={`${item.label || item.subject}-${index}`} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-3">
        {asArray(plan?.days).map((day, index) => (
          <DayCard key={`${day.date || day.label}-${index}`} day={day} />
        ))}
      </div>

      {plan?.parentNudge || plan?.nextStep ? (
        <section className="zx-card theme-card rounded-3xl border theme-border p-4 shadow-sm">
          {plan.parentNudge ? (
            <p className="theme-text text-sm font-black leading-relaxed">{plan.parentNudge}</p>
          ) : null}
          {plan.nextStep ? (
            <p className="theme-text-muted mt-2 text-xs font-bold leading-relaxed">{plan.nextStep}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
