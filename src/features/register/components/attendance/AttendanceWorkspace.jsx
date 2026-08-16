/**
 * AttendanceWorkspace — the working surface of the Class Register Studio for
 * one class + term: context bar (term dates · register state · lock
 * controls), section switcher (Daily · Term grid · Summary · Roster · Print &
 * Export), and the calendar-not-configured empty state with custom term dates.
 *
 * Mounted by both the standalone studio page (/teacher/attendance) and the
 * Attendance tab of a Class Register.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../../contexts/AuthContext'
import useClassRegister from '../../hooks/useClassRegister'
import { resolveAttendancePolicy, REGISTER_STATES } from '../../../../utils/attendanceConstants'
import { canMarkDay } from '../../lib/attendanceDayCore'
import {
  calendarMetaForTerm, formatDateLong, groupDaysByMonth, isValidIsoDate, markableDays,
} from '../../../../utils/attendanceCalendarResolver'
import { classDisplayName } from '../../../../shared/schemas/classRegister'
import { saveAttendanceTermSettings, setAttendanceTermState } from '../../services/attendanceService'
import { useToast } from '../../../../shared/components/Toast'
import Button from '../../../../shared/components/Button'
import Chip from '../../../../shared/components/Chip'
import ConfirmDialog from '../../../../shared/components/ConfirmDialog'
import Skeleton from '../../../../shared/components/Skeleton'
import MarkAttendanceView from './MarkAttendanceView'
import AttendanceGridView from './AttendanceGridView'
import AttendanceSummaryPanel from './AttendanceSummaryPanel'
import AttendanceInsightsPanel from './AttendanceInsightsPanel'
import RegisterValidationPanel from './RegisterValidationPanel'
import RegisterPrintView from './RegisterPrintView'
import RegisterPaperPreview from './RegisterPaperPreview'

/**
 * Four tabs, and there is deliberately no Roster among them (§10).
 *
 * Learner membership belongs to the Class List and nowhere else. A Roster tab
 * inside the register is a second, editable copy of every learner's name, and
 * a second copy is a copy that disagrees — the register showing "Chanda
 * Mulenga" while the class list, the results and the reports show "Chanda M.
 * Mulenga". The register READS the class list and links to it.
 */
const SECTIONS = [
  { key: 'daily', label: 'Mark Attendance' },
  { key: 'grid', label: 'Register Grid' },
  { key: 'summary', label: 'Term Summary' },
  { key: 'export', label: 'Print & Export' },
]

// Register lifecycle state → Chip variant (colours carry meaning: amber =
// still being worked on, blue = handed in, red = closed).
const STATE_CHIP_VARIANT = {
  draft: 'amber',
  submitted: 'blue',
  locked: 'red',
  reopened: 'amber',
}

function defaultSection() {
  if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) return 'grid'
  return 'daily'
}

export default function AttendanceWorkspace({ register, termSelection }) {
  const { currentUser, userProfile, isAdmin } = useAuth()
  const uid = currentUser?.uid
  const toast = useToast()
  const [section, setSection] = useState(defaultSection)
  // ONE month selection for the whole grid tab: the month chips drive both
  // the term grid AND the paper preview underneath it (D3). `null` until the
  // teacher picks — the default is the month containing today, else the last.
  const [pickedMonthKey, setPickedMonthKey] = useState(null)
  const [lockConfirm, setLockConfirm] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [stateBusy, setStateBusy] = useState(false)
  const [customDates, setCustomDates] = useState({ start: '', end: '' })

  const registerHook = useClassRegister({
    register,
    termSelection,
    uid,
    onConflict: ({ date, learnerIds }) => {
      toast.info(`Another teacher edited ${learnerIds.length} learner${learnerIds.length === 1 ? '' : 's'} on ${formatDateLong(date)} — both sets of changes were kept, latest tap wins.`)
    },
  })
  const {
    termInfo, termId, termState, termDocLoaded, days, selectedDate, hydrated, loadError,
  } = registerHook

  const policy = useMemo(
    () => resolveAttendancePolicy(registerHook.termDoc?.policy),
    [registerHook.termDoc],
  )

  // Default month = the one containing today, else the last register month —
  // the same rule the grid used when it owned this state.
  const monthKey = useMemo(() => {
    if (pickedMonthKey) return pickedMonthKey
    const months = groupDaysByMonth(days)
    const current = months.find((m) => m.key === registerHook.todayIso?.slice(0, 7))
    return (current || months[months.length - 1])?.key || null
  }, [pickedMonthKey, days, registerHook.todayIso])

  const selectedDay = days.find((d) => d.date === selectedDate) || null
  const canMark = useMemo(
    () => canMarkDay({ day: selectedDay, termInfo, termState }),
    [selectedDay, termInfo, termState],
  )
  const stateInfo = REGISTER_STATES[termState] || REGISTER_STATES.draft
  const canEdit = stateInfo.editable

  const termMeta = { termId, term: termSelection?.term, year: termSelection?.year, teacherUid: register.teacherUid }

  async function moveState(state, reason = '') {
    setStateBusy(true)
    try {
      await setAttendanceTermState(register.id, uid, termMeta, { state, reason })
      toast.success(`Register ${REGISTER_STATES[state].label.toLowerCase()}.`)
    } catch (err) {
      toast.error(`Could not update the register state: ${err.message || 'unexpected error'}`)
    } finally {
      setStateBusy(false)
      setLockConfirm(false)
      setReopenOpen(false)
      setReopenReason('')
    }
  }

  async function saveCustomDates(e) {
    e.preventDefault()
    if (!isValidIsoDate(customDates.start) || !isValidIsoDate(customDates.end) || customDates.start > customDates.end) {
      toast.error('Enter a valid start and end date (start before end).')
      return
    }
    try {
      await saveAttendanceTermSettings(register.id, uid, termMeta, {
        customStartDate: customDates.start,
        customEndDate: customDates.end,
        // Provenance metadata — printed registers and audits can always say
        // which calendar produced these dates.
        calendarSource: 'custom',
        calendarDatasetId: null,
        calendarVersion: null,
      })
      toast.success('Term dates saved — the register calendar is ready.')
    } catch (err) {
      toast.error(`Could not save term dates: ${err.message || 'unexpected error'}`)
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
        <p className="theme-text font-black">Couldn&apos;t load the register.</p>
        <p className="theme-text-muted text-sm mt-1">Check your connection and refresh the page.</p>
      </div>
    )
  }

  // Calendar not configured: no MoE data for this year/term and no custom dates yet.
  if (!termInfo) {
    if (!termDocLoaded) {
      return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>
    }
    return (
      <div className="theme-card border theme-border rounded-radius-md p-6 space-y-3">
        <p className="theme-text font-black">
          No official calendar preset exists for {termSelection?.term} {termSelection?.year}.
        </p>
        <p className="theme-text-muted text-sm">
          The bundled MoE presets cover 2026–2030; dates are never reused from another year. Enter this term&apos;s
          dates below (stored as school-customised dates), or review the{' '}
          <Link to="/teacher/calendar" className="theme-accent-text font-black">School Calendar</Link> page.
          When an official preset for {termSelection?.year} is released it can be added as a new versioned dataset.
        </p>
        <form onSubmit={saveCustomDates} className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Term start</span>
            <input type="date" value={customDates.start} onChange={(e) => setCustomDates((d) => ({ ...d, start: e.target.value }))}
              className="mt-1 block rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm" required />
          </label>
          <label className="block">
            <span className="theme-text-muted text-xs font-black uppercase tracking-wider">Term end</span>
            <input type="date" value={customDates.end} onChange={(e) => setCustomDates((d) => ({ ...d, end: e.target.value }))}
              className="mt-1 block rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm" required />
          </label>
          <Button type="submit" size="sm">Save term dates</Button>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* context bar: who this register is for, the term window, its state */}
      <div className="theme-card border theme-border rounded-radius-md p-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 mr-auto">
          <p className="theme-text font-display font-black text-base">
            {classDisplayName(register)}
            <Chip variant={STATE_CHIP_VARIANT[termState] || STATE_CHIP_VARIANT.draft} className="ml-2 align-middle">
              {stateInfo.label}
            </Chip>
          </p>
          <p className="theme-text-muted text-sm">
            {termSelection?.year} Academic Year · {termSelection?.term}
            {' · '}<span className="tabular-nums">{registerHook.roster?.length || 0}</span> learners
            {register.classTeacherName ? ` · Class teacher: ${register.classTeacherName}` : ''}
          </p>
          {/* Teacher-friendly term dates first; the calendar's dataset version
              is diagnostic detail and lives in the tooltip (§17). */}
          <p className="theme-text-muted text-xs">
            {formatDateLong(termInfo.startDate)} → {formatDateLong(termInfo.endDate)}
            {' · '}
            <span className="tabular-nums">{markableDays(days).length}</span> teaching days
            <span
              className="ml-1 underline decoration-dotted cursor-help"
              title={`Calendar source: ${calendarMetaForTerm(termInfo).label}`}
            >
              calendar
            </span>
          </p>
        </div>
        {/* The class list is the source of truth, and the register says so
            rather than keeping learners of its own (§9). */}
        <Link
          to={`/teacher/register/${register.id}/class-list`}
          className="zx-chip zx-chip--green"
        >
          ✓ {registerHook.roster?.length || 0} learners synced from Class List
        </Link>
        {termState === 'draft' && (
          <Button type="button" size="sm" variant="secondary" loading={stateBusy} onClick={() => moveState('submitted')}>
            Finalise term register
          </Button>
        )}
        {termState === 'submitted' && (
          <>
            <Button type="button" size="sm" variant="ghost" loading={stateBusy} onClick={() => moveState('draft')}>Back to draft</Button>
            <Button type="button" size="sm" variant="secondary" loading={stateBusy} onClick={() => setLockConfirm(true)}>Lock register</Button>
          </>
        )}
        {termState === 'reopened' && (
          <Button type="button" size="sm" variant="secondary" loading={stateBusy} onClick={() => setLockConfirm(true)}>Lock register</Button>
        )}
        {termState === 'locked' && (
          isAdmin ? (
            <Button type="button" size="sm" variant="secondary" loading={stateBusy} onClick={() => setReopenOpen(true)}>Reopen…</Button>
          ) : (
            <span className="theme-text-muted text-xs font-bold">Locked — view &amp; print only. An administrator can reopen it.</span>
          )
        )}
      </div>

      {/* section switcher */}
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 border-b theme-border" aria-label="Register sections">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)}
            className={`whitespace-nowrap px-3 py-2.5 text-sm font-black border-b-2 transition-colors ${
              s.key === section ? 'theme-accent-text border-current' : 'theme-text-muted border-transparent hover:theme-text'
            }`}>
            {s.label}
          </button>
        ))}
      </nav>

      {!hydrated && <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>}

      {hydrated && section === 'daily' && (
        <MarkAttendanceView registerHook={registerHook} canMark={canMark} />
      )}
      {hydrated && section === 'grid' && (
        <AttendanceGridView
          registerHook={registerHook}
          canEdit={canEdit}
          policy={policy}
          monthKey={monthKey}
          onMonthChange={setPickedMonthKey}
        />
      )}
      {/* The paper preview belongs to the grid, not to daily marking. On a
          phone it was a permanently-visible, unreadably small sheet under the
          attendance rows (§24); the Print & Export tab is where a teacher goes
          when they want to see the page. It previews the SAME month the grid's
          chips select — one month control for the whole tab (D3). */}
      {hydrated && section === 'grid' && (
        <RegisterPaperPreview
          registerHook={registerHook}
          register={register}
          uid={uid}
          teacherName={userProfile?.displayName || ''}
          policy={policy}
          monthKey={monthKey}
        />
      )}
      {hydrated && section === 'summary' && (
        <div className="space-y-4">
          <AttendanceSummaryPanel registerHook={registerHook} policy={policy} uid={uid} canEdit={canEdit} />
          <AttendanceInsightsPanel registerHook={registerHook} policy={policy} />
          <RegisterValidationPanel
            registerHook={registerHook}
            stage={termState}
            canFinalise={canEdit}
            finalising={stateBusy}
            onFinalise={() => moveState('submitted')}
          />
        </div>
      )}
      {hydrated && section === 'export' && (
        <RegisterPrintView
          registerHook={registerHook}
          register={register}
          uid={uid}
          teacherName={userProfile?.displayName || ''}
          policy={policy}
        />
      )}

      <ConfirmDialog
        open={lockConfirm}
        title="Lock this term's register?"
        message="After locking, attendance can be viewed and printed but not changed. An administrator can reopen the register with a recorded reason."
        confirmLabel="Lock register"
        onConfirm={() => moveState('locked')}
        onCancel={() => setLockConfirm(false)}
      />

      {reopenOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Reopen register">
          <div className="theme-card border theme-border rounded-radius-md w-full max-w-md p-4 space-y-3">
            <h2 className="theme-text font-black text-lg">Reopen locked register</h2>
            <p className="theme-text-muted text-sm">A reason is required and will be recorded in the audit trail.</p>
            <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3} maxLength={200}
              placeholder="Reason for reopening…"
              className="w-full rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setReopenOpen(false); setReopenReason('') }}>Cancel</Button>
              <Button type="button" size="sm" loading={stateBusy} disabled={!reopenReason.trim()}
                onClick={() => moveState('reopened', reopenReason)}>
                Reopen register
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
