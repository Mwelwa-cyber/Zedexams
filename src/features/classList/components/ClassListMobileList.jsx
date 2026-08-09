/**
 * ClassListMobileList — the class list on a phone.
 *
 * NOT the desktop table squeezed down (§12). A ten-column table on a 360px
 * screen is either unreadably small or a horizontal scroll a thumb cannot
 * aim at, so the phone gets its own shape: one card per learner, the four
 * facts that identify them, and everything else behind a full-width action
 * sheet with 48px targets.
 *
 * The same windowing as the table, for the same reason — these are the
 * cheapest phones the product supports and 120 cards is a lot of DOM.
 */

import { memo, useCallback, useRef, useState } from 'react'
import { windowRange } from '../../../utils/classListCore'
import { StatusBadge } from './ClassListTable'
import { Check, MoreVertical } from '../../../shared/icons/classListIcons'

const CARD_HEIGHT = 76
const VIEWPORT = 560

const GENDER_LABEL = { M: 'Male', F: 'Female', other: 'Other' }

const LearnerCard = memo(function LearnerCard({
  learner, position, selecting, selected, onToggleSelect, onOpenMenu,
}) {
  const facts = [
    learner.gender ? GENDER_LABEL[learner.gender] : null,
    learner.parentPhone,
  ].filter(Boolean).join(' · ')

  return (
    <li
      style={{ height: CARD_HEIGHT }}
      className={`flex items-center gap-3 px-3 border-b theme-border ${selected ? 'theme-bg-subtle' : ''} ${learner.needsReview ? 'bg-amber-50/50' : ''}`}
    >
      {selecting ? (
        <button
          type="button"
          onClick={() => onToggleSelect(learner.id)}
          aria-pressed={selected}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${learner.fullName}`}
          className={`shrink-0 w-12 h-12 rounded-radius-sm grid place-items-center border ${
            selected ? 'theme-accent-fill theme-on-accent border-transparent' : 'theme-border theme-text-muted'
          }`}
        >
          {selected ? <Check size={18} aria-hidden="true" /> : <span className="text-sm font-black tabular-nums">{learner.learnerNumber || position}</span>}
        </button>
      ) : (
        <span className="shrink-0 w-9 text-center theme-text-muted text-sm font-black tabular-nums">
          {learner.learnerNumber || position}
        </span>
      )}

      <div className="flex-1 min-w-0">
        <p className="theme-text font-black text-sm truncate">{learner.fullName}</p>
        <p className="theme-text-muted text-xs truncate">
          {learner.admissionNumber
            ? <span className="tabular-nums">{learner.admissionNumber}</span>
            : <span className="text-amber-700">No admission number</span>}
          {facts ? ` · ${facts}` : ''}
        </p>
      </div>

      <StatusBadge learner={learner} />

      <button
        type="button"
        onClick={() => onOpenMenu(learner)}
        aria-label={`Actions for ${learner.fullName}`}
        className="shrink-0 w-12 h-12 grid place-items-center rounded-radius-sm theme-text-muted active:theme-bg-subtle"
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
    </li>
  )
})

export default function ClassListMobileList({
  rows, rangeStart, selecting, selectedIds, onToggleSelect, onOpenMenu,
}) {
  const scrollRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), [])

  const win = windowRange({
    total: rows.length,
    rowHeight: CARD_HEIGHT,
    viewportHeight: VIEWPORT,
    scrollTop,
  })
  const mounted = rows.slice(win.startIndex, win.endIndex)

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="theme-card border theme-border rounded-radius-md overflow-y-auto"
      style={{ maxHeight: VIEWPORT }}
    >
      <ul aria-label="Learners">
        {win.paddingTop > 0 && <li aria-hidden="true" style={{ height: win.paddingTop }} />}
        {mounted.map((learner, i) => (
          <LearnerCard
            key={learner.id}
            learner={learner}
            position={rangeStart + win.startIndex + i}
            selecting={selecting}
            selected={selectedIds.has(learner.id)}
            onToggleSelect={onToggleSelect}
            onOpenMenu={onOpenMenu}
          />
        ))}
        {win.paddingBottom > 0 && <li aria-hidden="true" style={{ height: win.paddingBottom }} />}
      </ul>
    </div>
  )
}
