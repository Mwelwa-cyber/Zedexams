/**
 * /teacher/register/:classId[/:tab] — a single Class Register.
 *
 * Tab shell for the in-class surfaces: Class List · SBA · Assessment Results ·
 * Mark Schedules · Reports · Progress. Class List is live; the rest land in
 * later phases (they read the same roster so learner names never get retyped).
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getRegister, archiveRegister, updateRegister } from '../../../utils/classRegister'
import { SUBJECTS } from '../../../config/curriculum'
import { formatClassGrade } from '../../../schemas/classRegister'
import { TERMS, nextPeriod, formatPeriod } from '../../../utils/classTerms'
import { useToast } from '../../ui/Toast'
import ConfirmDialog from '../../ui/ConfirmDialog'
import SeoHelmet from '../../seo/SeoHelmet'
import Skeleton from '../../ui/Skeleton'
import ClassListPanel from '../classList/ClassListPanel'
import { useRegisterUnsavedGuard, RegisterUnsavedGuardProvider } from './registerUnsavedGuard'
import AttendanceTab from './AttendanceTab'
import MarkSchedulesTab from './MarkSchedulesTab'
import ReportsTab from './ReportsTab'
import SbaTab from './SbaTab'
import AssessmentResultsTab from './AssessmentResultsTab'
import ProgressTab from './ProgressTab'

const TABS = [
  { key: 'class-list', label: 'Class List' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'sba', label: 'SBA' },
  { key: 'results', label: 'Assessment Results' },
  { key: 'schedules', label: 'Mark Schedules' },
  { key: 'reports', label: 'Reports' },
  { key: 'progress', label: 'Progress' },
]

export default function ClassRegisterDetail() {
  const { classId, tab } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'class-list'

  const [reg, setReg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  // Unsaved-marks guard: MarkEntryGrid (mounted deep inside a tab) publishes
  // its dirty flag here so the tab links / back / Edit / Archive confirm before
  // an SPA navigation unmounts the grid and discards typed-but-unsaved marks.
  const guard = useRegisterUnsavedGuard()
  const guardLink = (e) => { if (!guard.confirmDiscardIfDirty()) e.preventDefault() }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    getRegister(classId)
      .then((r) => { if (!cancelled) setReg(r) })
      .catch((err) => { console.warn('[ClassRegisterDetail] load failed', err); if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId])

  // Switch the class's current term/year. New marking records file under the
  // new period; existing records keep the period they were created in, so past
  // terms stay intact. The record/report/progress views default to this period.
  async function savePeriod(term, year) {
    const prev = { term: reg.term, year: reg.year }
    setReg((r) => ({ ...r, term, year })) // optimistic
    try {
      await updateRegister(classId, { term, year })
      toast.success(`Now in ${formatPeriod({ term, year })}.`)
    } catch (err) {
      setReg((r) => ({ ...r, ...prev })) // roll back
      toast.error(`Could not switch term: ${err.message || 'unexpected error'}`)
    }
  }

  async function handleArchive() {
    try {
      await archiveRegister(classId)
      toast.success('Class archived.')
      navigate('/teacher/register')
    } catch (err) {
      toast.error(`Could not archive: ${err.message || 'unexpected error'}`)
    } finally {
      setConfirmArchive(false)
    }
  }

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>
  }
  if (loadError) {
    return (
      <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-8 text-center">
        <p className="theme-text font-black">Couldn&apos;t load this class</p>
        <p className="theme-text-muted text-sm mt-2">Something went wrong. Refresh the page and try again.</p>
        <Link to="/teacher/register" className="theme-accent-text text-sm font-black mt-2 inline-block">← Back to my classes</Link>
      </div>
    )
  }
  if (!reg) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
        <p className="theme-text font-black">Class not found.</p>
        <Link to="/teacher/register" className="theme-accent-text text-sm font-black mt-2 inline-block">← Back to my classes</Link>
      </div>
    )
  }

  const subjectMeta = SUBJECTS.find((s) => s.id === reg.subject || s.label === reg.subject)
  // A small window of academic years around now + whatever the class is set to.
  const thisYear = new Date().getFullYear()
  const yearOptions = [...new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2, Number(reg.year) || thisYear])]
    .filter(Boolean)
    .sort((a, b) => a - b)

  return (
    <div className="space-y-5">
      <SeoHelmet title={reg.className} path={`/teacher/register/${classId}`} noIndex />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/teacher/register" onClick={guardLink} className="theme-text-muted text-xs font-black uppercase tracking-wider hover:theme-accent-text">
            ← Class List
          </Link>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1 truncate">{reg.className}</h1>
          <p className="theme-text-muted text-sm mt-1">
            {formatClassGrade(reg.grade)}
            {subjectMeta ? ` · ${subjectMeta.label}` : ''}
            {reg.school ? ` · ${reg.school}` : ''}
            {` · ${reg.learnerCount || 0} learner${reg.learnerCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/teacher/register/${classId}/edit`} onClick={guardLink}
            className="text-sm font-black theme-text-muted hover:theme-accent-text px-3 py-1.5">
            Edit
          </Link>
          <button type="button" onClick={() => { if (guard.confirmDiscardIfDirty()) setConfirmArchive(true) }}
            className="text-sm font-black theme-text-muted hover:text-red-500 px-3 py-1.5">
            Archive
          </button>
        </div>
      </div>

      {/* Current term/year — new records file under this period; switching
          here never touches records already saved in other terms. */}
      <div className="theme-card border theme-border rounded-radius-md p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-black theme-text-muted uppercase tracking-wider">Current term</span>
        <select
          value={reg.term || ''}
          onChange={(e) => savePeriod(e.target.value, reg.year)}
          className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm font-bold"
          aria-label="Term"
        >
          {!TERMS.includes(reg.term) && <option value={reg.term || ''}>{reg.term || 'No term'}</option>}
          {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={reg.year || ''}
          onChange={(e) => savePeriod(reg.term, Number(e.target.value))}
          className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm font-bold"
          aria-label="Year"
        >
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { const np = nextPeriod({ term: reg.term, year: reg.year }); savePeriod(np.term, np.year) }}
          className="theme-accent-text text-xs font-black px-2 py-1.5"
        >
          Advance to next term ▸
        </button>
      </div>

      {/* Tab nav — horizontally scrollable on small screens */}
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 border-b theme-border">
        {TABS.map((t) => {
          const isActive = t.key === activeTab
          return (
            <Link
              key={t.key}
              to={`/teacher/register/${classId}/${t.key}`}
              onClick={guardLink}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-black border-b-2 transition-colors ${
                isActive ? 'theme-accent-text border-current' : 'theme-text-muted border-transparent hover:theme-text'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {/* The grid that produces unsaved marks lives under these tabs; the
          provider lets it publish its dirty flag up to `guard` above. */}
      <RegisterUnsavedGuardProvider value={guard.contextValue}>
        {activeTab === 'class-list' && (
          <ClassListPanel register={reg} onRosterChange={(count) => setReg((r) => (r ? { ...r, learnerCount: count } : r))} />
        )}
        {activeTab === 'attendance' && <AttendanceTab register={reg} />}
        {activeTab === 'sba' && <SbaTab register={reg} />}
        {activeTab === 'results' && <AssessmentResultsTab register={reg} />}
        {activeTab === 'schedules' && <MarkSchedulesTab register={reg} />}
        {activeTab === 'reports' && <ReportsTab register={reg} />}
        {activeTab === 'progress' && <ProgressTab register={reg} />}
      </RegisterUnsavedGuardProvider>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this class?"
        message="The class and its roster are kept for your records, but it moves out of your active list. You can restore it later."
        confirmLabel="Archive"
        onConfirm={handleArchive}
        onCancel={() => setConfirmArchive(false)}
      />
    </div>
  )
}
