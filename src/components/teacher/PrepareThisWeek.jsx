/**
 * PrepareThisWeek — the dashboard's weekly-preparation guide (redesign §5).
 *
 * Purely presentational: TeacherDashboard derives the model with
 * buildWeekPrep() (src/utils/prepareThisWeek.js) from the generations it
 * already fetched — this component adds no Firestore reads or listeners.
 * Renders four states: loading skeleton, error (retry + escape hatch),
 * empty (set-up nudge), and the live progress card with the
 * Plan → Teach → Assess → Record stepper and one actionable row per
 * preparation artifact.
 */

import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  ListChecks,
  RefreshCw,
} from '../ui/icons'
import { capture } from '../../utils/analytics'

const STAGES = [
  { key: 'plan', label: 'Plan', icon: ClipboardList },
  { key: 'teach', label: 'Teach', icon: BookOpen },
  { key: 'assess', label: 'Assess', icon: ListChecks },
  { key: 'record', label: 'Record', icon: BarChart3 },
]

function RowStatusIcon({ status }) {
  if (status === 'done') {
    return (
      <span className="teacher-prepweek-row__status teacher-prepweek-row__status--done">
        <Icon as={Check} size="xs" />
      </span>
    )
  }
  if (status === 'alert') {
    return (
      <span className="teacher-prepweek-row__status teacher-prepweek-row__status--alert">
        <Icon as={AlertCircle} size="xs" />
      </span>
    )
  }
  return (
    <span
      className={`teacher-prepweek-row__status ${
        status === 'progress' ? 'teacher-prepweek-row__status--progress' : 'teacher-prepweek-row__status--todo'
      }`}
      aria-hidden="true"
    />
  )
}

function PrepRow({ row }) {
  const pct = row.target ? Math.round((Math.min(row.done, row.target) / row.target) * 100) : 0
  const showBar = row.target > 1
  return (
    <Link
      to={row.to}
      className={`teacher-prepweek-row teacher-prepweek-row--${row.status}`}
      onClick={() => capture('prepare_week_row_opened', { row: row.key, status: row.status })}
      aria-label={`${row.label} — open`}
    >
      <RowStatusIcon status={row.status} />
      <span className="teacher-prepweek-row__body">
        <span className="teacher-prepweek-row__label">{row.label}</span>
        <span className="teacher-prepweek-row__detail">{row.detail}</span>
        {showBar && (
          <span className="teacher-prepweek-row__bar" aria-hidden="true">
            <span className="teacher-prepweek-row__fill" style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <span
        className={`teacher-prepweek-row__meta ${row.status === 'alert' ? 'teacher-prepweek-row__meta--alert' : ''}`}
      >
        {row.meta}
      </span>
      <Icon as={ChevronRight} size="xs" className="teacher-prepweek-row__chev" />
    </Link>
  )
}

export default function PrepareThisWeek({ loading, error, prep, onRetry }) {
  const ready = !loading && !error && prep && !prep.empty
  const openedRef = useRef(false)
  useEffect(() => {
    if (ready && !openedRef.current) {
      openedRef.current = true
      capture('prepare_this_week_opened', {
        term: prep.context.termNumber,
        week: prep.context.weekNumber,
        stage: prep.stage,
      })
    }
  }, [ready, prep])

  if (loading) {
    return (
      <section className="teacher-prepweek teacher-prepweek--skeleton" role="status" aria-label="Prepare This Week">
        <span className="sr-only">Loading your weekly preparation progress…</span>
      </section>
    )
  }

  if (error) {
    return (
      <section className="teacher-prepweek" aria-label="Prepare This Week">
        <div className="teacher-prepweek__state">
          <span className="teacher-prepweek__state-icon" aria-hidden="true">
            <Icon as={AlertCircle} size="lg" />
          </span>
          <p className="teacher-prepweek__state-title">We could not load your weekly preparation progress.</p>
          <div className="teacher-prepweek__state-actions">
            <button type="button" className="teacher-prepweek__btn teacher-prepweek__btn--primary" onClick={onRetry}>
              <Icon as={RefreshCw} size="xs" />
              Try again
            </button>
            <Link to="/teacher/generate/weekly-forecast" className="teacher-prepweek__btn teacher-prepweek__btn--ghost">
              Open Weekly Focus
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (!prep || prep.empty) {
    return (
      <section className="teacher-prepweek" aria-label="Prepare This Week">
        <div className="teacher-prepweek__head">
          <h2 className="teacher-prepweek__title">Prepare This Week</h2>
        </div>
        <div className="teacher-prepweek__state">
          <span className="teacher-prepweek__state-icon" aria-hidden="true">
            <Icon as={CalendarDays} size="lg" />
          </span>
          <p className="teacher-prepweek__state-title">
            Set up your grade, subjects and current term to start weekly preparation.
          </p>
          <p className="teacher-prepweek__state-text">
            Create your first Weekly Focus — it captures your grade, subject and this term’s week in one step.
          </p>
          <div className="teacher-prepweek__state-actions">
            <Link
              to="/teacher/generate/weekly-forecast"
              className="teacher-prepweek__btn teacher-prepweek__btn--primary"
              onClick={() => capture('prepare_week_setup_clicked', {})}
            >
              Set up teaching profile
              <Icon as={ArrowRight} size="xs" />
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const { context, rows, stage } = prep
  const contextBits = [
    context.gradeLabel,
    `Term ${context.termNumber}`,
    `Week ${context.weekNumber}`,
    context.subjectLabel,
  ].filter(Boolean)
  const stageIdx = STAGES.findIndex((s) => s.key === stage)

  return (
    <section className="teacher-prepweek" aria-label="Prepare This Week">
      <div className="teacher-prepweek__head">
        <div>
          <h2 className="teacher-prepweek__title">Prepare This Week</h2>
          <p className="teacher-prepweek__context">{contextBits.join(' · ')}</p>
        </div>
        {context.rangeLabel && (
          <span className="teacher-prepweek__range">
            <Icon as={CalendarDays} size="xs" />
            {context.rangeLabel}
          </span>
        )}
      </div>

      <ol className="teacher-prepweek__stages" aria-label="Weekly stages">
        {STAGES.map((s, i) => {
          const state = stage === 'done' || i < stageIdx ? 'done' : i === stageIdx ? 'current' : 'next'
          return (
            <li key={s.key} className={`teacher-prepweek__stage teacher-prepweek__stage--${state}`}>
              <span className="teacher-prepweek__stage-icon" aria-hidden="true">
                <Icon as={s.icon} size="sm" />
              </span>
              <span className="teacher-prepweek__stage-label">
                {s.label}
                {state === 'current' && <span className="sr-only"> (current stage)</span>}
              </span>
              {i < STAGES.length - 1 && <span className="teacher-prepweek__stage-arrow" aria-hidden="true">→</span>}
            </li>
          )
        })}
      </ol>

      <div className="teacher-prepweek__rows">
        {rows.map((row) => (
          <PrepRow key={row.key} row={row} />
        ))}
      </div>

      <p className="teacher-prepweek__tip">
        <span aria-hidden="true">💡</span> Completing your weekly plan helps you stay organised and track learner
        progress easily.
      </p>

      <div className="teacher-prepweek__actions">
        <Link
          to={prep.continueTo}
          className="teacher-prepweek__btn teacher-prepweek__btn--primary"
          onClick={() => capture('weekly_preparation_continued', { stage })}
        >
          Continue weekly preparation
          <Icon as={ArrowRight} size="xs" />
        </Link>
        <Link
          to={prep.viewWeekTo}
          className="teacher-prepweek__btn teacher-prepweek__btn--ghost"
          onClick={() => capture('prepare_week_view_week', {})}
        >
          <Icon as={CalendarDays} size="xs" />
          View week
        </Link>
      </div>
    </section>
  )
}
