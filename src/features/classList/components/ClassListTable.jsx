/**
 * ClassListTable — the desktop and tablet class list.
 *
 * Three things here are load-bearing rather than decorative:
 *
 * FROZEN COLUMNS. Number, admission number and learner name stay put while the
 * rest scrolls sideways. On a 1366px laptop the ten columns of a full class
 * list do not fit, and a teacher scrolling right to reach the status control
 * must not lose track of whose row they are on.
 *
 * A STICKY HEADER, so column headings survive scrolling past row 30 of 120.
 *
 * WINDOWED ROWS. Only the rows near the viewport are mounted; the rest is two
 * spacer rows holding the scroll height open. A class list is up to 120 rows of
 * ten cells with a menu and a status control in each, and mounting all of them
 * is the difference between a list that scrolls and one that stutters on the
 * phones and low-cost laptops this is used on. Correctness does not depend on
 * it: `windowRange` is pure and tested, and every row that is scrolled to is
 * mounted before it is visible.
 *
 * Tablets get this same table (§14) — the information structure is right, the
 * cells are simply sized for a finger.
 */

import { memo, useCallback, useRef, useState } from 'react'
import { windowRange } from '../../../utils/classListCore'
import { learnerBadge, reviewReasonText } from '../../../utils/learnerStatus'
import { AlertTriangle, Link2, MoreVertical, Pencil } from '../../../shared/icons/classListIcons'

const ROW_HEIGHT = 52
const VIEWPORT = 640

const GENDER_LABEL = { M: 'Male', F: 'Female', other: 'Other' }

const BADGE_TONE = {
  positive: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  warning: 'bg-amber-50 text-amber-900 border-amber-300',
  neutral: 'bg-gray-100 text-gray-700 border-gray-300',
}

/**
 * Status is never communicated by colour alone (§30): every badge prints its
 * own word, and the tone is a reinforcement a monochrome printer and a
 * colour-blind reader can both do without.
 */
export function StatusBadge({ learner }) {
  const badge = learnerBadge(learner)
  const reasons = learner?.needsReview ? (learner.reviewReasons || []) : []
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-radius-pill border text-[11px] font-black whitespace-nowrap ${BADGE_TONE[badge.tone]}`}
      title={reasons.map(reviewReasonText).join(' ') || undefined}
    >
      {badge.key === 'needs_review' && <AlertTriangle size={11} aria-hidden="true" />}
      {badge.label}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function updatedLabel(learner) {
  const v = learner?.updatedAt ?? learner?.createdAt
  if (!v) return '—'
  const date = typeof v?.toDate === 'function' ? v.toDate() : new Date(v)
  if (Number.isNaN(date.getTime())) return '—'
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `Today, ${time}` : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

const LearnerRow = memo(function LearnerRow({
  learner, position, selected, onToggleSelect, onEdit, onOpenMenu, isDuplicate,
}) {
  // Left offsets of the three frozen columns, in the order they appear. Kept
  // as constants rather than measured, because a measured value is one frame
  // late on first paint and the columns visibly jump.
  const frozen = 'sticky theme-card z-10'
  return (
    <tr
      className={`border-b theme-border ${selected ? 'theme-bg-subtle' : ''} ${learner.needsReview ? 'bg-amber-50/40' : ''}`}
      style={{ height: ROW_HEIGHT }}
    >
      <td className={`${frozen} left-0 px-3 w-10`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(learner.id)}
          aria-label={`Select ${learner.fullName}`}
          className="w-4 h-4 accent-current cursor-pointer"
        />
      </td>
      <td className={`${frozen} left-10 px-3 w-14 theme-text-muted text-sm tabular-nums`}>
        {learner.learnerNumber || position}
      </td>
      <td className={`${frozen} left-24 px-3 w-28 theme-text-muted text-sm tabular-nums whitespace-nowrap`}>
        {learner.admissionNumber || <span className="text-amber-700">—</span>}
      </td>
      <th scope="row" className={`${frozen} left-52 px-3 text-left font-bold theme-text text-sm min-w-[200px]`}>
        <span className="flex items-center gap-1.5">
          <span className="truncate max-w-[240px]" title={learner.fullName}>{learner.fullName}</span>
          {learner.linkedUid && (
            <Link2 size={12} className="theme-text-muted shrink-0" aria-label="Linked to a learner account" />
          )}
          {isDuplicate && (
            <span className="text-[10px] font-black text-amber-700 uppercase tracking-wide shrink-0">dup?</span>
          )}
        </span>
      </th>
      <td className="px-3 w-24 theme-text-muted text-sm">{learner.gender ? GENDER_LABEL[learner.gender] : '—'}</td>
      <td className="px-3 w-36 theme-text-muted text-sm tabular-nums">{learner.parentPhone || '—'}</td>
      <td className="px-3 w-28 theme-text-muted text-sm tabular-nums">{formatDate(learner.admissionDate)}</td>
      <td className="px-3 w-32"><StatusBadge learner={learner} /></td>
      <td className="px-3 w-28 theme-text-muted text-xs">{updatedLabel(learner)}</td>
      <td className="px-2 w-24 text-right whitespace-nowrap">
        <button type="button" onClick={() => onEdit(learner)}
          aria-label={`Edit ${learner.fullName}`}
          className="inline-grid place-items-center w-11 h-11 rounded-radius-sm theme-text-muted hover:theme-accent-text hover:theme-bg-subtle">
          <Pencil size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={(e) => onOpenMenu(learner, e.currentTarget)}
          aria-label={`More actions for ${learner.fullName}`}
          className="inline-grid place-items-center w-11 h-11 rounded-radius-sm theme-text-muted hover:theme-accent-text hover:theme-bg-subtle">
          <MoreVertical size={16} aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
})

export default function ClassListTable({
  rows,
  rangeStart,
  duplicateIds,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  allSelected,
  onEdit,
  onOpenMenu,
  sort,
  onSort,
}) {
  const scrollRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), [])

  const win = windowRange({
    total: rows.length,
    rowHeight: ROW_HEIGHT,
    viewportHeight: VIEWPORT,
    scrollTop,
  })
  const mounted = rows.slice(win.startIndex, win.endIndex)

  const headCls = 'px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-wider theme-text-muted whitespace-nowrap'
  const frozenHead = `${headCls} sticky theme-card z-30`

  function sortButton(key, label) {
    const active = sort === key
    return (
      <button type="button" onClick={() => onSort(key)}
        aria-sort={active ? 'ascending' : 'none'}
        className={`uppercase tracking-wider ${active ? 'theme-accent-text' : 'hover:theme-text'}`}>
        {label}{active ? ' ▾' : ''}
      </button>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="theme-card border theme-border rounded-radius-md overflow-auto relative"
      style={{ maxHeight: VIEWPORT }}
    >
      <table className="w-full text-sm border-collapse" style={{ minWidth: 1080 }}>
        <caption className="sr-only">
          Class list. Number, admission number and learner name stay visible while the table scrolls sideways.
        </caption>
        <thead className="sticky top-0 z-40 theme-card border-b theme-border">
          <tr>
            <th scope="col" className={`${frozenHead} left-0 top-0 w-10`}>
              <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                aria-label="Select every learner on this page" className="w-4 h-4 cursor-pointer" />
            </th>
            <th scope="col" className={`${frozenHead} left-10 top-0 w-14`}>No.</th>
            <th scope="col" className={`${frozenHead} left-24 top-0 w-28`}>
              {sortButton('admission_asc', 'Adm No.')}
            </th>
            <th scope="col" className={`${frozenHead} left-52 top-0 min-w-[200px]`}>
              {sortButton('name_asc', 'Learner name')}
            </th>
            <th scope="col" className={headCls}>Gender</th>
            <th scope="col" className={headCls}>Parent phone</th>
            <th scope="col" className={headCls}>Admission date</th>
            <th scope="col" className={headCls}>Status</th>
            <th scope="col" className={headCls}>{sortButton('recent', 'Updated')}</th>
            <th scope="col" className={`${headCls} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {/* Spacer rows hold the full scroll height open so the scrollbar
              tells the truth about how long the list is. */}
          {win.paddingTop > 0 && <tr aria-hidden="true" style={{ height: win.paddingTop }}><td colSpan={10} /></tr>}
          {mounted.map((learner, i) => (
            <LearnerRow
              key={learner.id}
              learner={learner}
              position={rangeStart + win.startIndex + i}
              selected={selectedIds.has(learner.id)}
              isDuplicate={duplicateIds.has(learner.id)}
              onToggleSelect={onToggleSelect}
              onEdit={onEdit}
              onOpenMenu={onOpenMenu}
            />
          ))}
          {win.paddingBottom > 0 && <tr aria-hidden="true" style={{ height: win.paddingBottom }}><td colSpan={10} /></tr>}
        </tbody>
      </table>
    </div>
  )
}
