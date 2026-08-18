/**
 * The Grade 7 ECZ 2026 exam-timetable card, with a live countdown to the first
 * paper.
 *
 * The countdown ticks every second, so it is deliberately its own component:
 * inside GradeHub the same state would re-render the whole dashboard once a
 * second. Its parts are private to this file — nothing else counts down to a
 * fixed date.
 *
 * Not to be confused with `shared/hooks/useExamCountdown`, which is the clock
 * that runs DURING a timed assessment. This one counts down to a date months
 * away; that one counts down to a deadline and auto-submits.
 */
import { memo, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Download } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'
import { GRADE7_ECZ_EXAM_START } from '../../../../config/examDates'
import DashboardCharacter from './DashboardCharacter'
import { DASHBOARD_CHARACTERS } from './dashboardArt'

// Temporary, Grade-7-only banner card for the 2026 Primary School Leaving
// Examination (PSLE) timetable. Bundled as a static asset under
// public/timetables/, so it opens in a new tab where the learner can read
// it inline and use the browser's built-in download. Rendered only when the
// learner's grade is 7 (see the gate in the action-card stack below).
// First day of the 2026 Grade 7 Primary School Leaving Examination. Read from
// src/config/examDates.js, which reads it from the seeded ECZ timetable — one
// constant, in one place. This used to be a `new Date('2026-10-26T08:00:00')`
// literal here as well as a `startsAt` in the timetable, so correcting an ECZ
// date meant finding both; it also dropped the +02:00 offset, so a device on
// UTC counted down to two hours after the papers actually start.
const GRADE7_EXAM_START = new Date(GRADE7_ECZ_EXAM_START)

// Breaks the milliseconds until the exam into whole days/hours/minutes/seconds.
// Returns `over: true` once the start moment has passed so the card can swap
// its message instead of showing a negative countdown.
function getCountdownParts(targetMs, nowMs) {
  const diff = targetMs - nowMs
  if (diff <= 0) {
    return { over: true, days: 0, hours: 0, minutes: 0, seconds: 0 }
  }
  const totalSeconds = Math.floor(diff / 1000)
  return {
    over: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

// Live countdown to the exam, refreshed every second while mounted.
function useExamCountdown(target) {
  const targetMs = target.getTime()
  const [parts, setParts] = useState(() => getCountdownParts(targetMs, Date.now()))
  useEffect(() => {
    const tick = () => setParts(getCountdownParts(targetMs, Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetMs])
  return parts
}

// Single time unit shown in the countdown row (value + label).
const CountdownUnit = memo(function CountdownUnit({ value, label }) {
  return (
    <div className="flex min-w-[2.5rem] flex-col items-center rounded-xl bg-white/85 px-2 py-1 shadow-sm ring-1 ring-rose-200">
      <span className="text-base font-black tabular-nums leading-none text-rose-700 sm:text-lg">
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[9px] font-black uppercase tracking-wider text-rose-500">
        {label}
      </span>
    </div>
  )
})

function ExamTimetableCard() {
  const { over, days, hours, minutes, seconds } = useExamCountdown(GRADE7_EXAM_START)
  return (
    <section>
      <Link
        to="/timetable"
        className="zx-card group relative block min-h-[128px] overflow-hidden rounded-3xl border-2 border-rose-300 bg-[linear-gradient(135deg,#FFE4E6_0%,#FDA4AF_55%,#E11D48_100%)] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="relative z-10 flex min-h-[128px] flex-wrap items-center gap-3 p-4 pr-24 sm:gap-4 sm:p-5 sm:pr-32">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-sm">
            <Icon as={CalendarDays} size="lg" strokeWidth={2.1} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-widest text-rose-800">
              Grade 7 · ECZ 2026
            </p>
            <h3 className="mt-0.5 text-base font-black leading-tight text-rose-950">
              2026 Exam Timetable
            </h3>
            {over ? (
              <p className="mt-0.5 text-xs font-bold text-rose-900/80">
                Exams have started — best of luck! Tap to view the timetable.
              </p>
            ) : (
              <p className="mt-0.5 hidden text-xs font-bold text-rose-900/80 sm:block">
                {days === 0
                  ? 'Exams start today — tap to view the timetable'
                  : `${days} ${days === 1 ? 'day' : 'days'} until exams — tap to view the timetable`}
              </p>
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-1 rounded-full bg-rose-700 px-3 py-1.5 text-xs font-black text-white shadow-sm transition-transform group-hover:translate-x-0.5 sm:flex">
            View
            <Icon as={Download} size="xs" />
          </div>
        </div>
        {!over && (
          <div className="relative z-10 -mt-1 flex items-center gap-1.5 px-4 pb-4 sm:gap-2 sm:px-5 sm:pb-5">
            <span className="mr-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700/90">
              Starts in
            </span>
            <CountdownUnit value={days} label="Days" />
            <CountdownUnit value={hours} label="Hrs" />
            <CountdownUnit value={minutes} label="Min" />
            <CountdownUnit value={seconds} label="Sec" />
          </div>
        )}
        <DashboardCharacter
          image={DASHBOARD_CHARACTERS.timetable}
          alt="Wall calendar with a clock"
          variant="card"
          className="absolute top-1 right-2 z-0"
        />
      </Link>
    </section>
  )
}

export default ExamTimetableCard
