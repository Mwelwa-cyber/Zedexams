/**
 * Timetable conflicts panel — the Class Timetable Studio's cross-timetable
 * conflict section. Purely presentational + local filter state: the sibling
 * loading and the pure engine run live in the studio; this renders their
 * results, so it tests cleanly in Vitest with plain props.
 *
 * Shows: summary counts, coverage (complete / partial / failed — a "0
 * conflicts" result never looks fully trustworthy when coverage is
 * partial), grouped conflict cards with resolution actions, presentation
 * filters, refresh status with last-checked time, offline staleness, and
 * empty/success states. Severity is communicated with text + icons, never
 * colour alone.
 */

import { useMemo, useState } from 'react'
import { summariseConflicts } from '../../../utils/timetableConflictEngine'

const SEVERITY_META = {
  error: { icon: '⛔', label: 'Error', color: 'var(--danger-fg)' },
  warning: { icon: '⚠️', label: 'Warning', color: 'var(--warning-fg)' },
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

  const coverageTone = coverage?.status === 'complete'
    ? { color: 'var(--success-fg)', label: 'Complete' }
    : coverage?.status === 'partial'
      ? { color: 'var(--warning-fg)', label: 'Partial' }
      : { color: 'var(--danger-fg)', label: 'Failed' }

  return (
    <section className="studio-card p-5 space-y-3" aria-label="Timetable conflicts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="studio-display" style={{ fontSize: 18, margin: 0 }}>Timetable conflicts</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--zt-text-muted)' }}>
            Checks this week against your other saved class timetables for the same school, term and year.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: 'var(--zt-text-muted)' }} aria-live="polite">
            {status === 'loading' ? 'Checking conflicts…'
              : status === 'error' ? 'Conflict check failed'
                : lastCheckedAt ? `Conflicts up to date · last checked ${fmtClock(lastCheckedAt)}` : ''}
          </span>
          <button type="button" onClick={onRefresh} disabled={status === 'loading'}
            className="studio-btn-ghost text-xs disabled:opacity-50"
            aria-label="Refresh conflicts from your saved timetables">
            ↻ Refresh conflicts
          </button>
        </div>
      </div>

      {offline && (
        <div className="rounded-xl border px-3 py-2 text-xs font-bold"
          style={{ borderColor: 'rgba(212,160,23,0.4)', background: 'rgba(212,160,23,0.08)', color: 'var(--warning-fg)' }}>
          ⚠️ You are offline. Cross-class conflict results may be outdated — reconnect before a final save.
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
        <div className="rounded-xl border px-3 py-2 text-xs font-bold"
          style={{ borderColor: 'rgba(190,49,68,0.4)', background: 'rgba(190,49,68,0.06)', color: 'var(--danger-fg)' }}>
          ⛔ Conflict check failed{errorMessage ? ` — ${errorMessage}` : ''}. Your timetable edits are unaffected; try refreshing.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-live="polite">
        {[
          { label: 'Teacher conflicts', value: summary.teacher },
          { label: 'Room conflicts', value: summary.room },
          { label: 'Class conflicts', value: summary.class },
          { label: 'Warnings', value: summary.warnings },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border theme-border bg-white px-3 py-2">
            <div className="text-lg font-black" style={{ color: card.value > 0 ? '#be3144' : '#1E8449' }}>
              {card.value}
            </div>
            <div className="text-[11px] font-bold" style={{ color: 'var(--zt-text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Coverage. Scope is stated honestly: sibling loading is account-level
          (owner-scoped reads) until a canonical schoolId + school membership
          model exists — never claim "all school timetables checked". */}
      {coverage && (
        <div className="rounded-xl border theme-border bg-white px-3 py-2 text-[11px] space-y-0.5" style={{ color: 'var(--zt-text-muted)' }}>
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
      )}

      {/* Filters (presentation only) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const on = filter === f.id
          return (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              aria-pressed={on}
              className={`rounded-full px-2.5 py-1 text-[11px] font-black border ${on ? 'theme-accent-fill theme-on-accent border-transparent' : 'bg-white theme-text-muted theme-border'}`}>
              {f.label}
            </button>
          )
        })}
        <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}
          aria-label="Filter conflicts by day"
          className="studio-input !py-1 !px-2 text-[11px] w-auto">
          <option value="all">All days</option>
          {days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Conflict list / empty states */}
      {status === 'idle' && !conflicts.length ? (
        <p className="text-xs" style={{ color: 'var(--zt-text-muted)' }}>
          Refresh to check this timetable against your other saved class timetables.
        </p>
      ) : coverage && coverage.siblingsChecked === 0 && !conflicts.length ? (
        <div className="rounded-xl border border-dashed theme-border bg-white/60 px-3 py-4 text-center text-xs" style={{ color: 'var(--zt-text-muted)' }}>
          <div className="font-black">No sibling timetables found</div>
          No other active class timetables were found for this school, term and year.
          {conflicts.length === 0 && ' Internal class checks still ran on this timetable.'}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed theme-border bg-white/60 px-3 py-4 text-center text-xs" style={{ color: 'var(--success-fg)' }}>
          <div className="font-black">
            {coverage?.status === 'partial' ? 'No confirmed conflicts found' : 'No conflicts found'}
          </div>
          <span style={{ color: 'var(--zt-text-muted)' }}>
            {conflicts.length > 0
              ? 'No conflicts match the current filter.'
              : coverage?.status === 'partial'
                ? 'Some legacy blocks could not be fully checked because teacher or room ids are missing.'
                : 'No teacher, room or class overlaps were detected across the timetables checked.'}
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
                  className="rounded-xl border bg-white px-3 py-2.5 space-y-1.5"
                  style={{
                    borderColor: selected ? '#2a6f97' : sev.color + '55',
                    boxShadow: selected ? '0 0 0 2px rgba(42,111,151,0.35)' : undefined,
                  }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black" style={{ color: sev.color }}>
                      {sev.icon} {sev.label} · {c.type === 'teacher' ? 'Teacher conflict' : c.type === 'room' ? 'Room conflict' : 'Class conflict'}
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
                        className="studio-btn-ghost !py-1 !px-2 text-[11px]"
                        aria-label={`Show the affected ${c.currentBlock.subjectDisplayName} block on the timetable`}>
                        🔍 Show on timetable
                      </button>
                    )}
                    {isSibling && c.siblingTimetableId && (
                      <button type="button" onClick={() => onOpenTimetable?.(c.siblingTimetableId)}
                        className="studio-btn-ghost !py-1 !px-2 text-[11px]"
                        aria-label={`Open the conflicting timetable ${c.siblingTimetableTitle || ''}`}>
                        ↗ Open conflicting timetable
                      </button>
                    )}
                    {c.type === 'teacher' && c.currentBlock && (
                      <button type="button" onClick={() => onChangeTeacher?.(c.currentBlock.blockId)}
                        className="studio-btn-ghost !py-1 !px-2 text-[11px]">
                        👤 Change teacher
                      </button>
                    )}
                    {c.type === 'room' && c.currentBlock && (
                      <button type="button" onClick={() => onChangeRoom?.(c.currentBlock.blockId)}
                        className="studio-btn-ghost !py-1 !px-2 text-[11px]">
                        🚪 Change room
                      </button>
                    )}
                    {c.currentBlock && (
                      <button type="button" onClick={() => onMoveLesson?.(c.currentBlock.blockId)}
                        className="studio-btn-ghost !py-1 !px-2 text-[11px]">
                        ➜ Move lesson
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
