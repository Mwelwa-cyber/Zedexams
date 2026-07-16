/**
 * RegisterRosterManager — the roster from the attendance angle.
 *
 * The full roster editor stays in the Class List tab; this panel adds what the
 * register needs on top of it: enrolment-window dates (joined / left — the
 * inputs that make mid-term joiners and leavers calculate correctly), status,
 * ordering, quick add, and the existing import modal (paste / CSV / Excel /
 * existing learner accounts). Learners with history are never deleted here —
 * only marked transferred/inactive, with the leaving date recorded.
 */

import { useMemo, useState } from 'react'
import { addRosterEntry, updateRosterEntry } from '../../../../utils/classRoster'
import { localTodayIso } from '../../../../utils/attendanceCalendarResolver'
import { GENDERS, ROSTER_STATUSES } from '../../../../utils/rosterImport'
import { useToast } from '../../../ui/Toast'
import Button from '../../../ui/Button'
import RosterImportModal from '../RosterImportModal'

const GENDER_LABEL = { M: 'Male', F: 'Female', other: 'Other' }
const STATUS_LABEL = { active: 'Active', transferred: 'Transferred', inactive: 'Withdrawn' }
const SORTS = {
  order: { label: 'Register order', fn: (a, b) => (a.order || 0) - (b.order || 0) },
  name: { label: 'Name (A–Z)', fn: (a, b) => a.fullName.localeCompare(b.fullName) },
  admission: { label: 'Admission no.', fn: (a, b) => (a.learnerNumber || '').localeCompare(b.learnerNumber || '', undefined, { numeric: true }) },
}

export default function RegisterRosterManager({ registerHook, register, uid, canEdit, termInfo }) {
  const { roster, classId } = registerHook
  const toast = useToast()
  const [sortKey, setSortKey] = useState('order')
  const [showImport, setShowImport] = useState(false)
  const [draft, setDraft] = useState({ learnerNumber: '', fullName: '', gender: '' })
  const [savingAdd, setSavingAdd] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const sorted = useMemo(() => [...roster].sort(SORTS[sortKey].fn), [roster, sortKey])

  async function handleAdd(e) {
    e.preventDefault()
    if (!draft.fullName.trim()) return
    setSavingAdd(true)
    try {
      await addRosterEntry(classId, register.teacherUid || uid, {
        learnerNumber: draft.learnerNumber.trim(),
        fullName: draft.fullName.trim(),
        gender: draft.gender || null,
        // A learner added mid-term starts their eligibility today by default;
        // the date stays editable below.
        joinedClassOn: termInfo?.startDate || null,
      })
      setDraft({ learnerNumber: '', fullName: '', gender: '' })
      toast.success('Learner added to the roster.')
    } catch (err) {
      toast.error(`Could not add learner: ${err.message || 'unexpected error'}`)
    } finally {
      setSavingAdd(false)
    }
  }

  async function patchLearner(learner, patch, okMessage) {
    setBusyId(learner.id)
    try {
      await updateRosterEntry(classId, learner.id, patch)
      if (okMessage) toast.success(okMessage)
    } catch (err) {
      toast.error(`Could not update ${learner.fullName}: ${err.message || 'unexpected error'}`)
    } finally {
      setBusyId(null)
    }
  }

  const dateInputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2 py-1 text-xs'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="theme-text-muted text-xs font-black uppercase tracking-wider" htmlFor="roster-sort">Sort</label>
        <select id="roster-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value)}
          className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1.5 text-sm font-bold">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {canEdit && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowImport(true)}>
              Import CSV / Excel / accounts
            </Button>
          )}
        </div>
      </div>

      {canEdit && (
        <form onSubmit={handleAdd} className="theme-card border theme-border rounded-radius-md p-3 grid gap-2 sm:grid-cols-[90px_1fr_120px_auto]">
          <input className="rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm" placeholder="Adm no."
            value={draft.learnerNumber} onChange={(e) => setDraft((d) => ({ ...d, learnerNumber: e.target.value }))} maxLength={20} />
          <input className="rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm" placeholder="Full name" required
            value={draft.fullName} onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))} maxLength={120} />
          <select className="rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm"
            value={draft.gender} onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value }))}>
            <option value="">Gender</option>
            {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
          </select>
          <Button type="submit" size="sm" loading={savingAdd}>Add learner</Button>
        </form>
      )}

      {sorted.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <p className="theme-text font-black">This class has no learners yet.</p>
          <p className="theme-text-muted text-sm mt-1">Add a learner above or import your class list.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border theme-border rounded-radius-md">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="theme-card border-b theme-border text-xs theme-text-muted">
                <th className="px-2 py-2">No.</th>
                <th className="px-2 py-2">Adm</th>
                <th className="px-2 py-2">Learner</th>
                <th className="px-2 py-2">Gender</th>
                <th className="px-2 py-2">Joined</th>
                <th className="px-2 py-2">Left</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l, i) => (
                <tr key={l.id} className={`border-b theme-border ${busyId === l.id ? 'opacity-50' : ''}`}>
                  <td className="px-2 py-1.5 text-xs theme-text-muted font-black">{sortKey === 'order' ? (l.order || i + 1) : i + 1}</td>
                  <td className="px-2 py-1.5 text-xs theme-text-muted">{l.learnerNumber || '—'}</td>
                  <td className="px-2 py-1.5 theme-text font-bold whitespace-nowrap">{l.fullName}</td>
                  <td className="px-2 py-1.5 text-xs theme-text-muted">{GENDER_LABEL[l.gender] || '—'}</td>
                  <td className="px-2 py-1.5">
                    <input type="date" className={dateInputCls} value={l.joinedClassOn || ''} disabled={!canEdit}
                      aria-label={`${l.fullName} joined class on`}
                      onChange={(e) => patchLearner(l, { joinedClassOn: e.target.value || null })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" className={dateInputCls} value={l.leftClassOn || ''} disabled={!canEdit}
                      aria-label={`${l.fullName} left class on`}
                      onChange={(e) => patchLearner(l, { leftClassOn: e.target.value || null })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={l.status || 'active'} disabled={!canEdit}
                      aria-label={`${l.fullName} enrolment status`}
                      onChange={(e) => {
                        const status = e.target.value
                        const patch = { status }
                        // Leaving statuses default the leaving date to today so
                        // eligibility stops accruing (still editable).
                        if (status !== 'active' && !l.leftClassOn) {
                          patch.leftClassOn = localTodayIso()
                        }
                        patchLearner(l, patch, `${l.fullName} marked ${STATUS_LABEL[status] || status}.`)
                      }}
                      className="rounded-radius-md border theme-border theme-card theme-text px-2 py-1 text-xs font-bold">
                      {ROSTER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="theme-text-muted text-xs">
        Learners with attendance history are never deleted — mark them transferred or withdrawn and their
        records stay in every past register. Full roster editing (parent phone, reordering, removal) lives in
        the Class List tab.
      </p>

      {showImport && (
        <RosterImportModal
          classId={classId}
          teacherUid={register.teacherUid || uid}
          onClose={() => setShowImport(false)}
          onImported={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
