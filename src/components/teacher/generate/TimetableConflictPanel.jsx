/**
 * Timetable conflicts panel — the Class Timetable Studio's cross-timetable
 * conflict surface (opened as a drawer from the workspace's conflicts
 * chip). Purely presentational + local filter state: the sibling loading
 * and the pure engine run live in the studio; this renders their results,
 * so it tests cleanly in Vitest with plain props.
 *
 * Clean result = ONE line ("No conflicts — checked against your other
 * timetables…") + Refresh. Conflicted result = stat tiles, presentation
 * filters and grouped conflict cards with resolution actions. The coverage
 * diagnostics (sibling/block counts, id coverage, normalisation failures)
 * are developer telemetry, not teacher copy — they always sit behind a
 * <details> "Details" disclosure. Severity is communicated with text +
 * icons, never colour alone.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Eye, Users, Settings, LayoutGrid, Grid3x3 } from 'lucide-react'
import { summariseConflicts } from '../../../utils/timetableConflictEngine'

const SEVERITY_META = {
  error: { label: 'Error', color: 'var(--danger-fg)' },
  warning: { label: 'Warning', color: 'var(--warning-fg)' },
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'teacher', label: 'Teacher' },
  { id: 'room', label: 'Room' },
  { id: 'class', label: 'Class' },
  { id: 'warnings', label: 'Warnings' },
]

function fmtClock(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function dayName(day) {
  return day ? day.charAt(0).toUpperCase() + day.slice(1) : ''
}

function BlockLine({ label, block, className }) {
  if (!block) return null
  return (
    <div className="text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
      <span className="font-bold">{label}:</span>{' '}
      {className ? `${className} · ` : ''}{block.subjectDisplayName || '—'} · {dayName(block.day)}{' '}
      {block.timeReview ? '(time needs review)' : `${block.startTime}–${block.endTime}`}
      {block.length > 1 ? ' · double period' : ''}
    </div>
  )
}

/** Developer telemetry — always behind a disclosure, never teacher copy. */
function CoverageDetails({ coverage }) {
  const [open, setOpen] = useState(false)
  if (!coverage) return null
  const coverageTone = coverage.status === 'complete'
    ? { color: 'var(--success-fg)', label: 'Complete' }
    : coverage.status === 'partial'
      ? { color: 'var(--warning-fg)', label: 'Partial' }
      : { color: 'var(--danger-fg)', label: 'Failed' }
  return (
    <details open={open} className="theme-border rounded-xl border bg-white px-3 py-2 text-[11px]" style={{ color: 'var(--zt-text-muted)' }}>
      <summary
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        className="cursor-pointer select-none font-black"
      >
        Details
      </summary>
      <div className="mt-1 space-y-0.5">
        <div className="font-black" style={{ color: coverageTone.color }}>
          Conflict coverage: Account-level · {coverageTone.label}
        </div>
        <div>
          Timetables accessible to this account and matching the current school name, term and year were checked.
          Timetables owned by other school accounts may not be included.
        </div>
        <div>
          Sibling timetables checked: {coverage.siblingsChecked} · Blocks checked: {coverage.blocksChecked} ·
          Blocks with teacher links: {coverage.blocksWithTeacherIds} · Legacy teacher-name blocks: {coverage.legacyTeacherNameBlocks} ·
          Blocks with room ids: {coverage.blocksWithRoomIds} · Time-normalisation failures: {coverage.timeNormalisationFailures}
        </div>
        {coverage.notes.map((n) => <div key={n}>• {n}</div>)}
      </div>
    </details>
  )
}

export default function TimetableConflictPanel({
  conflicts = [],
  coverage = null,
  status = 'idle',           // 'idle' | 'loading' | 'ready' | 'error'
  errorMessage = '',
  lastCheckedAt = null,
  offline = false,
  staleSiblings = [],        // display titles changed since the last check
  currentTimetableId = '',
  currentClassName = '',
  days = [],
  onRefresh,
  onSelectConflict,          // (conflict) → highlight the current block
  onOpenTimetable,           // (siblingTimetableId)
  onChangeTeacher,           // (blockId)
  onChangeRoom,              // (blockId)
  onMoveLesson,              // (blockId)
  selectedConflictId = null,
}) {
  const [filter, setFilter] = useState('all')
  const [dayFilter, setDayFilter] = useState('all')

  const summary = useMemo(() => summariseConflicts(conflicts), [conflicts])

  const visible = useMemo(() => {
    let list = conflicts
    if (filter === 'warnings') list = list.filter((c) => c.severity === 'warning')
    else if (filter !== 'all') list = list.filter((c) => c.type === filter)
    if (dayFilter !== 'all') {
      list = list.filter((c) => (c.currentBlock?.day || c.conflictingBlock?.day || '') === dayFilter.toLowerCase())
    }
    return list
  }, [conflicts, filter, dayFilter])

  const clean = status !== 'error' && conflicts.length === 0

  return (
    <section className="studio-card space-y-3 p-5" aria-label="Timetable conflicts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-base font-black">Timetable conflicts</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--zt-text-muted)' }}>
            Checks this week against your other saved class timetables for the same school, term and year.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'var(--zt-text-muted)' }} aria-live="polite">
            {status === 'loading' ? 'Checking conflicts…'
              : status === 'error' ? 'Conflict check failed'
                : !clean && lastCheckedAt ? `Conflicts up to date · last checked ${fmtClock(lastCheckedAt)}` : ''}
          </span>
          <button type="button" onClick={onRefresh} disabled={status === 'loading'}
            className="studio-btn-ghost text-xs disabled:opacity-50"
            aria-label="Refresh conflicts from your saved timetables">
            Refresh conflicts
          </button>
        </div>
      </div>

      {offline && (
        <div className="flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold"
          style={{ borderColor: 'rgba(212,160,23,0.4)', background: 'rgba(212,160,23,0.08)', color: 'var(--warning-fg)' }}>
          <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>You are offline. Cross-class conflict results may be outdated — reconnect before a final save.</span>
        </div>
      )}

      {staleSiblings.length > 0 && (
        <div className="rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: 'rgba(212,160,23,0.4)', background: 'rgba(212,160,23,0.08)', color: 'var(--warning-fg)' }}>
          <span className="font-bold">Updated since your last check:</span>{' '}
          {staleSiblings.join(', ')} — results below already reflect the fresh data.
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold"
          style={{ borderColor: 'rgba(190,49,68,0.4)', background: 'rgba(190,49,68,0.06)', color: 'var(--danger-fg)' }}>
          <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>Conflict check failed{errorMessage ? ` — ${errorMessage}` : ''}. Your timetable edits are unaffected; try refreshing.</span>
        </div>
      )}

      {/* Clean result: one line. Scope stays honest — sibling loading is
          account-level, and a partial check is never sold as a clean pass. */}
      {clean ? (
        <>
          <p className="flex items-start gap-1.5 text-xs font-bold" style={{ color: 'var(--success-fg)' }}>
            <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              {status === 'idle' && !lastCheckedAt
                ? 'No conflicts recorded yet — refresh to check this timetable against your other saved class timetables.'
                : coverage && coverage.siblingsChecked === 0
                  ? `No conflicts — no other active class timetables were found for this school, term and year${lastCheckedAt ? ` · ${fmtClock(lastCheckedAt)}` : ''}.`
                  : coverage?.status === 'partial'
                    ? `No confirmed conflicts — checked against your other timetables for this school, term and year${lastCheckedAt ? ` · ${fmtClock(lastCheckedAt)}` : ''}. Some legacy blocks could not be fully checked.`
                    : `No conflicts — checked against your other timetables for this school, term and year${lastCheckedAt ? ` · ${fmtClock(lastCheckedAt)}` : ''}.`}
            </span>
          </p>
          <CoverageDetails coverage={coverage} />
        </>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
            {[
              { label: 'Teacher conflicts', value: summary.teacher },
              { label: 'Room conflicts', value: summary.room },
              { label: 'Class conflicts', value: summary.class },
              { label: 'Warnings', value: summary.warnings },
            ].map((card) => (
              <div key={card.label} className="theme-border rounded-xl border bg-white px-3 py-2">
                <div className="text-lg font-black" style={{ color: card.value > 0 ? '#be3144' : '#1E8449' }}>
                  {card.value}
                </div>
                <div className="text-[11px] font-bold" style={{ color: 'var(--zt-text-muted)' }}>{card.label}</div>
              </div>
            ))}
          </div>

          <CoverageDetails coverage={coverage} />

          {/* Filters (presentation only) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => {
              const on = filter === f.id
              return (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-text-muted theme-border bg-white'}`}>
                  {f.label}
                </button>
              )
            })}
            <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}
              aria-label="Filter conflicts by day"
              className="studio-input w-auto !py-1 !px-2 text-[11px]">
              <option value="all">All days</option>
              {days.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Conflict list / filtered-empty state */}
          {visible.length === 0 ? (
            <div className="theme-border rounded-xl border border-dashed bg-white/60 px-3 py-4 text-center text-xs" style={{ color: 'var(--success-fg)' }}>
              <div className="font-black">No conflicts match the current filter</div>
              <span style={{ color: 'var(--zt-text-muted)' }}>
                Switch the filter back to All to see every conflict.
              </span>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Conflict list">
              {visible.map((c) => {
                const sev = SEVERITY_META[c.severity] || SEVERITY_META.warning
                const selected = c.conflictId === selectedConflictId
                const isSibling = Boolean(c.siblingTimetableId) && c.siblingTimetableId !== currentTimetableId
                return (
                  <li key={c.conflictId}>
                    <div
                      className="space-y-1.5 rounded-xl border bg-white px-3 py-2.5"
                      style={{
                        borderColor: selected ? '#2a6f97' : sev.color + '55',
                        boxShadow: selected ? '0 0 0 2px rgba(42,111,151,0.35)' : undefined,
                      }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-black" style={{ color: sev.color }}>
                          <AlertTriangle size={12} aria-hidden="true" />
                          {sev.label} · {c.type === 'teacher' ? 'Teacher conflict' : c.type === 'room' ? 'Room conflict' : 'Class conflict'}
                          {c.identityUnverified ? ' · identity unverified' : ''}
                        </span>
                        {c.siblingTimetableTitle && (
                          <span className="text-[10px] font-bold" style={{ color: 'var(--zt-text-muted)' }}>
                            vs {c.siblingTimetableTitle}
                          </span>
                        )}
                      </div>
                      <p className="text-xs" style={{ color: '#33474d' }}>{c.message}</p>
                      <BlockLine label="This timetable" block={c.currentBlock} className={currentClassName} />
                      <BlockLine label="Conflicting" block={c.siblingBlock || c.conflictingBlock} />
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {c.currentBlock && (
                          <button type="button" onClick={() => onSelectConflict?.(c)}
                            className="studio-btn-ghost inline-flex items-center gap-1 !py-1 !px-2 text-[11px]"
                            aria-label={`Show the affected ${c.currentBlock.subjectDisplayName} block on the timetable`}>
                            <Eye size={12} aria-hidden="true" /> Show on timetable
                          </button>
                        )}
                        {isSibling && c.siblingTimetableId && (
                          <button type="button" onClick={() => onOpenTimetable?.(c.siblingTimetableId)}
                            className="studio-btn-ghost inline-flex items-center gap-1 !py-1 !px-2 text-[11px]"
                            aria-label={`Open the conflicting timetable ${c.siblingTimetableTitle || ''}`}>
                            <LayoutGrid size={12} aria-hidden="true" /> Open conflicting timetable
                          </button>
                        )}
                        {c.type === 'teacher' && c.currentBlock && (
                          <button type="button" onClick={() => onChangeTeacher?.(c.currentBlock.blockId)}
                            className="studio-btn-ghost inline-flex items-center gap-1 !py-1 !px-2 text-[11px]">
                            <Users size={12} aria-hidden="true" /> Change teacher
                          </button>
                        )}
                        {c.type === 'room' && c.currentBlock && (
                          <button type="button" onClick={() => onChangeRoom?.(c.currentBlock.blockId)}
                            className="studio-btn-ghost inline-flex items-center gap-1 !py-1 !px-2 text-[11px]">
                            <Settings size={12} aria-hidden="true" /> Change room
                          </button>
                        )}
                        {c.currentBlock && (
                          <button type="button" onClick={() => onMoveLesson?.(c.currentBlock.blockId)}
                            className="studio-btn-ghost inline-flex items-center gap-1 !py-1 !px-2 text-[11px]">
                            <Grid3x3 size={12} aria-hidden="true" /> Move lesson
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
