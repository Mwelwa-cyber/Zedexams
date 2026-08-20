/**
 * LearnerSchoolCalendarPage — the school calendar as a learner reads it.
 *
 * Reached from the Grade · Term chip on Home, which is the "something very
 * small" this screen sits behind: the chip states the term and the phase, and
 * tapping it explains where that answer came from.
 *
 * ── This is NOT the teacher's calendar page ─────────────────────────────────
 *
 * `features/teacherHome/pages/SchoolCalendar.jsx` is a different screen for a
 * different job — MoE navy/gold chrome, working-day and resident-day counts,
 * ECE mid-term windows, a planning surface. Mounting it here would be a
 * feature→feature import (which `test:import-boundaries` fails) AND would put
 * teacher chrome inside the learner shell. What the two screens share is the
 * DATA, one layer below both of them: `src/utils/moeCalendar.js`, read through
 * `src/utils/learnerCalendar.js`. Nothing on this page can reach a teacher, and
 * nothing a teacher does reaches this page.
 *
 * What a learner is told, and what is deliberately left out: term dates, which
 * term is running, how far into it we are, when the holidays fall and when
 * school opens again. Not working days, not resident days, not the ECE
 * mid-term break — those are administrative facts a child has no use for, and
 * the screen is shorter for leaving them on the teacher's side.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import LearnerIcon from '../components/LearnerIcon'
import { capture } from '../../../utils/analytics'
import {
  resolveLearnerCalendar,
  buildLearnerCalendarYear,
  learnerCalendarYears,
  defaultCalendarYear,
  upcomingLearnerHolidays,
  whenPhrase,
} from '../../../utils/learnerCalendar'

const STATUS_BADGE = {
  active: { label: 'Now', cls: 'is-now' },
  past: { label: 'Done', cls: 'is-done' },
  upcoming: { label: 'Coming', cls: 'is-coming' },
}

function TermCard({ term }) {
  const badge = STATUS_BADGE[term.status]
  return (
    <article className={`lhx-cal-term is-${term.status}`}>
      <div className="lhx-cal-term-head">
        <span className="lhx-cal-term-no" aria-hidden="true">T{term.number}</span>
        <div className="lhx-cal-term-id">
          <span className="lhx-cal-term-name">{term.name}</span>
          <span className="lhx-cal-term-dates">{term.openLabel} – {term.closeLabel}</span>
        </div>
        {badge && <span className={`lhx-cal-badge ${badge.cls}`}>{badge.label}</span>}
      </div>

      {term.status === 'active' && term.weekNumber != null && (
        <div className="lhx-cal-week">
          <div className="lhx-cal-week-line">
            <span>Week {term.weekNumber} of {term.totalWeeks}</span>
            <span>{term.daysUntilClose != null ? `Closes ${whenPhrase(term.daysUntilClose)}` : ''}</span>
          </div>
          <div className="lhx-cal-week-track">
            <div className="lhx-cal-week-fill" style={{ width: `${term.percent}%` }} />
          </div>
        </div>
      )}

      {term.status === 'upcoming' && term.daysUntilOpen != null && (
        <p className="lhx-cal-term-note">Opens {whenPhrase(term.daysUntilOpen)}.</p>
      )}

      {term.holidays.length > 0 && (
        <ul className="lhx-cal-hols">
          {term.holidays.map((h) => (
            <li key={h.date} className={h.isPast ? 'is-past' : ''}>
              <span className="lhx-cal-hol-date">{h.dayLabel}</span>
              <span className="lhx-cal-hol-name">{h.name}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function BreakRow({ row }) {
  return (
    <div className={`lhx-cal-break ${row.isNow ? 'is-now' : ''}`}>
      <span className="lhx-cal-break-icon" aria-hidden="true">🏖️</span>
      <div className="lhx-cal-break-txt">
        <span className="lhx-cal-break-title">{row.label}</span>
        <span className="lhx-cal-break-sub">
          {row.startLabel} – {row.endLabel} · {row.daysPhrase}
        </span>
      </div>
      {row.isNow && <span className="lhx-cal-badge is-now">Now</span>}
    </div>
  )
}

export default function LearnerSchoolCalendarPage() {
  const navigate = useNavigate()

  // One reading of the calendar for the whole screen. `[]` because the answer
  // only changes at midnight, and a page that re-derived it on every render
  // would still not repaint on the day rolling over — remounting does.
  const view = useMemo(() => resolveLearnerCalendar(), [])
  const soon = useMemo(() => upcomingLearnerHolidays(), [])

  const thisYear = useMemo(() => defaultCalendarYear(), [])
  const [year, setYear] = useState(thisYear)
  const model = useMemo(() => buildLearnerCalendarYear(year), [year])

  // Two years is enough of a switcher: the one we are in and the one next.
  // The calendar holds five, and a learner scrolling to 2030 is browsing, not
  // revising. The window is keyed to TODAY rather than to the selected year,
  // so the row of chips does not grow a new one every time you tap along it.
  const shownYears = useMemo(
    () => learnerCalendarYears().filter((y) => thisYear != null && y >= thisYear && y <= thisYear + 1),
    [thisYear],
  )

  const open = view.status === 'ok' && view.isSchoolOpen
  const heroTitle = view.status !== 'ok'
    ? 'Calendar unavailable'
    : open
      ? `${view.termName}${view.weekNumber ? ` · Week ${view.weekNumber} of ${view.totalWeeks}` : ''}`
      : view.nextTerm
        ? `${view.nextTerm.termName} opens ${whenPhrase(view.nextTerm.daysUntilOpen)}`
        : 'School is closed'

  return (
    <div>
      <SeoHelmet title="School Calendar" path="/school-calendar" noIndex />

      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Go back" onClick={() => navigate(-1)}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lhx-back-title">School Calendar</div>
          <div className="lhx-back-sub">Zambia Ministry of Education</div>
        </div>
        <LearnerIcon name="timetable" size={22} />
      </div>

      <section className={`lhx-cal-now ${open ? 'is-open' : 'is-closed'}`} aria-label="Where we are in the school year">
        {/* The kicker is a claim about the school, so it is only made when
            the calendar actually answered. An unusable reading says it does
            not know, rather than announcing a closure it cannot see. */}
        {view.status === 'ok' && (
          <span className="lhx-cal-now-kicker">{open ? 'School is open' : 'School is closed'}</span>
        )}
        <h2 className="lhx-cal-now-title">{heroTitle}</h2>
        {view.status === 'ok' && (
          <p className="lhx-cal-now-sub">
            {open
              ? `Ends on ${view.termCloseLabel}.`
              : view.nextTerm
                ? `Opens on ${view.nextTerm.openLabel}.`
                : ''}
          </p>
        )}
        {/* The one line that explains the rest of the app. A learner in the
            August holiday is shown Term 2 topics everywhere, and without this
            sentence that reads as the app being a term behind. */}
        {view.status === 'ok' && view.phase === 'holiday' && view.termName && (
          <p className="lhx-cal-now-why">
            Your subjects are still showing <b>{view.termName}</b> work — that is what you were
            taught last, and the holiday is a good time to go back over it.
          </p>
        )}
        {view.status !== 'ok' && (
          <p className="lhx-cal-now-sub">
            We don’t have term dates for this year yet.
          </p>
        )}
      </section>

      {shownYears.length > 1 && (
        <div className="lhx-cal-years" role="tablist" aria-label="Calendar year">
          {shownYears.map((y) => (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={y === year}
              className={`lhx-cal-year ${y === year ? 'is-on' : ''}`}
              onClick={() => { setYear(y); capture('school_calendar_year', { year: y }) }}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {model.exists ? (
        <div className="lhx-cal-rows">
          {model.rows.map((row) => (
            row.kind === 'term'
              ? <TermCard key={row.id} term={row} />
              : <BreakRow key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div className="lhx-card">
          <p className="lhx-back-sub">
            {year ? `We don’t have the ${year} calendar yet.` : 'We don’t have any term dates yet.'}
          </p>
        </div>
      )}

      {soon.length > 0 && (
        <section className="lhx-section" aria-labelledby="lhx-cal-soon">
          <div className="lhx-section-head">
            <h2 id="lhx-cal-soon" className="lhx-section-title">Coming up</h2>
          </div>
          <div className="lhx-card lhx-cal-soon">
            {soon.map((h) => (
              <div key={h.date} className="lhx-cal-soon-row">
                <span className="lhx-cal-soon-when">{h.whenPhrase}</span>
                <span className="lhx-cal-soon-name">{h.name}</span>
                <span className="lhx-cal-soon-date">{h.dayLabel}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="lhx-cal-foot">
        Term dates come from the Ministry of Education school calendar. Your own school may open
        or close a day or two either side.
      </p>
    </div>
  )
}
