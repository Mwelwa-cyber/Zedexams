/**
 * Read-only rendering of a validated class-timetable artifact.
 * Shared by the Class Timetable Studio (print preview) and the Library
 * detail view.
 *
 * Renders the official document look — a black-grid grid on white, serif
 * type — so it reads as the printed timetable pinned on the classroom wall.
 * Both presentation layouts are supported from the SAME saved schedule
 * (see src/utils/timetableGridModel.js):
 *   - Days across the top (default) — doubles merge vertically
 *   - Days down the left — doubles merge horizontally
 * Legacy (v1, per-cell) artifacts are normalised on the way in, so every
 * previously saved timetable keeps rendering.
 */

import {
  buildTimetableGridModel,
  cellState,
  subjectTintMap,
  formatPeriodLabel,
  dayRowForSlot,
} from '../../../utils/timetableGridModel'

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-middle text-center'
const STICKY = { position: 'sticky', left: 0, background: '#fff', zIndex: 1 }

function HeaderBlock({ h }) {
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const titleBits = [
    h.className && h.className.trim(),
    gradeLabel && `Grade ${gradeLabel}`,
  ].filter(Boolean).join(' · ')
  return (
    <div className="text-center">
      {h.school && (
        <div className="text-sm font-bold uppercase tracking-[0.06em]">{h.school}</div>
      )}
      <div className="mt-1 text-base font-bold tracking-[0.08em] uppercase">
        Class Timetable
      </div>
      <div className="mt-1 text-[12px] font-bold">
        {titleBits}
        {h.term ? <> &nbsp;·&nbsp; TERM {h.term}</> : null}
        {h.year ? <> &nbsp;·&nbsp; {h.year}</> : null}
      </div>
      {h.teacherName && (
        <div className="mt-1 text-[12px]">Class teacher: {h.teacherName}</div>
      )}
    </div>
  )
}

/** A cell's own-day time caption — only rendered when a day-specific school
 * structure (e.g. a half-day Friday) gives this cell's slot a different
 * clock time than the shared reference row shown in the header/gutter. */
function dayTimeCaption(model, day, slot) {
  const dayRow = dayRowForSlot(model, day, slot)
  const refRow = model.rows.find((r) => r.kind === 'lesson' && r.slot === slot)
  if (!dayRow || !refRow || (dayRow.start === refRow.start && dayRow.end === refRow.end)) return null
  return `${dayRow.start}–${dayRow.end}`
}

function lessonCell({ model, day, slot, cell, tints, key, layout }) {
  const block = cell.block
  const isActivity = block?.type === 'school-activity'
  const span = block ? block.length : 1
  const spanProps = layout === 'days-as-columns' ? { rowSpan: span } : { colSpan: span }
  const caption = dayTimeCaption(model, day, slot)
  return (
    <td
      key={key}
      className={TD}
      {...(span > 1 ? spanProps : {})}
      style={
        isActivity
          ? { background: '#f6f3ea', fontStyle: 'italic', color: '#5a523e' }
          : block
            ? { background: tints[block.label] }
            : undefined
      }
    >
      {block ? (
        <>
          {block.label}
          {span > 1 && (
            <div className="text-[9px] font-bold uppercase tracking-[0.08em] opacity-60">
              Double period
            </div>
          )}
          {block.locked && <span title="Locked" className="ml-1 opacity-50">🔒</span>}
        </>
      ) : (
        <span className="opacity-30">—</span>
      )}
      {caption && <div className="text-[8px] font-normal opacity-60 whitespace-nowrap">{caption}</div>}
    </td>
  )
}

function offCell(key) {
  return (
    <td key={key} className={TD} style={{ background: '#efece3', color: '#a89e86', fontSize: 10 }}>
      —
    </td>
  )
}

function DaysAsColumns({ model, tints }) {
  return (
    <table className="w-full border-collapse border border-black min-w-[720px]">
      <thead>
        <tr>
          <th className={`${TD} font-bold w-[14%]`} style={STICKY}>TIME</th>
          {model.days.map((day) => (
            <th key={day} className={`${TD} font-bold`}>{day.toUpperCase()}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {model.rows.map((p) => {
          if (p.kind === 'break') {
            return (
              <tr key={p.id}>
                <td className={`${TD} font-bold whitespace-nowrap`} style={STICKY}>
                  {p.start}–{p.end}
                </td>
                <td
                  className={`${TD} font-bold uppercase tracking-[0.15em]`}
                  colSpan={model.days.length || 1}
                  style={{ background: '#f1ece0' }}
                >
                  {p.label}
                </td>
              </tr>
            )
          }
          return (
            <tr key={p.id}>
              <td className={`${TD} font-bold`} style={STICKY}>
                {model.labelMode !== 'period' && <div className="whitespace-nowrap">{p.start}–{p.end}</div>}
                {model.labelMode !== 'time' && (
                  <div className={model.labelMode === 'period' ? '' : 'text-[10px] font-normal opacity-70'}>
                    Period {p.slot}
                  </div>
                )}
              </td>
              {model.days.map((day) => {
                const cell = cellState(model, day, p.slot)
                if (cell.state === 'covered') return null
                if (cell.state === 'off') return offCell(day)
                return lessonCell({ model, day, slot: p.slot, cell, tints, key: day, layout: 'days-as-columns' })
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DaysAsRows({ model, tints }) {
  return (
    <table className="w-full border-collapse border border-black min-w-[860px]">
      <thead>
        <tr>
          <th className={`${TD} font-bold`} style={STICKY}>DAY</th>
          {model.rows.map((p) => (
            <th key={p.id} className={`${TD} font-bold`} style={p.kind === 'break' ? { background: '#f1ece0' } : undefined}>
              {p.kind === 'break' ? (
                <>
                  <div className="text-[10px] tracking-[0.1em]">{p.label}</div>
                  <div className="text-[9px] font-normal opacity-70 whitespace-nowrap">{p.start}–{p.end}</div>
                </>
              ) : (
                <>
                  {model.labelMode !== 'time' && <div>P{p.slot}</div>}
                  {model.labelMode !== 'period' && (
                    <div className={`whitespace-nowrap ${model.labelMode === 'time' ? '' : 'text-[9px] font-normal opacity-70'}`}>
                      {p.start}–{p.end}
                    </div>
                  )}
                </>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {model.days.map((day) => (
          <tr key={day}>
            <td className={`${TD} font-bold uppercase whitespace-nowrap`} style={STICKY}>{day}</td>
            {model.rows.map((p) => {
              if (p.kind === 'break') {
                return (
                  <td key={p.id} className={`${TD} font-bold uppercase`} style={{ background: '#f1ece0', fontSize: 9, letterSpacing: '0.08em' }}>
                    {p.label}
                  </td>
                )
              }
              const cell = cellState(model, day, p.slot)
              if (cell.state === 'covered') return null
              if (cell.state === 'off') return offCell(p.id)
              return lessonCell({ model, day, slot: p.slot, cell, tints, key: p.id, layout: 'days-as-rows' })
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ClassTimetableView({ timetable, layout }) {
  const model = buildTimetableGridModel(timetable, layout ? { layout } : {})
  if (!model) return null
  const tints = subjectTintMap(model)

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      <HeaderBlock h={model.header} />
      <div className="mt-4 overflow-x-auto">
        {model.layout === 'days-as-rows'
          ? <DaysAsRows model={model} tints={tints} />
          : <DaysAsColumns model={model} tints={tints} />}
      </div>
    </article>
  )
}

export { formatPeriodLabel }
