/**
 * /teacher/register/:classId[/:tab] — a single Class Register.
 *
 * Tab shell for the in-class surfaces: Class List · SBA · Assessment Results ·
 * Mark Schedules · Reports · Progress. Class List is live; the rest land in
 * later phases (they read the same roster so learner names never get retyped).
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getRegister, archiveRegister } from '../../../utils/classRegister'
import { SUBJECTS } from '../../../config/curriculum'
import { useToast } from '../../ui/Toast'
import ConfirmDialog from '../../ui/ConfirmDialog'
import SeoHelmet from '../../seo/SeoHelmet'
import Skeleton from '../../ui/Skeleton'
import ClassListTab from './ClassListTab'
import MarkSchedulesTab from './MarkSchedulesTab'
import ReportsTab from './ReportsTab'
import SbaTab from './SbaTab'
import AssessmentResultsTab from './AssessmentResultsTab'
import ProgressTab from './ProgressTab'

const TABS = [
  { key: 'class-list', label: 'Class List' },
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
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getRegister(classId)
      .then((r) => { if (!cancelled) setReg(r) })
      .catch((err) => console.warn('[ClassRegisterDetail] load failed', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classId])

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
  if (!reg) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
        <p className="theme-text font-black">Class not found.</p>
        <Link to="/teacher/register" className="theme-accent-text text-sm font-black mt-2 inline-block">← Back to my classes</Link>
      </div>
    )
  }

  const subjectMeta = SUBJECTS.find((s) => s.id === reg.subject || s.label === reg.subject)

  return (
    <div className="space-y-5">
      <SeoHelmet title={reg.className} path={`/teacher/register/${classId}`} noIndex />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/teacher/register" className="theme-text-muted text-xs font-black uppercase tracking-wider hover:theme-accent-text">
            ← My classes
          </Link>
          <h1 className="theme-text font-display font-black text-2xl sm:text-3xl mt-1 truncate">{reg.className}</h1>
          <p className="theme-text-muted text-sm mt-1">
            Grade {reg.grade}
            {reg.term ? ` · ${reg.term}` : ''}
            {reg.year ? ` · ${reg.year}` : ''}
            {subjectMeta ? ` · ${subjectMeta.label}` : ''}
            {reg.school ? ` · ${reg.school}` : ''}
            {` · ${reg.learnerCount || 0} learner${reg.learnerCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/teacher/register/${classId}/edit`}
            className="text-sm font-black theme-text-muted hover:theme-accent-text px-3 py-1.5">
            Edit
          </Link>
          <button type="button" onClick={() => setConfirmArchive(true)}
            className="text-sm font-black theme-text-muted hover:text-red-500 px-3 py-1.5">
            Archive
          </button>
        </div>
      </div>

      {/* Tab nav — horizontally scrollable on small screens */}
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 border-b theme-border">
        {TABS.map((t) => {
          const isActive = t.key === activeTab
          return (
            <Link
              key={t.key}
              to={`/teacher/register/${classId}/${t.key}`}
              className={`whitespace-nowrap px-3 py-2.5 text-sm font-black border-b-2 transition-colors ${
                isActive ? 'theme-accent-text border-current' : 'theme-text-muted border-transparent hover:theme-text'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {activeTab === 'class-list' && (
        <ClassListTab register={reg} onRosterChange={(count) => setReg((r) => (r ? { ...r, learnerCount: count } : r))} />
      )}
      {activeTab === 'sba' && <SbaTab register={reg} />}
      {activeTab === 'results' && <AssessmentResultsTab register={reg} />}
      {activeTab === 'schedules' && <MarkSchedulesTab register={reg} />}
      {activeTab === 'reports' && <ReportsTab register={reg} />}
      {activeTab === 'progress' && <ProgressTab register={reg} />}

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
