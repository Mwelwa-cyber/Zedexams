/**
 * LearnerFormDialog — add one learner, edit one learner, or record that a
 * learner has left.
 *
 * Three modes because they are three different conversations, not three
 * variations of one form:
 *
 *   add    — the facts the school records when it admits a child (§18).
 *   edit   — correcting what is already recorded.
 *   leave  — transferring or withdrawing a learner. This is NOT a delete, and
 *            the dialog says so: past attendance is kept, dates after the
 *            leaving date show N/A, and the learner stays on every register
 *            they were on. There is no delete for a learner with history.
 *
 * A bottom sheet below 640px and a centred card above it, via ResponsiveModal.
 */

import { useEffect, useRef, useState } from 'react'
import ResponsiveModal from '../../../shared/components/ResponsiveModal'
import Button from '../../../shared/components/Button'
import { GENDERS } from '../../../utils/rosterImport'
import { selectableLearnerStatuses, learnerStatusMeta } from '../../../utils/learnerStatus'
import { AlertTriangle } from '../../../shared/icons/classListIcons'

const GENDER_LABEL = { M: 'Male', F: 'Female', other: 'Other' }

const LEAVING_REASONS = [
  'Transferred to another school',
  'Transferred to another class',
  'Withdrawn by parent or guardian',
  'Completed this level',
  'Other',
]

const EMPTY = {
  fullName: '',
  admissionNumber: '',
  gender: '',
  parentPhone: '',
  admissionDate: '',
  dateOfBirth: '',
  previousSchool: '',
  status: 'active',
  leftClassOn: '',
  leavingReason: '',
  destinationSchool: '',
  learnerNumber: '',
}

function toForm(learner) {
  if (!learner) return EMPTY
  return {
    ...EMPTY,
    fullName: learner.fullName || '',
    admissionNumber: learner.admissionNumber || '',
    gender: learner.gender || '',
    parentPhone: learner.parentPhone || '',
    admissionDate: learner.admissionDate || learner.joinedClassOn || '',
    dateOfBirth: learner.dateOfBirth || '',
    previousSchool: learner.previousSchool || '',
    status: learner.status || 'active',
    leftClassOn: learner.leftClassOn || '',
    leavingReason: learner.leavingReason || '',
    destinationSchool: learner.destinationSchool || '',
    learnerNumber: learner.learnerNumber || '',
  }
}

export default function LearnerFormDialog({
  mode = 'add',
  learner = null,
  className = '',
  isAdmin = false,
  saving = false,
  onSave,
  onClose,
}) {
  const [form, setForm] = useState(() => toForm(learner))
  const [error, setError] = useState('')
  const firstFieldRef = useRef(null)

  useEffect(() => { setForm(toForm(learner)) }, [learner])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const leaving = mode === 'leave'

  function submit(e) {
    e.preventDefault()
    if (!leaving && !form.fullName.trim()) {
      setError('Enter the learner’s full name.')
      return
    }
    if (leaving && !form.leftClassOn) {
      setError('Enter the date the learner left, so the register knows which days to mark as not applicable.')
      return
    }
    if (form.admissionDate && form.leftClassOn && form.leftClassOn < form.admissionDate) {
      setError('The leaving date cannot be before the admission date.')
      return
    }
    setError('')
    const patch = leaving
      ? {
        status: form.status === 'active' ? 'transferred' : form.status,
        leftClassOn: form.leftClassOn,
        leavingReason: form.leavingReason || null,
        destinationSchool: form.destinationSchool.trim() || null,
      }
      : {
        fullName: form.fullName.trim(),
        admissionNumber: form.admissionNumber.trim().toUpperCase() || null,
        gender: form.gender || null,
        parentPhone: form.parentPhone.trim() || null,
        admissionDate: form.admissionDate || null,
        joinedClassOn: form.admissionDate || null,
        dateOfBirth: form.dateOfBirth || null,
        previousSchool: form.previousSchool.trim() || null,
        status: form.status,
        learnerNumber: form.learnerNumber.trim(),
        // A record a teacher has just typed or corrected by hand is, by
        // definition, confirmed.
        needsReview: false,
        reviewReasons: [],
      }
    onSave(patch)
  }

  const labelCls = 'block text-xs font-black theme-text-muted uppercase tracking-wider mb-1'
  const inputCls = 'w-full rounded-radius-sm border theme-border theme-card theme-text px-3 py-2.5 text-sm min-h-[44px]'
  const title = leaving
    ? `Record that ${learner?.fullName || 'this learner'} has left`
    : mode === 'edit' ? 'Edit learner' : 'Add learner'

  return (
    <ResponsiveModal onClose={onClose} labelledBy="learner-form-title" initialFocusRef={firstFieldRef}
      footer={(
        <div className="flex items-center gap-2">
          <Button type="submit" form="learner-form" loading={saving}>
            {leaving ? 'Record departure' : mode === 'edit' ? 'Save changes' : 'Add learner'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}
    >
      <h2 id="learner-form-title" className="theme-text font-display font-black text-lg">{title}</h2>
      {className && <p className="theme-text-muted text-xs mt-0.5">{className}</p>}

      <form id="learner-form" onSubmit={submit} className="space-y-3 mt-4">
        {error && (
          <p role="alert" className="rounded-radius-sm border border-red-300 bg-red-50 text-red-800 text-xs font-bold px-3 py-2">
            {error}
          </p>
        )}

        {leaving ? (
          <>
            <div className="rounded-radius-sm border border-amber-300 bg-amber-50 px-3 py-2.5 flex gap-2">
              <AlertTriangle size={16} className="text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-amber-900 text-xs">
                This learner stays on every register they were marked on. Days after the leaving
                date show <span className="font-black">Not applicable</span>, and no attendance
                already recorded is removed.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="leftClassOn">Leaving date</label>
              <input ref={firstFieldRef} id="leftClassOn" type="date" className={inputCls}
                value={form.leftClassOn} onChange={set('leftClassOn')} required />
            </div>
            <div>
              <label className={labelCls} htmlFor="status">Status</label>
              <select id="status" className={inputCls} value={form.status === 'active' ? 'transferred' : form.status}
                onChange={set('status')}>
                {selectableLearnerStatuses({ isAdmin })
                  .filter((s) => s.value !== 'active')
                  .map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <p className="theme-text-muted text-xs mt-1">
                {learnerStatusMeta(form.status === 'active' ? 'transferred' : form.status).description}
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="leavingReason">Reason</label>
              <select id="leavingReason" className={inputCls} value={form.leavingReason} onChange={set('leavingReason')}>
                <option value="">Not recorded</option>
                {LEAVING_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="destinationSchool">Destination school (optional)</label>
              <input id="destinationSchool" className={inputCls} value={form.destinationSchool}
                onChange={set('destinationSchool')} maxLength={200} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelCls} htmlFor="fullName">Full name</label>
              <input ref={firstFieldRef} id="fullName" className={inputCls} value={form.fullName}
                onChange={set('fullName')} maxLength={120} required autoComplete="off" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="admissionNumber">Admission number</label>
                <input id="admissionNumber" className={inputCls} value={form.admissionNumber}
                  onChange={set('admissionNumber')} placeholder="ADM-001" maxLength={40} autoComplete="off" />
              </div>
              <div>
                <label className={labelCls} htmlFor="gender">Gender</label>
                <select id="gender" className={inputCls} value={form.gender} onChange={set('gender')}>
                  <option value="">Not recorded</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="parentPhone">Parent or guardian phone</label>
              <input id="parentPhone" type="tel" inputMode="tel" className={inputCls} value={form.parentPhone}
                onChange={set('parentPhone')} placeholder="0977 123 456" maxLength={40} autoComplete="off" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="admissionDate">Admission date</label>
                <input id="admissionDate" type="date" className={inputCls} value={form.admissionDate}
                  onChange={set('admissionDate')} />
                <p className="theme-text-muted text-xs mt-1">Register days before this show N/A.</p>
              </div>
              <div>
                <label className={labelCls} htmlFor="dateOfBirth">Date of birth (optional)</label>
                <input id="dateOfBirth" type="date" className={inputCls} value={form.dateOfBirth}
                  onChange={set('dateOfBirth')} />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="previousSchool">Previous school (optional)</label>
              <input id="previousSchool" className={inputCls} value={form.previousSchool}
                onChange={set('previousSchool')} maxLength={200} autoComplete="off" />
            </div>
            {mode === 'edit' && (
              <div>
                <label className={labelCls} htmlFor="status">Status</label>
                <select id="status" className={inputCls} value={form.status} onChange={set('status')}>
                  {selectableLearnerStatuses({ isAdmin }).map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <p className="theme-text-muted text-xs mt-1">{learnerStatusMeta(form.status).description}</p>
              </div>
            )}
          </>
        )}
      </form>
    </ResponsiveModal>
  )
}
