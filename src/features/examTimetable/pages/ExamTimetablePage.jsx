/**
 * ExamTimetablePage — /timetable, prototype-v3 redesign.
 *
 * The full timetable screen the Home countdown chip and the Papers-tab
 * row tap through to (LEARNER_REDESIGN_SCOPE.md): a next-exam hero with
 * a live days/hrs/min/sec countdown, then the exam days as cards. Each
 * session shows its time block, paper code and duration with Practise
 * and Past papers actions; the choose-ONE sessions (Friday) render the
 * full alternatives list; the briefing day is dimmed and marked "No
 * paper written". The official ECZ PDF stays reachable at the bottom.
 *
 * Renders inside LearnerLayout (glass chrome + 4-tab nav), back to the
 * Papers tab. The season logic is unchanged from the previous page:
 *   BEFORE the exams  → hero counts down to the first SAT paper
 *   DURING the season → hero shows today's paper with time remaining
 *   AFTER the season  → congratulations + revision resource links
 *
 * Functional carry-overs from the pre-redesign page (working features,
 * restyled rather than dropped): the per-device choose-ONE selection
 * (a Silozi learner never re-picks their language), in-app reminders
 * (localStorage per learner + timetable), and archived years. The old
 * page's search/filter/collapse chrome is gone — five day cards don't
 * need it, and the prototype shows the whole week at once.
 *
 * Two clocks: `nowMs` ticks every second for the hero; everything else
 * takes the minute-floored `nowMinuteMs` so the day list re-renders
 * once a minute instead of every second.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useExamTimetables from '../../../hooks/useExamTimetables'
import { isNativePlatform } from '../../../utils/runtime'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'
import {
  PHASE,
  STATUS,
  getSeasonPhase,
  getSessionStatus,
  getCurrentSession,
  getNextSession,
  getNextPaperSession,
  countdownParts,
  hms,
  sessionLabel,
  REMINDER_OFFSETS,
  remindersEnabled,
  reminderStorageKey,
  getDueReminders,
  lusakaDateString,
} from '../../../utils/examTimetableLogic'

// localStorage guards — a blocked or full storage (Safari private mode)
// must never break the page.
function readStored(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* best-effort */
  }
}

// The learner's pick within a choose-ONE session, remembered per device
// and scoped by timetable id (session keys such as 'zl' repeat across
// years). Same keys the pre-redesign card wrote, so choices survive.
function choiceStorageKey(timetableId, sessionKey) {
  return `zx_exam_paper_choice_${timetableId}_${sessionKey}`
}
function readChoice(timetableId, sessionKey) {
  try {
    return localStorage.getItem(choiceStorageKey(timetableId, sessionKey)) || null
  } catch {
    return null
  }
}
function writeChoice(timetableId, sessionKey, code) {
  try {
    localStorage.setItem(choiceStorageKey(timetableId, sessionKey), code)
  } catch {
    /* best-effort */
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// "26–30 October 2026" from the timetable's ISO start/end (sliced, not
// Date-formatted — the strings carry the Lusaka offset already).
function spanText(timetable) {
  const s = timetable.startsAt || ''
  const e = timetable.endsAt || ''
  const sd = parseInt(s.slice(8, 10), 10)
  const ed = parseInt(e.slice(8, 10), 10)
  const sm = parseInt(s.slice(5, 7), 10) - 1
  const em = parseInt(e.slice(5, 7), 10) - 1
  if (!Number.isFinite(sd) || !Number.isFinite(ed)) return String(timetable.year || '')
  const monthName = (i) => new Date(2000, i, 1).toLocaleDateString('en-GB', { month: 'long' })
  return sm === em
    ? `${sd}–${ed} ${monthName(em)} ${timetable.year}`
    : `${sd} ${monthName(sm)} – ${ed} ${monthName(em)} ${timetable.year}`
}

function fmtWhen(iso) {
  const dateStr = iso.slice(0, 10)
  const d = new Date(`${dateStr}T12:00:00`)
  return `${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })} · ${iso.slice(11, 16)}`
}

// ── Hero ───────────────────────────────────────────────────────────

const COUNT_CELLS = [
  ['days', 'days'],
  ['hours', 'hrs'],
  ['minutes', 'min'],
  ['seconds', 'sec'],
]

function CountGrid({ parts }) {
  return (
    <div
      className="lhx-tt-count"
      role="timer"
      aria-label={`${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes, ${parts.seconds} seconds`}
    >
      {COUNT_CELLS.map(([key, unit]) => (
        <div key={key} className="lhx-tt-cell">
          <div className="lhx-tt-num">{key === 'days' ? parts[key] : String(parts[key]).padStart(2, '0')}</div>
          <div className="lhx-tt-unit">{unit}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * The indigo hero. BEFORE: countdown to the next sat paper (never the
 * briefing). DURING: today's session with live time remaining (or the
 * next one starting today). Between sessions on an exam evening it
 * falls back to the next paper countdown.
 */
function TimetableHero({ timetable, nowMs }) {
  const current = getCurrentSession(timetable, nowMs)
  const next = getNextSession(timetable, nowMs)
  const nextPaper = getNextPaperSession(timetable, nowMs)
  const nextIsToday = next && getSessionStatus(next, nowMs) === STATUS.TODAY

  if (current) {
    return (
      <section className="lhx-tt-hero" aria-label="Current exam">
        <div className="lhx-tt-lab">{current.briefing ? "Today's briefing" : "Today's exam · in progress"}</div>
        <div className="lhx-tt-next">{sessionLabel(current)}</div>
        <div className="lhx-tt-when">Started {current.start.slice(11, 16)} · Ends {current.end.slice(11, 16)}</div>
        <div className="lhx-tt-lab" style={{ marginTop: 14 }}>Time remaining</div>
        <div className="lhx-tt-remaining">{hms(Date.parse(current.end) - nowMs)}</div>
      </section>
    )
  }
  if (nextIsToday) {
    return (
      <section className="lhx-tt-hero" aria-label="Next exam">
        <div className="lhx-tt-lab">{next.briefing ? 'Today' : "Today's exam"}</div>
        <div className="lhx-tt-next">{sessionLabel(next)}</div>
        <div className="lhx-tt-when">Starts {next.start.slice(11, 16)} · Ends {next.end.slice(11, 16)}</div>
        <div className="lhx-tt-lab" style={{ marginTop: 14 }}>Starts in</div>
        <div className="lhx-tt-remaining">{hms(Date.parse(next.start) - nowMs)}</div>
      </section>
    )
  }
  if (nextPaper) {
    return (
      <section className="lhx-tt-hero" aria-label="Next exam">
        <div className="lhx-tt-lab">Next exam</div>
        <div className="lhx-tt-next">{sessionLabel(nextPaper)}</div>
        <div className="lhx-tt-when">{fmtWhen(nextPaper.start)}</div>
        <CountGrid parts={countdownParts(Date.parse(nextPaper.start), nowMs)} />
      </section>
    )
  }
  return (
    <section className="lhx-tt-hero" aria-label="Exams">
      <div className="lhx-tt-lab">Done for today</div>
      <div className="lhx-tt-next">Well done! 💪</div>
    </section>
  )
}

// Resource links once the season is over — the page never goes empty
// after the last paper.
const SEASON_OVER_LINKS = (grade) => [
  { label: '📄 Past Papers', to: `/papers?grade=${grade}` },
  { label: '📒 Revision Notes', to: '/notes' },
  { label: '🧠 Practice Quizzes', to: '/quizzes' },
  { label: '🏆 Mock Examinations', to: '/exams' },
  { label: `🌉 Grade ${grade + 1} Bridge Lessons`, to: '/lessons' },
]

function SeasonOverCard({ timetable }) {
  return (
    <section className="lhx-card">
      <p className="lhx-kicker">{timetable.shortName} · {timetable.board}</p>
      <h2 className="lhx-section-title" style={{ marginTop: 4 }}>
        🎉 {timetable.year} {timetable.examName} Completed
      </h2>
      <p className="lhx-page-sub" style={{ marginTop: 6 }}>
        Congratulations to all Grade {timetable.grade} learners — you made it! Keep the momentum
        going while you wait for your results:
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {SEASON_OVER_LINKS(timetable.grade).map((l) => (
          <Link key={l.label} to={l.to} className="lhx-btn lhx-btn-sm lhx-btn-soft" style={{ justifyContent: 'flex-start' }}>
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  )
}

// ── Sessions ───────────────────────────────────────────────────────

function paperActions(paper, grade, { completed = false } = {}) {
  const actions = []
  if (paper.subjectId) {
    actions.push({
      label: completed ? 'Practise similar' : 'Practise',
      to: `/practise/${grade}/${paper.subjectId}`,
      tone: '',
    })
  }
  actions.push({
    label: 'Past papers',
    to: paper.paperSubjectId
      ? `/papers?grade=${grade}&subject=${paper.paperSubjectId}`
      : `/papers?grade=${grade}`,
    tone: 'orange',
  })
  return actions
}

function SessionActions({ paper, grade, completed }) {
  return (
    <div className="lhx-tt-actions">
      {paperActions(paper, grade, { completed }).map((a) => (
        <Link key={a.label} to={a.to} className={`lhx-tt-act ${a.tone}`}>
          {a.label}
        </Link>
      ))}
    </div>
  )
}

/**
 * One session row. Briefing rows are dimmed with "No paper written";
 * completed rows dim and drop the Practise emphasis; choose-ONE rows
 * render the alternatives note + the full list as pills — tapping a
 * pill selects that paper (persisted per device) and its actions render
 * beneath. Archived rows are read-only.
 */
function SessionRow({ session, grade, timetableId, nowMs, archived = false, nextKey = null }) {
  const status = getSessionStatus(session, nowMs, { archived, nextKey })
  const completed = status === STATUS.COMPLETED
  const papers = session.papers || []
  const single = papers.length === 1 ? papers[0] : null
  const isMulti = papers.length > 1

  const [selectedCode, setSelectedCode] = useState(() =>
    isMulti && !archived ? readChoice(timetableId, session.key) : null,
  )
  const selectPaper = (code) => {
    if (archived) return
    const next = selectedCode === code ? null : code
    setSelectedCode(next)
    if (next) writeChoice(timetableId, session.key, next)
  }
  const selectedPaper = isMulti ? papers.find((p) => p.code === selectedCode) : null

  const heading = session.briefing ? session.title : single ? single.name : session.sessionNote || 'Choose your paper'
  const dimmed = session.briefing || (completed && !archived)

  return (
    <div className={`lhx-tt-sess ${session.briefing ? 'lhx-tt-brief' : ''} ${completed && !archived ? 'lhx-tt-done' : ''}`}>
      <div className="lhx-tt-time" aria-hidden="true">
        {session.start.slice(11, 16)}<br />{session.end.slice(11, 16)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lhx-tt-paper">
          {completed && !archived ? <span aria-hidden="true">✓ </span> : null}
          {heading}
        </div>
        <div className="lhx-tt-pmeta">
          {session.briefing
            ? 'No paper written'
            : single
              ? `Paper ${single.code} · ${single.durationMinutes} minutes`
              : `${papers.length} papers · ${papers[0].durationMinutes} minutes`}
          {status === STATUS.IN_PROGRESS ? ' · In progress' : ''}
        </div>
        {/* sr-only status so the state is never colour/opacity alone */}
        <span className="sr-only">
          {completed ? 'Completed exam.' : status === STATUS.IN_PROGRESS ? 'Exam in progress.' : ''}
        </span>
        {isMulti && (
          <div className="lhx-tt-alt">
            ⚠️ {session.sessionNote || 'Candidates sit ONE of these papers'}
            {!archived && ' — tap yours'}
            <div className="lhx-tt-altlist">
              {papers.map((p) =>
                archived ? (
                  <span key={p.code} className="lhx-tt-altpill">{p.name}</span>
                ) : (
                  <button
                    key={p.code}
                    type="button"
                    className="lhx-tt-altpill"
                    aria-pressed={selectedCode === p.code}
                    onClick={() => selectPaper(p.code)}
                  >
                    {p.name}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {!archived && !dimmed && single && <SessionActions paper={single} grade={grade} completed={completed} />}
        {!archived && completed && single && <SessionActions paper={single} grade={grade} completed />}
        {!archived && selectedPaper && <SessionActions paper={selectedPaper} grade={grade} completed={completed} />}
      </div>
    </div>
  )
}

/**
 * One exam day as a card: date tile + weekday + paper count, with a
 * "Next" badge on the next exam day (or "Done" once the day is over),
 * then the day's sessions.
 */
function DayCard({ day, grade, timetableId, nowMs, archived = false, nextKey = null }) {
  const d = new Date(`${day.date}T12:00:00`)
  const sessions = day.sessions || []
  const paperSessions = sessions.filter((s) => (s.papers || []).length > 0)
  const meta = paperSessions.length
    ? `${paperSessions.length} ${paperSessions.length === 1 ? 'paper session' : 'paper sessions'}`
    : 'Briefing only'
  const isNextDay = !archived && nextKey != null && sessions.some((s) => s.key === nextKey)
  const isToday = !archived && day.date === lusakaDateString(nowMs)
  const allDone =
    !archived &&
    sessions.length > 0 &&
    sessions.every((s) => getSessionStatus(s, nowMs) === STATUS.COMPLETED)

  return (
    <section className="lhx-tt-day" aria-label={`${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`}>
      <div className="lhx-tt-dayhead">
        <div className={`lhx-tt-dnum ${isNextDay || isToday ? 'is-next' : ''}`} aria-hidden="true">
          <span className="d">{d.getDate()}</span>
          <span className="m">{MONTHS[d.getMonth()]}</span>
        </div>
        <div>
          <div className="lhx-tt-dname">{DOW[d.getDay()]}</div>
          <div className="lhx-tt-dmeta">{meta}</div>
        </div>
        {isToday && !allDone && <span className="lhx-tt-badge">Today</span>}
        {!isToday && isNextDay && <span className="lhx-tt-badge">Next</span>}
        {allDone && <span className="lhx-tt-badge is-done">✓ Done</span>}
      </div>
      {sessions.map((s) => (
        <SessionRow
          key={s.key}
          session={s}
          grade={grade}
          timetableId={timetableId}
          nowMs={nowMs}
          archived={archived}
          nextKey={nextKey}
        />
      ))}
    </section>
  )
}

// ── Reminders (functional carry-over, prototype idiom) ─────────────

function ReminderBanners({ reminders, onDismiss }) {
  if (reminders.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {reminders.map((r) => (
        <div key={r.key} className="lhx-tt-remind">
          <span aria-hidden="true">⏰</span>
          <p style={{ flex: 1, minWidth: 0, margin: 0 }}>
            <b>{sessionLabel(r.session)}</b> — {fmtWhen(r.session.start)}
            <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', color: '#b3600c' }}>
              ({r.offsetLabel})
            </span>
          </p>
          <button
            type="button"
            onClick={() => onDismiss(r.key)}
            aria-label="Dismiss reminder"
            style={{ flexShrink: 0, fontWeight: 900 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

function ReminderCard({ prefs, onToggleEnabled, onToggleOffset }) {
  const enabled = remindersEnabled(prefs)
  const selected = new Set(prefs?.offsets || [])
  return (
    <section className="lhx-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="lhx-quick-icon lhx-tint-orange" aria-hidden="true" style={{ width: 40, height: 40, fontSize: 19 }}>⏰</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 900, margin: 0 }}>Exam reminders</p>
          <p className="lhx-back-sub" style={{ margin: 0 }}>Receive reminders before each paper</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable exam reminders"
          onClick={onToggleEnabled}
          className="lhx-switch"
        />
      </div>
      {enabled && (
        <div style={{ marginTop: 12, borderTop: '1px dashed var(--lhx-line)', paddingTop: 12 }}>
          <p className="lhx-kicker" style={{ marginBottom: 8 }}>Remind me</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {REMINDER_OFFSETS.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={selected.has(o.id)}
                onClick={() => onToggleOffset(o.id)}
                className="lhx-pick"
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="lhx-back-sub" style={{ marginTop: 8 }}>
            Reminders show here in the app when you open it within the window.
          </p>
        </div>
      )}
    </section>
  )
}

// ── PDF + archived ─────────────────────────────────────────────────

function OfficialPdfRows({ pdfUrl }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Link to="/timetable/pdf" className="lhx-card lhx-press" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="lhx-quick-icon lhx-tint-orange" aria-hidden="true" style={{ fontSize: 20 }}>📄</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14.5 }}>Official ECZ timetable</b>
          <span className="lhx-back-sub" style={{ display: 'block' }}>Open the signed PDF · read offline</span>
        </span>
        <span className="lhx-chevron" aria-hidden="true">›</span>
      </Link>
      {/* Android WebView can't run a browser download; the in-app viewer
          at /timetable/pdf covers reading it there. */}
      {!isNativePlatform() && pdfUrl && (
        <a href={pdfUrl} download className="lhx-btn lhx-btn-sm lhx-btn-soft lhx-btn-block">
          💾 Download official PDF
        </a>
      )}
    </div>
  )
}

function PastTimetables({ archived, nowMs, grade }) {
  const [openId, setOpenId] = useState(null)
  if (archived.length === 0) return null
  return (
    <section className="lhx-section">
      <h2 className="lhx-section-title">Past Exam Timetables</h2>
      {archived.map((t) => {
        const open = openId === t.id
        return (
          <div key={t.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : t.id)}
              aria-expanded={open}
              className="lhx-list-row"
            >
              <span style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: 14 }}>
                {t.year} {t.examName}
              </span>
              <span className="lhx-soon-badge">Archived</span>
              <span className="lhx-chevron" aria-hidden="true">{open ? '⌄' : '›'}</span>
            </button>
            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                {t.days.map((day) => (
                  <DayCard
                    key={day.date}
                    day={day}
                    grade={grade}
                    timetableId={t.id}
                    nowMs={nowMs}
                    archived
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Page ───────────────────────────────────────────────────────────

export default function ExamTimetablePage() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  // Grade-agnostic page; learners without a grade set get the Grade-7
  // PSLE timetable, matching the Home chip's gate.
  const grade = parseInt(userProfile?.grade, 10) || 7
  const { active, archived, loading, error } = useExamTimetables(grade)

  // 1 s clock for the hero; minute-floored clock for everything else.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const nowMinuteMs = nowMs - (nowMs % 60000)

  // Reminder prefs live in localStorage per learner + timetable.
  const prefsKey = active ? reminderStorageKey(currentUser?.uid, active.id) : null
  const [prefs, setPrefs] = useState(null)
  useEffect(() => {
    if (prefsKey) setPrefs(readStored(prefsKey) || { enabled: false, offsets: [], dismissed: {} })
  }, [prefsKey])
  const updatePrefs = (updater) => {
    setPrefs((prev) => {
      const next = updater(prev || { enabled: false, offsets: [], dismissed: {} })
      if (prefsKey) writeStored(prefsKey, next)
      return next
    })
  }
  const toggleEnabled = () =>
    updatePrefs((p) => {
      const enabled = !remindersEnabled(p)
      const offsets = enabled && (p.offsets || []).length === 0 ? ['1d'] : p.offsets
      return { ...p, enabled, offsets }
    })
  const toggleOffset = (id) =>
    updatePrefs((p) => ({
      ...p,
      offsets: p.offsets.includes(id) ? p.offsets.filter((o) => o !== id) : [...p.offsets, id],
    }))
  const dismissReminder = (key) =>
    updatePrefs((p) => ({ ...p, dismissed: { ...p.dismissed, [key]: true } }))

  const dueReminders = useMemo(
    () => (active && prefs ? getDueReminders(active, prefs, nowMinuteMs) : []),
    [active, prefs, nowMinuteMs],
  )

  const nextPaperKey = useMemo(
    () => (active ? getNextPaperSession(active, nowMinuteMs)?.key || null : null),
    [active, nowMinuteMs],
  )
  const phase = active ? getSeasonPhase(active, nowMs) : null

  return (
    <>
      <SeoHelmet title="Exam Timetable" path="/timetable" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Papers" onClick={() => navigate('/papers')}>
          ‹
        </button>
        <div>
          <h1 className="lhx-back-title">Exam Timetable</h1>
          {active && <p className="lhx-back-sub">Grade {active.grade} · {active.board} {active.year}</p>}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* .lhx-skel keeps the skeleton on the shell's palette */}
          {[150, 46, 110, 110].map((h, i) => (
            <Skeleton key={i} height={h} className="lhx-skel !rounded-[20px]" />
          ))}
        </div>
      ) : error && !active ? (
        <div className="lhx-card" style={{ textAlign: 'center' }}>
          <p style={{ fontWeight: 900, fontSize: 14 }}>We could not load the exam timetable.</p>
          <p className="lhx-back-sub" style={{ marginTop: 4 }}>Check your connection and try again.</p>
          <button type="button" className="lhx-btn lhx-btn-sm lhx-btn-primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      ) : !active ? (
        <div className="lhx-card" style={{ textAlign: 'center' }}>
          <p style={{ fontWeight: 900, fontSize: 14 }}>No exam timetable is available for Grade {grade} yet.</p>
          <p className="lhx-back-sub" style={{ marginTop: 4 }}>
            Check back soon — timetables appear here as soon as ECZ publishes them.
          </p>
        </div>
      ) : (
        <>
          {phase === PHASE.AFTER ? (
            <SeasonOverCard timetable={active} />
          ) : (
            <TimetableHero timetable={active} nowMs={nowMs} />
          )}

          <div className="lhx-tt-span">
            <span aria-hidden="true">📘</span>
            <span>
              <b>{active.examName}</b> · {active.board} · {active.days.length} days · {spanText(active)}
            </span>
          </div>

          <ReminderBanners reminders={dueReminders} onDismiss={dismissReminder} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {active.days.map((day) => (
              <DayCard
                key={day.date}
                day={day}
                grade={active.grade}
                timetableId={active.id}
                nowMs={nowMinuteMs}
                nextKey={nextPaperKey}
              />
            ))}
          </div>

          {phase !== PHASE.AFTER && (
            <ReminderCard prefs={prefs} onToggleEnabled={toggleEnabled} onToggleOffset={toggleOffset} />
          )}

          <OfficialPdfRows pdfUrl={active.pdfUrl} />

          <PastTimetables archived={archived} nowMs={nowMinuteMs} grade={grade} />
        </>
      )}
    </>
  )
}
