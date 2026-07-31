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
import { gradeLabel, subjectLabel } from '../../utils/teachingProfileCore'

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
        title={row.estimated ? 'Estimated from creation dates — older documents don’t record a planned teaching date.' : undefined}
      >
        {row.meta}
        {row.estimated && <span className="sr-only"> (estimated from creation dates)</span>}
      </span>
      <Icon as={ChevronRight} size="xs" className="teacher-prepweek-row__chev" />
    </Link>
  )
}

export default function PrepareThisWeek({ loading, error, prep, onRetry, assignments = [], activeAssignmentId, onSelectAssignment, termCoverage = null }) {
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
    // A missing calendar is a different problem from a missing Teaching Profile.
    const noCalendar = prep?.emptyReason === 'no-calendar'
    return (
      <section className="teacher-prepweek" aria-label="Prepare This Week">
        <div className="teacher-prepweek__head">
          <h2 className="teacher-prepweek__title">Prepare This Week</h2>
        </div>
        <div className="teacher-prepweek__state">
          <span className="teacher-prepweek__state-icon" aria-hidden="true">
            <Icon as={CalendarDays} size="lg" />
          </span>
          {noCalendar ? (
            <>
              <p className="teacher-prepweek__state-title">School Calendar information is unavailable.</p>
              <p className="teacher-prepweek__state-text">
                Your Teaching Profile is still safe. Review your School Calendar or try again shortly.
              </p>
              <div className="teacher-prepweek__state-actions">
                <Link to="/teacher/calendar" className="teacher-prepweek__btn teacher-prepweek__btn--primary">
                  View School Calendar
                  <Icon as={ArrowRight} size="xs" />
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="teacher-prepweek__state-title">
                Set up your Teaching Profile to start weekly preparation.
              </p>
              <p className="teacher-prepweek__state-text">
                Tell ZedExams which grades and subjects you teach so your dashboard can prepare the correct teaching work.
              </p>
              <div className="teacher-prepweek__state-actions">
                <Link
                  to="/settings/teaching-profile"
                  className="teacher-prepweek__btn teacher-prepweek__btn--primary"
                  onClick={() => capture('prepare_week_setup_clicked', {})}
                >
                  Set up Teaching Profile
                  <Icon as={ArrowRight} size="xs" />
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    )
  }

  const { context, rows, stage } = prep
  // During school holidays the card prepares NEXT term's Week 1 — the title
  // and date chip say so plainly instead of implying a live teaching week.
  const nextTerm = prep.mode === 'next-term'
  const title = nextTerm ? 'Prepare for Next Term' : 'Prepare This Week'
  const contextBits = [
    context.gradeLabel,
    `Term ${context.termNumber}`,
    `Week ${context.weekNumber}`,
    context.subjectLabel,
  ].filter(Boolean)
  const rangeText = nextTerm
    ? [
        context.openLabel ? `School opens ${context.openLabel}` : '',
        context.daysToOpen > 0 ? `in ${context.daysToOpen} day${context.daysToOpen === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · ')
    : context.rangeLabel
  const stageIdx = STAGES.findIndex((s) => s.key === stage)

  return (
    <section className="teacher-prepweek" aria-label={title}>
      <div className="teacher-prepweek__head">
        <div>
          <h2 className="teacher-prepweek__title">{title}</h2>
          <p className="teacher-prepweek__context">{contextBits.join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {/* Assignment context selector — only for a multi-subject teacher. */}
          {assignments.length > 1 && (
            <>
              <label htmlFor="prepweek-assignment" className="sr-only">Teaching assignment</label>
              <select
                id="prepweek-assignment"
                value={activeAssignmentId || ''}
                onChange={(e) => {
                  const a = assignments.find((x) => x.id === e.target.value)
                  if (a) onSelectAssignment?.(a)
                }}
                style={{ background: 'var(--zt-card)', color: 'var(--zt-text)', border: '1.5px solid #e4dcc6', borderRadius: 10, padding: '6px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', maxWidth: 220 }}
              >
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {gradeLabel(a.grade)} · {subjectLabel(a.subject)}{a.className ? ` · ${a.className}` : ''}
                  </option>
                ))}
              </select>
            </>
          )}
          {rangeText && (
            <span className="teacher-prepweek__range">
              <Icon as={CalendarDays} size="xs" />
              {rangeText}
            </span>
          )}
        </div>
      </div>

      {nextTerm ? null : (
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
      )}

      <div className="teacher-prepweek__rows">
        {rows.map((row) => (
          <PrepRow key={row.key} row={row} />
        ))}
      </div>

      <p className="teacher-prepweek__tip">
        <span aria-hidden="true">💡</span>{' '}
        {nextTerm
          ? 'School is closed — preparing your scheme and Week 1 now makes opening week easy.'
          : 'Completing your weekly plan helps you stay organised and track learner progress easily.'}
      </p>

      {/* Term coverage rollup — a compact recorded-vs-planned summary for the
          current term's Record of Work (derived; completion is never inferred).
          Null when there's no record or no calendar context: renders nothing. */}
      {termCoverage && (
        <p className="teacher-prepweek__tip" role="status">
          <span aria-hidden="true">🗂️</span>{' '}
          Term coverage: <b>{termCoverage.covered} of {termCoverage.due}</b> due teaching weeks covered
          {termCoverage.partial > 0 && <> · {termCoverage.partial} partially covered</>}
          {termCoverage.behind > 0 && <> · {termCoverage.behind} behind</>}
          {' — '}
          <Link
            to={`/teacher/generate/record-of-work?id=${termCoverage.recordId}`}
            onClick={() => capture('prepare_week_term_coverage_opened', {})}
          >
            View Record of Work
          </Link>
        </p>
      )}

      <div className="teacher-prepweek__actions">
        <Link
          to={prep.continueTo}
          className="teacher-prepweek__btn teacher-prepweek__btn--primary"
          onClick={() => capture('weekly_preparation_continued', { stage, mode: prep.mode || 'week' })}
        >
          {nextTerm ? 'Prepare Week 1' : 'Continue weekly preparation'}
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
