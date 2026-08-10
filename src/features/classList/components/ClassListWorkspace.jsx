/**
 * ClassListWorkspace — the Class List for one class.
 *
 * THE SINGLE SOURCE OF TRUTH for who is in a class. The Class Register reads
 * this list; it does not keep a second, editable copy of anyone's name (§9).
 * Everything a teacher does to class membership happens here.
 *
 * Four ways in, because a teacher already has the list somewhere and should
 * not type it again (§7):
 *   Capture class list — photograph the pages of a written or printed register
 *   Import file        — Excel, CSV, Word table, PDF, images
 *   Paste names        — the fastest path for a list already in a message
 *   Add learner        — one child, by hand
 *
 * Desktop and tablet get ClassListTable (frozen columns, sticky header);
 * phones get ClassListMobileList (cards, bottom sheets). Both render from the
 * same view model, built once per change by classListCore.buildClassListView.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import {
  subscribeRoster, addRosterEntry, updateRosterEntry, removeRosterEntry,
} from '../../../utils/classRoster'
import { recordsMissingLearner } from '../../../utils/classRecords'
import {
  buildClassListView, pageForLearnerNumber, planBulkStatusChange,
  CLASS_LIST_SORTS, ROWS_PER_PAGE_OPTIONS, DEFAULT_CLASS_LIST_FILTERS,
} from '../../../utils/classListCore'
import { LEARNER_STATUSES, learnerStatusLabel } from '../../../utils/learnerStatus'
import { classDisplayName } from '../../../schemas/classRegister'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import ResponsiveModal from '../../../components/ui/ResponsiveModal'
import Skeleton from '../../../components/ui/Skeleton'
import useIsMobile from '../../../shared/hooks/useIsMobile'
import ClassListTable from './ClassListTable'
import ClassListMobileList from './ClassListMobileList'
import LearnerFormDialog from './LearnerFormDialog'
import NewLearnerSyncModal from '../../../components/teacher/register/NewLearnerSyncModal'
import {
  AlertTriangle, Camera, CheckCircle2, ChevronLeft, ChevronRight, ClipboardPaste,
  Filter, Search, Upload, UserMinus, UserPlus, Users, X,
} from '../../../shared/icons/classListIcons'

function relativeTime(date) {
  if (!date) return null
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `Today, ${time}` : `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${time}`
}

/** A filter pill. Reads its own state aloud rather than relying on colour. */
function FilterChip({ active, count, onClick, children, tone = 'neutral' }) {
  const tones = {
    neutral: active ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-card theme-border theme-text-muted',
    warning: active ? 'bg-amber-500 text-white border-amber-500' : 'theme-card border-amber-300 text-amber-800',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-radius-pill border text-xs font-black ${tones[tone]}`}
    >
      {children}
      {count != null && <span className="tabular-nums opacity-80">{count}</span>}
    </button>
  )
}

export default function ClassListWorkspace({
  register,
  onRosterChange,
  onCapture,
  onImportFile,
  onPasteNames,
}) {
  const classId = register.id
  const className = classDisplayName(register)
  const { currentUser, isAdmin } = useAuth()
  const toast = useToast()
  const isMobile = useIsMobile()

  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [lastSynced, setLastSynced] = useState(null)

  const [searchInput, setSearchInput] = useState('')
  // The list re-filters at React's leisure while typing stays responsive —
  // which is what a debounce is for on a phone that repaints 120 rows.
  const query = useDeferredValue(searchInput)
  const [filters, setFilters] = useState(DEFAULT_CLASS_LIST_FILTERS)
  const [sort, setSort] = useState('list_order')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [jumpTo, setJumpTo] = useState('')

  const [dialog, setDialog] = useState(null)      // { mode, learner }
  const [menuLearner, setMenuLearner] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [bulkConfirm, setBulkConfirm] = useState(null)
  const [syncTarget, setSyncTarget] = useState(null)

  const onRosterChangeRef = useRef(onRosterChange)
  useEffect(() => { onRosterChangeRef.current = onRosterChange })

  useEffect(() => {
    setLoading(true)
    setLoadError(false)
    const unsub = subscribeRoster(
      classId,
      (rows) => {
        setRoster(rows)
        setLoading(false)
        setLoadError(false)
        setLastSynced(new Date())
        onRosterChangeRef.current?.(rows.filter((r) => r.status === 'active').length)
      },
      (err) => {
        // Surfaced rather than swallowed: a dropped permission error here is
        // indistinguishable from an empty class, and once hid a real bug.
        console.warn('[ClassListWorkspace] subscribe failed', err)
        setLoading(false)
        setLoadError(true)
      },
    )
    return unsub
  }, [classId])

  const view = useMemo(
    () => buildClassListView(roster, { filters: { ...filters, query }, sort, page, pageSize }),
    [roster, filters, query, sort, page, pageSize],
  )

  // Any change to what is being shown resets the page, so a teacher is never
  // left looking at page 4 of a one-page result.
  useEffect(() => { setPage(1) }, [query, filters, sort, pageSize])

  const selectedLearners = useMemo(
    () => roster.filter((l) => selectedIds.has(l.id)),
    [roster, selectedIds],
  )

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const pageIds = view.rows.map((l) => l.id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setSelecting(false)
  }

  function handleJump(e) {
    e.preventDefault()
    const hit = pageForLearnerNumber(view.visible, jumpTo, pageSize)
    if (!hit) {
      toast.info(`No learner is numbered ${jumpTo} on this list.`)
      return
    }
    setPage(hit.page)
    toast.success(`${hit.learner.fullName} is on page ${hit.page}.`)
    setJumpTo('')
  }

  async function handleSave(patch) {
    setSaving(true)
    try {
      if (dialog.mode === 'add') {
        const newId = await addRosterEntry(classId, currentUser.uid, patch)
        toast.success(`${patch.fullName} added to ${className}.`)
        setDialog(null)
        // If this class already has marking records this term, offer to bring
        // the new learner into them — existing marks are never touched.
        try {
          const missing = await recordsMissingLearner(classId, newId, { term: register.term, year: register.year })
          if (missing.length > 0) setSyncTarget({ learner: { id: newId, ...patch }, records: missing })
        } catch (err) {
          console.warn('[ClassListWorkspace] record sync check failed', err)
        }
      } else {
        await updateRosterEntry(classId, dialog.learner.id, patch)
        toast.success('Learner updated.')
        setDialog(null)
      }
    } catch (err) {
      toast.error(`Could not save: ${err.message || 'unexpected error'}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmRecord(learner) {
    try {
      await updateRosterEntry(classId, learner.id, { needsReview: false, reviewReasons: [] })
      toast.success(`${learner.fullName} confirmed.`)
    } catch (err) {
      toast.error(`Could not confirm: ${err.message || 'unexpected error'}`)
    } finally {
      setMenuLearner(null)
    }
  }

  async function handleRemove() {
    try {
      await removeRosterEntry(classId, confirmRemove.id)
      toast.success('Learner removed from the class list.')
    } catch (err) {
      toast.error(`Could not remove: ${err.message || 'unexpected error'}`)
    } finally {
      setConfirmRemove(null)
    }
  }

  async function applyBulk() {
    const { changing, nextStatus } = bulkConfirm
    setSaving(true)
    let done = 0
    try {
      for (const learner of changing) {
        await updateRosterEntry(classId, learner.id, { status: nextStatus })
        done += 1
      }
      toast.success(`${done} learner${done === 1 ? '' : 's'} set to ${learnerStatusLabel(nextStatus)}.`)
      clearSelection()
    } catch (err) {
      // An honest partial result: some rows changed, and saying "failed" would
      // send the teacher back to redo work that is already done.
      toast.error(`Changed ${done} of ${changing.length}. ${err.message || 'The rest could not be saved.'}`)
    } finally {
      setSaving(false)
      setBulkConfirm(null)
    }
  }

  const { counts } = view
  const activeFilterCount = (filters.statuses.length ? 1 : 0)
    + (filters.needsReview ? 1 : 0) + (filters.duplicates ? 1 : 0) + (filters.missingInfo ? 1 : 0)

  const inputCls = 'rounded-radius-sm border theme-border theme-card theme-text px-3 text-sm min-h-[44px]'

  // ── header ─────────────────────────────────────────────────────

  const actions = [
    { key: 'capture', label: 'Capture class list', Icon: Camera, primary: true, onClick: onCapture },
    { key: 'import', label: 'Import file', Icon: Upload, onClick: onImportFile },
    { key: 'paste', label: 'Paste names', Icon: ClipboardPaste, onClick: onPasteNames },
    { key: 'add', label: 'Add learner', Icon: UserPlus, onClick: () => setDialog({ mode: 'add', learner: null }) },
  ]

  return (
    <div className="space-y-4">
      {/* ── class identity + the four ways in ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="theme-text font-display font-black text-xl sm:text-2xl truncate">{className}</h2>
          <p className="theme-text-muted text-sm mt-0.5">
            {register.year} Academic Year
            {' · '}
            <span className="theme-text font-bold tabular-nums">{counts.active}</span> active learner{counts.active === 1 ? '' : 's'}
            {counts.total !== counts.active ? ` · ${counts.total} on the list` : ''}
          </p>
          {register.classTeacherName && (
            <p className="theme-text-muted text-sm">Class teacher: {register.classTeacherName}</p>
          )}
        </div>

        <div className={isMobile
          ? 'w-full grid grid-cols-2 gap-2'
          : 'flex flex-wrap items-center gap-2'}>
          {actions.map(({ key, label, Icon, primary, onClick }) => (
            <Button
              key={key}
              type="button"
              size={isMobile ? 'md' : 'sm'}
              variant={primary ? 'primary' : 'secondary'}
              onClick={onClick}
              leadingIcon={<Icon size={16} aria-hidden="true" />}
              className={isMobile ? 'w-full justify-center min-h-[48px]' : ''}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── the promise this screen makes to the register ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-radius-sm border border-emerald-300 bg-emerald-50 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-emerald-800 text-xs font-black">
          <CheckCircle2 size={14} aria-hidden="true" />
          Synced with Class Register
        </span>
        {lastSynced && <span className="text-emerald-800/80 text-xs">Last synced: {relativeTime(lastSynced)}</span>}
        <Link to="/teacher/attendance" className="text-emerald-900 text-xs font-black underline ml-auto">
          Open the register →
        </Link>
      </div>

      {/* ── search, filters, sort ── */}
      <div className="space-y-2 sticky top-0 z-20 theme-bg-subtle -mx-1 px-1 py-2 rounded-radius-sm">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted pointer-events-none" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search learner or admission no."
              aria-label="Search learner or admission number"
              className={`${inputCls} w-full pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`${inputCls} inline-flex items-center gap-1.5 font-black shrink-0`}
          >
            <Filter size={16} aria-hidden="true" />
            {!isMobile && 'Filters'}
            {activeFilterCount > 0 && (
              <span className="theme-accent-fill theme-on-accent rounded-radius-pill px-1.5 text-[11px] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {LEARNER_STATUSES.filter((s) => !s.adminOnly || isAdmin).map((s) => (
              <FilterChip
                key={s.value}
                active={filters.statuses.includes(s.value)}
                count={counts[s.value]}
                onClick={() => setFilters((f) => ({
                  ...f,
                  statuses: f.statuses.includes(s.value)
                    ? f.statuses.filter((v) => v !== s.value)
                    : [...f.statuses, s.value],
                }))}
              >
                {s.label}
              </FilterChip>
            ))}
            <FilterChip tone="warning" active={filters.needsReview} count={counts.needsReview}
              onClick={() => setFilters((f) => ({ ...f, needsReview: !f.needsReview }))}>
              Needs review
            </FilterChip>
            <FilterChip tone="warning" active={filters.duplicates} count={counts.duplicates}
              onClick={() => setFilters((f) => ({ ...f, duplicates: !f.duplicates }))}>
              Possible duplicates
            </FilterChip>
            <FilterChip tone="warning" active={filters.missingInfo} count={counts.missingInfo}
              onClick={() => setFilters((f) => ({ ...f, missingInfo: !f.missingInfo }))}>
              Missing information
            </FilterChip>
            {activeFilterCount > 0 && (
              <button type="button" onClick={() => setFilters(DEFAULT_CLASS_LIST_FILTERS)}
                className="shrink-0 inline-flex items-center gap-1 px-3 min-h-[44px] text-xs font-black theme-text-muted">
                <X size={14} aria-hidden="true" /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── standing warnings ── */}
      {counts.duplicates > 0 && !filters.duplicates && (
        <button type="button" onClick={() => { setShowFilters(true); setFilters((f) => ({ ...f, duplicates: true })) }}
          className="w-full flex items-center gap-2 rounded-radius-sm border border-amber-300 bg-amber-50 px-3 py-2.5 text-left min-h-[44px]">
          <AlertTriangle size={16} className="text-amber-700 shrink-0" aria-hidden="true" />
          <span className="text-amber-900 text-sm font-bold flex-1">
            {counts.duplicates} learner{counts.duplicates === 1 ? '' : 's'} may be recorded twice
          </span>
          <span className="text-amber-900 text-xs font-black underline">Review</span>
        </button>
      )}

      {/* ── bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div role="region" aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-radius-sm theme-card border theme-border px-3 py-2 sticky top-16 z-20">
          <span className="theme-text text-sm font-black">
            {selectedIds.size} selected
          </span>
          <div className="flex flex-wrap gap-2 ml-auto">
            {LEARNER_STATUSES.filter((s) => !s.adminOnly || isAdmin).filter((s) => s.value !== 'active').map((s) => (
              <Button key={s.value} type="button" size="sm" variant="secondary"
                leadingIcon={<UserMinus size={14} aria-hidden="true" />}
                onClick={() => setBulkConfirm(planBulkStatusChange(selectedLearners, s.value))}>
                Mark {s.label.toLowerCase()}
              </Button>
            ))}
            <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      {/* ── the list ── */}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-radius-sm" />)}</div>
      ) : loadError ? (
        <div role="alert" className="theme-card border border-red-300 rounded-radius-md p-6 text-center">
          <p className="theme-text font-black">Couldn’t load this class list</p>
          <p className="theme-text-muted text-sm mt-1">
            Something went wrong reading the learners. Refresh the page, and if it keeps
            happening let support know.
          </p>
        </div>
      ) : counts.total === 0 ? (
        <div className="theme-card border theme-border rounded-radius-lg p-8 text-center">
          <span className="inline-grid place-items-center w-14 h-14 rounded-radius-md theme-bg-subtle theme-text-muted mx-auto">
            <Users size={26} aria-hidden="true" />
          </span>
          <p className="theme-text font-black text-lg mt-3">No learners yet</p>
          <p className="theme-text-muted text-sm mt-1 max-w-md mx-auto">
            Photograph the pages of your written register, upload a file, paste a list of
            names, or add learners one at a time. You only have to do this once — the
            register, results and reports all read this list.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <Button type="button" onClick={onCapture} leadingIcon={<Camera size={16} aria-hidden="true" />}>
              Capture class list
            </Button>
            <Button type="button" variant="secondary" onClick={onPasteNames}
              leadingIcon={<ClipboardPaste size={16} aria-hidden="true" />}>
              Paste names
            </Button>
          </div>
        </div>
      ) : view.visible.length === 0 ? (
        <div className="theme-card border theme-border rounded-radius-md p-8 text-center">
          <p className="theme-text font-black">No learner matches these filters</p>
          <p className="theme-text-muted text-sm mt-1">
            {counts.total} learner{counts.total === 1 ? ' is' : 's are'} on this class list.
          </p>
          <Button type="button" size="sm" variant="ghost" className="mt-3"
            onClick={() => { setFilters(DEFAULT_CLASS_LIST_FILTERS); setSearchInput('') }}>
            Clear search and filters
          </Button>
        </div>
      ) : isMobile ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="theme-text-muted text-xs font-bold tabular-nums">
              {view.rangeStart}–{view.rangeEnd} of {view.visible.length}
            </p>
            <button type="button" onClick={() => setSelecting((v) => !v)}
              className="text-xs font-black theme-accent-text min-h-[44px] px-2">
              {selecting ? 'Done selecting' : 'Select learners'}
            </button>
          </div>
          <ClassListMobileList
            rows={view.rows}
            rangeStart={view.rangeStart}
            selecting={selecting}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onOpenMenu={setMenuLearner}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="theme-text-muted text-xs font-bold tabular-nums">
              Showing {view.rangeStart}–{view.rangeEnd} of {view.visible.length} learners
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs font-black theme-text-muted">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value)}
                  className={`${inputCls} font-bold`} aria-label="Sort learners">
                  {CLASS_LIST_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <form onSubmit={handleJump} className="flex items-center gap-1.5">
                <label htmlFor="jump-to-learner" className="text-xs font-black theme-text-muted">Go to no.</label>
                <input id="jump-to-learner" value={jumpTo} onChange={(e) => setJumpTo(e.target.value)}
                  inputMode="numeric" className={`${inputCls} w-20`} placeholder="24" />
              </form>
            </div>
          </div>
          <ClassListTable
            rows={view.rows}
            rangeStart={view.rangeStart}
            duplicateIds={view.duplicateIds}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            allSelected={allSelected}
            onEdit={(learner) => setDialog({ mode: 'edit', learner })}
            onOpenMenu={(learner) => setMenuLearner(learner)}
            sort={sort}
            onSort={setSort}
          />
        </>
      )}

      {/* ── pagination ── */}
      {view.pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs font-black theme-text-muted">
            Rows per page
            <select value={String(pageSize)} onChange={(e) => {
              const v = e.target.value
              setPageSize(v === 'all' ? 'all' : Number(v))
            }} className={`${inputCls} font-bold`}>
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={String(n)} value={String(n)}>{n === 'all' ? 'All' : n}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button type="button" disabled={view.page <= 1} onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
              className="w-11 h-11 grid place-items-center rounded-radius-sm border theme-border theme-card theme-text disabled:opacity-30">
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="text-xs font-black theme-text-muted tabular-nums px-2">
              Page {view.page} of {view.pageCount}
            </span>
            <button type="button" disabled={view.page >= view.pageCount} onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
              className="w-11 h-11 grid place-items-center rounded-radius-sm border theme-border theme-card theme-text disabled:opacity-30">
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* ── dialogs ── */}
      {dialog && (
        <LearnerFormDialog
          mode={dialog.mode}
          learner={dialog.learner}
          className={className}
          isAdmin={isAdmin}
          saving={saving}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}

      {menuLearner && (
        <ResponsiveModal onClose={() => setMenuLearner(null)} labelledBy="learner-menu-title">
          <h2 id="learner-menu-title" className="theme-text font-black text-base">{menuLearner.fullName}</h2>
          <p className="theme-text-muted text-xs mt-0.5">
            {menuLearner.admissionNumber || 'No admission number'} · {learnerStatusLabel(menuLearner.status)}
          </p>
          <div className="mt-3 divide-y divide-current/10">
            {[
              { label: 'Edit learner', onClick: () => { setDialog({ mode: 'edit', learner: menuLearner }); setMenuLearner(null) } },
              menuLearner.needsReview
                ? { label: 'Confirm this record', onClick: () => handleConfirmRecord(menuLearner) }
                : null,
              { label: 'Record that they have left', onClick: () => { setDialog({ mode: 'leave', learner: menuLearner }); setMenuLearner(null) } },
              { label: 'Remove from class list', danger: true, onClick: () => { setConfirmRemove(menuLearner); setMenuLearner(null) } },
            ].filter(Boolean).map((item) => (
              <button key={item.label} type="button" onClick={item.onClick}
                className={`w-full text-left px-1 py-3 min-h-[48px] text-sm font-bold ${item.danger ? 'text-red-600' : 'theme-text'}`}>
                {item.label}
              </button>
            ))}
          </div>
        </ResponsiveModal>
      )}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title="Remove this learner from the class list?"
        message={confirmRemove
          ? `${confirmRemove.fullName} will be taken off ${className}. Attendance and marks already recorded keep their snapshot — but if this learner has simply left the class, record their departure instead so the register shows Not applicable rather than losing them.`
          : ''}
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={Boolean(bulkConfirm)}
        title={bulkConfirm ? `Mark ${bulkConfirm.changing.length} learner${bulkConfirm.changing.length === 1 ? '' : 's'} as ${learnerStatusLabel(bulkConfirm.nextStatus)}?` : ''}
        message={bulkConfirm
          ? `${bulkConfirm.changing.length} of the ${bulkConfirm.changing.length + bulkConfirm.unchanged.length} selected will change.${
            bulkConfirm.unchanged.length ? ` ${bulkConfirm.unchanged.length} already ${bulkConfirm.unchanged.length === 1 ? 'has' : 'have'} that status.` : ''
          } Past attendance is kept for every one of them.`
          : ''}
        confirmLabel="Apply"
        onConfirm={applyBulk}
        onCancel={() => setBulkConfirm(null)}
      />

      {syncTarget && (
        <NewLearnerSyncModal
          register={register}
          learner={syncTarget.learner}
          records={syncTarget.records}
          onClose={() => setSyncTarget(null)}
          onDone={() => setSyncTarget(null)}
        />
      )}
    </div>
  )
}
