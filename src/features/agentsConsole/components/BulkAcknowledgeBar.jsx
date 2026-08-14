import { useCallback, useEffect, useState } from 'react'
import {
  collection, doc, getDocs, limit as fsLimit, query, serverTimestamp, where, writeBatch,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../shared/components/Button'

// Firestore caps a WriteBatch at 500 ops; stay under it.
const BATCH_SIZE = 400
// Bound the sweep so a pathological backlog can't stall the page. Anything
// beyond the cap is picked up by pressing the button again.
const SWEEP_LIMIT = 500

// A job is safe to acknowledge in bulk when approving it cannot publish
// anything. The agentJobsOnApproved trigger only runs Pubo for content-line
// drafts; scheduled ops rollups always carry input.runType and are skipped.
// Everything outside the content department is a read-only report too.
export function isBulkAcknowledgeable(job) {
  return Boolean(job?.input?.runType) || job?.department !== 'content'
}

/**
 * One-click "Acknowledge all" for the approval queue. Ops agents (Vigil,
 * Marshal, Till, Echo, …) file an awaiting_approval rollup whenever a run
 * finds something notable — with hourly schedules those pile up far faster
 * than anyone can click through them one by one. Acknowledging writes the
 * same fields the per-job Acknowledge button does (status: 'approved' +
 * reviewer metadata), which the Firestore rules already permit for admins.
 * Content-line drafts are excluded: approving those publishes to learners,
 * so they stay a deliberate per-job decision.
 */
export default function BulkAcknowledgeBar() {
  const { currentUser } = useAuth()
  const [pending, setPending]   = useState(null)   // null = loading
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy]         = useState(false)
  const [clearedCount, setClearedCount] = useState(0)
  const [errMsg, setErrMsg]     = useState(null)

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(query(
        collection(db, 'agentJobs'),
        where('status', '==', 'awaiting_approval'),
        fsLimit(SWEEP_LIMIT),
      ))
      const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setPending({
        reports: jobs.filter(isBulkAcknowledgeable),
        contentDrafts: jobs.filter(j => !isBulkAcknowledgeable(j)).length,
      })
    } catch (e) {
      setErrMsg(e.message || 'Could not load the approval queue.')
      setPending({ reports: [], contentDrafts: 0 })
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function acknowledgeAll() {
    if (!pending || pending.reports.length === 0) return
    setBusy(true)
    setErrMsg(null)
    try {
      const jobs = pending.reports
      for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        jobs.slice(i, i + BATCH_SIZE).forEach(job => {
          batch.update(doc(db, `agentJobs/${job.id}`), {
            status: 'approved',
            reviewedBy: currentUser?.uid || null,
            reviewedAt: serverTimestamp(),
            reviewNotes: 'Bulk acknowledged',
          })
        })
        await batch.commit()
      }
      setClearedCount(jobs.length)
      setConfirming(false)
      await load()
    } catch (e) {
      setErrMsg(e.message || 'Bulk acknowledge failed.')
    } finally {
      setBusy(false)
    }
  }

  if (pending === null) return null

  const count = pending.reports.length

  if (count === 0) {
    if (!clearedCount && !errMsg) return null
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        {clearedCount > 0 && (
          <p className="text-sm font-black text-emerald-800">
            ✓ Cleared {clearedCount} report{clearedCount === 1 ? '' : 's'} from the approval queue.
          </p>
        )}
        {pending.contentDrafts > 0 && (
          <p className="text-xs text-emerald-700 mt-1">
            {pending.contentDrafts} content draft{pending.contentDrafts === 1 ? '' : 's'} still
            need{pending.contentDrafts === 1 ? 's' : ''} individual review — approving those publishes to the library.
          </p>
        )}
        {errMsg && <p className="text-xs text-red-700 mt-1">{errMsg}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 space-y-3">
      <div>
        <p className="text-sm font-black text-yellow-800">
          {count} report{count === 1 ? '' : 's'} awaiting review
        </p>
        <p className="text-xs text-yellow-700 mt-0.5">
          These are read-only agent reports (site monitor, supervisor, reconciliation, …) —
          acknowledging clears them from the queue and publishes nothing.
          {pending.contentDrafts > 0 && (
            <> {pending.contentDrafts} content draft{pending.contentDrafts === 1 ? ' is' : 's are'} excluded
            and still need{pending.contentDrafts === 1 ? 's' : ''} individual review.</>
          )}
        </p>
      </div>

      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={acknowledgeAll}
          >
            {busy ? 'Acknowledging…' : `Yes, acknowledge ${count}`}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="primary" size="sm" onClick={() => setConfirming(true)}>
          Acknowledge all {count}
        </Button>
      )}

      {errMsg && <p className="text-xs text-red-700">{errMsg}</p>}
    </div>
  )
}
