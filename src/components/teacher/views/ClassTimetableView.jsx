/**
 * Read-only rendering of a validated class-timetable artifact.
 * Shared by the Class Timetable Studio (print preview) and the Library
 * detail view.
 *
 * Renders the official document look — a black-grid grid on white, serif
 * type — so it reads as the printed timetable pinned on the classroom wall.
 * Both presentation layouts are supported from the SAME saved schedule
 * (see src/utils/timetableGridModel.js):
 *   - Days across the top — doubles merge vertically
 *   - Days down the left (the print default) — doubles merge horizontally
 *
 * The PRINT TEMPLATE (src/utils/timetablePrintTemplates.js) is resolved by
 * the same function the PDF, Word and Excel exports use, so this preview is
 * the document that downloads — Ministry header, official title, monochrome
 * cells, vertically spelled BREAK/LUNCH, abbreviation key and signature
 * lines included.
 *
 * Legacy (v1, per-cell) artifacts are normalised on the way in, so every
 * previously saved timetable keeps rendering.
 */

import {
  buildTimetableGridModel,
  subjectTintMap,
  formatPeriodLabel,
  dayRowForSlot,
  resolveDayCell,
  cellTextFor,
} from '../../../utils/timetableGridModel'
import {
  resolvePrintSettings,
  verticalBandLetters,
  officialTimetableTitle,
  MINISTRY_HEADER_TEXT,
} from '../../../utils/timetablePrintTemplates'
import { buildAbbreviationLegend, legendLine } from '../../../utils/subjectAbbreviations'

const DOC_FONT = { fontFamily: "Georgia, 'Times New Roman', serif" }
const TD = 'border border-black p-1.5 align-middle text-center'
const STICKY = { position: 'sticky', left: 0, background: '#fff', zIndex: 1 }

function HeaderBlock({ h, settings }) {
  if (settings.template.id === 'government') {
    const underline = { textDecoration: 'underline', textUnderlineOffset: 3 }
    const meta = [h.term && `TERM ${h.term}`, h.year].filter(Boolean).join(' · ')
    return (
      <div className="text-center">
        {settings.ministryHeader && (
          <div className="text-sm font-bold uppercase tracking-[0.1em]" style={underline}>{MINISTRY_HEADER_TEXT}</div>
        )}
        {h.school && (
          <div className="mt-0.5 text-sm font-bold uppercase tracking-[0.06em]" style={underline}>{h.school}</div>
        )}
        <div className="mt-1 text-base font-bold uppercase tracking-[0.08em]" style={underline}>
          {officialTimetableTitle({ grade: h.grade, className: h.className })}
        </div>
        {meta && <div className="mt-1 text-[12px] font-bold">{meta}</div>}
      </div>
    )
  }
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

function lessonCell({ model, day, slot, cell, tints, key, layout, settings }) {
  const block = cell.block
  const isActivity = block?.type === 'school-activity'
  const span = block ? block.length : 1
  const spanProps = layout === 'days-as-columns' ? { rowSpan: span } : { colSpan: span }
  const caption = dayTimeCaption(model, day, slot)
  const fill = settings.colour && block && !isActivity ? { background: tints[block.label] } : undefined
  return (
    <td
      key={key}
      className={TD}
      {...(span > 1 ? spanProps : {})}
      style={
        isActivity
          ? (settings.colour ? { background: '#f6f3ea', fontStyle: 'italic', color: '#5a523e' } : { fontStyle: 'italic' })
          : fill
      }
    >
      {block ? (
        <>
          {cellTextFor(model, block.label, settings.cellText)}
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

function offCell(key, settings) {
  return (
    <td key={key} className={TD} style={{ background: settings.colour ? '#efece3' : '#fff', color: '#888888', fontSize: 10 }}>
      —
    </td>
  )
}

/** A day-only band — the assembly that occupies Period 1 on Monday while
 * the other days hold a lesson in that same time column. */
function dayBandCell(key, label, settings) {
  return (
    <td key={key} className={`${TD} font-bold uppercase tracking-[0.08em]`}
      style={{ background: settings.colour ? '#f1ece0' : '#fff', fontSize: 10 }}>
      {label}
    </td>
  )
}

function DaysAsColumns({ model, tints, settings }) {
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
                  style={{ background: settings.colour ? '#f1ece0' : '#fff' }}
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
                const cell = resolveDayCell(model, day, p)
                if (cell.state === 'covered') return null
                if (cell.state === 'off') return offCell(day, settings)
                if (cell.state === 'band') return dayBandCell(day, cell.bandLabel, settings)
                return lessonCell({
                  model, day, slot: cell.row?.slot ?? p.slot, cell, tints, key: day,
                  layout: 'days-as-columns', settings,
                })
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DaysAsRows({ model, tints, settings }) {
  // BREAK spelled one letter per day-row down its own column — the Zambian
  // convention both reference documents use.
  const bandLetters = new Map()
  if (settings.spellBands) {
    for (const p of model.rows) {
      if (p.kind === 'break') bandLetters.set(p.id, verticalBandLetters(p.label, model.days.length))
    }
  }
  return (
    <table className="w-full border-collapse border border-black min-w-[860px]">
      <thead>
        <tr>
          <th className={`${TD} font-bold`} style={STICKY}>DAY</th>
          {model.rows.map((p) => (
            <th key={p.id} className={`${TD} font-bold`}
              style={p.kind === 'break' && settings.colour ? { background: '#f1ece0' } : undefined}>
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
        {model.days.map((day, dayIndex) => (
          <tr key={day}>
            <td className={`${TD} font-bold uppercase whitespace-nowrap`} style={STICKY}>{day}</td>
            {model.rows.map((p) => {
              if (p.kind === 'break') {
                const letters = bandLetters.get(p.id)
                return (
                  <td key={p.id} className={`${TD} font-bold uppercase`}
                    style={{
                      background: settings.colour ? '#f1ece0' : '#fff',
                      fontSize: letters ? 13 : 9,
                      letterSpacing: letters ? 0 : '0.08em',
                    }}>
                    {letters ? (letters[dayIndex] || '') : p.label}
                  </td>
                )
              }
              const cell = resolveDayCell(model, day, p)
              if (cell.state === 'covered') return null
              if (cell.state === 'off') return offCell(p.id, settings)
              if (cell.state === 'band') return dayBandCell(p.id, cell.bandLabel, settings)
              return lessonCell({
                model, day, slot: cell.row?.slot ?? p.slot, cell, tints, key: p.id,
                layout: 'days-as-rows', settings,
              })
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The abbreviation key — printed only when the grid actually uses codes. */
function Legend({ model }) {
  const entries = buildAbbreviationLegend(
    model.subjectAllocations?.length ? model.subjectAllocations : model.subjects.map((label) => ({ label })),
    new Set(model.subjects),
  )
  if (!entries.length) return null
  return (
    <div className="mt-2 text-[10px] leading-relaxed">
      <span className="font-bold">KEY:</span> {legendLine(entries)}
    </div>
  )
}

/** Signature lines and a clear space for the school stamp — what makes the
 * Ministry format an official document rather than a printout. */
function OfficialFooter({ h }) {
  return (
    <div className="mt-6 flex items-end justify-between gap-6">
      <div className="flex-1">
        <div className="h-6 border-b border-black" />
        <div className="mt-1 text-[10px]">Class teacher{h.teacherName ? `: ${h.teacherName}` : ''}</div>
      </div>
      <div className="flex-1">
        <div className="h-6 border-b border-black" />
        <div className="mt-1 text-[10px]">Senior teacher / Head</div>
      </div>
      <div className="flex h-16 flex-[0_0_34%] items-end justify-center border border-dashed pb-1 text-[10px]"
        style={{ borderColor: '#888888', color: '#666' }}>
        School stamp
      </div>
    </div>
  )
}

export default function ClassTimetableView({ timetable, layout, template }) {
  const model = buildTimetableGridModel(timetable)
  if (!model) return null
  const settings = resolvePrintSettings(model, { template })
  // An explicit `layout` prop is the caller's own override (the library
  // view's toggle); otherwise the print template + preference decide.
  model.layout = layout || settings.layout
  const tints = settings.colour ? subjectTintMap(model) : {}

  return (
    <article
      className="bg-white text-black rounded-xl border theme-border px-4 py-5 sm:px-6 text-[12px]"
      style={DOC_FONT}
    >
      <HeaderBlock h={model.header} settings={settings} />
      <div className="mt-4 overflow-x-auto">
        {model.layout === 'days-as-rows'
          ? <DaysAsRows model={model} tints={tints} settings={settings} />
          : <DaysAsColumns model={model} tints={tints} settings={settings} />}
      </div>
      {settings.showLegend && <Legend model={model} />}
      {settings.signatures && <OfficialFooter h={model.header} />}
    </article>
  )
}

export { formatPeriodLabel }
