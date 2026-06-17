/**
 * Class List tab — the official roster for one Class Register.
 *
 * The single source of truth for learner names. Add learners by typing, or via
 * the import modal (paste / CSV / Excel / existing accounts). Mobile-friendly:
 * a table on ≥sm screens, stacked cards below.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  subscribeRoster,
  addRosterEntry,
  updateRosterEntry,
  setRosterStatus,
  removeRosterEntry,
} from '../../../utils/classRoster'
import { recordsMissingLearner } from '../../../utils/classRecords'
import { GENDERS, ROSTER_STATUSES } from '../../../utils/rosterImport'
import { useToast } from '../../ui/Toast'
import Button from '../../ui/Button'
import ConfirmDialog from '../../ui/ConfirmDialog'
import { Users } from '../../ui/icons'
import RosterImportModal from './RosterImportModal'
import NewLearnerSyncModal from './NewLearnerSyncModal'

const GENDER_LABEL = { M: 'Male', F: 'Female', other: 'Other' }
const STATUS_LABEL = { active: 'Active', transferred: 'Transferred', inactive: 'Inactive' }
const STATUS_TONE = {
  active: 'text-emerald-600',
  transferred: 'text-amber-600',
  inactive: 'theme-text-muted',
}

const EMPTY_DRAFT = { learnerNumber: '', fullName: '', gender: '', parentPhone: '' }

function LearnerForm({ draft, setDraft, onSubmit, onCancel, saving, editing }) {
  const inputCls = 'rounded-radius-md border theme-border theme-card theme-text px-2.5 py-2 text-sm'
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="theme-card border theme-border rounded-radius-md p-3 grid gap-2 sm:grid-cols-[80px_1fr_110px_140px_auto]"
    >
      <input className={inputCls} placeholder="No." value={draft.learnerNumber} onChange={set('learnerNumber')} maxLength={20} />
      <input className={inputCls} placeholder="Full name" value={draft.fullName} onChange={set('fullName')} maxLength={120} required />
      <select className={inputCls} value={draft.gender} onChange={set('gender')}>
        <option value="">Gender</option>
        {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
      </select>
      <input className={inputCls} placeholder="Parent phone" value={draft.parentPhone} onChange={set('parentPhone')} maxLength={40} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={saving}>{editing ? 'Save' : 'Add'}</Button>
        {editing && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

export default function ClassListTab({ register, onRosterChange }) {
  const classId = register.id
  const { currentUser } = useAuth()
  const toast = useToast()

  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [syncTarget, setSyncTarget] = useState(null) // { learner, records }

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeRoster(
      classId,
      (rows) => {
        setRoster(rows)
        setLoading(false)
        if (onRosterChange) onRosterChange(rows.filter((r) => r.status === 'active').length)
      },
      (err) => { console.warn('[ClassListTab] subscribe failed', err); setLoading(false) },
    )
    return unsub
  }, [classId, onRosterChange])

  const activeCount = useMemo(() => roster.filter((r) => r.status === 'active').length, [roster])

  async function handleAdd() {
    if (!draft.fullName.trim()) { toast.error('Enter the learner\'s full name.'); return }
    setSaving(true)
    try {
      const entry = {
        learnerNumber: draft.learnerNumber.trim(),
        fullName: draft.fullName.trim(),
        gender: draft.gender || null,
        parentPhone: draft.parentPhone.trim() || null,
      }
      const newId = await addRosterEntry(classId, currentUser.uid, entry)
      setDraft(EMPTY_DRAFT)
      // If this class already has records in the current term, offer to sync
      // the new learner in (existing marks untouched).
      try {
        const missing = await recordsMissingLearner(classId, newId, { term: register.term, year: register.year })
        if (missing.length > 0) {
          setSyncTarget({ learner: { id: newId, ...entry }, records: missing })
        }
      } catch (err) {
        console.warn('[ClassListTab] sync check failed', err)
      }
    } catch (err) {
      toast.error(`Could not add learner: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(entry) {
    setEditingId(entry.id)
    setEditDraft({
      learnerNumber: entry.learnerNumber || '',
      fullName: entry.fullName || '',
      gender: entry.gender || '',
      parentPhone: entry.parentPhone || '',
    })
  }

  async function handleEditSave() {
    if (!editDraft.fullName.trim()) { toast.error('Full name is required.'); return }
    setSaving(true)
    try {
      await updateRosterEntry(classId, editingId, {
        learnerNumber: editDraft.learnerNumber.trim(),
        fullName: editDraft.fullName.trim(),
        gender: editDraft.gender || null,
        parentPhone: editDraft.parentPhone.trim() || null,
      })
      setEditingId(null)
    } catch (err) {
      toast.error(`Could not save: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(entry, status) {
    try {
      await setRosterStatus(classId, entry.id, status)
    } catch (err) {
      toast.error(`Could not update status: ${err.message || 'unexpected error'}`)
    }
  }

  async function handleRemove() {
    try {
      await removeRosterEntry(classId, removeTarget.id)
      toast.success('Learner removed.')
    } catch (err) {
      toast.error(`Could not remove: ${err.message || 'unexpected error'}`)
    } finally {
      setRemoveTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="theme-text-muted text-sm">
          <span className="theme-text font-black">{activeCount}</span> active
          {roster.length !== activeCount ? ` · ${roster.length} total` : ''}
        </p>
        <Button size="sm" variant="secondary" leadingIcon={<Users size={16} />} onClick={() => setShowImport(true)}>
          Import learners
        </Button>
      </div>

      <LearnerForm draft={draft} setDraft={setDraft} onSubmit={handleAdd} saving={saving && !editingId} editing={false} />

      {loading ? (
        <p className="theme-text-muted text-sm py-6 text-center">Loading roster…</p>
      ) : roster.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <div className="text-4xl mb-2">🧑‍🏫</div>
          <p className="theme-text font-black">No learners yet</p>
          <p className="theme-text-muted text-sm mt-1">Add a learner above, or import a whole class list at once.</p>
        </div>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden sm:block overflow-x-auto theme-card border theme-border rounded-radius-md">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="theme-text-muted text-[11px] uppercase tracking-wider text-left border-b theme-border">
                  <th className="px-3 py-2 w-12">#</th>
                  <th className="px-3 py-2">Learner</th>
                  <th className="px-3 py-2 w-24">Gender</th>
                  <th className="px-3 py-2 w-36">Parent phone</th>
                  <th className="px-3 py-2 w-36">Status</th>
                  <th className="px-3 py-2 w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((entry, i) => (
                  editingId === entry.id ? (
                    <tr key={entry.id} className="border-b theme-border">
                      <td colSpan={6} className="px-3 py-2">
                        <LearnerForm draft={editDraft} setDraft={setEditDraft} onSubmit={handleEditSave}
                          onCancel={() => setEditingId(null)} saving={saving} editing />
                      </td>
                    </tr>
                  ) : (
                    <tr key={entry.id} className="border-b theme-border last:border-0">
                      <td className="px-3 py-2 theme-text-muted">{entry.learnerNumber || i + 1}</td>
                      <td className="px-3 py-2 theme-text font-bold">
                        {entry.fullName}
                        {entry.linkedUid && <span className="ml-2 text-[10px] theme-text-muted font-black uppercase">account</span>}
                      </td>
                      <td className="px-3 py-2 theme-text-muted">{entry.gender ? GENDER_LABEL[entry.gender] : '—'}</td>
                      <td className="px-3 py-2 theme-text-muted">{entry.parentPhone || '—'}</td>
                      <td className="px-3 py-2">
                        <select
                          value={entry.status}
                          onChange={(e) => handleStatusChange(entry, e.target.value)}
                          className={`bg-transparent text-xs font-black ${STATUS_TONE[entry.status]}`}
                          aria-label={`Status for ${entry.fullName}`}
                        >
                          {ROSTER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button type="button" onClick={() => startEdit(entry)} className="theme-text-muted hover:theme-accent-text text-xs font-black px-1.5">Edit</button>
                        <button type="button" onClick={() => setRemoveTarget(entry)} className="theme-text-muted hover:text-red-500 text-xs font-black px-1.5">Delete</button>
                      </td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="sm:hidden space-y-2">
            {roster.map((entry, i) => (
              <li key={entry.id} className="theme-card border theme-border rounded-radius-md p-3">
                {editingId === entry.id ? (
                  <LearnerForm draft={editDraft} setDraft={setEditDraft} onSubmit={handleEditSave}
                    onCancel={() => setEditingId(null)} saving={saving} editing />
                ) : (
                  <div className="flex items-start gap-3">
                    <span className="theme-text-muted text-xs font-black mt-0.5 w-5">{entry.learnerNumber || i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="theme-text font-black text-sm">{entry.fullName}</p>
                      <p className="theme-text-muted text-xs mt-0.5">
                        {entry.gender ? GENDER_LABEL[entry.gender] : 'Gender —'}
                        {entry.parentPhone ? ` · ${entry.parentPhone}` : ''}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <select
                          value={entry.status}
                          onChange={(e) => handleStatusChange(entry, e.target.value)}
                          className={`bg-transparent text-xs font-black ${STATUS_TONE[entry.status]}`}
                          aria-label={`Status for ${entry.fullName}`}
                        >
                          {ROSTER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                        <button type="button" onClick={() => startEdit(entry)} className="theme-accent-text text-xs font-black">Edit</button>
                        <button type="button" onClick={() => setRemoveTarget(entry)} className="text-red-500 text-xs font-black">Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {showImport && (
        <RosterImportModal
          classId={classId}
          teacherUid={currentUser.uid}
          onClose={() => setShowImport(false)}
          onImported={({ added, skipped }) => {
            setShowImport(false)
            toast.success(`Added ${added} learner${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`)
          }}
        />
      )}

      {syncTarget && (
        <NewLearnerSyncModal
          register={register}
          learner={syncTarget.learner}
          records={syncTarget.records}
          onClose={() => setSyncTarget(null)}
          onDone={() => setSyncTarget(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove this learner?"
        message={removeTarget ? `${removeTarget.fullName} will be removed from the class list. Marks already saved in past records keep their snapshot.` : ''}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}
