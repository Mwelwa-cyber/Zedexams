/**
 * NewLearnerSyncModal — shown when a learner is added to a class that already
 * has marking records in the current term. Asks where to add the new learner:
 * all current-term records, just one, or none (new records only).
 *
 * Old marks are never touched — the learner is appended with no marks (counts
 * as zero until entered) and stats recompute.
 */

import { useState } from 'react'
import { reconcileNewLearner } from '../../../utils/classRecords'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'

export default function NewLearnerSyncModal({ register, learner, records, onClose, onDone }) {
  const toast = useToast()
  const [scope, setScope] = useState('all-term')
  const [recordId, setRecordId] = useState(records[0]?.id || '')
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      const updated = await reconcileNewLearner(register.id, learner, {
        scope,
        recordId,
        term: register.term,
        year: register.year,
      })
      if (scope !== 'none') {
        toast.success(`Added ${learner.fullName} to ${updated} record${updated === 1 ? '' : 's'}.`)
      }
      onDone(updated)
    } catch (err) {
      toast.error(`Could not sync: ${err.message || 'unexpected error'}`)
    } finally {
      setBusy(false)
    }
  }

  const radio = 'flex items-start gap-2 p-3 rounded-radius-md border theme-border cursor-pointer'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="theme-card border theme-border rounded-t-2xl sm:rounded-radius-md w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div>
          <h2 className="theme-text font-display font-black text-lg">Add {learner.fullName} to existing records?</h2>
          <p className="theme-text-muted text-sm mt-1">
            This class already has {records.length} record{records.length === 1 ? '' : 's'} in {register.term} {register.year}.
            Old marks won&apos;t change — {learner.fullName} is just added with blank marks.
          </p>
        </div>

        <div className="space-y-2">
          <label className={radio}>
            <input type="radio" name="scope" checked={scope === 'all-term'} onChange={() => setScope('all-term')} className="mt-0.5" />
            <span>
              <span className="theme-text font-black text-sm block">All {register.term} {register.year} records</span>
              <span className="theme-text-muted text-xs">Add to every current-term record ({records.length}).</span>
            </span>
          </label>

          <label className={radio}>
            <input type="radio" name="scope" checked={scope === 'this-only'} onChange={() => setScope('this-only')} className="mt-0.5" />
            <span className="flex-1">
              <span className="theme-text font-black text-sm block">Just one record</span>
              <select
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
                onClick={() => setScope('this-only')}
                className="mt-1 w-full rounded border theme-border theme-card theme-text px-2 py-1.5 text-sm"
              >
                {records.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </span>
          </label>

          <label className={radio}>
            <input type="radio" name="scope" checked={scope === 'none'} onChange={() => setScope('none')} className="mt-0.5" />
            <span>
              <span className="theme-text font-black text-sm block">Don&apos;t add to any</span>
              <span className="theme-text-muted text-xs">New records only — leave existing ones as they are.</span>
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Skip</Button>
          <Button onClick={handleConfirm} loading={busy}>
            {scope === 'none' ? 'Done' : 'Add learner'}
          </Button>
        </div>
      </div>
    </div>
  )
}
