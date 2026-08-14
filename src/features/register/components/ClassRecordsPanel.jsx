/**
 * ClassRecordsPanel — shared list/create/open/delete shell for Class Register
 * marking records, used by the Mark Schedules, SBA and Assessment Results tabs.
 *
 * Loads the live roster (for snapshotting at create) and the class's records of
 * one `type`, lists them, and opens MarkEntryGrid for marking. The create form
 * is supplied per-tab via the `renderCreate` render prop, since each record
 * type collects different metadata.
 */

import { useEffect, useMemo, useState } from 'react'
import { listRoster } from '../../../utils/classRoster'
import { listRecords, getRecord, deleteRecord } from '../../../utils/classRecords'
import { filterRecordsByPeriod } from '../../../utils/classTerms'
import { useToast } from '../../../shared/components/Toast'
import Button from '../../../shared/components/Button'
import ConfirmDialog from '../../../shared/components/ConfirmDialog'
import Skeleton from '../../../shared/components/Skeleton'
import MarkEntryGrid from './MarkEntryGrid'
import TermPeriodFilter from './TermPeriodFilter'
import { useAbortableRequest } from '../../../hooks/useAbortableRequest.js'

export default function ClassRecordsPanel({
  register,
  type,
  newLabel = '+ New record',
  intro = 'Records for this class.',
  emptyIcon = '📊',
  emptyTitle = 'Nothing here yet',
  emptyText = 'Create one — every learner on the class list is added automatically.',
  describeRecord,
  renderCreate,
  // SBA records span the whole year, so that tab opts out of term filtering.
  periodScoped = true,
}) {
  const classId = register.id
  const toast = useToast()
  const [roster, setRoster] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openRecord, setOpenRecord] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [viewPeriod, setViewPeriod] = useState('current')

  const currentPeriod = { term: register.term, year: register.year }
  const visibleRecords = useMemo(
    () => (periodScoped ? filterRecordsByPeriod(records, viewPeriod, currentPeriod) : records),
    [records, viewPeriod, currentPeriod.term, currentPeriod.year, periodScoped], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Switching classes/tabs quickly, or deleting a record right after the
  // tab's own load kicks off, used to fire two unguarded `refresh()` calls
  // that could resolve out of order and leave stale roster/records on
  // screen. `useAbortableRequest` cancels/ignores whichever call is no
  // longer current — only the latest `refresh()` may update state.
  const { run, cancel } = useAbortableRequest({ timeoutMs: 15_000 })

  async function refresh() {
    setLoading(true)
    setLoadError(false)
    const types = Array.isArray(type) ? type : [type]
    const result = await run(() => Promise.all([listRoster(classId), listRecords(classId)]))
    if (result.status === 'success') {
      const [r, all] = result.data
      setRoster(r)
      setRecords(all.filter((rec) => types.includes(rec.type)))
      setLoading(false)
    } else if (result.status === 'error') {
      console.warn('[ClassRecordsPanel] load failed', result.error)
      setLoadError(true)
      setLoading(false)
    }
    // 'stale' / 'aborted' — a newer refresh() (class switch, tab switch, or
    // a delete/save-triggered reload) already owns loading/roster/records.
  }

  // Key on a string so passing `type` as a fresh array literal can't loop.
  const typeKey = Array.isArray(type) ? type.join(',') : type
  useEffect(() => { refresh(); return cancel }, [classId, typeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openGrid(recordId) {
    try {
      const rec = await getRecord(classId, recordId)
      if (rec) setOpenRecord(rec)
    } catch (err) {
      toast.error(`Could not open record: ${err.message || 'unexpected error'}`)
    }
  }

  async function handleDelete() {
    try {
      await deleteRecord(classId, deleteTarget.id)
      toast.success('Deleted.')
      refresh()
    } catch (err) {
      toast.error(`Could not delete: ${err.message || 'unexpected error'}`)
    } finally {
      setDeleteTarget(null)
    }
  }

  function defaultDescribe(rec) {
    return `${rec.rosterSnapshot?.length || 0} learners`
      + ` · ${(rec.columns?.length || 0)} column${rec.columns?.length === 1 ? '' : 's'}`
      + (rec.stats?.count ? ` · avg ${rec.stats.classAverage}% · pass ${rec.stats.passRate}%` : ' · not marked yet')
  }

  if (openRecord) {
    return (
      <MarkEntryGrid
        classId={classId}
        record={openRecord}
        onClose={() => { setOpenRecord(null); refresh() }}
        onSaved={() => refresh()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="theme-text-muted text-sm">{intro}</p>
        <div className="flex items-center gap-3">
          {periodScoped && records.length > 0 && (
            <TermPeriodFilter records={records} value={viewPeriod} onChange={setViewPeriod} currentPeriod={currentPeriod} />
          )}
          {!creating && <Button size="sm" onClick={() => setCreating(true)}>{newLabel}</Button>}
        </div>
      </div>

      {creating && renderCreate({
        register,
        roster,
        records,
        onCreated: (id) => { setCreating(false); openGrid(id) },
        onCancel: () => setCreating(false),
      })}

      {loading ? (
        <Skeleton className="h-24 rounded-radius-md" />
      ) : loadError ? (
        <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
          <p className="theme-text font-black">Couldn&apos;t load records</p>
          <p className="theme-text-muted text-sm mt-1">Something went wrong reading this data.</p>
          <button type="button" onClick={refresh} className="mt-2 theme-accent-text text-sm font-black">
            Retry
          </button>
        </div>
      ) : records.length === 0 && !creating ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <div className="text-4xl mb-2">{emptyIcon}</div>
          <p className="theme-text font-black">{emptyTitle}</p>
          <p className="theme-text-muted text-sm mt-1">{emptyText}</p>
        </div>
      ) : visibleRecords.length === 0 && !creating ? (
        <div className="theme-card border theme-border rounded-radius-md p-6 text-center theme-text-muted text-sm">
          Nothing for the selected term. Switch the view to “All terms” to see other periods.
        </div>
      ) : (
        <ul className="theme-card border theme-border rounded-radius-md divide-y divide-current/10 overflow-hidden">
          {visibleRecords.map((rec) => (
            <li key={rec.id} className="flex items-center gap-3 p-4">
              <button type="button" onClick={() => openGrid(rec.id)} className="flex-1 min-w-0 text-left">
                <p className="theme-text font-black text-sm truncate">{rec.title}</p>
                <p className="theme-text-muted text-xs mt-1">{(describeRecord || defaultDescribe)(rec)}</p>
              </button>
              <button type="button" onClick={() => openGrid(rec.id)} className="theme-accent-text text-xs font-black whitespace-nowrap">Enter marks →</button>
              <button type="button" onClick={() => setDeleteTarget(rec)} className="theme-text-muted hover:text-red-500 text-xs font-black">Delete</button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this record?"
        message={deleteTarget ? `"${deleteTarget.title}" and its marks will be permanently deleted.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
