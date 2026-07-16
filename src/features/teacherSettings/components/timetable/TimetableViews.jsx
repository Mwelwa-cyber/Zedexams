import { useMemo } from 'react'
import {
  TT_DAY_LABELS,
  buildTtGridModel,
  blocksByDay,
} from '../../../../utils/teacherTimetableCore'
import { TIMETABLE_DAYS } from '../../../../utils/teacherSettingsCore'

// Presentation-only views over the SAME schedule blocks. Switching layout or
// view mode never touches the data — both grids and the list render from one
// shared model (buildTtGridModel / blocksByDay). Status is conveyed by text
// badges + icons, never colour alone.

function sourceBadge(block) {
  if (block.migrationState === 'needs-review') return { text: 'Needs review', tone: 'error', symbol: '⚠' }
  if (block.syncState === 'source-missing') return { text: 'Source missing', tone: 'error', symbol: '⚠' }
  if (block.sourceType === 'class-timetable') {
    return block.syncState === 'source-updated'
      ? { text: 'Source updated', tone: 'warn', symbol: '↻' }
      : { text: 'Linked from Class Timetable', tone: 'linked', symbol: '🔗' }
  }
  if (block.sourceType === 'legacy') return { text: 'Imported from old timetable', tone: 'manual', symbol: '•' }
  return { text: 'Manually scheduled', tone: 'manual', symbol: '✎' }
}

function BlockCard({ block, conflictBlockIds, highlightAssignmentId, onEdit }) {
  const badge = sourceBadge(block)
  const conflicted = conflictBlockIds.has(block.blockId)
  const highlighted = highlightAssignmentId && block.assignmentId === highlightAssignmentId
  const title = block.snapshot.label || 'Teaching period'
  return (
    <button
      type="button"
      className={[
        'tset-ttb-block',
        `tset-ttb-block--${badge.tone}`,
        conflicted ? 'tset-ttb-block--conflict' : '',
        highlighted ? 'tset-ttb-block--highlight' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onEdit?.(block)}
      title={`${title} · ${TT_DAY_LABELS[block.day]} ${block.startTime}–${block.endTime}${block.roomId ? ` · ${block.roomId}` : ''} · ${badge.text}`}
    >
      <span className="tset-ttb-block__label">{title}</span>
      <span className="tset-ttb-block__time">
        {block.startTime}–{block.endTime}
        {block.blockType === 'double' ? ' · Double' : ''}
      </span>
      <span className={`tset-ttb-badge tset-ttb-badge--${badge.tone}`}>
        <span aria-hidden="true">{badge.symbol}</span> {badge.text}
      </span>
      {conflicted && (
        <span className="tset-ttb-badge tset-ttb-badge--error">
          <span aria-hidden="true">⚠</span> Conflict
        </span>
      )}
    </button>
  )
}

/**
 * Week grid in either orientation.
 *   days-as-columns — days across the top, time down the left (sticky),
 *                     doubles extend vertically (rowSpan).
 *   days-as-rows    — days down the left (sticky), time across the top,
 *                     doubles extend horizontally (colSpan).
 */
export function TimetableWeekGrid({ blocks, layout, conflictBlockIds, highlightAssignmentId, onEdit }) {
  const model = useMemo(() => buildTtGridModel(blocks), [blocks])
  const conflictSet = conflictBlockIds || new Set()

  if (model.timeSlots.length === 0) return null

  if (layout === 'days-as-rows') {
    return (
      <div className="tset-ttb-gridwrap" role="region" aria-label="Weekly teaching timetable, days down the left">
        <table className="tset-ttb-grid tset-ttb-grid--rows">
          <thead>
            <tr>
              <th scope="col" className="tset-ttb-grid__corner">Day</th>
              {model.timeSlots.map((s) => (
                <th key={s.start} scope="col">{s.start}–{s.end}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.days.map((day) => (
              <tr key={day}>
                <th scope="row" className="tset-ttb-grid__day">{TT_DAY_LABELS[day]}</th>
                {model.timeSlots.map((s, i) => {
                  const cell = model.cell(day, i)
                  if (cell.state === 'covered') return null
                  if (cell.state === 'empty') return <td key={s.start} className="tset-ttb-grid__empty" />
                  return (
                    <td key={s.start} colSpan={cell.span}>
                      <BlockCard
                        block={cell.block}
                        conflictBlockIds={conflictSet}
                        highlightAssignmentId={highlightAssignmentId}
                        onEdit={onEdit}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="tset-ttb-gridwrap" role="region" aria-label="Weekly teaching timetable, days across the top">
      <table className="tset-ttb-grid tset-ttb-grid--columns">
        <thead>
          <tr>
            <th scope="col" className="tset-ttb-grid__corner">Time</th>
            {model.days.map((day) => (
              <th key={day} scope="col">{TT_DAY_LABELS[day]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.timeSlots.map((s, i) => (
            <tr key={s.start}>
              <th scope="row" className="tset-ttb-grid__time">{s.start}–{s.end}</th>
              {model.days.map((day) => {
                const cell = model.cell(day, i)
                if (cell.state === 'covered') return null
                if (cell.state === 'empty') return <td key={day} className="tset-ttb-grid__empty" />
                return (
                  <td key={day} rowSpan={cell.span}>
                    <BlockCard
                      block={cell.block}
                      conflictBlockIds={conflictSet}
                      highlightAssignmentId={highlightAssignmentId}
                      onEdit={onEdit}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Compact list of periods grouped by day — the phone-friendly view. Passing
 * `day` narrows it to a single day (the daily view).
 */
export function TimetableListView({ blocks, day = null, conflictBlockIds, highlightAssignmentId, onEdit }) {
  const byDay = useMemo(() => blocksByDay(blocks), [blocks])
  const conflictSet = conflictBlockIds || new Set()
  const days = day ? [day] : TIMETABLE_DAYS

  return (
    <div className="tset-ttb-list">
      {days.map((d) => (
        <section key={d} className="tset-ttb-list__day">
          <h3 className="tset-ttb-list__dayname">{TT_DAY_LABELS[d]}</h3>
          {byDay[d].length === 0 ? (
            <p className="tset-section__hint">No teaching periods.</p>
          ) : (
            <ul className="tset-ttb-list__items">
              {byDay[d].map((b) => (
                <li key={b.blockId}>
                  <BlockCard
                    block={b}
                    conflictBlockIds={conflictSet}
                    highlightAssignmentId={highlightAssignmentId}
                    onEdit={onEdit}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
